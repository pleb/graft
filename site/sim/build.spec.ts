import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { check, linkPlayer, loadScenarios, renderPage, scriptJson } from "./build-lib.ts";
import type { Event, Repo, Scenario } from "./events.ts";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const PLAYER = ["core.ts", "terminal.ts", "stage.ts", "finale.ts", "controls.ts", "main.ts"];

const REPO: Repo = { name: "acme/notes-api", files: { "README.md": "# notes\n\nA notes API.\n" } };

function scenarios(): Scenario[] {
  return [
    {
      id: "start",
      title: "Start",
      kind: "start",
      settings: {},
      events: [
        { type: "prompt", text: "/graft:plan x" },
        { type: "chapter", id: "one", title: "One" },
        {
          type: "ask",
          questions: [
            {
              header: "Pick",
              question: "Which?",
              options: [{ label: "A" }, { label: "B" }],
              answer: "A",
              recommended: true,
            },
          ],
        },
        { type: "file.modify", path: "README.md", edits: [{ find: "A notes API.", replace: "B" }] },
        { type: "agent.start", id: "w1", agent: "worker", description: "Work" },
        { type: "agent.done", id: "w1" },
        { type: "git.commit", id: "c1", subject: "Commit" },
        {
          type: "handoff",
          text: "Next",
          clear: true,
          choices: [{ command: "/graft:pr", next: "pr" }],
        },
      ],
    },
    {
      id: "pr",
      title: "PR",
      kind: "continue",
      settings: {},
      events: [
        { type: "prompt", text: "/graft:pr" },
        {
          type: "pr.open",
          number: 7,
          title: "T",
          branch: "b",
          base: "main",
          draft: true,
          commits: ["c1"],
          body: "Body",
        },
        { type: "end" },
      ],
    },
    {
      id: "review",
      title: "Review",
      kind: "helper",
      settings: {},
      events: [
        { type: "prompt", text: "/graft:review 42" },
        {
          type: "pr.seed",
          number: 42,
          title: "T",
          branch: "b",
          base: "main",
          draft: true,
          commits: [{ id: "abc1234", subject: "S" }],
        },
        { type: "agent.start", id: "r1", agent: "reviewer", description: "Review", from: "pr:42" },
        { type: "agent.done", id: "r1" },
        { type: "pr.comment", number: 42, text: "Comment" },
        { type: "end" },
      ],
    },
  ];
}

function mutated(change: (byId: Record<string, Scenario>) => void): string[] {
  const list = scenarios();
  change(Object.fromEntries(list.map((scenario) => [scenario.id, scenario])));
  return check(list, REPO);
}

function replaceEvent(scenario: Scenario, type: Event["type"], event: Event): void {
  const index = scenario.events.findIndex((item) => item.type === type);
  scenario.events[index] = event;
}

describe("check", () => {
  it("passes valid scenarios", () => {
    expect(check(scenarios(), REPO)).toEqual([]);
  });

  it("passes the fixtures", async () => {
    const loaded = await loadScenarios(join(HERE, "fixtures"));
    expect(loaded.scenarios.map((scenario) => scenario.id).sort()).toEqual([
      "continue",
      "helper",
      "start",
    ]);
    expect(loaded.repo.name).toBe("acme/notes-api");
    expect(check(loaded.scenarios, loaded.repo)).toEqual([]);
  });

  it("fails when an edit's find does not occur exactly once", () => {
    expect(
      mutated(({ start }) => {
        replaceEvent(start, "file.modify", {
          type: "file.modify",
          path: "README.md",
          edits: [{ find: "notes", replace: "x" }],
        });
      }),
    ).toEqual([expect.stringMatching(/find "notes" occurs 2 times/)]);
    expect(
      mutated(({ start }) => {
        replaceEvent(start, "file.modify", {
          type: "file.modify",
          path: "README.md",
          edits: [{ find: "missing", replace: "x" }],
        });
      }),
    ).toEqual([expect.stringMatching(/occurs 0 times/)]);
  });

  it("applies edits in order, so a later find sees earlier replacements", () => {
    expect(
      mutated(({ start }) => {
        replaceEvent(start, "file.modify", {
          type: "file.modify",
          path: "README.md",
          edits: [
            { find: "A notes API.", replace: "Limited." },
            { find: "Limited.", replace: "Done." },
          ],
        });
      }),
    ).toEqual([]);
  });

  it("fails when an agent finishes without starting", () => {
    expect(
      mutated(({ start }) => {
        replaceEvent(start, "agent.start", { type: "say", text: "No agent" });
      }),
    ).toEqual([expect.stringMatching(/agent w1 finishes without starting/)]);
  });

  it("fails when an agent never finishes", () => {
    expect(
      mutated(({ start }) => {
        replaceEvent(start, "agent.done", { type: "say", text: "No finish" });
      }),
    ).toEqual([expect.stringMatching(/agents never finish: w1/)]);
  });

  it("fails when an answer is not one of its options", () => {
    expect(
      mutated(({ start }) => {
        const ask = start.events.find((event) => event.type === "ask")!;
        if (ask.type === "ask") ask.questions[0].answer = "C";
      }),
    ).toEqual([expect.stringMatching(/answer "C" is not an option/)]);
  });

  it("fails when a recommended question does not answer with its first option", () => {
    const recommended = (on: boolean) =>
      mutated(({ start }) => {
        const ask = start.events.find((event) => event.type === "ask")!;
        if (ask.type !== "ask") return;
        ask.questions[0].answer = "B";
        ask.questions[0].recommended = on;
      });
    expect(recommended(true)).toEqual([expect.stringMatching(/recommended but not answered/)]);
    expect(recommended(false)).toEqual([]);
  });

  it("fails when a chapter id repeats along a path", () => {
    expect(
      mutated(({ pr }) => {
        pr.events.splice(1, 0, { type: "chapter", id: "one", title: "Again" });
      }),
    ).toEqual([expect.stringMatching(/chapter id one repeats/)]);
  });

  it("fails when a handoff is not the last event of its flattened scenario", () => {
    expect(
      mutated(({ start }) => {
        start.events.push({ type: "say", text: "After the hand-off" });
      }),
    ).toEqual(expect.arrayContaining([expect.stringMatching(/handoff is not the last event/)]));
    expect(
      mutated(({ start }) => {
        start.events.push({ type: "say", text: "Only after review", after: ["review"] });
      }),
    ).toEqual([]);
  });

  it("fails when a handoff names an unknown scenario", () => {
    expect(
      mutated(({ start }) => {
        const handoff = start.events.at(-1)!;
        if (handoff.type === "handoff") handoff.choices.push({ command: "/graft:x", next: "nope" });
      }),
    ).toEqual([expect.stringMatching(/names unknown scenario nope/)]);
  });

  it("fails when a hand-off command is not the next scenario's first prompt", () => {
    expect(
      mutated(({ pr }) => {
        pr.events[0] = { type: "prompt", text: "/graft:pr now" };
      }),
    ).toEqual([expect.stringMatching(/command "\/graft:pr" is not pr's first prompt/)]);
  });

  it("compares the first prompt after flattening on that path", () => {
    expect(
      mutated(({ pr }) => {
        pr.events[0] = { type: "prompt", text: "/graft:pr", after: ["start"] };
        pr.events.unshift({ type: "prompt", text: "/graft:other", notAfter: ["start"] });
      }),
    ).toEqual([]);
  });

  it("fails when a path does not end in end", () => {
    expect(
      mutated(({ pr }) => {
        pr.events.pop();
      }),
    ).toEqual([expect.stringMatching(/start › pr: the path does not end in end/)]);
  });

  it("fails when end follows no pr.open or pr.comment", () => {
    expect(
      mutated(({ review }) => {
        review.events.splice(4, 1);
      }),
    ).toEqual([expect.stringMatching(/end follows no pr.open or pr.comment/)]);
  });

  it("fails when a pr.comment names a PR not on stage", () => {
    expect(
      mutated(({ review }) => {
        replaceEvent(review, "pr.comment", { type: "pr.comment", number: 9, text: "x" });
      }),
    ).toEqual([expect.stringMatching(/PR #9 is not on stage/)]);
  });

  it("fails when an agent's from names a PR not on stage", () => {
    expect(
      mutated(({ review }) => {
        replaceEvent(review, "agent.start", {
          type: "agent.start",
          id: "r1",
          agent: "reviewer",
          description: "Review",
          from: "pr:9",
        });
      }),
    ).toEqual([expect.stringMatching(/PR #9 is not on stage/)]);
  });

  it("fails when a pr.open's commits name unknown git.commit ids", () => {
    expect(
      mutated(({ pr }) => {
        const open = pr.events.find((event) => event.type === "pr.open")!;
        if (open.type === "pr.open") open.commits.push("c9");
      }),
    ).toEqual([expect.stringMatching(/commit c9 is not a git.commit id/)]);
  });

  it("fails when the hand-off graph has a cycle", () => {
    expect(
      mutated(({ pr }) => {
        pr.events.pop();
        pr.events.push({
          type: "handoff",
          text: "Again",
          choices: [{ command: "/graft:plan x", next: "start" }],
        });
      }),
    ).toEqual([expect.stringMatching(/cycle: start › pr › start/)]);
  });
});

describe("loadScenarios", () => {
  it("yields no scenarios and an empty repo for a missing folder", async () => {
    expect(await loadScenarios(join(HERE, "no-such-folder"))).toEqual({
      scenarios: [],
      repo: { name: "", files: {} },
    });
  });
});

describe("scriptJson", () => {
  it("escapes characters that could end or break a script element", () => {
    const text = "</script><!-- & \u2028\u2029";
    const json = scriptJson({ text });
    expect(json).not.toMatch(/[<>&\u2028\u2029]/);
    expect(JSON.parse(json)).toEqual({ text });
  });
});

describe("linkPlayer", () => {
  const file = (name: string, text: string) => ({ name, text });

  it("removes multi-line imports and export keywords", () => {
    const linked = linkPlayer([
      file("core.ts", "export function a(): number {\n  return 1;\n}\nexport const b = 2;\n"),
      file(
        "main.ts",
        'import type { Event } from "../events.ts";\nimport {\n  a,\n  b,\n} from "./core.ts";\n\nconst e: Event | undefined = undefined;\na() + b;\n',
      ),
    ]);
    expect(linked).not.toMatch(/\bimport\b|\bexport\b/);
    expect(linked).toMatch(/^<script>\n\(\(\) => \{/);
    expect(() => new vm.Script(linked.replace(/^<script>|<\/script>$/g, ""))).not.toThrow();
  });

  it("fails on a namespace import", () => {
    expect(() => linkPlayer([file("main.ts", 'import * as core from "./core.ts";\n')])).toThrow(
      /namespace import/,
    );
  });

  it("fails on an import from outside player/", () => {
    expect(() => linkPlayer([file("main.ts", 'import { x } from "../build-lib.ts";\n')])).toThrow(
      /outside player/,
    );
  });

  it("fails on a leftover export", () => {
    expect(() => linkPlayer([file("core.ts", "const a = 1;\nexport { a };\n")])).toThrow(
      /leftover export/,
    );
  });

  it("does not mistake export as a substring for a statement", () => {
    expect(() =>
      linkPlayer([file("core.ts", 'const exported = "export x";\nexported;\n')]),
    ).not.toThrow();
  });

  it("fails on a duplicate top-level name", () => {
    expect(() =>
      linkPlayer([
        file("core.ts", "export function a(): void {}\n"),
        file("main.ts", "var a = 1;\n"),
      ]),
    ).toThrow(/top-level name a is also declared in core.ts/);
    expect(() =>
      linkPlayer([
        file("core.ts", "export const { a, b: c } = { a: 1, b: 2 };\n"),
        file("main.ts", "let c = 1;\n"),
      ]),
    ).toThrow(/top-level name c/);
  });

  it("links the player stubs into a script that parses", () => {
    const linked = linkPlayer(
      PLAYER.map((name) => file(name, readFileSync(join(HERE, "player", name), "utf8"))),
    );
    expect(() => new vm.Script(linked.replace(/^<script>|<\/script>$/g, ""))).not.toThrow();
  });
});

describe("renderPage", () => {
  it("fills each placeholder once", () => {
    const page = renderPage(
      "<p>__SIM_COMMIT__</p>__SIM_DATA__\n__SIM_PLAYER__",
      { scenarios: [], repo: { name: "", files: { "a.md": "__SIM_PLAYER__" } } },
      "<script></script>",
      "0123456789abcdef",
    );
    expect(page).toContain('/commit/0123456789abcdef">0123456</a>');
    expect(page).toContain('"a.md":"__SIM_PLAYER__"');
    expect(page.split("<script></script>")).toHaveLength(2);
  });

  it("fails when a placeholder is missing", () => {
    expect(() =>
      renderPage("__SIM_DATA__ __SIM_PLAYER__", { scenarios: [], repo: REPO }, "", undefined),
    ).toThrow(/__SIM_COMMIT__ once/);
  });
});

import { expect, mock, test } from "claude-code/testing";
import type { Engine } from "claude-code/testing";
import type { On } from "claude-code";

const HOME = "/home/u";
const CLONE = `${HOME}/.my-graft`;
const SETTINGS = `${CLONE}/graft-settings.json`;
const COMMON = `# Shared rules

## Settings

| Key                      | Values            | Default | What it does       |
| ------------------------ | ----------------- | ------- | ------------------ |
| \`plan.outsideRepoPlans\`  | \`always\`          | ask     | Saves plans.       |
| \`orchestrate.deletePlan\` | \`always\`, \`never\` | ask     | Deletes the plan.  |

## Next
`;
const SURFACES = ["terminal", "desktop", "vscode", "mobile"] as const;
const EDITABLE = ["terminal", "desktop", "vscode"] as const;

const RUN = {
  command: "graft-settings",
  args: "",
  origin: { kind: "composer" },
  presentation: { isFullscreen: true, columns: 160 },
} as const;

const PANE = {
  plugin: "graft",
  component: "Pane",
  requestId: "graft-settings",
  props: {
    title: "Graft settings",
    isFocused: false,
    bodyColumns: 80,
    placement: "dock",
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const;

type Answer = { exitCode: number; stdout?: string; stderr?: string } | "reject";

type World = {
  files: Map<string, string>;
  runs: string[][];
  inits: { argv: readonly string[]; timeoutMs?: number; env?: Record<string, string> }[];
  placed: { isPlaced: true } | { isPlaced: false; reason: string };
  toasts: string[];
  git: (
    sub: string,
    answer: Answer | ((argv: readonly string[]) => Promise<Answer> | Answer),
  ) => void;
};

// Stands for the engine beneath the plugin: HOME, a file system in memory,
// and git answering as a clean clone on main that is up to date.
function world(on: On, settings?: string, common = COMMON): World {
  const files = new Map<string, string>();
  files.set("common", common);
  if (settings !== undefined) {
    files.set(SETTINGS, settings);
  }
  const runs: string[][] = [];
  const inits: World["inits"] = [];
  const toasts: string[] = [];
  const answers = new Map<string, (argv: readonly string[]) => Promise<Answer> | Answer>([
    ["rev-parse --show-toplevel", () => ({ exitCode: 0, stdout: `${CLONE}\n` })],
    ["symbolic-ref", () => ({ exitCode: 0, stdout: "main\n" })],
    ["rev-parse -q", () => ({ exitCode: 1 })],
    ["status", () => ({ exitCode: 0, stdout: "" })],
    ["rev-list", () => ({ exitCode: 0, stdout: "0\n" })],
  ]);
  const path = (p: string) => (p.endsWith("/skills/common.md") ? "common" : p);

  mock.env(on, { HOME });
  on("fs.exists", (_, e) => ({ value: files.has(path(e.path)) }));
  on("fs.read", (_, e) => {
    const text = files.get(path(e.path));

    return text === undefined ? { deny: `ENOENT: ${e.path}` } : { value: text };
  });
  on("fs.write", (_, e) => {
    files.set(e.path, e.text);

    return { value: undefined };
  });
  on("fs.stat", (_, e) => ({
    value: { kind: "dir", size: 0, mtimeMs: 0, isLink: false, realPath: e.path },
  }));
  on("process.run", async (_, e) => {
    runs.push([...e.argv]);
    inits.push({ argv: e.argv, ...e.init });
    if (e.argv[0] === "rm") {
      files.delete(e.argv[e.argv.length - 1]!);

      return {
        value: {
          exitCode: 0,
          stdout: "",
          stderr: "",
          isStdoutTruncated: false,
          isStderrTruncated: false,
        },
      };
    }
    const args = e.argv.slice(3);
    const key = [...answers.keys()].find((k) => args.join(" ").startsWith(k));
    const answer = key === undefined ? { exitCode: 0 } : await answers.get(key)!(e.argv);
    if (answer === "reject") {
      return { deny: "timed out" };
    }

    return {
      value: {
        exitCode: answer.exitCode,
        stdout: answer.stdout ?? "",
        stderr: answer.stderr ?? "",
        isStdoutTruncated: false,
        isStderrTruncated: false,
      },
    };
  });
  on("ui.toast", (_, e) => {
    toasts.push(e.text);

    return { value: undefined };
  });
  on("ui.open", () => ({ value: w.placed }));
  on("ui.close", () => ({ value: undefined }));
  on("command.register", () => ({ value: { command: "graft-settings" } }));
  on("session.start", (_, e) => ({ cwd: e.cwd }));

  const w: World = {
    files,
    runs,
    inits,
    placed: { isPlaced: true },
    toasts,
    git: (sub, answer) => answers.set(sub, typeof answer === "function" ? answer : () => answer),
  };

  return w;
}

const gitRuns = (w: World, sub: string) =>
  w.runs.filter((argv) => argv[0] === "git" && argv[3] === sub);

const mountOn = <S extends (typeof SURFACES)[number]>($: Engine, surface: S) =>
  $.ui.mount({ ...PANE, surface });

test("a missing settings file shows every setting as ask, on every surface", async ($, on) => {
  world(on);
  for (const surface of EDITABLE) {
    const ui = await mountOn($, surface);
    const select = await ui.find({ type: "Select", key: "orchestrate.deletePlan" });
    expect(select?.props.value).toBe(":ask");
    expect(await ui.findAll({ type: "Select" })).toHaveLength(2);
    expect(
      await ui.find({ type: "Text", text: /Deletes the plan\. Default: ask\./ }),
    ).toBeDefined();
    await ui.unmount();
  }
});

test("mobile draws the settings as read-only text", async ($, on) => {
  world(on, '{"orchestrate":{"deletePlan":"never"}}');
  const ui = await mountOn($, "mobile");
  expect(await ui.find({ type: "Text", text: /orchestrate\.deletePlan: never/ })).toBeDefined();
  expect(await ui.find({ type: "Text", text: /plan\.outsideRepoPlans: ask/ })).toBeDefined();
  await ui.unmount();
});

test("a partial file shows set keys and leaves the rest at ask", async ($, on) => {
  world(on, '{"plan":{"outsideRepoPlans":"always"}}');
  for (const surface of EDITABLE) {
    const ui = await mountOn($, surface);
    expect((await ui.find({ key: "plan.outsideRepoPlans" }))?.props.value).toBe("always");
    expect((await ui.find({ key: "orchestrate.deletePlan" }))?.props.value).toBe(":ask");
    await ui.unmount();
  }
});

test("a malformed file is shown read-only with its parse error", async ($, on) => {
  const w = world(on, '{"plan":');
  for (const surface of SURFACES) {
    const ui = await mountOn($, surface);
    expect(await ui.find({ type: "Select" })).toBeUndefined();
    expect(
      await ui.find({ type: "Text", text: /graft-settings\.json does not parse/ }),
    ).toBeDefined();
    await ui.unmount();
  }
  expect(w.files.get(SETTINGS)).toBe('{"plan":');
});

test("keys not in the catalog are listed read-only", async ($, on) => {
  world(on, '{"plan":{"outsideRepoPlans":"always","other":1},"extra":"x"}');
  for (const surface of SURFACES) {
    const ui = await mountOn($, surface);
    expect(await ui.find({ type: "Text", text: /plan\.other: 1/ })).toBeDefined();
    expect(await ui.find({ type: "Text", text: /extra: x/ })).toBeDefined();
    expect(await ui.find({ key: "plan.other" })).toBeUndefined();
    await ui.unmount();
  }
});

test("a catalog that does not parse lists the raw keys read-only", async ($, on) => {
  world(
    on,
    '{"plan":{"outsideRepoPlans":"always"}}',
    "# Shared rules\n\n## Settings\n\nNo table.\n",
  );
  for (const surface of SURFACES) {
    const ui = await mountOn($, surface);
    expect(await ui.find({ type: "Select" })).toBeUndefined();
    expect(
      await ui.find({ type: "Text", text: /catalog in common\.md does not parse/ }),
    ).toBeDefined();
    expect(await ui.find({ type: "Text", text: /plan\.outsideRepoPlans: always/ })).toBeDefined();
    await ui.unmount();
  }
});

test("a first save to a missing file creates, adds, commits and pushes it", async ($, on) => {
  const w = world(on);
  const ui = await mountOn($, "terminal");
  await ui.select({ key: "orchestrate.deletePlan", value: "never" });

  expect(JSON.parse(w.files.get(SETTINGS)!)).toEqual({ orchestrate: { deletePlan: "never" } });
  expect(w.runs.filter((argv) => argv[0] === "git").map((argv) => argv[3])).toEqual([
    "rev-parse",
    "symbolic-ref",
    "rev-parse",
    "status",
    "rev-list",
    "pull",
    "add",
    "commit",
    "push",
  ]);
  expect(gitRuns(w, "add")[0]).toEqual(["git", "-C", CLONE, "add", "--", "graft-settings.json"]);
  expect(gitRuns(w, "commit")[0]).toEqual([
    "git",
    "-C",
    CLONE,
    "commit",
    "--only",
    "-m",
    "Set orchestrate.deletePlan to never",
    "--",
    "graft-settings.json",
  ]);
  expect(w.toasts).toEqual([]);
  expect((await ui.find({ key: "orchestrate.deletePlan" }))?.props.value).toBe("never");
  await ui.unmount();
});

test("setting then clearing a key keeps the other keys and drops an emptied skill", async ($, on) => {
  const w = world(on, '{"plan":{"outsideRepoPlans":"always"}}');
  const ui = await mountOn($, "desktop");
  await ui.select({ key: "orchestrate.deletePlan", value: "always" });
  expect(JSON.parse(w.files.get(SETTINGS)!)).toEqual({
    plan: { outsideRepoPlans: "always" },
    orchestrate: { deletePlan: "always" },
  });
  await ui.select({ key: "orchestrate.deletePlan", value: ":ask" });
  expect(JSON.parse(w.files.get(SETTINGS)!)).toEqual({ plan: { outsideRepoPlans: "always" } });
  expect(gitRuns(w, "commit").map((argv) => argv[6])).toEqual([
    "Set orchestrate.deletePlan to always",
    "Clear orchestrate.deletePlan",
  ]);
  expect(gitRuns(w, "push")).toHaveLength(2);
  await ui.unmount();
});

test("a save that changes nothing stops after the re-read", async ($, on) => {
  const w = world(on, '{"plan":{"outsideRepoPlans":"always"}}');
  const ui = await mountOn($, "vscode");
  await ui.select({ key: "plan.outsideRepoPlans", value: "always" });
  expect(gitRuns(w, "pull")).toHaveLength(1);
  expect(gitRuns(w, "add")).toHaveLength(0);
  expect(gitRuns(w, "commit")).toHaveLength(0);
  expect(w.toasts).toEqual([]);
  await ui.unmount();
});

const REFUSALS: [string, string, Answer, RegExp][] = [
  [
    "not the clone",
    "rev-parse --show-toplevel",
    { exitCode: 0, stdout: `${HOME}\n` },
    /not the Graft clone/,
  ],
  [
    "not a repository",
    "rev-parse --show-toplevel",
    { exitCode: 128, stderr: "fatal" },
    /not the Graft clone/,
  ],
  ["not on main", "symbolic-ref", { exitCode: 0, stdout: "feature\n" }, /not on main/],
  [
    "a dirty tree",
    "status",
    { exitCode: 0, stdout: "?? notes.md\n" },
    /changed or untracked files/,
  ],
  ["a merge in progress", "rev-parse -q", { exitCode: 0, stdout: "abc\n" }, /merge in progress/],
  ["unpushed commits", "rev-list", { exitCode: 0, stdout: "2\n" }, /not pushed to origin/],
  [
    "a failed pull",
    "pull",
    { exitCode: 1, stderr: "fatal: Not possible to fast-forward" },
    /pulling origin main failed \(fatal: Not possible to fast-forward\)/,
  ],
  ["a timed-out pull", "pull", "reject", /pulling origin main failed/],
];

for (const [name, sub, answer, toast] of REFUSALS) {
  test(`a save is refused on ${name}`, async ($, on) => {
    const w = world(on, '{"plan":{"outsideRepoPlans":"always"}}');
    w.git(sub, answer);
    const ui = await mountOn($, "terminal");
    await ui.select({ key: "orchestrate.deletePlan", value: "never" });

    expect(w.toasts).toHaveLength(1);
    expect(w.toasts[0]).toMatch(toast);
    expect(w.files.get(SETTINGS)).toBe('{"plan":{"outsideRepoPlans":"always"}}');
    expect(gitRuns(w, "commit")).toHaveLength(0);
    expect((await ui.find({ key: "orchestrate.deletePlan" }))?.props.value).toBe(":ask");
    await ui.unmount();
  });
}

for (const [name, answer] of [
  ["failed", { exitCode: 1, stderr: "Author identity unknown" }],
  ["timed-out", "reject"],
] as const) {
  test(`a ${name} commit restores an existing file`, async ($, on) => {
    const w = world(on, '{"plan":{"outsideRepoPlans":"always"}}');
    w.git("commit", answer);
    const ui = await mountOn($, "terminal");
    await ui.select({ key: "orchestrate.deletePlan", value: "never" });

    expect(w.files.get(SETTINGS)).toBe('{"plan":{"outsideRepoPlans":"always"}}');
    expect(gitRuns(w, "reset")[0]).toEqual([
      "git",
      "-C",
      CLONE,
      "reset",
      "-q",
      "--",
      "graft-settings.json",
    ]);
    expect(gitRuns(w, "push")).toHaveLength(0);
    expect(w.toasts[0]).toMatch(/the commit failed .* was restored/);
    await ui.unmount();
  });

  test(`a ${name} commit deletes a file it created`, async ($, on) => {
    const w = world(on);
    w.git("commit", answer);
    const ui = await mountOn($, "terminal");
    await ui.select({ key: "orchestrate.deletePlan", value: "never" });

    expect(w.files.has(SETTINGS)).toBe(false);
    expect(w.runs).toContainEqual(["rm", "-f", "--", SETTINGS]);
    expect(w.toasts[0]).toMatch(/was restored/);
    await ui.unmount();
  });

  test(`a ${name} push keeps the commit and says what to run`, async ($, on) => {
    const w = world(on);
    w.git("push", answer);
    const ui = await mountOn($, "terminal");
    await ui.select({ key: "orchestrate.deletePlan", value: "never" });

    expect(JSON.parse(w.files.get(SETTINGS)!)).toEqual({ orchestrate: { deletePlan: "never" } });
    expect(gitRuns(w, "commit")).toHaveLength(1);
    expect(w.toasts[0]).toMatch(/committed but not pushed.*git -C ~\/\.my-graft push origin main/);
    await ui.unmount();
  });
}

test("network calls never prompt and every call has a timeout", async ($, on) => {
  const w = world(on);
  const inits = w.inits;
  const ui = await mountOn($, "terminal");
  await ui.select({ key: "orchestrate.deletePlan", value: "never" });

  expect(inits.length).toBeGreaterThan(0);
  for (const init of inits) {
    expect(init.timeoutMs).toBeGreaterThan(0);
    const isNetwork = init.argv[3] === "pull" || init.argv[3] === "push";
    expect(init.env).toEqual(
      isNetwork ? { GIT_TERMINAL_PROMPT: "0", GIT_SSH_COMMAND: "ssh -o BatchMode=yes" } : undefined,
    );
  }
  expect(w.toasts).toEqual([]);
  await ui.unmount();
});

test("the selects give way to text while a save runs", async ($, on) => {
  const clock = mock.clock(on);
  const w = world(on);
  w.git("push", async () => {
    await clock.sleep(1000);

    return { exitCode: 0 };
  });
  const ui = await mountOn($, "terminal");
  const other = await mountOn($, "desktop");
  const first = ui.select({ key: "orchestrate.deletePlan", value: "never" });
  await clock.settle();

  expect(await ui.find({ type: "Select" })).toBeUndefined();
  expect(await other.find({ type: "Select" })).toBeUndefined();
  expect(await other.find({ type: "Text", text: /\(saving\)/ })).toBeDefined();
  await expect(other.select({ key: "plan.outsideRepoPlans", value: "always" })).rejects.toThrow();

  await clock.advance(1000);
  await first;
  expect(gitRuns(w, "commit")).toHaveLength(1);
  expect(await other.findAll({ type: "Select" })).toHaveLength(2);
  await ui.unmount();
  await other.unmount();
});

test("the command opens the pane where a surface draws it", async ($, on) => {
  world(on);
  await $.session.start({ cwd: "/", surface: "terminal", isInteractive: true });

  const ran = await $.command.run(RUN);
  expect(ran.text).toBe("Opened the Graft settings pane.");
});

test("the command replies with the text list where nothing draws", async ($, on) => {
  const w = world(on, '{"orchestrate":{"deletePlan":"always"},"extra":{"key":true}}');
  w.placed = { isPlaced: false, reason: "no-surface: a -p run" };
  await $.session.start({ cwd: "/", surface: null, isInteractive: false });

  const ran = await $.command.run(RUN);
  expect(ran.text).toBe(
    [
      "Graft settings in ~/.my-graft/graft-settings.json",
      "plan.outsideRepoPlans: ask (always, ask)",
      "  Saves plans.",
      "orchestrate.deletePlan: always (always, never, ask)",
      "  Deletes the plan.",
      "Not in the catalog:",
      "extra.key: true",
    ].join("\n"),
  );
});

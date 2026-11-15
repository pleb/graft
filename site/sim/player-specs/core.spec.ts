import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Event, Scenario } from "../events.ts";
import continueScenario from "../fixtures/continue.ts";
import helperScenario from "../fixtures/helper.ts";
import repo from "../fixtures/repo.ts";
import startScenario from "../fixtures/start.ts";
import {
  applyStep,
  chips,
  choose,
  finale,
  createPlayback,
  emptyTerm,
  formatHash,
  parseHash,
  prExcerpt,
  replay,
  roleRows,
  runHistory,
  seek,
  setPlaying,
  setSpeed,
  startPath,
  timeline,
} from "../player/core.ts";
import type {
  Card,
  Clock,
  HistoryItem,
  HistorySkill,
  Playback,
  Run,
  Step,
  View,
} from "../player/core.ts";

const FIXTURES = [startScenario, continueScenario, helperScenario];

const clock: Clock = {
  now: () => Date.now(),
  set: (run, ms) => setTimeout(run, ms),
  clear: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
};

type Recorder = View & { commits: { step: Step; position: number; path: string[] }[] };

// `play` waits `playMs` per step, as the terminal's typing would.
function recorder(playMs = 0): Recorder {
  const commits: Recorder["commits"] = [];
  return {
    commits,
    reset: () => {},
    play: async (_step: Step, run: Run) => {
      if (playMs > 0) await run.wait(playMs);
    },
    commit: (playback, step) =>
      commits.push({ step, position: playback.position, path: playback.path }),
    changed: () => {},
  };
}

function setup(scenarios: Scenario[], playMs = 0): { playback: Playback; view: Recorder } {
  const view = recorder(playMs);
  return { playback: createPlayback({ scenarios, repo }, clock, view, "medium"), view };
}

function scenario(id: string, kind: Scenario["kind"], events: Event[]): Scenario {
  return { id, title: id, kind, settings: {}, events };
}

// s hands off to a or b; both end.
function branching(): Scenario[] {
  return [
    scenario("s", "start", [
      { type: "prompt", text: "/graft:plan x" },
      { type: "say", text: "Planning" },
      {
        type: "handoff",
        text: "Next",
        choices: [
          { command: "/graft:a", next: "a" },
          { command: "/graft:b", next: "b" },
        ],
      },
    ]),
    scenario("a", "continue", [
      { type: "prompt", text: "/graft:a" },
      { type: "say", text: "In a" },
      { type: "end" },
    ]),
    scenario("b", "continue", [
      { type: "prompt", text: "/graft:b" },
      { type: "say", text: "In b" },
      { type: "end" },
    ]),
  ];
}

function texts(playback: Playback): string[] {
  return playback.term.lines.map((line) => ("text" in line ? line.text : line.kind));
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("replay", () => {
  it("equals stepping to N within a fixed path", async () => {
    const { playback, view } = setup(FIXTURES, 50);
    startPath(playback, ["start", "continue"], true);
    await vi.runAllTimersAsync();
    expect(playback.position).toBe(playback.steps.length);
    expect(view.commits).toHaveLength(playback.steps.length);

    let stepped = emptyTerm(repo);
    for (const [index, { step, position }] of view.commits.entries()) {
      stepped = applyStep(stepped, step);
      expect(position).toBe(index + 1);
      expect(replay(playback.steps, position, repo)).toEqual(stepped);
    }
    expect(playback.term).toEqual(stepped);
  });

  it("clears the terminal at a clear hand-off", () => {
    const steps = timeline(new Map(FIXTURES.map((s) => [s.id, s])), ["start", "continue"]);
    const clear = steps.findIndex((step) => step.event.type === "clear");
    expect(steps[clear - 1].event.type).toBe("handoff");
    expect(replay(steps, clear).lines.length).toBeGreaterThan(0);
    expect(replay(steps, clear + 1).lines).toEqual([]);
  });
});

describe("seek", () => {
  it("keeps the walked path", () => {
    const { playback } = setup(FIXTURES);
    startPath(playback, ["start", "continue"], false);
    const steps = playback.steps;
    for (const position of [5, 0, steps.length, 3]) {
      seek(playback, position);
      expect(playback.path).toEqual(["start", "continue"]);
      expect(playback.steps).toEqual(steps);
      expect(playback.position).toBe(position);
      expect(playback.term).toEqual(replay(steps, position, repo));
    }
  });

  it("invalidates a wait in flight", async () => {
    const { playback, view } = setup(FIXTURES, 1000);
    startPath(playback, ["start", "continue"], true);
    await vi.advanceTimersByTimeAsync(500);
    expect(view.commits).toEqual([]);
    seek(playback, 4);
    await vi.advanceTimersByTimeAsync(600);
    expect(view.commits).toEqual([]);
    await vi.advanceTimersByTimeAsync(400);
    expect(view.commits.map((commit) => commit.position)).toEqual([5]);
  });
});

describe("hand-offs", () => {
  it("carries on along a kept hand-off", async () => {
    const { playback, view } = setup(FIXTURES);
    startPath(playback, ["start", "continue"], false);
    const handoff = playback.steps.findIndex((step) => step.event.type === "handoff");
    seek(playback, handoff);
    setPlaying(playback, true);
    await vi.runAllTimersAsync();
    expect(view.commits[0].step.event.type).toBe("handoff");
    expect(view.commits[0].step.chosen).toBe("/graft:pr");
    expect(playback.position).toBe(playback.steps.length);
    expect(playback.term.ended).toBe(true);
    expect(playback.path).toEqual(["start", "continue"]);
  });

  it("waits at a hand-off with no kept choice until one is clicked", async () => {
    const { playback } = setup(branching());
    startPath(playback, ["s"], true);
    await vi.runAllTimersAsync();
    expect(playback.term.handoff).toMatchObject({ at: 0, chosen: undefined });
    choose(playback, 0, "a");
    await vi.runAllTimersAsync();
    expect(playback.path).toEqual(["s", "a"]);
    expect(texts(playback)).toContain("In a");
    expect(playback.term.ended).toBe(true);
  });

  it("holds a kept hand-off while paused", async () => {
    const { playback } = setup(branching());
    startPath(playback, ["s", "a"], true);
    const handoff = playback.steps.findIndex((step) => step.event.type === "handoff");
    while (playback.position <= handoff) await vi.advanceTimersByTimeAsync(10);
    setPlaying(playback, false);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(playback.position).toBe(handoff + 1);
    setPlaying(playback, true);
    await vi.runAllTimersAsync();
    expect(playback.term.ended).toBe(true);
  });

  it("drops the later scenarios' events when the choice changes after rewinding", async () => {
    const { playback } = setup(branching());
    startPath(playback, ["s", "a"], true);
    await vi.runAllTimersAsync();
    expect(texts(playback)).toContain("In a");

    seek(playback, 1);
    choose(playback, 0, "b");
    expect(playback.path).toEqual(["s", "b"]);
    expect(playback.steps.some((step) => step.scenario === "a")).toBe(false);
    await vi.runAllTimersAsync();
    expect(texts(playback)).toContain("In b");
    expect(texts(playback)).not.toContain("In a");
  });

  it("keeps the later path when the kept choice is clicked again", () => {
    const { playback } = setup(branching());
    startPath(playback, ["s", "b"], false);
    const steps = playback.steps;
    seek(playback, 1);
    choose(playback, 0, "b");
    expect(playback.path).toEqual(["s", "b"]);
    expect(playback.steps).toBe(steps);
  });

  it("invalidates the kept hand-off's beat when another choice is clicked", async () => {
    const { playback, view } = setup(branching());
    startPath(playback, ["s", "a"], true);
    const handoff = playback.steps.findIndex((step) => step.event.type === "handoff");
    while (playback.position <= handoff) await vi.advanceTimersByTimeAsync(10);
    choose(playback, 0, "b");
    await vi.runAllTimersAsync();
    const after = view.commits.filter((commit) => commit.position > handoff + 1);
    expect(after.every((commit) => commit.step.scenario === "b")).toBe(true);
    expect(playback.path).toEqual(["s", "b"]);
  });
});

describe("deep links", () => {
  it("replay their path from the start", async () => {
    const { playback, view } = setup(FIXTURES);
    startPath(playback, parseHash("#start/continue", FIXTURES), true);
    await vi.runAllTimersAsync();
    expect(view.commits[0].position).toBe(1);
    expect(playback.path).toEqual(["start", "continue"]);
    expect(texts(playback)).toEqual([
      "/graft:pr",
      "tool",
      "Picked up the plan from the start scenario.",
    ]);
    expect(playback.term.ended).toBe(true);
  });

  it("round-trip through the hash", () => {
    for (const path of [["start"], ["start", "continue"], ["helper"]])
      expect(parseHash(formatHash(path), FIXTURES)).toEqual(path);
    const odd = [scenario("a b/c", "start", [{ type: "end" }])];
    expect(parseHash(formatHash(["a b/c"]), odd)).toEqual(["a b/c"]);
  });

  it("fall back to the plan start when invalid", () => {
    const plan = scenario("plan", "start", [{ type: "end" }]);
    const withPlan = [...FIXTURES, plan];
    for (const hash of [
      "",
      "#",
      "#nope",
      "#continue",
      "#start/helper",
      "#helper/continue",
      "#%E0%A4%A",
    ]) {
      expect(parseHash(hash, withPlan)).toEqual(["plan"]);
      expect(parseHash(hash, FIXTURES)).toEqual(["start"]);
    }
  });

  it("follow only hand-offs on their flattened path", () => {
    const scenarios = branching();
    expect(parseHash("#s/b", scenarios)).toEqual(["s", "b"]);
    const handoff = scenarios[0].events[2];
    scenarios[0].events[2] = { ...handoff, after: ["never"] };
    expect(parseHash("#s/b", scenarios)).toEqual(["s"]);
  });
});

describe("guards", () => {
  it("keep after and notAfter events to their walked paths", () => {
    const scenarios = [
      scenario("one", "start", [
        { type: "prompt", text: "/graft:one" },
        { type: "handoff", text: "Next", choices: [{ command: "/graft:c", next: "c" }] },
      ]),
      scenario("two", "start", [
        { type: "prompt", text: "/graft:two" },
        { type: "handoff", text: "Next", choices: [{ command: "/graft:c", next: "c" }] },
      ]),
      scenario("c", "continue", [
        { type: "prompt", text: "/graft:c" },
        { type: "say", text: "After one", after: ["one"] },
        { type: "say", text: "Not after one", notAfter: ["one"] },
        { type: "end" },
      ]),
    ];
    const byId = new Map(scenarios.map((s) => [s.id, s]));
    const says = (path: string[]) =>
      timeline(byId, path).flatMap(({ event }) => (event.type === "say" ? [event.text] : []));
    expect(says(["one", "c"])).toEqual(["After one"]);
    expect(says(["two", "c"])).toEqual(["Not after one"]);
  });
});

describe("speed", () => {
  it("applies a change in the middle of a wait", async () => {
    const { playback, view } = setup(FIXTURES, 1000);
    startPath(playback, ["start"], true);
    await vi.advanceTimersByTimeAsync(400);
    setSpeed(playback, "fast");
    await vi.advanceTimersByTimeAsync(239);
    expect(view.commits).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(view.commits).toHaveLength(1);
  });

  it("waits twice as long at Slow", async () => {
    const { playback, view } = setup(FIXTURES, 1000);
    setSpeed(playback, "slow");
    startPath(playback, ["start"], true);
    await vi.advanceTimersByTimeAsync(1999);
    expect(view.commits).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(view.commits).toHaveLength(1);
  });

  it("freezes a wait while paused", async () => {
    const { playback, view } = setup(FIXTURES, 1000);
    startPath(playback, ["start"], true);
    await vi.advanceTimersByTimeAsync(600);
    setPlaying(playback, false);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(view.commits).toEqual([]);
    setPlaying(playback, true);
    await vi.advanceTimersByTimeAsync(400);
    expect(view.commits).toHaveLength(1);
  });
});

function stageAt(path: string[], until: (step: Step) => boolean, scenarios = FIXTURES) {
  const steps = timeline(new Map(scenarios.map((s) => [s.id, s])), path);
  const index = steps.findIndex(until);
  return replay(steps, index === -1 ? steps.length : index + 1, repo).stage;
}

function card(cards: Card[], key: string): Card | undefined {
  return cards.find((found) => found.key === key);
}

const PLAN = ".claude/graft/plans/add-rate-limiting.md";

describe("stage cards", () => {
  it("make a file card on create with its status and first lines", () => {
    const stage = stageAt(["start"], (step) => step.event.type === "file.create");
    expect(card(stage.cards, PLAN)).toMatchObject({
      kind: "file",
      status: "draft",
      excerpt: ["# Add rate limiting"],
      anchor: { line: 3, clears: 0 },
    });
  });

  it("update a file card on edits, from the repo's content for a repo file", () => {
    const stage = stageAt(["start"], (step) => step.event.type === "agent.done");
    expect(card(stage.cards, PLAN)).toMatchObject({ status: "finalised" });
    expect(card(stage.cards, "README.md")).toMatchObject({
      kind: "file",
      excerpt: ["A small notes API.", "Set RATE_LIMIT to cap requests."],
    });
    expect(stage.files["README.md"]).toBe(
      "# notes-api\n\nA small notes API.\n\nSet RATE_LIMIT to cap requests.\n",
    );
  });

  it("make agent cards from their from card, stacking parallel ones, and mark them done", () => {
    const running = stageAt(
      ["start"],
      (step) => step.event.type === "file.modify" && step.event.path === "README.md",
    );
    expect(card(running.cards, "w1")).toMatchObject({
      kind: "agent",
      done: false,
      links: [PLAN],
      group: "w1",
    });
    expect(card(running.cards, "w1")?.anchor).toBeUndefined();
    expect(card(running.cards, "w2")).toMatchObject({ done: false, group: "w1" });

    const done = stageAt(["start"], (step) => step.event.type === "git.commit");
    expect(card(done.cards, "w1")).toMatchObject({ done: true, report: "Added the limiter." });
    expect(card(done.cards, "w2")).toMatchObject({ done: true });
  });

  it("start a lone agent from the terminal line that spawned it", () => {
    const scenarios = [
      scenario("s", "start", [
        { type: "prompt", text: "/graft:plan x" },
        { type: "agent.start", id: "a", agent: "researcher", description: "Look" },
        { type: "agent.done", id: "a" },
        { type: "agent.start", id: "b", agent: "reviewer", description: "Check" },
        { type: "end" },
      ]),
    ];
    const stage = stageAt(["s"], () => false, scenarios);
    expect(card(stage.cards, "a")).toMatchObject({ links: [], anchor: { line: 1 }, group: "a" });
    expect(card(stage.cards, "b")).toMatchObject({ anchor: { line: 3 }, group: "b" });
  });

  it("link a commit to its agents and chain commits toward the PR card", () => {
    const scenarios = [
      scenario("s", "start", [
        { type: "prompt", text: "/graft:orchestrate x" },
        { type: "agent.start", id: "w", agent: "worker", description: "One" },
        { type: "agent.done", id: "w" },
        { type: "git.commit", id: "c1", subject: "First", by: ["w"] },
        { type: "git.commit", id: "c2", subject: "Second" },
        {
          type: "pr.open",
          number: 9,
          title: "T",
          branch: "b",
          base: "main",
          draft: true,
          commits: ["c1", "c2"],
          body: "Body",
        },
        { type: "end" },
      ]),
    ];
    const stage = stageAt(["s"], () => false, scenarios);
    expect(card(stage.cards, "commit:c1")).toMatchObject({ links: ["w"], anchor: undefined });
    expect(card(stage.cards, "commit:c2")).toMatchObject({ links: ["commit:c1"] });
    expect(card(stage.cards, "commit:c2")?.anchor).toBeDefined();
    expect(card(stage.cards, "pr:9")).toMatchObject({
      kind: "pr",
      links: ["commit:c2"],
      seeded: false,
      commits: [
        { id: "c1", subject: "First" },
        { id: "c2", subject: "Second" },
      ],
      body: "Body",
    });
  });

  it("open the PR card from the continue scenario, after the start's cards", () => {
    const stage = stageAt(["start", "continue"], () => false);
    expect(stage.cards.map((found) => found.key)).toEqual([
      PLAN,
      "w1",
      "w2",
      "README.md",
      "commit:c1",
      "pr:7",
    ]);
    expect(card(stage.cards, "pr:7")).toMatchObject({
      draft: true,
      links: ["commit:c1"],
      commits: [{ id: "c1", subject: "Add rate limiting" }],
    });
  });

  it("seed a PR card, start an agent from pr:<n> and attach the comment", () => {
    const stage = stageAt(["helper"], () => false);
    expect(card(stage.cards, "pr:42")).toMatchObject({
      kind: "pr",
      seeded: true,
      commits: [{ id: "a1b2c3d", subject: "Add rate limiting" }],
      comments: ["The limiter resets on restart."],
    });
    expect(card(stage.cards, "r1")).toMatchObject({ links: ["pr:42"], anchor: undefined });
  });

  it("re-anchor older cards after /clear", () => {
    const stage = stageAt(["start", "continue"], () => false);
    expect(stage.clears).toBe(1);
    expect(card(stage.cards, PLAN)?.anchor?.clears).toBe(0);
    expect(card(stage.cards, "pr:7")?.anchor).toEqual({ line: 2, clears: 1 });
  });

  it("drop the later scenarios' cards when the hand-off choice changes", async () => {
    const scenarios = branching();
    scenarios[1].events.splice(2, 0, { type: "file.create", path: "a.md", content: "A" });
    scenarios[2].events.splice(2, 0, { type: "file.create", path: "b.md", content: "B" });
    const { playback } = setup(scenarios);
    startPath(playback, ["s", "a"], true);
    await vi.runAllTimersAsync();
    expect(playback.term.stage.cards.map((found) => found.key)).toEqual(["a.md"]);

    seek(playback, 1);
    expect(playback.term.stage.cards).toEqual([]);
    choose(playback, 0, "b");
    await vi.runAllTimersAsync();
    expect(playback.term.stage.cards.map((found) => found.key)).toEqual(["b.md"]);
  });
});

describe("chips", () => {
  // s runs a file, a pair of agents from it, their commits and a lone agent; t follows s.
  function staged(): Scenario[] {
    return [
      scenario("s", "start", [
        { type: "prompt", text: "/graft:orchestrate x" },
        { type: "file.create", path: "plan.md", content: "# Plan" },
        { type: "agent.start", id: "w1", agent: "graft:worker", description: "A", from: "plan.md" },
        { type: "agent.start", id: "w2", agent: "graft:worker", description: "B", from: "plan.md" },
        { type: "agent.done", id: "w1" },
        { type: "agent.done", id: "w2" },
        { type: "git.commit", id: "c1", subject: "A", by: ["w1"] },
        { type: "git.commit", id: "c2", subject: "B", by: ["w2"] },
        { type: "agent.start", id: "r", agent: "graft:reviewer", description: "Review" },
        { type: "agent.done", id: "r" },
        { type: "handoff", text: "Next", choices: [{ command: "/graft:t", next: "t" }] },
      ]),
      scenario("t", "continue", [
        { type: "prompt", text: "/graft:t" },
        {
          type: "agent.start",
          id: "u",
          agent: "graft:worker",
          description: "Use",
          from: "plan.md",
        },
        { type: "end" },
      ]),
    ];
  }

  function chipsAt(path: string[], until: (step: Step) => boolean): string[] {
    return [...chips(stageAt(path, until, staged()))].sort();
  }

  it("keep a finished group full until a card that does not link to it appears", () => {
    expect(chipsAt(["s"], (step) => step.event.type === "agent.done")).toEqual([]);
    const committed = (step: Step) => step.event.type === "git.commit" && step.event.id === "c2";
    expect(chipsAt(["s"], committed)).toEqual([]);
    const reviewing = (step: Step) => step.event.type === "agent.start" && step.event.id === "r";
    expect(chipsAt(["s"], reviewing)).toEqual(["w1", "w2"]);
    expect(chipsAt(["s"], () => false)).toEqual(["w1", "w2"]);
  });

  it("shrink the earlier scenarios' cards, keeping a file the current scenario links to", () => {
    const prompted = (step: Step) => step.event.type === "prompt" && step.scenario === "t";
    expect(chipsAt(["s", "t"], prompted)).toEqual(["plan.md", "r", "w1", "w2"]);
    expect(chipsAt(["s", "t"], () => false)).toEqual(["r", "w1", "w2"]);
    const stage = stageAt(["s", "t"], () => false, staged());
    expect(
      stage.cards
        .filter((found) => found.kind === "commit")
        .every((found) => !chips(stage).has(found.key)),
    ).toBe(true);
  });

  it("are the same after replay as after stepping", () => {
    const steps = timeline(new Map(staged().map((s) => [s.id, s])), ["s", "t"]);
    let stepped = emptyTerm(repo);
    steps.forEach((step, index) => {
      stepped = applyStep(stepped, step);
      expect(chips(replay(steps, index + 1, repo).stage)).toEqual(chips(stepped.stage));
    });
  });

  it("put every commit on one side and balance the other cards", () => {
    const stage = stageAt(["s", "t"], () => false, staged());
    const sides = new Set(
      stage.cards.filter((found) => found.kind === "commit").map((found) => found.side),
    );
    expect(sides.size).toBe(1);
    expect(card(stage.cards, "w2")?.side).toBe(card(stage.cards, "w1")?.side);
    expect(card(stage.cards, "w1")?.side).not.toBe(card(stage.cards, "plan.md")?.side);
  });
});

describe("background agents", () => {
  it("drop finished rows when the next agent starts, keeping running ones", () => {
    const scenarios = [
      scenario("s", "start", [
        { type: "prompt", text: "/graft:plan x" },
        { type: "agent.start", id: "a", agent: "worker", description: "A" },
        { type: "agent.start", id: "b", agent: "worker", description: "B" },
        { type: "agent.done", id: "a" },
        { type: "agent.start", id: "c", agent: "worker", description: "C" },
        { type: "agent.done", id: "b" },
        { type: "agent.done", id: "c" },
        { type: "chapter", id: "next", title: "Next" },
        { type: "end" },
      ]),
    ];
    const steps = timeline(new Map(scenarios.map((s) => [s.id, s])), ["s"]);
    const rows = (position: number) =>
      replay(steps, position, repo).agents.map((row) => `${row.id}${row.done ? "+" : ""}`);
    expect(rows(4)).toEqual(["a+", "b"]);
    expect(rows(5)).toEqual(["b", "c"]);
    expect(rows(7)).toEqual(["b+", "c+"]);
    expect(rows(8)).toEqual([]);
  });
});

describe("role rows", () => {
  // Two workers and a reviewer in parallel, a worker started again in the next chapter, and a
  // reviewer started again after a third chapter and a new prompt.
  const scenarios = [
    scenario("s", "start", [
      { type: "prompt", text: "/graft:plan x" },
      { type: "agent.start", id: "a", agent: "graft:worker", description: "A" },
      { type: "agent.start", id: "b", agent: "worker", description: "B" },
      { type: "agent.start", id: "r", agent: "graft:reviewer", description: "R" },
      { type: "agent.done", id: "b" },
      { type: "chapter", id: "two", title: "Two" },
      { type: "agent.start", id: "c", agent: "graft:worker", description: "C" },
      { type: "agent.done", id: "c" },
      { type: "agent.done", id: "a" },
      { type: "agent.done", id: "r" },
      { type: "chapter", id: "three", title: "Three" },
      { type: "prompt", text: "/graft:plan y" },
      { type: "agent.start", id: "d", agent: "graft:reviewer", description: "D" },
      { type: "agent.done", id: "d" },
      { type: "end" },
    ]),
  ];
  const steps = timeline(new Map(scenarios.map((s) => [s.id, s])), ["s"]);
  const at = (position: number) => replay(steps, position, repo);

  it("group running runs by bare role, newest run first", () => {
    expect(roleRows(at(0))).toEqual([]);
    expect(roleRows(at(4))).toEqual([
      {
        agent: "worker",
        runs: [
          { id: "b", description: "B" },
          { id: "a", description: "A" },
        ],
        again: false,
      },
      { agent: "reviewer", runs: [{ id: "r", description: "R" }], again: false },
    ]);
  });

  it("keep a parallel run running and describe it when its sibling finishes", () => {
    expect(roleRows(at(5))[0]).toEqual({
      agent: "worker",
      runs: [{ id: "a", description: "A" }],
      again: false,
    });
  });

  it("mark a role running again once it finished a run, even in an earlier chapter", () => {
    expect(roleRows(at(7))[0]).toEqual({
      agent: "worker",
      runs: [
        { id: "c", description: "C" },
        { id: "a", description: "A" },
      ],
      again: true,
    });
    expect(roleRows(at(8))[0]).toMatchObject({ runs: [{ id: "a" }], again: false });
    expect(roleRows(at(11))).toEqual([]);
    expect(roleRows(at(13))).toEqual([
      { agent: "reviewer", runs: [{ id: "d", description: "D" }], again: true },
    ]);
  });

  it("tally finished runs by role for the chapter, resetting on chapter and prompt", () => {
    expect(at(5).finished).toEqual([{ agent: "worker", runs: 1 }]);
    expect(at(6).finished).toEqual([]);
    expect(at(10).finished).toEqual([
      { agent: "worker", runs: 2 },
      { agent: "reviewer", runs: 1 },
    ]);
    expect(at(11).finished).toEqual([]);
    expect(at(14).finished).toEqual([{ agent: "reviewer", runs: 1 }]);
    expect(at(10).finishedRoles).toEqual(["worker", "reviewer"]);
    expect(at(14).finishedRoles).toEqual(["worker", "reviewer"]);
  });

  it("are the same after replay as after stepping", () => {
    let stepped = emptyTerm(repo);
    for (const [index, step] of steps.entries()) {
      stepped = applyStep(stepped, step);
      expect(replay(steps, index + 1, repo)).toEqual(stepped);
    }
  });
});

describe("busy", () => {
  it("lasts from the prompt to the turn's end, after its agents finish", () => {
    const scenarios = [
      scenario("s", "start", [
        { type: "prompt", text: "/graft:execute x" },
        { type: "agent.start", id: "w", agent: "graft:worker", description: "Raise the PR" },
        { type: "agent.done", id: "w" },
        {
          type: "pr.open",
          number: 1,
          title: "x",
          branch: "x",
          base: "main",
          draft: true,
          commits: [],
          body: "",
        },
        { type: "say", text: "Done" },
        { type: "end" },
      ]),
    ];
    const steps = timeline(new Map(scenarios.map((s) => [s.id, s])), ["s"]);
    const busy = (position: number) => replay(steps, position, repo).busy;
    expect([0, 1, 2, 3, 4, 5, 6].map(busy)).toEqual([false, true, true, true, true, true, false]);
  });

  it("stops at a hand-off and starts again at the chosen prompt", () => {
    const steps = timeline(new Map(branching().map((s) => [s.id, s])), ["s", "a"]);
    const handoff = steps.findIndex((step) => step.event.type === "handoff");
    expect(replay(steps, handoff).busy).toBe(true);
    expect(replay(steps, handoff + 1).busy).toBe(false);
    expect(replay(steps, handoff + 2).busy).toBe(true);
  });
});

describe("run history", () => {
  const byId = new Map(FIXTURES.map((s) => [s.id, s]));
  const steps = timeline(byId, ["start", "continue"]);
  const items = (skills: HistorySkill[]): HistoryItem[] =>
    skills.flatMap((skill) => skill.chapters.flatMap((chapter) => chapter.items));
  const wires = (skills: HistorySkill[]) =>
    items(skills)
      .filter((item) => item.wire)
      .map((item) => [item.card, item.index]);

  it("groups items by skill, then chapter, in step order", () => {
    const skills = runHistory(byId, steps, steps.length);
    expect(
      skills.map((skill) => ({
        skill: skill.skill,
        at: skill.at,
        index: skill.index,
        chapters: skill.chapters.map((chapter) => ({
          title: chapter.title,
          index: chapter.index,
          kinds: chapter.items.map((item) => `${item.index}:${item.kind}`),
        })),
      })),
    ).toEqual([
      {
        skill: "plan",
        at: 0,
        index: 0,
        chapters: [
          { title: undefined, index: undefined, kinds: ["0:prompt"] },
          { title: "Draft", index: 1, kinds: ["2:say", "3:answers", "4:file", "5:file"] },
          {
            title: "Build",
            index: 6,
            kinds: [
              "7:branch",
              "8:agentStart",
              "9:agentStart",
              "10:file",
              "11:agentDone",
              "12:agentDone",
              "13:commit",
              "14:handoff",
            ],
          },
        ],
      },
      {
        skill: "pr",
        at: 1,
        index: 16,
        chapters: [
          {
            title: undefined,
            index: undefined,
            kinds: ["16:prompt", "17:tool", "18:say", "19:prOpen"],
          },
        ],
      },
    ]);
  });

  it("leaves out captions, the /clear step and the end", () => {
    const shown = new Set(items(runHistory(byId, steps, steps.length)).map((item) => item.index));
    const left = steps
      .map((step, index) => ({ type: step.event.type, index }))
      .filter(({ index }) => !shown.has(index))
      .map(({ type }) => type);
    expect(left).toEqual(["chapter", "chapter", "clear", "end"]);
  });

  it("names the runs of finish and commit items, and the chosen hand-off command", () => {
    const found = items(runHistory(byId, steps, steps.length));
    expect(found.find((item) => item.index === 8)).toMatchObject({
      kind: "agentStart",
      runs: ["w1"],
      card: "w1",
      description: "Limiter middleware",
    });
    expect(found.find((item) => item.index === 12)).toMatchObject({
      kind: "agentDone",
      runs: ["w2"],
      card: "w2",
      agent: "worker",
      description: "Config and env docs",
      report: "Documented RATE_LIMIT.",
    });
    expect(found.find((item) => item.kind === "commit")).toMatchObject({
      runs: ["w1", "w2"],
      card: "commit:c1",
      id: "c1",
    });
    expect(found.find((item) => item.kind === "handoff")).toMatchObject({ chosen: "/graft:pr" });
  });

  it("marks one wire target per anchored card: a file's latest edit and pr.open", () => {
    const skills = runHistory(byId, steps, steps.length);
    expect(wires(skills)).toEqual([
      [PLAN, 5],
      ["README.md", 10],
      ["pr:7", 19],
    ]);
    const stage = replay(steps, steps.length, repo).stage;
    for (const found of stage.cards.filter((each) => each.anchor))
      expect(items(skills).filter((item) => item.wire && item.card === found.key)).toHaveLength(1);
    // Before the edit, the create is the target.
    expect(wires(runHistory(byId, steps, 5))).toEqual([[PLAN, 4]]);
  });

  it("marks a lone agent's start, not its finish, as its wire target", () => {
    const scenarios = [
      scenario("s", "start", [
        { type: "prompt", text: "/graft:plan x" },
        { type: "agent.start", id: "a", agent: "researcher", description: "Look" },
        { type: "agent.done", id: "a" },
        { type: "end" },
      ]),
    ];
    const lone = new Map(scenarios.map((s) => [s.id, s]));
    const walked = timeline(lone, ["s"]);
    expect(wires(runHistory(lone, walked, walked.length))).toEqual([["a", 1]]);
  });

  it("marks review's pr.seed as the PR's wire target, with its own item", () => {
    const walked = timeline(byId, ["helper"]);
    const skills = runHistory(byId, walked, walked.length);
    expect(items(skills).map((item) => item.kind)).toEqual([
      "prompt",
      "prSeed",
      "agentStart",
      "agentDone",
      "prComment",
    ]);
    expect(wires(skills)).toEqual([["pr:42", 1]]);
  });

  it("cuts at the position", () => {
    expect(runHistory(byId, steps, 0)).toEqual([]);
    const found = items(runHistory(byId, steps, 5));
    expect(found.map((item) => item.index)).toEqual([0, 2, 3, 4]);
  });

  it("matches stepping when rebuilt at each position", async () => {
    const { playback, view } = setup(FIXTURES);
    startPath(playback, ["start", "continue"], true);
    await vi.runAllTimersAsync();
    const full = items(runHistory(byId, steps, steps.length));
    const bare = (found: HistoryItem[]) => found.map(({ wire: _wire, ...item }) => item);
    let shown = 0;
    for (const { position } of view.commits) {
      const found = items(runHistory(playback.byId, playback.steps, position));
      expect(found.length - shown).toBeLessThanOrEqual(1);
      shown = found.length;
      expect(bare(found)).toEqual(bare(full.slice(0, found.length)));
    }
    expect(shown).toBe(full.length);
  });
});

describe("finale", () => {
  it("recaps each skill on a PR path", () => {
    const byId = new Map(FIXTURES.map((s) => [s.id, s]));
    const steps = timeline(byId, ["start", "continue"]);
    const result = finale(byId, steps, steps.length, repo);
    expect(result).toMatchObject({ kind: "pr", questions: 1, agents: 2, commits: 1 });
    expect(result.pr?.number).toBe(7);
    expect(result.recap).toEqual([
      {
        skill: "plan",
        text: "Answered 1 question, wrote add-rate-limiting.md, updated README.md, marked add-rate-limiting.md finalised, made branch add-rate-limiting, ran 2 workers and made 1 commit.",
      },
      { skill: "pr", text: "Opened draft PR #7." },
    ]);
  });

  it("names agents by their bare role", () => {
    const scenarios = [
      scenario("s", "start", [
        { type: "prompt", text: "/graft:orchestrate x" },
        { type: "agent.start", id: "a", agent: "graft:worker", description: "A" },
        { type: "agent.start", id: "b", agent: "worker", description: "B" },
        { type: "agent.start", id: "c", agent: "graft:comment-editor", description: "C" },
        { type: "agent.done", id: "a" },
        { type: "agent.done", id: "b" },
        { type: "agent.done", id: "c" },
        { type: "end" },
      ]),
    ];
    const byId = new Map(scenarios.map((s) => [s.id, s]));
    const steps = timeline(byId, ["s"]);
    expect(finale(byId, steps, steps.length, repo).recap[0].text).toBe(
      "Ran 2 workers and 1 comment-editor.",
    );
  });

  it("shows a review on a path ending in pr.comment", () => {
    const byId = new Map(FIXTURES.map((s) => [s.id, s]));
    const steps = timeline(byId, ["helper"]);
    const result = finale(byId, steps, steps.length, repo);
    expect(result.kind).toBe("review");
    expect(result.pr?.comments).toEqual(["The limiter resets on restart."]);
    expect(result.recap).toEqual([
      {
        skill: "review",
        text: "Picked up PR #42, ran 1 reviewer and posted a review on PR #42 with 1 comment.",
      },
    ]);
  });
});

describe("PR excerpt", () => {
  it("shows the first prose paragraph and the Graft line of the continue fixture's PR", () => {
    const byId = new Map(FIXTURES.map((s) => [s.id, s]));
    const steps = timeline(byId, ["start", "continue"]);
    const body = finale(byId, steps, steps.length, repo).pr?.body ?? "";
    expect(prExcerpt(body)).toEqual([
      "Adds a limiter to the API.",
      "Graft: AI has reviewed and adversarially reviewed these changes.",
    ]);
  });

  it("drops a heading that shares a paragraph with prose", () => {
    expect(prExcerpt("## What\nAdds **a** limiter.\n\nGraft: reviewed.")).toEqual([
      "Adds a limiter.",
      "Graft: reviewed.",
    ]);
  });

  it("shows only the prose when there is no Graft line", () => {
    expect(prExcerpt("# Title\n\nAdds a limiter.\n\nMore.")).toEqual(["Adds a limiter."]);
  });

  it("shows the Graft line once when it is the only paragraph", () => {
    expect(prExcerpt("_Graft: reviewed._")).toEqual(["Graft: reviewed."]);
  });
});

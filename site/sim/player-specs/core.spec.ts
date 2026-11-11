import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Event, Scenario } from "../events.ts";
import continueScenario from "../fixtures/continue.ts";
import helperScenario from "../fixtures/helper.ts";
import repo from "../fixtures/repo.ts";
import startScenario from "../fixtures/start.ts";
import {
  applyStep,
  choose,
  createPlayback,
  emptyTerm,
  formatHash,
  parseHash,
  replay,
  seek,
  setPlaying,
  setSpeed,
  startPath,
  timeline,
} from "../player/core.ts";
import type { Clock, Playback, Run, Step, View } from "../player/core.ts";

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

    let stepped = emptyTerm();
    for (const [index, { step, position }] of view.commits.entries()) {
      stepped = applyStep(stepped, step);
      expect(position).toBe(index + 1);
      expect(replay(playback.steps, position)).toEqual(stepped);
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
      expect(playback.term).toEqual(replay(steps, position));
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

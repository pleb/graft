import type { Choice, Event, Question, Repo, Scenario } from "../events.ts";

export type SimData = { scenarios: Scenario[]; repo: Repo };

// `clear` is the player's own step: `/clear` typed between a `clear` hand-off and the chosen command.
export type PlayEvent = Event | { type: "clear" };

export type Step = {
  event: PlayEvent;
  scenario: string;
  // Index of the scenario in the walked path.
  at: number;
  // On a hand-off, the command of the choice the walked path takes next.
  chosen?: string;
};

export type Mark = { index: number; kind: "skill" | "chapter"; label: string };

export type Line =
  | { kind: "prompt"; text: string }
  | { kind: "say"; text: string }
  | { kind: "tool"; name: string; args: string; result?: string }
  | { kind: "answers"; questions: Question[] }
  | { kind: "agent"; agent: string; description: string }
  | { kind: "agentDone"; agent: string; description: string; report?: string }
  | { kind: "chapter"; title: string }
  | { kind: "handoff"; text: string };

export type AgentRow = { id: string; agent: string; description: string; done: boolean };

export type Pending = { at: number; choices: Choice[]; chosen?: string };

export type TermState = {
  lines: Line[];
  agents: AgentRow[];
  caption: string;
  busy: boolean;
  // A hand-off waiting in the input box.
  handoff?: Pending;
  ended: boolean;
};

export type Speed = "slow" | "medium" | "fast";

export const SPEEDS: Record<Speed, number> = { slow: 0.5, medium: 1, fast: 2.5 };

export type Clock = {
  now(): number;
  set(run: () => void, ms: number): unknown;
  clear(timer: unknown): void;
};

// Handed to each animation; `wait` resolves false once the run is stale.
export type Run = {
  wait(ms: number): Promise<boolean>;
  live(): boolean;
};

export type View = {
  // Shows the state at `position` at once.
  reset(playback: Playback): void;
  // Animates `step` up to the point where it is applied.
  play(step: Step, run: Run): Promise<void>;
  // Shows `step` applied.
  commit(playback: Playback, step: Step): void;
  // Playing, speed or position changed.
  changed(playback: Playback): void;
};

type Wait = { remaining: number; since: number; timer?: unknown; resolve(ok: boolean): void };

export type Playback = {
  repo: Repo;
  byId: Map<string, Scenario>;
  path: string[];
  steps: Step[];
  position: number;
  term: TermState;
  playing: boolean;
  speed: Speed;
  generation: number;
  // The generation whose run loop is alive, if any.
  running?: number;
  waits: Set<Wait>;
  clock: Clock;
  view: View;
};

function guarded(event: Event, earlier: string[]): boolean {
  return (
    (event.after ?? []).every((id) => earlier.includes(id)) &&
    !(event.notAfter ?? []).some((id) => earlier.includes(id))
  );
}

export function flattenScenario(scenario: Scenario, earlier: string[]): Event[] {
  return scenario.events.filter((event) => guarded(event, earlier));
}

export function timeline(byId: Map<string, Scenario>, path: string[]): Step[] {
  const steps: Step[] = [];
  path.forEach((id, at) => {
    const scenario = byId.get(id);
    if (!scenario) return;
    for (const event of flattenScenario(scenario, path.slice(0, at))) {
      if (event.type !== "handoff") {
        steps.push({ event, scenario: id, at });
        continue;
      }
      const chosen = event.choices.find((choice) => choice.next === path[at + 1])?.command;
      steps.push({ event, scenario: id, at, chosen });
      if (chosen !== undefined && event.clear)
        steps.push({ event: { type: "clear" }, scenario: id, at });
    }
  });
  return steps;
}

// The skill a scenario runs, from its first `/graft:<skill>` prompt.
export function skillName(scenario: Scenario): string {
  for (const event of scenario.events) {
    if (event.type !== "prompt") continue;
    const match = event.text.match(/^\/graft:([\w-]+)/);
    if (match) return match[1];
  }
  return scenario.id;
}

export function marks(byId: Map<string, Scenario>, steps: Step[]): Mark[] {
  const found: Mark[] = [];
  steps.forEach((step, index) => {
    if (index === 0 || steps[index - 1].at !== step.at) {
      const scenario = byId.get(step.scenario);
      found.push({ index, kind: "skill", label: scenario ? skillName(scenario) : step.scenario });
    }
    if (step.event.type === "chapter")
      found.push({ index, kind: "chapter", label: step.event.title });
  });
  return found;
}

export function emptyTerm(): TermState {
  return { lines: [], agents: [], caption: "", busy: false, ended: false };
}

// Returns a new state; unchanged lines keep their identity.
export function applyStep(term: TermState, step: Step): TermState {
  const event = step.event;
  const next: TermState = { ...term, handoff: undefined };
  const add = (line: Line): void => {
    next.lines = [...term.lines, line];
  };
  switch (event.type) {
    case "prompt":
      add({ kind: "prompt", text: event.text });
      next.agents = [];
      next.busy = true;
      break;
    case "clear":
      next.lines = [];
      next.agents = [];
      next.busy = false;
      break;
    case "chapter":
      add({ kind: "chapter", title: event.title });
      break;
    case "caption":
      next.caption = event.text;
      break;
    case "say":
      add({ kind: "say", text: event.text });
      break;
    case "tool":
      add({ kind: "tool", name: event.name, args: event.args, result: event.result });
      break;
    case "ask":
      add({ kind: "answers", questions: event.questions });
      break;
    case "agent.start":
      add({ kind: "agent", agent: event.agent, description: event.description });
      next.agents = [
        ...term.agents,
        { id: event.id, agent: event.agent, description: event.description, done: false },
      ];
      break;
    case "agent.done": {
      const row = term.agents.find((agent) => agent.id === event.id);
      add({
        kind: "agentDone",
        agent: row?.agent ?? event.id,
        description: row?.description ?? "",
        report: event.report,
      });
      next.agents = term.agents.map((agent) =>
        agent.id === event.id ? { ...agent, done: true } : agent,
      );
      break;
    }
    case "handoff":
      add({ kind: "handoff", text: event.text });
      next.handoff = { at: step.at, choices: event.choices, chosen: step.chosen };
      next.busy = false;
      break;
    case "end":
      next.busy = false;
      next.ended = true;
      break;
  }
  return next;
}

export function replay(steps: Step[], position: number): TermState {
  let term = emptyTerm();
  for (const step of steps.slice(0, position)) term = applyStep(term, step);
  return term;
}

// Base dwell after a step is applied, in milliseconds at Medium.
export function dwell(step: Step): number {
  const event = step.event;
  switch (event.type) {
    case "prompt":
      return 600;
    case "say":
    case "caption":
      return Math.min(3000, 700 + event.text.length * 18);
    case "tool":
      return 700;
    case "ask":
      return 800;
    case "agent.start":
      return 500;
    case "agent.done":
      return 700;
    case "chapter":
      return 400;
    case "handoff":
      return step.chosen === undefined ? 0 : 1500;
    case "clear":
      return 400;
    case "end":
      return 0;
    default:
      return 700;
  }
}

export function defaultPath(scenarios: Scenario[]): string[] {
  const plan = scenarios.find((scenario) => scenario.id === "plan" && scenario.kind === "start");
  const first = plan ?? scenarios.find((scenario) => scenario.kind === "start");
  return first ? [first.id] : [];
}

export function validPath(byId: Map<string, Scenario>, path: string[]): boolean {
  if (path.length === 0) return false;
  const first = byId.get(path[0]);
  if (!first || first.kind === "continue") return false;
  for (let at = 1; at < path.length; at++) {
    const previous = byId.get(path[at - 1])!;
    const handoff = flattenScenario(previous, path.slice(0, at - 1)).at(-1);
    if (handoff?.type !== "handoff") return false;
    if (!handoff.choices.some((choice) => choice.next === path[at] && byId.has(choice.next)))
      return false;
  }
  return true;
}

export function formatHash(path: string[]): string {
  return `#${path.map(encodeURIComponent).join("/")}`;
}

export function parseHash(hash: string, scenarios: Scenario[]): string[] {
  const byId = new Map(scenarios.map((scenario) => [scenario.id, scenario]));
  const text = hash.replace(/^#/, "");
  let path: string[] = [];
  try {
    path = text === "" ? [] : text.split("/").map(decodeURIComponent);
  } catch {
    path = [];
  }
  return validPath(byId, path) ? path : defaultPath(scenarios);
}

export function createPlayback(data: SimData, clock: Clock, view: View, speed: Speed): Playback {
  return {
    repo: data.repo,
    byId: new Map(data.scenarios.map((scenario) => [scenario.id, scenario])),
    path: [],
    steps: [],
    position: 0,
    term: emptyTerm(),
    playing: false,
    speed,
    generation: 0,
    waits: new Set(),
    clock,
    view,
  };
}

function schedule(playback: Playback, wait: Wait): void {
  if (!playback.playing) return;
  wait.since = playback.clock.now();
  wait.timer = playback.clock.set(() => {
    playback.waits.delete(wait);
    wait.resolve(true);
  }, wait.remaining / SPEEDS[playback.speed]);
}

function suspend(playback: Playback, wait: Wait): void {
  if (wait.timer === undefined) return;
  playback.clock.clear(wait.timer);
  wait.timer = undefined;
  const spent = (playback.clock.now() - wait.since) * SPEEDS[playback.speed];
  wait.remaining = Math.max(0, wait.remaining - spent);
}

// Waits `ms` at Medium, scaled by the speed as it changes, frozen while paused.
function wait(playback: Playback, generation: number, ms: number): Promise<boolean> {
  if (generation !== playback.generation) return Promise.resolve(false);
  return new Promise((resolve) => {
    const entry: Wait = { remaining: ms, since: 0, resolve };
    playback.waits.add(entry);
    schedule(playback, entry);
  });
}

function invalidate(playback: Playback): void {
  playback.generation++;
  for (const entry of playback.waits) {
    if (entry.timer !== undefined) playback.clock.clear(entry.timer);
    entry.resolve(false);
  }
  playback.waits.clear();
}

export function setSpeed(playback: Playback, speed: Speed): void {
  for (const entry of playback.waits) suspend(playback, entry);
  playback.speed = speed;
  for (const entry of playback.waits) schedule(playback, entry);
  playback.view.changed(playback);
}

export function finished(playback: Playback): boolean {
  return playback.term.ended;
}

export function awaitingChoice(playback: Playback): boolean {
  return playback.term.handoff !== undefined && playback.term.handoff.chosen === undefined;
}

export function setPlaying(playback: Playback, playing: boolean): void {
  if (playing && finished(playback)) {
    restart(playback);
    return;
  }
  for (const entry of playback.waits) suspend(playback, entry);
  playback.playing = playing;
  for (const entry of playback.waits) schedule(playback, entry);
  if (playing && playback.running !== playback.generation) void loop(playback);
  playback.view.changed(playback);
}

async function loop(playback: Playback): Promise<void> {
  const generation = playback.generation;
  playback.running = generation;
  const run: Run = {
    wait: (ms) => wait(playback, generation, ms),
    live: () => generation === playback.generation,
  };
  while (await run.wait(0)) {
    if (playback.position >= playback.steps.length) break;
    const step = playback.steps[playback.position];
    await playback.view.play(step, run);
    if (!run.live()) return;
    playback.term = applyStep(playback.term, step);
    playback.position++;
    playback.view.commit(playback, step);
    playback.view.changed(playback);
    if (playback.term.ended) {
      playback.playing = false;
      playback.view.changed(playback);
      break;
    }
    if (awaitingChoice(playback)) break;
    if (!(await run.wait(dwell(step)))) return;
  }
  if (playback.running === generation) playback.running = undefined;
}

// Rebuilds the state at `position` and, when playing, plays on from there.
function jump(playback: Playback, position: number): void {
  invalidate(playback);
  playback.position = Math.max(0, Math.min(position, playback.steps.length));
  playback.term = replay(playback.steps, playback.position);
  playback.running = undefined;
  playback.view.reset(playback);
  playback.view.changed(playback);
  if (playback.playing) void loop(playback);
}

export function seek(playback: Playback, position: number): void {
  jump(playback, position);
}

export function restart(playback: Playback): void {
  playback.playing = true;
  jump(playback, 0);
}

export function startPath(playback: Playback, path: string[], play: boolean): void {
  playback.path = path;
  playback.steps = timeline(playback.byId, path);
  playback.playing = play;
  jump(playback, 0);
}

// A choice at the hand-off of the scenario at path index `at`.
export function choose(playback: Playback, at: number, next: string): void {
  if (playback.path[at + 1] !== next) {
    playback.path = [...playback.path.slice(0, at + 1), next];
    playback.steps = timeline(playback.byId, playback.path);
  }
  const handoff = playback.steps.findIndex(
    (step) => step.at === at && step.event.type === "handoff",
  );
  if (handoff === -1) return;
  playback.playing = true;
  jump(playback, handoff + 1);
}

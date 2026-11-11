import type { Choice, Edit, Event, Question, Repo, Scenario, SeedCommit } from "../events.ts";

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

// A terminal line by index; `clears` counts the `/clear`s before it, so an older one is gone.
export type Anchor = { line: number; clears: number };

// `key` is a file path, an agent id, `commit:<id>` or `pr:<number>`; `links` name other cards.
export type Card = { key: string; anchor?: Anchor; links: string[] } & (
  | { kind: "file"; path: string; status?: string; excerpt: string[] }
  | {
      kind: "agent";
      agent: string;
      description: string;
      done: boolean;
      report?: string;
      // The key of the first agent of the parallel group it runs in.
      group: string;
    }
  | { kind: "commit"; id: string; subject: string }
  | {
      kind: "pr";
      number: number;
      title: string;
      branch: string;
      base: string;
      draft: boolean;
      commits: SeedCommit[];
      body?: string;
      comments: string[];
      seeded: boolean;
    }
);

export type StageState = {
  // In the order they appeared.
  cards: Card[];
  files: Record<string, string>;
  clears: number;
  lastAgent?: string;
  lastCommit?: string;
};

export type TermState = {
  lines: Line[];
  agents: AgentRow[];
  caption: string;
  busy: boolean;
  // A hand-off waiting in the input box.
  handoff?: Pending;
  ended: boolean;
  stage: StageState;
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

export function emptyTerm(repo?: Repo): TermState {
  return {
    lines: [],
    agents: [],
    caption: "",
    busy: false,
    ended: false,
    stage: { cards: [], files: { ...repo?.files }, clears: 0 },
  };
}

export function applyEdits(text: string, edits: Edit[]): string {
  return edits.reduce((result, edit) => result.replace(edit.find, () => edit.replace), text);
}

const EXCERPT = 4;

function splitFrontMatter(content: string): { status?: string; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) return { body: content };
  const status = match[1].match(/^status:\s*(.+)$/m)?.[1].trim();
  return { status, body: content.slice(match[0].length) };
}

// The lines of the last edit that land in the body, or else the body's first lines.
function excerpt(body: string, edits: Edit[]): string[] {
  const lines = body.split("\n");
  for (const edit of [...edits].reverse()) {
    const first = edit.replace.split("\n").find((line) => line.trim() !== "");
    const at = first === undefined ? -1 : lines.findIndex((line) => line.includes(first));
    if (at !== -1) return lines.slice(at, at + EXCERPT).filter((line) => line.trim() !== "");
  }
  return lines.filter((line) => line.trim() !== "").slice(0, EXCERPT);
}

function fileCard(path: string, content: string, edits: Edit[], anchor: Anchor): Card {
  const { status, body } = splitFrontMatter(content);
  return {
    key: path,
    anchor,
    links: [],
    kind: "file",
    path,
    status,
    excerpt: excerpt(body, edits),
  };
}

function putCard(stage: StageState, card: Card): Card[] {
  const at = stage.cards.findIndex((existing) => existing.key === card.key);
  if (at === -1) return [...stage.cards, card];
  return stage.cards.map((existing, index) => (index === at ? card : existing));
}

function findCard(stage: StageState, key: string): Card | undefined {
  return stage.cards.find((card) => card.key === key);
}

// Cards, links and file contents after `event`; `anchor` is the terminal line it shows on.
export function applyStage(stage: StageState, event: PlayEvent, anchor: Anchor): StageState {
  switch (event.type) {
    case "clear":
      return { ...stage, clears: stage.clears + 1 };
    case "file.create":
    case "file.modify": {
      const edits = event.type === "file.modify" ? event.edits : [];
      const content =
        event.type === "file.create"
          ? event.content
          : applyEdits(stage.files[event.path] ?? "", event.edits);
      const files = { ...stage.files, [event.path]: content };
      return {
        ...stage,
        files,
        cards: putCard(stage, fileCard(event.path, content, edits, anchor)),
      };
    }
    case "agent.start": {
      const from = event.from !== undefined && findCard(stage, event.from) ? event.from : undefined;
      const last = stage.lastAgent === undefined ? undefined : findCard(stage, stage.lastAgent);
      const parallel = last?.kind === "agent" && !last.done && last.links[0] === from;
      const card: Card = {
        key: event.id,
        anchor: from === undefined ? anchor : undefined,
        links: from === undefined ? [] : [from],
        kind: "agent",
        agent: event.agent,
        description: event.description,
        done: false,
        group: parallel ? last.group : event.id,
      };
      return { ...stage, cards: putCard(stage, card), lastAgent: event.id };
    }
    case "agent.done": {
      const card = findCard(stage, event.id);
      if (card?.kind !== "agent") return stage;
      return { ...stage, cards: putCard(stage, { ...card, done: true, report: event.report }) };
    }
    case "git.commit": {
      const by = (event.by ?? []).filter((id) => findCard(stage, id));
      const previous = stage.lastCommit === undefined ? [] : [stage.lastCommit];
      const links = [...by, ...previous];
      const card: Card = {
        key: `commit:${event.id}`,
        anchor: by.length === 0 ? anchor : undefined,
        links,
        kind: "commit",
        id: event.id,
        subject: event.subject,
      };
      return { ...stage, cards: putCard(stage, card), lastCommit: card.key };
    }
    case "pr.seed":
    case "pr.open": {
      const seeded = event.type === "pr.seed";
      const commits: SeedCommit[] = seeded
        ? event.commits
        : event.commits.flatMap((id) => {
            const card = findCard(stage, `commit:${id}`);
            return card?.kind === "commit" ? [{ id, subject: card.subject }] : [];
          });
      const last = seeded ? undefined : commits.at(-1);
      const card: Card = {
        key: `pr:${event.number}`,
        anchor,
        links: last === undefined ? [] : [`commit:${last.id}`],
        kind: "pr",
        number: event.number,
        title: event.title,
        branch: event.branch,
        base: event.base,
        draft: event.draft,
        commits,
        body: seeded ? undefined : event.body,
        comments: [],
        seeded,
      };
      return { ...stage, cards: putCard(stage, card) };
    }
    case "pr.comment": {
      const card = findCard(stage, `pr:${event.number}`);
      if (card?.kind !== "pr") return stage;
      const comments = [...card.comments, event.text];
      return { ...stage, cards: putCard(stage, { ...card, comments }) };
    }
    default:
      return stage;
  }
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
  next.stage = applyStage(term.stage, event, {
    line: next.lines.length - 1,
    clears: term.stage.clears,
  });
  return next;
}

export function replay(steps: Step[], position: number, repo?: Repo): TermState {
  let term = emptyTerm(repo);
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
    term: emptyTerm(data.repo),
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
  playback.term = replay(playback.steps, playback.position, playback.repo);
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

export type RecapLine = { skill: string; text: string };

export type Finale = {
  kind: "pr" | "review";
  pr?: Extract<Card, { kind: "pr" }>;
  recap: RecapLine[];
  questions: number;
  agents: number;
  commits: number;
};

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function listed(parts: string[]): string {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}

export function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

type Tally = {
  branch?: string;
  wrote: string[];
  updated: string[];
  marked: string[];
  questions: number;
  roles: Map<string, number>;
  commits: number;
  opened?: string;
  seeded?: string;
  comments: Map<number, number>;
};

function sentence(tally: Tally): string {
  const parts: string[] = [];
  if (tally.seeded) parts.push(tally.seeded);
  if (tally.questions > 0) parts.push(`answered ${plural(tally.questions, "question")}`);
  if (tally.wrote.length > 0) parts.push(`wrote ${listed(tally.wrote.map(basename))}`);
  const updated = tally.updated.filter((path) => !tally.wrote.includes(path));
  if (updated.length > 2) parts.push(`updated ${plural(updated.length, "file")}`);
  else if (updated.length > 0) parts.push(`updated ${listed(updated.map(basename))}`);
  for (const marked of tally.marked) parts.push(marked);
  if (tally.branch) parts.push(`made branch ${tally.branch}`);
  if (tally.roles.size > 0)
    parts.push(`ran ${listed([...tally.roles].map(([role, count]) => plural(count, role)))}`);
  if (tally.commits > 0) parts.push(`made ${plural(tally.commits, "commit")}`);
  if (tally.opened) parts.push(tally.opened);
  for (const [number, count] of tally.comments)
    parts.push(`posted a review on PR #${number} with ${plural(count, "comment")}`);
  const text = listed(parts) || "handed off";
  return `${text[0].toUpperCase()}${text.slice(1)}.`;
}

// The PR and recap a path's `end` shows, from the steps before `position`.
export function finale(
  byId: Map<string, Scenario>,
  steps: Step[],
  position: number,
  repo?: Repo,
): Finale {
  const tallies: { scenario: string; tally: Tally }[] = [];
  let term = emptyTerm(repo);
  let kind: Finale["kind"] = "pr";
  let number: number | undefined;
  let questions = 0;
  let agents = 0;
  let commits = 0;
  for (const step of steps.slice(0, position)) {
    const before = term.stage;
    term = applyStep(term, step);
    if (tallies.length <= step.at)
      tallies.push({
        scenario: step.scenario,
        tally: {
          wrote: [],
          updated: [],
          marked: [],
          questions: 0,
          roles: new Map(),
          commits: 0,
          comments: new Map(),
        },
      });
    const tally = tallies.at(-1)!.tally;
    const event = step.event;
    switch (event.type) {
      case "ask":
        tally.questions += event.questions.length;
        questions += event.questions.length;
        break;
      case "agent.start":
        tally.roles.set(event.agent, (tally.roles.get(event.agent) ?? 0) + 1);
        agents++;
        break;
      case "git.branch":
        tally.branch = event.name;
        break;
      case "git.commit":
        tally.commits++;
        commits++;
        break;
      case "file.create":
        tally.wrote.push(event.path);
        break;
      case "file.modify": {
        if (!tally.updated.includes(event.path)) tally.updated.push(event.path);
        const was = findCard(before, event.path);
        const now = findCard(term.stage, event.path);
        if (
          now?.kind === "file" &&
          now.status &&
          (was?.kind !== "file" || was.status !== now.status)
        )
          tally.marked.push(`marked ${basename(event.path)} ${now.status}`);
        break;
      }
      case "pr.seed":
        tally.seeded = `picked up PR #${event.number}`;
        break;
      case "pr.open":
        tally.opened = `opened ${event.draft ? "draft " : ""}PR #${event.number}`;
        kind = "pr";
        number = event.number;
        break;
      case "pr.comment":
        tally.comments.set(event.number, (tally.comments.get(event.number) ?? 0) + 1);
        kind = "review";
        number = event.number;
        break;
    }
  }
  const pr = number === undefined ? undefined : findCard(term.stage, `pr:${number}`);
  return {
    kind,
    pr: pr?.kind === "pr" ? pr : undefined,
    recap: tallies.map(({ scenario, tally }) => {
      const found = byId.get(scenario);
      return { skill: found ? skillName(found) : scenario, text: sentence(tally) };
    }),
    questions,
    agents,
    commits,
  };
}

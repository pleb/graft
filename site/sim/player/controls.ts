import type { Scenario } from "../events.ts";
import { awaitingChoice, finished, marks, skillName, SPEEDS } from "./core.ts";
import type { Playback, Speed } from "./core.ts";
import { element } from "./terminal.ts";

export type ControlHandlers = {
  start(id: string): void;
  speed(speed: Speed): void;
  toggle(): void;
  restart(): void;
  seek(position: number): void;
};

type ControlsDom = {
  starts: HTMLButtonElement[];
  speeds: HTMLButtonElement[];
  play: HTMLButtonElement;
  trail: HTMLElement;
  scrubber: HTMLInputElement;
  ticks: HTMLElement;
  // The path the trail and ticks were drawn for.
  drawn?: string[];
  handlers: ControlHandlers;
};

let controlsDom: ControlsDom | undefined;

const SPEED_KEY = "graft-sim-speed";
const LABELS: Record<string, string> = {
  research: "Research",
  plan: "Plan",
  execute: "Execute",
  review: "Review",
};
const SPEED_LABELS: Record<Speed, string> = { slow: "Slow", medium: "Medium", fast: "Fast" };

export function loadSpeed(): Speed {
  try {
    const saved = localStorage.getItem(SPEED_KEY);
    if (saved !== null && saved in SPEEDS) return saved as Speed;
  } catch {}
  return "medium";
}

export function saveSpeed(speed: Speed): void {
  try {
    localStorage.setItem(SPEED_KEY, speed);
  } catch {}
}

function button(className: string, text: string, onClick: () => void): HTMLButtonElement {
  const node = element("button", className, text) as HTMLButtonElement;
  node.type = "button";
  node.addEventListener("click", onClick);
  return node;
}

function group(label: string, className: string, children: HTMLElement[]): HTMLElement {
  const node = element("div", `ctl-group ${className}`);
  node.setAttribute("role", "group");
  node.setAttribute("aria-label", label);
  node.append(element("span", "ctl-label", label), ...children);
  return node;
}

// The known starts in their order, then any others by title.
function ordered(scenarios: Scenario[], kind: Scenario["kind"]): Scenario[] {
  const known = Object.keys(LABELS);
  const rank = (scenario: Scenario): number => {
    const at = known.indexOf(scenario.id);
    return at === -1 ? known.length : at;
  };
  return scenarios.filter((scenario) => scenario.kind === kind).sort((a, b) => rank(a) - rank(b));
}

function editable(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT|BUTTON|A)$/.test(target.tagName))
  );
}

export function initControls(
  root: HTMLElement,
  scenarios: Scenario[],
  speed: Speed,
  handlers: ControlHandlers,
): void {
  const startButton = (scenario: Scenario, className: string): HTMLButtonElement => {
    const node = button(className, LABELS[scenario.id] ?? scenario.title, () =>
      handlers.start(scenario.id),
    );
    node.dataset.id = scenario.id;
    return node;
  };
  const primary = ordered(scenarios, "start").map((s) => startButton(s, "ctl-start"));
  const helpers = ordered(scenarios, "helper").map((s) => startButton(s, "ctl-helper"));
  const speeds = (Object.keys(SPEED_LABELS) as Speed[]).map((value) => {
    const node = button("ctl-speed", SPEED_LABELS[value], () => handlers.speed(value));
    node.dataset.speed = value;
    node.setAttribute("aria-pressed", String(value === speed));
    return node;
  });
  const play = button("ctl-play", "", () => handlers.toggle());
  const restart = button("ctl-restart", "↺ Restart", () => handlers.restart());

  const top = element("div", "ctl-row");
  if (primary.length > 0) top.append(group("Start here", "ctl-starts", primary));
  if (helpers.length > 0) top.append(group("Helper", "ctl-helpers", helpers));
  const playback = element("div", "ctl-playback");
  playback.append(play, restart, group("Speed", "ctl-speeds", speeds));
  top.append(playback);

  const trail = element("ol", "ctl-trail");
  trail.setAttribute("aria-label", "Skills walked");
  const scrubber = element("input", "ctl-scrubber") as HTMLInputElement;
  scrubber.type = "range";
  scrubber.min = "0";
  scrubber.step = "1";
  scrubber.setAttribute("aria-label", "Position in the walked path");
  scrubber.addEventListener("input", () => handlers.seek(Number(scrubber.value)));
  const ticks = element("div", "ctl-ticks");
  ticks.setAttribute("aria-hidden", "true");
  const scrub = element("div", "ctl-scrub");
  scrub.append(scrubber, ticks);
  const progress = element("div", "ctl-row ctl-progress");
  progress.append(trail, scrub);

  root.replaceChildren(top, progress);
  controlsDom = {
    starts: [...primary, ...helpers],
    speeds,
    play,
    trail,
    scrubber,
    ticks,
    handlers,
  };

  document.addEventListener("keydown", (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.defaultPrevented) return;
    if (editable(event.target)) return;
    const position = Number(scrubber.value);
    if (event.key === " ") handlers.toggle();
    else if (event.key === "ArrowLeft") handlers.seek(position - 1);
    else if (event.key === "ArrowRight") handlers.seek(position + 1);
    else return;
    event.preventDefault();
  });
}

function drawPath(dom: ControlsDom, playback: Playback): void {
  dom.drawn = playback.path;
  const found = marks(playback.byId, playback.steps);
  const total = Math.max(1, playback.steps.length);
  dom.trail.replaceChildren(
    ...found
      .filter((mark) => mark.kind === "skill")
      .map((mark) => {
        const item = element("li", "ctl-trail-item");
        item.append(button("ctl-trail-skill", mark.label, () => dom.handlers.seek(mark.index)));
        return item;
      }),
  );
  dom.ticks.replaceChildren(
    ...found.map((mark) => {
      const tick = element("span", `ctl-tick ctl-tick-${mark.kind}`);
      tick.style.left = `${(mark.index / total) * 100}%`;
      tick.title = mark.label;
      return tick;
    }),
  );
  dom.scrubber.max = String(playback.steps.length);
}

function stepLabel(playback: Playback): string {
  const step = playback.steps[Math.max(0, playback.position - 1)];
  const scenario = step && playback.byId.get(step.scenario);
  const skill = scenario ? skillName(scenario) : "";
  return `Step ${playback.position} of ${playback.steps.length}${skill ? `, ${skill}` : ""}`;
}

export function renderControls(playback: Playback): void {
  const dom = controlsDom;
  if (!dom) return;
  if (dom.drawn !== playback.path) drawPath(dom, playback);
  for (const node of dom.starts)
    node.setAttribute("aria-pressed", String(node.dataset.id === playback.path[0]));
  for (const node of dom.speeds)
    node.setAttribute("aria-pressed", String(node.dataset.speed === playback.speed));
  const playing = playback.playing && !finished(playback);
  dom.play.textContent = playing ? "❚❚ Pause" : finished(playback) ? "▶ Replay" : "▶ Play";
  dom.play.disabled = awaitingChoice(playback);
  dom.scrubber.value = String(playback.position);
  dom.scrubber.setAttribute("aria-valuetext", stepLabel(playback));
  const current = playback.steps[Math.max(0, playback.position - 1)]?.at ?? 0;
  [...dom.trail.children].forEach((item, index) => {
    if (index === current) item.setAttribute("aria-current", "step");
    else item.removeAttribute("aria-current");
  });
}

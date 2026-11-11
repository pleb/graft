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
// The known entry points in their order, each with when to start there.
const HINTS: Record<string, string> = {
  research: "Question still open? Get the facts first.",
  plan: "Know what you want? Plan it, then build.",
  execute: "Small, clear task? Plan and build in one go.",
};
// The known helpers in their order, each with the question its link answers.
const HELPER_LEADS: Record<string, string> = {
  review: "Have a PR already?",
};
const SPEED_LABELS: Record<Speed, string> = { slow: "Slow", medium: "Medium", fast: "Fast" };
const SVG_NS = "http://www.w3.org/2000/svg";
type Shape = [tag: string, attributes: Record<string, string>];
// A turtle for slow and a rabbit for fast, as filled shapes on a 24 by 24 grid.
const SPEED_ICONS: Partial<Record<Speed, Shape[]>> = {
  slow: [
    ["path", { d: "M2 17.5a8.5 8.5 0 0 1 17 0z" }],
    ["circle", { cx: "20", cy: "13", r: "2.7" }],
    ["rect", { x: "3.8", y: "16", width: "3.4", height: "4.5", rx: "1.4" }],
    ["rect", { x: "13.6", y: "16", width: "3.4", height: "4.5", rx: "1.4" }],
  ],
  fast: [
    ["ellipse", { cx: "10", cy: "16", rx: "7", ry: "5" }],
    ["circle", { cx: "17", cy: "11.5", r: "3.6" }],
    ["ellipse", { cx: "15.2", cy: "5.4", rx: "1.4", ry: "4", transform: "rotate(-14 15.2 5.4)" }],
    ["ellipse", { cx: "18.6", cy: "5.6", rx: "1.4", ry: "4", transform: "rotate(14 18.6 5.6)" }],
    ["circle", { cx: "2.8", cy: "14.6", r: "1.8" }],
    ["rect", { x: "13", y: "18.5", width: "6", height: "2.5", rx: "1.25" }],
  ],
};

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
  const node = element("div", className);
  node.setAttribute("role", "group");
  node.setAttribute("aria-label", label);
  node.append(...children);
  return node;
}

// The known scenarios in their order, then any others.
function ordered(scenarios: Scenario[], kind: Scenario["kind"], known: string[]): Scenario[] {
  const rank = (scenario: Scenario): number => {
    const at = known.indexOf(scenario.id);
    return at === -1 ? known.length : at;
  };
  return scenarios.filter((scenario) => scenario.kind === kind).sort((a, b) => rank(a) - rank(b));
}

function entryCard(scenario: Scenario, onClick: () => void): HTMLButtonElement {
  const node = button("entry", "", onClick);
  node.dataset.id = scenario.id;
  node.append(
    element("span", "entry-cmd", `/graft:${skillName(scenario)}`),
    element("span", "entry-hint", HINTS[scenario.id] ?? scenario.title),
  );
  return node;
}

function helperLink(scenario: Scenario, onClick: () => void): HTMLButtonElement {
  const lead = HELPER_LEADS[scenario.id];
  const node = button(
    "entry-link",
    lead === undefined ? scenario.title : `Watch /graft:${skillName(scenario)}`,
    onClick,
  );
  node.dataset.id = scenario.id;
  return node;
}

function helperLine(link: HTMLButtonElement): HTMLElement {
  const node = element("p", "entry-more");
  const lead = HELPER_LEADS[link.dataset.id ?? ""];
  if (lead !== undefined) node.append(`${lead} `);
  node.append(link);
  return node;
}

function speedIcon(shapes: Shape[]): SVGSVGElement {
  const icon = document.createElementNS(SVG_NS, "svg");
  icon.setAttribute("class", "ctl-speed-icon");
  icon.setAttribute("viewBox", "0 0 24 24");
  icon.setAttribute("aria-hidden", "true");
  icon.setAttribute("focusable", "false");
  for (const [tag, attributes] of shapes) {
    const shape = document.createElementNS(SVG_NS, tag);
    for (const [name, value] of Object.entries(attributes)) shape.setAttribute(name, value);
    icon.append(shape);
  }
  return icon;
}

function editable(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT|BUTTON|A)$/.test(target.tagName))
  );
}

export function initControls(
  entries: HTMLElement,
  root: HTMLElement,
  scenarios: Scenario[],
  speed: Speed,
  handlers: ControlHandlers,
): void {
  const primary = ordered(scenarios, "start", Object.keys(HINTS)).map((scenario) =>
    entryCard(scenario, () => handlers.start(scenario.id)),
  );
  const helpers = ordered(scenarios, "helper", Object.keys(HELPER_LEADS)).map((scenario) =>
    helperLink(scenario, () => handlers.start(scenario.id)),
  );
  const blocks: HTMLElement[] = [];
  if (primary.length > 0)
    blocks.push(
      element("span", "entry-label", "Pick where to start"),
      group("Pick where to start", "entry-row", primary),
    );
  blocks.push(...helpers.map(helperLine));
  entries.replaceChildren(...blocks);
  entries.hidden = blocks.length === 0;

  const speeds = (Object.keys(SPEED_LABELS) as Speed[]).map((value) => {
    const node = button("ctl-speed", "", () => handlers.speed(value));
    const shapes = SPEED_ICONS[value];
    if (shapes) node.append(speedIcon(shapes));
    node.append(SPEED_LABELS[value]);
    node.dataset.speed = value;
    node.setAttribute("aria-pressed", String(value === speed));
    return node;
  });
  const play = button("ctl-play", "", () => handlers.toggle());
  const restart = button("ctl-restart", "↺ Restart", () => handlers.restart());

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
  const buttons = element("div", "ctl-buttons");
  buttons.append(play, restart);
  const playback = element("div", "ctl-playback");
  playback.append(buttons, group("Speed", "ctl-speeds", speeds));

  root.replaceChildren(trail, scrub, playback);
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

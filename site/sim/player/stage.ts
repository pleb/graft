import { basename, chips } from "./core.ts";
import type { Card, Playback, StageState } from "./core.ts";
import { element } from "./terminal.ts";

type StageDom = {
  board: HTMLElement;
  terminal: HTMLElement;
  left: HTMLElement;
  right: HTMLElement;
  timeline: HTMLElement;
  wires: SVGSVGElement;
  narrow: MediaQueryList;
  nodes: Map<string, { card: Card; chip: boolean; node: HTMLElement }>;
  chips: Set<string>;
  stacks: Map<string, HTMLElement>;
  // The unit order and layout last placed, to skip moving nodes that stay put.
  placed: string;
  position: number;
  state?: StageState;
  observer?: ResizeObserver;
  frame?: number;
};

let stageDom: StageDom | undefined;

const SVG = "http://www.w3.org/2000/svg";
// How far the lines run outside the terminal's edge, over the tucked part of the cards.
const LANE = 10;

function badge(text: string, tone: string): HTMLElement {
  return element("span", `card-badge badge-${tone}`, text);
}

function role(agent: string): string {
  return agent.replace(/^graft:/, "");
}

// One line: kind, name and status.
function fillChip(node: HTMLElement, card: Card): void {
  const parts: HTMLElement[] = [];
  switch (card.kind) {
    case "file":
      parts.push(
        element("span", "card-kind", "File"),
        element("span", "chip-name", basename(card.path)),
      );
      if (card.status) parts.push(badge(card.status, card.status === "draft" ? "draft" : "done"));
      break;
    case "agent":
      parts.push(
        element("span", "card-kind", "Agent"),
        element("span", "chip-name", role(card.agent)),
        badge(card.done ? "done" : "running", card.done ? "done" : "running"),
      );
      break;
    case "commit":
      parts.push(element("code", "card-sha", card.id), element("span", "chip-name", card.subject));
      break;
    case "pr":
      parts.push(
        element("span", "card-kind", `PR #${card.number}`),
        element("span", "chip-name", card.title),
      );
      if (card.draft) parts.push(badge("draft", "draft"));
      break;
  }
  node.replaceChildren(...parts);
  node.className = `card card-chip card-${card.kind}`;
  node.title = parts.map((part) => part.textContent).join(" ");
}

function fillCard(node: HTMLElement, card: Card, chip: boolean): void {
  if (chip || card.kind === "commit") {
    fillChip(node, card);
    return;
  }
  node.removeAttribute("title");
  const head = element("div", "card-head");
  const parts: HTMLElement[] = [head];
  switch (card.kind) {
    case "file": {
      head.append(element("span", "card-kind", "File"));
      if (card.status) head.append(badge(card.status, card.status === "draft" ? "draft" : "done"));
      parts.push(element("div", "card-title", basename(card.path)));
      const slash = card.path.lastIndexOf("/");
      if (slash > 0) parts.push(element("div", "card-sub", card.path.slice(0, slash)));
      const lines = element("div", "card-lines");
      lines.append(...card.excerpt.map((line) => element("div", "card-line", line)));
      if (card.excerpt.length > 0) parts.push(lines);
      break;
    }
    case "agent":
      head.append(
        element("span", "card-kind", "Agent"),
        badge(card.done ? "done" : "running", card.done ? "done" : "running"),
      );
      parts.push(
        element("div", "card-title", `graft:${role(card.agent)}`),
        element("div", "card-sub", card.description),
      );
      if (card.done && card.report) parts.push(element("div", "card-report", card.report));
      break;
    case "pr": {
      head.append(element("span", "card-kind", `Pull request #${card.number}`));
      if (card.draft) head.append(badge("draft", "draft"));
      parts.push(
        element("div", "card-title", card.title),
        element("div", "card-sub", `${card.branch} → ${card.base}`),
      );
      if (card.commits.length > 0) {
        const commits = element("div", "card-lines");
        commits.append(
          ...card.commits.map((commit) => element("div", "card-line", commit.subject)),
        );
        parts.push(commits);
      }
      if (card.comments.length > 0)
        parts.push(
          element(
            "div",
            "card-report",
            `Review posted: ${card.comments.length} comment${card.comments.length === 1 ? "" : "s"}`,
          ),
        );
      break;
    }
  }
  node.replaceChildren(...parts);
  node.className = `card card-${card.kind}`;
  if (card.kind === "agent" && !card.done) node.classList.add("card-busy");
}

// Parallel agents share one unit, and so do all commits; every other card is its own.
function units(cards: Card[]): Card[][] {
  const found: Card[][] = [];
  const groups = new Map<string, Card[]>();
  for (const card of cards) {
    if (card.kind === "agent" || card.kind === "commit") {
      const key = card.kind === "agent" ? card.group : "commits";
      const group = groups.get(key);
      if (group) {
        group.push(card);
        continue;
      }
      groups.set(key, [card]);
      found.push(groups.get(key)!);
      continue;
    }
    found.push([card]);
  }
  return found;
}

function observe(dom: StageDom, node: Element): void {
  dom.observer?.observe(node);
}

function scheduleWires(): void {
  const dom = stageDom;
  if (!dom || dom.frame !== undefined) return;
  dom.frame = requestAnimationFrame(() => {
    dom.frame = undefined;
    drawWires(dom);
  });
}

export function initStage(): void {
  const wires = document.getElementById("wires") as unknown as SVGSVGElement;
  const dom: StageDom = {
    board: document.getElementById("board")!,
    terminal: document.getElementById("terminal")!,
    left: document.getElementById("cards-left")!,
    right: document.getElementById("cards-right")!,
    timeline: document.getElementById("timeline")!,
    wires,
    narrow: window.matchMedia("(max-width: 899px)"),
    nodes: new Map(),
    chips: new Set(),
    stacks: new Map(),
    placed: "",
    position: 0,
  };
  stageDom = dom;
  if (typeof ResizeObserver === "function") {
    dom.observer = new ResizeObserver(scheduleWires);
    observe(dom, dom.terminal);
    observe(dom, dom.board);
  }
  dom.terminal.addEventListener("scroll", scheduleWires, { capture: true, passive: true });
  dom.narrow.addEventListener("change", () => {
    dom.placed = "";
    if (dom.state) place(dom, dom.state);
    scheduleWires();
  });
  window.addEventListener("resize", scheduleWires);
  void document.fonts?.ready.then(scheduleWires);
}

function isCommits(unit: Card[]): boolean {
  return unit[0].kind === "commit";
}

// A parallel group whose agents are all chips folds into one chip.
function folded(dom: StageDom, unit: Card[]): boolean {
  return unit.length > 1 && unit.every((card) => dom.chips.has(card.key));
}

function stackNode(dom: StageDom, unit: Card[]): HTMLElement {
  const key = unit[0].key;
  let stack = dom.stacks.get(key);
  if (!stack) {
    stack = element("div");
    stack.setAttribute("role", "group");
    dom.stacks.set(key, stack);
    observe(dom, stack);
  }
  if (folded(dom, unit)) {
    const roles = new Map<string, number>();
    for (const card of unit)
      if (card.kind === "agent") {
        const name = role(card.agent);
        roles.set(name, (roles.get(name) ?? 0) + 1);
      }
    const names = [...roles].map(([name, count]) => (count > 1 ? `${name} ×${count}` : name));
    const name = element("span", "chip-name", names.join(", "));
    stack.className = "card card-chip card-agent";
    stack.setAttribute("aria-label", "Agents that ran in parallel");
    stack.title = `Agents ${names.join(", ")} done`;
    stack.replaceChildren(element("span", "card-kind", "Agents"), name, badge("done", "done"));
    return stack;
  }
  const commits = isCommits(unit);
  stack.className = commits ? "card-stack card-commits" : "card-stack";
  stack.setAttribute("aria-label", commits ? "Commits" : "Agents running in parallel");
  stack.removeAttribute("title");
  stack.replaceChildren(
    element("div", "card-stack-label", commits ? "Commits" : "In parallel"),
    ...unit.map((card) => dom.nodes.get(card.key)!.node),
  );
  return stack;
}

function place(dom: StageDom, state: StageState): void {
  const found = units(state.cards);
  const narrow = dom.narrow.matches;
  const signature = `${narrow}|${found
    .map((unit) => `${unit.map((card) => card.key).join(",")}${folded(dom, unit) ? "-" : ""}`)
    .join("|")}`;
  if (signature === dom.placed) return;
  dom.placed = signature;
  const stacked = (unit: Card[]): boolean => unit.length > 1 || isCommits(unit);
  const keep = new Set(found.filter(stacked).map((unit) => unit[0].key));
  for (const [key, stack] of dom.stacks)
    if (!keep.has(key)) {
      dom.observer?.unobserve(stack);
      stack.remove();
      dom.stacks.delete(key);
    }
  const nodes = found.map((unit) =>
    stacked(unit) ? stackNode(dom, unit) : dom.nodes.get(unit[0].key)!.node,
  );
  if (narrow) {
    dom.left.replaceChildren();
    dom.right.replaceChildren();
    dom.timeline.replaceChildren(...nodes);
    return;
  }
  dom.timeline.replaceChildren();
  dom.left.replaceChildren(...nodes.filter((_node, index) => found[index][0].side !== "right"));
  dom.right.replaceChildren(...nodes.filter((_node, index) => found[index][0].side === "right"));
}

// Called after every reset and every applied step.
export function renderStage(playback: Playback): void {
  const dom = stageDom;
  if (!dom) return;
  const state = playback.term.stage;
  const stepped = playback.position === dom.position + 1;
  dom.position = playback.position;
  dom.state = state;
  dom.chips = chips(state);
  const keys = new Set(state.cards.map((card) => card.key));
  for (const [key, { node }] of dom.nodes)
    if (!keys.has(key)) {
      dom.observer?.unobserve(node);
      node.remove();
      dom.nodes.delete(key);
    }
  for (const card of state.cards) {
    const known = dom.nodes.get(card.key);
    const chip = dom.chips.has(card.key);
    if (known?.card === card && known.chip === chip) continue;
    const node = known?.node ?? element("article");
    fillCard(node, card, chip);
    node.dataset.card = card.key;
    if (stepped && known?.card !== card) node.classList.add(known ? "card-update" : "card-enter");
    if (!known) observe(dom, node);
    dom.nodes.set(card.key, { card, chip, node });
  }
  place(dom, state);
  scheduleWires();
}

type Point = { x: number; y: number };

function path(dom: StageDom, d: string, className: string): void {
  const node = document.createElementNS(SVG, "path");
  node.setAttribute("d", d);
  node.setAttribute("class", className);
  dom.wires.append(node);
}

function dot(dom: StageDom, at: Point): void {
  const node = document.createElementNS(SVG, "circle");
  node.setAttribute("cx", String(at.x));
  node.setAttribute("cy", String(at.y));
  node.setAttribute("r", "3.5");
  node.setAttribute("class", "wire-dot");
  dom.wires.append(node);
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), Math.max(low, high));
}

function drawWires(dom: StageDom): void {
  dom.wires.replaceChildren();
  const state = dom.state;
  if (!state || dom.narrow.matches) return;
  const board = dom.board.getBoundingClientRect();
  const term = dom.terminal.getBoundingClientRect();
  const log = dom.terminal.querySelector(".term-log")?.getBoundingClientRect() ?? term;
  const lines = dom.terminal.querySelector(".term-lines")?.children;
  dom.wires.setAttribute("width", String(board.width));
  dom.wires.setAttribute("height", String(board.height));
  const local = (x: number, y: number): Point => ({ x: x - board.left, y: y - board.top });

  type Place = { left: boolean; rect: DOMRect; lane: Point };
  const places = new Map<string, Place>();
  for (const [key, { node }] of dom.nodes) {
    if (!node.isConnected) continue;
    const left = dom.left.contains(node);
    const rect = node.getBoundingClientRect();
    const edge = left ? term.left - LANE : term.right + LANE;
    places.set(key, { left, rect, lane: local(edge, rect.top + Math.min(18, rect.height / 2)) });
  }

  for (const card of state.cards) {
    const at = places.get(card.key);
    if (!at || dom.chips.has(card.key)) continue;
    if (card.anchor) {
      const line = card.anchor.clears === state.clears ? lines?.[card.anchor.line] : undefined;
      let y = term.top + 18;
      if (line) {
        const rect = line.getBoundingClientRect();
        y = clamp(rect.top + Math.min(11, rect.height / 2), log.top + 4, log.bottom - 4);
      }
      const start = local(at.left ? term.left : term.right, y);
      const lane = at.lane;
      const bend = Math.sign(lane.y - start.y) * Math.min(8, Math.abs(lane.y - start.y));
      path(
        dom,
        `M ${start.x} ${start.y} Q ${lane.x} ${start.y} ${lane.x} ${start.y + bend} L ${lane.x} ${lane.y}`,
        "wire",
      );
      dot(dom, start);
      dot(dom, lane);
    }
    for (const key of card.links) {
      const other = places.get(key);
      if (!other || dom.chips.has(key)) continue;
      if (card.kind === "commit" && key.startsWith("commit:")) {
        // Rows of one stack: a straight line down their outer edge.
        const x = at.left ? at.rect.left - LANE : at.rect.right + LANE;
        const from = local(x, other.rect.top + other.rect.height / 2);
        const to = local(x, at.rect.top + at.rect.height / 2);
        path(dom, `M ${from.x} ${from.y} L ${to.x} ${to.y}`, "wire wire-link");
        dot(dom, from);
        dot(dom, to);
        continue;
      }
      if (other.left === at.left) {
        // Same side: a bracket round the cards' outer edges.
        const side = at.left ? -1 : 1;
        const edge = (place: Place): Point =>
          local(at.left ? place.rect.left : place.rect.right, place.lane.y + board.top);
        const from = edge(other);
        const to = edge(at);
        const reach = Math.min(28, 12 + Math.abs(to.y - from.y) / 8);
        const outer = (at.left ? Math.min(from.x, to.x) : Math.max(from.x, to.x)) + side * reach;
        path(
          dom,
          `M ${from.x} ${from.y} C ${outer} ${from.y} ${outer} ${to.y} ${to.x} ${to.y}`,
          "wire wire-link",
        );
        dot(dom, from);
        dot(dom, to);
      } else {
        // Opposite sides: down the lanes and across behind the terminal.
        const from = other.lane;
        const to = at.lane;
        const top = term.top - board.top + 12;
        const across = clamp((from.y + to.y) / 2, top, top + term.height - 24);
        path(
          dom,
          `M ${from.x} ${from.y} L ${from.x} ${across} L ${to.x} ${across} L ${to.x} ${to.y}`,
          "wire wire-link",
        );
        dot(dom, from);
        dot(dom, to);
      }
    }
  }
}

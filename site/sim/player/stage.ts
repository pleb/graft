import { basename } from "./core.ts";
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
  nodes: Map<string, { card: Card; node: HTMLElement }>;
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

function fillCard(node: HTMLElement, card: Card): void {
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
        element("div", "card-title", `graft:${card.agent.replace(/^graft:/, "")}`),
        element("div", "card-sub", card.description),
      );
      if (card.done && card.report) parts.push(element("div", "card-report", card.report));
      break;
    case "commit":
      head.append(element("span", "card-kind", "Commit"), element("code", "card-sha", card.id));
      parts.push(element("div", "card-title", card.subject));
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

// Parallel agents share one unit; every other card is its own.
function units(cards: Card[]): Card[][] {
  const found: Card[][] = [];
  const groups = new Map<string, Card[]>();
  for (const card of cards) {
    if (card.kind === "agent") {
      const group = groups.get(card.group);
      if (group) {
        group.push(card);
        continue;
      }
      groups.set(card.group, [card]);
      found.push(groups.get(card.group)!);
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

function stackNode(dom: StageDom, unit: Card[]): HTMLElement {
  const key = unit[0].key;
  let stack = dom.stacks.get(key);
  if (!stack) {
    stack = element("div", "card-stack");
    stack.setAttribute("role", "group");
    stack.setAttribute("aria-label", "Agents running in parallel");
    stack.append(element("div", "card-stack-label", "In parallel"));
    dom.stacks.set(key, stack);
    observe(dom, stack);
  }
  stack.replaceChildren(stack.firstChild!, ...unit.map((card) => dom.nodes.get(card.key)!.node));
  return stack;
}

function place(dom: StageDom, state: StageState): void {
  const found = units(state.cards);
  const narrow = dom.narrow.matches;
  const signature = `${narrow}|${found.map((unit) => unit.map((card) => card.key).join(",")).join("|")}`;
  if (signature === dom.placed) return;
  dom.placed = signature;
  const keep = new Set(found.filter((unit) => unit.length > 1).map((unit) => unit[0].key));
  for (const [key, stack] of dom.stacks)
    if (!keep.has(key)) {
      dom.observer?.unobserve(stack);
      stack.remove();
      dom.stacks.delete(key);
    }
  const nodes = found.map((unit) =>
    unit.length > 1 ? stackNode(dom, unit) : dom.nodes.get(unit[0].key)!.node,
  );
  if (narrow) {
    dom.left.replaceChildren();
    dom.right.replaceChildren();
    dom.timeline.replaceChildren(...nodes);
    return;
  }
  dom.timeline.replaceChildren();
  dom.left.replaceChildren(...nodes.filter((_node, index) => index % 2 === 0));
  dom.right.replaceChildren(...nodes.filter((_node, index) => index % 2 === 1));
}

// Called after every reset and every applied step.
export function renderStage(playback: Playback): void {
  const dom = stageDom;
  if (!dom) return;
  const state = playback.term.stage;
  const stepped = playback.position === dom.position + 1;
  dom.position = playback.position;
  dom.state = state;
  const keys = new Set(state.cards.map((card) => card.key));
  for (const [key, { node }] of dom.nodes)
    if (!keys.has(key)) {
      dom.observer?.unobserve(node);
      node.remove();
      dom.nodes.delete(key);
    }
  for (const card of state.cards) {
    const known = dom.nodes.get(card.key);
    if (known?.card === card) continue;
    const node = known?.node ?? element("article");
    fillCard(node, card);
    node.dataset.card = card.key;
    if (stepped) node.classList.add(known ? "card-update" : "card-enter");
    if (!known) observe(dom, node);
    dom.nodes.set(card.key, { card, node });
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

// Redraws every line from the current layout.
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
    places.set(key, { left, rect, lane: local(edge, rect.top + 18) });
  }

  for (const card of state.cards) {
    const at = places.get(card.key);
    if (!at) continue;
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
      if (!other) continue;
      if (other.left === at.left) {
        // Same side: a bracket round the cards' outer edges.
        const side = at.left ? -1 : 1;
        const edge = (place: Place): Point =>
          local(at.left ? place.rect.left : place.rect.right, place.rect.top + 18);
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
        // Opposite sides: the line passes behind the terminal.
        const from = other.lane;
        const to = at.lane;
        const middle = (from.x + to.x) / 2;
        path(
          dom,
          `M ${from.x} ${from.y} C ${middle} ${from.y} ${middle} ${to.y} ${to.x} ${to.y}`,
          "wire wire-link",
        );
        dot(dom, from);
        dot(dom, to);
      }
    }
  }
}

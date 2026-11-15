import { runHistory } from "./core.ts";
import type { HistoryItem, HistorySkill, Playback } from "./core.ts";
import { element, mirrorChoices } from "./terminal.ts";

export type PanelView = "terminal" | "history";

export type HistoryHandlers = {
  seek(position: number): void;
  // Called after the shown tab changes.
  view(view: PanelView): void;
  // Called after the reader's toggle resizes an entry.
  resize(): void;
};

type HistoryRow = { key: string; sig: string; node: HTMLElement };

type HistoryDom = {
  panel: HTMLElement;
  tabs: Record<PanelView, HTMLButtonElement>;
  log: HTMLElement;
  list: HTMLElement;
  rows: HistoryRow[];
  // Step indexes of the compact entries the reader expanded.
  open: Set<number>;
  // Refills an entry with its latest content, after its toggle.
  refill: WeakMap<HTMLElement, () => void>;
  // Whether new entries scroll the log to its bottom; only the reader's scrolling changes it.
  stick: boolean;
  // The scroll position the renderer left, so the scroll event it causes is not the reader's.
  scrolled: number;
  // The path and position rendered.
  shown?: string;
  handlers: HistoryHandlers;
};

let historyDom: HistoryDom | undefined;

const VIEWS: PanelView[] = ["terminal", "history"];
const TAB_LABELS: Record<PanelView, string> = { terminal: "Terminal", history: "History" };
// Compact entries longer than this get a toggle to show them in full.
const COMPACT = 40;

function agentLabel(agent: string): string {
  return agent.startsWith("graft:") ? agent : `graft:${agent}`;
}

export function initHistory(
  panel: HTMLElement,
  tablist: HTMLElement,
  root: HTMLElement,
  handlers: HistoryHandlers,
): void {
  const tabs = {} as Record<PanelView, HTMLButtonElement>;
  for (const view of VIEWS) {
    const tab = element("button", "panel-tab", TAB_LABELS[view]) as HTMLButtonElement;
    tab.type = "button";
    tab.id = `tab-${view}`;
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-controls", view);
    tab.addEventListener("click", () => selectTab(view));
    tabs[view] = tab;
  }
  tablist.replaceChildren(...VIEWS.map((view) => tabs[view]));
  tablist.addEventListener("keydown", (event) => {
    const at = VIEWS.indexOf(panel.dataset.view as PanelView);
    const next =
      event.key === "ArrowRight"
        ? (at + 1) % VIEWS.length
        : event.key === "ArrowLeft"
          ? (at + VIEWS.length - 1) % VIEWS.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? VIEWS.length - 1
              : -1;
    if (next === -1) return;
    event.preventDefault();
    selectTab(VIEWS[next], true);
  });

  const log = element("div", "hist-log");
  const list = element("ol", "hist-list");
  list.setAttribute("aria-label", "Steps so far");
  log.append(list);
  const input = element("div", "hist-input");
  input.hidden = true;
  root.replaceChildren(log, input);
  const dom: HistoryDom = {
    panel,
    tabs,
    log,
    list,
    rows: [],
    open: new Set(),
    refill: new WeakMap(),
    stick: true,
    scrolled: 0,
    handlers,
  };
  historyDom = dom;
  // The hand-off's choices show here too; focus leaving with them lands on the hand-off's entry.
  mirrorChoices(input, () =>
    [...list.querySelectorAll<HTMLElement>(".hist-handoff .hist-entry")]
      .at(-1)
      ?.focus({ preventScroll: true }),
  );
  log.addEventListener(
    "scroll",
    () => {
      if (dom.panel.dataset.view !== "history" || Math.abs(log.scrollTop - dom.scrolled) < 1)
        return;
      dom.scrolled = log.scrollTop;
      dom.stick = log.scrollTop + log.clientHeight >= log.scrollHeight - 4;
    },
    { passive: true },
  );
  selectTab("terminal");
}

export function selectTab(view: PanelView, focus = false): void {
  const dom = historyDom;
  if (!dom) return;
  const changed = dom.panel.dataset.view !== view;
  dom.panel.dataset.view = view;
  for (const each of VIEWS) {
    const tab = dom.tabs[each];
    tab.setAttribute("aria-selected", String(each === view));
    tab.tabIndex = each === view ? 0 : -1;
  }
  if (focus) dom.tabs[view].focus();
  if (view === "history" && dom.stick) scrollLog(dom);
  if (changed) dom.handlers.view(view);
}

// The log, while History is the shown tab.
export function shownHistory(): HTMLElement | undefined {
  const dom = historyDom;
  return dom?.panel.dataset.view === "history" ? dom.log : undefined;
}

function scrollLog(dom: HistoryDom): void {
  dom.log.scrollTop = dom.log.scrollHeight;
  dom.scrolled = dom.log.scrollTop;
}

function compact(item: HistoryItem): boolean {
  return item.kind === "say" || item.kind === "tool";
}

// The head line and the lines under it.
function entryText(item: HistoryItem, runs: Map<string, string>): [string, string[]] {
  switch (item.kind) {
    case "prompt":
    case "say":
      return [item.text, []];
    case "tool":
      return [`${item.name}(${item.args})`, item.result === undefined ? [] : [item.result]];
    case "answers":
      return [
        "User answered:",
        item.questions.map((question) => `· ${question.question} → ${question.answer}`),
      ];
    case "agentStart":
      return [`${agentLabel(item.agent)} started: ${item.description}`, []];
    case "agentDone":
      return [
        `${agentLabel(item.agent)} finished: ${item.description}`,
        item.report === undefined ? [] : [item.report],
      ];
    case "commit": {
      const by = item.runs.map((run) => runs.get(run) ?? run);
      return [
        `Committed ${item.id} ${item.subject}`,
        by.length === 0 ? [] : [`By ${by.join(", ")}`],
      ];
    }
    case "file":
      return [`${item.created ? "Created" : "Updated"} ${item.path}`, []];
    case "branch":
      return [`Made branch ${item.name}`, []];
    case "prOpen":
      return [`Opened ${item.draft ? "draft " : ""}PR #${item.number}: ${item.title}`, []];
    case "prSeed":
      return [`Picked up PR #${item.number}: ${item.title}`, []];
    case "prComment":
      return [`Commented on PR #${item.number}`, [item.text]];
    case "handoff":
      return [
        item.text,
        [item.chosen === undefined ? "Next: waiting for a choice" : `Next: ${item.chosen}`],
      ];
  }
}

const DOTS: Record<HistoryItem["kind"], [string, string]> = {
  prompt: ["›", "hist-dot-prompt"],
  say: ["⏺", "dot-say"],
  tool: ["⏺", "dot-tool"],
  answers: ["⏺", "dot-ask"],
  agentStart: ["⏺", "dot-agent"],
  agentDone: ["⏺", "dot-done"],
  commit: ["⏺", "dot-done"],
  file: ["⏺", "dot-tool"],
  branch: ["⏺", "dot-tool"],
  prOpen: ["⏺", "dot-done"],
  prSeed: ["⏺", "dot-say"],
  prComment: ["⏺", "dot-ask"],
  handoff: ["⏺", "dot-say"],
};

function fillItem(
  dom: HistoryDom,
  node: HTMLElement,
  item: HistoryItem,
  runs: Map<string, string>,
): void {
  dom.refill.set(node, () => fillItem(dom, node, item, runs));
  const [head, lines] = entryText(item, runs);
  const [dot, tone] = DOTS[item.kind];
  const small = compact(item);
  const long = small && (lines.length > 0 || head.length > COMPACT || head.includes("\n"));
  const open = long && dom.open.has(item.index);
  node.className = `hist-item hist-${item.kind}${small ? " hist-compact" : ""}${open ? " hist-open" : ""}`;
  node.dataset.index = String(item.index);
  if (item.wire && item.card !== undefined) node.dataset.wire = item.card;
  else delete node.dataset.wire;
  const button = node.querySelector<HTMLElement>(".hist-entry")!;
  const body = element("span", "hist-body");
  body.append(element("span", "hist-head", head));
  if (!small || open) body.append(...lines.map((line) => element("span", "hist-sub", line)));
  button.replaceChildren(element("span", `ln-dot ${tone}`, dot), body);
  let more = node.querySelector<HTMLButtonElement>(".hist-more");
  if (!long) {
    more?.remove();
    return;
  }
  if (!more) {
    more = element("button", "hist-more") as HTMLButtonElement;
    more.type = "button";
    more.addEventListener("click", () => {
      const index = Number(node.dataset.index);
      if (dom.open.has(index)) dom.open.delete(index);
      else dom.open.add(index);
      dom.refill.get(node)?.();
      dom.handlers.resize();
    });
    node.append(more);
  }
  more.textContent = open ? "Less" : "More";
  more.setAttribute("aria-expanded", String(open));
  more.setAttribute("aria-label", open ? "Show less" : "Show all");
}

function itemNode(dom: HistoryDom): HTMLElement {
  const node = element("li");
  const button = element("button", "hist-entry") as HTMLButtonElement;
  button.type = "button";
  button.addEventListener("click", () => dom.handlers.seek(Number(node.dataset.index) + 1));
  node.append(button);
  return node;
}

type RowSpec = { key: string; sig: string; make(): HTMLElement; fill?(node: HTMLElement): void };

function rowSpecs(dom: HistoryDom, skills: HistorySkill[]): RowSpec[] {
  const runs = new Map<string, string>();
  const specs: RowSpec[] = [];
  for (const skill of skills) {
    const label = `/graft:${skill.skill}`;
    specs.push({
      key: `skill:${skill.at}:${label}`,
      sig: label,
      make: () => {
        const node = element("li", "hist-skill");
        node.append(element("h3", undefined, label));
        return node;
      },
    });
    for (const chapter of skill.chapters) {
      if (chapter.title !== undefined) {
        const title = chapter.title;
        specs.push({
          key: `chapter:${chapter.index}`,
          sig: title,
          make: () => {
            const node = element("li", "hist-chapter");
            node.append(element("h4", undefined, title));
            return node;
          },
        });
      }
      for (const item of chapter.items) {
        if (item.kind === "agentStart")
          runs.set(item.runs[0], `${agentLabel(item.agent)} (${item.description})`);
        const known = new Map(runs);
        specs.push({
          key: `item:${item.index}`,
          sig: JSON.stringify([
            item,
            item.kind === "commit" ? item.runs.map((run) => known.get(run)) : [],
          ]),
          make: () => itemNode(dom),
          fill: (node) => fillItem(dom, node, item, known),
        });
      }
    }
  }
  return specs;
}

// Keeps each row's node while its key matches, and refills it in place when its content changed.
export function renderHistory(playback: Playback): void {
  const dom = historyDom;
  if (!dom) return;
  const key = `${playback.path.join("/")}@${playback.position}`;
  if (dom.shown !== key) {
    dom.shown = key;
    const specs = rowSpecs(dom, runHistory(playback.byId, playback.steps, playback.position));
    specs.forEach((spec, index) => {
      const known = dom.rows[index];
      if (known?.key === spec.key) {
        if (known.sig !== spec.sig) {
          spec.fill?.(known.node);
          known.sig = spec.sig;
        }
        return;
      }
      const node = spec.make();
      spec.fill?.(node);
      if (known) known.node.replaceWith(node);
      else dom.list.append(node);
      dom.rows[index] = { key: spec.key, sig: spec.sig, node };
    });
    for (const row of dom.rows.splice(specs.length)) row.node.remove();
    let last: HTMLElement | undefined;
    for (const row of dom.rows) {
      row.node.querySelector(".hist-entry")?.removeAttribute("aria-current");
      if (row.key.startsWith("item:")) last = row.node;
    }
    last?.querySelector(".hist-entry")?.setAttribute("aria-current", "step");
  }
  if (dom.stick) scrollLog(dom);
  else dom.scrolled = dom.log.scrollTop;
}

import type { Question } from "../events.ts";
import { roleRows } from "./core.ts";
import type { Line, Pending, RoleRow, Run, Step, TermState } from "./core.ts";

type TermDom = {
  log: HTMLElement;
  lines: HTMLElement;
  pending: HTMLElement;
  agents: HTMLElement;
  live: HTMLElement;
  done: HTMLElement;
  spinner: HTMLElement;
  input: HTMLElement;
  caption: HTMLElement;
  rendered: Line[];
  handoff?: Pending;
  // Other places that show the hand-off's choices; `dropped` runs when focus leaves with them.
  mirrors: { slot: HTMLElement; dropped(): void }[];
  reduced: boolean;
  choose(at: number, next: string): void;
};

let termDom: TermDom | undefined;

export function element(tag: string, className?: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function agentName(agent: string): string {
  return agent.startsWith("graft:") ? agent : `graft:${agent}`;
}

function result(text: string, first = true): HTMLElement {
  const row = element("div", "ln-result");
  row.append(element("span", "ln-elbow", first ? "⎿" : ""), element("span", "ln-text", text));
  return row;
}

function entry(dot: string, head: (string | HTMLElement)[], results: HTMLElement[]): HTMLElement {
  const node = element("div", "ln");
  const body = element("div", "ln-body");
  const top = element("div", "ln-head");
  top.append(...head);
  body.append(top, ...results);
  node.append(element("span", `ln-dot ${dot}`, "⏺"), body);
  return node;
}

function call(name: string, args: string): (string | HTMLElement)[] {
  return [element("strong", undefined, name), `(${args})`];
}

function lineNode(line: Line): HTMLElement {
  switch (line.kind) {
    case "prompt": {
      const node = element("div", "ln ln-prompt");
      node.append(element("span", "ln-mark", "›"), element("span", "ln-text", line.text));
      return node;
    }
    case "say":
      return entry("dot-say", [line.text], []);
    case "tool":
      return entry(
        "dot-tool",
        call(line.name, line.args),
        line.result === undefined ? [] : [result(line.result)],
      );
    case "answers":
      return entry(
        "dot-ask",
        ["User answered:"],
        line.questions.map((question, index) =>
          result(`· ${question.question} → ${question.answer}`, index === 0),
        ),
      );
    case "agent":
      return entry("dot-agent", call(agentName(line.agent), line.description), [
        result("Running in the background"),
      ]);
    case "agentDone":
      return entry(
        "dot-done",
        [element("strong", undefined, agentName(line.agent)), ` finished: ${line.description}`],
        [result(line.report ?? "Done")],
      );
    case "chapter":
      return element("div", "ln ln-chapter", line.title);
    case "handoff":
      return entry("dot-say", [line.text], []);
  }
}

export function initTerminal(
  root: HTMLElement,
  caption: HTMLElement,
  title: string,
  reduced: boolean,
  choose: (at: number, next: string) => void,
): void {
  const bar = element("div", "term-bar");
  bar.append(element("span", "term-lights"), element("span", "term-title", title));
  const log = element("div", "term-log");
  log.setAttribute("role", "log");
  log.setAttribute("aria-label", "Terminal output");
  log.tabIndex = 0;
  const lines = element("div", "term-lines");
  const pending = element("div", "term-pending");
  log.append(lines, pending);
  const agents = element("div", "term-agents");
  agents.setAttribute("aria-label", "Background agents");
  const live = element("div", "agent-live");
  const foot = element("div", "agent-foot");
  const spinner = element("div", "term-spinner");
  spinner.setAttribute("aria-hidden", "true");
  const done = element("div", "agent-finished");
  foot.append(spinner, done);
  agents.append(live, foot);
  const input = element("div", "term-input");
  root.replaceChildren(bar, log, agents, input);
  termDom = {
    log,
    lines,
    pending,
    agents,
    live,
    done,
    spinner,
    input,
    caption,
    rendered: [],
    mirrors: [],
    reduced,
    choose,
  };
}

// Shows the hand-off's choices in `slot` too, in step with the terminal input.
export function mirrorChoices(slot: HTMLElement, dropped: () => void): void {
  const dom = termDom;
  if (!dom) return;
  dom.mirrors.push({ slot, dropped });
  renderInput(dom, dom.handoff);
}

function renderInput(dom: TermDom, handoff: Pending | undefined): void {
  dom.handoff = handoff;
  for (const { slot, dropped } of dom.mirrors) {
    const focused = slot.contains(document.activeElement);
    replaceChoices(slot, handoff ? [handoffChoices(handoff, dom.choose)] : []);
    slot.hidden = !handoff;
    if (focused && !slot.contains(document.activeElement)) dropped();
  }
  if (!handoff) {
    const mark = element("span", "term-mark", "›");
    const typed = element("span", "term-typed");
    dom.input.replaceChildren(mark, typed, element("span", "term-caret"));
    return;
  }
  replaceChoices(dom.input, [handoffChoices(handoff, dom.choose)]);
}

function handoffChoices(handoff: Pending, choose: (at: number, next: string) => void): HTMLElement {
  const choices = element("div", "term-choices");
  choices.setAttribute("role", "group");
  choices.setAttribute("aria-label", "Run next");
  choices.append(element("span", "term-next", "Next:"));
  for (const choice of handoff.choices) {
    const button = element("button", "term-choice", choice.command) as HTMLButtonElement;
    button.type = "button";
    button.setAttribute("aria-pressed", String(choice.command === handoff.chosen));
    button.addEventListener("click", () => choose(handoff.at, choice.next));
    choices.append(button);
  }
  return choices;
}

// Replaces `root`'s content, moving focus from a choice button to the new one for the same command.
function replaceChoices(root: HTMLElement, nodes: HTMLElement[]): void {
  const active = document.activeElement;
  const focused =
    active instanceof HTMLElement && root.contains(active) && active.matches(".term-choice")
      ? active.textContent
      : undefined;
  root.replaceChildren(...nodes);
  if (focused === undefined) return;
  for (const button of root.querySelectorAll<HTMLElement>(".term-choice"))
    if (button.textContent === focused) button.focus({ preventScroll: true });
}

function roleNode(row: RoleRow): HTMLElement {
  const count = row.runs.length;
  const node = element("div", "agent-row");
  const name = element("strong", "agent-name");
  name.append(element("span", "agent-ns", "graft:"), row.agent);
  node.append(element("span", `agent-state agent-stack-${Math.min(4, count)}`, "◌"), name);
  if (count > 1) node.append(element("span", "agent-count", `×${count}`));
  node.append(
    row.again
      ? element("span", "agent-status agent-again", "running again")
      : element("span", "agent-status", "running"),
    element("span", "agent-desc", row.runs[0].description),
  );
  return node;
}

// A fixed panel: two lines of running roles, then the spinner and the roles finished this chapter.
function renderAgents(dom: TermDom, term: TermState): void {
  const rows = roleRows(term);
  dom.live.className = rows.length === 1 ? "agent-live agent-solo" : "agent-live";
  if (rows.length === 0)
    dom.live.replaceChildren(
      element(
        "div",
        "agent-idle",
        term.finishedRoles.length === 0 ? "No agents yet" : "No agents running",
      ),
    );
  else if (rows.length <= 2) dom.live.replaceChildren(...rows.map(roleNode));
  else
    dom.live.replaceChildren(
      roleNode(rows[0]),
      element("div", "agent-idle", `+${rows.length - 1} more roles running`),
    );
  dom.done.textContent =
    term.finished.length === 0
      ? ""
      : `✓ ${[...term.finished]
          .reverse()
          .map((entry) => (entry.runs > 1 ? `${entry.agent} ×${entry.runs}` : entry.agent))
          .join(", ")}`;
}

function renderSpinner(dom: TermDom, term: TermState): void {
  const running = term.agents.some((agent) => !agent.done);
  dom.spinner.replaceChildren(
    element("span", "spin", "✳"),
    element("span", undefined, running ? "Waiting" : "Working"),
  );
  dom.spinner.hidden = !term.busy;
}

function scrollDown(dom: TermDom): void {
  dom.log.scrollTop = dom.log.scrollHeight;
}

export function renderTerm(term: TermState): void {
  const dom = termDom;
  if (!dom) return;
  const nodes = dom.lines.children;
  term.lines.forEach((line, index) => {
    if (dom.rendered[index] === line) return;
    const node = lineNode(line);
    if (index < nodes.length) nodes[index].replaceWith(node);
    else dom.lines.append(node);
  });
  while (nodes.length > term.lines.length) nodes[nodes.length - 1].remove();
  dom.rendered = term.lines;
  dom.pending.replaceChildren();
  if (dom.handoff !== term.handoff || !term.handoff) renderInput(dom, term.handoff);
  renderAgents(dom, term);
  renderSpinner(dom, term);
  dom.caption.textContent = term.caption;
  dom.caption.hidden = term.caption === "";
  scrollDown(dom);
}

async function typeText(dom: TermDom, text: string, run: Run): Promise<boolean> {
  if (dom.handoff) renderInput(dom, undefined);
  const typed = dom.input.querySelector(".term-typed");
  if (!typed) return run.live();
  if (dom.reduced) {
    typed.textContent = text;
    return run.wait(400);
  }
  const each = Math.min(40, 1600 / Math.max(1, text.length));
  for (let count = 1; count <= text.length; count++) {
    if (!(await run.wait(each))) return false;
    typed.textContent = text.slice(0, count);
  }
  return run.wait(300);
}

function askWidget(questions: Question[], current: number): [HTMLElement, HTMLElement[]] {
  const widget = element("div", "ask");
  const tabs = element("div", "ask-tabs");
  questions.forEach((question, index) => {
    const tab = element("span", index === current ? "ask-tab ask-tab-on" : "ask-tab");
    tab.textContent = `${index < current ? "✓" : "□"} ${question.header}`;
    tabs.append(tab);
  });
  const question = questions[current];
  const list = element("ol", "ask-options");
  const items = question.options.map((option, index) => {
    const item = element("li", "ask-option");
    const marked =
      question.recommended && index === 0 && !option.label.endsWith("(Recommended)")
        ? `${option.label} (Recommended)`
        : option.label;
    item.append(
      element("span", "ask-pointer"),
      element("span", "ask-number", `${index + 1}.`),
      element("span", "ask-label", marked),
    );
    if (option.description) item.append(element("span", "ask-desc", option.description));
    list.append(item);
    return item;
  });
  widget.append(tabs, element("div", "ask-question", question.question), list);
  return [widget, items];
}

// The spinner stays hidden while the questions wait on the user; the commit renders it again.
async function ask(dom: TermDom, questions: Question[], run: Run): Promise<void> {
  dom.spinner.hidden = true;
  for (let current = 0; current < questions.length; current++) {
    const [widget, items] = askWidget(questions, current);
    dom.pending.replaceChildren(widget);
    scrollDown(dom);
    if (!(await run.wait(1400))) return;
    const question = questions[current];
    const picked = question.options.findIndex((option) => option.label === question.answer);
    items[picked]?.classList.add("ask-picked");
    if (!(await run.wait(900))) return;
  }
}

// Animates a step up to the point the core applies it.
export async function playTermStep(step: Step, run: Run): Promise<void> {
  const dom = termDom;
  if (!dom) return;
  const event = step.event;
  switch (event.type) {
    case "prompt":
      await typeText(dom, event.text, run);
      return;
    case "clear":
      await typeText(dom, "/clear", run);
      return;
    case "tool":
      dom.pending.replaceChildren(lineNode({ kind: "tool", name: event.name, args: event.args }));
      scrollDown(dom);
      await run.wait(event.result === undefined ? 200 : 600);
      return;
    case "ask":
      await ask(dom, event.questions, run);
      return;
  }
}

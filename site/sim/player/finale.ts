import { finale, formatHash, skillName } from "./core.ts";
import type { Card, Finale, Playback } from "./core.ts";
import { element } from "./terminal.ts";

type FinaleDom = {
  root: HTMLElement;
  reduced: boolean;
  // The path and position the finale was built for.
  shown?: string;
};

let finaleDom: FinaleDom | undefined;

const INSTALL_LINE =
  "Claude, install Graft https://raw.githubusercontent.com/pleb/graft/main/agent-install.md";
const INSTALL_URL = "https://github.com/pleb/graft#install";

function link(text: string, href: string, className?: string): HTMLAnchorElement {
  const node = element("a", className, text) as HTMLAnchorElement;
  node.href = href;
  return node;
}

function count(value: number, word: string): string {
  return `${value} ${word}${value === 1 ? "" : "s"}`;
}

// The body's first paragraph and its `... by Graft.` line.
function bodyExcerpt(body: string): string[] {
  const paragraphs = body
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph !== "");
  const graft = paragraphs.find((paragraph) => /by Graft\.?$/m.test(paragraph));
  const first = paragraphs[0];
  return [...new Set([first, graft].filter((part): part is string => part !== undefined))];
}

function prPanel(pr: Extract<Card, { kind: "pr" }>, review: boolean): HTMLElement {
  const panel = element("article", "finale-pr");
  panel.setAttribute("aria-label", `Pull request #${pr.number}`);
  const head = element("div", "finale-pr-head");
  head.append(element("span", "finale-pr-number", `Pull request #${pr.number}`));
  if (pr.draft) head.append(element("span", "card-badge badge-draft", "draft"));
  const branch = element("div", "finale-pr-branch");
  branch.append(element("code", undefined, pr.branch), " → ", element("code", undefined, pr.base));
  panel.append(head, element("h2", "finale-pr-title", pr.title), branch);
  if (pr.body !== undefined) {
    const body = element("div", "finale-pr-body");
    body.append(...bodyExcerpt(pr.body).map((part) => element("p", undefined, part)));
    panel.append(body);
  }
  if (pr.commits.length > 0) {
    const commits = element("ol", "finale-pr-commits");
    commits.setAttribute("aria-label", "Commits");
    commits.append(
      ...pr.commits.map((commit) => {
        const item = element("li");
        item.append(
          element("code", undefined, commit.id),
          element("span", undefined, commit.subject),
        );
        return item;
      }),
    );
    panel.append(commits);
  }
  if (review && pr.comments.length > 0) {
    const posted = element("section", "finale-review");
    posted.append(
      element(
        "div",
        "finale-review-head",
        `Review posted with ${count(pr.comments.length, "comment")}`,
      ),
    );
    const list = element("ul", "finale-review-comments");
    list.append(...pr.comments.map((comment) => element("li", undefined, comment)));
    posted.append(list);
    panel.append(posted);
  }
  return panel;
}

function recapSection(result: Finale): HTMLElement {
  const review = result.kind === "review";
  const section = element("section", "finale-recap");
  section.append(
    element(
      "h2",
      undefined,
      review && result.pr ? `How Graft reviewed PR #${result.pr.number}` : "What Graft did",
    ),
  );
  const totals = review
    ? [count(result.agents, "agent"), count(result.pr?.comments.length ?? 0, "review comment")]
    : [
        count(result.questions, "question") + " answered",
        count(result.agents, "agent"),
        count(result.commits, "commit"),
      ];
  const chips = element("ul", "finale-totals");
  chips.append(...totals.map((total) => element("li", undefined, total)));
  const lines = element("ol", "finale-lines");
  lines.append(
    ...result.recap.map((line) => {
      const item = element("li");
      item.append(
        element("code", "finale-skill", `/graft:${line.skill}`),
        element("span", undefined, line.text),
      );
      return item;
    }),
  );
  section.append(chips, lines);
  return section;
}

function installSection(): HTMLElement {
  const section = element("section", "finale-install");
  const status = element("span", "finale-status");
  status.setAttribute("aria-live", "polite");
  const copy = element("button", "finale-copy", "Install Graft") as HTMLButtonElement;
  copy.type = "button";
  copy.addEventListener("click", () => {
    const done = (text: string): void => {
      status.textContent = text;
    };
    try {
      navigator.clipboard
        .writeText(INSTALL_LINE)
        .then(() => done("Copied. Paste it into Claude Code."))
        .catch(() => done("Copy the line above into Claude Code."));
    } catch {
      done("Copy the line above into Claude Code.");
    }
  });
  const row = element("div", "finale-install-row");
  row.append(copy, link("Install instructions", INSTALL_URL), status);
  section.append(
    element("code", "finale-install-line", INSTALL_LINE),
    row,
    element(
      "p",
      "finale-note",
      "Using a team's own copy of Graft? Its install line is in the README you came from.",
    ),
  );
  return section;
}

function againSection(playback: Playback): HTMLElement {
  const nav = element("nav", "finale-again");
  nav.setAttribute("aria-label", "Try another start");
  nav.append(element("span", "finale-again-label", "Try another start:"));
  for (const scenario of playback.byId.values()) {
    if (scenario.kind === "continue" || scenario.id === playback.path[0]) continue;
    const name = skillName(scenario);
    nav.append(
      link(`${name[0].toUpperCase()}${name.slice(1)}`, formatHash([scenario.id]), "finale-start"),
    );
  }
  return nav;
}

// Grows the panel out of the stage's PR card.
function grow(dom: FinaleDom, panel: HTMLElement, number: number | undefined): void {
  if (dom.reduced || typeof panel.animate !== "function") return;
  const card = document.querySelector(`[data-card="pr:${number}"]`);
  const from = card?.getBoundingClientRect();
  const to = panel.getBoundingClientRect();
  const frames: Keyframe[] =
    from && from.width > 0 && to.width > 0
      ? [
          {
            transformOrigin: "top left",
            transform: `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${from.width / to.width}, ${from.height / to.height})`,
            opacity: 0.6,
          },
          { transformOrigin: "top left", transform: "none", opacity: 1 },
        ]
      : [
          { transform: "scale(0.9)", opacity: 0 },
          { transform: "none", opacity: 1 },
        ];
  panel.animate(frames, { duration: 600, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" });
  dom.root.querySelectorAll(".finale-recap, .finale-install, .finale-again").forEach((part) =>
    (part as HTMLElement).animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: 400,
      delay: 500,
      fill: "backwards",
    }),
  );
}

export function initFinale(): void {
  finaleDom = {
    root: document.getElementById("finale")!,
    reduced: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  };
}

export function showFinale(playback: Playback): void {
  const dom = finaleDom;
  if (!dom) return;
  const key = `${playback.path.join("/")}@${playback.position}`;
  if (dom.shown === key && !dom.root.hidden) return;
  const appearing = dom.root.hidden;
  dom.shown = key;
  const result = finale(playback.byId, playback.steps, playback.position, playback.repo);
  const parts: HTMLElement[] = [];
  const panel = result.pr ? prPanel(result.pr, result.kind === "review") : undefined;
  if (panel) parts.push(panel);
  parts.push(recapSection(result), installSection(), againSection(playback));
  const inner = element("div", "finale-inner");
  inner.append(...parts);
  dom.root.replaceChildren(inner);
  dom.root.hidden = false;
  document.body.classList.add("finale-on");
  if (appearing && panel) grow(dom, panel, result.pr?.number);
}

export function hideFinale(): void {
  const dom = finaleDom;
  if (!dom || dom.root.hidden) return;
  dom.root.hidden = true;
  dom.root.replaceChildren();
  dom.shown = undefined;
  document.body.classList.remove("finale-on");
}

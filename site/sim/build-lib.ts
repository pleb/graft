import { existsSync, readdirSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { Event, Repo, Scenario } from "./events.ts";

export class BuildError extends Error {}

export type Loaded = { scenarios: Scenario[]; repo: Repo };

export type PlayerFile = { name: string; text: string };

const REPO_FILE = "repo.ts";
const EMPTY_REPO: Repo = { name: "", files: {} };
const REPO_URL = "https://github.com/pleb/graft";

async function defaultExport(path: string): Promise<unknown> {
  const module = (await import(pathToFileURL(path).href)) as { default?: unknown };
  if (module.default === undefined) throw new BuildError(`${path} has no default export`);
  return module.default;
}

export async function loadScenarios(dir: string): Promise<Loaded> {
  const root = resolve(dir);
  if (!existsSync(root)) return { scenarios: [], repo: EMPTY_REPO };
  const names = readdirSync(root)
    .filter((name) => name.endsWith(".ts") && name !== REPO_FILE)
    .sort();
  const scenarios: Scenario[] = [];
  for (const name of names) scenarios.push((await defaultExport(join(root, name))) as Scenario);
  const repoPath = join(root, REPO_FILE);
  const repo = existsSync(repoPath) ? ((await defaultExport(repoPath)) as Repo) : EMPTY_REPO;
  return { scenarios, repo };
}

type Indexed = { event: Event; index: number };

function flatten(scenario: Scenario, earlier: string[]): Indexed[] {
  return scenario.events
    .map((event, index) => ({ event, index }))
    .filter(
      ({ event }) =>
        (event.after ?? []).every((id) => earlier.includes(id)) &&
        !(event.notAfter ?? []).some((id) => earlier.includes(id)),
    );
}

type State = {
  files: Map<string, string>;
  agents: Set<string>;
  prs: Set<number>;
  commits: Set<string>;
  chapters: Set<string>;
  prEvent: boolean;
};

function cloneState(state: State): State {
  return {
    files: new Map(state.files),
    agents: new Set(state.agents),
    prs: new Set(state.prs),
    commits: new Set(state.commits),
    chapters: new Set(state.chapters),
    prEvent: state.prEvent,
  };
}

function occurrences(text: string, find: string): number {
  if (find === "") return 0;
  let count = 0;
  for (let at = text.indexOf(find); at !== -1; at = text.indexOf(find, at + 1)) count++;
  return count;
}

function prFrom(from: string | undefined): number | undefined {
  const match = from?.match(/^pr:(\d+)$/);
  return match ? Number(match[1]) : undefined;
}

function firstPrompt(events: Indexed[]): string | undefined {
  const found = events.find(({ event }) => event.type === "prompt");
  return found?.event.type === "prompt" ? found.event.text : undefined;
}

function findCycle(byId: Map<string, Scenario>): string[] | undefined {
  const done = new Set<string>();
  const stack: string[] = [];
  const visit = (id: string): string[] | undefined => {
    const at = stack.indexOf(id);
    if (at !== -1) return [...stack.slice(at), id];
    if (done.has(id)) return undefined;
    stack.push(id);
    for (const event of byId.get(id)?.events ?? []) {
      if (event.type !== "handoff") continue;
      for (const choice of event.choices) {
        if (!byId.has(choice.next)) continue;
        const cycle = visit(choice.next);
        if (cycle) return cycle;
      }
    }
    stack.pop();
    done.add(id);
    return undefined;
  };
  for (const id of byId.keys()) {
    const cycle = visit(id);
    if (cycle) return cycle;
  }
  return undefined;
}

// Replays every path from every start and helper scenario and returns each failure found.
export function check(scenarios: Scenario[], repo: Repo): string[] {
  const failures = new Set<string>();
  const byId = new Map<string, Scenario>();
  for (const scenario of scenarios) {
    if (byId.has(scenario.id)) failures.add(`Scenario id ${scenario.id} repeats`);
    byId.set(scenario.id, scenario);
  }
  const cycle = findCycle(byId);
  if (cycle) {
    failures.add(`The hand-off graph has a cycle: ${cycle.join(" › ")}`);
    return [...failures];
  }

  const walk = (scenario: Scenario, earlier: string[], state: State): void => {
    const path = [...earlier, scenario.id];
    const fail = (index: number, type: string, message: string): void => {
      failures.add(`${path.join(" › ")}: ${scenario.id} event ${index} (${type}): ${message}`);
    };
    const events = flatten(scenario, earlier);
    for (const [position, { event, index }] of events.entries()) {
      const failHere = (message: string): void => fail(index, event.type, message);
      switch (event.type) {
        case "chapter":
          if (state.chapters.has(event.id)) failHere(`chapter id ${event.id} repeats`);
          state.chapters.add(event.id);
          break;
        case "ask":
          for (const question of event.questions) {
            const labels = question.options.map((option) => option.label);
            if (!labels.includes(question.answer))
              failHere(`answer "${question.answer}" is not an option of "${question.question}"`);
            else if (question.recommended && question.answer !== labels[0])
              failHere(
                `"${question.question}" is recommended but not answered with its first option`,
              );
          }
          break;
        case "agent.start": {
          if (state.agents.has(event.id)) failHere(`agent ${event.id} starts while running`);
          state.agents.add(event.id);
          const pr = prFrom(event.from);
          if (pr !== undefined && !state.prs.has(pr)) failHere(`PR #${pr} is not on stage`);
          break;
        }
        case "agent.done":
          if (!state.agents.delete(event.id))
            failHere(`agent ${event.id} finishes without starting`);
          break;
        case "file.create":
          state.files.set(event.path, event.content);
          break;
        case "file.modify": {
          let text = state.files.get(event.path);
          if (text === undefined) {
            failHere(`${event.path} does not exist`);
            break;
          }
          for (const edit of event.edits) {
            const count = occurrences(text, edit.find);
            if (count !== 1) {
              failHere(`find ${JSON.stringify(edit.find)} occurs ${count} times in ${event.path}`);
              continue;
            }
            text = text.replace(edit.find, () => edit.replace);
          }
          state.files.set(event.path, text);
          break;
        }
        case "git.commit":
          state.commits.add(event.id);
          break;
        case "pr.seed":
          state.prs.add(event.number);
          break;
        case "pr.open":
          for (const id of event.commits)
            if (!state.commits.has(id)) failHere(`commit ${id} is not a git.commit id`);
          state.prs.add(event.number);
          state.prEvent = true;
          break;
        case "pr.comment":
          if (!state.prs.has(event.number)) failHere(`PR #${event.number} is not on stage`);
          state.prEvent = true;
          break;
        case "end":
          if (!state.prEvent) failHere("end follows no pr.open or pr.comment");
          break;
        case "handoff":
          if (position !== events.length - 1) failHere("handoff is not the last event");
          break;
      }
    }

    const last = events.at(-1)?.event;
    if (last?.type !== "handoff") {
      if (last?.type !== "end") failures.add(`${path.join(" › ")}: the path does not end in end`);
      if (state.agents.size > 0)
        failures.add(
          `${path.join(" › ")}: agents never finish: ${[...state.agents].sort().join(", ")}`,
        );
      return;
    }
    const handoffIndex = events.at(-1)!.index;
    for (const choice of last.choices) {
      const next = byId.get(choice.next);
      if (!next) {
        fail(handoffIndex, "handoff", `names unknown scenario ${choice.next}`);
        continue;
      }
      const prompt = firstPrompt(flatten(next, path));
      if (prompt !== choice.command)
        fail(
          handoffIndex,
          "handoff",
          `command ${JSON.stringify(choice.command)} is not ${next.id}'s first prompt ${JSON.stringify(prompt ?? null)}`,
        );
      walk(next, path, cloneState(state));
    }
  };

  for (const scenario of scenarios) {
    if (scenario.kind === "continue") continue;
    walk(scenario, [], {
      files: new Map(Object.entries(repo.files)),
      agents: new Set(),
      prs: new Set(),
      commits: new Set(),
      chapters: new Set(),
      prEvent: false,
    });
  }
  return [...failures];
}

// Copied from skills/diff/build-lib.ts so the diff skill stays independent.
export function scriptJson(value: unknown): string {
  return JSON.stringify(value).replace(
    /[<>&\u2028\u2029]/g,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

const IMPORT = /^[ \t]*import\s+([^;"']*?)\s*from\s*(["'])([^"']*)\2[ \t]*;?/gm;
const SIBLING = /^\.\/[^/]+\.ts$/;
const EXPORT_DECLARATION =
  /^([ \t]*)export\s+(?=(?:async\s+)?function\b|const\b|let\b|var\b|class\b)/gm;
const LEFTOVER = /^[ \t]*(import|export)\b.*$/m;
const IDENTIFIER = /[A-Za-z_$][\w$]*/g;

// Declarations formatted at column 0 are the top-level ones.
function topLevelNames(code: string): string[] {
  const names: string[] = [];
  for (const match of code.matchAll(
    /^(?:(?:async\s+)?function\*?\s*([A-Za-z_$][\w$]*)|class\s+([A-Za-z_$][\w$]*)|(?:const|let|var)\s+(\{[^}]*\}|\[[^\]]*\]|[A-Za-z_$][\w$]*))/gm,
  )) {
    const name = match[1] ?? match[2];
    if (name) {
      names.push(name);
      continue;
    }
    const binding = match[3];
    if (binding.startsWith("{") || binding.startsWith("[")) {
      // In `{ key: alias }` the alias is the bound name.
      const inner = binding.slice(1, -1).replace(/[A-Za-z_$][\w$]*\s*:/g, "");
      names.push(...(inner.replace(/=[^,]*/g, "").match(IDENTIFIER) ?? []));
    } else names.push(binding);
  }
  return names;
}

// Joins the player files, in dependency order, into one classic script.
export function linkPlayer(files: PlayerFile[]): string {
  const owners = new Map<string, string>();
  const parts: string[] = [];
  for (const file of files) {
    let code = stripTypeScriptTypes(file.text);
    code = code.replace(IMPORT, (statement, clause: string, _quote: string, from: string) => {
      if (/^\*\s*as\b/.test(clause) || /,\s*\*\s*as\b/.test(clause))
        throw new BuildError(`${file.name}: namespace import: ${statement.trim()}`);
      if (!SIBLING.test(from))
        throw new BuildError(`${file.name}: import from outside player/: ${statement.trim()}`);
      return "";
    });
    code = code.replace(EXPORT_DECLARATION, "$1");
    const leftover = code.match(LEFTOVER);
    if (leftover)
      throw new BuildError(`${file.name}: leftover ${leftover[1]}: ${leftover[0].trim()}`);
    for (const name of topLevelNames(code)) {
      const owner = owners.get(name);
      if (owner !== undefined)
        throw new BuildError(`${file.name}: top-level name ${name} is also declared in ${owner}`);
      owners.set(name, file.name);
    }
    parts.push(`// ${file.name}\n${code.trim()}`);
  }
  const body = `(() => {\n"use strict";\n${parts.join("\n\n")}\n})();`;
  if (/<\/script|<!--/i.test(body))
    throw new BuildError("The player holds </script or <!--, which would end its script early");
  return `<script>\n${body}\n</script>`;
}

function commitHtml(commit: string | undefined): string {
  if (commit === undefined) return "a local build";
  if (!/^[0-9a-f]{7,40}$/i.test(commit)) throw new BuildError(`${commit} is not a commit sha`);
  return `<a href="${REPO_URL}/commit/${commit}">${commit.slice(0, 7)}</a>`;
}

export function renderPage(
  template: string,
  loaded: Loaded,
  player: string,
  commit: string | undefined,
): string {
  const values: Record<string, string> = {
    __SIM_DATA__: scriptJson(loaded),
    __SIM_COMMIT__: commitHtml(commit),
    __SIM_PLAYER__: player,
  };
  for (const placeholder of Object.keys(values))
    if (template.split(placeholder).length !== 2)
      throw new BuildError(`The template must hold ${placeholder} once`);
  return template.replace(/__SIM_[A-Z]+__/g, (placeholder) => values[placeholder] ?? placeholder);
}

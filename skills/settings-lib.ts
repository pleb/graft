// Resolves ~/.my-graft/graft-settings.json for a repo root. Keep it free of JSX
// and Node or claude-code imports: hooks/register.tsx and vitest both load it,
// and the caller supplies the filesystem and git through Environment.

import type { Catalog, CatalogSetting } from "./settings-catalog.ts";

export type SkillValues = Record<string, Record<string, unknown>>;

export type Scope = { key: string; overrides: SkillValues };

export type SettingsFile = { defaults: SkillValues; scopes: Scope[] };

export type ParsedFile =
  | { isParsed: true; file: SettingsFile }
  | { isParsed: false; error: string };

export type Environment = {
  home: string;
  // The real path, or undefined when the path does not exist.
  resolve: (path: string) => Promise<string | undefined>;
  normaliseRoot: (path: string) => Promise<string>;
};

export type ScopePath = { path: string; isSubtree: boolean };

export type Layer = { source: string; values: SkillValues };

export type ExplainedSetting = {
  key: string;
  skill: string;
  name: string;
  value: string;
  source: string;
};

export type Resolved =
  | { isResolved: true; root: string; settings: ExplainedSetting[] }
  | { isResolved: false; error: string };

export const DEFAULT_SOURCE = "Default";
export const DEFAULTS_SOURCE = "Defaults";

const SUBTREE = "/*";

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const isScopeKey = (key: string) => key.startsWith("/") || key.startsWith("~");

function skillValues(entry: Record<string, unknown>, where: string): SkillValues | string {
  const values: SkillValues = {};
  for (const [skill, settings] of Object.entries(entry)) {
    if (!isObject(settings)) {
      return `${where}${JSON.stringify(skill)} is not an object`;
    }
    values[skill] = settings;
  }

  return values;
}

export function parseSettingsFile(text: string | undefined): ParsedFile {
  if (text === undefined) {
    return { isParsed: true, file: { defaults: {}, scopes: [] } };
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    return { isParsed: false, error: error instanceof Error ? error.message : String(error) };
  }
  if (!isObject(json)) {
    return { isParsed: false, error: "it is not a JSON object" };
  }
  const defaultEntries: Record<string, unknown> = {};
  const scopes: Scope[] = [];
  for (const [key, entry] of Object.entries(json)) {
    if (!isScopeKey(key)) {
      defaultEntries[key] = entry;
      continue;
    }
    if (!isObject(entry)) {
      return { isParsed: false, error: `the scope ${JSON.stringify(key)} is not an object` };
    }
    const overrides = "overrides" in entry ? entry.overrides : {};
    if (!isObject(overrides)) {
      return {
        isParsed: false,
        error: `the overrides of ${JSON.stringify(key)} are not an object`,
      };
    }
    const values = skillValues(overrides, `in ${JSON.stringify(key)}, the skill `);
    if (typeof values === "string") {
      return { isParsed: false, error: values };
    }
    scopes.push({ key, overrides: values });
  }
  const defaults = skillValues(defaultEntries, "the skill ");
  if (typeof defaults === "string") {
    return { isParsed: false, error: defaults };
  }

  return { isParsed: true, file: { defaults, scopes } };
}

function expandHome(path: string, home: string): string {
  if (path === "~") {
    return home;
  }

  return path.startsWith("~/") ? `${home}${path.slice(1)}` : path;
}

function lexical(path: string): string {
  if (!path.startsWith("/")) {
    return path.replace(/\/+$/, "");
  }
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (part === "..") {
      parts.pop();
    } else if (part !== "" && part !== ".") {
      parts.push(part);
    }
  }

  return `/${parts.join("/")}`;
}

// Expands `~` and resolves symlinks. A path that does not exist is only normalised lexically.
export async function normalisePath(
  path: string,
  env: Pick<Environment, "home" | "resolve">,
): Promise<string> {
  const expanded = expandHome(path, env.home);

  return (await env.resolve(expanded)) ?? lexical(expanded);
}

export async function normaliseScopeKey(
  key: string,
  env: Pick<Environment, "home" | "resolve">,
): Promise<ScopePath> {
  const isSubtree = key.endsWith(SUBTREE);

  return {
    path: await normalisePath(isSubtree ? key.slice(0, -SUBTREE.length) || "/" : key, env),
    isSubtree,
  };
}

export async function normaliseRootPath(root: string, env: Environment): Promise<string> {
  return normalisePath(await env.normaliseRoot(expandHome(root, env.home)), env);
}

const depth = (path: string) => path.split("/").filter((part) => part !== "").length;

const isUnder = (path: string, dir: string) =>
  dir === "/" ? path !== "/" : path.startsWith(`${dir}/`);

// The layers that apply to a normalised path, least specific first: the
// defaults, then matching `/*` scopes by depth, then exact scopes. Without
// exact scopes, these are the layers a scope at `path` inherits from.
export async function layersFor(
  file: SettingsFile,
  path: string,
  env: Pick<Environment, "home" | "resolve">,
  { isExactIncluded = true } = {},
): Promise<Layer[]> {
  const normalised = await Promise.all(
    file.scopes.map(async (scope) => ({ scope, ...(await normaliseScopeKey(scope.key, env)) })),
  );
  const subtrees = normalised
    .filter((scope) => scope.isSubtree && isUnder(path, scope.path))
    .sort((a, b) => depth(a.path) - depth(b.path));
  const exact = isExactIncluded
    ? normalised.filter((scope) => !scope.isSubtree && scope.path === path)
    : [];

  return [
    { source: DEFAULTS_SOURCE, values: file.defaults },
    ...[...subtrees, ...exact].map(({ scope }) => ({
      source: scope.key,
      values: scope.overrides,
    })),
  ];
}

export const isValid = (setting: CatalogSetting, value: unknown): value is string =>
  typeof value === "string" && (value === setting.defaultValue || setting.values.includes(value));

export function explainLayers(layers: Layer[], settings: CatalogSetting[]): ExplainedSetting[] {
  return settings.map((setting) => {
    let value = setting.defaultValue;
    let source = DEFAULT_SOURCE;
    for (const layer of layers) {
      const stored = layer.values[setting.skill]?.[setting.name];
      if (isValid(setting, stored)) {
        value = stored;
        source = layer.source;
      }
    }

    return { key: setting.key, skill: setting.skill, name: setting.name, value, source };
  });
}

export function effectiveValues(
  settings: ExplainedSetting[],
): Record<string, Record<string, string>> {
  const values: Record<string, Record<string, string>> = {};
  for (const { skill, name, value } of settings) {
    (values[skill] ??= {})[name] = value;
  }

  return values;
}

export async function resolveSettings(
  text: string | undefined,
  catalog: Catalog,
  root: string,
  env: Environment,
): Promise<Resolved> {
  if (!catalog.isParsed) {
    return { isResolved: false, error: `the settings catalog does not parse: ${catalog.error}` };
  }
  const parsed = parseSettingsFile(text);
  if (!parsed.isParsed) {
    return { isResolved: false, error: `graft-settings.json does not parse: ${parsed.error}` };
  }
  const path = await normaliseRootPath(root, env);
  const layers = await layersFor(parsed.file, path, env);

  return { isResolved: true, root: path, settings: explainLayers(layers, catalog.settings) };
}

// The main worktree from `git worktree list --porcelain`: its first entry,
// unless that entry is bare.
export function mainWorktree(porcelain: string): string | undefined {
  const first = porcelain.split("\n\n")[0]?.split("\n") ?? [];
  const main = first.find((line) => line.startsWith("worktree "))?.slice("worktree ".length);

  return first.includes("bare") ? undefined : main;
}

export type Edited =
  | { isEdited: true; json: Record<string, unknown> }
  | { isEdited: false; error: string };

function withEntry(
  parent: Record<string, unknown>,
  key: string,
  entry: Record<string, unknown>,
): Record<string, unknown> {
  const next = { ...parent };
  if (Object.keys(entry).length === 0) {
    delete next[key];
  } else {
    next[key] = entry;
  }

  return next;
}

// Sets a setting in the defaults (`scope` undefined) or in a scope's
// overrides, and removes it when `value` is undefined. A skill entry,
// `overrides` or scope left empty is dropped; every other key is kept.
export function withSetting(
  json: Record<string, unknown>,
  scope: string | undefined,
  skill: string,
  name: string,
  value: string | undefined,
): Edited {
  const holder = scope === undefined ? json : (json[scope] ?? {});
  if (!isObject(holder)) {
    return { isEdited: false, error: `the scope ${JSON.stringify(scope)} is not an object` };
  }
  const values = scope === undefined ? holder : (holder.overrides ?? {});
  if (!isObject(values)) {
    return {
      isEdited: false,
      error: `the overrides of ${JSON.stringify(scope)} are not an object`,
    };
  }
  const entry = values[skill] ?? {};
  if (!isObject(entry)) {
    return { isEdited: false, error: `the skill ${JSON.stringify(skill)} is not an object` };
  }
  const nextEntry = { ...entry };
  if (value === undefined) {
    delete nextEntry[name];
  } else {
    nextEntry[name] = value;
  }
  const nextValues = withEntry(values, skill, nextEntry);
  if (scope === undefined) {
    return { isEdited: true, json: nextValues };
  }

  return {
    isEdited: true,
    json: withEntry(json, scope, withEntry(holder, "overrides", nextValues)),
  };
}

export type NewScope = { isValid: true; key: string } | { isValid: false; error: string };

// Checks a scope path typed into the pane against the scope keys it already has.
export async function newScopeKey(
  input: string,
  existing: readonly string[],
  env: Pick<Environment, "home" | "resolve">,
): Promise<NewScope> {
  const path = input.trim();
  if (!path.startsWith("/") && !path.startsWith("~/")) {
    return { isValid: false, error: "A scope path starts with / or ~/." };
  }
  const key = path.replace(/\/+$/, "") || "/";
  const scope = await normaliseScopeKey(key, env);
  for (const other of existing) {
    const otherScope = await normaliseScopeKey(other, env);
    if (otherScope.path === scope.path && otherScope.isSubtree === scope.isSubtree) {
      return { isValid: false, error: `${key} is the same scope as ${other}.` };
    }
  }

  return { isValid: true, key };
}

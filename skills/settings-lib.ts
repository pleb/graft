// Resolves ~/.my-graft/graft-settings.json, then the root's own settings files, for a repo root. Keep it free of JSX
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
  // On "win32", an MSYS path such as /c/x is read as C:/x. The running platform when omitted.
  platform?: string;
  // This machine's names, whose admin shares (//name/c$/x) are read as drives like localhost's.
  hostnames?: string[];
};

export type PathEnvironment = Omit<Environment, "normaliseRoot">;

export type ScopePath = { path: string; isSubtree: boolean };

export type Layer = { source: string; values: SkillValues };

export type ProjectFile = { source: string; text: string | undefined };

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

const GLOBAL_KEYS = new Set(["yolo.acknowledged"]);

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const DRIVE = /^[A-Za-z]:[\\/]/;
const UNC = /^[\\/]{2}[^\\/]+[\\/][^\\/]+/;

// A drive-letter or UNC path, with either separator.
export const isWindowsPath = (path: string) => DRIVE.test(path) || UNC.test(path);

export const isScopeKey = (key: string) =>
  key.startsWith("/") || key.startsWith("~") || isWindowsPath(key);

const slashed = (path: string) => (isWindowsPath(path) ? path.replaceAll("\\", "/") : path);

const comparable = (path: string) => (isWindowsPath(path) ? path.toLowerCase() : path);

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
    if (!("overrides" in entry) && Object.values(entry).some(isObject)) {
      return { isParsed: false, error: `the scope ${JSON.stringify(key)} has no overrides` };
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

const runningPlatform = () => (globalThis as { process?: { platform?: string } }).process?.platform;

const ADMIN_SHARE = /^[\\/]{2}([^\\/]+)[\\/]([A-Za-z])\$(?:[\\/]|$)/;

// The drive form of a local admin share (//localhost/c$/x is C:/x) and, on
// Windows, of an MSYS path (/c/x is C:/x).
export function driveForm(
  path: string,
  {
    platform = runningPlatform(),
    hostnames = [],
  }: Pick<Environment, "platform" | "hostnames"> = {},
): string {
  const share = ADMIN_SHARE.exec(path);
  const host = share?.[1]!.toLowerCase();
  const local = ["localhost", "127.0.0.1", ...hostnames.map((name) => name.toLowerCase())];
  if (share !== null && local.includes(host!)) {
    return `${share[2]!.toUpperCase()}:/${path.slice(share[0].length)}`;
  }
  const msys = platform === "win32" ? /^\/([A-Za-z])(?:\/|$)/.exec(path) : null;

  return msys === null ? path : `${msys[1]!.toUpperCase()}:/${path.slice(msys[0].length)}`;
}

function expandHome(
  path: string,
  env: Pick<Environment, "home" | "platform" | "hostnames">,
): string {
  const slashedHome = slashed(driveForm(env.home, env));
  if (path === "~") {
    return slashedHome;
  }
  const isHomeRelative =
    path.startsWith("~/") || (isWindowsPath(slashedHome) && path.startsWith("~\\"));

  return isHomeRelative
    ? slashed(`${slashedHome.replace(/\/$/, "")}/${path.slice(2)}`)
    : driveForm(path, env);
}

// `/`, a lowercased drive such as `c:/`, or `//server/share`.
function rootOf(path: string): string | undefined {
  const drive = /^[A-Za-z]:\//.exec(path)?.[0];
  if (drive !== undefined) {
    return drive.toLowerCase();
  }

  return /^\/\/[^/]+\/[^/]+/.exec(path)?.[0] ?? (path.startsWith("/") ? "/" : undefined);
}

function lexical(path: string): string {
  const slashedPath = slashed(path);
  const root = rootOf(slashedPath);
  if (root === undefined) {
    return slashedPath.replace(/\/+$/, "");
  }
  const parts: string[] = [];
  for (const part of slashedPath.slice(root.length).split("/")) {
    if (part === "..") {
      parts.pop();
    } else if (part !== "" && part !== ".") {
      parts.push(part);
    }
  }
  const below = parts.join("/");

  return root.endsWith("/") || below === "" ? `${root}${below}` : `${root}/${below}`;
}

export const isSamePath = (a: string, b: string) =>
  comparable(lexical(a)) === comparable(lexical(b));

export async function normalisePath(path: string, env: PathEnvironment): Promise<string> {
  const expanded = expandHome(path, env);

  return lexical(driveForm((await env.resolve(expanded)) ?? expanded, env));
}

export async function normaliseScopeKey(key: string, env: PathEnvironment): Promise<ScopePath> {
  const path = slashed(expandHome(key, env));
  const isSubtree = path.endsWith(SUBTREE);
  const parent = path.slice(0, -SUBTREE.length);
  const dir = parent === "" || /^[A-Za-z]:$/.test(parent) ? `${parent}/` : parent;

  return { path: await normalisePath(isSubtree ? dir : path, env), isSubtree };
}

export async function normaliseRootPath(root: string, env: Environment): Promise<string> {
  return normalisePath(await env.normaliseRoot(expandHome(root, env)), env);
}

const depth = (path: string) => path.split("/").filter((part) => part !== "").length;

function isUnder(path: string, dir: string): boolean {
  const [under, above] = [comparable(path), comparable(dir)];

  return above.endsWith("/")
    ? under !== above && under.startsWith(above)
    : under.startsWith(`${above}/`);
}

// Least specific first, so later layers win: defaults, `/*` scopes by depth,
// then exact scopes. `isSubtree` gives the layers for every path beneath `path`.
export async function layersFor(
  file: SettingsFile,
  path: string,
  env: PathEnvironment,
  { isSubtree = false } = {},
): Promise<Layer[]> {
  const normalised = await Promise.all(
    file.scopes.map(async (scope) => ({ scope, ...(await normaliseScopeKey(scope.key, env)) })),
  );
  const subtrees = normalised
    .filter(
      (scope) =>
        scope.isSubtree &&
        ((isSubtree && isSamePath(scope.path, path)) || isUnder(path, scope.path)),
    )
    .sort((a, b) => depth(a.path) - depth(b.path));
  const exact = isSubtree
    ? []
    : normalised.filter((scope) => !scope.isSubtree && isSamePath(scope.path, path));

  return [
    { source: DEFAULTS_SOURCE, values: file.defaults },
    ...[...subtrees, ...exact].map(({ scope }) => ({
      source: scope.key,
      values: scope.overrides,
    })),
  ];
}

export async function inheritedLayers(
  file: SettingsFile,
  key: string,
  env: PathEnvironment,
): Promise<Layer[]> {
  const { path, isSubtree } = await normaliseScopeKey(key, env);

  return (await layersFor(file, path, env, { isSubtree })).filter(({ source }) => source !== key);
}

export function isValid(setting: CatalogSetting, value: unknown): boolean {
  const text = typeof value === "number" || typeof value === "boolean" ? String(value) : value;

  if (typeof text !== "string") {
    return false;
  }

  return setting.isText
    ? text.trim() !== "" && !/[\r\n]/.test(text)
    : text === setting.defaultValue || setting.values.includes(text);
}

export function explainLayers(layers: Layer[], settings: CatalogSetting[]): ExplainedSetting[] {
  return settings.map((setting) => {
    let value = setting.defaultValue;
    let source = DEFAULT_SOURCE;
    const applied = GLOBAL_KEYS.has(setting.key)
      ? layers.filter(({ source }) => source === DEFAULTS_SOURCE)
      : layers;
    for (const layer of applied) {
      const stored = layer.values[setting.skill]?.[setting.name];
      if (isValid(setting, stored)) {
        value = String(stored);
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

// At the root's own git top level (a linked worktree's, not its main checkout's), or the root
// itself outside a repo, the local file last. Joined as text so `..` is left for the OS to apply.
export function projectFilePaths(top: string): string[] {
  const dir = slashed(top).replace(/\/+$/, "");

  return [`${dir}/.claude/graft-settings.json`, `${dir}/.claude/graft-settings.local.json`];
}

function projectLayer(file: ProjectFile): Layer | string {
  const parsed = parseSettingsFile(file.text);
  if (!parsed.isParsed) {
    return `${file.source} does not parse: ${parsed.error}`;
  }
  const [scope] = parsed.file.scopes;
  if (scope !== undefined) {
    return `${file.source} takes skill keys only, not the scope ${JSON.stringify(scope.key)}`;
  }

  return { source: file.source, values: parsed.file.defaults };
}

// Project files apply over every scope, later files over earlier ones.
export function projectLayers(files: ProjectFile[]): Layer[] | string {
  const layers: Layer[] = [];
  for (const file of files.filter(({ text }) => text !== undefined)) {
    const layer = projectLayer(file);
    if (typeof layer === "string") {
      return layer;
    }
    layers.push(layer);
  }

  return layers;
}

export async function resolveSettings(
  text: string | undefined,
  catalog: Catalog,
  root: string,
  env: Environment,
  projectFiles: ProjectFile[] = [],
): Promise<Resolved> {
  if (!catalog.isParsed) {
    return { isResolved: false, error: `the settings catalog does not parse: ${catalog.error}` };
  }
  const parsed = parseSettingsFile(text);
  if (!parsed.isParsed) {
    return { isResolved: false, error: `graft-settings.json does not parse: ${parsed.error}` };
  }
  const path = await normaliseRootPath(root, env);
  const project = projectLayers(projectFiles);
  if (typeof project === "string") {
    return { isResolved: false, error: project };
  }
  const layers = [...(await layersFor(parsed.file, path, env)), ...project];

  return { isResolved: true, root: path, settings: explainLayers(layers, catalog.settings) };
}

// Git lists the main worktree first in `git worktree list --porcelain`.
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

// `scope` undefined edits the defaults; `value` undefined removes the setting.
// Empty skill entries are dropped, and so is a scope left with nothing else;
// a scope with other keys keeps an empty `overrides`, which parsing requires
// when one of them holds an object.
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

  const hasOtherKeys = Object.keys(holder).some((key) => key !== "overrides");
  const nextHolder = hasOtherKeys
    ? { ...holder, overrides: nextValues }
    : withEntry(holder, "overrides", nextValues);

  return { isEdited: true, json: withEntry(json, scope, nextHolder) };
}

const SCOPE_FORMS =
  "A scope path starts with /, ~/, a drive (C:/ or C:\\) or a share (//server/share or \\\\server\\share).";

export type NewScope = { isValid: true; key: string } | { isValid: false; error: string };

export async function newScopeKey(
  input: string,
  existing: readonly string[],
  env: PathEnvironment,
): Promise<NewScope> {
  const path = input.trim();
  if (!path.startsWith("/") && !path.startsWith("~/") && !isWindowsPath(path)) {
    return { isValid: false, error: SCOPE_FORMS };
  }
  const stripped = path.replace(/[\\/]+$/, "");
  const key = stripped === "" ? "/" : /^[A-Za-z]:$/.test(stripped) ? path.slice(0, 3) : stripped;
  const scope = await normaliseScopeKey(key, env);
  for (const other of existing) {
    const otherScope = await normaliseScopeKey(other, env);
    if (isSamePath(otherScope.path, scope.path) && otherScope.isSubtree === scope.isSubtree) {
      return { isValid: false, error: `${key} is the same scope as ${other}.` };
    }
  }

  return { isValid: true, key };
}

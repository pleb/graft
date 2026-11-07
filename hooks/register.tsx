import { atom, read, update } from "claude-code";
import type { Elements, EngineInterface, Register } from "claude-code";

import { parseCatalog } from "../skills/settings-catalog.ts";
import type { Catalog, CatalogSetting } from "../skills/settings-catalog.ts";
import {
  DEFAULT_SOURCE,
  explainLayers,
  inheritedLayers,
  isSamePath,
  isValid,
  layersFor,
  mainWorktree,
  newScopeKey,
  normalisePath,
  normaliseRootPath,
  normaliseScopeKey,
  parseSettingsFile,
  withSetting,
} from "../skills/settings-lib.ts";
import type {
  Environment,
  ExplainedSetting,
  SettingsFile,
  SkillValues,
} from "../skills/settings-lib.ts";
import {
  LOCAL_PROBE_ENV,
  checkBehind,
  isLookDue,
  lsRemoteEnv,
  noticeAction,
  noticeText,
  parseLsRemote,
  readMode,
} from "../skills/update-check-lib.ts";
import type { Behind, Git, Look, Mode, Notice } from "../skills/update-check-lib.ts";
import type { GraftSettingsPane } from "../types";

const PANE = "graft-settings";
const TITLE = "Graft settings";
const FILE = "graft-settings.json";
const SHOWN_FILE = `~/.my-graft/${FILE}`;
const DEFAULT = ":default";
const UNLISTED = ":unlisted";
const INHERIT = ":inherit";
const DEFAULTS_VIEW = ":defaults";
const EFFECTIVE_VIEW = ":effective";
const ADD_VIEW = ":add";
const LOCAL_MS = 30_000;
const NETWORK_MS = 60_000;

const isSaving = atom({ plugin: "graft", key: "isSaving" } as const, false);
const revision = atom({ plugin: "graft", key: "revision" } as const, 0);
const view = atom({ plugin: "graft", key: "view" } as const, DEFAULTS_VIEW);
const newScopes = atom({ plugin: "graft", key: "newScopes" } as const, [] as string[]);
const notice = atom({ plugin: "graft", key: "notice" } as const, "");
const effectivePath = atom({ plugin: "graft", key: "effectivePath" } as const, "");
const LOOK_KEY = "updateLook";
const NOTICE_KEY = "updateNotice";

type Json = Record<string, unknown>;

type ParsedJson =
  | { isParsed: true; json: Json; file: SettingsFile }
  | { isParsed: false; error: string };

type LoadedFile =
  | { isParsed: true; json: Json; file: SettingsFile; env: Environment }
  | { isParsed: false; error: string };

type Loaded = { catalog: Catalog; file: LoadedFile };

type Ui = Elements["terminal" | "desktop" | "vscode"];

type Ran = { isOk: boolean; stdout: string; stderr: string };

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

const shown = (value: unknown) => (typeof value === "string" ? value : JSON.stringify(value));

async function homeOf($: EngineInterface): Promise<string | undefined> {
  const home = await $.env.get("HOME");
  if (home !== undefined && home !== "") {
    return home;
  }
  const profile = await $.env.get("USERPROFILE");

  return profile === undefined || profile === "" ? undefined : profile;
}

async function hostnamesOf($: EngineInterface): Promise<string[]> {
  const names = [await $.env.get("COMPUTERNAME"), await $.env.get("HOSTNAME")];

  return names.filter((name): name is string => name !== undefined && name !== "");
}

// Hook modules have no Node process, so the platform comes from the environment.
async function platformOf($: EngineInterface): Promise<string> {
  return (await $.env.get("OS")) === "Windows_NT" ? "win32" : "posix";
}

async function clonePath($: EngineInterface): Promise<string | undefined> {
  const home = await homeOf($);

  return home === undefined ? undefined : `${home}/.my-graft`;
}

async function readText($: EngineInterface, path: string): Promise<string | undefined> {
  if (!(await $.fs.exists(path))) {
    return undefined;
  }

  return String(await $.fs.read(path));
}

async function gitRoot($: EngineInterface, path: string): Promise<{ top?: string; main?: string }> {
  const top = await run($, ["git", "-C", path, "rev-parse", "--show-toplevel"]);
  if (!top.isOk || top.stdout.trim() === "") {
    return {};
  }
  const list = await run($, ["git", "-C", top.stdout.trim(), "worktree", "list", "--porcelain"]);

  return { top: top.stdout.trim(), main: list.isOk ? mainWorktree(list.stdout) : undefined };
}

function environment(
  $: EngineInterface,
  machine: Pick<Environment, "home" | "platform" | "hostnames">,
): Environment {
  return {
    ...machine,
    resolve: (path) =>
      $.fs
        .stat(path, { resolve: true })
        .then((stat) => stat.realPath)
        .catch(() => undefined),
    normaliseRoot: async (path) => {
      const { top, main } = await gitRoot($, path);

      return main ?? top ?? path;
    },
  };
}

function parseFile(text: string | undefined): ParsedJson {
  const parsed = parseSettingsFile(text);
  if (!parsed.isParsed) {
    return parsed;
  }

  return {
    isParsed: true,
    json: text === undefined ? {} : (JSON.parse(text) as Json),
    file: parsed.file,
  };
}

async function load($: EngineInterface): Promise<Loaded> {
  const common = await readText($, `${$.plugin.root}/skills/common.md`).catch(() => undefined);
  const catalog: Catalog =
    common === undefined
      ? { isParsed: false, error: "skills/common.md cannot be read" }
      : parseCatalog(common);
  const home = await homeOf($);
  if (home === undefined) {
    return { catalog, file: { isParsed: false, error: "HOME and USERPROFILE are not set" } };
  }
  try {
    const parsed = parseFile(await readText($, `${home}/.my-graft/${FILE}`));

    return {
      catalog,
      file: parsed.isParsed
        ? {
            ...parsed,
            env: environment($, {
              home,
              platform: await platformOf($),
              hostnames: await hostnamesOf($),
            }),
          }
        : parsed,
    };
  } catch (error) {
    return { catalog, file: { isParsed: false, error: errorText(error) } };
  }
}

function flatten(values: SkillValues): [string, unknown][] {
  return Object.entries(values).flatMap(([skill, entry]) =>
    Object.entries(entry).map(([name, value]): [string, unknown] => [`${skill}.${name}`, value]),
  );
}

const isNumeric = (value: string) => value.trim() !== "" && Number.isFinite(Number(value));

function choicesOf(setting: CatalogSetting): string[] {
  if (setting.isText) {
    return [];
  }
  const choices = [...setting.values, setting.defaultValue];

  return choices.every(isNumeric) ? choices.sort((a, b) => Number(a) - Number(b)) : choices;
}

const conditionNote = (setting: CatalogSetting) =>
  setting.shownWhen === undefined
    ? undefined
    : `Applies when ${setting.shownWhen.key} is ${setting.shownWhen.value}.`;

const sourceLabel = ({ value, source }: ExplainedSetting) =>
  source === DEFAULT_SOURCE ? `${value} (Default)` : `${value} (from ${source})`;

// Text form of the settings, for surfaces that draw no pane and for mobile.
function describe({ catalog, file }: Loaded): string[] {
  const lines = [`Graft settings in ${SHOWN_FILE}`];
  if (!file.isParsed) {
    return [...lines, `${FILE} does not parse: ${file.error}`];
  }
  const { defaults, scopes } = file.file;
  const settings = catalog.isParsed ? catalog.settings : [];
  if (!catalog.isParsed) {
    lines.push(`The settings catalog in common.md does not parse: ${catalog.error}`);
    if (flatten(defaults).length === 0 && scopes.length === 0) {
      lines.push("No settings are set.");
    }
  }
  for (const setting of settings) {
    const value = defaults[setting.skill]?.[setting.name];
    const note = conditionNote(setting);
    const choices = setting.isText ? "" : ` (${choicesOf(setting).join(", ")})`;
    lines.push(
      `${setting.key}: ${value === undefined ? setting.defaultValue : shown(value)}${choices}`,
      `  ${setting.description}`,
      ...(note === undefined ? [] : [`  ${note}`]),
    );
  }
  const unknown = flatten(defaults).filter(([key]) => !settings.some((s) => s.key === key));
  if (catalog.isParsed && unknown.length > 0) {
    lines.push("Not in the catalog:");
  }
  lines.push(...unknown.map(([key, value]) => `${key}: ${shown(value)}`));
  for (const scope of scopes) {
    lines.push(`Overrides for ${scope.key}:`);
    const overrides = flatten(scope.overrides);
    if (overrides.length === 0) {
      lines.push("  No overrides.");
    }
    for (const [key, value] of overrides) {
      const setting = settings.find((s) => s.key === key);
      const mark = !catalog.isParsed
        ? ""
        : setting === undefined
          ? " (not in the catalog)"
          : isValid(setting, value)
            ? ""
            : " (not allowed)";
      lines.push(`  ${key}: ${shown(value)}${mark}`);
    }
  }

  return lines;
}

// Pass `network` (from networkEnv) only for a pull or push, so git never prompts.
async function run(
  $: EngineInterface,
  argv: readonly string[],
  network?: Record<string, string>,
): Promise<Ran> {
  try {
    const ran = await $.process.run(argv, {
      timeoutMs: network === undefined ? LOCAL_MS : NETWORK_MS,
      ...(network === undefined ? {} : { env: network }),
    });

    return { isOk: ran.exitCode === 0, stdout: ran.stdout, stderr: ran.stderr };
  } catch (error) {
    return { isOk: false, stdout: "", stderr: errorText(error) };
  }
}

const firstLine = (ran: Ran) =>
  ran.stderr.trim().split("\n")[0] || ran.stdout.trim().split("\n")[0] || "no output";

// The user's ssh command, as git picks it, made to fail instead of prompting.
// The batch option goes right after the program because ssh keeps the first value given for an option.
// PuTTY's plink and TortoisePlink reject `-o`, so they get `-batch`.
async function networkEnv($: EngineInterface, clone: string): Promise<Record<string, string>> {
  const command = (await $.env.get("GIT_SSH_COMMAND"))?.trim();
  const config = await run($, ["git", "-C", clone, "config", "core.sshCommand"]);
  const program = (await $.env.get("GIT_SSH"))?.trim();
  const option = (path: string) =>
    /(^|[\\/])(tortoise)?plink(\.exe)?$/i.test(path.replaceAll(/["']/g, ""))
      ? "-batch"
      : "-o BatchMode=yes";
  const batch = (ssh: string) => {
    const word = (/^(?:"(?:[^"\\]|\\.)*"|'[^']*'|\\.|[^\s"'\\])+/.exec(ssh) ??
      /^\S+/.exec(ssh))![0];

    return `${word} ${option(word)}${ssh.slice(word.length)}`;
  };
  const sshCommand =
    command !== undefined && command !== ""
      ? batch(command)
      : config.isOk && config.stdout.trim() !== ""
        ? batch(config.stdout.trim())
        : program !== undefined && program !== ""
          ? `'${program.replaceAll("'", "'\\''")}' ${option(program)}`
          : "ssh -o BatchMode=yes";

  return { GIT_TERMINAL_PROMPT: "0", GIT_SSH_COMMAND: sshCommand };
}

// `sha` is the last SHA found for `url`; a failed look keeps it.
type StoredLook = Look & { sha?: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

function storedLook(value: unknown): StoredLook | undefined {
  return isRecord(value) &&
    typeof value.url === "string" &&
    typeof value.at === "number" &&
    typeof value.isOk === "boolean" &&
    typeof value.failures === "number" &&
    (value.sha === undefined || typeof value.sha === "string")
    ? (value as StoredLook)
    : undefined;
}

function storedNotice(value: unknown): Notice | undefined {
  return isRecord(value) && typeof value.at === "number" && typeof value.sha === "string"
    ? { at: value.at, sha: value.sha }
    : undefined;
}

function localGit($: EngineInterface, clone: string): Git {
  return async (args) => {
    try {
      const ran = await $.process.run(["git", "-C", clone, ...args], {
        timeoutMs: LOCAL_MS,
        env: { ...LOCAL_PROBE_ENV },
      });

      return { exitCode: ran.exitCode, stdout: ran.stdout };
    } catch {
      return { exitCode: undefined, stdout: "" };
    }
  };
}

async function notifyMode($: EngineInterface, clone: string): Promise<Mode> {
  const parsed = parseSettingsFile(await readText($, `${clone}/${FILE}`).catch(() => undefined));

  return readMode(parsed.isParsed ? parsed.file.defaults.update?.notify : undefined);
}

async function setStatus($: EngineInterface, text: string | undefined) {
  $.ui.status(text);
  await $.state.set({ plugin: "graft", key: "isUpdateStatusShown" } as const, text !== undefined);
}

async function clearStatus($: EngineInterface) {
  const shown = await $.state.get({ plugin: "graft", key: "isUpdateStatusShown" } as const);
  if (shown.value === true) {
    await setStatus($, undefined);
  }
}

async function notify($: EngineInterface, mode: Mode, sha: string, result: Behind) {
  const now = await $.clock.now();
  const notified = await $.state.get({ plugin: "graft", key: "hasNotifiedUpdate" } as const);
  const action = noticeAction({
    mode,
    result,
    sha,
    last: storedNotice(await $.store.get(NOTICE_KEY)),
    hasSessionNotified: notified.value === true,
    now,
  });
  const text = noticeText(result);
  if (action === "toast" && text !== undefined) {
    await $.state.set({ plugin: "graft", key: "hasNotifiedUpdate" } as const, true);
    await $.store.set(NOTICE_KEY, { at: now, sha } satisfies Notice);
    $.ui.toast(text);
    await $.prompt.suggest({ text: "/graft:update" });
  } else if (action === "status" && text !== undefined) {
    await setStatus($, text);
  } else if (mode === "persistent" && result.kind === "current") {
    await clearStatus($);
  }
}

// Tells the user when ~/.my-graft lacks upstream's main. Never writes to the clone.
async function checkForUpdate($: EngineInterface) {
  const quiet = await $.env.get("CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC");
  const clone = await clonePath($);
  if ((quiet !== undefined && quiet !== "") || clone === undefined) {
    return;
  }
  const mode = await notifyMode($, clone);
  if (mode !== "persistent") {
    await clearStatus($);
  }
  if (mode === "off") {
    return;
  }
  const remote = await run($, ["git", "-C", clone, "remote", "get-url", "upstream"]);
  const url = remote.isOk ? remote.stdout.trim() : "";
  if (url === "") {
    await $.store.delete(LOOK_KEY);
    await $.store.delete(NOTICE_KEY);
    await clearStatus($);

    return;
  }
  const git = localGit($, clone);
  const look = storedLook(await $.store.get(LOOK_KEY));
  const known = look?.url === url ? look.sha : undefined;
  let first: Behind | undefined;
  if (known !== undefined) {
    first = await checkBehind(known, git);
    await notify($, mode, known, first);
  }
  const now = await $.clock.now();
  if (!isLookDue(look, url, now)) {
    return;
  }
  const listed = await run(
    $,
    ["git", "-C", clone, "ls-remote", "upstream", "refs/heads/main"],
    lsRemoteEnv(await networkEnv($, clone)),
  );
  const sha = listed.isOk ? parseLsRemote(listed.stdout) : undefined;
  const failures = sha !== undefined ? 0 : look?.url === url && !look.isOk ? look.failures + 1 : 1;
  await $.store.set(LOOK_KEY, {
    url,
    at: now,
    isOk: sha !== undefined,
    failures,
    sha: sha ?? known,
  } satisfies StoredLook);
  if (sha !== undefined && (sha !== known || first === undefined || first.kind === "unknown")) {
    await notify($, mode, sha, await checkBehind(sha, git));
  }
}

// Clears the persistent status line once the clone has the SHA it named.
async function recheckStatus($: EngineInterface) {
  const clone = await clonePath($);
  const sha = storedLook(await $.store.get(LOOK_KEY))?.sha;
  if (clone === undefined || sha === undefined) {
    return;
  }
  if ((await checkBehind(sha, localGit($, clone))).kind === "current") {
    await setStatus($, undefined);
  }
}

async function refusal(
  $: EngineInterface,
  clone: string,
  network: Record<string, string>,
): Promise<string | undefined> {
  const git = (...args: string[]) => run($, ["git", "-C", clone, ...args]);
  const top = await git("rev-parse", "--show-toplevel");
  const real = await $.fs
    .stat(clone, { resolve: true })
    .then((stat) => stat.realPath)
    .catch(() => undefined);
  const isClone =
    top.isOk &&
    [clone, real].some((path) => path !== undefined && isSamePath(path, top.stdout.trim()));
  if (!isClone) {
    return "~/.my-graft is not the Graft clone. Install Graft as its README says.";
  }
  const branch = await git("symbolic-ref", "--short", "-q", "HEAD");
  if (!branch.isOk || branch.stdout.trim() !== "main") {
    return "~/.my-graft is not on main. Run `git -C ~/.my-graft switch main`.";
  }
  const merge = await git("rev-parse", "-q", "--verify", "MERGE_HEAD");
  if (merge.isOk) {
    return "~/.my-graft has a merge in progress. Finish it, or run `git -C ~/.my-graft merge --abort`.";
  }
  const status = await git("status", "--porcelain", "--untracked-files=all");
  if (!status.isOk || status.stdout.trim() !== "") {
    return "~/.my-graft has changed or untracked files. Run `git -C ~/.my-graft status`, then commit or discard them.";
  }
  const ahead = await git("rev-list", "--count", "origin/main..HEAD");
  if (!ahead.isOk || ahead.stdout.trim() !== "0") {
    return "~/.my-graft has commits not pushed to origin. Run `git -C ~/.my-graft push origin main`.";
  }
  const pull = await run($, ["git", "-C", clone, "pull", "--ff-only", "origin", "main"], network);
  if (!pull.isOk) {
    return `pulling origin main failed (${firstLine(pull)}). Run \`git -C ~/.my-graft pull --ff-only origin main\`.`;
  }

  return undefined;
}

// `scope` undefined edits the defaults; `target` undefined clears the key.
// Returns a toast, or undefined when saved or unchanged.
async function saveSetting(
  $: EngineInterface,
  setting: CatalogSetting,
  scope: string | undefined,
  target: string | undefined,
): Promise<string | undefined> {
  const notSaved = `Graft settings: ${setting.key} was not saved:`;
  const clone = await clonePath($);
  if (clone === undefined) {
    return `${notSaved} HOME and USERPROFILE are not set.`;
  }
  const network = await networkEnv($, clone);
  const why = await refusal($, clone, network);
  if (why !== undefined) {
    return `${notSaved} ${why}`;
  }
  const path = `${clone}/${FILE}`;
  const before = await readText($, path);
  const file = parseFile(before);
  if (!file.isParsed) {
    return `${notSaved} ${FILE} does not parse (${file.error}). Fix it by hand.`;
  }
  const edited = withSetting(file.json, scope, setting.skill, setting.name, target);
  if (!edited.isEdited) {
    return `${notSaved} in ${FILE}, ${edited.error}. Fix it by hand.`;
  }
  const next = edited.json;
  if (JSON.stringify(next) === JSON.stringify(file.json)) {
    return undefined;
  }
  const message = `${target === undefined ? `Clear ${setting.key}` : `Set ${setting.key} to ${target}`}${scope === undefined ? "" : ` for ${scope}`}`;

  await $.fs.write(path, `${JSON.stringify(next, null, 2)}\n`);
  const git = (...args: string[]) => run($, ["git", "-C", clone, ...args]);
  const head = async () => {
    const ran = await git("rev-parse", "HEAD");

    return ran.isOk ? ran.stdout.trim() : undefined;
  };
  const headBefore = await head();
  const added = await git("add", "--", FILE);
  const committed = added.isOk ? await git("commit", "--only", "-m", message, "--", FILE) : added;
  // A commit can land yet report failure (a signing timeout). An unmoved HEAD
  // restores the file; a moved one is pushed only when it is this save's commit.
  const mayNotBeSaved = (why: string) =>
    `Graft settings: ${setting.key} may not be saved: the commit failed (${firstLine(committed)}) and ${why}. Run \`git -C ~/.my-graft status\` and \`git -C ~/.my-graft log -1\`.`;
  const headAfter = committed.isOk ? undefined : await head();
  if (!committed.isOk && (headBefore === undefined || headAfter === undefined)) {
    return mayNotBeSaved("HEAD could not be read to tell whether it landed");
  }
  if (!committed.isOk && headAfter !== headBefore) {
    const parent = await git("rev-parse", "HEAD^");
    const isSame = await git("diff", "--quiet", "HEAD", "--", FILE);
    const subject = await git("log", "-1", "--format=%s");
    const isOurs =
      parent.isOk &&
      parent.stdout.trim() === headBefore &&
      isSame.isOk &&
      subject.isOk &&
      subject.stdout.trim() === message;
    if (!isOurs) {
      return mayNotBeSaved("HEAD moved to a commit that is not this save's");
    }
  }
  if (!committed.isOk && headAfter === headBefore) {
    if (before === undefined) {
      await run($, ["rm", "-f", "--", path]);
    } else {
      await $.fs.write(path, before);
    }
    await git("reset", "-q", "--", FILE);

    return `${notSaved} the commit failed (${firstLine(committed)}), so ${FILE} was restored. Run \`git -C ~/.my-graft status\` to see why.`;
  }
  const pushed = await run($, ["git", "-C", clone, "push", "origin", "main"], network);
  if (!pushed.isOk) {
    return `Graft settings: ${setting.key} is committed but not pushed (${firstLine(pushed)}). Run \`git -C ~/.my-graft push origin main\`.`;
  }

  return undefined;
}

async function save(
  $: EngineInterface,
  setting: CatalogSetting,
  scope: string | undefined,
  target: string | undefined,
) {
  const held = await $.state.get({ plugin: "graft", key: "isSaving" } as const);
  const claimed =
    held.value === true
      ? { isSet: false }
      : await $.state.set({ plugin: "graft", key: "isSaving" } as const, true, {
          ifVersion: held.version,
        });
  if (!claimed.isSet) {
    $.ui.toast("Graft settings: a save is still running. Try again when it ends.");

    return;
  }
  try {
    if (scope !== undefined) {
      // Keeps the scope in the picker after its last override is cleared.
      await update($, newScopes, (keys) => (keys.includes(scope) ? keys : [...keys, scope]));
    }
    const toast = await saveSetting($, setting, scope, target).catch(
      (error) => `Graft settings: ${setting.key} was not saved: ${errorText(error)}`,
    );
    if (toast !== undefined) {
      $.ui.toast(toast);
    }
  } finally {
    await update($, isSaving, () => false);
    await update($, revision, (count) => count + 1);
  }
}

async function addScope($: EngineInterface, input: string) {
  const { file } = await load($);
  if (!file.isParsed) {
    return;
  }
  const added = await newScopeKey(
    input,
    [...file.file.scopes.map((scope) => scope.key), ...(await read($, newScopes))],
    file.env,
  );
  if (!added.isValid) {
    await update($, notice, () => added.error);

    return;
  }
  const warning = await scopeWarning($, added.key, file.env);
  await update($, newScopes, (keys) => [...keys, added.key]);
  await update($, view, () => added.key);
  await update($, notice, () => warning ?? "");
}

async function scopeWarning(
  $: EngineInterface,
  key: string,
  env: Environment,
): Promise<string | undefined> {
  const { path, isSubtree } = await normaliseScopeKey(key, env);
  if (isSubtree) {
    return undefined;
  }
  const { top, main } = await gitRoot($, path);
  if (top === undefined) {
    return `${key} is not a repo's top level on this machine.`;
  }
  const realTop = await normalisePath(top, env);
  const root = main === undefined ? realTop : await normalisePath(main, env);
  if (!isSamePath(realTop, path)) {
    return `${key} is not a repo's top level. Skills there use the settings for ${root}.`;
  }

  return root === realTop
    ? undefined
    : `${key} is a linked worktree. Skills there use the settings for ${root}.`;
}

async function submitText(
  $: EngineInterface,
  setting: CatalogSetting,
  scope: string | undefined,
  value: string,
) {
  const text = value.trim();
  if (text !== "" && !isValid(setting, text)) {
    await update($, notice, () => `${setting.key} takes a single line of text.`);

    return;
  }
  await update($, notice, () => "");
  const isCleared = text === "" || (scope === undefined && text === setting.defaultValue);
  await save($, setting, scope, isCleared ? undefined : text);
}

async function pickView($: EngineInterface, picked: string) {
  await update($, view, () => picked);
  await update($, notice, () => "");
}

type Control = {
  title: string;
  options: { value: string; label?: string }[];
  selected: string;
  savingText: string;
  onPick: (picked: string) => void;
};

function control(ui: Ui, pane: GraftSettingsPane, setting: CatalogSetting, c: Control) {
  const { Box, Select, Text } = ui;
  const note = conditionNote(setting);

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold>{c.title}</Text>
      <Text dimColor>
        {setting.description} Default: {setting.defaultValue}.{note === undefined ? "" : ` ${note}`}
      </Text>
      {pane.isSaving ? (
        <Text>{c.savingText} (saving)</Text>
      ) : (
        <Select
          key={setting.key}
          options={c.options}
          value={c.selected}
          onSelect={(picked) => {
            if (picked !== UNLISTED) {
              c.onPick(picked);
            }
          }}
        />
      )}
    </Box>
  );
}

type TextControl = {
  title: string;
  inputKey: string;
  stored: unknown;
  placeholder: string;
  savingText: string;
  onSubmit: (value: string) => void;
};

function textControl(ui: Ui, pane: GraftSettingsPane, setting: CatalogSetting, c: TextControl) {
  const { Box, Input, Text } = ui;
  const note = conditionNote(setting);
  const isAllowed = c.stored === undefined || isValid(setting, c.stored);

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold>{c.title}</Text>
      <Text dimColor>
        {setting.description} Default: {setting.defaultValue}.{note === undefined ? "" : ` ${note}`}
      </Text>
      {!isAllowed && <Text>{shown(c.stored)} (not allowed)</Text>}
      {pane.isSaving ? (
        <Text>{c.savingText} (saving)</Text>
      ) : (
        <Input
          key={c.inputKey}
          placeholder={c.placeholder}
          value={c.stored !== undefined && isAllowed ? String(c.stored) : ""}
          onSubmit={c.onSubmit}
        />
      )}
    </Box>
  );
}

function notInCatalog(ui: Ui, keys: [string, unknown][]) {
  const { Box, Text } = ui;

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold>Not in the catalog</Text>
      {keys.map(([key, value]) => (
        <Text>
          {key}: {shown(value)}
        </Text>
      ))}
    </Box>
  );
}

const unknownKeys = (values: SkillValues, settings: CatalogSetting[]) =>
  flatten(values).filter(([key]) => !settings.some((setting) => setting.key === key));

function defaultsView(
  $: EngineInterface,
  ui: Ui,
  pane: GraftSettingsPane,
  settings: CatalogSetting[],
  defaults: SkillValues,
) {
  const { Box } = ui;
  const unknown = unknownKeys(defaults, settings);

  return (
    <Box flexDirection="column">
      {settings.map((setting) => {
        const value = defaults[setting.skill]?.[setting.name];
        if (setting.isText) {
          return textControl(ui, pane, setting, {
            title: setting.key,
            inputKey: `${DEFAULTS_VIEW}:${setting.key}`,
            stored: value,
            placeholder: `${setting.defaultValue} (Default)`,
            savingText: value === undefined ? setting.defaultValue : shown(value),
            onSubmit: (submitted) => void submitText($, setting, undefined, submitted),
          });
        }
        const isDefault =
          value === undefined ||
          (isValid(setting, value) && String(value) === setting.defaultValue);
        const isListed = isDefault || isValid(setting, value);
        const options = [
          ...choicesOf(setting).map((choice) =>
            choice === setting.defaultValue ? { value: DEFAULT, label: choice } : { value: choice },
          ),
          ...(isListed ? [] : [{ value: UNLISTED, label: `${shown(value)} (not allowed)` }]),
        ];

        return control(ui, pane, setting, {
          title: setting.key,
          options,
          selected: isDefault ? DEFAULT : isListed ? String(value) : UNLISTED,
          savingText: value === undefined ? setting.defaultValue : shown(value),
          onPick: (picked) =>
            void save($, setting, undefined, picked === DEFAULT ? undefined : picked),
        });
      })}
      {unknown.length > 0 && notInCatalog(ui, unknown)}
    </Box>
  );
}

async function scopeView(
  $: EngineInterface,
  ui: Ui,
  pane: GraftSettingsPane,
  settings: CatalogSetting[],
  file: SettingsFile,
  env: Environment,
  key: string,
) {
  const { Box, Text } = ui;
  const scope = file.scopes.find((candidate) => candidate.key === key);
  const overrides = scope?.overrides ?? {};
  const inherited = explainLayers(await inheritedLayers(file, key, env), settings);
  const unknown = unknownKeys(overrides, settings);

  return (
    <Box flexDirection="column">
      <Text bold>Overrides for {key}</Text>
      {scope === undefined && <Text dimColor>A new scope is saved with its first override.</Text>}
      {settings.map((setting, i) => {
        const stored = overrides[setting.skill]?.[setting.name];
        const title = stored === undefined ? setting.key : `${setting.key} (overridden)`;
        if (setting.isText) {
          return textControl(ui, pane, setting, {
            title,
            inputKey: `${key}:${setting.key}`,
            stored,
            placeholder: sourceLabel(inherited[i]!),
            savingText: stored === undefined ? sourceLabel(inherited[i]!) : shown(stored),
            onSubmit: (submitted) => void submitText($, setting, key, submitted),
          });
        }
        const isListed = stored === undefined || isValid(setting, stored);
        const options = [
          { value: INHERIT, label: `Inherit: ${sourceLabel(inherited[i]!)}` },
          ...choicesOf(setting).map((choice) => ({ value: choice })),
          ...(isListed ? [] : [{ value: UNLISTED, label: `${shown(stored)} (not allowed)` }]),
        ];

        return control(ui, pane, setting, {
          title,
          options,
          selected: stored === undefined ? INHERIT : isListed ? String(stored) : UNLISTED,
          savingText: stored === undefined ? sourceLabel(inherited[i]!) : shown(stored),
          onPick: (picked) => void save($, setting, key, picked === INHERIT ? undefined : picked),
        });
      })}
      {unknown.length > 0 && notInCatalog(ui, unknown)}
    </Box>
  );
}

async function effectiveView(
  $: EngineInterface,
  ui: Ui,
  pane: GraftSettingsPane,
  settings: CatalogSetting[],
  file: SettingsFile,
  env: Environment,
) {
  const { Box, Input, Text } = ui;
  const cwd = await $.session.cwd();
  const root = await normaliseRootPath(pane.effectivePath === "" ? cwd : pane.effectivePath, env);
  const explained = explainLayers(await layersFor(file, root, env), settings);
  const isShown = (setting: CatalogSetting) =>
    setting.shownWhen === undefined ||
    explained.find(({ key }) => key === setting.shownWhen?.key)?.value === setting.shownWhen.value;

  return (
    <Box flexDirection="column" marginTop={1}>
      <Input
        key="effectivePath"
        label="Path: "
        placeholder={cwd}
        value={pane.effectivePath}
        onSubmit={(value) => void update($, effectivePath, () => value.trim())}
      />
      <Text dimColor>Effective for {root}</Text>
      {settings.map((setting, i) =>
        isShown(setting) ? (
          <Text>
            {setting.key}: {sourceLabel(explained[i]!)}
          </Text>
        ) : undefined,
      )}
    </Box>
  );
}

function addView($: EngineInterface, ui: Ui) {
  const { Box, Input, Text } = ui;

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text dimColor>
        A repo's path, or a directory ending in /* for every repo under it. It starts with / or ~/.
      </Text>
      <Input
        key="scopePath"
        label="Path: "
        placeholder="~/work/*"
        onSubmit={(value) => void addScope($, value)}
      />
    </Box>
  );
}

export const register: Register = (on) => {
  on("session.start", async ($, e, next) => {
    await $.command.register({
      name: "graft-settings",
      description: "Show and change Graft settings",
    });
    // $.state outlives a reload, which drops any save in flight, so release its lock.
    await $.state.set({ plugin: "graft", key: "isSaving" } as const, false);
    await update($, newScopes, () => []);
    await update($, notice, () => "");
    if (e.isInteractive) {
      try {
        $.clock.after(0, () => void checkForUpdate($).catch(() => undefined));
      } catch {
        // A Claude Code without $.clock.after shows no update notices.
      }
    }

    return next(e);
  });

  on("prompt.submit", async ($, e, next) => {
    const shown = await $.state.get({ plugin: "graft", key: "isUpdateStatusShown" } as const).then(
      (held) => held.value === true,
      () => false,
    );
    if (!shown) {
      return next(e);
    }
    const entered = await next(e);
    try {
      $.clock.after(0, () => void recheckStatus($).catch(() => undefined));
    } catch {
      // A Claude Code without $.clock.after leaves the status line until the next session.
    }

    return entered;
  });

  on("command.run", { command: "graft-settings" }, async ($) => {
    const opened = await $.ui.open({ id: PANE, title: TITLE, focus: true });
    if (opened.isPlaced) {
      return { text: "Opened the Graft settings pane." };
    }
    await $.ui.close({ id: PANE });

    return { text: describe(await load($)).join("\n") };
  });

  on("ui.render", { component: "Pane", requestId: PANE }, async ($, e) => {
    const pane: GraftSettingsPane = {
      isSaving: await read($, isSaving),
      revision: await read($, revision),
      view: await read($, view),
      newScopes: await read($, newScopes),
      notice: await read($, notice),
      effectivePath: await read($, effectivePath),
    };
    const loaded = await load($);
    const { catalog, file } = loaded;

    if (e.surface === "mobile" || !catalog.isParsed || !file.isParsed) {
      const { Box, Text } = $.ui.resolve(e);

      return (
        <Box flexDirection="column">
          {describe(loaded).map((line) => (
            <Text>{line}</Text>
          ))}
        </Box>
      );
    }

    const ui = $.ui.resolve(e);
    const { Box, Select, Text } = ui;
    const { settings } = catalog;
    const keys = file.file.scopes.map((scope) => scope.key);
    const added = pane.newScopes.filter((key) => !keys.includes(key));
    const current = [EFFECTIVE_VIEW, ADD_VIEW, ...keys, ...added].includes(pane.view)
      ? pane.view
      : DEFAULTS_VIEW;
    const options = [
      { value: DEFAULTS_VIEW, label: "Defaults" },
      { value: EFFECTIVE_VIEW, label: "Effective for this repo" },
      ...keys.map((key) => ({ value: key })),
      ...added.map((key) => ({ value: key, label: `${key} (new)` })),
      { value: ADD_VIEW, label: "Add override…" },
    ];
    const body =
      current === DEFAULTS_VIEW
        ? defaultsView($, ui, pane, settings, file.file.defaults)
        : current === EFFECTIVE_VIEW
          ? await effectiveView($, ui, pane, settings, file.file, file.env)
          : current === ADD_VIEW
            ? addView($, ui)
            : await scopeView($, ui, pane, settings, file.file, file.env, current);

    return (
      <Box flexDirection="column">
        <Text dimColor>{SHOWN_FILE}</Text>
        <Select
          key="scope"
          label="Scope: "
          options={options}
          value={current}
          onSelect={(picked) => void pickView($, picked)}
        />
        {pane.notice !== "" && <Text>{pane.notice}</Text>}
        {body}
      </Box>
    );
  });
};

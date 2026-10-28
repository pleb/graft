import { atom, read, update } from "claude-code";
import type { EngineInterface, Register } from "claude-code";

import { parseCatalog } from "../skills/settings-catalog.ts";
import type { Catalog, CatalogSetting } from "../skills/settings-catalog.ts";
import type { GraftSettingsPane } from "../types";

const PANE = "graft-settings";
const TITLE = "Graft settings";
const FILE = "graft-settings.json";
const SHOWN_FILE = `~/.my-graft/${FILE}`;
const ASK = ":ask";
const UNLISTED = ":unlisted";
const LOCAL_MS = 30_000;
const NETWORK_MS = 60_000;

const isSaving = atom({ plugin: "graft", key: "isSaving" } as const, false);
const revision = atom({ plugin: "graft", key: "revision" } as const, 0);

type Json = Record<string, unknown>;

type SettingsFile =
  | { isParsed: true; isMissing: boolean; settings: Json }
  | { isParsed: false; error: string };

type Loaded = { catalog: Catalog; file: SettingsFile };

type Ran = { isOk: boolean; stdout: string; stderr: string };

const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

const shown = (value: unknown) => (typeof value === "string" ? value : JSON.stringify(value));

async function clonePath($: EngineInterface): Promise<string | undefined> {
  const home = await $.env.get("HOME");

  return home === undefined || home === "" ? undefined : `${home}/.my-graft`;
}

function parseSettings(text: string | undefined): SettingsFile {
  if (text === undefined) {
    return { isParsed: true, isMissing: true, settings: {} };
  }
  try {
    const settings: unknown = JSON.parse(text);
    if (!isObject(settings)) {
      return { isParsed: false, error: "it is not a JSON object" };
    }

    return { isParsed: true, isMissing: false, settings };
  } catch (error) {
    return { isParsed: false, error: errorText(error) };
  }
}

async function readText($: EngineInterface, path: string): Promise<string | undefined> {
  if (!(await $.fs.exists(path))) {
    return undefined;
  }

  return String(await $.fs.read(path));
}

async function load($: EngineInterface): Promise<Loaded> {
  const common = await readText($, `${$.plugin.root}/skills/common.md`).catch(() => undefined);
  const catalog: Catalog =
    common === undefined
      ? { isParsed: false, error: "skills/common.md cannot be read" }
      : parseCatalog(common);
  const clone = await clonePath($);
  if (clone === undefined) {
    return { catalog, file: { isParsed: false, error: "HOME is not set" } };
  }
  try {
    return { catalog, file: parseSettings(await readText($, `${clone}/${FILE}`)) };
  } catch (error) {
    return { catalog, file: { isParsed: false, error: errorText(error) } };
  }
}

// Every key in the file, `<skill>.<setting>`; a skill entry that is not an
// object stands as its own key.
function flatten(settings: Json): Map<string, unknown> {
  const keys = new Map<string, unknown>();
  for (const [skill, entry] of Object.entries(settings)) {
    if (isObject(entry)) {
      for (const [name, value] of Object.entries(entry)) {
        keys.set(`${skill}.${name}`, value);
      }
    } else {
      keys.set(skill, entry);
    }
  }

  return keys;
}

function currentOf(settings: Json, setting: CatalogSetting): unknown {
  const entry = settings[setting.skill];

  return isObject(entry) ? entry[setting.name] : undefined;
}

// The read-only text list: the reply where no surface draws the pane, and
// the pane on mobile.
function describe({ catalog, file }: Loaded): string[] {
  const lines = [`Graft settings in ${SHOWN_FILE}`];
  if (!file.isParsed) {
    return [...lines, `${FILE} does not parse: ${file.error}`];
  }
  const keys = flatten(file.settings);
  if (!catalog.isParsed) {
    lines.push(`The settings catalog in common.md does not parse: ${catalog.error}`);
    if (keys.size === 0) {
      lines.push("No settings are set.");
    }
    for (const [key, value] of keys) {
      lines.push(`${key}: ${shown(value)}`);
    }

    return lines;
  }
  for (const setting of catalog.settings) {
    const value = currentOf(file.settings, setting);
    lines.push(
      `${setting.key}: ${value === undefined ? setting.defaultValue : shown(value)} (${[...setting.values, setting.defaultValue].join(", ")})`,
      `  ${setting.description}`,
    );
    keys.delete(setting.key);
  }
  if (keys.size > 0) {
    lines.push("Not in the catalog:");
    for (const [key, value] of keys) {
      lines.push(`${key}: ${shown(value)}`);
    }
  }

  return lines;
}

// `network` is the environment for a pull or push, which never prompts.
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

// The user's own ssh command (as git picks it), made to fail rather than ask.
async function networkEnv($: EngineInterface, clone: string): Promise<Record<string, string>> {
  const fromEnv = await $.env.get("GIT_SSH_COMMAND");
  const fromConfig = await run($, ["git", "-C", clone, "config", "core.sshCommand"]);
  const ssh =
    fromEnv !== undefined && fromEnv.trim() !== ""
      ? fromEnv.trim()
      : fromConfig.isOk && fromConfig.stdout.trim() !== ""
        ? fromConfig.stdout.trim()
        : "ssh";

  return { GIT_TERMINAL_PROMPT: "0", GIT_SSH_COMMAND: `${ssh} -o BatchMode=yes` };
}

// The checks before a write; answers why the save is refused, or undefined.
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
  const isClone = top.isOk && [clone, real].includes(top.stdout.trim());
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

// Saves one key (`undefined` clears it); answers a toast, or undefined when
// the save went through or changed nothing.
async function saveSetting(
  $: EngineInterface,
  setting: CatalogSetting,
  target: string | undefined,
): Promise<string | undefined> {
  const notSaved = `Graft settings: ${setting.key} was not saved:`;
  const clone = await clonePath($);
  if (clone === undefined) {
    return `${notSaved} HOME is not set.`;
  }
  const network = await networkEnv($, clone);
  const why = await refusal($, clone, network);
  if (why !== undefined) {
    return `${notSaved} ${why}`;
  }
  const path = `${clone}/${FILE}`;
  const before = await readText($, path);
  const file = parseSettings(before);
  if (!file.isParsed) {
    return `${notSaved} ${FILE} does not parse (${file.error}). Fix it by hand.`;
  }
  const entry = file.settings[setting.skill] ?? {};
  if (!isObject(entry)) {
    return `${notSaved} "${setting.skill}" in ${FILE} is not an object. Fix it by hand.`;
  }
  if (entry[setting.name] === target) {
    return undefined;
  }
  const nextEntry = { ...entry };
  if (target === undefined) {
    delete nextEntry[setting.name];
  } else {
    nextEntry[setting.name] = target;
  }
  const next = { ...file.settings };
  if (Object.keys(nextEntry).length === 0) {
    delete next[setting.skill];
  } else {
    next[setting.skill] = nextEntry;
  }
  const message = target === undefined ? `Clear ${setting.key}` : `Set ${setting.key} to ${target}`;

  await $.fs.write(path, `${JSON.stringify(next, null, 2)}\n`);
  const git = (...args: string[]) => run($, ["git", "-C", clone, ...args]);
  const head = async () => {
    const ran = await git("rev-parse", "HEAD");

    return ran.isOk ? ran.stdout.trim() : undefined;
  };
  const headBefore = await head();
  const added = await git("add", "--", FILE);
  const committed = added.isOk ? await git("commit", "--only", "-m", message, "--", FILE) : added;
  // A commit can land and still report failure (a timeout during signing):
  // a moved HEAD counts as made, and only an unmoved one is undone.
  const headAfter = committed.isOk ? undefined : await head();
  if (!committed.isOk && (headBefore === undefined || headAfter === undefined)) {
    return `Graft settings: ${setting.key} may not be saved: the commit failed (${firstLine(committed)}) and HEAD could not be read to tell whether it landed. Run \`git -C ~/.my-graft status\` and \`git -C ~/.my-graft log -1\`.`;
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

async function save($: EngineInterface, setting: CatalogSetting, target: string | undefined) {
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
    const toast = await saveSetting($, setting, target).catch(
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

export const register: Register = (on) => {
  on("session.start", async ($, e, next) => {
    await $.command.register({
      name: "graft-settings",
      description: "Show and change Graft settings",
    });
    // A reload drops a save in flight, and $.state keeps its lock.
    await $.state.set({ plugin: "graft", key: "isSaving" } as const, false);

    return next(e);
  });

  on("command.run", { command: "graft-settings" }, async ($) => {
    const opened = await $.ui.open({ id: PANE, title: TITLE });
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
    };
    const loaded = await load($);
    const { catalog, file } = loaded;
    const isEditable = catalog.isParsed && file.isParsed;

    if (e.surface === "mobile" || !isEditable) {
      const { Box, Text } = $.ui.resolve(e);

      return (
        <Box flexDirection="column">
          {describe(loaded).map((line) => (
            <Text>{line}</Text>
          ))}
        </Box>
      );
    }

    const { Box, Select, Text } = $.ui.resolve(e);
    const keys = flatten(file.settings);

    return (
      <Box flexDirection="column">
        <Text dimColor>{SHOWN_FILE}</Text>
        {catalog.settings.map((setting) => {
          keys.delete(setting.key);
          const value = currentOf(file.settings, setting);
          const isListed =
            value === undefined || (typeof value === "string" && setting.values.includes(value));
          const options = [
            ...setting.values.map((option) => ({ value: option })),
            { value: ASK, label: setting.defaultValue },
            ...(isListed ? [] : [{ value: UNLISTED, label: `${shown(value)} (not allowed)` }]),
          ];
          const selected = value === undefined ? ASK : isListed ? String(value) : UNLISTED;

          return (
            <Box flexDirection="column" marginTop={1}>
              <Text bold>{setting.key}</Text>
              <Text dimColor>
                {setting.description} Default: {setting.defaultValue}.
              </Text>
              {pane.isSaving ? (
                <Text>{value === undefined ? setting.defaultValue : shown(value)} (saving)</Text>
              ) : (
                <Select
                  key={setting.key}
                  options={options}
                  value={selected}
                  onSelect={(picked) => {
                    if (picked !== UNLISTED) {
                      void save($, setting, picked === ASK ? undefined : picked);
                    }
                  }}
                />
              )}
            </Box>
          );
        })}
        {keys.size > 0 && (
          <Box flexDirection="column" marginTop={1}>
            <Text bold>Not in the catalog</Text>
            {[...keys].map(([key, value]) => (
              <Text>
                {key}: {shown(value)}
              </Text>
            ))}
          </Box>
        )}
      </Box>
    );
  });
};

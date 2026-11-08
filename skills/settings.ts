import { execFile } from "node:child_process";
import { readFile, realpath } from "node:fs/promises";
import { homedir, hostname } from "node:os";
import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, promisify } from "node:util";
import { parseCatalog } from "./settings-catalog.ts";
import {
  driveForm,
  effectiveValues,
  isWindowsPath,
  projectFilePaths,
  resolveSettings,
} from "./settings-lib.ts";

const USAGE = "Usage: node settings.ts <root> [--explain]";

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const run = promisify(execFile);

async function git(cwd: string, ...args: string[]): Promise<string | undefined> {
  try {
    return (await run("git", ["-C", cwd, ...args], { encoding: "utf8" })).stdout;
  } catch {
    return undefined;
  }
}

async function normaliseRoot(path: string): Promise<string> {
  const top = (await git(path, "rev-parse", "--show-toplevel"))?.trim();
  if (!top) {
    return path;
  }
  const list = await git(top, "worktree", "list", "--porcelain");
  const first = list?.split("\n\n")[0]?.split("\n") ?? [];
  const main = first.find((line) => line.startsWith("worktree "))?.slice("worktree ".length);
  if (main === undefined || first.includes("bare")) {
    return top;
  }

  return main;
}

async function readText(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    fail(`cannot read ${path}: ${(error as Error).message}`);
  }
}

// HOME, then USERPROFILE, as hooks/register.tsx reads them, so the pane and this script read the same file.
function homeDirectory(): string {
  return driveForm([process.env.HOME, process.env.USERPROFILE].find((home) => !!home) ?? homedir());
}

async function main(): Promise<void> {
  let parsed;
  try {
    parsed = parseArgs({ options: { explain: { type: "boolean" } }, allowPositionals: true });
  } catch {
    fail(USAGE);
  }
  const [root, ...rest] = parsed.positionals;
  if (root === undefined || root === "" || rest.length > 0) {
    fail(USAGE);
  }
  const home = homeDirectory();
  const common = await readText(fileURLToPath(new URL("./common.md", import.meta.url)));
  const catalog =
    common === undefined
      ? { isParsed: false as const, error: "common.md cannot be read" }
      : parseCatalog(common);
  const isHomeRelative =
    root === "~" ||
    root.startsWith("~/") ||
    (process.platform === "win32" && root.startsWith("~\\"));
  // A relative root is joined without collapsing `..`, which git and realpath resolve after symlinks.
  const rootPath =
    isAbsolute(root) || isWindowsPath(root) || isHomeRelative ? root : `${process.cwd()}/${root}`;
  const hostnames = [hostname(), process.env.COMPUTERNAME, process.env.HOSTNAME].filter(
    (name): name is string => !!name,
  );
  const rootDir = isHomeRelative ? join(home, root.slice(1)) : driveForm(rootPath, { hostnames });
  const top = (await git(rootDir, "rev-parse", "--show-toplevel"))?.trim() || rootDir;
  const projectFiles = await Promise.all(
    projectFilePaths(top).map(async (source) => ({ source, text: await readText(source) })),
  );
  const result = await resolveSettings(
    await readText(join(home, ".my-graft", "graft-settings.json")),
    catalog,
    rootPath,
    {
      home,
      resolve: (path) => realpath(path).catch(() => undefined),
      normaliseRoot,
      hostnames,
    },
    projectFiles,
  );
  if (!result.isResolved) {
    fail(result.error);
  }
  let output: Record<string, Record<string, unknown>> = effectiveValues(result.settings);
  if (parsed.values.explain) {
    output = {};
    for (const { skill, name, value, source } of result.settings) {
      (output[skill] ??= {})[name] = { value, source };
    }
  }
  console.log(JSON.stringify(output, null, 2));
}

await main();

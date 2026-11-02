import { execFile } from "node:child_process";
import { readFile, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, promisify } from "node:util";
import { parseCatalog } from "./settings-catalog.ts";
import { effectiveValues, isWindowsPath, resolveSettings } from "./settings-lib.ts";

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
  const home = homedir();
  const common = await readText(fileURLToPath(new URL("./common.md", import.meta.url)));
  const catalog =
    common === undefined
      ? { isParsed: false as const, error: "common.md cannot be read" }
      : parseCatalog(common);
  const result = await resolveSettings(
    await readText(join(home, ".my-graft", "graft-settings.json")),
    catalog,
    // A relative root is joined without collapsing `..`, which git and realpath resolve after symlinks.
    isAbsolute(root) || isWindowsPath(root) || root === "~" || root.startsWith("~/")
      ? root
      : `${process.cwd()}/${root}`,
    {
      home,
      resolve: (path) => realpath(path).catch(() => undefined),
      normaliseRoot,
    },
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

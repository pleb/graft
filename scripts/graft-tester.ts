import { spawnSync } from "node:child_process";
import { readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { isTesterName, testerName, trustKeys } from "./graft-tester-lib.ts";

const repoRoot = resolve(import.meta.dirname, "..");

type Agent = { id: string; kind: string; name?: string };

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function run(args: string[], options: { cwd?: string; capture?: boolean } = {}): string | Error {
  const result = spawnSync("claude", args, {
    cwd: options.cwd,
    encoding: "utf8",
    stdio: options.capture ? ["ignore", "pipe", "inherit"] : "inherit",
  });
  if (result.error) return new Error(`claude ${args[0]} failed: ${result.error.message}`);
  if (result.status !== 0) return new Error(`claude ${args[0]} exited with ${result.status}`);
  return result.stdout ?? "";
}

function claude(args: string[], options: { cwd?: string; capture?: boolean } = {}): string {
  const result = run(args, options);
  if (result instanceof Error) fail(result.message);
  return result;
}

function gitRoot(dir: string): string {
  const result = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd: dir, encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : dir;
}

type Config = { projects?: Record<string, Record<string, unknown>> };

function readConfig(path: string): Config {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
  try {
    return JSON.parse(text) as Config;
  } catch (error) {
    fail(`${path} does not parse, so the tester left it unchanged: ${(error as Error).message}`);
  }
}

function untrusted(path: string, keys: string[]): string[] {
  const projects = readConfig(path).projects ?? {};
  return keys.filter((key) => projects[key]?.hasTrustDialogAccepted !== true);
}

function trust(path: string, keys: string[]): boolean {
  if (untrusted(path, keys).length === 0) return false;
  const stat = statSync(path, { throwIfNoEntry: false });
  const real = stat ? realpathSync(path) : path;
  const mode = stat ? stat.mode & 0o777 : 0o600;
  const temp = join(dirname(real), `${basename(real)}.${process.pid}.tmp`);
  for (let attempt = 1; ; attempt++) {
    const config = readConfig(real);
    const projects = (config.projects ??= {});
    for (const key of keys) projects[key] = { ...projects[key], hasTrustDialogAccepted: true };
    rmSync(temp, { force: true });
    writeFileSync(temp, JSON.stringify(config, null, 2), { mode });
    try {
      renameSync(temp, real);
      return true;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (attempt < 5 && (code === "EPERM" || code === "EBUSY")) {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
        continue;
      }
      rmSync(temp, { force: true });
      fail(`Could not replace ${path}: ${(error as Error).message}`);
    }
  }
}

function automationNote(controller: string): string {
  return [
    "This session is an automated test of Graft, with no user attached.",
    `Send every question you would ask the user to the session named "${controller}" with SendMessage, including its options and your recommendation.`,
    "Then wait for the reply and act on it as the user's answer.",
  ].join(" ");
}

function testers(): Agent[] {
  const agents = JSON.parse(claude(["agents", "--json"], { capture: true })) as Agent[];
  return agents.filter((agent) => agent.kind === "background" && isTesterName(agent.name ?? ""));
}

function start(args: string[]): void {
  const [cwd, controller, command] = args;
  if (args.length !== 3 || !cwd || !controller || !command) {
    fail('Usage: npm run start-graft-tester -- <cwd> <controller session name> "<slash command>"');
  }
  const dir = resolve(process.env.INIT_CWD ?? process.cwd(), cwd);
  if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) fail(`Not a directory: ${dir}`);
  const running = testers().map((agent) => agent.name);
  if (running.length > 0)
    fail(`${running.join(", ")} is running. Stop it with: npm run stop-graft-tester`);
  const root = gitRoot(dir);
  const trusted = trustKeys(root, realpathSync.native(root), homedir());
  if ("refusal" in trusted) fail(`Refusing to trust ${root}: ${trusted.refusal}.`);
  const config = join(process.env.CLAUDE_CONFIG_DIR ?? homedir(), ".claude.json");
  const wrote = trust(config, trusted.keys);
  const missing = untrusted(config, trusted.keys);
  if (missing.length > 0) fail(`${config} does not trust ${missing.join(", ")}.`);
  if (wrote) console.log(`Trusted ${trusted.keys.join(", ")} in ${config}.`);
  const name = testerName();
  claude(
    [
      "--bg",
      "--name",
      name,
      "--plugin-dir",
      repoRoot,
      "--permission-mode",
      "auto",
      "--add-dir",
      join(homedir(), ".my-graft"),
      "--settings",
      JSON.stringify({
        crossSessionInbound: "accept",
        worktree: { bgIsolation: "none" },
      }),
      "--disallowedTools",
      "AskUserQuestion",
      "--append-system-prompt",
      automationNote(controller),
      "--",
      command,
    ],
    { cwd: dir },
  );
}

function stop(): void {
  const running = testers();
  let failed = 0;
  for (const tester of running) {
    const result = run(["stop", tester.id]);
    if (result instanceof Error) {
      console.error(`${result.message} for ${tester.id}`);
      failed++;
    }
  }
  console.log(`Stopped ${running.length - failed} graft-tester session(s).`);
  if (failed > 0) fail(`Failed to stop ${failed} graft-tester session(s).`);
}

const [action, ...rest] = process.argv.slice(2);
if (action === "start") start(rest);
else if (action === "stop") stop();
else fail("Usage: node scripts/graft-tester.ts start|stop [...]");

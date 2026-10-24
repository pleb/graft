import { spawnSync } from "node:child_process";
import { statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const NAME = "graft-tester";
const TESTER_NAME = /^graft-tester( \(\d+\))?$/;
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

function automationNote(controller: string): string {
  return [
    "This session is an automated test of Graft, with no user attached.",
    `Send every question you would ask the user to the session named "${controller}" with SendMessage, including its options and your recommendation.`,
    "Then wait for the reply and act on it as the user's answer.",
  ].join(" ");
}

function start(args: string[]): void {
  const [cwd, controller, command] = args;
  if (args.length !== 3 || !cwd || !controller || !command) {
    fail('Usage: npm run start-graft-tester -- <cwd> <controller session name> "<slash command>"');
  }
  const dir = resolve(process.env.INIT_CWD ?? process.cwd(), cwd);
  if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) fail(`Not a directory: ${dir}`);
  claude(
    [
      "--bg",
      "--name",
      NAME,
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
  const agents = JSON.parse(claude(["agents", "--json"], { capture: true })) as Agent[];
  const testers = agents.filter(
    (agent) => agent.kind === "background" && TESTER_NAME.test(agent.name ?? ""),
  );
  let failed = 0;
  for (const tester of testers) {
    const result = run(["stop", tester.id]);
    if (result instanceof Error) {
      console.error(`${result.message} for ${tester.id}`);
      failed++;
    }
  }
  console.log(`Stopped ${testers.length - failed} ${NAME} session(s).`);
  if (failed > 0) fail(`Failed to stop ${failed} ${NAME} session(s).`);
}

const [action, ...rest] = process.argv.slice(2);
if (action === "start") start(rest);
else if (action === "stop") stop();
else fail("Usage: node scripts/graft-tester.ts start|stop [...]");

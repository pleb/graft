import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const NAME = "graft-tester";
const TESTER_NAME = /^graft-tester( \(\d+\))?$/;
const repoRoot = resolve(import.meta.dirname, "..");

type Agent = { id: string; kind: string; name?: string };

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function claude(args: string[], options: { cwd?: string; capture?: boolean } = {}): string {
  const result = spawnSync("claude", args, {
    cwd: options.cwd,
    encoding: "utf8",
    stdio: options.capture ? ["ignore", "pipe", "inherit"] : "inherit",
  });
  if (result.error) fail(`claude ${args[0]} failed: ${result.error.message}`);
  if (result.status !== 0) fail(`claude ${args[0]} exited with ${result.status}`);
  return result.stdout ?? "";
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
  claude(
    [
      "--bg",
      "--name",
      NAME,
      "--plugin-dir",
      repoRoot,
      "--permission-mode",
      "auto",
      "--settings",
      JSON.stringify({ crossSessionInbound: "accept" }),
      "--disallowedTools",
      "AskUserQuestion",
      "--append-system-prompt",
      automationNote(controller),
      "--",
      command,
    ],
    { cwd: resolve(process.env.INIT_CWD ?? process.cwd(), cwd) },
  );
}

function stop(): void {
  const agents = JSON.parse(claude(["agents", "--json"], { capture: true })) as Agent[];
  const testers = agents.filter(
    (agent) => agent.kind === "background" && TESTER_NAME.test(agent.name ?? ""),
  );
  for (const tester of testers) claude(["stop", tester.id]);
  console.log(`Stopped ${testers.length} ${NAME} session(s).`);
}

const [action, ...rest] = process.argv.slice(2);
if (action === "start") start(rest);
else if (action === "stop") stop();
else fail("Usage: node scripts/graft-tester.ts start|stop [...]");

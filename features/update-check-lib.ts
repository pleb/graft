// Decides when to look for Graft updates and whether to tell the user. Keep it
// free of JSX and Node or claude-code imports: hooks/register.tsx and vitest
// both load it, and the caller runs git.

export const MODES = ["session", "daily", "sha", "persistent", "off"] as const;

export type Mode = (typeof MODES)[number];

// The last `ls-remote`: `failures` counts consecutive failures, 0 after a success.
export type Look = { url: string; at: number; isOk: boolean; failures: number };

// `exitCode` is undefined when git did not start or timed out.
export type Probe = { exitCode: number | undefined; stdout: string };

// Runs git in the clone with LOCAL_PROBE_ENV; `args` omit `git -C <clone>`.
export type Git = (args: readonly string[]) => Promise<Probe>;

export type Behind = { kind: "current" } | { kind: "behind"; count?: number } | { kind: "unknown" };

export type Notice = { at: number; sha: string };

export type Action = "none" | "toast" | "status";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const MAIN = /^([0-9a-f]{40}|[0-9a-f]{64})\trefs\/heads\/main$/im;

export const LOCAL_PROBE_ENV: Readonly<Record<string, string>> = { GIT_NO_LAZY_FETCH: "1" };

export function isLookDue(look: Look | undefined, url: string, now: number): boolean {
  if (look === undefined || look.url !== url) {
    return true;
  }

  const wait = look.isOk ? DAY_MS : Math.min(HOUR_MS * 2 ** Math.max(look.failures - 1, 0), DAY_MS);

  return now < look.at || now - look.at >= wait;
}

// `base` is networkEnv's output; credential helpers stay so a stored token still works.
export function lsRemoteEnv(base: Readonly<Record<string, string>>): Record<string, string> {
  return { ...base, GCM_INTERACTIVE: "never", GIT_ASKPASS: "", SSH_ASKPASS: "" };
}

export function parseLsRemote(stdout: string): string | undefined {
  return MAIN.exec(stdout)?.[1]?.toLowerCase();
}

export async function checkBehind(sha: string, git: Git): Promise<Behind> {
  const present = await git(["cat-file", "-e", sha]);

  if (present.exitCode === 1) {
    return { kind: "behind" };
  }

  if (present.exitCode !== 0) {
    return { kind: "unknown" };
  }

  for (const ref of ["HEAD", "origin/main"]) {
    const ancestor = await git(["merge-base", "--is-ancestor", sha, ref]);

    if (ancestor.exitCode === 0) {
      return { kind: "current" };
    }

    if (ancestor.exitCode !== 1) {
      return { kind: "unknown" };
    }
  }

  const counted = await git(["rev-list", "--count", sha, "--not", "HEAD", "origin/main"]);
  const count = Number(counted.stdout.trim());

  return counted.exitCode === 0 && /^\d+$/.test(counted.stdout.trim()) && count > 0
    ? { kind: "behind", count }
    : { kind: "behind" };
}

export function readMode(value: unknown): Mode {
  return MODES.find((mode) => mode === value) ?? "session";
}

// In `persistent` mode, "none" when current means clear any status line.
export function noticeAction(options: {
  mode: Mode;
  result: Behind;
  sha: string;
  last: Notice | undefined;
  hasSessionNotified: boolean;
  now: number;
}): Action {
  const { mode, result, sha, last, hasSessionNotified, now } = options;

  if (result.kind !== "behind" || mode === "off") {
    return "none";
  }

  if (mode === "persistent") {
    return "status";
  }

  if (hasSessionNotified) {
    return "none";
  }

  const isDue =
    mode === "session" ||
    (mode === "daily" && (last === undefined || now - last.at >= DAY_MS)) ||
    (mode === "sha" && last?.sha !== sha);

  return isDue ? "toast" : "none";
}

export function noticeText(result: Behind): string | undefined {
  if (result.kind !== "behind") {
    return undefined;
  }

  return result.count === undefined
    ? "Graft updates are available. Run /graft:update."
    : `Graft is ${result.count} ${result.count === 1 ? "commit" : "commits"} behind upstream. Run /graft:update.`;
}

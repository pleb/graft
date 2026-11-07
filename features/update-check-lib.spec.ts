import { describe, expect, it } from "vitest";
import {
  checkBehind,
  isLookDue,
  LOCAL_PROBE_ENV,
  lsRemoteEnv,
  noticeAction,
  noticeText,
  parseLsRemote,
  readMode,
  type Behind,
  type Git,
  type Look,
  type Probe,
} from "./update-check-lib.ts";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const URL = "https://github.com/pleb/graft.git";
const SHA = "a".repeat(40);
const SHA256 = "b".repeat(64);

const failed = (failures: number, at = 0): Look => ({ url: URL, at, isOk: false, failures });

describe("isLookDue", () => {
  it("is due with no stored look", () => {
    expect(isLookDue(undefined, URL, 0)).toBe(true);
  });

  it("is due when the URL changed", () => {
    expect(isLookDue({ url: "other", at: 0, isOk: true, failures: 0 }, URL, 1)).toBe(true);
  });

  it("waits 24 hours after a success", () => {
    const look: Look = { url: URL, at: 0, isOk: true, failures: 0 };

    expect(isLookDue(look, URL, DAY - 1)).toBe(false);
    expect(isLookDue(look, URL, DAY)).toBe(true);
  });

  it("is due when the stored look is later than now", () => {
    expect(isLookDue({ url: URL, at: DAY, isOk: true, failures: 0 }, URL, DAY - 1)).toBe(true);
    expect(isLookDue(failed(1, DAY), URL, DAY - 1)).toBe(true);
  });

  it("waits 1 hour after one failure, doubling per failure", () => {
    expect(isLookDue(failed(1), URL, HOUR - 1)).toBe(false);
    expect(isLookDue(failed(1), URL, HOUR)).toBe(true);
    expect(isLookDue(failed(2), URL, 2 * HOUR - 1)).toBe(false);
    expect(isLookDue(failed(2), URL, 2 * HOUR)).toBe(true);
    expect(isLookDue(failed(4), URL, 8 * HOUR - 1)).toBe(false);
    expect(isLookDue(failed(4), URL, 8 * HOUR)).toBe(true);
  });

  it("caps the failure wait at 24 hours", () => {
    expect(isLookDue(failed(6), URL, DAY - 1)).toBe(false);
    expect(isLookDue(failed(6), URL, DAY)).toBe(true);
    expect(isLookDue(failed(50), URL, DAY)).toBe(true);
  });

  it("treats a failure with no count as the first", () => {
    expect(isLookDue(failed(0), URL, HOUR)).toBe(true);
  });
});

describe("lsRemoteEnv", () => {
  it("adds the credential overrides to the base env", () => {
    const base = { GIT_TERMINAL_PROMPT: "0", GIT_SSH_COMMAND: "ssh -o BatchMode=yes" };

    expect(lsRemoteEnv(base)).toEqual({
      ...base,
      GCM_INTERACTIVE: "never",
      GIT_ASKPASS: "",
      SSH_ASKPASS: "",
    });
    expect(base).not.toHaveProperty("GCM_INTERACTIVE");
  });

  it("keeps lazy fetch off for local probes", () => {
    expect(LOCAL_PROBE_ENV).toEqual({ GIT_NO_LAZY_FETCH: "1" });
  });
});

describe("parseLsRemote", () => {
  it("reads a SHA-1 for main", () => {
    expect(parseLsRemote(`${SHA}\trefs/heads/main\n`)).toBe(SHA);
  });

  it("reads a SHA-256 for main", () => {
    expect(parseLsRemote(`${SHA256}\trefs/heads/main\n`)).toBe(SHA256);
  });

  it("picks main among other refs", () => {
    expect(
      parseLsRemote(`${"c".repeat(40)}\trefs/heads/maintenance\n${SHA}\trefs/heads/main\n`),
    ).toBe(SHA);
  });

  it("fails on empty output", () => {
    expect(parseLsRemote("")).toBeUndefined();
  });

  it("fails with no main ref or a malformed SHA", () => {
    expect(parseLsRemote(`${SHA}\trefs/heads/dev\n`)).toBeUndefined();
    expect(parseLsRemote(`${"a".repeat(39)}\trefs/heads/main\n`)).toBeUndefined();
    expect(parseLsRemote(`${"g".repeat(40)}\trefs/heads/main\n`)).toBeUndefined();
  });
});

function fakeGit(answers: Record<string, Probe | Probe[]>): { git: Git; calls: string[][] } {
  const calls: string[][] = [];
  const git: Git = async (args) => {
    calls.push([...args]);
    const answer = answers[args[0]!];
    const probe = Array.isArray(answer) ? answer.shift() : answer;

    if (probe === undefined) {
      throw new Error(`unexpected git ${args.join(" ")}`);
    }

    return probe;
  };

  return { git, calls };
}

const exit = (exitCode: number | undefined, stdout = ""): Probe => ({ exitCode, stdout });

describe("checkBehind", () => {
  it("is behind without a count when the commit is missing", async () => {
    const { git, calls } = fakeGit({ "cat-file": exit(1) });

    expect(await checkBehind(SHA, git)).toEqual({ kind: "behind" });
    expect(calls).toEqual([["cat-file", "-e", SHA]]);
  });

  it("is up to date when HEAD has the commit", async () => {
    const { git, calls } = fakeGit({ "cat-file": exit(0), "merge-base": [exit(0)] });

    expect(await checkBehind(SHA, git)).toEqual({ kind: "current" });
    expect(calls).toEqual([
      ["cat-file", "-e", SHA],
      ["merge-base", "--is-ancestor", SHA, "HEAD"],
    ]);
  });

  it("is up to date when only origin/main has the commit", async () => {
    const { git, calls } = fakeGit({ "cat-file": exit(0), "merge-base": [exit(1), exit(0)] });

    expect(await checkBehind(SHA, git)).toEqual({ kind: "current" });
    expect(calls.at(-1)).toEqual(["merge-base", "--is-ancestor", SHA, "origin/main"]);
  });

  it("counts the commits when neither has it", async () => {
    const { git, calls } = fakeGit({
      "cat-file": exit(0),
      "merge-base": [exit(1), exit(1)],
      "rev-list": exit(0, "3\n"),
    });

    expect(await checkBehind(SHA, git)).toEqual({ kind: "behind", count: 3 });
    expect(calls.at(-1)).toEqual(["rev-list", "--count", SHA, "--not", "HEAD", "origin/main"]);
  });

  it("is behind without a count when the count fails", async () => {
    const { git } = fakeGit({
      "cat-file": exit(0),
      "merge-base": [exit(1), exit(1)],
      "rev-list": exit(128),
    });

    expect(await checkBehind(SHA, git)).toEqual({ kind: "behind" });
  });

  it.each([128, undefined])("is unknown when cat-file exits %s", async (code) => {
    const { git } = fakeGit({ "cat-file": exit(code) });

    expect(await checkBehind(SHA, git)).toEqual({ kind: "unknown" });
  });

  it.each([
    [[exit(128)]],
    [[exit(undefined)]],
    [[exit(1), exit(128)]],
    [[exit(1), exit(undefined)]],
  ])("is unknown when merge-base fails (%#)", async (mergeBase) => {
    const { git } = fakeGit({ "cat-file": exit(0), "merge-base": mergeBase });

    expect(await checkBehind(SHA, git)).toEqual({ kind: "unknown" });
  });
});

describe("readMode", () => {
  it.each(["session", "daily", "sha", "persistent", "off"])("reads %s", (mode) => {
    expect(readMode(mode)).toBe(mode);
  });

  it.each([undefined, "", "weekly", "SESSION", 1, null])("reads %s as session", (value) => {
    expect(readMode(value)).toBe("session");
  });
});

describe("noticeAction", () => {
  const behind: Behind = { kind: "behind", count: 2 };
  const base = { result: behind, sha: SHA, last: undefined, hasSessionNotified: false, now: DAY };

  it("never notifies when up to date or unknown", () => {
    for (const mode of ["session", "daily", "sha", "persistent", "off"] as const) {
      expect(noticeAction({ ...base, mode, result: { kind: "current" } })).toBe("none");
      expect(noticeAction({ ...base, mode, result: { kind: "unknown" } })).toBe("none");
    }
  });

  it("never notifies when off", () => {
    expect(noticeAction({ ...base, mode: "off" })).toBe("none");
  });

  it("toasts once per session in session mode", () => {
    const last = { at: DAY - 1, sha: SHA };

    expect(noticeAction({ ...base, mode: "session", last })).toBe("toast");
    expect(noticeAction({ ...base, mode: "session", last, hasSessionNotified: true })).toBe("none");
  });

  it("toasts in daily mode 24 hours after the last notice", () => {
    expect(noticeAction({ ...base, mode: "daily" })).toBe("toast");
    expect(noticeAction({ ...base, mode: "daily", last: { at: 1, sha: SHA } })).toBe("none");
    expect(noticeAction({ ...base, mode: "daily", last: { at: 0, sha: SHA } })).toBe("toast");
    expect(
      noticeAction({ ...base, mode: "daily", last: { at: 0, sha: SHA }, hasSessionNotified: true }),
    ).toBe("none");
  });

  it("toasts once per upstream SHA in sha mode", () => {
    expect(noticeAction({ ...base, mode: "sha" })).toBe("toast");
    expect(noticeAction({ ...base, mode: "sha", last: { at: 0, sha: SHA } })).toBe("none");
    expect(noticeAction({ ...base, mode: "sha", last: { at: 0, sha: SHA256 } })).toBe("toast");
  });

  it("shows a status line in persistent mode while behind", () => {
    expect(noticeAction({ ...base, mode: "persistent" })).toBe("status");
    expect(
      noticeAction({
        ...base,
        mode: "persistent",
        hasSessionNotified: true,
        last: { at: DAY, sha: SHA },
      }),
    ).toBe("status");
  });
});

describe("noticeText", () => {
  it("gives the count", () => {
    expect(noticeText({ kind: "behind", count: 1 })).toBe(
      "Graft is 1 commit behind upstream. Run /graft:update.",
    );
    expect(noticeText({ kind: "behind", count: 5 })).toBe(
      "Graft is 5 commits behind upstream. Run /graft:update.",
    );
  });

  it("says updates are available without a count", () => {
    expect(noticeText({ kind: "behind" })).toBe("Graft updates are available. Run /graft:update.");
  });

  it("has no text when up to date or unknown", () => {
    expect(noticeText({ kind: "current" })).toBeUndefined();
    expect(noticeText({ kind: "unknown" })).toBeUndefined();
  });
});

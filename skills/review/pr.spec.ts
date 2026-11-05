import { spawnSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  commentableLines,
  commentBody,
  findingMarker,
  parseInput,
  parsePrior,
  parsePrUrl,
  parseTarget,
  planPost,
  remoteFor,
  repoSlug,
  reviewBody,
  slug,
  stripMarkers,
  withoutMarkers,
  worktreePaths,
} from "./pr-lib.ts";
import type { Finding, PostInput, PriorComment } from "./pr-lib.ts";

const SCRIPT = fileURLToPath(new URL("./pr.ts", import.meta.url));
const BASE = "a".repeat(40);
const HEAD = "b".repeat(40);
const PR_URL = "https://github.com/pleb/graft/pull/12";

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "review-test-")));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function finding(over: Partial<Finding> = {}): Finding {
  return {
    title: "Off-by-one in the loop",
    severity: "major",
    source: "confirmed",
    file: "src/mod.ts",
    line: 3,
    impact: "The last item is skipped.",
    recommendation: "Use <= instead of <.",
    ...over,
  };
}

function input(over: Record<string, unknown> = {}): Record<string, unknown> {
  return { url: PR_URL, base: BASE, head: HEAD, summary: "Looks fine.", findings: [], ...over };
}

function prior(body: string): PriorComment {
  return { path: null, line: null, author: "someone", body };
}

const MODIFIED = `diff --git a/src/mod.ts b/src/mod.ts
index 1111111..2222222 100644
--- a/src/mod.ts
+++ b/src/mod.ts
@@ -1,5 +1,5 @@
 line 1
 line 2
-line 3
+changed 3
 line 4
 line 5
@@ -20,3 +20,4 @@ function f() {
 line 20
+added 21
 line 22
 line 23
`;

const RENAMED = `diff --git a/src/old-name.ts b/src/new-name.ts
similarity index 90%
rename from src/old-name.ts
rename to src/new-name.ts
index 3333333..4444444 100644
--- a/src/old-name.ts
+++ b/src/new-name.ts
@@ -8,3 +8,3 @@
 moved 8
 moved 9
-moved 10
+renamed 10
diff --git a/src/same.ts b/src/moved.ts
similarity index 100%
rename from src/same.ts
rename to src/moved.ts
`;

const DELETED = `diff --git a/src/del.ts b/src/del.ts
deleted file mode 100644
index 5555555..0000000
--- a/src/del.ts
+++ /dev/null
@@ -1,3 +0,0 @@
-gone 1
-gone 2
-gone 3
`;

const ADDED = `diff --git a/src/added.ts b/src/added.ts
new file mode 100644
index 0000000..6666666
--- /dev/null
+++ b/src/added.ts
@@ -0,0 +1,2 @@
+export const a = 1;
+export const b = 2;
`;

const NO_NEWLINE = `diff --git a/nonl.txt b/nonl.txt
index 7777777..8888888 100644
--- a/nonl.txt
+++ b/nonl.txt
@@ -1,2 +1,3 @@
 a
-b
\\ No newline at end of file
+c
+d
\\ No newline at end of file
`;

describe("parsePrUrl", () => {
  it("splits a PR URL into host, owner, repo and number", () => {
    const ref = parsePrUrl(PR_URL);
    expect(ref).toEqual({ host: "github.com", owner: "pleb", repo: "graft", number: 12 });
    expect(repoSlug(ref)).toBe("github.com/pleb/graft");
  });

  it("accepts an enterprise host and a trailing path", () => {
    expect(parsePrUrl("https://ghe.example.com/team/app/pull/7/files#diff")).toEqual({
      host: "ghe.example.com",
      owner: "team",
      repo: "app",
      number: 7,
    });
  });

  it("rejects anything else", () => {
    for (const url of [
      "https://github.com/pleb/graft/issues/12",
      "https://github.com/pleb/graft/pull/0",
      "https://github.com/pleb/pull/12",
      "github.com/pleb/graft/pull/12",
    ]) {
      expect(() => parsePrUrl(url), url).toThrow("is not a pull request URL");
    }
  });
});

describe("parseTarget", () => {
  it("takes a number or a URL", () => {
    expect(parseTarget("42")).toBe(42);
    expect(parseTarget(PR_URL)).toEqual(parsePrUrl(PR_URL));
    expect(() => parseTarget("#42")).toThrow("is not a pull request URL");
  });
});

describe("remoteFor", () => {
  const ref = parsePrUrl(PR_URL);

  it("finds the remote whose fetch URL is the PR's host and repo", () => {
    const remotes = [
      "fork\thttps://github.com/someone/graft.git (fetch)",
      "fork\thttps://github.com/someone/graft.git (push)",
      "upstream\tgit@github.com:Pleb/Graft.git (fetch)",
      "upstream\tgit@github.com:Pleb/Graft.git (push)",
    ].join("\n");
    expect(remoteFor(remotes, ref)).toBe("upstream");
  });

  it("reads https, ssh and scp-like URLs", () => {
    for (const url of [
      "https://github.com/pleb/graft",
      "https://user@github.com/pleb/graft.git/",
      "ssh://git@github.com:22/pleb/graft.git",
      "git@github.com:pleb/graft.git",
    ]) {
      expect(remoteFor(`origin\t${url} (fetch)`, ref), url).toBe("origin");
    }
  });

  it("returns null when no remote matches the host and repo", () => {
    const remotes = [
      "origin\thttps://ghe.example.com/pleb/graft.git (fetch)",
      "other\thttps://github.com/pleb/graft-extra.git (fetch)",
      "local\t/srv/git/graft (fetch)",
    ].join("\n");
    expect(remoteFor(remotes, ref)).toBeNull();
  });

  it("matches an SSH host alias that resolves to the PR's host", () => {
    const resolve = (host: string) => (host === "github-work" ? "github.com" : host);
    for (const url of ["git@github-work:pleb/graft.git", "ssh://git@github-work/pleb/graft.git"]) {
      expect(remoteFor(`origin\t${url} (fetch)`, ref, resolve), url).toBe("origin");
    }
    expect(
      remoteFor("origin\thttps://github-work/pleb/graft.git (fetch)", ref, resolve),
    ).toBeNull();
  });

  it("treats ssh.github.com as github.com", () => {
    for (const url of [
      "ssh://git@ssh.github.com:443/pleb/graft.git",
      "git@ssh.github.com:pleb/graft.git",
    ]) {
      expect(remoteFor(`origin\t${url} (fetch)`, ref), url).toBe("origin");
    }
    const resolve = (host: string) => (host === "github-443" ? "ssh.github.com" : host);
    expect(remoteFor("origin\tgit@github-443:pleb/graft.git (fetch)", ref, resolve)).toBe("origin");
  });

  it("refuses an SSH host alias that does not resolve", () => {
    const resolve = (host: string) => host;
    expect(remoteFor("origin\tgit@github-work:pleb/graft.git (fetch)", ref, resolve)).toBeNull();
  });
});

describe("worktreePaths", () => {
  it("lists each worktree's path", () => {
    const porcelain = [
      "worktree /repo",
      "HEAD abc",
      "branch refs/heads/main",
      "",
      "worktree /tmp/review/pr-12",
      "HEAD def",
      "detached",
      "",
    ].join("\n");
    expect(worktreePaths(porcelain)).toEqual(["/repo", "/tmp/review/pr-12"]);
  });
});

describe("commentableLines", () => {
  it("lists the new-file numbers of added and context lines", () => {
    expect(commentableLines(MODIFIED)).toEqual(
      new Map([["src/mod.ts", new Set([1, 2, 3, 4, 5, 20, 21, 22, 23])]]),
    );
  });

  it("uses a renamed file's new path, and a pure rename has no lines", () => {
    expect(commentableLines(RENAMED)).toEqual(new Map([["src/new-name.ts", new Set([8, 9, 10])]]));
  });

  it("gives a deleted file no lines", () => {
    expect(commentableLines(DELETED)).toEqual(new Map());
  });

  it("numbers a new file from 1", () => {
    expect(commentableLines(ADDED)).toEqual(new Map([["src/added.ts", new Set([1, 2])]]));
  });

  it("skips the no-newline marker", () => {
    expect(commentableLines(NO_NEWLINE)).toEqual(new Map([["nonl.txt", new Set([1, 2, 3])]]));
  });

  it("keeps each file of a combined diff apart", () => {
    const lines = commentableLines(DELETED + MODIFIED + ADDED);
    expect([...lines.keys()]).toEqual(["src/mod.ts", "src/added.ts"]);
  });
});

describe("slug and findingMarker", () => {
  it("lowercases and joins words with hyphens", () => {
    expect(slug("  Off-by-one in `loop()`!  ")).toBe("off-by-one-in-loop");
  });

  it("names the file, line and title slug", () => {
    expect(findingMarker(finding())).toBe(
      "<!-- graft-review: src/mod.ts:3#off-by-one-in-the-loop -->",
    );
    expect(findingMarker(finding({ line: null }))).toBe(
      "<!-- graft-review: src/mod.ts:n/a#off-by-one-in-the-loop -->",
    );
    expect(findingMarker(finding({ file: null, line: null }))).toBe(
      "<!-- graft-review: n/a:n/a#off-by-one-in-the-loop -->",
    );
  });
});

describe("parsePrior and withoutMarkers", () => {
  it("parses gh's JSON lines", () => {
    const text = [
      '{"path":"src/mod.ts","line":3,"author":"amy","body":"Nit."}',
      "",
      '{"path":null,"line":null,"author":"bob","body":"LGTM"}',
    ].join("\n");
    expect(parsePrior(text)).toEqual([
      { path: "src/mod.ts", line: 3, author: "amy", body: "Nit." },
      { path: null, line: null, author: "bob", body: "LGTM" },
    ]);
  });

  it("rejects output that is not a prior comment", () => {
    expect(() => parsePrior("not json")).toThrow("Unexpected prior comment from gh");
    expect(() => parsePrior('{"path":null,"line":null,"body":"x"}')).toThrow(
      "Unexpected prior comment from gh",
    );
  });

  it("strips markers, and drops a comment left empty", () => {
    const posted = commentBody(finding());
    expect(stripMarkers(posted)).not.toContain("graft-review");
    expect(stripMarkers(posted)).toBe(posted.slice(0, posted.lastIndexOf("\n\n")));
    expect(
      withoutMarkers([
        prior(reviewBody("Summary.", [finding()])),
        prior("<!-- graft-review: n/a:n/a#x -->"),
      ]),
    ).toEqual([
      prior(
        [
          "## Graft review",
          "",
          "Summary.",
          "",
          "### Findings outside the diff",
          "",
          "- **major (confirmed)** `src/mod.ts:3`: Off-by-one in the loop",
          "  Impact: The last item is skipped.",
          "  Recommendation: Use <= instead of <.",
        ].join("\n"),
      ),
    ]);
  });
});

describe("parseInput", () => {
  it("accepts a valid input, defaulting a missing location to null", () => {
    const { file, line, ...rest } = finding();
    const parsed: PostInput = parseInput(input({ findings: [finding(), rest] }));
    expect(parsed.findings).toEqual([finding(), finding({ file: null, line: null })]);
    expect(parsed).toMatchObject({ url: PR_URL, base: BASE, head: HEAD, summary: "Looks fine." });
  });

  it("rejects an absolute file", () => {
    for (const file of ["/repo/src/mod.ts", "C:\\repo\\src\\mod.ts", "C:/repo/mod.ts", "\\x"]) {
      expect(() => parseInput(input({ findings: [finding({ file })] })), file).toThrow(
        'Input "findings[0].file" must be relative to the repo root',
      );
    }
  });

  it("rejects a malformed input", () => {
    const cases: [unknown, string][] = [
      [[], "Input must be a JSON object"],
      [input({ url: "https://github.com/pleb/graft" }), "is not a pull request URL"],
      [input({ head: "main" }), 'Input "head" must be a full commit id'],
      [input({ findings: undefined }), 'Input "findings" must be an array'],
      [input({ findings: [finding({ line: 0 })] }), "must be a positive integer or null"],
      [input({ findings: [finding({ file: null })] }), "has a line but no file"],
      [input({ findings: [finding({ title: " " })] }), 'Input "findings[0].title"'],
      [input({ findings: [{ ...finding(), severity: "critical" }] }), "must be one of"],
      [input({ findings: [{ ...finding(), source: "codex" }] }), "must be one of"],
    ];
    for (const [value, message] of cases) {
      expect(() => parseInput(value), message).toThrow(message);
    }
  });
});

describe("planPost", () => {
  const lines = commentableLines(MODIFIED + DELETED);

  it("puts findings on commentable lines inline and the rest in the body", () => {
    const inline = finding();
    const removed = finding({ title: "Removed line", file: "src/del.ts", line: 2 });
    const outsideHunk = finding({ title: "Outside the hunks", line: 10 });
    const noLine = finding({ title: "Whole file", line: null });
    const nowhere = finding({ title: "No location", file: null, line: null });
    const plan = planPost([inline, removed, outsideHunk, noLine, nowhere], lines, []);
    expect(plan.inline).toEqual([
      { path: "src/mod.ts", line: 3, body: commentBody(inline), finding: inline },
    ]);
    expect(plan.outside).toEqual([removed, outsideHunk, noLine, nowhere]);
    expect(plan.skipped).toEqual([]);
  });

  it("skips a finding whose marker a prior comment carries, or that is already raised", () => {
    const posted = finding();
    const sameTitleElsewhere = finding({ line: 21 });
    const raised = finding({ title: "Raised before", source: "already-raised" });
    const plan = planPost([posted, sameTitleElsewhere, raised], lines, [
      prior(`Earlier.\n\n${findingMarker(posted)}`),
    ]);
    expect(plan.skipped).toEqual([posted, raised]);
    expect(plan.inline.map((comment) => comment.finding)).toEqual([sameTitleElsewhere]);
  });
});

describe("commentBody and reviewBody", () => {
  it("formats an inline comment", () => {
    expect(commentBody(finding())).toBe(
      [
        "**major (confirmed): Off-by-one in the loop**",
        "Impact: The last item is skipped.",
        "Recommendation: Use <= instead of <.",
        "<!-- graft-review: src/mod.ts:3#off-by-one-in-the-loop -->",
      ].join("\n\n"),
    );
  });

  it("leaves out empty details", () => {
    expect(commentBody(finding({ impact: "", recommendation: " " }))).toBe(
      "**major (confirmed): Off-by-one in the loop**\n\n<!-- graft-review: src/mod.ts:3#off-by-one-in-the-loop -->",
    );
  });

  it("lists findings outside the diff under the summary", () => {
    const multiline = finding({
      title: "No location",
      severity: "nit",
      source: "one reviewer",
      file: null,
      line: null,
      recommendation: "First.\nSecond.",
    });
    expect(reviewBody("Two issues.", [finding({ line: null }), multiline])).toBe(
      [
        "## Graft review",
        "",
        "Two issues.",
        "",
        "### Findings outside the diff",
        "",
        "- **major (confirmed)** `src/mod.ts`: Off-by-one in the loop",
        "  Impact: The last item is skipped.",
        "  Recommendation: Use <= instead of <.",
        "  <!-- graft-review: src/mod.ts:n/a#off-by-one-in-the-loop -->",
        "- **nit (one reviewer)** no location: No location",
        "  Impact: The last item is skipped.",
        "  Recommendation: First.",
        "  Second.",
        "  <!-- graft-review: n/a:n/a#no-location -->",
      ].join("\n"),
    );
  });

  it("is only the heading and summary when every finding is inline", () => {
    expect(reviewBody("All inline.", [])).toBe("## Graft review\n\nAll inline.");
    expect(reviewBody("", [])).toBe("## Graft review");
  });
});

describe("pr.ts", () => {
  function runScript(args: string[], cwd: string) {
    const env = { ...process.env };
    delete env.GH_REPO;
    return spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: "utf8", env });
  }

  it("prints usage for unknown arguments", () => {
    const result = runScript(["post"], tempDir());
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Usage: node pr.ts view");
  });

  it("rejects an absolute file in post before calling gh", () => {
    const dir = tempDir();
    const file = join(dir, "input.json");
    writeFileSync(file, JSON.stringify(input({ findings: [finding({ file: "/abs/mod.ts" })] })));
    const result = runScript(["post", "--input", file], dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("must be relative to the repo root");
  });

  it("prints null for view with no argument outside a GitHub repo", () => {
    const dir = tempDir();
    spawnSync("git", ["init", "-q", dir]);
    const result = runScript(["view"], dir);
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("null");
    expect(result.stderr.trim()).not.toBe("");
  });
});

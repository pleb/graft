import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  collectPage,
  decodePath,
  encodePath,
  fileId,
  isSupportedNode,
  lineId,
  listChanges,
  MAX_PAGE_BYTES,
  mergeSides,
  pageName,
  parseDiff,
  parseInput,
  parseLineId,
  renderPage,
  threadId,
  toPageFile,
  unquoteGitPath,
  untrackedFile,
} from "./build-lib.ts";
import type { BuildInput, PageData, PageFile } from "./build-lib.ts";

const SCRIPT = fileURLToPath(new URL("./build.ts", import.meta.url));
const TEMPLATE = readFileSync(fileURLToPath(new URL("./template.html", import.meta.url)), "utf8");
const USAGE = "Usage: node build.ts files --default <branch> | build --input <file> --out <file>";
const DATA_OPEN = '<script id="diff-data" type="application/json">';

// Keep the developer's own git config out of the temp repos.
process.env.GIT_CONFIG_GLOBAL = "/dev/null";
process.env.GIT_CONFIG_NOSYSTEM = "1";

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "diff-test-")));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function git(dir: string, ...args: string[]): string {
  const result = spawnSync("git", ["-C", dir, ...args], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
  return result.stdout.trim();
}

function write(dir: string, files: Record<string, string | Buffer>): void {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
}

function commitAll(dir: string, message: string): void {
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", message);
}

function newRepo(files: Record<string, string | Buffer>, dir = tempDir()): string {
  mkdirSync(dir, { recursive: true });
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.name", "Test User");
  git(dir, "config", "user.email", "test@example.com");
  git(dir, "config", "commit.gpgsign", "false");
  write(dir, files);
  commitAll(dir, "base");
  return dir;
}

function lines(prefix: string, count: number): string {
  return Array.from({ length: count }, (_, i) => `${prefix} ${i + 1}\n`).join("");
}

function input(over: Partial<BuildInput> = {}): BuildInput {
  return { default: "main", untracked: [], exclude: [], threads: [], publish: 1, ...over };
}

function byPath(data: PageData): Map<string, PageFile> {
  return new Map(data.files.map((file) => [file.path, file]));
}

function embedded(html: string): PageData {
  const start = html.indexOf(DATA_OPEN) + DATA_OPEN.length;
  return JSON.parse(html.slice(start, html.indexOf("</script>", start)));
}

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 1, 2, 3]);

// A feature branch with every kind of change: committed, uncommitted, untracked and a nested repo.
function featureRepo(): string {
  const dir = newRepo({
    "src/mod.ts": lines("line", 5),
    "src/del.ts": lines("gone", 3),
    "src/old-name.ts": lines("moved", 10),
    "img.png": PNG,
    "package-lock.json": '{\n  "a": 1,\n  "b": 2\n}\n',
    "nonl.txt": "a\nb",
  });
  git(dir, "checkout", "-q", "-b", "feature");
  write(dir, {
    "src/mod.ts": lines("line", 5).replace("line 3\n", "changed 3\n"),
    "src/added.ts": "export const added = 1;\n",
    "img.png": Buffer.concat([PNG, Buffer.from([4, 5])]),
    "package-lock.json": '{\n  "a": 1,\n  "b": 3,\n  "c": 4\n}\n',
  });
  rmSync(join(dir, "src/del.ts"));
  git(dir, "mv", "src/old-name.ts", "src/new-name.ts");
  write(dir, { "src/new-name.ts": lines("moved", 10).replace("moved 10\n", "renamed 10\n") });
  commitAll(dir, "feature");
  write(dir, { "nonl.txt": "a\nc", "notes.md": "# Notes\n" });
  newRepo({ "inner.txt": "inner\n" }, join(dir, "nested"));
  return dir;
}

describe("isSupportedNode", () => {
  it("accepts Node 24 and later", () => {
    expect(isSupportedNode("24.0.0")).toBe(true);
    expect(isSupportedNode("25.9.0")).toBe(true);
    expect(isSupportedNode("22.12.0")).toBe(false);
  });
});

describe("line ids", () => {
  it("encodes paths one-to-one", () => {
    const paths = ["a.b.ts", "a-b.ts", "a/b.ts", "/a", "˺", "a_2f_"];
    const encoded = paths.map(encodePath);
    expect(new Set(encoded).size).toBe(paths.length);
    expect(encodePath("src/a.b.ts")).toBe("src_2f_a_2e_b_2e_ts");
    for (const path of [...paths, "dir with space/naïve 文件.ts", "emoji \u{1f600}.md"]) {
      expect(decodePath(encodePath(path))).toBe(path);
      expect(encodePath(path)).toMatch(/^[A-Za-z0-9_]*$/);
    }
  });

  it("parses line ids back into path, side and line", () => {
    const path = "dir with space/naïve.ts";
    expect(lineId(path, "old", 12)).toBe("f-dir_20_with_20_space_2f_na_ef_ve_2e_ts-old-12");
    expect(parseLineId(lineId(path, "old", 12))).toEqual({ path, side: "old", line: 12 });
    expect(parseLineId(lineId("a-b.ts", "new", 3))).toEqual({
      path: "a-b.ts",
      side: "new",
      line: 3,
    });
    expect(parseLineId("f-a_2d_b-mid-3")).toBeNull();
    expect(parseLineId("f-a_2d-new-3")).toBeNull();
    expect(parseLineId("f-a-new-0")).toBeNull();
    expect(parseLineId("f-a_41_-new-1")).toBeNull();
  });
});

describe("parseDiff", () => {
  it("unquotes C-style quoted paths", () => {
    expect(unquoteGitPath('"a/tab\\there \\"q\\" \\303\\274"')).toBe('a/tab\there "q" ü');
    expect(unquoteGitPath("plain path")).toBe("plain path");
  });

  it("keeps astral characters whole in quoted paths", () => {
    expect(unquoteGitPath('"emoji \u{1f600}\\tx.md"')).toBe("emoji \u{1f600}\tx.md");
    expect(unquoteGitPath('"\\360\\237\\230\\200 \u{1f600}"')).toBe("\u{1f600} \u{1f600}");
  });

  it("merges a delete and an add of one path", () => {
    const gone = parseDiff(
      "diff --git a/f b/f\ndeleted file mode 100644\nindex 1111111..0000000\n--- a/f\n+++ /dev/null\n@@ -1 +0,0 @@\n-hello\n",
    )[0];
    const added = parseDiff(
      "diff --git a/f b/f\nnew file mode 120000\nindex 0000000..2222222\n--- /dev/null\n+++ b/f\n@@ -0,0 +1 @@\n+target\n\\ No newline at end of file\n",
    )[0];
    expect(mergeSides(gone, added)).toEqual({
      path: "f",
      status: "T",
      oldMode: "100644",
      newMode: "120000",
      index: "1111111..2222222",
      hunks: [...gone.hunks, ...added.hunks],
    });
  });

  it("reads quoted names and keeps an empty context line", () => {
    const text = [
      'diff --git "a/x\\ty" "b/x\\ty"',
      "index 1..2 100644",
      '--- "a/x\\ty"',
      '+++ "b/x\\ty"',
      "@@ -1,3 +1,3 @@",
      " one",
      "",
      "-two",
      "+three",
      "",
    ].join("\n");
    expect(parseDiff(text)).toEqual([
      {
        path: "x\ty",
        status: "M",
        index: "1..2 100644",
        hunks: [
          {
            header: "@@ -1,3 +1,3 @@",
            lines: [
              [" ", 1, 1, "one"],
              [" ", 2, 2, ""],
              ["-", 3, null, "two"],
              ["+", null, 3, "three"],
            ],
          },
        ],
      },
    ]);
  });
});

describe("parseInput", () => {
  it("fills defaults and rejects bad fields", () => {
    expect(parseInput({ default: "main" })).toEqual(input());
    expect(() => parseInput({ default: "main", untracked: "a" })).toThrow(
      'Input "untracked" must be an array of strings',
    );
    expect(() => parseInput({ default: "main", publish: 1.5 })).toThrow('Input "publish"');
    expect(() => parseInput([])).toThrow("Input must be a JSON object");
  });

  it("reads threads as path, side and line", () => {
    const thread = { path: "a.ts", side: "old", line: 3 };
    expect(parseInput({ default: "main", threads: [thread] }).threads).toEqual([thread]);
    for (const bad of [
      ["f-a-new-1"],
      [{ path: "a.ts", side: "mid", line: 3 }],
      [{ path: "a.ts", side: "new", line: 0 }],
      [{ side: "new", line: 1 }],
      [{ path: "a.ts", side: "file", line: 1 }],
      [{ path: "a.ts", side: "hunk" }],
      [{ path: "a.ts", side: "hunk", line: -1 }],
      [null],
    ]) {
      expect(() => parseInput({ default: "main", threads: bad })).toThrow(
        'Input "threads" must be an array of {"path"',
      );
    }
  });

  it("reads file threads without a line and hunk threads with their new start line", () => {
    const threads = [
      { path: "a.ts", side: "file" },
      { path: "a.ts", side: "hunk", line: 12 },
      { path: "gone.ts", side: "hunk", line: 0 },
    ];
    expect(parseInput({ default: "main", threads }).threads).toEqual(threads);
    expect(threadId({ path: "a.ts", side: "file" })).toBe("f-a_2e_ts-file");
    expect(threadId({ path: "a.ts", side: "hunk", line: 12 })).toBe("f-a_2e_ts-hunk-12");
    expect(threadId({ path: "a.ts", side: "old", line: 3 })).toBe(lineId("a.ts", "old", 3));
  });
});

describe("listChanges", () => {
  it("lists tracked and untracked changes against the local default branch", () => {
    const dir = featureRepo();
    const changes = listChanges(dir, "main");
    expect(changes).toEqual({
      root: dir,
      name: pageName(dir),
      base: git(dir, "rev-parse", "main"),
      baseRef: "main",
      tracked: [
        "img.png",
        "nonl.txt",
        "package-lock.json",
        "src/added.ts",
        "src/del.ts",
        "src/mod.ts",
        "src/old-name.ts",
        "src/new-name.ts",
      ],
      untracked: ["notes.md"],
    });
  });

  it("names the page uniquely for each root", () => {
    expect(pageName("/work/a-b")).toMatch(/^a-b-[0-9a-f]{8}$/);
    expect(pageName("/work/a/b")).toMatch(/^b-[0-9a-f]{8}$/);
    expect(pageName("/x/a-b")).not.toBe(pageName("/work/a-b"));
    expect(pageName("/work/naïve repo")).toMatch(/^na-ve-repo-[0-9a-f]{8}$/);
  });

  it("lists both paths of a rename, so a renamed sensitive file is seen", () => {
    const dir = newRepo({ ".env": "SECRET=1\n" });
    git(dir, "mv", ".env", "config.txt");
    expect(listChanges(dir, "main").tracked).toEqual([".env", "config.txt"]);
  });

  it("uses origin's branch when origin has it", () => {
    const dir = featureRepo();
    const origin = tempDir();
    git(dir, "clone", "-q", "--bare", dir, join(origin, "repo.git"));
    git(dir, "remote", "add", "origin", join(origin, "repo.git"));
    expect(listChanges(dir, "main").baseRef).toBe("main");
    git(dir, "fetch", "-q", "origin");
    const changes = listChanges(dir, "main");
    expect(changes.baseRef).toBe("origin/main");
    expect(changes.base).toBe(git(dir, "merge-base", "HEAD", "origin/main"));
  });

  it("fails when the base does not resolve", () => {
    const dir = featureRepo();
    expect(() => listChanges(dir, "nope")).toThrow("Cannot resolve the base: nope do not resolve");
  });
});

describe("collectPage", () => {
  it("parses every kind of change", () => {
    const dir = featureRepo();
    const data = collectPage(
      dir,
      input({
        untracked: ["notes.md"],
        threads: [
          { path: "src/mod.ts", side: "new", line: 3 },
          { path: "src/new-name.ts", side: "old", line: 10 },
        ],
        publish: 3,
      }),
    );
    const head = git(dir, "rev-parse", "--short", "HEAD");
    expect({ ...data, files: [] }).toEqual({
      repo: dir.split("/").at(-1),
      branch: "feature",
      base: "main",
      buildId: `${head}-3`,
      mergeBase: git(dir, "rev-parse", "--short", "main"),
      head,
      uncommitted: 1,
      untracked: 1,
      threads: [lineId("src/mod.ts", "new", 3), lineId("src/new-name.ts", "old", 10)],
      files: [],
    });
    expect(data.files.map((file) => file.path)).toEqual([
      "img.png",
      "nonl.txt",
      "notes.md",
      "package-lock.json",
      "src/added.ts",
      "src/del.ts",
      "src/mod.ts",
      "src/new-name.ts",
    ]);
    const files = byPath(data);

    const mod = files.get("src/mod.ts")!;
    expect(mod).toMatchObject({
      id: "f-src_2f_mod_2e_ts",
      status: "M",
      source: "committed",
      add: 1,
      del: 1,
    });
    expect(mod.hash).toMatch(/^[0-9a-f]{16}$/);
    expect(mod.hunks![0].lines).toEqual([
      [" ", 1, 1, "line 1"],
      [" ", 2, 2, "line 2"],
      ["-", 3, null, "line 3"],
      ["+", null, 3, "changed 3"],
      [" ", 4, 4, "line 4"],
      [" ", 5, 5, "line 5"],
    ]);

    expect(files.get("src/added.ts")).toMatchObject({ status: "A", add: 1, del: 0 });
    expect(files.get("src/added.ts")!.hunks![0].lines).toEqual([
      ["+", null, 1, "export const added = 1;"],
    ]);
    expect(files.get("src/del.ts")).toMatchObject({ status: "D", add: 0, del: 3 });

    const renamed = files.get("src/new-name.ts")!;
    expect(renamed).toMatchObject({ status: "R", oldPath: "src/old-name.ts", add: 1, del: 1 });
    expect(renamed.hunks![0].lines.at(-1)).toEqual(["+", null, 10, "renamed 10"]);

    const binary = files.get("img.png")!;
    expect(binary).toMatchObject({ status: "M", binary: true });
    expect(binary.hunks).toBeUndefined();

    const lock = files.get("package-lock.json")!;
    expect(lock).toMatchObject({
      stub: "Lockfile changed (+2 −1). Content hidden.",
      add: 2,
      del: 1,
    });
    expect(lock.hunks).toBeUndefined();

    const nonl = files.get("nonl.txt")!;
    expect(nonl.source).toBe("uncommitted");
    expect(nonl.hunks![0].lines).toEqual([
      [" ", 1, 1, "a"],
      ["-", 2, null, "b", 1],
      ["+", null, 2, "c", 1],
    ]);

    expect(files.get("notes.md")).toMatchObject({ status: "A", source: "untracked", add: 1 });
    expect(files.has("nested/inner.txt")).toBe(false);
  });

  it("fails on threads whose file is not in the page", () => {
    const dir = featureRepo();
    const threads = [
      { path: "src/mod.ts", side: "new" as const, line: 3 },
      { path: "src/old-name.ts", side: "old" as const, line: 10 },
      { path: "gone.ts", side: "new" as const, line: 1 },
    ];
    expect(() => collectPage(dir, input({ threads }))).toThrow(
      "Threads name files that are not in the page: src/old-name.ts (old 10), gone.ts (new 1)",
    );
  });

  it("builds ids for file and hunk threads", () => {
    const dir = featureRepo();
    const data = collectPage(
      dir,
      input({
        threads: [
          { path: "src/mod.ts", side: "file" },
          { path: "src/mod.ts", side: "hunk", line: 1 },
        ],
      }),
    );
    expect(data.threads).toEqual(["f-src_2f_mod_2e_ts-file", "f-src_2f_mod_2e_ts-hunk-1"]);
    expect(() => collectPage(dir, input({ threads: [{ path: "gone.ts", side: "file" }] }))).toThrow(
      "Threads name files that are not in the page: gone.ts (file)",
    );
  });

  it("embeds the new content of shown Markdown files only", () => {
    const dir = newRepo({
      "doc.md": "# Doc\n\nold\n",
      "work.markdown": "a\n",
      "gone.md": "bye\n",
      "code.ts": "a\n",
      "x.min.md": "a\n",
    });
    git(dir, "checkout", "-q", "-b", "feature");
    write(dir, { "doc.md": "# Doc\n\nnew\n", "code.ts": "b\n", "x.min.md": "b\n" });
    rmSync(join(dir, "gone.md"));
    commitAll(dir, "feature");
    write(dir, { "work.markdown": "b\n", "new.MDX": "# New" });
    const files = byPath(collectPage(dir, input({ untracked: ["new.MDX"] })));
    expect(files.get("doc.md")!.content).toEqual(["# Doc", "", "new", ""]);
    expect(files.get("work.markdown")!.content).toEqual(["b", ""]);
    expect(files.get("new.MDX")!.content).toEqual(["# New"]);
    for (const path of ["gone.md", "code.ts", "x.min.md"]) {
      expect(files.get(path)!.content).toBeUndefined();
    }
  });

  it("includes only the untracked files asked for and leaves out exclusions", () => {
    const dir = featureRepo();
    write(dir, { "other.md": "other\n" });
    const data = collectPage(
      dir,
      input({ untracked: ["notes.md"], exclude: ["src/mod.ts", "src/old-name.ts"] }),
    );
    const paths = data.files.map((file) => file.path);
    expect(paths).toContain("notes.md");
    expect(paths).not.toContain("other.md");
    expect(paths).not.toContain("src/mod.ts");
    expect(paths).not.toContain("src/new-name.ts");
    const excluded = collectPage(dir, input({ untracked: ["notes.md"], exclude: ["notes.md"] }));
    expect(excluded.files.map((file) => file.path)).not.toContain("notes.md");
    expect(() => collectPage(dir, input({ untracked: ["src/mod.ts"] }))).toThrow(
      "src/mod.ts is not an untracked file",
    );
  });

  it("keeps paths with spaces and non-ASCII characters", () => {
    const path = "dir with space/naïve 文件.ts";
    const dir = newRepo({ [path]: "one\n" });
    git(dir, "checkout", "-q", "-b", "feature");
    write(dir, { [path]: "two\n", "new ü file.md": "hi\n" });
    const data = collectPage(dir, input({ untracked: ["new ü file.md"] }));
    expect(data.files.map((file) => file.path)).toEqual([path, "new ü file.md"]);
    expect(data.files[0].hunks![0].lines).toEqual([
      ["-", 1, null, "one"],
      ["+", null, 1, "two"],
    ]);
    expect(parseLineId(lineId(path, "new", 1))).toEqual({ path, side: "new", line: 1 });
  });

  it("gives paths with colliding naive slugs distinct ids", () => {
    const dir = newRepo({ "README.md": "x\n" });
    git(dir, "checkout", "-q", "-b", "feature");
    write(dir, { "a.b.ts": "1\n", "a-b.ts": "2\n", "a/b.ts": "3\n" });
    commitAll(dir, "add");
    const data = collectPage(dir, input());
    expect(data.files.map((file) => file.id)).toEqual([
      "f-a_2d_b_2e_ts",
      "f-a_2e_b_2e_ts",
      "f-a_2f_b_2e_ts",
    ]);
  });

  it("ignores hostile diff config", () => {
    const dir = newRepo({ "src/a.ts": "one\n\ntwo\nthree\n", "docs/b.md": lines("doc", 10) });
    const base = git(dir, "rev-parse", "HEAD");
    git(dir, "update-index", "--add", "--cacheinfo", `160000,${base},sub`);
    git(dir, "commit", "-q", "-m", "submodule");
    mkdirSync(join(dir, "sub"));
    git(dir, "checkout", "-q", "-b", "feature");
    write(dir, { "src/a.ts": "one\n\ntwo\nfour\n" });
    git(dir, "mv", "docs/b.md", "docs/c.md");
    git(dir, "update-index", "--cacheinfo", `160000,${git(dir, "rev-parse", "HEAD")},sub`);
    commitAll(dir, "feature");
    const clean = collectPage(join(dir, "src"), input());
    for (const [key, value] of [
      ["diff.noprefix", "true"],
      ["diff.mnemonicPrefix", "true"],
      ["color.ui", "always"],
      ["diff.renames", "false"],
      ["diff.relative", "true"],
      ["diff.suppressBlankEmpty", "true"],
      ["diff.submodule", "log"],
      ["core.quotePath", "true"],
    ]) {
      git(dir, "config", key, value);
    }
    const hostile = collectPage(join(dir, "src"), input());
    expect(hostile).toEqual(clean);
    expect(JSON.stringify(hostile)).not.toContain("\u001b");
    const files = byPath(hostile);
    expect([...files.keys()]).toEqual(["docs/c.md", "src/a.ts", "sub"]);
    expect(files.get("docs/c.md")).toMatchObject({
      status: "R",
      oldPath: "docs/b.md",
      stub: "Renamed without changes.",
    });
    expect(files.get("src/a.ts")!.hunks![0].lines.slice(0, 2)).toEqual([
      [" ", 1, 1, "one"],
      [" ", 2, 2, ""],
    ]);
    expect(files.get("sub")!.hunks![0].lines[0][3]).toMatch(/^Subproject commit [0-9a-f]{40}$/);
  });

  it("ignores textconv filters", () => {
    const dir = newRepo({
      ".gitattributes": "*.enc diff=dec\n*.bin binary\n",
      "a.enc": "cipher one\n",
      "b.enc": PNG,
      "c.bin": "text one\n",
    });
    git(dir, "config", "diff.dec.textconv", "echo plain #");
    write(dir, {
      "a.enc": "cipher two\n",
      "b.enc": Buffer.concat([PNG, Buffer.from([9])]),
      "c.bin": "text two\n",
      "d.enc": "cipher three\n",
    });
    const files = byPath(collectPage(dir, input({ untracked: ["d.enc"] })));
    expect(files.get("a.enc")!.hunks![0].lines).toEqual([
      ["-", 1, null, "cipher one"],
      ["+", null, 1, "cipher two"],
    ]);
    expect(files.get("b.enc")).toMatchObject({ binary: true });
    expect(files.get("c.bin")).toMatchObject({ binary: true });
    expect(files.get("d.enc")!.hunks![0].lines).toEqual([["+", null, 1, "cipher three"]]);
  });

  it("merges a type change into one entry", () => {
    const dir = newRepo({ "f.txt": "hello\n", "g.txt": "x\n" });
    rmSync(join(dir, "f.txt"));
    symlinkSync("target", join(dir, "f.txt"));
    const data = collectPage(dir, input());
    expect(data.files.map((file) => file.id)).toEqual(["f-f_2e_txt"]);
    expect(data.files[0]).toMatchObject({ status: "T", source: "uncommitted", add: 1, del: 1 });
    expect(data.files[0].hunks!.flatMap((hunk) => hunk.lines)).toEqual([
      ["-", 1, null, "hello"],
      ["+", null, 1, "target", 1],
    ]);
  });

  it("merges a file removed from the index and included untracked", () => {
    const dir = newRepo({ ".env": "SECRET=1\n", "a.txt": "a\n" });
    git(dir, "rm", "-q", "--cached", ".env");
    write(dir, { ".env": "SECRET=2\n" });
    const data = collectPage(dir, input({ untracked: [".env", ".env"] }));
    expect(data.files.map((file) => file.id)).toEqual(["f-_2e_env"]);
    expect(data.files[0]).toMatchObject({
      status: "M",
      source: "untracked",
      note: "Removed from the index; kept as an untracked file.",
      add: 1,
      del: 1,
    });
    expect(data.files[0].hunks!.flatMap((hunk) => hunk.lines)).toEqual([
      ["-", 1, null, "SECRET=1"],
      ["+", null, 1, "SECRET=2"],
    ]);
    expect(data.untracked).toBe(1);
  });

  it("shows an untracked symlink as its target", () => {
    const dir = newRepo({ "d/x.txt": "x\n" });
    symlinkSync("d", join(dir, "dlink"));
    symlinkSync("missing", join(dir, "broken"));
    const files = byPath(collectPage(dir, input({ untracked: ["dlink", "broken"] })));
    expect(files.get("dlink")).toMatchObject({ status: "A", source: "untracked", add: 1 });
    expect(files.get("dlink")!.hunks![0].lines).toEqual([["+", null, 1, "d", 1]]);
    expect(files.get("broken")!.hunks![0].lines).toEqual([["+", null, 1, "missing", 1]]);
  });

  it.skipIf(spawnSync("mkfifo", ["--help"]).error !== undefined)(
    "shows an untracked FIFO without content",
    () => {
      const dir = newRepo({ "a.txt": "a\n" });
      const fifo = spawnSync("mkfifo", [join(dir, "pipe")]);
      expect(fifo.status).toBe(0);
      // git ls-files does not list a FIFO, so collectPage never asks for one; this guards a path
      // that became one after the listing.
      expect(listChanges(dir, "main").untracked).toEqual([]);
      const [file] = untrackedFile(dir, "pipe");
      expect(toPageFile(file, "untracked")).toMatchObject({
        status: "A",
        source: "untracked",
        stub: "Not a regular file. No content shown.",
        add: 0,
        del: 0,
      });
    },
  );

  it.skipIf(process.getuid?.() === 0)("includes git's stderr when git fails", () => {
    const dir = newRepo({ "a.txt": "a\n" });
    write(dir, { "locked.txt": "x\n" });
    chmodSync(join(dir, "locked.txt"), 0);
    expect(() => collectPage(dir, input({ untracked: ["locked.txt"] }))).toThrow(
      /Permission denied\nfatal: cannot hash locked\.txt/,
    );
  });

  it("changes the hash when a stubbed or binary file's content changes", () => {
    const dir = featureRepo();
    const before = byPath(collectPage(dir, input()));
    write(dir, {
      "img.png": Buffer.concat([PNG, Buffer.from([6, 7])]),
      "package-lock.json": '{\n  "a": 1,\n  "b": 3,\n  "c": 5\n}\n',
    });
    const after = byPath(collectPage(dir, input()));
    for (const path of ["img.png", "package-lock.json"]) {
      expect(after.get(path)!.stub).toBe(before.get(path)!.stub);
      expect(after.get(path)!.hash).not.toBe(before.get(path)!.hash);
    }
  });

  it("excludes a quoted path with astral characters by its real name", () => {
    const path = "emoji \u{1f600}\tx.md";
    const dir = newRepo({ [path]: "one\n", "a.txt": "a\n" });
    write(dir, { [path]: "two\n", "a.txt": "b\n" });
    expect(collectPage(dir, input()).files.map((file) => file.path)).toEqual(["a.txt", path]);
    expect(collectPage(dir, input({ exclude: [path] })).files.map((file) => file.path)).toEqual([
      "a.txt",
    ]);
  });

  it("fails when there are no changes", () => {
    const dir = newRepo({ "a.txt": "a\n" });
    expect(() => collectPage(dir, input())).toThrow("No changes against main");
  });
});

describe("renderPage", () => {
  it("escapes the repo and branch in the title", () => {
    const dir = newRepo({ "a.txt": "a\n" });
    git(dir, "checkout", "-q", "-b", "feat/<x>&y");
    write(dir, { "a.txt": "b\n" });
    const html = renderPage(TEMPLATE, collectPage(dir, input()));
    const repo = dir.split("/").at(-1);
    expect(html).toContain(`<title>${repo} / feat/&lt;x&gt;&amp;y diff</title>`);
    expect(embedded(html).branch).toBe("feat/<x>&y");
  });

  it("keeps the embedded JSON inside its script tag", () => {
    const dir = newRepo({ "a.html": "start\n" });
    write(dir, { "a.html": "start\n</script><!-- x -->\u2028\n" });
    const html = renderPage(TEMPLATE, collectPage(dir, input()));
    expect(html.split("</script>").length).toBe(TEMPLATE.split("</script>").length);
    expect(html.split("<!--").length).toBe(TEMPLATE.split("<!--").length);
    const data = embedded(html);
    expect(data.files[0].hunks![0].lines[1]).toEqual(["+", null, 2, "</script><!-- x -->\u2028"]);
    const block = html.slice(
      html.indexOf(DATA_OPEN) + DATA_OPEN.length,
      html.indexOf("</script>", html.indexOf(DATA_OPEN)),
    );
    expect(block.split("\n")).toContain('[" ",1,1,"start"],');
  });

  it("keeps every line of the page and the template under 1000 characters", () => {
    const long = "<x>&".repeat(2500);
    const dir = newRepo({ "a.txt": "a\n" });
    write(dir, { "a.txt": `${long}\n`, "b.txt": "y".repeat(10000) });
    const html = renderPage(TEMPLATE, collectPage(dir, input({ untracked: ["b.txt"] })));
    for (const text of [TEMPLATE, html]) {
      expect(Math.max(...text.split("\n").map((line) => line.length))).toBeLessThanOrEqual(1000);
    }
    const files = embedded(html).files;
    const text = (line: unknown) => (Array.isArray(line) ? line.join("") : line);
    expect(text(files[0].hunks![0].lines[1][3])).toBe(long);
    expect(text(files[1].hunks![0].lines[0][3])).toBe("y".repeat(10000));
  });

  it("splits long paths, ids and thread ids so every line stays under 1000 characters", () => {
    const from = `${"旧的目录/".repeat(14)}old_snake_case_name_for_a_module_${"x_y_".repeat(10)}.ts`;
    const to = `${"新的目录/".repeat(14)}new_snake_case_name_for_a_module_${"x_y_".repeat(10)}.ts`;
    expect(to.length).toBeGreaterThan(140);
    const dir = newRepo({ [from]: lines("line", 10), "a.txt": "a\n" });
    rmSync(join(dir, from));
    write(dir, { [to]: lines("line", 10).replace("line 10\n", "changed 10\n") });
    git(dir, "add", "-A");
    git(dir, "rm", "-q", "--cached", "a.txt");
    const data = collectPage(
      dir,
      input({ untracked: ["a.txt"], threads: [{ path: to, side: "old", line: 10 }] }),
    );
    expect(lineId(to, "old", 10).length).toBeGreaterThan(500);
    const html = renderPage(TEMPLATE, data);
    expect(Math.max(...html.split("\n").map((line) => line.length))).toBeLessThan(1000);
    const page = embedded(html);
    const text = (value: unknown) => (Array.isArray(value) ? value.join("") : value);
    const renamed = page.files.find((file) => text(file.path) === to)!;
    expect(text(renamed.id)).toBe(fileId(to));
    expect(text(renamed.oldPath)).toBe(from);
    expect(page.threads.map(text)).toEqual([lineId(to, "old", 10)]);
    const kept = page.files.find((file) => file.path === "a.txt")!;
    expect(kept.note).toBe("Removed from the index; kept as an untracked file.");
  });

  it("chunks long Markdown content lines, which the page joins back", () => {
    const long = "<b>&".repeat(600);
    const dir = newRepo({ "a.md": "a\n" });
    write(dir, { "a.md": `${long}\nshort\n` });
    const html = renderPage(TEMPLATE, collectPage(dir, input()));
    expect(Math.max(...html.split("\n").map((line) => line.length))).toBeLessThanOrEqual(1000);
    const page = embedded(html);
    const content = page.files[0].content as unknown[];
    expect(Array.isArray(content[0])).toBe(true);
    expect(content[1]).toBe("short");
    const join = new Function(
      "DIFF",
      [templateSource("const joined = "), templateSource("for (const f of DIFF.files) {")].join(
        "\n",
      ),
    );
    join(page);
    expect(page.files[0].content).toBe(`${long}\nshort\n`);
  });

  it("counts Markdown content toward the size cap", () => {
    const body = lines("a fairly long line of text in a big file", 9000);
    const dir = newRepo({ "big.md": body, "big.txt": body });
    write(dir, {
      "big.md": body.replace("file 5\n", "changed 5\n"),
      "big.txt": body.replace("file 5\n", "changed 5\n"),
    });
    const both = collectPage(dir, input());
    expect(() => renderPage(TEMPLATE, both)).toThrow(/Largest files: big\.md \(\d+ KB\)/);
    const text = collectPage(dir, input({ exclude: ["big.md"] }));
    expect(() => renderPage(TEMPLATE, text)).not.toThrow();
  });

  it("fails on an oversized page and names the largest files", () => {
    const dir = newRepo({ "README.md": "x\n" });
    write(dir, {
      "big.txt": lines("a fairly long line of text in a big file", 12000),
      "small.txt": "small\n",
    });
    const data = collectPage(dir, input({ untracked: ["big.txt", "small.txt"] }));
    expect(() => renderPage(TEMPLATE, data)).toThrow(
      new RegExp(
        `over the ${MAX_PAGE_BYTES / 1024} KB Claude can read\\. Largest files: big\\.txt \\(\\d+ KB\\), small\\.txt \\(1 KB\\)$`,
      ),
    );
  });
});

// A stand-in for the DOM calls the template's line rendering makes.
class FakeElement {
  children: FakeElement[] = [];
  dataset: Record<string, string> = {};
  id = "";
  className = "";
  textContent = "";
  innerHTML = "";
  title = "";
  colSpan = 1;
  style = { setProperty() {} };
  tagName: string;
  constructor(tagName: string) {
    this.tagName = tagName;
  }
  append(...nodes: (FakeElement | string)[]) {
    for (const node of nodes) if (typeof node !== "string") this.children.push(node);
  }
  prepend(node: FakeElement) {
    this.children.unshift(node);
  }
  setAttribute() {}
  addEventListener() {}
}

// The template's own source for a line, or for a block that ends with a closing brace at its two-space indent.
function templateSource(start: string): string {
  const from = TEMPLATE.indexOf(`\n  ${start}`) + 1;
  expect(from).toBeGreaterThan(0);
  const line = TEMPLATE.indexOf("\n", from);
  if (TEMPLATE.slice(from, line).trimEnd().endsWith(";")) return TEMPLATE.slice(from, line);
  return TEMPLATE.slice(from, TEMPLATE.indexOf("\n  }", from) + 5);
}

describe("template", () => {
  it("marks a hunk row by its new start line and a unified context row by its old-side id", () => {
    const source = [
      templateSource("const el = "),
      templateSource("const lineId = "),
      templateSource("const td = "),
      templateSource("const onComment = "),
      templateSource("function commentIcon("),
      templateSource("function commentButton("),
      templateSource("function hunkRow("),
      templateSource("function colgroup("),
      templateSource("function addTarget("),
      templateSource("function codeTd("),
      templateSource("function renderUnified("),
      "return renderUnified;",
    ].join("\n");
    const document = { createElement: (tag: string) => new FakeElement(tag) };
    const known = new Set(["f-a-old-3", "f-a-hunk-5"]);
    const renderUnified = new Function("document", "known", "comments", "targets", "ICON", source)(
      document,
      known,
      {},
      [{ old: [], new: [] }],
      "",
    );
    const table = new FakeElement("table");
    const header = "@@ -3 +5 @@ context";
    const file = { id: "f-a", path: "a", hunks: [{ header, lines: [[" ", 3, 5, "x"]] }] };
    renderUnified(file, 0, table);
    const hunk = table.children[1];
    expect(hunk.id).toBe("f-a-hunk-5");
    expect(hunk.children[0].children.map((child) => child.className)).toEqual(["cicon", "cbtn"]);
    const row = table.children[2];
    expect(row.id).toBe("f-a-new-5");
    expect(row.dataset.alt).toBe("f-a-old-3");
    expect(row.children[1].children.map((child) => child.className)).toContain("cicon");
  });
});

describe("build.ts", () => {
  function run(args: string[], cwd: string) {
    return spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: "utf8" });
  }

  it("prints usage on bad arguments", () => {
    const dir = tempDir();
    for (const args of [
      [],
      ["files"],
      ["build", "--input", "x"],
      ["files", "--default", "main", "--out", "x"],
      ["other"],
    ]) {
      const result = run(args, dir);
      expect(result.status).toBe(1);
      expect(result.stderr).toBe(`${USAGE}\n`);
    }
  });

  it("lists changes from a subdirectory", () => {
    const dir = featureRepo();
    const result = run(["files", "--default", "main"], join(dir, "src"));
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(listChanges(dir, "main"));
    expect(JSON.parse(result.stdout).root).toBe(dir);
  });

  it("fails with one line when the base does not resolve", () => {
    const dir = featureRepo();
    const result = run(["files", "--default", "nope"], dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toBe("Cannot resolve the base: nope do not resolve\n");
  });

  it("builds the page from a subdirectory", () => {
    const dir = featureRepo();
    const work = tempDir();
    const inputPath = join(work, "input.json");
    writeFileSync(
      inputPath,
      JSON.stringify({
        default: "main",
        untracked: ["notes.md"],
        exclude: [],
        threads: [],
        publish: 2,
      }),
    );
    const out = join(work, "nested", "page.html");
    const result = run(["build", "--input", inputPath, "--out", out], join(dir, "src"));
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout).toBe(
      `Wrote ${out}\n8 files (1 uncommitted, 1 untracked), +7 -7 against main\n`,
    );
    const data = embedded(readFileSync(out, "utf8"));
    expect(data.buildId).toBe(`${git(dir, "rev-parse", "--short", "HEAD")}-2`);
    expect(data.files.map((file) => file.path)).toContain("img.png");
  });

  it("fails when the diff is empty", () => {
    const dir = newRepo({ "a.txt": "a\n" });
    const inputPath = join(tempDir(), "input.json");
    writeFileSync(inputPath, JSON.stringify({ default: "main", publish: 1 }));
    const result = run(["build", "--input", inputPath, "--out", join(tempDir(), "page.html")], dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toBe("No changes against main\n");
  });
});

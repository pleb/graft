import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  collectPage,
  decodePath,
  encodePath,
  isSupportedNode,
  lineId,
  listChanges,
  MAX_PAGE_BYTES,
  parseDiff,
  parseInput,
  parseLineId,
  renderPage,
  unquoteGitPath,
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
});

describe("listChanges", () => {
  it("lists tracked and untracked changes against the local default branch", () => {
    const dir = featureRepo();
    const changes = listChanges(dir, "main");
    expect(changes).toEqual({
      root: dir,
      base: git(dir, "rev-parse", "main"),
      baseRef: "main",
      tracked: [
        "img.png",
        "nonl.txt",
        "package-lock.json",
        "src/added.ts",
        "src/del.ts",
        "src/mod.ts",
        "src/new-name.ts",
      ],
      untracked: ["notes.md"],
    });
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
      input({ untracked: ["notes.md"], threads: ["f-x-new-1"], publish: 3 }),
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
      threads: ["f-x-new-1"],
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
    expect(block.trim().split("\n")).toHaveLength(3);
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

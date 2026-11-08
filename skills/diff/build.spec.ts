import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { crc32, deflateSync } from "node:zlib";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  collectPage,
  decodePath,
  encodePath,
  fileId,
  imageInfo,
  imageSide,
  isSupportedNode,
  lineId,
  listChanges,
  MAX_DATA_BYTES,
  MAX_EXPAND_BYTES,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_EDGE,
  MAX_IMAGE_FILES,
  MAX_IMAGE_SIDE_BYTES,
  MAX_PUBLISH_PATHS,
  MAX_VERSION_FILES,
  mergeSides,
  pageName,
  parseDiff,
  parseInput,
  parseLineId,
  planPublish,
  renderBuild,
  threadId,
  toPageFile,
  unquoteGitPath,
  untrackedFile,
  writeBuild,
} from "./build-lib.ts";
import type {
  BuildInput,
  BuildOutput,
  BuiltFile,
  FileData,
  ImageSide,
  Manifest,
  ManifestFile,
  PageData,
  PageFile,
} from "./build-lib.ts";

const SCRIPT = fileURLToPath(new URL("./build.ts", import.meta.url));
const TEMPLATE = readFileSync(fileURLToPath(new URL("./template.html", import.meta.url)), "utf8");
const USAGE = "Usage: node build.ts files --default <branch> | build --input <file> --out <dir>";
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

// Makes a file unreadable: by mode on POSIX, by denying Everyone read-data access on Windows.
function lock(path: string): void {
  if (process.platform !== "win32") return chmodSync(path, 0);
  const result = spawnSync("icacls", [path, "/deny", "*S-1-1-0:(RD)"], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`icacls ${path}: ${result.stdout}${result.stderr}`);
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
  return {
    default: "main",
    untracked: [],
    exclude: [],
    threads: [],
    publish: 1,
    server: [],
    ...over,
  };
}

function byPath(data: PageData): Map<string, PageFile> {
  return new Map(data.files.map((file) => [file.path, file]));
}

function embedded(html: string): Manifest {
  const start = html.indexOf(DATA_OPEN) + DATA_OPEN.length;
  return JSON.parse(html.slice(start, html.indexOf("</script>", start)));
}

const OUT = "/out";

function build(data: PageData, server: string[] = []): BuildOutput {
  return renderBuild(TEMPLATE, data, server, OUT);
}

// Text the build split into pieces, joined back.
function text(value: unknown): unknown {
  return Array.isArray(value) ? value.join("") : value;
}

function manifestEntry(output: BuildOutput, path: string): ManifestFile {
  return output.manifest.files.find((file) => file.path === path)!;
}

function dataOf(output: BuildOutput, path: string): FileData {
  return JSON.parse(output.files.get(manifestEntry(output, path).data!)!);
}

// Joins a data file's split text in place, as the page does when it arrives.
function joinData(data: FileData): void {
  new Function(
    [
      templateSource("const joined = "),
      templateSource("function joinData("),
      "return joinData;",
    ].join("\n"),
  )()(data);
}

function longestLine(output: BuildOutput): number {
  return Math.max(
    ...[...output.files.values()].flatMap((file) => file.split("\n").map((line) => line.length)),
  );
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
    expect(parseInput({ default: "main", server: ["index.html"] }).server).toEqual(["index.html"]);
    expect(() => parseInput({ default: "main", server: [1] })).toThrow(
      'Input "server" must be an array of strings',
    );
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
      repo: basename(dir),
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

  it("embeds the new content of shown, non-deleted regular text files only", () => {
    const lfs = "version https://git-lfs.github.com/spec/v1\noid sha256:abc\nsize 1\n";
    const dir = newRepo({
      "doc.md": "# Doc\n\nold\n",
      "work.markdown": "a\n",
      "gone.md": "bye\n",
      "code.ts": "a\n",
      "x.min.md": "a\n",
      "latin.txt": Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a]),
      "big.bin": lfs,
      "img.png": PNG,
      "target.txt": "t\n",
    });
    git(dir, "checkout", "-q", "-b", "feature");
    write(dir, {
      "doc.md": "# Doc\n\nnew\n",
      "code.ts": "b\n",
      "x.min.md": "b\n",
      "latin.txt": Buffer.from([0x63, 0x61, 0x66, 0xe8, 0x0a]),
      "big.bin": lfs.replace("abc", "def"),
      "img.png": Buffer.concat([PNG, Buffer.from([1])]),
    });
    rmSync(join(dir, "gone.md"));
    symlinkSync("target.txt", join(dir, "link"));
    commitAll(dir, "feature");
    write(dir, { "work.markdown": "b\n", "new.MDX": "# New", "new.txt": "\ufeffbom\n" });
    symlinkSync("target.txt", join(dir, "ulink"));
    const files = byPath(collectPage(dir, input({ untracked: ["new.MDX", "new.txt", "ulink"] })));
    expect(files.get("doc.md")!.content).toEqual(["# Doc", "", "new", ""]);
    expect(files.get("work.markdown")!.content).toEqual(["b", ""]);
    expect(files.get("new.MDX")!.content).toEqual(["# New"]);
    expect(files.get("code.ts")!.content).toEqual(["b", ""]);
    expect(files.get("new.txt")!.content).toEqual(["\ufeffbom", ""]);
    expect(files.get("latin.txt")!.hunks).toBeDefined();
    expect(files.get("big.bin")!.hunks).toBeDefined();
    expect(files.get("link")!.hunks).toBeDefined();
    for (const path of [
      "gone.md",
      "x.min.md",
      "latin.txt",
      "big.bin",
      "img.png",
      "link",
      "ulink",
    ]) {
      expect(files.get(path)!.content).toBeUndefined();
    }
  });

  it("normalises a working file's CRLF content to match its clean-filtered hunks", () => {
    const dir = newRepo({ "a.txt": "a\nb\n" });
    git(dir, "config", "core.autocrlf", "true");
    write(dir, { "a.txt": "a\r\nc\r\n", "new.txt": "x\r\ny\r\n" });
    const files = byPath(collectPage(dir, input({ untracked: ["new.txt"] })));
    const a = files.get("a.txt")!;
    expect(a.hunks!.flatMap((hunk) => hunk.lines.map((line) => line[3]))).toEqual(["a", "b", "c"]);
    expect(a.content).toEqual(["a", "c", ""]);
    const added = files.get("new.txt")!;
    const hunkText = added.hunks!.flatMap((hunk) => hunk.lines.map((line) => line[3]));
    expect(added.content!.slice(0, -1)).toEqual(hunkText);
  });

  it("leaves out the content of LFS-tracked working files", () => {
    const dir = newRepo({ ".gitattributes": "*.bin filter=lfs\n", "a.bin": "a\n", "a.txt": "a\n" });
    write(dir, { "a.bin": "real\n", "a.txt": "b\n", "new.bin": "new\n" });
    const files = byPath(collectPage(dir, input({ untracked: ["new.bin"] })));
    expect(files.get("a.bin")!.hunks).toBeDefined();
    expect(files.get("a.bin")!.content).toBeUndefined();
    expect(files.get("new.bin")!.content).toBeUndefined();
    expect(files.get("a.txt")!.content).toEqual(["b", ""]);
  });

  it("embeds the old and new content of shown SVG files only", () => {
    const dir = newRepo({
      "mod.svg": "<svg>old</svg>\n",
      "gone.SVG": "<svg>gone</svg>\n",
      "from.svg": "<svg>\nmoved\n1\n2\n3\n</svg>\n",
      "x.min.svg": "<svg/>\n",
      "code.ts": "a\n",
    });
    git(dir, "checkout", "-q", "-b", "feature");
    rmSync(join(dir, "gone.SVG"));
    rmSync(join(dir, "from.svg"));
    write(dir, {
      "mod.svg": "<svg>committed</svg>\n",
      "to.svg": "<svg>\nmoved\n1\n2\n3\n</svg>\nmore\n",
      "x.min.svg": "<svg></svg>\n",
      "code.ts": "b\n",
    });
    commitAll(dir, "feature");
    write(dir, { "mod.svg": "<svg>working</svg>\n", "new.svg": "<svg>new</svg>" });
    const files = byPath(collectPage(dir, input({ untracked: ["new.svg"] })));
    expect(files.get("mod.svg")).toMatchObject({
      svgOld: ["<svg>old</svg>", ""],
      svgNew: ["<svg>working</svg>", ""],
    });
    expect(files.get("gone.SVG")!.svgOld).toEqual(["<svg>gone</svg>", ""]);
    expect(files.get("gone.SVG")!.svgNew).toBeUndefined();
    expect(files.get("new.svg")!.svgOld).toBeUndefined();
    expect(files.get("new.svg")!.svgNew).toEqual(["<svg>new</svg>"]);
    expect(files.get("to.svg")).toMatchObject({
      oldPath: "from.svg",
      svgOld: ["<svg>", "moved", "1", "2", "3", "</svg>", ""],
      svgNew: ["<svg>", "moved", "1", "2", "3", "</svg>", "more", ""],
    });
    for (const path of ["x.min.svg", "code.ts"]) {
      expect(files.get(path)!.svgOld).toBeUndefined();
      expect(files.get(path)!.svgNew).toBeUndefined();
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

  // Windows has no FIFOs; Git Bash's mkfifo makes a pipe.lnk file instead.
  it.skipIf(process.platform === "win32" || spawnSync("mkfifo", ["--help"]).error !== undefined)(
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
    lock(join(dir, "locked.txt"));
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

  // Windows file names cannot hold the tab that makes git quote the path.
  it.skipIf(process.platform === "win32")(
    "excludes a quoted path with astral characters by its real name",
    () => {
      const path = "emoji \u{1f600}\tx.md";
      const dir = newRepo({ [path]: "one\n", "a.txt": "a\n" });
      write(dir, { [path]: "two\n", "a.txt": "b\n" });
      expect(collectPage(dir, input()).files.map((file) => file.path)).toEqual(["a.txt", path]);
      expect(collectPage(dir, input({ exclude: [path] })).files.map((file) => file.path)).toEqual([
        "a.txt",
      ]);
    },
  );

  it("fails when there are no changes", () => {
    const dir = newRepo({ "a.txt": "a\n" });
    expect(() => collectPage(dir, input())).toThrow("No changes against main");
  });
});

// A shown text file of about the given bytes of hunks and content, in lines of the given width.
function sizedFile(path: string, hunkBytes: number, contentBytes = 0, width = 100): PageFile {
  const row = "x".repeat(width);
  const hunkLines = Math.max(1, Math.round(hunkBytes / (width + 20)));
  const file: PageFile = {
    id: fileId(path),
    path,
    status: "M",
    source: "committed",
    hash: "0000000000000000",
    add: hunkLines,
    del: 0,
    hunks: [
      {
        header: `@@ -0,0 +1,${hunkLines} @@`,
        lines: Array.from({ length: hunkLines }, (_, i) => ["+", null, i + 1, row]),
      },
    ],
  };
  if (contentBytes) {
    file.content = Array.from({ length: Math.round(contentBytes / (width + 4)) }, () => row);
  }
  return file;
}

function syntheticPage(files: PageFile[]): PageData {
  return {
    repo: "repo",
    branch: "feature",
    base: "main",
    buildId: "abc-1",
    mergeBase: "def",
    head: "abc",
    uncommitted: 0,
    untracked: 0,
    threads: [],
    files,
  };
}

function dataBytes(output: BuildOutput): number {
  return [...output.files]
    .filter(([path]) => path.startsWith("data/"))
    .reduce((sum, [, file]) => sum + Buffer.byteLength(file), 0);
}

describe("renderBuild", () => {
  it("escapes the repo and branch in the title", () => {
    const dir = newRepo({ "a.txt": "a\n" });
    // Windows file names cannot hold < or >, so the branch is a packed ref, not a loose ref file.
    const branch = "feat/<x>&y";
    writeFileSync(
      join(dir, ".git/packed-refs"),
      `${git(dir, "rev-parse", "HEAD")} refs/heads/${branch}\n`,
    );
    git(dir, "symbolic-ref", "HEAD", `refs/heads/${branch}`);
    write(dir, { "a.txt": "b\n" });
    const html = build(collectPage(dir, input())).files.get("index.html")!;
    expect(html).toContain(`<title>${basename(dir)} / feat/&lt;x&gt;&amp;y diff</title>`);
    expect(embedded(html).branch).toBe("feat/<x>&y");
  });

  it("keeps the inline manifest inside its script tag", () => {
    const dir = newRepo({ "a.html": "start\n" });
    const branch = "x</script><!--y";
    writeFileSync(
      join(dir, ".git/packed-refs"),
      `${git(dir, "rev-parse", "HEAD")} refs/heads/${branch}\n`,
    );
    git(dir, "symbolic-ref", "HEAD", `refs/heads/${branch}`);
    write(dir, { "a.html": "start\n</script><!-- x --> \n" });
    const output = build(collectPage(dir, input()));
    const html = output.files.get("index.html")!;
    expect(html.split("</script>").length).toBe(TEMPLATE.split("</script>").length);
    expect(html.split("<!--").length).toBe(TEMPLATE.split("<!--").length);
    expect(embedded(html).branch).toBe(branch);
    expect(dataOf(output, "a.html").hunks[0].lines[1]).toEqual([
      "+",
      null,
      2,
      "</script><!-- x --> ",
    ]);
    expect(output.files.get(manifestEntry(output, "a.html").data!)!.split("\n")).toContain(
      '[" ",1,1,"start"],',
    );
  });

  it("writes a manifest with each file's fields and its data file, without hunks", () => {
    const dir = featureRepo();
    const output = build(
      collectPage(
        dir,
        input({ untracked: ["notes.md"], threads: [{ path: "src/mod.ts", side: "new", line: 3 }] }),
      ),
    );
    const page = embedded(output.files.get("index.html")!);
    expect(page).toEqual(output.manifest);
    const head = git(dir, "rev-parse", "--short", "HEAD");
    expect({ ...page, files: [] }).toEqual({
      repo: basename(dir),
      branch: "feature",
      base: "main",
      buildId: `${head}-1`,
      mergeBase: git(dir, "rev-parse", "--short", "main"),
      head,
      uncommitted: 1,
      untracked: 1,
      threads: [lineId("src/mod.ts", "new", 3)],
      files: [],
    });
    const mod = manifestEntry(output, "src/mod.ts");
    expect(Object.keys(mod)).toEqual([
      "id",
      "path",
      "status",
      "source",
      "add",
      "del",
      "hash",
      "hasHunks",
      "isMarkdown",
      "data",
    ]);
    expect(mod).toMatchObject({
      id: "f-src_2f_mod_2e_ts",
      path: "src/mod.ts",
      status: "M",
      source: "committed",
      add: 1,
      del: 1,
      hasHunks: true,
      isMarkdown: false,
    });
    expect(mod.hash).toMatch(/^[0-9a-f]{16}$/);
    expect(mod.data).toMatch(/^data\/f-[0-9a-f]{16}\.json$/);
    expect(Object.keys(manifestEntry(output, "src/new-name.ts")).slice(0, 4)).toEqual([
      "id",
      "path",
      "oldPath",
      "status",
    ]);
    expect(manifestEntry(output, "src/new-name.ts").oldPath).toBe("src/old-name.ts");
    expect(manifestEntry(output, "img.png")).toEqual({
      id: fileId("img.png"),
      path: "img.png",
      status: "M",
      source: "committed",
      add: 0,
      del: 0,
      binary: true,
      isImage: true,
      hash: expect.stringMatching(/^[0-9a-f]{16}$/),
      hasHunks: false,
      isMarkdown: false,
      stubOld: "Not a PNG, JPEG, GIF or WebP image.",
      stubNew: "Not a PNG, JPEG, GIF or WebP image.",
    });
    expect(manifestEntry(output, "package-lock.json")).toMatchObject({
      stub: "Lockfile changed (+2 −1). Content hidden.",
      hasHunks: false,
    });
    expect(manifestEntry(output, "package-lock.json").data).toBeUndefined();
    expect(manifestEntry(output, "notes.md")).toMatchObject({ isMarkdown: true, hasHunks: true });
    for (const file of page.files) {
      for (const key of ["hunks", "content", "svgOld", "svgNew"])
        expect(file).not.toHaveProperty(key);
    }

    expect(dataOf(output, "src/mod.ts")).toEqual({
      path: "src/mod.ts",
      hunks: byPath(collectPage(dir, input())).get("src/mod.ts")!.hunks,
      content: lines("line", 5).replace("line 3\n", "changed 3\n").split("\n"),
    });
    const shown = output.manifest.files.filter((file) => file.data).map((file) => file.data);
    expect([...output.files.keys()]).toEqual(["index.html", ...shown]);
  });

  it("marks Markdown files that have hunks", () => {
    const dir = newRepo({ "doc.md": "a\n", "code.ts": "a\n", "x.min.md": "a\n", "gone.md": "a\n" });
    write(dir, { "doc.md": "b\n", "code.ts": "b\n", "x.min.md": "b\n", "new.MDX": "# New\n" });
    rmSync(join(dir, "gone.md"));
    const output = build(collectPage(dir, input({ untracked: ["new.MDX"] })));
    expect(
      Object.fromEntries(output.manifest.files.map((file) => [file.path, file.isMarkdown])),
    ).toEqual({
      "code.ts": false,
      "doc.md": true,
      "gone.md": true,
      "new.MDX": true,
      "x.min.md": false,
    });
  });

  it("keeps every line of the page, the data and the template under 1000 characters", () => {
    const long = "<x>&".repeat(2500);
    const dir = newRepo({ "a.txt": "a\n", "c.md": "a\n" });
    write(dir, {
      "a.txt": `${long}\n`,
      "b.txt": "y".repeat(10000),
      "c.md": `${"<b>&".repeat(600)}\nshort\n`,
    });
    const output = build(collectPage(dir, input({ untracked: ["b.txt"] })));
    expect(longestLine(output)).toBeLessThanOrEqual(1000);
    expect(Math.max(...TEMPLATE.split("\n").map((line) => line.length))).toBeLessThanOrEqual(1000);
    expect(text(dataOf(output, "a.txt").hunks[0].lines[1][3])).toBe(long);
    expect(text(dataOf(output, "b.txt").hunks[0].lines[0][3])).toBe("y".repeat(10000));
    expect(text(dataOf(output, "a.txt").content![0])).toBe(long);
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
    const output = build(data);
    expect(longestLine(output)).toBeLessThan(1000);
    const page = embedded(output.files.get("index.html")!);
    const renamed = page.files.find((file) => text(file.path) === to)!;
    expect(text(renamed.id)).toBe(fileId(to));
    expect(text(renamed.oldPath)).toBe(from);
    expect(page.threads.map(text)).toEqual([lineId(to, "old", 10)]);
    expect(text(JSON.parse(output.files.get(renamed.data!)!).path)).toBe(to);
    const kept = page.files.find((file) => file.path === "a.txt")!;
    expect(kept.note).toBe("Removed from the index; kept as an untracked file.");
  });

  it("chunks long content lines, which the page joins back", () => {
    const long = "<b>&".repeat(600);
    const dir = newRepo({ "a.md": "a\n" });
    write(dir, { "a.md": `${long}\nshort\n` });
    const output = build(collectPage(dir, input()));
    const data = dataOf(output, "a.md");
    const content = data.content as unknown[];
    expect(Array.isArray(content[0])).toBe(true);
    expect(content[1]).toBe("short");
    joinData(data);
    expect(data.content).toBe(`${long}\nshort\n`);
  });

  it("chunks long SVG content lines, which the page joins back", () => {
    const old = `<svg>${"<g/>&".repeat(600)}</svg>`;
    const dir = newRepo({ "a.svg": `${old}\n` });
    write(dir, { "a.svg": `${old}\n<!-- x -->\n` });
    const output = build(collectPage(dir, input()));
    expect(longestLine(output)).toBeLessThanOrEqual(1000);
    const data = dataOf(output, "a.svg");
    expect(Array.isArray((data.svgOld as unknown[])[0])).toBe(true);
    expect(data.svgNew).toBeUndefined();
    expect((data.content as unknown[])[1]).toBe("<!-- x -->");
    joinData(data);
    expect(data.svgOld).toBe(`${old}\n`);
    expect(data.content).toBe(`${old}\n<!-- x -->\n`);
  });

  it("builds a one-line change to a large SVG, storing its new text once", () => {
    const svg = `<svg>\n${lines("<path/>", 30 * 1024)}</svg>\n`;
    expect(Buffer.byteLength(svg)).toBeGreaterThan(300 * 1024);
    const dir = newRepo({ "a.svg": svg, "b.svg": "<svg>\n</svg>\n" });
    git(dir, "checkout", "-q", "-b", "feature");
    write(dir, {
      "a.svg": svg.replace("<path/> 7\n", "<path/> seven\n"),
      "b.svg": "<svg>\n<g/>\n</svg>\n",
    });
    commitAll(dir, "feature");
    const output = build(collectPage(dir, input()));
    const big = dataOf(output, "a.svg");
    expect(big.hunks).toBeDefined();
    expect(big.content).toBeUndefined();
    expect(big.svgOld).toBeUndefined();
    expect(big.svgNew).toBeUndefined();
    expect(manifestEntry(output, "a.svg").note).toBe(
      "Too large to expand past its hunks. Too large to render; shows the diff only.",
    );
    const small = dataOf(output, "b.svg");
    expect(small.svgOld).toEqual(["<svg>", "</svg>", ""]);
    expect(small.content).toEqual(["<svg>", "<g/>", "</svg>", ""]);
    expect(small.svgNew).toBeUndefined();
    expect(manifestEntry(output, "b.svg").note).toBeUndefined();
  });

  it("keeps the content and sides of a modified SVG whose data fits its cap", () => {
    const file = sizedFile("a.svg", 1000);
    file.svgOld = Array.from({ length: 1300 }, () => "o".repeat(100));
    file.svgNew = Array.from({ length: 1300 }, () => "n".repeat(100));
    file.content = file.svgNew;
    const output = build(syntheticPage([file]));
    const data = dataOf(output, "a.svg");
    expect(
      Buffer.byteLength(output.files.get(manifestEntry(output, "a.svg").data!)!),
    ).toBeGreaterThan(MAX_EXPAND_BYTES);
    expect(data.content).toEqual(file.content);
    expect(data.svgOld).toEqual(file.svgOld);
    expect(data.svgNew).toBeUndefined();
    expect(manifestEntry(output, "a.svg").note).toBeUndefined();
  });

  it("drops the sides of an SVG over its cap, keeping content that fits", () => {
    const file = sizedFile("a.svg", 1000);
    file.svgOld = Array.from({ length: 4000 }, () => "o".repeat(100));
    file.svgNew = Array.from({ length: 2000 }, () => "n".repeat(100));
    file.content = file.svgNew;
    const output = build(syntheticPage([file]));
    const data = dataOf(output, "a.svg");
    expect(data.content).toEqual(file.content);
    expect(data.svgOld).toBeUndefined();
    expect(data.svgNew).toBeUndefined();
    expect(manifestEntry(output, "a.svg").note).toBe("Too large to render; shows the diff only.");
  });

  it("names data files by a hash of their data, stable across builds", () => {
    const dir = featureRepo();
    const names = (output: BuildOutput) =>
      new Map(output.manifest.files.map((file) => [file.path, file.data]));
    const first = names(build(collectPage(dir, input({ untracked: ["notes.md"] }))));
    const again = names(build(collectPage(dir, input({ untracked: ["notes.md"], publish: 2 }))));
    expect(again).toEqual(first);
    write(dir, { "src/added.ts": "export const added = 2;\n" });
    const changed = names(build(collectPage(dir, input({ untracked: ["notes.md"], publish: 3 }))));
    for (const [path, data] of first) {
      if (path === "src/added.ts") expect(changed.get(path)).not.toBe(data);
      else expect(changed.get(path)).toBe(data);
    }
  });

  it("sends what the server lacks, removes what the build lacks and keeps the rest", () => {
    const dir = featureRepo();
    const first = build(collectPage(dir, input()));
    const paths = [...first.files.keys()];
    expect(first.publish).toMatchObject({ out: OUT, remove: [], keep: [] });
    expect(first.publish.send.map((file) => file.path)).toEqual(paths);
    expect(first.publish.send[0]).toEqual({ path: "index.html", source: null });
    expect(first.publish.send).toContainEqual({
      path: manifestEntry(first, "src/mod.ts").data,
      source: "src/mod.ts",
    });

    write(dir, { "src/added.ts": "export const added = 2;\n" });
    const server = [...paths, "data/f-stale.json"];
    const next = build(collectPage(dir, input({ publish: 2 })), server);
    const oldAdded = manifestEntry(first, "src/added.ts").data!;
    const newAdded = manifestEntry(next, "src/added.ts").data!;
    expect(next.publish.send).toEqual([
      { path: "index.html", source: null },
      { path: newAdded, source: "src/added.ts" },
    ]);
    expect(next.publish.remove).toEqual([oldAdded, "data/f-stale.json"]);
    expect(next.publish.keep).toEqual(
      paths.filter((path) => path !== "index.html" && path !== oldAdded),
    );
    expect(next.publish.publishes).toEqual([
      { send: [newAdded, "index.html"], remove: [oldAdded, "data/f-stale.json"] },
    ]);
  });

  it("fails when one file's hunks pass the per-file cap, naming the largest files", () => {
    const data = syntheticPage([
      sizedFile("big.txt", 600 * 1024),
      sizedFile("mid.txt", 100 * 1024),
      sizedFile("small.txt", 100),
    ]);
    expect(() => build(data)).toThrow(
      /^1 file diff is over the 500 KB one file can hold\. Largest files: big\.txt \(\d+ KB\), mid\.txt \(\d+ KB\), small\.txt \(1 KB\)$/,
    );
  });

  it("fails when the hunks alone pass the data cap, naming the five largest files", () => {
    const files = Array.from({ length: 12 }, (_, i) => sizedFile(`f${i}.txt`, (460 + i) * 1024));
    expect(() => build(syntheticPage(files))).toThrow(
      /^The diff data is \d+ KB, over the 5120 KB readers can read\. Largest files: f11\.txt \(\d+ KB\), f10\.txt \(\d+ KB\), f9\.txt \(\d+ KB\), f8\.txt \(\d+ KB\), f7\.txt \(\d+ KB\)$/,
    );
  });

  it("drops content with a note from a file whose data would pass its cap", () => {
    const big = sizedFile("big.txt", 1000, 300 * 1024);
    big.note = "Removed from the index; kept as an untracked file.";
    const output = build(
      syntheticPage([big, sizedFile("edge.txt", 1000, 240 * 1024), sizedFile("small.txt", 1000)]),
    );
    expect(dataOf(output, "big.txt").content).toBeUndefined();
    expect(manifestEntry(output, "big.txt").note).toBe(
      "Removed from the index; kept as an untracked file. Too large to expand past its hunks.",
    );
    const edge = output.files.get(manifestEntry(output, "edge.txt").data!)!;
    expect(Buffer.byteLength(edge)).toBeLessThanOrEqual(MAX_EXPAND_BYTES);
    expect(dataOf(output, "edge.txt").content).toBeDefined();
    expect(manifestEntry(output, "edge.txt").note).toBeUndefined();
    expect(manifestEntry(output, "small.txt").note).toBeUndefined();
  });

  it("drops content from the largest files first until the data fits its cap", () => {
    // Each file's data is under the per-file cap, and all of it together passes the total cap.
    const files = Array.from({ length: 25 }, (_, i) =>
      sizedFile(`f${String(i).padStart(2, "0")}.txt`, 1000, 2000 * (94 + i), 90 + i),
    );
    const output = build(syntheticPage(files));
    const total = files.reduce(
      (sum, file) => sum + Buffer.byteLength(JSON.stringify(file.content)),
      0,
    );
    expect(total).toBeGreaterThan(MAX_DATA_BYTES);
    expect(dataBytes(output)).toBeLessThanOrEqual(MAX_DATA_BYTES);
    const dropped = output.manifest.files.filter((file) => file.note).map((file) => file.path);
    expect(dropped.length).toBeGreaterThan(0);
    expect(dropped).toEqual(files.slice(25 - dropped.length).map((file) => file.path));
    for (const file of output.manifest.files) {
      expect(dataOf(output, file.path).content === undefined).toBe(dropped.includes(file.path));
      if (file.note) expect(file.note).toBe("Too large to expand past its hunks.");
    }
  });

  it("drops content from every file before SVG sides, largest first, to fit the data cap", () => {
    // Each file keeps its SVG sides alone, and all of them together pass the total cap.
    const files = Array.from({ length: 14 }, (_, i) => {
      const file = sizedFile(`f${String(i).padStart(2, "0")}.svg`, 1000, 0, 90 + i);
      const side = Array.from({ length: 1900 }, () => "s".repeat(90 + i));
      file.svgOld = side;
      file.svgNew = side;
      return file;
    });
    files.push(sizedFile("text.txt", 1000, 200 * 1024));
    const output = build(syntheticPage(files));
    expect(dataBytes(output)).toBeLessThanOrEqual(MAX_DATA_BYTES);
    expect(dataOf(output, "text.txt").content).toBeUndefined();
    expect(manifestEntry(output, "text.txt").note).toBe("Too large to expand past its hunks.");
    const svgs = output.manifest.files.filter((file) => file.path.endsWith(".svg"));
    const dropped = svgs.filter((file) => file.note).map((file) => file.path);
    expect(dropped.length).toBeGreaterThan(0);
    expect(dropped.length).toBeLessThan(svgs.length);
    expect(dropped).toEqual(svgs.slice(svgs.length - dropped.length).map((file) => file.path));
    for (const file of svgs) {
      const data = dataOf(output, file.path);
      expect(data.svgOld === undefined).toBe(dropped.includes(file.path));
      expect(data.svgNew === undefined).toBe(dropped.includes(file.path));
      if (file.note) expect(file.note).toBe("Too large to render; shows the diff only.");
    }
  });

  it("drops SVG sides before the content that carries their new text, largest first", () => {
    // Each SVG keeps its old side and content alone, and their content alone passes the total cap.
    const files = Array.from({ length: 26 }, (_, i) => {
      const file = sizedFile(`f${String(i).padStart(2, "0")}.svg`, 1000, 0, 90 + i);
      file.svgOld = Array.from({ length: 2000 }, () => "o".repeat(90 + i));
      file.svgNew = Array.from({ length: 2000 }, () => "n".repeat(90 + i));
      file.content = file.svgNew;
      return file;
    });
    files.push(sizedFile("text.txt", 1000, 200 * 1024));
    const output = build(syntheticPage(files));
    expect(dataBytes(output)).toBeLessThanOrEqual(MAX_DATA_BYTES);
    expect(dataOf(output, "text.txt").content).toBeUndefined();
    expect(manifestEntry(output, "text.txt").note).toBe("Too large to expand past its hunks.");
    const svgs = output.manifest.files.filter((file) => file.path.endsWith(".svg"));
    const noExpand = svgs.filter((file) => file.note?.startsWith("Too large to expand"));
    expect(noExpand.length).toBeGreaterThan(0);
    expect(noExpand.length).toBeLessThan(svgs.length);
    expect(noExpand).toEqual(svgs.slice(svgs.length - noExpand.length));
    for (const file of svgs) {
      const data = dataOf(output, file.path);
      expect(data.svgOld).toBeUndefined();
      expect(data.svgNew).toBeUndefined();
      expect(data.content === undefined).toBe(noExpand.includes(file));
      expect(file.note).toBe(
        noExpand.includes(file)
          ? "Too large to expand past its hunks. Too large to render; shows the diff only."
          : "Too large to render; shows the diff only.",
      );
    }
  });
});

function builtFiles(count: number, bytes = 1000, ext = "json"): BuiltFile[] {
  return Array.from({ length: count }, (_, i) => ({
    path: `data/f-${String(i).padStart(4, "0")}.${ext}`,
    source: `src/${i}.ts`,
    bytes,
  }));
}

const PAGE_FILE: BuiltFile = { path: "index.html", source: null, bytes: 10 * 1024 };

describe("planPublish", () => {
  it("splits more than 255 paths into publishes, removals first and the page last", () => {
    const built = [PAGE_FILE, ...builtFiles(300)];
    const stale = Array.from({ length: 20 }, (_, i) => `data/f-stale${i}.json`);
    const plan = planPublish(built, ["index.html", ...stale], OUT);
    expect(plan.publishes.length).toBe(2);
    for (const step of plan.publishes) {
      expect(step.send.length + step.remove.length).toBeLessThanOrEqual(MAX_PUBLISH_PATHS);
    }
    expect(plan.publishes[0].remove).toEqual(stale);
    expect(plan.publishes[1].remove).toEqual([]);
    expect(plan.publishes.flatMap((step) => step.send)).toEqual([
      ...built.slice(1).map((file) => file.path),
      "index.html",
    ]);
    expect(plan.publishes.at(-1)!.send.at(-1)).toBe("index.html");

    const one = planPublish([PAGE_FILE, ...builtFiles(254)], [], OUT);
    expect(one.publishes.length).toBe(1);
    expect(planPublish([PAGE_FILE, ...builtFiles(255)], [], OUT).publishes.length).toBe(2);
  });

  it("batches text by about 300 KB and images by ten, covering every path sent", () => {
    const text = builtFiles(7, 100 * 1024);
    const images = builtFiles(23, 1000, "png");
    const big = { path: "data/f-big.json", source: "big.ts", bytes: 400 * 1024 };
    const plan = planPublish([PAGE_FILE, ...text, ...images, big], [text[6].path], OUT);
    const paths = (files: BuiltFile[]) => files.map((file) => file.path);
    expect(plan.batches.map((batch) => [batch.kind, batch.paths])).toEqual([
      ["text", ["index.html", ...paths(text.slice(0, 2))]],
      ["text", paths(text.slice(2, 5))],
      ["text", [text[5].path]],
      ["image", paths(images.slice(0, 10))],
      ["image", paths(images.slice(10, 20))],
      ["image", paths(images.slice(20))],
      ["text", ["data/f-big.json"]],
    ]);
    expect(plan.batches[0].bytes).toBe(210 * 1024);
    expect(plan.batches.flatMap((batch) => batch.paths).sort()).toEqual(
      plan.send.map((file) => file.path).sort(),
    );
  });

  it("fails past the version file and sent byte caps", () => {
    expect(() => planPublish([PAGE_FILE, ...builtFiles(511)], [], OUT)).toThrow(
      "The build has 512 files, over the 511 an artifact version can hold",
    );
    expect(() => planPublish([PAGE_FILE, ...builtFiles(510)], [], OUT)).not.toThrow();
    const huge = builtFiles(2, 31 * 1024 * 1024, "png");
    expect(() => planPublish([PAGE_FILE, ...huge], [], OUT)).toThrow(
      /^The publish sends \d+ KB, over the 61440 KB cap\. Largest files: data\/f-0000\.png/,
    );
    expect(() => planPublish([PAGE_FILE, ...huge], [huge[0].path], OUT)).not.toThrow();
  });
});

// A PNG of one solid color, its pixel bytes preceded by the given bytes in a chunk of the given kind.
function png(
  width: number,
  height: number,
  fill = 0,
  extra = Buffer.alloc(0),
  kind = "prVt",
): Buffer {
  const chunk = (kind: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(kind, "latin1"), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, fill)]);
  return Buffer.concat([
    Buffer.from("\x89PNG\r\n\x1a\n", "latin1"),
    chunk("IHDR", header),
    ...(extra.length ? [chunk(kind, extra)] : []),
    chunk("IDAT", deflateSync(Buffer.concat(Array.from({ length: height }, () => row)))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// A GIF of the given number of 1-pixel frames, each after a graphic control extension.
function gif(width: number, height: number, frames: number): Buffer {
  const head = Buffer.from("GIF89a\0\0\0\0\x80\0\0\0\0\0\xff\xff\xff", "latin1");
  head.writeUInt16LE(width, 6);
  head.writeUInt16LE(height, 8);
  const frame = Buffer.from(
    "\x21\xf9\x04\x00\x0a\x00\x00\x00\x2c\0\0\0\0\x01\0\x01\0\0\x02\x02\x4c\x01\0",
    "latin1",
  );
  return Buffer.concat([head, ...Array.from({ length: frames }, () => frame), Buffer.from(";")]);
}

// A WebP whose first chunk is the given kind, sized width by height, with an ANIM chunk if asked.
function webp(kind: "VP8 " | "VP8L" | "VP8X", width: number, height: number, anim = false) {
  const chunk = (fourcc: string, data: Buffer) => {
    const head = Buffer.alloc(8);
    head.write(fourcc, 0, "latin1");
    head.writeUInt32LE(data.length, 4);
    return Buffer.concat([head, data, Buffer.alloc(data.length % 2)]);
  };
  const data = Buffer.alloc(10);
  if (kind === "VP8 ") {
    data.set([0x9d, 0x01, 0x2a], 3);
    data.writeUInt16LE(width, 6);
    data.writeUInt16LE(height, 8);
  } else if (kind === "VP8L") {
    data[0] = 0x2f;
    data.writeUInt32LE((width - 1) | ((height - 1) << 14), 1);
  } else {
    data[0] = anim ? 0x02 : 0;
    data.writeUIntLE(width - 1, 4, 3);
    data.writeUIntLE(height - 1, 7, 3);
  }
  const chunks = [chunk(kind, data), ...(anim ? [chunk("ANIM", Buffer.alloc(6))] : [])];
  const body = Buffer.concat([Buffer.from("WEBP"), ...chunks]);
  const riff = Buffer.alloc(8);
  riff.write("RIFF", 0, "latin1");
  riff.writeUInt32LE(body.length, 4);
  return Buffer.concat([riff, body]);
}

// A JPEG header: an APP0 segment, fill bytes, then a baseline SOF0 marker sized width by height.
function jpeg(width: number, height: number): Buffer {
  const sof = Buffer.from([0xff, 0xc0, 0, 11, 8, 0, 0, 0, 0, 1, 1, 0x11, 0]);
  sof.writeUInt16BE(height, 5);
  sof.writeUInt16BE(width, 7);
  const app0 = Buffer.from([
    0xff,
    0xe0,
    0,
    16,
    ...Buffer.from("JFIF\0"),
    1,
    1,
    0,
    0,
    1,
    0,
    1,
    0,
    0,
  ]);
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    app0,
    Buffer.from([0xff]),
    sof,
    Buffer.from([0xff, 0xd9]),
  ]);
}

// Bytes that a UTF-8 round trip would change.
const RAW = Buffer.from([0, 0x80, 0xff, 0xfe, 0x0d, 0x0a, 0xc3, 0x28, 0xe2, 0x82]);

function imageFile(
  path: string,
  image: NonNullable<PageFile["image"]>,
  status: PageFile["status"] = "M",
): PageFile {
  return {
    id: fileId(path),
    path,
    status,
    source: "committed",
    hash: "0000000000000000",
    binary: true,
    add: 0,
    del: 0,
    image,
  };
}

// A previewable side of the given bytes, distinct by fill.
function still(bytes: number, fill: number): ImageSide {
  return { bytes: Buffer.alloc(bytes, fill), ext: "png", width: 10, height: 20 };
}

describe("images", () => {
  it("reads the format, size and animation of PNG, JPEG, GIF and WebP headers", () => {
    expect(imageInfo(png(3, 2))).toEqual({ ext: "png", width: 3, height: 2, animated: false });
    expect(imageInfo(jpeg(640, 480))).toEqual({
      ext: "jpg",
      width: 640,
      height: 480,
      animated: false,
    });
    expect(imageInfo(gif(5, 7, 1))).toEqual({ ext: "gif", width: 5, height: 7, animated: false });
    expect(imageInfo(gif(5, 7, 2))).toMatchObject({ animated: true });
    expect(imageInfo(webp("VP8 ", 300, 200))).toEqual({
      ext: "webp",
      width: 300,
      height: 200,
      animated: false,
    });
    expect(imageInfo(webp("VP8L", 9000, 16))).toMatchObject({ width: 9000, height: 16 });
    expect(imageInfo(webp("VP8X", 70000, 3))).toMatchObject({ width: 70000, height: 3 });
    expect(imageInfo(webp("VP8X", 4, 4, true))).toMatchObject({ animated: true });
    expect(imageInfo(png(2, 2, 0, Buffer.alloc(8), "acTL"))).toMatchObject({ animated: true });
    const apng = png(2, 2, 0, Buffer.alloc(8), "acTL");
    expect(imageInfo(apng.subarray(0, 40))).toMatchObject({ width: 2, animated: false });
    const plain = png(2, 2);
    const late = Buffer.concat([
      plain.subarray(0, -12),
      apng.subarray(33, 53),
      plain.subarray(-12),
    ]);
    expect(imageInfo(late)).toMatchObject({ animated: false });
    for (const bytes of [PNG, RAW, Buffer.from("GIF8"), Buffer.from([0xff, 0xd8, 0xff, 0xd9])]) {
      expect(imageInfo(bytes)).toBeNull();
    }
  });

  it("keeps a side's bytes within the caps and stubs it with the reason otherwise", () => {
    const side = (bytes: Buffer) => imageSide(bytes.length, () => bytes);
    const small = png(4, 4);
    expect(side(small)).toEqual({ bytes: small, ext: "png", width: 4, height: 4 });
    const edge = webp("VP8L", MAX_IMAGE_EDGE, 1);
    expect(side(edge).bytes).toBe(edge);
    const exact = png(1, 1, 0, Buffer.alloc(MAX_IMAGE_SIDE_BYTES - png(1, 1).length - 12));
    expect(exact.length).toBe(MAX_IMAGE_SIDE_BYTES);
    expect(side(exact).bytes).toBe(exact);
    expect(side(Buffer.concat([exact, Buffer.from([0])]))).toEqual({
      stub: "Too large to preview: 2 MB, over 2 MB.",
    });
    const unread = () => {
      throw new Error("read a side over the cap");
    };
    expect(imageSide(MAX_IMAGE_SIDE_BYTES + 1, unread)).toEqual({
      stub: "Too large to preview: 2 MB, over 2 MB.",
    });
    expect(imageSide(600 * 1024 * 1024, unread).stub).toBe(
      "Too large to preview: 600 MB, over 2 MB.",
    );
    expect(side(png(1, 1, 0, Buffer.alloc(3 * 1024 * 1024))).stub).toBe(
      "Too large to preview: 3 MB, over 2 MB.",
    );
    expect(side(webp("VP8L", 2, MAX_IMAGE_EDGE + 1))).toEqual({
      width: 2,
      height: 4097,
      stub: "Too many pixels to preview: 2 × 4097, over 4096 on its longest side.",
    });
    expect(side(png(2, 2, 0, Buffer.alloc(8), "acTL"))).toEqual({
      width: 2,
      height: 2,
      stub: "Animated; previews show still images only.",
    });
    expect(side(gif(2, 2, 3))).toEqual({
      width: 2,
      height: 2,
      stub: "Animated; previews show still images only.",
    });
    expect(side(webp("VP8X", 2, 2, true)).stub).toBe("Animated; previews show still images only.");
    expect(side(RAW)).toEqual({ stub: "Not a PNG, JPEG, GIF or WebP image." });
  });

  it("reads added, deleted and modified image sides byte for byte from git", () => {
    const before = png(2, 2, 10, RAW);
    const committed = png(3, 2, 20, RAW);
    const gone = jpeg(8, 8);
    // Large enough beside its change for git to see the rename.
    const moved = Buffer.concat([webp("VP8 ", 6, 6), Buffer.alloc(4000, 7)]);
    const dir = newRepo({
      "mod.png": before,
      "work.PNG": before,
      "gone.jpg": gone,
      "anim.gif": gif(4, 4, 1),
      "from.webp": moved,
      "pointer.png": "version https://git-lfs.github.com/spec/v1\noid sha256:aa\nsize 1\n",
    });
    git(dir, "checkout", "-q", "-b", "feature");
    rmSync(join(dir, "gone.jpg"));
    git(dir, "mv", "from.webp", "to.webp");
    write(dir, {
      "mod.png": committed,
      "work.PNG": committed,
      "anim.gif": gif(4, 4, 2),
      "to.webp": Buffer.concat([moved, RAW]),
      "pointer.png": "version https://git-lfs.github.com/spec/v1\noid sha256:bb\nsize 2\n",
    });
    commitAll(dir, "feature");
    const working = png(2, 3, 30, RAW);
    const added = gif(9, 9, 1);
    write(dir, { "mod.png": Buffer.from("not committed"), "new.gif": added });
    git(dir, "checkout", "--", "mod.png");
    write(dir, { "work.PNG": working });
    const files = byPath(collectPage(dir, input({ untracked: ["new.gif"] })));

    expect(files.get("mod.png")).toMatchObject({ source: "committed", status: "M" });
    expect(files.get("mod.png")!.image).toEqual({
      old: { bytes: before, ext: "png", width: 2, height: 2 },
      new: { bytes: committed, ext: "png", width: 3, height: 2 },
    });
    expect(files.get("work.PNG")).toMatchObject({ source: "uncommitted" });
    expect(files.get("work.PNG")!.image!.old!.bytes!.equals(before)).toBe(true);
    expect(files.get("work.PNG")!.image!.new!.bytes!.equals(working)).toBe(true);
    expect(files.get("gone.jpg")!.image).toEqual({
      old: { bytes: gone, ext: "jpg", width: 8, height: 8 },
    });
    expect(files.get("new.gif")!.image).toEqual({
      new: { bytes: added, ext: "gif", width: 9, height: 9 },
    });
    expect(files.get("anim.gif")!.image).toEqual({
      old: { bytes: gif(4, 4, 1), ext: "gif", width: 4, height: 4 },
      new: { width: 4, height: 4, stub: "Animated; previews show still images only." },
    });
    expect(files.get("to.webp")).toMatchObject({ status: "R", oldPath: "from.webp" });
    expect(files.get("to.webp")!.image!.old!.bytes!.equals(moved)).toBe(true);
    const pointer = files.get("pointer.png")!;
    expect(pointer.image).toBeUndefined();
    expect(pointer.binary).toBeUndefined();
    expect(pointer.hunks!.length).toBe(1);

    const output = build(collectPage(dir, input({ untracked: ["new.gif"] })));
    expect(manifestEntry(output, "pointer.png").isImage).toBeUndefined();
    expect(manifestEntry(output, "new.gif")).toMatchObject({
      status: "A",
      binary: true,
      isImage: true,
      hasHunks: false,
    });
    const out = join(tempDir(), "out");
    writeBuild({ ...output, publish: { ...output.publish, out } });
    const data = dataOf(output, "work.PNG");
    expect(readFileSync(join(out, data.imgOld!)).equals(before)).toBe(true);
    expect(readFileSync(join(out, data.imgNew!)).equals(working)).toBe(true);
  });

  it("stubs a side over 2 MB from its size, from git and from the working tree", () => {
    const big = png(1, 1, 0, Buffer.alloc(MAX_IMAGE_SIDE_BYTES));
    const dir = newRepo({ "big.png": big, "small.png": png(1, 1) });
    git(dir, "checkout", "-q", "-b", "feature");
    write(dir, { "big.png": png(2, 2, 0, Buffer.alloc(MAX_IMAGE_SIDE_BYTES)), "small.png": big });
    commitAll(dir, "feature");
    write(dir, { "big.png": png(3, 3, 0, Buffer.alloc(MAX_IMAGE_SIDE_BYTES)) });
    const files = byPath(collectPage(dir, input()));
    const stub = { stub: "Too large to preview: 2 MB, over 2 MB." };
    expect(files.get("big.png")).toMatchObject({ source: "uncommitted" });
    expect(files.get("big.png")!.image).toEqual({ old: stub, new: stub });
    expect(files.get("small.png")!.image).toEqual({
      old: { bytes: png(1, 1), ext: "png", width: 1, height: 1 },
      new: stub,
    });
  });

  it("keeps an image file with no previewed side in the manifest, writing no data file", () => {
    const count = MAX_VERSION_FILES + 9;
    const files = Array.from({ length: count + MAX_IMAGE_FILES }, (_, i) =>
      imageFile(`s${String(i).padStart(3, "0")}.png`, { old: still(10, i), new: still(10, i) }),
    );
    const output = build(syntheticPage(files));
    expect(output.files.size).toBe(1 + MAX_IMAGE_FILES);
    expect(output.images.size).toBe(MAX_IMAGE_FILES);
    const last = manifestEntry(output, files.at(-1)!.path);
    expect(last).toMatchObject({
      isImage: true,
      stubOld: "Over the 20 image previews a page shows.",
      stubNew: "Over the 20 image previews a page shows.",
      sizeOld: [10, 20],
      sizeNew: [10, 20],
    });
    expect(last.data).toBeUndefined();
    expect(output.publish.send.length).toBe(1 + 2 * MAX_IMAGE_FILES);
  });

  it("writes each image file's data with its sides' paths, sizes and stubs", () => {
    const old = png(2, 2, 1);
    const next = png(4, 3, 2);
    const output = build(
      syntheticPage([
        imageFile("a/added.png", { new: { bytes: next, ext: "png", width: 4, height: 3 } }, "A"),
        imageFile("a/deleted.gif", { old: { bytes: old, ext: "gif", width: 2, height: 2 } }, "D"),
        imageFile("a/mod.png", {
          old: { bytes: old, ext: "png", width: 2, height: 2 },
          new: { width: 9000, height: 3, stub: "Too many pixels." },
        }),
        imageFile("a/raw.png", { old: { stub: "Not a PNG, JPEG, GIF or WebP image." } }, "D"),
        sizedFile("b.ts", 1000),
      ]),
    );
    const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex").slice(0, 16);
    expect(dataOf(output, "a/added.png")).toEqual({
      path: "a/added.png",
      hunks: [],
      sizeNew: [4, 3],
      imgNew: `img/${hash(next)}.png`,
    });
    expect(dataOf(output, "a/deleted.gif")).toEqual({
      path: "a/deleted.gif",
      hunks: [],
      sizeOld: [2, 2],
      imgOld: `img/${hash(old)}.gif`,
    });
    expect(dataOf(output, "a/mod.png")).toEqual({
      path: "a/mod.png",
      hunks: [],
      sizeOld: [2, 2],
      imgOld: `img/${hash(old)}.png`,
      sizeNew: [9000, 3],
      stubNew: "Too many pixels.",
    });
    expect(manifestEntry(output, "a/raw.png")).toMatchObject({
      isImage: true,
      stubOld: "Not a PNG, JPEG, GIF or WebP image.",
    });
    expect(manifestEntry(output, "a/raw.png").data).toBeUndefined();
    expect(manifestEntry(output, "a/mod.png")).toMatchObject({ isImage: true, binary: true });
    expect(manifestEntry(output, "b.ts").isImage).toBeUndefined();
    expect([...output.images.keys()]).toEqual([
      `img/${hash(next)}.png`,
      `img/${hash(old)}.gif`,
      `img/${hash(old)}.png`,
    ]);
    expect(output.images.get(`img/${hash(next)}.png`)).toBe(next);
    expect(longestLine(output)).toBeLessThan(1000);
  });

  it("previews at most 20 image files in path order, counting only files with a preview", () => {
    const files = Array.from({ length: MAX_IMAGE_FILES + 2 }, (_, i) =>
      imageFile(`i${String(i).padStart(2, "0")}.png`, { new: still(10, i) }, "A"),
    );
    files.splice(1, 0, imageFile("i00a.gif", { new: { stub: "Animated." } }, "A"));
    const output = build(syntheticPage(files));
    const shown = output.manifest.files.filter(
      (file) => file.data && dataOf(output, file.path).imgNew,
    );
    expect(shown.map((file) => file.path)).toEqual(
      files
        .slice(0, 21)
        .map((file) => file.path)
        .filter((path) => path !== "i00a.gif"),
    );
    expect(manifestEntry(output, "i00a.gif").stubNew).toBe("Animated.");
    for (const path of ["i20.png", "i21.png"]) {
      expect(manifestEntry(output, path)).toMatchObject({
        stubNew: "Over the 20 image previews a page shows.",
        sizeNew: [10, 20],
      });
    }
    expect(output.images.size).toBe(MAX_IMAGE_FILES);
  });

  it("stubs every side past 40 MB of distinct image bytes, counting a repeated side once", () => {
    const side = MAX_IMAGE_SIDE_BYTES;
    const count = MAX_IMAGE_BYTES / side / 2;
    const files = Array.from({ length: count }, (_, i) =>
      imageFile(`f${String(i).padStart(2, "0")}.png`, {
        old: still(side, 2 * i),
        new: still(side, 2 * i + 1),
      }),
    );
    files.push(imageFile("g0.png", { old: still(side, 0), new: still(side, 200) }));
    files.push(imageFile("g1.png", { new: still(10, 201) }, "A"));
    const output = build(syntheticPage(files));
    const imageBytes = [...output.images.values()].reduce((sum, bytes) => sum + bytes.length, 0);
    expect(imageBytes).toBe(MAX_IMAGE_BYTES);
    expect(dataOf(output, "f00.png").imgOld).toBe(dataOf(output, "g0.png").imgOld);
    const over = "Over the 40 MB of image previews a page holds.";
    expect(dataOf(output, "g0.png").stubNew).toBe(over);
    expect(manifestEntry(output, "g1.png").stubNew).toBe(over);
    expect(
      output.publish.send.reduce(
        (sum, { path }) => sum + (output.images.get(path)?.length ?? 0),
        0,
      ),
    ).toBe(MAX_IMAGE_BYTES);
  });

  it("sends, keeps and removes image paths against the server, in image reader batches", () => {
    const page = syntheticPage(
      Array.from({ length: 12 }, (_, i) =>
        imageFile(`p${String(i).padStart(2, "0")}.png`, { new: still(100, i) }, "A"),
      ),
    );
    const first = build(page);
    const images = [...first.images.keys()];
    const sources = new Map(first.publish.send.map(({ path, source }) => [path, source]));
    for (const [i, path] of images.entries()) {
      expect(sources.get(path)).toBe(`p${String(i).padStart(2, "0")}.png`);
    }
    expect(first.publish.batches.filter((batch) => batch.kind === "image")).toEqual([
      { kind: "image", paths: images.slice(0, 10), bytes: 1000 },
      { kind: "image", paths: images.slice(10), bytes: 200 },
    ]);
    const second = build(page, ["index.html", images[0], "img/0000000000000000.png"]);
    expect(second.publish.keep).toContain(images[0]);
    expect(second.publish.send.map(({ path }) => path)).not.toContain(images[0]);
    expect(second.publish.remove).toEqual(["img/0000000000000000.png"]);
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

// The template's unified rendering, with the given open thread ids.
function unifiedRenderer(known: Set<string>) {
  const source = [
    templateSource("const el = "),
    templateSource("const lineId = "),
    templateSource("const td = "),
    templateSource("const onComment = "),
    templateSource("function commentIcon("),
    templateSource("function hunkRow("),
    templateSource("function colgroup("),
    templateSource("function addTarget("),
    templateSource("function codeTd("),
    templateSource("function unifiedLine("),
    templateSource("function unifiedRows("),
    templateSource("function alignedLines("),
    templateSource("function contextGaps("),
    templateSource("const gapCache = "),
    templateSource("const gapsOf = "),
    templateSource("const expanded = "),
    templateSource("const EXPAND_STEP = "),
    templateSource("function gapState("),
    templateSource("function gapRows("),
    templateSource("function expandRow("),
    templateSource("function renderUnified("),
    "return { renderUnified, gapState };",
  ].join("\n");
  const document = { createElement: (tag: string) => new FakeElement(tag) };
  return new Function("document", "known", "comments", "targets", "ICON", source)(
    document,
    known,
    {},
    [{ old: [], new: [] }],
    "",
  );
}

// A file's hunks from git's diff of two texts, with the default three lines of context.
function hunksOf(base: string, next: string) {
  const dir = tempDir();
  write(dir, { a: base, b: next });
  const out = spawnSync("git", ["diff", "--no-index", "--", "a", "b"], {
    cwd: dir,
    encoding: "utf8",
  }).stdout;
  return parseDiff(out)[0].hunks;
}

describe("template", () => {
  it("marks a hunk row by its new start line and a unified context row by its old-side id", () => {
    const known = new Set(["f-a-old-3", "f-a-hunk-5"]);
    const { renderUnified } = unifiedRenderer(known);
    const table = new FakeElement("table");
    const header = "@@ -3 +5 @@ context";
    const file = { id: "f-a", path: "a", hunks: [{ header, lines: [[" ", 3, 5, "x"]] }] };
    renderUnified(file, 0, table);
    const hunk = table.children[1];
    expect(hunk.id).toBe("f-a-hunk-5");
    expect(hunk.children[0].children.map((child) => child.className)).toEqual(["cicon"]);
    const row = table.children[2];
    expect(row.id).toBe("f-a-new-5");
    expect(row.dataset.alt).toBe("f-a-old-3");
    expect(row.children[1].children.map((child) => child.className)).toContain("cicon");
  });

  it("comments only on registered cells, past data-side markup from rendered Markdown", () => {
    class Node {
      dataset: Record<string, string>;
      parentElement: Node | null;
      constructor(parent: Node | null, dataset: Record<string, string> = {}) {
        this.parentElement = parent;
        this.dataset = dataset;
      }
      closest(selector: string): Node | null {
        const key = /^\[data-(\w+)\]$/.exec(selector)![1];
        return key in this.dataset ? this : (this.parentElement?.closest(selector) ?? null);
      }
    }
    const block = new Node(null, { fi: "0", side: "new", idx: "0" });
    const fake = new Node(block, { fi: "0", side: "new", idx: "0" });
    const inner = new Node(fake);
    const loose = new Node(new Node(null), { fi: "0", side: "new", idx: "0" });
    const proto = new Node(null, { fi: "0", side: "__proto__", idx: "0" });
    const pane = new Node(null, { uncommentable: "" });
    const inPane = new Node(new Node(pane), { fi: "0", side: "new", idx: "0" });
    const targets = [{ old: [], new: [{ cells: [block] }] }];
    const commentCell = new Function(
      "targets",
      `${templateSource("function commentCell(")}\nreturn commentCell;`,
    )(targets);
    expect(commentCell(block)).toBe(block);
    expect(commentCell(inner)).toBe(block);
    expect(commentCell(loose)).toBeNull();
    expect(commentCell(proto)).toBeNull();
    expect(commentCell(inPane)).toBeNull();
  });

  it("offers Markdown views by isMarkdown and renders an SVG with each side its status has", () => {
    const views = new Function(
      "narrowMq",
      "mdReady",
      [
        templateSource("const svgNew = "),
        templateSource("const isSvg = "),
        templateSource("const olds = "),
        templateSource("const oldOf = "),
        templateSource("function oldSource("),
        templateSource("function views("),
        "return views;",
      ].join("\n"),
    )({ matches: false }, true);
    const hunks = [
      {
        header: "@@ -1 +1 @@",
        lines: [
          ["-", 1, null, "a"],
          ["+", null, 1, "b"],
        ],
      },
    ];
    const file = (path: string, more: object) => ({ path, status: "M", hunks, ...more });
    expect(views(file("a.ts", { content: "b\n" }))).toEqual(["unified", "split"]);
    expect(views(file("a.md", { isMarkdown: true, content: "b\n" }))).toEqual([
      "unified",
      "split",
      "rendered",
      "chunked",
    ]);
    expect(views(file("a.md", { isMarkdown: true }))).toEqual(["unified", "split"]);
    for (const more of [
      { svgOld: "<svg/>", content: "b\n" },
      { svgOld: "<svg/>", svgNew: "<svg/>" },
    ]) {
      expect(views(file("a.svg", more))).toEqual(["unified", "split", "rendered"]);
      expect(views({ ...file("a.svg", more), status: "R" })).toEqual([
        "unified",
        "split",
        "rendered",
      ]);
    }
    for (const more of [{}, { svgOld: "<svg/>" }, { svgNew: "<svg/>" }, { content: "b\n" }]) {
      expect(views(file("a.svg", more))).toEqual(["unified", "split"]);
    }
    expect(views({ path: "a.svg", status: "A", hunks, content: "b\n" })).toEqual([
      "unified",
      "rendered",
    ]);
    expect(views({ path: "a.svg", status: "A", hunks, svgNew: "<svg/>" })).toEqual([
      "unified",
      "rendered",
    ]);
    expect(views({ path: "a.svg", status: "A", hunks })).toEqual(["unified"]);
    expect(views({ path: "a.svg", status: "D", hunks, svgOld: "<svg/>" })).toEqual([
      "unified",
      "rendered",
    ]);
    expect(views({ path: "a.svg", status: "D", hunks })).toEqual(["unified"]);
  });

  it("offers images one Comparison view, with each side their status has", () => {
    const { views, fileView, imagePanes } = new Function(
      "narrowMq",
      "mdReady",
      "load",
      "viewKey",
      [
        templateSource("const svgNew = "),
        templateSource("const isSvg = "),
        templateSource("function views("),
        templateSource("function fileView("),
        templateSource("function imagePanes("),
        "return { views, fileView, imagePanes };",
      ].join("\n"),
    )(
      { matches: false },
      true,
      () => "split",
      () => "",
    );
    const image = (status: string) => ({
      path: "a.png",
      status,
      isImage: true,
      hunks: [],
      imgOld: "img/o.png",
      sizeOld: [1, 2],
      imgNew: "img/n.png",
      stubNew: undefined,
    });
    expect(views(image("M"))).toEqual(["comparison"]);
    expect(fileView(image("M"))).toBe("comparison");
    expect(imagePanes(image("M"))).toEqual([
      ["Before", "img/o.png", undefined, [1, 2]],
      ["After", "img/n.png", undefined, undefined],
    ]);
    expect(imagePanes(image("A")).map((pane: unknown[]) => pane[0])).toEqual(["After"]);
    expect(imagePanes(image("D")).map((pane: unknown[]) => pane[0])).toEqual(["Before"]);
    expect(imagePanes({ status: "R", stubOld: "Animated." })[0]).toEqual([
      "Before",
      undefined,
      "Animated.",
      undefined,
    ]);
  });

  describe("expandable context", () => {
    const alignedLines = new Function(
      `${templateSource("function alignedLines(")}\nreturn alignedLines;`,
    )();
    const contextGaps = new Function(
      [
        templateSource("function alignedLines("),
        templateSource("function contextGaps("),
        "return contextGaps;",
      ].join("\n"),
    )();
    // Each gap as [hunk index it precedes, first old line, first new line, line count].
    function gaps(content: string, hunks: unknown) {
      const result = contextGaps({ content, hunks });
      return (
        result &&
        result.map((g: { at: number; lines: unknown[][] }) => [
          g.at,
          g.lines[0][1],
          g.lines[0][2],
          g.lines.length,
        ])
      );
    }

    it("finds the gaps at the top, between hunks and at the end, with old lines from hunk offsets", () => {
      const base = lines("line", 100);
      const next = base.replace("line 10\n", "ten\n").replace("line 60\n", "sixty\nextra\n");
      const hunks = hunksOf(base, next);
      expect(gaps(next, hunks)).toEqual([
        [0, 1, 1, 6],
        [1, 14, 14, 43],
        [2, 64, 65, 37],
      ]);
      const end = contextGaps({ content: next, hunks }).at(-1).lines;
      expect(end[0]).toEqual([" ", 64, 65, "line 64"]);
      expect(end.at(-1)).toEqual([" ", 100, 101, "line 100"]);
    });

    it("for a single hunk, marking the last line when the file has no final newline", () => {
      const base = lines("line", 50);
      for (const [content, last] of [
        [base, [" ", 50, 50, "line 50"]],
        [base.slice(0, -1), [" ", 50, 50, "line 50", 1]],
      ] as const) {
        const next = content.replace("line 20\n", "twenty\n");
        const hunks = hunksOf(content, next);
        expect(hunks).toHaveLength(1);
        expect(gaps(next, hunks)).toEqual([
          [0, 1, 1, 16],
          [1, 24, 24, 27],
        ]);
        expect(contextGaps({ content: next, hunks }).at(-1).lines.at(-1)).toEqual(last);
      }
    });

    it("finds no gaps when the hunks cover the file", () => {
      const [added] = parseDiff(
        "diff --git a/b b/b\nnew file mode 100644\n--- /dev/null\n+++ b/b\n@@ -0,0 +1,3 @@\n+a\n+b\n+c\n",
      );
      expect(gaps("a\nb\nc\n", added.hunks)).toEqual([]);
      const base = lines("line", 5);
      const next = base.replace("line 3\n", "three\n");
      expect(gaps(next, hunksOf(base, next))).toEqual([]);
      const noNl = lines("line", 4).slice(0, -1);
      const four = noNl.replace("line 4", "four");
      expect(gaps(four, hunksOf(noNl, four))).toEqual([]);
    });

    it("checks the hunks align with the content", () => {
      const [file] = parseDiff(
        "diff --git a/a b/a\nindex 1..2 100644\n--- a/a\n+++ b/a\n@@ -1,2 +1,2 @@\n a\n-b\n+c\n",
      );
      expect(alignedLines({ content: "a\nc\nd\n", hunks: file.hunks })).toEqual(["a", "c", "d"]);
      expect(gaps("a\nc\nd\n", file.hunks)).toEqual([[1, 3, 3, 1]]);
      for (const content of ["x\nc\nd\n", "a\nb\nd\n", "a\n", undefined]) {
        expect(alignedLines({ content, hunks: file.hunks })).toBeNull();
        expect(contextGaps({ content, hunks: file.hunks })).toBeNull();
      }
    });

    it("renders expand rows and opens a gap that holds an open thread's line", () => {
      const base = lines("line", 100);
      const next = base.replace("line 50\n", "fifty\n");
      const file = { id: "f-a", path: "a", hunks: hunksOf(base, next), content: next };
      const rows = (known: Set<string>, state?: { top: number; bottom: number }) => {
        const { renderUnified, gapState } = unifiedRenderer(known);
        if (state) Object.assign(gapState(file, 0), state);
        const table = new FakeElement("table");
        renderUnified(file, 0, table);
        return table.children
          .slice(1)
          .map((row) => (row.className === "expand" ? `expand ${row.dataset.gap}` : row.id));
      };
      const hunk = ["f-a-hunk-47", ...[47, 48, 49, 50, 50, 51, 52, 53].map((n) => `f-a-new-${n}`)];
      hunk[4] = "f-a-old-50";
      expect(rows(new Set())).toEqual(["expand 0", ...hunk, "expand 1"]);
      const top = Array.from({ length: 46 }, (_, i) => `f-a-new-${i + 1}`);
      expect(rows(new Set(["f-a-new-10"]))).toEqual([...top, ...hunk, "expand 1"]);
      expect(rows(new Set(), { top: 0, bottom: 20 })).toEqual([
        "expand 0",
        ...top.slice(26),
        ...hunk,
        "expand 1",
      ]);
      const tail = Array.from({ length: 47 }, (_, i) => `f-a-new-${i + 54}`);
      expect(rows(new Set(["f-a-old-99"]))).toEqual(["expand 0", ...hunk, ...tail]);
    });
  });

  describe("rebuilds a Markdown file's old source", () => {
    const oldSource = new Function(`${templateSource("function oldSource(")}\nreturn oldSource;`)();
    function rebuilt(dir: string, over: Partial<BuildInput> = {}): Map<string, string | null> {
      const result = new Map<string, string | null>();
      for (const file of collectPage(dir, input(over)).files) {
        if (file.content) {
          result.set(file.path, oldSource({ ...file, content: file.content.join("\n") }));
        }
      }
      return result;
    }
    function changed(base: Record<string, string>, next: Record<string, string>) {
      const dir = newRepo(base);
      write(dir, next);
      return dir;
    }

    it("across several hunks, with insertions, deletions and frontmatter", () => {
      const many = lines("line", 30);
      const fm = "---\ntitle: Old\ntags: [a]\n---\n\n# Title\n\nBody\n";
      const ins = lines("keep", 12);
      const del = lines("drop", 12);
      const dir = changed(
        { "many.md": many, "fm.md": fm, "ins.md": ins, "del.md": del },
        {
          "many.md": many
            .replace("line 3\n", "changed 3\n")
            .replace("line 15\n", "- a\n- b\n")
            .replace("line 28\n", ""),
          "fm.md": fm.replace("title: Old", "title: New"),
          "ins.md": ins.replace("keep 6\n", "keep 6\nnew a\nnew b\n"),
          "del.md": del.replace("drop 6\ndrop 7\n", ""),
        },
      );
      expect(Object.fromEntries(rebuilt(dir))).toEqual({
        "many.md": many,
        "fm.md": fm,
        "ins.md": ins,
        "del.md": del,
      });
    });

    it("from zero-context hunks, where a +n,0 range names the line before the gap", () => {
      const base = lines("line", 8);
      const next = base.replace("line 3\nline 4\n", "").replace("line 6\n", "line 6\nnew\n");
      const dir = tempDir();
      write(dir, { "a.md": base, "b.md": next });
      const out = spawnSync("git", ["diff", "--no-index", "-U0", "--", "a.md", "b.md"], {
        cwd: dir,
        encoding: "utf8",
      }).stdout;
      const [file] = parseDiff(out);
      expect(file.hunks.map((hunk) => hunk.header.split(" @@ ")[0])).toEqual([
        "@@ -3,2 +2,0",
        "@@ -6,0 +5",
      ]);
      expect(oldSource({ content: next, hunks: file.hunks })).toBe(base);
    });

    it("for an emptied file", () => {
      for (const base of ["# Gone\n\ntext\n", "# Gone\n\ntext"]) {
        const dir = changed({ "a.md": base }, { "a.md": "" });
        expect(rebuilt(dir).get("a.md")).toBe(base);
      }
    });

    it("for a file removed from the index and kept untracked", () => {
      const base = "# Doc\n\none\ntwo\n";
      const dir = newRepo({ "doc.md": base });
      git(dir, "rm", "-q", "--cached", "doc.md");
      write(dir, { "doc.md": "# Doc\n\none\nthree\n" });
      const page = collectPage(dir, input({ untracked: ["doc.md"] })).files[0];
      expect(page.hunks!.map((hunk) => hunk.header)).toEqual([
        "@@ -1,4 +0,0 @@",
        "@@ -0,0 +1,4 @@",
      ]);
      expect(rebuilt(dir, { untracked: ["doc.md"] }).get("doc.md")).toBe(base);
    });

    it("when only the end-of-file newline changes", () => {
      for (const [base, next] of [
        ["# A\n\ntext", "# A\n\ntext\n"],
        ["# A\n\ntext\n", "# A\n\ntext"],
        ["# A\n\ntext", "# A\n\nmore"],
      ]) {
        const dir = changed({ "a.md": base }, { "a.md": next });
        expect(rebuilt(dir).get("a.md")).toBe(base);
      }
    });

    it("ignoring a trailing carriage return, and declines lines that do not match the content", () => {
      const [file] = parseDiff(
        "diff --git a/a.md b/a.md\nindex 1..2 100644\n--- a/a.md\n+++ b/a.md\n@@ -1,2 +1,2 @@\n a\n-b\n+c\n",
      );
      expect(oldSource({ content: "a\nc\n", hunks: file.hunks })).toBe("a\nb\n");
      expect(oldSource({ content: "a\r\nc\r\n", hunks: file.hunks })).toBe("a\nb\n");
      expect(oldSource({ content: "x\nc\n", hunks: file.hunks })).toBeNull();
      expect(oldSource({ content: "a\nd\n", hunks: file.hunks })).toBeNull();
      expect(oldSource({ content: "a\n", hunks: file.hunks })).toBeNull();
    });
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
    const out = join(work, "nested", "1");
    const result = run(["build", "--input", inputPath, "--out", out], join(dir, "src"));
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout).toBe(
      `Wrote ${out}\n8 files (1 uncommitted, 1 untracked), +7 -7 against main\n1 publish, 1 reader batch\n`,
    );
    const data = embedded(readFileSync(join(out, "index.html"), "utf8"));
    expect(data.buildId).toBe(`${git(dir, "rev-parse", "--short", "HEAD")}-2`);
    expect(data.files.map((file) => file.path)).toContain("img.png");
    const plan = JSON.parse(readFileSync(join(out, "publish.json"), "utf8"));
    expect(plan.out).toBe(out);
    expect(plan.send[0]).toEqual({ path: "index.html", source: null });
    for (const { path } of plan.send) expect(existsSync(join(out, path))).toBe(true);
    const mod = data.files.find((file) => file.path === "src/mod.ts")!;
    expect(plan.send).toContainEqual({ path: mod.data, source: "src/mod.ts" });

    const again = run(["build", "--input", inputPath, "--out", out], dir);
    expect(again.status).toBe(1);
    expect(again.stderr).toBe(`${out} already exists and is not an empty directory\n`);
  });

  it("fails when the diff is empty", () => {
    const dir = newRepo({ "a.txt": "a\n" });
    const inputPath = join(tempDir(), "input.json");
    writeFileSync(inputPath, JSON.stringify({ default: "main", publish: 1 }));
    const result = run(["build", "--input", inputPath, "--out", join(tempDir(), "1")], dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toBe("No changes against main\n");
  });
});

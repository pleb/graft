import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readlinkSync } from "node:fs";
import { basename, join } from "node:path";

const MIN_NODE_MAJOR = 24;
const MAX_GIT_OUTPUT = 512 * 1024 * 1024;
const LARGEST_SHOWN = 5;
// The longest escaped piece of line text on one line of the page, so Claude's Read tool sees whole lines.
const CHUNK = 500;
// Arrays whose items each go on their own line of the page.
const LISTED = new Set(["threads", "files", "hunks", "lines"]);
// Fields whose text is split into pieces when long, as line text is.
const CHUNKED = new Set(["id", "path", "oldPath", "stub", "note"]);
const REMOVED_FROM_INDEX = "Removed from the index; kept as an untracked file.";

// The largest page Claude reads in full before publishing it.
export const MAX_PAGE_BYTES = 300 * 1024;

const DIFF_ARGS = [
  "-c",
  "core.quotePath=false",
  "-c",
  "diff.suppressBlankEmpty=false",
  "diff",
  "--no-color",
  "--no-ext-diff",
  "--no-textconv",
  "--no-relative",
  "--submodule=short",
  "--src-prefix=a/",
  "--dst-prefix=b/",
  "-M",
];

const LOCKFILES = new Set([
  "package-lock.json",
  "npm-shrinkwrap.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "bun.lock",
  "bun.lockb",
  "deno.lock",
  "Cargo.lock",
  "Gemfile.lock",
  "composer.lock",
  "poetry.lock",
  "Pipfile.lock",
  "uv.lock",
  "pdm.lock",
  "go.sum",
  "flake.lock",
  "mix.lock",
  "pubspec.lock",
  "Podfile.lock",
  "packages.lock.json",
  "gradle.lockfile",
]);

export type Status = "A" | "D" | "M" | "R" | "T";
export type Source = "committed" | "uncommitted" | "untracked";
export type Side = "old" | "new";

// [type, old line, new line, text, 1 when the line has no newline at end of file]
export type DiffLine = [" " | "+" | "-", number | null, number | null, string, 1?];

export interface Hunk {
  header: string;
  lines: DiffLine[];
}

export interface ParsedFile {
  path: string;
  oldPath?: string;
  status: Status;
  binary?: true;
  oldMode?: string;
  newMode?: string;
  // The "index" line: old and new blob ids, then the mode when it did not change.
  index?: string;
  // An untracked FIFO, socket or device, shown without content.
  special?: true;
  note?: string;
  hunks: Hunk[];
}

export interface PageFile {
  id: string;
  path: string;
  oldPath?: string;
  status: Status;
  source: Source;
  hash: string;
  binary?: true;
  stub?: string;
  note?: string;
  add: number;
  del: number;
  hunks?: Hunk[];
}

export interface PageData {
  repo: string;
  branch: string;
  base: string;
  buildId: string;
  mergeBase: string;
  head: string;
  uncommitted: number;
  untracked: number;
  threads: string[];
  files: PageFile[];
}

export interface Thread {
  path: string;
  side: Side;
  line: number;
}

export interface BuildInput {
  default: string;
  untracked: string[];
  exclude: string[];
  threads: Thread[];
  publish: number;
}

export interface Base {
  base: string;
  baseRef: string;
}

export interface Changes extends Base {
  root: string;
  name: string;
  tracked: string[];
  untracked: string[];
}

export class BuildError extends Error {}

export function isSupportedNode(version: string): boolean {
  return Number(version.split(".")[0]) >= MIN_NODE_MAJOR;
}

// One-to-one and safe in ids and CSS selectors: every character outside [A-Za-z0-9] becomes "_", its hex code point and "_".
export function encodePath(path: string): string {
  return path.replace(/[^A-Za-z0-9]/gu, (c) => `_${c.codePointAt(0)!.toString(16)}_`);
}

export function decodePath(encoded: string): string | null {
  if (!/^(?:[A-Za-z0-9]|_[0-9a-f]+_)*$/.test(encoded)) return null;
  try {
    return encoded.replace(/_([0-9a-f]+)_/g, (_, hex: string) =>
      String.fromCodePoint(parseInt(hex, 16)),
    );
  } catch {
    return null;
  }
}

export function fileId(path: string): string {
  return `f-${encodePath(path)}`;
}

export function lineId(path: string, side: Side, line: number): string {
  return `${fileId(path)}-${side}-${line}`;
}

export function parseLineId(id: string): { path: string; side: Side; line: number } | null {
  const match = /^f-((?:[A-Za-z0-9]|_[0-9a-f]+_)*)-(old|new)-([1-9][0-9]*)$/.exec(id);
  if (!match) return null;
  const path = decodePath(match[1]);
  if (path === null || encodePath(path) !== match[1]) return null;
  return { path, side: match[2] as Side, line: Number(match[3]) };
}

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

const ESCAPES: Record<string, number> = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13 };

// Undoes git's C-style quoting of a path, as in "a/tab\there".
export function unquoteGitPath(text: string): string {
  if (!text.startsWith('"') || !text.endsWith('"') || text.length < 2) return text;
  const parts: Buffer[] = [];
  for (const [token, escape] of text.slice(1, -1).matchAll(/\\([0-7]{1,3}|.)|[^\\]+/gsu)) {
    if (escape === undefined) parts.push(Buffer.from(token, "utf8"));
    else if (/^[0-7]/.test(escape)) parts.push(Buffer.from([parseInt(escape, 8)]));
    else if (escape in ESCAPES) parts.push(Buffer.from([ESCAPES[escape]]));
    else parts.push(Buffer.from(escape, "utf8"));
  }
  return Buffer.concat(parts).toString("utf8");
}

function stripPrefix(name: string, prefix: string): string | null {
  const path = unquoteGitPath(name.endsWith("\t") ? name.slice(0, -1) : name);
  if (path === "/dev/null") return null;
  return path.startsWith(prefix) ? path.slice(prefix.length) : path;
}

// The path from a "diff --git a/X b/X" line, used when no ---/+++ or rename lines name it.
function headerPath(line: string): string {
  const rest = line.slice("diff --git ".length);
  if (rest.startsWith('"')) {
    const match = /^("(?:[^"\\]|\\.)*")/.exec(rest);
    return match ? (stripPrefix(match[1], "a/") ?? "") : rest;
  }
  const size = (rest.length - 5) / 2;
  if (
    Number.isInteger(size) &&
    rest.startsWith("a/") &&
    rest.slice(2, 2 + size) === rest.slice(5 + size)
  ) {
    return rest.slice(2, 2 + size);
  }
  const at = rest.indexOf(" b/");
  return at > 2 ? rest.slice(2, at) : rest;
}

export function parseDiff(text: string): ParsedFile[] {
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  const files: ParsedFile[] = [];
  let i = 0;
  while (i < lines.length) {
    const header = lines[i];
    if (!header.startsWith("diff --git ")) throw new BuildError(`Unexpected diff line: ${header}`);
    i++;
    let oldPath: string | null | undefined;
    let newPath: string | null | undefined;
    let renameFrom: string | undefined;
    let renameTo: string | undefined;
    let status: Status = "M";
    const file: Omit<ParsedFile, "path" | "status"> = { hunks: [] };
    while (i < lines.length && !lines[i].startsWith("diff --git ") && !lines[i].startsWith("@@ ")) {
      const line = lines[i++];
      if (line.startsWith("new file mode ")) {
        status = "A";
        file.newMode = line.slice(14);
      } else if (line.startsWith("deleted file mode ")) {
        status = "D";
        file.oldMode = line.slice(18);
      } else if (line.startsWith("old mode ")) file.oldMode = line.slice(9);
      else if (line.startsWith("new mode ")) file.newMode = line.slice(9);
      else if (line.startsWith("index ")) file.index = line.slice(6);
      else if (line.startsWith("rename from ")) renameFrom = unquoteGitPath(line.slice(12));
      else if (line.startsWith("rename to ")) renameTo = unquoteGitPath(line.slice(10));
      else if (line.startsWith("--- ")) oldPath = stripPrefix(line.slice(4), "a/");
      else if (line.startsWith("+++ ")) newPath = stripPrefix(line.slice(4), "b/");
      else if (line.startsWith("Binary files ") && line.endsWith(" differ")) file.binary = true;
    }
    const fallback = headerPath(header);
    const path = renameTo ?? newPath ?? oldPath ?? fallback;
    const parsed: ParsedFile = { path, status, ...file };
    if (renameFrom !== undefined) {
      parsed.status = "R";
      parsed.oldPath = renameFrom;
    }
    while (i < lines.length && lines[i].startsWith("@@ ")) {
      const head = lines[i++];
      const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(head);
      if (!match) throw new BuildError(`Unexpected hunk header: ${head}`);
      let oldLine = Number(match[1]);
      let newLine = Number(match[3]);
      let oldLeft = match[2] === undefined ? 1 : Number(match[2]);
      let newLeft = match[4] === undefined ? 1 : Number(match[4]);
      const hunk: Hunk = { header: head, lines: [] };
      while (i < lines.length && (oldLeft > 0 || newLeft > 0 || lines[i].startsWith("\\"))) {
        const line = lines[i++];
        const type = line[0] ?? " ";
        const code = line.slice(1);
        if (type === "\\") {
          const last = hunk.lines.at(-1);
          if (last) last[4] = 1;
        } else if (type === "-") {
          hunk.lines.push(["-", oldLine++, null, code]);
          oldLeft--;
        } else if (type === "+") {
          hunk.lines.push(["+", null, newLine++, code]);
          newLeft--;
        } else {
          hunk.lines.push([" ", oldLine++, newLine++, code]);
          oldLeft--;
          newLeft--;
        }
      }
      parsed.hunks.push(hunk);
    }
    files.push(parsed);
  }
  return files;
}

function counts(file: ParsedFile): { add: number; del: number } {
  let add = 0;
  let del = 0;
  for (const hunk of file.hunks) {
    for (const line of hunk.lines) {
      if (line[0] === "+") add++;
      else if (line[0] === "-") del++;
    }
  }
  return { add, del };
}

function stubFor(file: ParsedFile, add: number, del: number): string | undefined {
  const name = basename(file.path);
  const changed = `(+${add} −${del})`;
  if (file.special) return "Not a regular file. No content shown.";
  if (LOCKFILES.has(name)) return `Lockfile changed ${changed}. Content hidden.`;
  if (/\.min\.[A-Za-z0-9]+$/.test(name)) return `Minified file changed ${changed}. Content hidden.`;
  if (file.binary || file.hunks.length) return undefined;
  if (file.status === "R") return "Renamed without changes.";
  if (file.status === "A") return "Empty file added.";
  if (file.status === "D") return "Empty file deleted.";
  if (file.oldMode && file.newMode) return `Mode changed from ${file.oldMode} to ${file.newMode}.`;
  return "Changed without content.";
}

export function toPageFile(file: ParsedFile, source: Source): PageFile {
  const { add, del } = counts(file);
  // Hashed before stubbing, so a stubbed or binary file's hash still follows its content.
  const hash = createHash("sha256")
    .update(
      JSON.stringify([
        file.path,
        file.oldPath,
        file.status,
        file.binary,
        file.oldMode,
        file.newMode,
        file.index,
        file.hunks,
      ]),
    )
    .digest("hex")
    .slice(0, 16);
  const stub = stubFor(file, add, del);
  const page: PageFile = {
    id: fileId(file.path),
    path: file.path,
    status: file.status,
    source,
    hash,
    add,
    del,
  };
  if (file.oldPath !== undefined) page.oldPath = file.oldPath;
  if (file.note !== undefined) page.note = file.note;
  if (file.binary) page.binary = true;
  else if (stub) page.stub = stub;
  else page.hunks = file.hunks;
  return page;
}

function git(
  root: string | null,
  args: string[],
  ok: number[] = [0],
): { status: number; stdout: string; stderr: string } {
  const result = spawnSync("git", root === null ? args : ["-C", root, ...args], {
    encoding: "utf8",
    maxBuffer: MAX_GIT_OUTPUT,
  });
  if (result.error) throw new BuildError(`git ${args.join(" ")} failed: ${result.error.message}`);
  const status = result.status ?? -1;
  if (!ok.includes(status)) {
    throw new BuildError(
      `git ${args.join(" ")} failed: ${result.stderr.trim() || `exit status ${status}`}`,
    );
  }
  return { status, stdout: result.stdout, stderr: result.stderr };
}

function splitZ(text: string): string[] {
  return text.split("\0").filter(Boolean);
}

export function repoRoot(cwd: string): string {
  const result = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd, encoding: "utf8" });
  if (result.error || result.status !== 0) {
    const reason = result.error?.message ?? result.stderr.trim();
    throw new BuildError(`${cwd} is not inside a git repository${reason ? `: ${reason}` : ""}`);
  }
  return result.stdout.trim();
}

function resolves(root: string, ref: string): boolean {
  return git(root, ["rev-parse", "--verify", "-q", `${ref}^{commit}`], [0, 1]).status === 0;
}

export function resolveBase(root: string, branch: string): Base {
  if (!branch || branch.startsWith("-")) throw new BuildError(`${branch} is not a branch name`);
  const hasOrigin = git(root, ["remote"]).stdout.split("\n").includes("origin");
  const remote = `origin/${branch}`;
  const baseRef = hasOrigin && resolves(root, remote) ? remote : branch;
  if (!resolves(root, baseRef)) {
    throw new BuildError(
      `Cannot resolve the base: ${hasOrigin ? `${remote} and ` : ""}${branch} do not resolve`,
    );
  }
  const merge = git(root, ["merge-base", "HEAD", baseRef], [0, 1]);
  if (merge.status !== 0) throw new BuildError(`HEAD and ${baseRef} have no merge base`);
  return { base: merge.stdout.trim(), baseRef };
}

export function listUntracked(root: string): string[] {
  const out = git(root, [
    "-c",
    "core.quotePath=false",
    "ls-files",
    "-z",
    "--others",
    "--exclude-standard",
  ]);
  return splitZ(out.stdout).filter((path) => !path.endsWith("/"));
}

// A file name unique to the repo root: its basename and a hash of the full path.
export function pageName(root: string): string {
  const hash = createHash("sha256").update(root).digest("hex").slice(0, 8);
  return `${basename(root).replace(/[^A-Za-z0-9._-]/g, "-")}-${hash}`;
}

export function listChanges(cwd: string, branch: string): Changes {
  const root = repoRoot(cwd);
  const base = resolveBase(root, branch);
  // Each entry is a status, then one path, or two for a rename or copy.
  const fields = splitZ(git(root, [...DIFF_ARGS, "--name-status", "-z", base.base, "--"]).stdout);
  const tracked = new Set<string>();
  for (let i = 0; i < fields.length; i++) {
    if (/^[RC]/.test(fields[i])) tracked.add(fields[++i]);
    tracked.add(fields[++i]);
  }
  return {
    root,
    name: pageName(root),
    ...base,
    tracked: [...tracked],
    untracked: listUntracked(root),
  };
}

function strings(value: unknown, name: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new BuildError(`Input "${name}" must be an array of strings`);
  }
  return value;
}

function threads(value: unknown): Thread[] {
  if (value === undefined) return [];
  const valid = (item: unknown): item is Thread => {
    const thread = item as Record<string, unknown>;
    return (
      typeof item === "object" &&
      item !== null &&
      typeof thread.path === "string" &&
      (thread.side === "old" || thread.side === "new") &&
      typeof thread.line === "number" &&
      Number.isInteger(thread.line) &&
      thread.line > 0
    );
  };
  if (!Array.isArray(value) || !value.every(valid)) {
    throw new BuildError(
      'Input "threads" must be an array of {"path": <file path>, "side": "old" or "new", "line": <line number>}',
    );
  }
  return value.map(({ path, side, line }) => ({ path, side, line }));
}

export function parseInput(value: unknown): BuildInput {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new BuildError("Input must be a JSON object");
  }
  const input = value as Record<string, unknown>;
  if (typeof input.default !== "string" || !input.default) {
    throw new BuildError('Input "default" must be the default branch name');
  }
  const publish = input.publish ?? 1;
  if (typeof publish !== "number" || !Number.isInteger(publish) || publish < 0) {
    throw new BuildError('Input "publish" must be a non-negative integer');
  }
  return {
    default: input.default,
    untracked: strings(input.untracked, "untracked"),
    exclude: strings(input.exclude, "exclude"),
    threads: threads(input.threads),
    publish,
  };
}

interface Entry {
  file: ParsedFile;
  source: Source;
}

const SOURCES: Source[] = ["committed", "uncommitted", "untracked"];

// The file type from a git mode: 10 for a regular file, 12 for a symlink, 16 for a submodule.
function modeType(mode: string | undefined): string | undefined {
  return mode?.slice(0, 2);
}

// One entry from a delete and an add of the same path, as git reports a type change or a file
// removed from the index and kept in the working tree.
export function mergeSides(gone: ParsedFile, added: ParsedFile): ParsedFile {
  const merged: ParsedFile = {
    path: added.path,
    status: modeType(gone.oldMode) === modeType(added.newMode) ? "M" : "T",
    hunks: [...gone.hunks, ...added.hunks],
  };
  if (gone.binary || added.binary) merged.binary = true;
  if (gone.oldMode !== undefined) merged.oldMode = gone.oldMode;
  if (added.newMode !== undefined) merged.newMode = added.newMode;
  const oldBlob = gone.index?.split(" ")[0].split("..")[0];
  const newBlob = added.index?.split(" ")[0].split("..")[1];
  if (oldBlob !== undefined || newBlob !== undefined) merged.index = `${oldBlob}..${newBlob}`;
  return merged;
}

function mergeByPath(entries: Entry[]): Entry[] {
  const byPath = new Map<string, Entry>();
  for (const entry of entries) {
    const path = entry.file.path;
    const other = byPath.get(path);
    if (!other) {
      byPath.set(path, entry);
      continue;
    }
    const [gone, added] = other.file.status === "D" ? [other, entry] : [entry, other];
    if (gone.file.status !== "D" || added.file.status !== "A") {
      throw new BuildError(`git reported ${path} twice`);
    }
    const file = mergeSides(gone.file, added.file);
    if (added.source === "untracked") file.note = REMOVED_FROM_INDEX;
    byPath.set(path, {
      file,
      source: SOURCES[Math.max(SOURCES.indexOf(gone.source), SOURCES.indexOf(added.source))],
    });
  }
  return [...byPath.values()];
}

// An untracked symlink shows as one added line holding its target, as git shows a tracked one;
// any other non-regular file shows without content, since git would block reading a FIFO.
export function untrackedFile(root: string, path: string): ParsedFile[] {
  const full = join(root, path);
  const stat = lstatSync(full);
  if (!stat.isFile() && !stat.isSymbolicLink()) {
    return [{ path, status: "A", special: true, hunks: [] }];
  }
  if (stat.isSymbolicLink()) {
    const target = readlinkSync(full, "utf8");
    const line: DiffLine = ["+", null, 1, target, 1];
    return [
      { path, status: "A", newMode: "120000", hunks: [{ header: "@@ -0,0 +1 @@", lines: [line] }] },
    ];
  }
  const args = [...DIFF_ARGS, "--no-index", "--", "/dev/null", path];
  const out = git(root, args, [1]);
  if (!out.stdout.startsWith("diff --git")) {
    const reason = out.stderr.trim();
    throw new BuildError(`git ${args.join(" ")} printed no diff${reason ? `: ${reason}` : ""}`);
  }
  return parseDiff(out.stdout);
}

export function collectPage(cwd: string, input: BuildInput): PageData {
  const root = repoRoot(cwd);
  const { base, baseRef } = resolveBase(root, input.default);
  const exclude = new Set(input.exclude);
  const kept = (file: ParsedFile) =>
    !exclude.has(file.path) && (file.oldPath === undefined || !exclude.has(file.oldPath));

  const uncommitted = new Set(
    splitZ(git(root, [...DIFF_ARGS, "--name-only", "-z", "HEAD", "--"]).stdout),
  );
  const entries: Entry[] = parseDiff(git(root, [...DIFF_ARGS, base, "--"]).stdout)
    .filter(kept)
    .map((file) => ({ file, source: uncommitted.has(file.path) ? "uncommitted" : "committed" }));

  const untracked = new Set(listUntracked(root));
  const wanted = new Set(input.untracked);
  for (const path of wanted) {
    if (!untracked.has(path)) throw new BuildError(`${path} is not an untracked file`);
  }
  for (const path of wanted) {
    if (exclude.has(path)) continue;
    for (const file of untrackedFile(root, path)) entries.push({ file, source: "untracked" });
  }
  const files = mergeByPath(entries).map(({ file, source }) => toPageFile(file, source));
  if (!files.length) throw new BuildError(`No changes against ${baseRef}`);
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const paths = new Set(files.map((file) => file.path));
  const missing = input.threads.filter((thread) => !paths.has(thread.path));
  if (missing.length) {
    const names = missing.map((thread) => `${thread.path} (${thread.side} ${thread.line})`);
    throw new BuildError(`Threads name files that are not in the page: ${names.join(", ")}`);
  }

  const head = git(root, ["rev-parse", "--short", "HEAD"]).stdout.trim();
  const symbolic = git(root, ["symbolic-ref", "--short", "-q", "HEAD"], [0, 1]);
  return {
    repo: basename(root),
    branch: symbolic.status === 0 ? symbolic.stdout.trim() : `detached at ${head}`,
    base: baseRef,
    buildId: `${head}-${input.publish}`,
    mergeBase: git(root, ["rev-parse", "--short", base]).stdout.trim(),
    head,
    uncommitted: files.filter((file) => file.source === "uncommitted").length,
    untracked: files.filter((file) => file.source === "untracked").length,
    threads: input.threads.map((thread) => lineId(thread.path, thread.side, thread.line)),
    files,
  };
}

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

// JSON that cannot close its <script> tag or open an HTML comment.
function scriptJson(value: unknown): string {
  return JSON.stringify(value).replace(
    /[<>&\u2028\u2029]/g,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

// Text over CHUNK escaped characters becomes an array of pieces, which the page joins.
function chunkText(text: string): string | string[] {
  if (scriptJson(text).length - 2 <= CHUNK) return text;
  const pieces: string[] = [];
  let piece = "";
  let size = 0;
  for (const c of text) {
    const width = scriptJson(c).length - 2;
    if (size + width > CHUNK) {
      pieces.push(piece);
      piece = "";
      size = 0;
    }
    piece += c;
    size += width;
  }
  pieces.push(piece);
  return pieces;
}

function layoutText(value: unknown): string {
  if (typeof value !== "string") return layout(value);
  const text = chunkText(value);
  return layout(text, Array.isArray(text));
}

// Script-safe JSON with each object field, each item of a listed array, and each piece of a split
// text on its own line.
function layout(value: unknown, listed = false): string {
  if (Array.isArray(value)) {
    if (listed)
      return value.length ? `[\n${value.map((item) => layoutText(item)).join(",\n")}\n]` : "[]";
    return `[${value.map(layoutText).join(",")}]`;
  }
  if (typeof value === "object" && value !== null) {
    const fields = Object.entries(value).map(([key, item]) => {
      const text = CHUNKED.has(key) ? layoutText(item) : layout(item, LISTED.has(key));
      return `${scriptJson(key)}:${text}`;
    });
    return `{\n${fields.join(",\n")}\n}`;
  }
  return scriptJson(value);
}

function kb(bytes: number): string {
  return `${Math.ceil(bytes / 1024)} KB`;
}

export function renderPage(template: string, data: PageData): string {
  const json = layout(data);
  const [before, after, extra] = template.split("__DIFF_DATA__");
  if (after === undefined || extra !== undefined)
    throw new BuildError("The template must hold __DIFF_DATA__ once");
  const title = escapeHtml(`${data.repo} / ${data.branch} diff`);
  const html = before.split("__DIFF_TITLE__").join(title) + json + after;
  const size = Buffer.byteLength(html);
  if (size > MAX_PAGE_BYTES) {
    const largest = data.files
      .map((file) => ({ path: file.path, size: Buffer.byteLength(layout(file)) }))
      .sort((a, b) => b.size - a.size)
      .slice(0, LARGEST_SHOWN)
      .map((file) => `${file.path} (${kb(file.size)})`);
    throw new BuildError(
      `The page is ${kb(size)}, over the ${kb(MAX_PAGE_BYTES)} Claude can read. Largest files: ${largest.join(", ")}`,
    );
  }
  return html;
}

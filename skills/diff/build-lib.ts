import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { crc32, deflateSync, inflateSync } from "node:zlib";

const MIN_NODE_MAJOR = 24;
const MAX_GIT_OUTPUT = 512 * 1024 * 1024;
const LARGEST_SHOWN = 5;
// The longest escaped piece of line text on one line of the page, so Claude's Read tool sees whole lines.
const CHUNK = 500;
// Arrays whose items each go on their own line of the page.
const LISTED = new Set(["threads", "files", "hunks", "lines", "content", "svgOld", "svgNew"]);
// Fields whose text is split into pieces when long, as line text is.
const CHUNKED = new Set(["id", "path", "oldPath", "stub", "note"]);
const MARKDOWN = new Set([".md", ".markdown", ".mdx"]);
const SVG = ".svg";
const IMAGES = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp"]);
const REMOVED_FROM_INDEX = "Removed from the index; kept as an untracked file.";
const NO_EXPAND = "Too large to expand past its hunks.";
const NO_RENDER = "Too large to render; shows the diff only.";
const NOT_IMAGE = "Not a PNG, JPEG, GIF or WebP image.";
const NOT_REGULAR = "Not a regular file.";
const ANIMATED = "Animated; previews show still images only.";
const NOT_STRIPPED = "Could not remove this image's metadata.";
const LFS_POINTER = "version https://git-lfs.github.com/spec/v1\n";
const UTF8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const PAGE = "index.html";

// The largest total of data files, which readers read in full before each publish.
export const MAX_DATA_BYTES = 5 * 1024 * 1024;
// The largest data file of hunks alone, and the largest that keeps its SVG sides.
export const MAX_FILE_DATA_BYTES = 500 * 1024;
// The largest data file that keeps its expandable content.
export const MAX_EXPAND_BYTES = 250 * 1024;
export const MAX_SEND_BYTES = 60 * 1024 * 1024;
export const MAX_VERSION_FILES = 511;
export const MAX_PUBLISH_PATHS = 255;
export const READER_TEXT_BYTES = 300 * 1024;
export const READER_IMAGES = 10;
// The most image files that get previews, in path order.
export const MAX_IMAGE_FILES = 20;
// The largest image side that gets a preview, in bytes and in pixels on its longest edge.
export const MAX_IMAGE_SIDE_BYTES = 2 * 1024 * 1024;
export const MAX_IMAGE_EDGE = 4096;
// A total across the build's distinct previewed image sides.
export const MAX_IMAGE_BYTES = 40 * 1024 * 1024;
const OVER_IMAGE_FILES = `Over the ${MAX_IMAGE_FILES} image previews a page shows.`;
const OVER_IMAGE_BYTES = `Over the ${MAX_IMAGE_BYTES / 1024 / 1024} MB of image previews a page holds.`;

export const DIFF_ARGS = [
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

// One side of an image file: its bytes when it gets a preview, else a stub saying why not.
export interface ImageSide {
  bytes?: Buffer;
  ext?: ImageInfo["ext"];
  width?: number;
  height?: number;
  stub?: string;
}

export interface ImageInfo {
  ext: "png" | "jpg" | "gif" | "webp";
  width: number;
  height: number;
  animated: boolean;
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
  // A regular text file's full new content, one item per line.
  content?: string[];
  // An SVG file's old and new content, one item per line, for the rendered view.
  svgOld?: string[];
  svgNew?: string[];
  // An image file's sides: old unless added, new unless deleted.
  image?: { old?: ImageSide; new?: ImageSide };
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
  fileList: "flat" | "tree";
  files: PageFile[];
}

export interface ManifestFile {
  id: string;
  path: string;
  oldPath?: string;
  status: Status;
  source: Source;
  add: number;
  del: number;
  binary?: true;
  hash: string;
  hasHunks: boolean;
  isMarkdown: boolean;
  isImage?: true;
  stub?: string;
  note?: string;
  // Set when the file has hunks or is an image with a previewed side.
  data?: string;
  // An image file with no previewed side: each side's stub and size, in place of a data file.
  stubOld?: string;
  stubNew?: string;
  sizeOld?: [number, number];
  sizeNew?: [number, number];
}

export interface Manifest extends Omit<PageData, "files"> {
  files: ManifestFile[];
}

export interface FileData {
  path: string;
  hunks: Hunk[];
  content?: string[];
  svgOld?: string[];
  svgNew?: string[];
  // An image file's previewed sides by their path in the build directory, or a stub saying why a
  // side has none, and each side's width and height when known.
  imgOld?: string;
  imgNew?: string;
  stubOld?: string;
  stubNew?: string;
  sizeOld?: [number, number];
  sizeNew?: [number, number];
}

// A file of the build, by its path in the build directory, with the repo file it comes from.
export interface BuiltFile {
  path: string;
  source: string | null;
  bytes: number;
}

export interface PublishPlan {
  out: string;
  send: { path: string; source: string | null }[];
  remove: string[];
  keep: string[];
  // In order; each one sends index.html.
  publishes: { send: string[]; remove: string[] }[];
  batches: { kind: "text" | "image"; paths: string[]; bytes: number }[];
}

export interface BuildOutput {
  manifest: Manifest;
  // Each file's text by its path in the build directory, index.html first.
  files: Map<string, string>;
  // Each previewed image side's bytes by its path in the build directory.
  images: Map<string, Buffer>;
  publish: PublishPlan;
}

export type Thread =
  | { path: string; side: Side; line: number }
  | { path: string; side: "file" }
  // line is the hunk's new start line.
  | { path: string; side: "hunk"; line: number };

export interface BuildInput {
  default: string;
  untracked: string[];
  exclude: string[];
  threads: Thread[];
  publish: number;
  // The artifact's published paths.
  server: string[];
  fileList: "flat" | "tree";
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

export function threadId(thread: Thread): string {
  if (thread.side === "file") return `${fileId(thread.path)}-file`;
  if (thread.side === "hunk") return `${fileId(thread.path)}-hunk-${thread.line}`;
  return lineId(thread.path, thread.side, thread.line);
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
  input?: string,
): { status: number; stdout: string; stderr: string } {
  const result = spawnSync("git", root === null ? args : ["-C", root, ...args], {
    encoding: "utf8",
    maxBuffer: MAX_GIT_OUTPUT,
    input,
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
  // git prints C:/... on Windows; resolve gives the native C:\... form.
  return resolve(result.stdout.trim());
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
    if (typeof item !== "object" || item === null) return false;
    const { path, side, line } = item as Record<string, unknown>;
    if (typeof path !== "string") return false;
    if (side === "file") return line === undefined;
    const min = side === "hunk" ? 0 : 1;
    return (
      (side === "old" || side === "new" || side === "hunk") &&
      typeof line === "number" &&
      Number.isInteger(line) &&
      line >= min
    );
  };
  if (!Array.isArray(value) || !value.every(valid)) {
    throw new BuildError(
      'Input "threads" must be an array of {"path": <file path>, "side": "old" or "new", "line": <line number>}, {"path": <file path>, "side": "file"} or {"path": <file path>, "side": "hunk", "line": <new start line>}',
    );
  }
  return value.map((thread) =>
    thread.side === "file"
      ? { path: thread.path, side: thread.side }
      : { path: thread.path, side: thread.side, line: thread.line },
  );
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
  const fileList = input.fileList ?? "flat";
  if (fileList !== "flat" && fileList !== "tree") {
    throw new BuildError('Input "fileList" must be "flat" or "tree"');
  }
  return {
    default: input.default,
    untracked: strings(input.untracked, "untracked"),
    exclude: strings(input.exclude, "exclude"),
    threads: threads(input.threads),
    publish,
    server: strings(input.server, "server"),
    fileList,
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

function fileMode(file: ParsedFile): string | undefined {
  return file.newMode ?? file.index?.split(" ")[1];
}

function showBytes(root: string, rev: string): Buffer {
  const args = ["show", rev];
  const result = spawnSync("git", ["-C", root, ...args], { maxBuffer: MAX_GIT_OUTPUT });
  if (result.error) throw new BuildError(`git ${args.join(" ")} failed: ${result.error.message}`);
  if (result.status !== 0) {
    const reason = result.stderr.toString().trim() || `exit status ${result.status}`;
    throw new BuildError(`git ${args.join(" ")} failed: ${reason}`);
  }
  return result.stdout;
}

// The git cat-file call that prints each rev's size on its own line. -z, which needs Git 2.38, is
// used only when a rev holds a newline.
export function blobSizeQuery(revs: string[]): { args: string[]; input: string } {
  const args = ["cat-file", "--batch-check=%(objectsize)"];
  if (!revs.some((rev) => rev.includes("\n"))) {
    return { args, input: revs.map((rev) => `${rev}\n`).join("") };
  }
  return { args: [...args, "-z"], input: revs.map((rev) => `${rev}\0`).join("") };
}

// Falls back to one call per rev when a Git older than 2.38 rejects -z.
function blobSizes(root: string, revs: string[]): Map<string, number> {
  if (!revs.length) return new Map();
  const { args, input } = blobSizeQuery(revs);
  let lines: string[];
  try {
    lines = git(root, args, [0], input).stdout.split("\n");
  } catch (error) {
    if (!args.includes("-z")) throw error;
    lines = revs.map((rev) => git(root, ["cat-file", "-s", rev]).stdout.trim());
  }
  return new Map(
    revs.map((rev, i) => {
      if (!/^\d+$/.test(lines[i] ?? "")) throw new BuildError(`git cat-file found no blob ${rev}`);
      return [rev, Number(lines[i])];
    }),
  );
}

function newBytes(root: string, page: PageFile): Buffer {
  if (page.source !== "committed") return readFileSync(join(root, page.path));
  return showBytes(root, `HEAD:${page.path}`);
}

function newContent(root: string, page: PageFile): string[] {
  return newBytes(root, page).toString("utf8").split("\n");
}

function lfsPaths(root: string, paths: string[]): Set<string> {
  if (!paths.length) return new Set();
  const out = git(root, ["check-attr", "-z", "--stdin", "filter"], [0], `${paths.join("\0")}\0`);
  const fields = splitZ(out.stdout);
  const lfs = new Set<string>();
  for (let i = 0; i + 2 < fields.length; i += 3) if (fields[i + 2] === "lfs") lfs.add(fields[i]);
  return lfs;
}

// A working file's CRLF endings become LF when its hunks hold no CR, as git's clean filter does.
function textContent(
  root: string,
  file: ParsedFile,
  page: PageFile,
  lfs: Set<string>,
): string[] | undefined {
  if (!page.hunks || page.status === "D") return undefined;
  if (page.source !== "committed" && lfs.has(page.path)) return undefined;
  const mode = fileMode(file);
  if (mode !== undefined && modeType(mode) !== "10") return undefined;
  const bytes = newBytes(root, page);
  let text: string;
  try {
    text = UTF8.decode(bytes);
  } catch {
    return undefined;
  }
  if (text.startsWith(LFS_POINTER)) return undefined;
  if (
    page.source !== "committed" &&
    text.includes("\r") &&
    !page.hunks.some((hunk) => hunk.lines.some((line) => line[3].includes("\r")))
  ) {
    text = text.replace(/\r\n/g, "\n");
  }
  return text.split("\n");
}

// A shown SVG file's old content from the merge base and new content, each side kept only when it is a regular file.
function svgSides(
  root: string,
  base: string,
  file: ParsedFile,
  page: PageFile,
): Pick<PageFile, "svgOld" | "svgNew"> {
  if (!page.hunks || extname(page.path).toLowerCase() !== SVG) return {};
  const regular = (mode: string | undefined) => mode === undefined || modeType(mode) === "10";
  const sides: Pick<PageFile, "svgOld" | "svgNew"> = {};
  if (page.status !== "A" && regular(file.oldMode ?? file.index?.split(" ")[1])) {
    sides.svgOld = git(root, ["show", `${base}:${page.oldPath ?? page.path}`]).stdout.split("\n");
  }
  if (page.status !== "D" && regular(fileMode(file))) sides.svgNew = newContent(root, page);
  return sides;
}

// Counts frames up to two; a truncated GIF counts the frames it has.
function gifFrames(bytes: Buffer): number {
  const table = (packed: number) => (packed & 0x80 ? 3 * 2 ** ((packed & 7) + 1) : 0);
  const skipBlocks = (at: number) => {
    while (at < bytes.length && bytes[at] !== 0) at += bytes[at] + 1;
    return at + 1;
  };
  let at = 13 + table(bytes[10]);
  let frames = 0;
  while (at < bytes.length && frames < 2) {
    const block = bytes[at];
    if (block === 0x21) at = skipBlocks(at + 2);
    else if (block === 0x2c) {
      frames++;
      if (at + 10 > bytes.length) break;
      at = skipBlocks(at + 11 + table(bytes[at + 9]));
    } else break;
  }
  return frames;
}

function jpegSize(bytes: Buffer): [number, number] | null {
  let at = 2;
  while (at + 4 <= bytes.length) {
    if (bytes[at] !== 0xff) return null;
    const marker = bytes[at + 1];
    if (marker === 0xff) {
      at++;
      continue;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      at += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null;
    const length = bytes.readUInt16BE(at + 2);
    const sof = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
    if (sof) {
      if (at + 9 > bytes.length) return null;
      return [bytes.readUInt16BE(at + 7), bytes.readUInt16BE(at + 5)];
    }
    at += 2 + length;
  }
  return null;
}

function webpInfo(bytes: Buffer): { size: [number, number] | null; animated: boolean } {
  let size: [number, number] | null = null;
  let animated = false;
  for (let at = 12; at + 8 <= bytes.length;) {
    const kind = bytes.toString("latin1", at, at + 4);
    const length = bytes.readUInt32LE(at + 4);
    const data = at + 8;
    if (kind === "ANIM") animated = true;
    if (at === 12 && kind === "VP8 " && data + 10 <= bytes.length) {
      if (bytes[data + 3] === 0x9d && bytes[data + 4] === 0x01 && bytes[data + 5] === 0x2a) {
        size = [bytes.readUInt16LE(data + 6) & 0x3fff, bytes.readUInt16LE(data + 8) & 0x3fff];
      }
    } else if (at === 12 && kind === "VP8L" && data + 5 <= bytes.length && bytes[data] === 0x2f) {
      const bits = bytes.readUInt32LE(data + 1);
      size = [(bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1];
    } else if (at === 12 && kind === "VP8X" && data + 10 <= bytes.length) {
      size = [bytes.readUIntLE(data + 4, 3) + 1, bytes.readUIntLE(data + 7, 3) + 1];
    }
    at = data + length + (length % 2);
  }
  return { size, animated };
}

// An APNG's acTL chunk comes before its first IDAT chunk.
function pngAnimated(bytes: Buffer): boolean {
  for (let at = 8; at + 8 <= bytes.length; at += 12 + bytes.readUInt32BE(at)) {
    const kind = bytes.toString("latin1", at + 4, at + 8);
    if (kind === "acTL") return true;
    if (kind === "IDAT") return false;
  }
  return false;
}

export function imageInfo(bytes: Buffer): ImageInfo | null {
  const has = (at: number, text: string) => bytes.toString("latin1", at, at + text.length) === text;
  let ext: ImageInfo["ext"];
  let size: [number, number] | null = null;
  let animated = false;
  if (has(0, "\x89PNG\r\n\x1a\n") && has(12, "IHDR") && bytes.length >= 24) {
    ext = "png";
    size = [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
    animated = pngAnimated(bytes);
  } else if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    ext = "jpg";
    size = jpegSize(bytes);
  } else if ((has(0, "GIF87a") || has(0, "GIF89a")) && bytes.length >= 13) {
    ext = "gif";
    size = [bytes.readUInt16LE(6), bytes.readUInt16LE(8)];
    animated = gifFrames(bytes) > 1;
  } else if (has(0, "RIFF") && has(8, "WEBP")) {
    ext = "webp";
    ({ size, animated } = webpInfo(bytes));
  } else return null;
  if (!size || !size[0] || !size[1]) return null;
  return { ext, width: size[0], height: size[1], animated };
}

// The orientation in a TIFF block's IFD0 when it is 2 to 8; anything malformed counts as none.
function exifOrientation(tiff: Buffer): number | undefined {
  const order = tiff.toString("latin1", 0, 2);
  if (tiff.length < 8 || (order !== "II" && order !== "MM")) return undefined;
  const u16 = (at: number) => (order === "II" ? tiff.readUInt16LE(at) : tiff.readUInt16BE(at));
  const u32 = (at: number) => (order === "II" ? tiff.readUInt32LE(at) : tiff.readUInt32BE(at));
  const ifd = u32(4);
  if (u16(2) !== 42 || ifd < 8 || ifd + 2 > tiff.length) return undefined;
  const count = u16(ifd);
  if (ifd + 2 + count * 12 > tiff.length) return undefined;
  for (let at = ifd + 2; at < ifd + 2 + count * 12; at += 12) {
    if (u16(at) !== 0x0112) continue;
    const value = u16(at + 8);
    if (u16(at + 2) !== 3 || u32(at + 4) !== 1 || value < 2 || value > 8) return undefined;
    return value;
  }
  return undefined;
}

// A big-endian TIFF block holding only an IFD0 orientation entry.
function orientationExif(value: number): Buffer {
  const tiff = Buffer.alloc(26);
  tiff.write("MM", 0, "latin1");
  tiff.writeUInt16BE(42, 2);
  tiff.writeUInt32BE(8, 4);
  tiff.writeUInt16BE(1, 8);
  tiff.writeUInt16BE(0x0112, 10);
  tiff.writeUInt16BE(3, 12);
  tiff.writeUInt32BE(1, 14);
  tiff.writeUInt16BE(value, 18);
  return tiff;
}

const PNG_KEPT = new Set([
  "IHDR",
  "PLTE",
  "IDAT",
  "IEND",
  "tRNS",
  "gAMA",
  "cHRM",
  "sRGB",
  "sBIT",
  "cICP",
]);
const PNG_SIZES: Record<string, number> = {
  IHDR: 13,
  IEND: 0,
  gAMA: 4,
  cHRM: 32,
  sRGB: 1,
  cICP: 4,
};
// By IHDR colour type; a palette image's tRNS holds up to one byte per palette entry.
const PNG_SBIT = [1, 0, 3, 3, 2, 0, 4];
const PNG_TRNS = [2, 0, 6];

function iccProfile(data: Buffer): boolean {
  return (
    data.length >= 128 &&
    data.readUInt32BE(0) === data.length &&
    data.toString("latin1", 36, 40) === "acsp"
  );
}

// An iCCP chunk's profile, when its zlib stream is whole, ends the chunk and inflates to one profile.
function pngProfile(body: Buffer): Buffer | null {
  const nul = body.indexOf(0);
  if (nul < 1 || nul > 79 || body[nul + 1] !== 0) return null;
  const compressed = body.subarray(nul + 2);
  try {
    const { buffer, engine } = inflateSync(compressed, {
      info: true,
      maxOutputLength: MAX_IMAGE_SIDE_BYTES,
    }) as unknown as { buffer: Buffer; engine: { bytesWritten: number } };
    return engine.bytesWritten === compressed.length && iccProfile(buffer) ? buffer : null;
  } catch {
    return null;
  }
}

function pngChunk(kind: string, data: Buffer): Buffer {
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length);
  chunk.write(kind, 4, "latin1");
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(chunk.subarray(4, 8 + data.length)), 8 + data.length);
  return chunk;
}

function stripPng(bytes: Buffer): Buffer | null {
  const out = [bytes.subarray(0, 8)];
  const colour = bytes[25];
  let palette = 0;
  let data = false;
  for (let at = 8; ;) {
    if (at + 12 > bytes.length) return null;
    const length = bytes.readUInt32BE(at);
    const end = at + 12 + length;
    if (end > bytes.length) return null;
    const kind = bytes.toString("latin1", at + 4, at + 8);
    const body = bytes.subarray(at + 8, at + 8 + length);
    if (kind === "eXIf") {
      const orientation = exifOrientation(body);
      if (orientation) out.push(pngChunk("eXIf", orientationExif(orientation)));
    } else if (kind === "iCCP") {
      const profile = pngProfile(body);
      if (!profile) return null;
      out.push(
        pngChunk("iCCP", Buffer.concat([Buffer.from("ICC\0\0", "latin1"), deflateSync(profile)])),
      );
    } else if (PNG_KEPT.has(kind)) {
      if (kind in PNG_SIZES && length !== PNG_SIZES[kind]) return null;
      if (kind === "sBIT" && (!PNG_SBIT[colour] || length !== PNG_SBIT[colour])) return null;
      if (kind === "PLTE") {
        if (!length || length % 3 || length > 768) return null;
        palette = length / 3;
      }
      if (kind === "tRNS") {
        if (colour === 3 ? !length || length > palette : length !== PNG_TRNS[colour]) return null;
      }
      if (kind === "IDAT") data = true;
      out.push(bytes.subarray(at, end));
    } else if (!(bytes[at + 4] & 0x20)) return null;
    if (kind === "IEND") return data ? Buffer.concat(out) : null;
    at = end;
  }
}

// SOFn, DHT, DAC, SOS, DQT, DNL and DRI; DNL and DRI hold two bytes.
function jpegKept(marker: number): boolean {
  return (
    (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc8) || (marker >= 0xda && marker <= 0xdd)
  );
}

// Whether a kept segment's body is exactly as long as the tables or components it declares.
function jpegExact(marker: number, body: Buffer): boolean {
  if (marker === 0xdb || marker === 0xc4) {
    let at = 0;
    while (at < body.length) {
      if (marker === 0xdb) {
        const precision = body[at] >> 4;
        if (precision > 1) return false;
        at += 1 + 64 * (precision + 1);
      } else {
        if (at + 17 > body.length) return false;
        let symbols = 0;
        for (let i = 1; i <= 16; i++) symbols += body[at + i];
        at += 17 + symbols;
      }
    }
    return at === body.length && at > 0;
  }
  if (marker === 0xda) return body.length >= 1 && body.length === 4 + 2 * body[0];
  if (marker === 0xcc) return body.length >= 2 && body.length % 2 === 0;
  if (marker === 0xdc || marker === 0xdd) return body.length === 2;
  return body.length >= 6 && body.length === 6 + 3 * body[5];
}

const ICC_SIGNATURE = Buffer.from("ICC_PROFILE\0", "latin1");
const ICC_FRAGMENT = 65519;

// The ICC_PROFILE fragments joined in sequence order, when every one of the declared count is there once.
function jpegProfile(fragments: Buffer[]): Buffer | null {
  const count = fragments[0][13];
  const parts: Buffer[] = [];
  for (const body of fragments) {
    const seq = body[12];
    if (body.length < 14 || body[13] !== count || seq < 1 || seq > count || parts[seq - 1]) {
      return null;
    }
    parts[seq - 1] = body.subarray(14);
  }
  if (fragments.length !== count) return null;
  const profile = Buffer.concat(parts);
  return iccProfile(profile) ? profile : null;
}

function jpegSegment(marker: number, data: Buffer): Buffer {
  const head = Buffer.from([0xff, marker, 0, 0]);
  head.writeUInt16BE(data.length + 2, 2);
  return Buffer.concat([head, data]);
}

// Where the entropy-coded data starting at `at` ends: the first FF of the marker after it.
function scanEnd(bytes: Buffer, at: number): number {
  for (;;) {
    const ff = bytes.indexOf(0xff, at);
    if (ff < 0) return -1;
    let next = ff + 1;
    while (bytes[next] === 0xff) next++;
    if (next >= bytes.length) return -1;
    if (bytes[next] !== 0 && (bytes[next] < 0xd0 || bytes[next] > 0xd7)) return ff;
    at = next + 1;
  }
}

function stripJpeg(bytes: Buffer): Buffer | null {
  const has = (data: Buffer, text: string) => data.toString("latin1", 0, text.length) === text;
  const out = [bytes.subarray(0, 2)];
  const fragments: Buffer[] = [];
  let iccAt = -1;
  let scanned = false;
  for (let at = 2; ;) {
    if (at + 2 > bytes.length || bytes[at] !== 0xff) return null;
    const marker = bytes[at + 1];
    if (marker === 0xff) {
      at++;
      continue;
    }
    if (marker === 0xd9) {
      if (!scanned) return null;
      out.push(bytes.subarray(at, at + 2));
      if (fragments.length) {
        const profile = jpegProfile(fragments);
        if (!profile) return null;
        const count = Math.ceil(profile.length / ICC_FRAGMENT);
        const segments = Array.from({ length: count }, (_, i) =>
          jpegSegment(
            0xe2,
            Buffer.concat([
              ICC_SIGNATURE,
              Buffer.from([i + 1, count]),
              profile.subarray(i * ICC_FRAGMENT, (i + 1) * ICC_FRAGMENT),
            ]),
          ),
        );
        out.splice(iccAt, 0, ...segments);
      }
      return Buffer.concat(out);
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      at += 2;
      continue;
    }
    if (at + 4 > bytes.length) return null;
    const length = bytes.readUInt16BE(at + 2);
    const end = at + 2 + length;
    if (length < 2 || end > bytes.length) return null;
    const body = bytes.subarray(at + 4, end);
    if (jpegKept(marker)) {
      if (!jpegExact(marker, body)) return null;
      out.push(bytes.subarray(at, end));
    } else if (marker === 0xe2 && has(body, "ICC_PROFILE\0")) {
      if (!fragments.length) iccAt = out.length;
      fragments.push(body);
    } else if (marker === 0xee && has(body, "Adobe")) {
      if (body.length < 12) return null;
      out.push(jpegSegment(marker, body.subarray(0, 12)));
    } else if (marker === 0xe1 && has(body, "Exif\0\0")) {
      const orientation = exifOrientation(body.subarray(6));
      if (orientation) {
        out.push(
          jpegSegment(marker, Buffer.concat([body.subarray(0, 6), orientationExif(orientation)])),
        );
      }
    } else if (!(marker >= 0xe0 && marker <= 0xef) && marker !== 0xfe) return null;
    at = end;
    if (marker === 0xda) {
      const scan = scanEnd(bytes, at);
      if (scan < 0) return null;
      out.push(bytes.subarray(at, scan));
      scanned = true;
      at = scan;
    }
  }
}

function stripGif(bytes: Buffer): Buffer | null {
  const table = (packed: number) => (packed & 0x80 ? 3 * 2 ** ((packed & 7) + 1) : 0);
  // The index past the sub-blocks starting at `at` and their terminator, or -1 when they run past the end.
  const blocksEnd = (at: number) => {
    while (at < bytes.length && bytes[at] !== 0) at += bytes[at] + 1;
    return at < bytes.length ? at + 1 : -1;
  };
  let at = 13 + table(bytes[10]);
  if (at > bytes.length) return null;
  const out = [bytes.subarray(0, at)];
  let image = false;
  while (at < bytes.length) {
    const block = bytes[at];
    if (block === 0x3b) {
      if (!image) return null;
      out.push(bytes.subarray(at, at + 1));
      return Buffer.concat(out);
    }
    if (block === 0x21) {
      const label = bytes[at + 1];
      const end = blocksEnd(at + 2);
      if (end < 0 || ![0xf9, 0xfe, 0xff, 0x01].includes(label)) return null;
      if (label === 0xf9) {
        if (bytes[at + 2] !== 4) return null;
        out.push(Buffer.concat([bytes.subarray(at, at + 7), Buffer.from([0])]));
      }
      at = end;
    } else if (block === 0x2c) {
      const data = at + 10 + table(bytes[at + 9]);
      const end = at + 10 <= bytes.length ? blocksEnd(data + 1) : -1;
      if (end < 0) return null;
      out.push(bytes.subarray(at, end));
      image = true;
      at = end;
    } else return null;
  }
  return null;
}

function riffChunk(kind: string, data: Buffer): Buffer {
  const chunk = Buffer.alloc(8 + data.length + (data.length % 2));
  chunk.write(kind, 0, "latin1");
  chunk.writeUInt32LE(data.length, 4);
  data.copy(chunk, 8);
  return chunk;
}

function stripWebp(bytes: Buffer): Buffer | null {
  const end = 8 + bytes.readUInt32LE(4);
  if (end > bytes.length) return null;
  const chunks: Buffer[] = [];
  let header: Buffer | undefined;
  let exif = false;
  let image = false;
  for (let at = 12; at < end;) {
    if (at + 8 > end) return null;
    const kind = bytes.toString("latin1", at, at + 4);
    const length = bytes.readUInt32LE(at + 4);
    if (at + 8 + length > end) return null;
    const data = bytes.subarray(at + 8, at + 8 + length);
    if (kind === "VP8 " || kind === "VP8L") {
      chunks.push(riffChunk(kind, data));
      image = true;
      if (at === 12) break;
    } else if (at === 12) {
      if (kind !== "VP8X" || length !== 10) return null;
      header = Buffer.from(data);
      header.fill(0, 1, 4);
    } else if (kind === "ICCP") {
      if (!iccProfile(data)) return null;
      chunks.push(riffChunk(kind, data));
    } else if (kind === "ALPH") chunks.push(riffChunk(kind, data));
    else if (kind === "EXIF" && !exif) {
      const tiff = data.toString("latin1", 0, 6) === "Exif\0\0" ? data.subarray(6) : data;
      const orientation = exifOrientation(tiff);
      if (orientation) {
        chunks.push(riffChunk(kind, orientationExif(orientation)));
        exif = true;
      }
    }
    at += 8 + length + (length % 2);
  }
  if (!image) return null;
  if (header) {
    header[0] = (header[0] & ~0x0c) | (exif ? 0x08 : 0);
    chunks.unshift(riffChunk("VP8X", header));
  }
  const riff = Buffer.alloc(12);
  riff.write("RIFF", 0, "latin1");
  riff.writeUInt32LE(4 + chunks.reduce((sum, chunk) => sum + chunk.length, 0), 4);
  riff.write("WEBP", 8, "latin1");
  return Buffer.concat([riff, ...chunks]);
}

// The image rebuilt from the structures needed to show it, or null when it cannot be walked.
export function stripImage(bytes: Buffer, ext: ImageInfo["ext"]): Buffer | null {
  if (ext === "png") return stripPng(bytes);
  if (ext === "jpg") return stripJpeg(bytes);
  if (ext === "gif") return stripGif(bytes);
  return stripWebp(bytes);
}

function mb(bytes: number): string {
  return `${Math.round((bytes / 1024 / 1024) * 10) / 10} MB`;
}

export function imageSide(size: number, read: () => Buffer): ImageSide {
  if (size > MAX_IMAGE_SIDE_BYTES) {
    return { stub: `Too large to preview: ${mb(size)}, over ${mb(MAX_IMAGE_SIDE_BYTES)}.` };
  }
  const bytes = read();
  const info = imageInfo(bytes);
  if (!info) return { stub: NOT_IMAGE };
  const side: ImageSide = { width: info.width, height: info.height };
  const { width, height } = info;
  if (Math.max(width, height) > MAX_IMAGE_EDGE) {
    side.stub = `Too many pixels to preview: ${width} × ${height}, over ${MAX_IMAGE_EDGE} on its longest side.`;
  } else if (info.animated) side.stub = ANIMATED;
  else {
    const stripped = stripImage(bytes, info.ext);
    if (stripped) Object.assign(side, { bytes: stripped, ext: info.ext });
    else side.stub = NOT_STRIPPED;
  }
  return side;
}

type SideSource = { rev: string } | { file: string } | { stub: string };

function imageSources(
  base: string,
  file: ParsedFile,
  page: PageFile,
): { old?: SideSource; new?: SideSource } | undefined {
  if (!page.binary || !isImage(page.path)) return undefined;
  const regular = (mode: string | undefined) => mode === undefined || modeType(mode) === "10";
  const sources: { old?: SideSource; new?: SideSource } = {};
  if (page.status !== "A") {
    sources.old = regular(file.oldMode ?? file.index?.split(" ")[1])
      ? { rev: `${base}:${page.oldPath ?? page.path}` }
      : { stub: NOT_REGULAR };
  }
  if (page.status !== "D") {
    if (!regular(fileMode(file))) sources.new = { stub: NOT_REGULAR };
    else if (page.source === "committed") sources.new = { rev: `HEAD:${page.path}` };
    else sources.new = { file: page.path };
  }
  return sources;
}

function readSide(root: string, source: SideSource, sizes: Map<string, number>): ImageSide {
  if ("stub" in source) return { stub: source.stub };
  if ("rev" in source) return imageSide(sizes.get(source.rev)!, () => showBytes(root, source.rev));
  const full = join(root, source.file);
  return imageSide(statSync(full).size, () => readFileSync(full));
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
  const pages = mergeByPath(entries).map(({ file, source }) => ({
    file,
    page: toPageFile(file, source),
  }));
  const lfs = lfsPaths(
    root,
    pages
      .filter(({ page }) => page.hunks && page.source !== "committed")
      .map(({ page }) => page.path),
  );
  const sources = pages.map(({ file, page }) => imageSources(base, file, page));
  const sizes = blobSizes(
    root,
    sources.flatMap((image) =>
      [image?.old, image?.new].flatMap((source) => (source && "rev" in source ? source.rev : [])),
    ),
  );
  const files = pages.map(({ file, page }, i) => {
    const content = textContent(root, file, page, lfs);
    if (content) page.content = content;
    Object.assign(page, svgSides(root, base, file, page));
    const image = sources[i];
    if (image) {
      page.image = {};
      if (image.old) page.image.old = readSide(root, image.old, sizes);
      if (image.new) page.image.new = readSide(root, image.new, sizes);
    }
    return page;
  });
  // A republish with no changes left shows an empty page, so the published one stops showing them.
  if (!files.length && !input.server.length) throw new BuildError(`No changes against ${baseRef}`);
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const paths = new Set(files.map((file) => file.path));
  const missing = input.threads.filter((thread) => !paths.has(thread.path));
  if (missing.length) {
    const names = missing.map((thread) =>
      thread.side === "file"
        ? `${thread.path} (file)`
        : `${thread.path} (${thread.side} ${thread.line})`,
    );
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
    threads: input.threads.map(threadId),
    fileList: input.fileList,
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

export function renderPage(template: string, manifest: Manifest): string {
  const [before, after, extra] = template.split("__DIFF_DATA__");
  if (after === undefined || extra !== undefined)
    throw new BuildError("The template must hold __DIFF_DATA__ once");
  const title = escapeHtml(`${manifest.repo} / ${manifest.branch} diff`);
  return before.split("__DIFF_TITLE__").join(title) + layout(manifest) + after;
}

function largest(sizes: { path: string; bytes: number }[]): string {
  return [...sizes]
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, LARGEST_SHOWN)
    .map((file) => `${file.path} (${kb(file.bytes)})`)
    .join(", ");
}

// An SVG's new text is kept once, in content when kept and else in svgNew; template.html reads it so.
function fileData(file: PageFile, content: boolean, svg: boolean): FileData {
  const data: FileData = { path: file.path, hunks: file.hunks! };
  const withContent = content && file.content !== undefined;
  if (withContent) data.content = file.content;
  if (svg && file.svgOld) data.svgOld = file.svgOld;
  if (svg && file.svgNew && !withContent) data.svgNew = file.svgNew;
  return data;
}

interface Sized {
  file: PageFile;
  content: boolean;
  svg: boolean;
  sizes: Map<string, number>;
}

function dataBytes(item: Sized, content: boolean, svg: boolean): number {
  const key = `${content} ${svg}`;
  let bytes = item.sizes.get(key);
  if (bytes === undefined) {
    bytes = Buffer.byteLength(layout(fileData(item.file, content, svg)));
    item.sizes.set(key, bytes);
  }
  return bytes;
}

// Drops are made from the largest files first until the total fits MAX_DATA_BYTES: content without
// kept SVG sides, then SVG sides, then the content left.
function fitData(files: PageFile[]): Sized[] {
  const sized = files
    .filter((file) => file.hunks)
    .map((file): Sized => ({
      file,
      content: file.content !== undefined,
      svg: file.svgOld !== undefined || file.svgNew !== undefined,
      sizes: new Map(),
    }));
  const bare = sized.map((item) => ({
    path: item.file.path,
    bytes: dataBytes(item, false, false),
  }));
  const over = bare.filter((item) => item.bytes > MAX_FILE_DATA_BYTES);
  if (over.length) {
    throw new BuildError(
      `${over.length} file diff${over.length === 1 ? " is" : "s are"} over the ${kb(MAX_FILE_DATA_BYTES)} one file can hold. Largest files: ${largest(bare)}`,
    );
  }
  const bareTotal = bare.reduce((sum, item) => sum + item.bytes, 0);
  if (bareTotal > MAX_DATA_BYTES) {
    throw new BuildError(
      `The diff data is ${kb(bareTotal)}, over the ${kb(MAX_DATA_BYTES)} readers can read. Largest files: ${largest(bare)}`,
    );
  }
  for (const item of sized) {
    if (item.svg && dataBytes(item, item.content, true) <= MAX_FILE_DATA_BYTES) continue;
    item.svg = false;
    if (item.content && dataBytes(item, true, false) > MAX_EXPAND_BYTES) item.content = false;
  }
  let total = sized.reduce((sum, item) => sum + dataBytes(item, item.content, item.svg), 0);
  const drop = (next: (item: Sized) => { content: boolean; svg: boolean } | undefined) => {
    const drops = sized
      .map((item) => ({ item, bytes: dataBytes(item, item.content, item.svg), to: next(item) }))
      .filter(({ item, bytes, to }) => to && dataBytes(item, to.content, to.svg) < bytes)
      .sort((a, b) => b.bytes - a.bytes);
    for (const { item, bytes, to } of drops) {
      if (total <= MAX_DATA_BYTES) return;
      Object.assign(item, to);
      total += dataBytes(item, item.content, item.svg) - bytes;
    }
  };
  drop((item) => (item.content && !item.svg ? { content: false, svg: false } : undefined));
  drop((item) => (item.svg ? { content: item.content, svg: false } : undefined));
  // Content left with kept sides carries an SVG's only new text, so both go together.
  drop((item) => (item.content ? { content: false, svg: false } : undefined));
  return sized;
}

function manifestFile(file: PageFile, data?: string, item?: Sized): ManifestFile {
  const entry: ManifestFile = {
    id: file.id,
    path: file.path,
    ...(file.oldPath !== undefined && { oldPath: file.oldPath }),
    status: file.status,
    source: file.source,
    add: file.add,
    del: file.del,
    hash: file.hash,
    hasHunks: file.hunks !== undefined,
    isMarkdown: file.hunks !== undefined && MARKDOWN.has(extname(file.path).toLowerCase()),
  };
  if (file.binary) entry.binary = true;
  if (file.image) entry.isImage = true;
  if (file.stub !== undefined) entry.stub = file.stub;
  const notes = [file.note];
  if (item && file.content && !item.content) notes.push(NO_EXPAND);
  if (item && (file.svgOld || file.svgNew) && !item.svg) notes.push(NO_RENDER);
  const note = notes.filter((text) => text !== undefined).join(" ");
  if (note) entry.note = note;
  if (data !== undefined) entry.data = data;
  return entry;
}

function isImage(path: string): boolean {
  return IMAGES.has(extname(path).toLowerCase());
}

type ImageFields = Pick<
  FileData,
  "imgOld" | "imgNew" | "stubOld" | "stubNew" | "sizeOld" | "sizeNew"
>;

// Once MAX_IMAGE_BYTES is passed, every later side gets a stub, even one small enough to fit.
function fitImages(files: PageFile[]): {
  data: Map<PageFile, ImageFields>;
  images: Map<string, { bytes: Buffer; source: string }>;
} {
  const data = new Map<PageFile, ImageFields>();
  const images = new Map<string, { bytes: Buffer; source: string }>();
  let shown = 0;
  let total = 0;
  let full = false;
  for (const file of files) {
    if (!file.image) continue;
    const entry: ImageFields = {};
    let previewed = false;
    for (const [side, key] of [
      [file.image.old, "Old"],
      [file.image.new, "New"],
    ] as const) {
      if (!side) continue;
      if (side.width !== undefined && side.height !== undefined) {
        entry[`size${key}`] = [side.width, side.height];
      }
      let stub = side.stub;
      let path: string | undefined;
      if (stub === undefined && shown >= MAX_IMAGE_FILES) stub = OVER_IMAGE_FILES;
      if (stub === undefined && side.bytes && side.ext) {
        const hash = createHash("sha256").update(side.bytes).digest("hex").slice(0, 16);
        path = `img/${hash}.${side.ext}`;
        if (!images.has(path)) {
          if (full || total + side.bytes.length > MAX_IMAGE_BYTES) {
            full = true;
            stub = OVER_IMAGE_BYTES;
          } else {
            total += side.bytes.length;
            images.set(path, { bytes: side.bytes, source: file.path });
          }
        }
      }
      if (stub !== undefined || path === undefined) entry[`stub${key}`] = stub ?? NOT_IMAGE;
      else {
        entry[`img${key}`] = path;
        previewed = true;
      }
    }
    if (previewed) shown++;
    data.set(file, entry);
  }
  return { data, images };
}

export function planPublish(built: BuiltFile[], server: string[], out: string): PublishPlan {
  if (built.length > MAX_VERSION_FILES) {
    throw new BuildError(
      `The build has ${built.length} files, over the ${MAX_VERSION_FILES} an artifact version can hold`,
    );
  }
  const onServer = new Set(server);
  const paths = new Set(built.map((file) => file.path));
  const send = built.filter((file) => file.path === PAGE || !onServer.has(file.path));
  const keep = built.filter((file) => file.path !== PAGE && onServer.has(file.path));
  const remove = [...onServer].filter((path) => !paths.has(path));
  const sent = send.reduce((sum, file) => sum + file.bytes, 0);
  if (sent > MAX_SEND_BYTES) {
    throw new BuildError(
      `The publish sends ${kb(sent)}, over the ${kb(MAX_SEND_BYTES)} cap. Largest files: ${largest(send)}`,
    );
  }

  const pages = send.filter((file) => file.path === PAGE).map((file) => file.path);
  const steps: ({ send: string } | { remove: string })[] = [
    ...remove.map((path) => ({ remove: path })),
    ...send.filter((file) => file.path !== PAGE).map((file) => ({ send: file.path })),
  ];
  const size = MAX_PUBLISH_PATHS - pages.length;
  const publishes: PublishPlan["publishes"] = [];
  for (let i = 0; i < steps.length || i === 0; i += size) {
    const group = { send: [] as string[], remove: [] as string[] };
    for (const step of steps.slice(i, i + size)) {
      if ("send" in step) group.send.push(step.send);
      else group.remove.push(step.remove);
    }
    group.send.push(...pages);
    publishes.push(group);
  }

  const batches: PublishPlan["batches"] = [];
  let text: PublishPlan["batches"][number] | undefined;
  let images: PublishPlan["batches"][number] | undefined;
  for (const file of send) {
    if (isImage(file.path)) {
      if (!images || images.paths.length >= READER_IMAGES) {
        images = { kind: "image", paths: [], bytes: 0 };
        batches.push(images);
      }
      images.paths.push(file.path);
      images.bytes += file.bytes;
    } else {
      if (!text || (text.paths.length && text.bytes + file.bytes > READER_TEXT_BYTES)) {
        text = { kind: "text", paths: [], bytes: 0 };
        batches.push(text);
      }
      text.paths.push(file.path);
      text.bytes += file.bytes;
    }
  }

  return {
    out,
    send: send.map((file) => ({ path: file.path, source: file.source })),
    remove,
    keep: keep.map((file) => file.path),
    publishes,
    batches,
  };
}

// An image file with no previewed side gets no data file; its stubs go in its manifest entry.
export function renderBuild(
  template: string,
  data: PageData,
  server: string[],
  out: string,
): BuildOutput {
  const sized = new Map(fitData(data.files).map((item) => [item.file, item]));
  const fitted = fitImages(data.files);
  const dataFiles = new Map<string, { text: string; source: string }>();
  const files = data.files.map((file) => {
    const item = sized.get(file);
    const image = fitted.data.get(file);
    if (image && !image.imgOld && !image.imgNew) return Object.assign(manifestFile(file), image);
    if (!item && !image) return manifestFile(file);
    const data = image ? { path: file.path, hunks: [], ...image } : undefined;
    const text = `${layout(data ?? fileData(file, item!.content, item!.svg))}\n`;
    const path = `data/f-${createHash("sha256").update(text).digest("hex").slice(0, 16)}.json`;
    dataFiles.set(path, { text, source: file.path });
    return manifestFile(file, path, item);
  });
  const manifest: Manifest = { ...data, files };
  const html = renderPage(template, manifest);
  const output = new Map([[PAGE, html]]);
  const built: BuiltFile[] = [{ path: PAGE, source: null, bytes: Buffer.byteLength(html) }];
  for (const [path, { text, source }] of dataFiles) {
    output.set(path, text);
    built.push({ path, source, bytes: Buffer.byteLength(text) });
  }
  const images = new Map<string, Buffer>();
  for (const [path, { bytes, source }] of fitted.images) {
    images.set(path, bytes);
    built.push({ path, source, bytes: bytes.length });
  }
  return { manifest, files: output, images, publish: planPublish(built, server, out) };
}

export function writeBuild(output: BuildOutput): void {
  const out = output.publish.out;
  if (existsSync(out) && (!statSync(out).isDirectory() || readdirSync(out).length)) {
    throw new BuildError(`${out} already exists and is not an empty directory`);
  }
  for (const [path, text] of [...output.files, ...output.images]) {
    const full = join(out, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, text);
  }
  writeFileSync(join(out, "publish.json"), `${JSON.stringify(output.publish, null, 2)}\n`);
}

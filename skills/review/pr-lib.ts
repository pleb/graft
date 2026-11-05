import { win32 } from "node:path";
import { parseDiff } from "../diff/build-lib.ts";

export const MAX_OUTPUT = 512 * 1024 * 1024;
const MARKER_PREFIX = "<!-- graft-review:";
const MARKER = /[ \t]*<!-- graft-review: .*? -->/g;
const OID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

export const SEVERITIES = ["blocker", "major", "minor", "nit"] as const;
export const SOURCES = ["confirmed", "disputed", "one reviewer", "already-raised"] as const;

export type Severity = (typeof SEVERITIES)[number];
export type FindingSource = (typeof SOURCES)[number];

export interface PrRef {
  host: string;
  owner: string;
  repo: string;
  number: number;
}

export interface Finding {
  title: string;
  severity: Severity;
  source: FindingSource;
  file: string | null;
  line: number | null;
  impact: string;
  recommendation: string;
}

export interface PostInput {
  url: string;
  base: string;
  head: string;
  summary: string;
  findings: Finding[];
}

export interface PriorComment {
  path: string | null;
  line: number | null;
  author: string;
  body: string;
}

export interface InlineComment {
  path: string;
  line: number;
  body: string;
  finding: Finding;
}

export interface PostPlan {
  inline: InlineComment[];
  outside: Finding[];
  skipped: Finding[];
}

export class PrError extends Error {}

export function parsePrUrl(url: string): PrRef {
  const match =
    /^https?:\/\/([^/\s]+)\/([^/\s]+)\/([^/\s]+)\/pull\/([1-9][0-9]*)(?:[/?#]\S*)?$/.exec(url);
  if (!match) throw new PrError(`${url} is not a pull request URL`);
  return { host: match[1], owner: match[2], repo: match[3], number: Number(match[4]) };
}

export function repoSlug(ref: PrRef): string {
  return `${ref.host}/${ref.owner}/${ref.repo}`;
}

// A view argument: a PR number in the current repo, or a PR URL.
export function parseTarget(arg: string): number | PrRef {
  if (/^[1-9][0-9]*$/.test(arg)) return Number(arg);
  return parsePrUrl(arg);
}

function remoteRepo(url: string): { host: string; path: string; ssh: boolean } | null {
  let host: string;
  let path: string;
  let ssh: boolean;
  const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(url);
  if (scheme) {
    try {
      ({ hostname: host, pathname: path } = new URL(url));
    } catch {
      return null;
    }
    ssh = scheme[1].toLowerCase().split("+").includes("ssh");
  } else {
    // scp-like syntax: [user@]host:owner/repo
    const match = /^(?:[^@/]+@)?([^:/]+):(?!\/)(.+)$/.exec(url);
    if (!match) return null;
    [, host, path] = match;
    ssh = true;
  }
  path = path.replace(/^\/+|\/+$/g, "").replace(/\.git$/, "");
  return { host: host.toLowerCase(), path: path.toLowerCase(), ssh };
}

// GitHub serves SSH on port 443 at ssh.github.com.
function canonicalHost(host: string): string {
  const lower = host.toLowerCase();
  return lower === "ssh.github.com" ? "github.com" : lower;
}

// The first remote in `git remote -v` output whose fetch URL is the PR's host and repo.
// resolveHost maps an SSH host, such as an ~/.ssh/config alias, to its real hostname.
export function remoteFor(
  remotes: string,
  ref: PrRef,
  resolveHost: (host: string) => string = (host) => host,
): string | null {
  const host = canonicalHost(ref.host);
  const path = `${ref.owner}/${ref.repo}`.toLowerCase();
  for (const line of remotes.split("\n")) {
    const match = /^(\S+)\s+(\S+) \(fetch\)$/.exec(line);
    if (!match) continue;
    const repo = remoteRepo(match[2]);
    if (repo?.path !== path) continue;
    if (canonicalHost(repo.ssh ? resolveHost(repo.host) : repo.host) === host) return match[1];
  }
  return null;
}

export function worktreePaths(porcelain: string): string[] {
  return porcelain
    .split("\n")
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length));
}

// The new-file line numbers of each file's added and context lines, the lines GitHub accepts a RIGHT-side comment on.
export function commentableLines(diff: string): Map<string, Set<number>> {
  const lines = new Map<string, Set<number>>();
  for (const file of parseDiff(diff)) {
    for (const hunk of file.hunks) {
      for (const [type, , line] of hunk.lines) {
        if (type === "-" || line === null) continue;
        const numbers = lines.get(file.path) ?? new Set<number>();
        lines.set(file.path, numbers.add(line));
      }
    }
  }
  return lines;
}

export function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function findingMarker({ file, line, title }: Finding): string {
  return `${MARKER_PREFIX} ${file ?? "n/a"}:${line ?? "n/a"}#${slug(title)} -->`;
}

export function hasMarker(prior: PriorComment[], marker: string): boolean {
  return prior.some((comment) => comment.body.includes(marker));
}

export function stripMarkers(body: string): string {
  return body.replace(MARKER, "").trim();
}

function isPrior(value: unknown): value is PriorComment {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  return (
    (item.path === null || typeof item.path === "string") &&
    (item.line === null || typeof item.line === "number") &&
    typeof item.author === "string" &&
    typeof item.body === "string"
  );
}

// Parses gh's JSON-lines output of prior comments, one {path, line, author, body} object per line.
export function parsePrior(text: string): PriorComment[] {
  return text
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => {
      let value: unknown;
      try {
        value = JSON.parse(line);
      } catch {
        throw new PrError(`Unexpected prior comment from gh: ${line}`);
      }
      if (!isPrior(value)) throw new PrError(`Unexpected prior comment from gh: ${line}`);
      return value;
    });
}

// Prior comments as reviewers see them: markers stripped, and any left empty dropped.
export function withoutMarkers(prior: PriorComment[]): PriorComment[] {
  return prior
    .map((comment) => ({ ...comment, body: stripMarkers(comment.body) }))
    .filter((comment) => comment.body);
}

function text(value: unknown, name: string, allowEmpty = false): string {
  if (typeof value !== "string" || (!allowEmpty && !value.trim())) {
    throw new PrError(`Input "${name}" must be a ${allowEmpty ? "" : "non-empty "}string`);
  }
  return value;
}

function oneOf<T extends string>(value: unknown, options: readonly T[], name: string): T {
  if (!options.includes(value as T)) {
    throw new PrError(`Input "${name}" must be one of ${options.map((o) => `"${o}"`).join(", ")}`);
  }
  return value as T;
}

function finding(value: unknown, index: number): Finding {
  const name = `findings[${index}]`;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new PrError(`Input "${name}" must be an object`);
  }
  const item = value as Record<string, unknown>;
  const file = item.file ?? null;
  if (file !== null) {
    text(file, `${name}.file`);
    // win32 also counts "/x" and "\\x" as absolute, so this covers both platforms.
    if (win32.isAbsolute(file as string)) {
      throw new PrError(`Input "${name}.file" must be relative to the repo root, not ${file}`);
    }
  }
  const line = item.line ?? null;
  if (line !== null && (typeof line !== "number" || !Number.isInteger(line) || line < 1)) {
    throw new PrError(`Input "${name}.line" must be a positive integer or null`);
  }
  if (file === null && line !== null) throw new PrError(`Input "${name}" has a line but no file`);
  return {
    title: text(item.title, `${name}.title`),
    severity: oneOf(item.severity, SEVERITIES, `${name}.severity`),
    source: oneOf(item.source, SOURCES, `${name}.source`),
    file: file as string | null,
    line: line as number | null,
    impact: text(item.impact, `${name}.impact`, true),
    recommendation: text(item.recommendation, `${name}.recommendation`, true),
  };
}

export function parseInput(value: unknown): PostInput {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new PrError("Input must be a JSON object");
  }
  const input = value as Record<string, unknown>;
  const url = text(input.url, "url");
  parsePrUrl(url);
  for (const name of ["base", "head"]) {
    if (typeof input[name] !== "string" || !OID.test(input[name])) {
      throw new PrError(`Input "${name}" must be a full commit id`);
    }
  }
  if (!Array.isArray(input.findings)) throw new PrError('Input "findings" must be an array');
  return {
    url,
    base: input.base as string,
    head: input.head as string,
    summary: text(input.summary, "summary", true),
    findings: input.findings.map(finding),
  };
}

export function planPost(
  findings: Finding[],
  lines: Map<string, Set<number>>,
  prior: PriorComment[],
): PostPlan {
  const plan: PostPlan = { inline: [], outside: [], skipped: [] };
  for (const finding of findings) {
    const { file, line } = finding;
    if (finding.source === "already-raised" || hasMarker(prior, findingMarker(finding))) {
      plan.skipped.push(finding);
    } else if (file !== null && line !== null && lines.get(file)?.has(line)) {
      plan.inline.push({ path: file, line, body: commentBody(finding), finding });
    } else {
      plan.outside.push(finding);
    }
  }
  return plan;
}

function details(finding: Finding): string[] {
  return [
    ...(finding.impact.trim() ? [`Impact: ${finding.impact.trim()}`] : []),
    ...(finding.recommendation.trim() ? [`Recommendation: ${finding.recommendation.trim()}`] : []),
  ];
}

function label(finding: Finding): string {
  return `${finding.severity} (${finding.source})`;
}

export function commentBody(finding: Finding): string {
  return [
    `**${label(finding)}: ${finding.title}**`,
    ...details(finding),
    findingMarker(finding),
  ].join("\n\n");
}

function location({ file, line }: Finding): string {
  if (file === null) return "no location";
  return `\`${line === null ? file : `${file}:${line}`}\``;
}

function outsideEntry(finding: Finding): string {
  const lines = [
    `- **${label(finding)}** ${location(finding)}: ${finding.title}`,
    ...details(finding),
    findingMarker(finding),
  ];
  return lines.map((line, i) => (i ? `  ${line.replace(/\n/g, "\n  ")}` : line)).join("\n");
}

export function reviewBody(summary: string, outside: Finding[]): string {
  const sections = ["## Graft review", ...(summary.trim() ? [summary.trim()] : [])];
  if (outside.length) {
    sections.push(`### Findings outside the diff\n\n${outside.map(outsideEntry).join("\n")}`);
  }
  return sections.join("\n\n");
}

import type { Dirent } from "node:fs";
import {
  createReadStream,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";

const MIN_NODE_MAJOR = 24;
const TEXT_LIMIT = 1500;
const CONTEXT_LIMIT = 600;
const INPUT_VALUE_LIMIT = 200;
const SKILLS = new Set(["/graft:plan", "/graft:orchestrate"]);
export const KINDS = ["answer", "message", "rejection", "interrupt"] as const;
const FILE_TOOLS = new Set(["Write", "Edit", "MultiEdit", "Read"]);
const INTERRUPTS = new Set([
  "[Request interrupted by user]",
  "[Request interrupted by user for tool use]",
]);
const PLAN_FILE = /\/\.claude\/plans\/[^/]+\.md$/;
const PLAN_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const BASH_PLAN = /(?:[\w.~@+-]*\/)*\.claude\/plans\/[\w@+-][\w.@+-]*\.md(?![\w.@+-])/g;
// A plan path after any other character is the tail of a word such as `$root/.claude/plans/x.md`.
const WORD_START = /[\s'"`=:;|&<>(]/;
const LEADING_IDE = /^\s*<(ide_\w+)>(?:(?!<\/?ide_)[\s\S])*<\/\1>/;
const TRAILING_IDE = /<(ide_\w+)>(?:(?!<\/?ide_)[\s\S])*<\/\1>\s*$/;
// Written by the "chat about this" choice on AskUserQuestion; not typed by the user.
const CLARIFY_FEEDBACK = "The user wants to clarify these questions.";
const CLARIFY_QUESTIONS = "Questions asked:";
const FEEDBACK_MARKER = "the user said:\n";
const RUN_PREFIX = "graft-tune-";
const CANDIDATES_FILE = "candidates.json";
const roots = new Map<string, string>();

export type Kind = (typeof KINDS)[number];

// Transcript lines are untrusted JSON, so every field is optional and typed only as far as the code checks it.
interface Block {
  type?: unknown;
  text?: unknown;
  id?: unknown;
  name?: unknown;
  input?: ToolInput | null;
  tool_use_id?: unknown;
  is_error?: unknown;
  content?: unknown;
}

interface ToolInput {
  questions?: unknown;
  subagent_type?: unknown;
  description?: unknown;
  file_path?: unknown;
  command?: unknown;
}

interface Question {
  question?: unknown;
  options?: unknown;
  multiSelect?: unknown;
}

export interface AskResult {
  questions?: unknown;
  answers?: Record<string, unknown> | null;
  annotations?: Record<string, { notes?: unknown } | null> | null;
}

interface Origin {
  kind?: unknown;
}

interface Attachment {
  type?: unknown;
  origin?: Origin | null;
  commandMode?: unknown;
  prompt?: unknown;
  timestamp?: unknown;
}

export interface Line {
  type?: unknown;
  uuid?: unknown;
  timestamp?: unknown;
  version?: unknown;
  cwd?: unknown;
  gitBranch?: unknown;
  isSidechain?: unknown;
  isMeta?: unknown;
  isCompactSummary?: unknown;
  origin?: Origin | null;
  message?: { content?: unknown } | null;
  toolUseResult?: AskResult | null;
  toolDenialKind?: unknown;
  userFeedback?: unknown;
  attachment?: Attachment | null;
}

type Findable = { find?: (predicate: (block: Block) => boolean) => Block | undefined } | null;

export interface TranscriptFile {
  path: string;
  sessionId: string;
  bornMs: number;
}

interface Stats {
  filesSkipped: number;
  userLines: number;
  humanUserLines: number;
  askResults: number;
  askResultsParsed: number;
  askResultsLabelled: number;
  minVersion?: string;
  maxVersion?: string;
}

interface PlanFile {
  path: string;
  actions: string[];
}

interface Agent {
  subagentType: unknown;
  description: unknown;
  skill?: string | null;
  time: unknown;
}

export interface Run {
  id: string;
  sessionId: string;
  commandUuid: string | null;
  cwd: string | null;
  gitBranch: unknown;
  skill: string;
  args: string;
  startTime: unknown;
  endTime: unknown;
  agents: Agent[];
  planFiles: PlanFile[];
  copyOf?: string;
}

interface QuestionContext {
  question: string;
  options: string[] | null;
  selected?: string[];
}

export interface Correction {
  source: "other" | "note";
  question: string;
  text: string;
  context: QuestionContext;
}

export interface Candidate {
  kind: Kind;
  source?: string;
  sessionId: string;
  run: string;
  skill?: string | null;
  skillTime?: unknown;
  time: unknown;
  uuid: unknown;
  text: string | null;
  queued?: true;
  context: object;
  interrupted?: boolean;
}

interface CandidateEntry {
  candidate: Candidate;
  question: string;
  runStart: unknown;
  bornMs: number;
}

interface Tool {
  name: unknown;
  input: string | null;
  questions?: unknown;
}

export interface Summary {
  filesRead: number;
  filesSkipped: number;
  runs: number;
  sessions: number;
  forkCopies: number;
  candidates: Record<Kind, number>;
  versions: { min: string | null; max: string | null };
  warnings: string[];
}

export interface Report {
  generatedAt: string;
  days: number;
  cutoff: string;
  projectsDir: string;
  summary: Summary;
  runs: Run[];
  candidates: Candidate[];
}

export interface CleanResult {
  dir: string;
  removed: boolean;
}

export class PartialRemovalError extends Error {}

export function isSupportedNode(version: string): boolean {
  return Number(version.split(".")[0]) >= MIN_NODE_MAJOR;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function cleanRunDir(path: string): CleanResult {
  if (path.split(/[\\/]/).includes("..")) throw new Error(`${path} has a .. segment`);
  const given = resolve(path);
  const named = basename(given) === CANDIDATES_FILE ? dirname(given) : given;
  let stat;
  try {
    stat = lstatSync(named);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
  if (stat?.isSymbolicLink()) throw new Error(`${named} is a symlink`);
  if (stat && !stat.isDirectory()) throw new Error(`${named} is not a directory`);
  const dir = join(realpathSync(dirname(named)), basename(named));
  const temp = realpathSync(tmpdir());
  if (dirname(dir) !== temp) throw new Error(`${dir} is not directly in ${temp}`);
  if (!basename(dir).startsWith(RUN_PREFIX)) {
    throw new Error(`${dir} does not start with ${RUN_PREFIX}`);
  }
  if (!stat) return { dir, removed: false };
  const entries = readdirSync(dir, { withFileTypes: true });
  const other = entries.find((entry) => entry.name !== CANDIDATES_FILE || !entry.isFile());
  if (other)
    throw new Error(`${dir} holds ${other.name}, which is not a regular ${CANDIDATES_FILE} file`);
  if (entries.length) rmSync(join(dir, CANDIDATES_FILE));
  try {
    rmdirSync(dir);
  } catch (error) {
    if (!entries.length) throw error;
    throw new PartialRemovalError(`Removed ${CANDIDATES_FILE} but not ${dir}: ${messageOf(error)}`);
  }
  return { dir, removed: true };
}

export function projectsDir(): string {
  const configDir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
  return join(configDir, "projects");
}

export function listFiles(
  dir: string,
  cutoffMs: number,
): { files: TranscriptFile[]; skipped: number } {
  const files: TranscriptFile[] = [];
  let skipped = 0;
  for (const project of safeReaddir(dir)) {
    if (!project.isDirectory()) continue;
    const projectDir = join(dir, project.name);
    for (const entry of safeReaddir(projectDir)) {
      if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
      const path = join(projectDir, entry.name);
      let stat;
      try {
        stat = statSync(path);
      } catch {
        skipped++;
        continue;
      }
      if (stat.mtimeMs < cutoffMs) continue;
      files.push({
        path,
        sessionId: basename(entry.name, ".jsonl"),
        bornMs: stat.birthtimeMs || stat.mtimeMs,
      });
    }
  }
  return { files, skipped };
}

function safeReaddir(dir: string): Dirent[] {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function truncate(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

function truncateStart(text: string, limit: number): string {
  return text.length > limit ? `...${text.slice(-limit)}` : text;
}

export function stripIde(text: string): string {
  let rest = text;
  for (let previous; rest !== previous;) {
    previous = rest;
    rest = rest.replace(LEADING_IDE, "").replace(TRAILING_IDE, "");
  }
  return rest.trim();
}

function textOf(content: unknown): string {
  if (typeof content === "string") return stripIde(content);
  if (!Array.isArray(content)) return "";
  return content
    .map((block: Block | null | undefined) =>
      block?.type === "text" && typeof block.text === "string"
        ? stripIde(block.text)
        : block?.type === "image"
          ? "[image]"
          : "",
    )
    .filter(Boolean)
    .join("\n")
    .trim();
}

function shortInput(input: unknown): string | null {
  if (!input || typeof input !== "object")
    return input == null ? null : truncate(String(input), CONTEXT_LIMIT);
  const short = Object.fromEntries(
    Object.entries(input).map(([key, value]: [string, unknown]) => [
      key,
      typeof value === "string" ? truncate(value, INPUT_VALUE_LIMIT) : value,
    ]),
  );
  return truncate(JSON.stringify(short), CONTEXT_LIMIT);
}

export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff) return diff;
  }
  return 0;
}

function noteVersion(stats: Stats, version: unknown): void {
  if (typeof version !== "string") return;
  if (!stats.minVersion || compareVersions(version, stats.minVersion) < 0)
    stats.minVersion = version;
  if (!stats.maxVersion || compareVersions(version, stats.maxVersion) > 0)
    stats.maxVersion = version;
}

function repoRoot(cwd: string | null): string | null {
  if (!cwd) return null;
  let root = roots.get(cwd);
  if (root === undefined) {
    root = cwd;
    for (let dir = resolve(cwd); existsSync(dir); dir = dirname(dir)) {
      if (existsSync(join(dir, ".git"))) {
        root = dir;
        break;
      }
      if (dirname(dir) === dir) break;
    }
    roots.set(cwd, root);
  }
  return root;
}

function expandHome(path: string): string {
  return path.replace(/^~(?=\/)/, homedir());
}

export function planFromArgs(
  args: string,
  root: string | null,
  recorded: Set<string>,
): string | null | undefined {
  if (!root) return null;
  const candidates: { path: string; fallback: boolean }[] = [];
  for (const [index, word] of args.split(/\s+/).entries()) {
    const token = word
      .replace(/^["'`(]+/, "")
      .replace(/^@/, "")
      .replace(/[)"'`.,;:!?]+$/, "");
    const first = index === 0;
    if (token.includes("/")) {
      if (token.endsWith(".md"))
        candidates.push({ path: resolve(root, expandHome(token)), fallback: first });
      continue;
    }
    const name = token.replace(/\.md$/, "");
    if (!PLAN_NAME.test(name)) continue;
    candidates.push({
      path: join(root, ".claude", "plans", `${name}.md`),
      fallback: first && (name.includes("-") || token.endsWith(".md")),
    });
  }
  return (
    candidates.find(({ path }) => existsSync(path)) ??
    candidates.find(({ path }) => recorded.has(path)) ??
    candidates.find(({ fallback }) => fallback)
  )?.path;
}

export function bashPlanPaths(command: string, root: string | null): string[] {
  return [...command.matchAll(BASH_PLAN)].map((match) => {
    const before = command[match.index - 1];
    const whole = before === undefined || WORD_START.test(before);
    const path =
      whole && !match[0].startsWith("/.claude/")
        ? match[0]
        : match[0].slice(match[0].indexOf(".claude/plans/"));
    return resolve(root ?? "/", expandHome(path));
  });
}

function addPlanFile(run: Run, path: string | null | undefined, action: string): void {
  if (!path) return;
  let entry = run.planFiles.find((plan) => plan.path === path);
  if (!entry) {
    entry = { path, actions: [] };
    run.planFiles.push(entry);
  }
  if (!entry.actions.includes(action)) entry.actions.push(action);
}

// Claude Code joins multi-select elements with ", " and JSON-quotes each one holding ", " or '"'.
function answerElements(answer: string): string[] {
  const elements: string[] = [];
  let at = 0;
  while (at <= answer.length) {
    let end = -1;
    if (answer[at] === '"') {
      for (let i = at + 1; i < answer.length; i++) {
        if (answer[i] === "\\") i++;
        else if (answer[i] === '"') {
          end = i + 1;
          break;
        }
      }
      if (end > 0 && end < answer.length && !answer.startsWith(", ", end)) end = -1;
    }
    if (end < 0) {
      end = answer.indexOf(", ", at);
      if (end < 0) end = answer.length;
    }
    const raw = answer.slice(at, end);
    let element = raw;
    if (raw.length > 1 && raw.startsWith('"') && raw.endsWith('"')) {
      try {
        element = JSON.parse(raw);
      } catch {}
    }
    elements.push(element);
    at = end + 2;
  }
  return elements;
}

function splitAnswer(
  answer: string,
  labels: string[],
  multiSelect: boolean,
): { selected: string[]; freeText: string } {
  if (labels.includes(answer)) return { selected: [answer], freeText: "" };
  if (!multiSelect) return { selected: [], freeText: answer.trim() };
  const elements = answerElements(answer);
  const selected = elements.filter((element) => labels.includes(element));
  const prefixed = prefixSplit(answer, labels);
  if (prefixed.selected.length > selected.length) return prefixed;
  const freeText = elements
    .filter((element) => !labels.includes(element))
    .join(", ")
    .trim();
  return { selected, freeText };
}

function prefixSplit(answer: string, labels: string[]): { selected: string[]; freeText: string } {
  const selected: string[] = [];
  let rest = answer;
  for (;;) {
    const label = labels
      .filter((candidate) => rest === candidate || rest.startsWith(`${candidate}, `))
      .sort((a, b) => b.length - a.length)[0];
    if (!label) break;
    selected.push(label);
    rest = rest.slice(label.length).replace(/^, /, "");
  }
  return { selected, freeText: unquote(rest.trim()) };
}

function unquote(text: string): string {
  return text.length > 1 && text.startsWith('"') && text.endsWith('"')
    ? text.slice(1, -1).trim()
    : text;
}

function optionLabels(question: Question | null | undefined): string[] {
  return (Array.isArray(question?.options) ? question.options : [])
    .map((option: { label?: unknown } | null | undefined) => option?.label)
    .filter((label): label is string => typeof label === "string");
}

function questionCorrections(
  text: string,
  labels: string[] | null,
  multiSelect: boolean,
  answer: unknown,
  note: unknown,
): Correction[] {
  const corrections: Correction[] = [];
  const context: QuestionContext = { question: truncate(text, CONTEXT_LIMIT), options: labels };
  if (typeof answer === "string") {
    const { selected, freeText } = labels
      ? splitAnswer(answer, labels, multiSelect)
      : { selected: [], freeText: answer.trim() };
    context.selected = selected;
    if (freeText && labels?.length !== 0)
      corrections.push({ source: "other", question: text, text: freeText, context });
  }
  if (typeof note === "string" && note.trim()) {
    corrections.push({ source: "note", question: text, text: note.trim(), context });
  }
  return corrections;
}

export function answerCorrections(result: AskResult | null | undefined): Correction[] {
  if (!Array.isArray(result?.questions)) return [];
  return result.questions.flatMap((question: Question | null | undefined) => {
    if (typeof question?.question !== "string") return [];
    const text = question.question;
    return questionCorrections(
      text,
      optionLabels(question),
      question.multiSelect === true,
      result.answers?.[text],
      result.annotations?.[text]?.notes,
    );
  });
}

function hasParsedAnswers(result: AskResult | null | undefined): boolean {
  if (!Array.isArray(result?.questions)) return false;
  return result.questions.some(
    (question: Question | null | undefined) =>
      typeof question?.question === "string" &&
      (typeof result.answers?.[question.question] === "string" ||
        typeof result.annotations?.[question.question]?.notes === "string"),
  );
}

function hasLabels(result: AskResult | null | undefined): boolean {
  return (Array.isArray(result?.questions) ? result.questions : []).some(
    (question: Question | null | undefined) => optionLabels(question).length > 0,
  );
}

export function clarifyCorrections(feedback: string, questions: unknown): Correction[] {
  const answers: Record<string, string> = {};
  const notes: Record<string, string> = {};
  let question: string | null = null;
  let field: Record<string, string> | null = null;
  const at = feedback.indexOf(CLARIFY_QUESTIONS);
  if (at < 0) return [];
  const asked = (Array.isArray(questions) ? questions : []).filter(
    (candidate: Question | null | undefined): candidate is Question & { question: string } =>
      typeof candidate?.question === "string",
  );
  const lines = feedback.slice(at + CLARIFY_QUESTIONS.length).split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const known = asked
      .map(({ question: text }) => text)
      .filter((text) => lines.slice(i, i + text.split("\n").length).join("\n") === `- "${text}"`)
      .sort((a, b) => b.length - a.length)[0];
    const header = known ?? line.match(/^- "(.*)"$/)?.[1];
    if (header !== undefined) {
      question = header;
      field = null;
      i += header.split("\n").length - 1;
      continue;
    }
    // The `question != null` checks only narrow the type; `field` and `value` are set only once `question` is.
    const value = question == null ? null : line.match(/^ {2}(Answer|User notes): (.*)$/);
    if (value && question != null) {
      field = value[1] === "Answer" ? answers : notes;
      field[question] = value[2];
    } else if (field && question != null) field[question] += `\n${line}`;
  }
  return [...new Set([...Object.keys(answers), ...Object.keys(notes)])].flatMap((text) => {
    const input = asked.find((candidate) => candidate.question === text);
    return questionCorrections(
      text,
      input ? optionLabels(input) : null,
      input?.multiSelect === true,
      answers[text]?.trim(),
      notes[text],
    );
  });
}

function rejectionFeedback(line: Line): string {
  let feedback = typeof line.userFeedback === "string" ? line.userFeedback : null;
  if (feedback == null) {
    // The cast is unchecked: `content` may be any JSON value, and `?.find?.` reads only one with a `find` method.
    const content = (line.message?.content as Findable | undefined)?.find?.(
      (block) => block?.type === "tool_result",
    )?.content;
    const text = textOf(content);
    const at = text.indexOf(FEEDBACK_MARKER);
    if (at >= 0) feedback = text.slice(at + FEEDBACK_MARKER.length);
  }
  return feedback?.trim() ?? "";
}

function rejectionReason(feedback: string): string | null {
  return feedback && !feedback.startsWith(CLARIFY_FEEDBACK) ? truncate(feedback, TEXT_LIMIT) : null;
}

function isInterrupt(content: unknown): content is [{ type: "text"; text: string }] {
  return (
    Array.isArray(content) &&
    content.length === 1 &&
    content[0]?.type === "text" &&
    typeof content[0].text === "string" &&
    INTERRUPTS.has(content[0].text.trim())
  );
}

export function isQueuedCommand(text: string): boolean {
  const [first, ...rest] = text.split(/\s+/);
  const command = first.match(/^\/[\w-]+(:[\w-]+)?$/);
  return !!command && (rest.length === 0 || !!command[1]);
}

export function isTypedMessage(line: Line): boolean {
  if (line.origin?.kind !== "human" || line.isMeta || line.isCompactSummary) return false;
  if (line.toolUseResult !== undefined) return false;
  const content = line.message?.content;
  if (typeof content === "string") return !content.trimStart().startsWith("<command-name>");
  return (
    Array.isArray(content) &&
    content.every(
      (block: Block | null | undefined) => block?.type === "text" || block?.type === "image",
    )
  );
}

class FileReader {
  file: TranscriptFile;
  cutoffMs: number;
  stats: Stats;
  seen: Set<string>;
  tools: Map<unknown, Tool>;
  run: Run | null;
  skill: string | null;
  skillTime: unknown;
  runs: Run[];
  candidates: CandidateEntry[];
  lastAssistantText: string;
  lastRejection: { interrupted?: boolean } | null;

  constructor(file: TranscriptFile, cutoffMs: number, stats: Stats) {
    this.file = file;
    this.cutoffMs = cutoffMs;
    this.stats = stats;
    this.seen = new Set();
    this.tools = new Map();
    this.run = null;
    this.skill = null;
    this.skillTime = null;
    this.runs = [];
    this.candidates = [];
    this.lastAssistantText = "";
    this.lastRejection = null;
  }

  handle(line: Line): void {
    noteVersion(this.stats, line.version);
    if (typeof line.uuid === "string") {
      if (this.seen.has(line.uuid)) return;
      this.seen.add(line.uuid);
    }
    if (line.isSidechain) return;
    if (line.type === "assistant") this.handleAssistant(line);
    else if (line.type === "user") this.handleUser(line);
    else if (line.type === "attachment") this.handleAttachment(line);
    if (this.run && typeof line.timestamp === "string") this.run.endTime = line.timestamp;
  }

  handleAssistant(line: Line): void {
    this.lastRejection = null;
    const blocks: (Block | null | undefined)[] = Array.isArray(line.message?.content)
      ? line.message.content
      : [];
    for (const block of blocks) {
      if (block?.type === "text" && typeof block.text === "string" && block.text.trim())
        this.lastAssistantText = block.text.trim();
      if (block?.type === "tool_use") this.handleToolUse(line, block);
    }
  }

  handleToolUse(line: Line, block: Block): void {
    const input = block.input ?? {};
    this.tools.set(block.id, {
      name: block.name,
      input: shortInput(block.input),
      ...(block.name === "AskUserQuestion" && { questions: input.questions }),
    });
    const run = this.run;
    if (!run) return;
    // A run stays open across other skills' commands; plan files they touch are not this run's.
    const own = this.skill === run.skill;
    if (block.name === "Agent") {
      run.agents.push({
        subagentType: input.subagent_type ?? null,
        description: input.description ?? null,
        ...(!own && { skill: this.skill }),
        time: line.timestamp ?? null,
      });
    }
    if (!own) return;
    const root = repoRoot(run.cwd);
    if (
      typeof block.name === "string" &&
      FILE_TOOLS.has(block.name) &&
      typeof input.file_path === "string"
    ) {
      const path = resolve(root ?? "/", input.file_path);
      if (PLAN_FILE.test(path)) addPlanFile(run, path, block.name.toLowerCase());
    }
    if (block.name === "Bash" && typeof input.command === "string") {
      for (const path of bashPlanPaths(input.command, root)) addPlanFile(run, path, "read");
    }
  }

  handleUser(line: Line): void {
    this.stats.userLines++;
    if (line.origin?.kind === "human") this.stats.humanUserLines++;
    const content = line.message?.content;
    const afterRejection = this.lastRejection;
    this.lastRejection = null;

    if (typeof content === "string" && content.startsWith("<command-message>")) {
      this.handleCommand(line, content);
      return;
    }
    if (line.toolDenialKind === "user-rejected") {
      this.lastRejection = this.addRejection(line, content) ?? {};
      return;
    }
    if (isInterrupt(content)) {
      if (afterRejection) afterRejection.interrupted = true;
      else this.addCandidate(line, "interrupt", { text: content[0].text.trim() });
      return;
    }
    if (this.isAskResult(line, content)) {
      this.stats.askResults++;
      if (hasParsedAnswers(line.toolUseResult)) {
        this.stats.askResultsParsed++;
        if (hasLabels(line.toolUseResult)) this.stats.askResultsLabelled++;
      }
      for (const { source, question, text, context } of answerCorrections(line.toolUseResult)) {
        this.addCandidate(line, "answer", { source, question, text, context });
      }
      return;
    }
    const text = isTypedMessage(line) ? textOf(content) : "";
    if (text) this.addCandidate(line, "message", { text });
  }

  handleAttachment(line: Line): void {
    const attachment = line.attachment;
    if (attachment?.type !== "queued_command" || attachment.origin?.kind !== "human") return;
    if (attachment.commandMode && attachment.commandMode !== "prompt") return;
    const text = textOf(attachment.prompt);
    if (!text || isQueuedCommand(text)) return;
    const timestamp = line.timestamp ?? attachment.timestamp;
    this.addCandidate({ ...line, timestamp }, "message", { text, queued: true });
  }

  handleCommand(line: Line, content: string): void {
    if (line.origin?.kind !== "human") return;
    const skill = content.match(/<command-name>([^<]*)<\/command-name>/)?.[1]?.trim();
    if (skill) {
      this.skill = skill;
      this.skillTime = line.timestamp ?? null;
    }
    if (skill === undefined || !SKILLS.has(skill)) return;
    const args = content.match(/<command-args>([\s\S]*?)<\/command-args>/)?.[1]?.trim() ?? "";
    const run: Run = {
      id: `${this.file.sessionId}#${this.runs.length + 1}`,
      sessionId: this.file.sessionId,
      commandUuid: typeof line.uuid === "string" ? line.uuid : null,
      cwd: typeof line.cwd === "string" ? line.cwd : null,
      gitBranch: line.gitBranch ?? null,
      skill,
      args,
      startTime: line.timestamp ?? null,
      endTime: line.timestamp ?? null,
      agents: [],
      planFiles: [],
    };
    if (skill === "/graft:orchestrate") {
      const recorded = new Set(
        this.runs.flatMap(({ planFiles }) => planFiles.map(({ path }) => path)),
      );
      addPlanFile(run, planFromArgs(args, repoRoot(run.cwd), recorded), "argument");
    }
    this.run = run;
    this.runs.push(run);
  }

  isAskResult(line: Line, content: unknown): boolean {
    if (line.toolUseResult?.questions) return true;
    const block: Block | null | undefined = Array.isArray(content)
      ? content.find((item: Block | null | undefined) => item?.type === "tool_result")
      : null;
    return (
      !!block && !block.is_error && this.tools.get(block.tool_use_id)?.name === "AskUserQuestion"
    );
  }

  addRejection(line: Line, content: unknown): Candidate | null {
    const block: Block | null | undefined = Array.isArray(content)
      ? content.find((item: Block | null | undefined) => item?.type === "tool_result")
      : null;
    const tool = this.tools.get(block?.tool_use_id);
    const feedback = rejectionFeedback(line);
    const rejection = this.addCandidate(line, "rejection", {
      text: rejectionReason(feedback),
      context: { tool: tool?.name ?? null, toolInput: tool?.input ?? null },
    });
    if (feedback.startsWith(CLARIFY_FEEDBACK)) {
      for (const { source, question, text, context } of clarifyCorrections(
        feedback,
        tool?.questions,
      )) {
        this.addCandidate(line, "answer", { source, question, text, context });
      }
    }
    return rejection;
  }

  addCandidate(
    line: Line,
    kind: Kind,
    {
      source,
      question,
      text,
      context = {},
      queued,
    }: {
      source?: string;
      question?: string;
      text?: string | null;
      context?: object;
      queued?: boolean;
    },
  ): Candidate | null {
    const run = this.run;
    if (!run || Date.parse(String(line.timestamp)) < this.cutoffMs) return null;
    const candidate: Candidate = {
      kind,
      ...(source && { source }),
      sessionId: run.sessionId,
      run: run.id,
      ...(this.skill !== run.skill && { skill: this.skill, skillTime: this.skillTime }),
      time: line.timestamp ?? null,
      uuid: line.uuid ?? null,
      text: text == null ? null : truncate(text, TEXT_LIMIT),
      ...(queued && { queued: true }),
      context: {
        ...context,
        lastAssistantText: truncateStart(this.lastAssistantText, CONTEXT_LIMIT) || null,
      },
    };
    this.candidates.push({
      candidate,
      question: question ?? "",
      runStart: run.startTime,
      bornMs: this.file.bornMs,
    });
    return candidate;
  }
}

async function readFile(
  file: TranscriptFile,
  cutoffMs: number,
  stats: Stats,
): Promise<FileReader | null> {
  const reader = new FileReader(file, cutoffMs, stats);
  const lines = createInterface({ input: createReadStream(file.path), crlfDelay: Infinity });
  try {
    for await (const text of lines) {
      let line: unknown;
      try {
        line = JSON.parse(text);
      } catch {
        continue;
      }
      if (line && typeof line === "object") reader.handle(line);
    }
  } catch {
    return null;
  }
  return reader;
}

function isEarlier(a: CandidateEntry, b: CandidateEntry): boolean {
  const keys = [
    [a.runStart, b.runStart],
    [a.candidate.time, b.candidate.time],
  ];
  for (const [x, y] of keys) {
    const diff = (Date.parse(String(x)) || 0) - (Date.parse(String(y)) || 0);
    if (diff) return diff < 0;
  }
  return a.bornMs < b.bornMs;
}

function dedupe(entries: CandidateEntry[]): Candidate[] {
  const kept = new Map<string | symbol, CandidateEntry>();
  for (const entry of entries) {
    const { kind, source, uuid } = entry.candidate;
    if (!uuid) {
      kept.set(Symbol(), entry);
      continue;
    }
    const key = JSON.stringify([uuid, entry.question, kind, source ?? null]);
    const existing = kept.get(key);
    if (!existing || isEarlier(entry, existing)) kept.set(key, entry);
  }
  return [...kept.values()].map((entry) => entry.candidate);
}

function byTime(a: unknown, b: unknown): number {
  return (Date.parse(String(a)) || 0) - (Date.parse(String(b)) || 0);
}

function markCopies(found: { run: Run; bornMs: number }[]): void {
  const originals = new Map<string, Run>();
  const ordered = [...found].sort(
    (a, b) => byTime(a.run.startTime, b.run.startTime) || a.bornMs - b.bornMs,
  );
  for (const { run } of ordered) {
    if (!run.commandUuid) continue;
    const original = originals.get(run.commandUuid);
    if (original) run.copyOf = original.id;
    else originals.set(run.commandUuid, run);
  }
}

export function formatWarnings(stats: {
  userLines: number;
  humanUserLines: number;
  askResults: number;
  askResultsParsed: number;
  askResultsLabelled: number;
}): string[] {
  const warnings: string[] = [];
  if (stats.askResults > 0 && stats.askResultsParsed === 0) {
    warnings.push(
      `${stats.askResults} AskUserQuestion results were read but no answer parsed; the transcript format may have changed.`,
    );
  }
  if (stats.askResultsParsed > 0 && stats.askResultsLabelled === 0) {
    warnings.push(
      `${stats.askResultsParsed} AskUserQuestion results had answers but no option labels; the transcript format may have changed.`,
    );
  }
  if (stats.userLines > 0 && stats.humanUserLines === 0) {
    warnings.push(
      "No user line has a human origin, so typed messages cannot be told apart; the transcript format may have changed.",
    );
  }
  return warnings;
}

export async function buildReport(
  files: TranscriptFile[],
  options: { days: number; cutoffMs: number; projectsDir: string; filesSkipped: number },
): Promise<Report> {
  const { days, cutoffMs } = options;
  const stats: Stats = {
    filesSkipped: options.filesSkipped,
    userLines: 0,
    humanUserLines: 0,
    askResults: 0,
    askResultsParsed: 0,
    askResultsLabelled: 0,
  };

  const found: { run: Run; bornMs: number }[] = [];
  const entries: CandidateEntry[] = [];
  let filesRead = 0;
  for (const file of files) {
    const reader = await readFile(file, cutoffMs, stats);
    if (!reader) {
      stats.filesSkipped++;
      continue;
    }
    filesRead++;
    for (const run of reader.runs) {
      if (Date.parse(String(run.endTime)) < cutoffMs) continue;
      found.push({ run, bornMs: file.bornMs });
    }
    entries.push(...reader.candidates);
  }
  markCopies(found);
  const runs = found.map(({ run }) => run).sort((a, b) => byTime(a.startTime, b.startTime));
  const candidates = dedupe(entries).sort((a, b) => byTime(a.time, b.time));

  const counts = Object.fromEntries(KINDS.map((kind) => [kind, 0])) as Record<Kind, number>;
  for (const candidate of candidates) counts[candidate.kind]++;
  const originals = runs.filter((run) => !run.copyOf);
  const summary: Summary = {
    filesRead,
    filesSkipped: stats.filesSkipped,
    runs: originals.length,
    sessions: new Set(originals.map((run) => run.sessionId)).size,
    forkCopies: runs.length - originals.length,
    candidates: counts,
    versions: { min: stats.minVersion ?? null, max: stats.maxVersion ?? null },
    warnings: formatWarnings(stats),
  };

  return {
    generatedAt: new Date().toISOString(),
    days,
    cutoff: new Date(cutoffMs).toISOString(),
    projectsDir: options.projectsDir,
    summary,
    runs,
    candidates,
  };
}

export function writeReport(report: Report, out: string | undefined): string {
  const path = outputPath(out);
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);
  return path;
}

function outputPath(out: string | undefined): string {
  if (out) {
    const path = resolve(out);
    mkdirSync(dirname(path), { recursive: true });
    return path;
  }
  return join(mkdtempSync(join(tmpdir(), RUN_PREFIX)), CANDIDATES_FILE);
}

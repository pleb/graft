import {
  createReadStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { parseArgs } from "node:util";

const TEXT_LIMIT = 1500;
const CONTEXT_LIMIT = 600;
const INPUT_VALUE_LIMIT = 200;
const SKILLS = new Set(["/graft:plan", "/graft:orchestrate"]);
const KINDS = ["answer", "message", "rejection", "interrupt"];
const FILE_TOOLS = new Set(["Write", "Edit", "MultiEdit", "Read"]);
const INTERRUPTS = new Set([
  "[Request interrupted by user]",
  "[Request interrupted by user for tool use]",
]);
const PLAN_FILE = /\/\.claude\/plans\/[^/]+\.md$/;
const PLAN_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
// Written by the "chat about this" choice on AskUserQuestion; not typed by the user.
const CLARIFY_FEEDBACK = "The user wants to clarify these questions.";
const FEEDBACK_MARKER = "the user said:\n";

function parseCli() {
  const { values } = parseArgs({ options: { days: { type: "string" }, out: { type: "string" } } });
  const days = Number(values.days);
  if (!values.days || !Number.isFinite(days) || days <= 0) {
    console.error("Usage: node extract.mjs --days <n> [--out <file>]");
    process.exit(1);
  }
  return { days, out: values.out };
}

function projectsDir() {
  const configDir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
  return join(configDir, "projects");
}

function listFiles(dir, cutoffMs) {
  const files = [];
  for (const project of safeReaddir(dir)) {
    if (!project.isDirectory()) continue;
    const projectDir = join(dir, project.name);
    for (const entry of safeReaddir(projectDir)) {
      if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
      const path = join(projectDir, entry.name);
      const stat = statSync(path);
      if (stat.mtimeMs < cutoffMs) continue;
      files.push({
        path,
        sessionId: basename(entry.name, ".jsonl"),
        bornMs: stat.birthtimeMs || stat.mtimeMs,
      });
    }
  }
  return files;
}

function safeReaddir(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function truncate(text, limit) {
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

function truncateStart(text, limit) {
  return text.length > limit ? `...${text.slice(-limit)}` : text;
}

function textOf(content) {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .map((block) =>
      block?.type === "text" ? block.text : block?.type === "image" ? "[image]" : "",
    )
    .filter(Boolean)
    .join("\n")
    .trim();
}

function shortInput(input) {
  if (!input || typeof input !== "object")
    return input == null ? null : truncate(String(input), CONTEXT_LIMIT);
  const short = Object.fromEntries(
    Object.entries(input).map(([key, value]) => [
      key,
      typeof value === "string" ? truncate(value, INPUT_VALUE_LIMIT) : value,
    ]),
  );
  return truncate(JSON.stringify(short), CONTEXT_LIMIT);
}

function compareVersions(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff) return diff;
  }
  return 0;
}

function noteVersion(stats, version) {
  if (typeof version !== "string") return;
  if (!stats.minVersion || compareVersions(version, stats.minVersion) < 0)
    stats.minVersion = version;
  if (!stats.maxVersion || compareVersions(version, stats.maxVersion) > 0)
    stats.maxVersion = version;
}

function planFromArgs(args, cwd) {
  const token = args
    .trim()
    .split(/\s+/)[0]
    ?.replace(/^["']|["']$/g, "");
  if (!token || !cwd) return null;
  if (token.includes("/")) return resolve(cwd, token.replace(/^~(?=\/)/, homedir()));
  const name = token.replace(/\.md$/, "");
  if (!PLAN_NAME.test(name)) return null;
  const path = join(cwd, ".claude", "plans", `${name}.md`);
  return name.includes("-") || existsSync(path) ? path : null;
}

function addPlanFile(run, path, action) {
  if (!path) return;
  let entry = run.planFiles.find((plan) => plan.path === path);
  if (!entry) {
    entry = { path, actions: [] };
    run.planFiles.push(entry);
  }
  if (!entry.actions.includes(action)) entry.actions.push(action);
}

function splitAnswer(answer, labels, multiSelect) {
  if (labels.includes(answer)) return { selected: [answer], freeText: "" };
  if (!multiSelect) return { selected: [], freeText: answer.trim() };
  const selected = [];
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

function unquote(text) {
  return text.length > 1 && text.startsWith('"') && text.endsWith('"')
    ? text.slice(1, -1).trim()
    : text;
}

function answerCorrections(result) {
  const corrections = [];
  for (const question of Array.isArray(result?.questions) ? result.questions : []) {
    const text = question?.question;
    if (typeof text !== "string") continue;
    const labels = (Array.isArray(question.options) ? question.options : [])
      .map((option) => option?.label)
      .filter((label) => typeof label === "string");
    const answer = result.answers?.[text];
    const context = { question: truncate(text, CONTEXT_LIMIT), options: labels };
    if (answer != null) {
      const { selected, freeText } = splitAnswer(
        String(answer),
        labels,
        question.multiSelect === true,
      );
      context.selected = selected;
      if (freeText) corrections.push({ source: "other", question: text, text: freeText, context });
    }
    const note = result.annotations?.[text]?.notes;
    if (typeof note === "string" && note.trim()) {
      corrections.push({ source: "note", question: text, text: note.trim(), context });
    }
  }
  return corrections;
}

function hasParsedAnswers(result) {
  const answers = result?.answers;
  return !!answers && typeof answers === "object" && Object.keys(answers).length > 0;
}

function rejectionReason(line) {
  let reason = typeof line.userFeedback === "string" ? line.userFeedback : null;
  if (reason == null) {
    const content = line.message?.content?.find?.(
      (block) => block?.type === "tool_result",
    )?.content;
    const text = textOf(content);
    const at = text.indexOf(FEEDBACK_MARKER);
    if (at >= 0) reason = text.slice(at + FEEDBACK_MARKER.length);
  }
  reason = reason?.trim();
  return reason && !reason.startsWith(CLARIFY_FEEDBACK) ? truncate(reason, TEXT_LIMIT) : null;
}

function isInterrupt(content) {
  return (
    Array.isArray(content) &&
    content.length === 1 &&
    content[0]?.type === "text" &&
    INTERRUPTS.has(content[0].text?.trim())
  );
}

function isTypedMessage(line) {
  if (line.origin?.kind !== "human" || line.isMeta || line.isCompactSummary) return false;
  if (line.toolUseResult !== undefined) return false;
  const content = line.message?.content;
  if (typeof content === "string") return !content.trimStart().startsWith("<command-name>");
  return (
    Array.isArray(content) &&
    content.every((block) => block?.type === "text" || block?.type === "image")
  );
}

class FileReader {
  constructor(file, cutoffMs, stats) {
    this.file = file;
    this.cutoffMs = cutoffMs;
    this.stats = stats;
    this.seen = new Set();
    this.tools = new Map();
    this.run = null;
    this.runs = [];
    this.candidates = [];
    this.lastAssistantText = "";
    this.lastRejection = null;
  }

  handle(line) {
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

  handleAssistant(line) {
    this.lastRejection = null;
    const blocks = Array.isArray(line.message?.content) ? line.message.content : [];
    for (const block of blocks) {
      if (block?.type === "text" && block.text?.trim()) this.lastAssistantText = block.text.trim();
      if (block?.type === "tool_use") this.handleToolUse(line, block);
    }
  }

  handleToolUse(line, block) {
    this.tools.set(block.id, { name: block.name, input: shortInput(block.input) });
    const run = this.run;
    if (!run) return;
    const input = block.input ?? {};
    if (block.name === "Agent") {
      run.agents.push({
        subagentType: input.subagent_type ?? null,
        description: input.description ?? null,
        time: line.timestamp ?? null,
      });
    }
    if (FILE_TOOLS.has(block.name) && typeof input.file_path === "string") {
      const path = resolve(run.cwd ?? "/", input.file_path);
      if (PLAN_FILE.test(path)) addPlanFile(run, path, block.name.toLowerCase());
    }
  }

  handleUser(line) {
    this.stats.userLines++;
    if (line.origin) this.stats.userLinesWithOrigin++;
    const content = line.message?.content;
    const afterRejection = this.lastRejection;
    this.lastRejection = null;

    if (typeof content === "string" && content.startsWith("<command-message>")) {
      this.startRun(line, content);
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
      if (hasParsedAnswers(line.toolUseResult)) this.stats.askResultsParsed++;
      for (const { source, question, text, context } of answerCorrections(line.toolUseResult)) {
        this.addCandidate(line, "answer", { source, question, text, context });
      }
      return;
    }
    const text = isTypedMessage(line) ? textOf(content) : "";
    if (text) this.addCandidate(line, "message", { text });
  }

  handleAttachment(line) {
    const attachment = line.attachment;
    if (attachment?.type !== "queued_command" || attachment.origin?.kind !== "human") return;
    if (attachment.commandMode && attachment.commandMode !== "prompt") return;
    const text = textOf(attachment.prompt);
    if (!text || /^\/[\w:-]+(\s|$)/.test(text)) return;
    const timestamp = line.timestamp ?? attachment.timestamp;
    this.addCandidate({ ...line, timestamp }, "message", { text, queued: true });
  }

  startRun(line, content) {
    this.run = null;
    if (line.origin?.kind !== "human") return;
    const skill = content.match(/<command-name>([^<]*)<\/command-name>/)?.[1]?.trim();
    if (!SKILLS.has(skill)) return;
    const args = content.match(/<command-args>([\s\S]*?)<\/command-args>/)?.[1]?.trim() ?? "";
    const run = {
      id: `${this.file.sessionId}#${this.runs.length + 1}`,
      sessionId: this.file.sessionId,
      cwd: line.cwd ?? null,
      gitBranch: line.gitBranch ?? null,
      skill,
      args,
      startTime: line.timestamp ?? null,
      endTime: line.timestamp ?? null,
      agents: [],
      planFiles: [],
    };
    if (skill === "/graft:orchestrate") addPlanFile(run, planFromArgs(args, run.cwd), "argument");
    this.run = run;
    this.runs.push(run);
  }

  isAskResult(line, content) {
    if (line.toolUseResult?.questions) return true;
    const block = Array.isArray(content)
      ? content.find((item) => item?.type === "tool_result")
      : null;
    return (
      !!block && !block.is_error && this.tools.get(block.tool_use_id)?.name === "AskUserQuestion"
    );
  }

  addRejection(line, content) {
    const block = Array.isArray(content)
      ? content.find((item) => item?.type === "tool_result")
      : null;
    const tool = this.tools.get(block?.tool_use_id);
    return this.addCandidate(line, "rejection", {
      text: rejectionReason(line),
      context: { tool: tool?.name ?? null, toolInput: tool?.input ?? null },
    });
  }

  addCandidate(line, kind, { source, question, text, context = {}, queued }) {
    const run = this.run;
    if (!run || Date.parse(line.timestamp) < this.cutoffMs) return null;
    const candidate = {
      kind,
      ...(source && { source }),
      sessionId: run.sessionId,
      run: run.id,
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

async function readFile(file, cutoffMs, stats) {
  const reader = new FileReader(file, cutoffMs, stats);
  const lines = createInterface({ input: createReadStream(file.path), crlfDelay: Infinity });
  for await (const text of lines) {
    let line;
    try {
      line = JSON.parse(text);
    } catch {
      continue;
    }
    if (line && typeof line === "object") reader.handle(line);
  }
  return reader;
}

function isEarlier(a, b) {
  const keys = [
    [a.runStart, b.runStart],
    [a.candidate.time, b.candidate.time],
  ];
  for (const [x, y] of keys) {
    const diff = (Date.parse(x) || 0) - (Date.parse(y) || 0);
    if (diff) return diff < 0;
  }
  return a.bornMs < b.bornMs;
}

function dedupe(entries) {
  const kept = new Map();
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

function byTime(a, b) {
  return (Date.parse(a) || 0) - (Date.parse(b) || 0);
}

function formatWarnings(stats) {
  const warnings = [];
  if (stats.askResults > 0 && stats.askResultsParsed === 0) {
    warnings.push(
      `${stats.askResults} AskUserQuestion results were read but no answer parsed; the transcript format may have changed.`,
    );
  }
  if (stats.userLines > 0 && stats.userLinesWithOrigin === 0) {
    warnings.push(
      "No user line has an origin, so typed messages cannot be told apart; the transcript format may have changed.",
    );
  }
  return warnings;
}

function outputPath(out) {
  if (out) {
    const path = resolve(out);
    mkdirSync(dirname(path), { recursive: true });
    return path;
  }
  return join(mkdtempSync(join(tmpdir(), "graft-tune-")), "candidates.json");
}

async function main() {
  const { days, out } = parseCli();
  const cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000;
  const dir = projectsDir();
  const stats = { userLines: 0, userLinesWithOrigin: 0, askResults: 0, askResultsParsed: 0 };
  const files = listFiles(dir, cutoffMs);

  const runs = [];
  const entries = [];
  for (const file of files) {
    const reader = await readFile(file, cutoffMs, stats);
    runs.push(...reader.runs.filter((run) => !(Date.parse(run.endTime) < cutoffMs)));
    entries.push(...reader.candidates);
  }
  runs.sort((a, b) => byTime(a.startTime, b.startTime));
  const candidates = dedupe(entries).sort((a, b) => byTime(a.time, b.time));

  const counts = Object.fromEntries(KINDS.map((kind) => [kind, 0]));
  for (const candidate of candidates) counts[candidate.kind]++;
  const summary = {
    filesRead: files.length,
    runs: runs.length,
    sessions: new Set(runs.map((run) => run.sessionId)).size,
    candidates: counts,
    versions: { min: stats.minVersion ?? null, max: stats.maxVersion ?? null },
    warnings: formatWarnings(stats),
  };

  const path = outputPath(out);
  const report = {
    generatedAt: new Date().toISOString(),
    days,
    cutoff: new Date(cutoffMs).toISOString(),
    projectsDir: dir,
    summary,
    runs,
    candidates,
  };
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);

  console.log(`Wrote ${path}`);
  console.log(`Files read: ${summary.filesRead}`);
  console.log(`Runs: ${summary.runs} in ${summary.sessions} sessions`);
  console.log(`Candidates: ${KINDS.map((kind) => `${counts[kind]} ${kind}`).join(", ")}`);
  console.log(
    `Claude Code versions: ${summary.versions.min ?? "none"} to ${summary.versions.max ?? "none"}`,
  );
  for (const warning of summary.warnings) console.log(`Warning: ${warning}`);
}

await main();

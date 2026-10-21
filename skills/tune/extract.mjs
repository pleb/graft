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
const BASH_PLAN = /(?:[\w.~@+-]*\/)*\.claude\/plans\/[\w@+-][\w.@+-]*\.md(?![\w.@+-])/g;
// A plan path after any other character is the tail of a word such as `$root/.claude/plans/x.md`.
const WORD_START = /[\s'"`=:;|&<>(]/;
const LEADING_IDE = /^\s*<(ide_\w+)>(?:(?!<\/?ide_)[\s\S])*<\/\1>/;
const TRAILING_IDE = /<(ide_\w+)>(?:(?!<\/?ide_)[\s\S])*<\/\1>\s*$/;
// Written by the "chat about this" choice on AskUserQuestion; not typed by the user.
const CLARIFY_FEEDBACK = "The user wants to clarify these questions.";
const CLARIFY_QUESTIONS = "Questions asked:";
const FEEDBACK_MARKER = "the user said:\n";
const roots = new Map();

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

function listFiles(dir, cutoffMs, stats) {
  const files = [];
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
        stats.filesSkipped++;
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

function stripIde(text) {
  let rest = text;
  for (let previous; rest !== previous;) {
    previous = rest;
    rest = rest.replace(LEADING_IDE, "").replace(TRAILING_IDE, "");
  }
  return rest.trim();
}

function textOf(content) {
  if (typeof content === "string") return stripIde(content);
  if (!Array.isArray(content)) return "";
  return content
    .map((block) =>
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

function repoRoot(cwd) {
  if (!cwd) return null;
  if (!roots.has(cwd)) {
    let root = cwd;
    for (let dir = resolve(cwd); ; dir = dirname(dir)) {
      if (existsSync(join(dir, ".git"))) {
        root = dir;
        break;
      }
      if (dirname(dir) === dir) break;
    }
    roots.set(cwd, root);
  }
  return roots.get(cwd);
}

function expandHome(path) {
  return path.replace(/^~(?=\/)/, homedir());
}

function planFromArgs(args, root, recorded) {
  if (!root) return null;
  const candidates = [];
  for (const word of args.split(/\s+/)) {
    const token = word
      .replace(/^["'`(]+/, "")
      .replace(/^@/, "")
      .replace(/[)"'`.,;:!?]+$/, "");
    if (token.includes("/")) {
      if (token.endsWith(".md"))
        candidates.push({ path: resolve(root, expandHome(token)), fallback: true });
      continue;
    }
    const name = token.replace(/\.md$/, "");
    if (!PLAN_NAME.test(name)) continue;
    candidates.push({
      path: join(root, ".claude", "plans", `${name}.md`),
      fallback: name.includes("-") || token.endsWith(".md"),
    });
  }
  return (
    candidates.find(({ path }) => existsSync(path)) ??
    candidates.find(({ path }) => recorded.has(path)) ??
    candidates.find(({ fallback }) => fallback)
  )?.path;
}

function bashPlanPaths(command, root) {
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

function addPlanFile(run, path, action) {
  if (!path) return;
  let entry = run.planFiles.find((plan) => plan.path === path);
  if (!entry) {
    entry = { path, actions: [] };
    run.planFiles.push(entry);
  }
  if (!entry.actions.includes(action)) entry.actions.push(action);
}

// Claude Code joins multi-select elements with ", " and JSON-quotes each one holding ", " or '"'.
function answerElements(answer) {
  const elements = [];
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

function splitAnswer(answer, labels, multiSelect) {
  if (labels.includes(answer)) return { selected: [answer], freeText: "" };
  if (!multiSelect) return { selected: [], freeText: answer.trim() };
  const elements = answerElements(answer);
  const selected = elements.filter((element) => labels.includes(element));
  const prefixed = selected.length > 0 ? null : prefixSplit(answer, labels);
  if (prefixed?.selected.length) return prefixed;
  const freeText = elements
    .filter((element) => !labels.includes(element))
    .join(", ")
    .trim();
  return { selected, freeText };
}

function prefixSplit(answer, labels) {
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

function optionLabels(question) {
  return (Array.isArray(question?.options) ? question.options : [])
    .map((option) => option?.label)
    .filter((label) => typeof label === "string");
}

// With labels null (the question's options are unknown), the whole answer counts as free text.
function questionCorrections(text, labels, multiSelect, answer, note) {
  const corrections = [];
  const context = { question: truncate(text, CONTEXT_LIMIT), options: labels };
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

function answerCorrections(result) {
  return (Array.isArray(result?.questions) ? result.questions : []).flatMap((question) => {
    const text = question?.question;
    if (typeof text !== "string") return [];
    return questionCorrections(
      text,
      optionLabels(question),
      question.multiSelect === true,
      result.answers?.[text],
      result.annotations?.[text]?.notes,
    );
  });
}

function hasParsedAnswers(result) {
  return (Array.isArray(result?.questions) ? result.questions : []).some(
    (question) =>
      typeof question?.question === "string" &&
      (typeof result.answers?.[question.question] === "string" ||
        typeof result.annotations?.[question.question]?.notes === "string"),
  );
}

function clarifyCorrections(feedback, questions) {
  const answers = {};
  const notes = {};
  let question = null;
  let field = null;
  const at = feedback.indexOf(CLARIFY_QUESTIONS);
  if (at < 0) return [];
  for (const line of feedback.slice(at + CLARIFY_QUESTIONS.length).split("\n")) {
    const asked = line.match(/^- "(.*)"$/);
    if (asked) {
      question = asked[1];
      field = null;
      continue;
    }
    const value = question == null ? null : line.match(/^ {2}(Answer|User notes): (.*)$/);
    if (value) {
      field = value[1] === "Answer" ? answers : notes;
      field[question] = value[2];
    } else if (field) field[question] += `\n${line}`;
  }
  const asked = Array.isArray(questions) ? questions : [];
  return [...new Set([...Object.keys(answers), ...Object.keys(notes)])].flatMap((text) => {
    const input = asked.find((candidate) => candidate?.question === text);
    return questionCorrections(
      text,
      input ? optionLabels(input) : null,
      input?.multiSelect === true,
      answers[text]?.trim(),
      notes[text],
    );
  });
}

function rejectionFeedback(line) {
  let feedback = typeof line.userFeedback === "string" ? line.userFeedback : null;
  if (feedback == null) {
    const content = line.message?.content?.find?.(
      (block) => block?.type === "tool_result",
    )?.content;
    const text = textOf(content);
    const at = text.indexOf(FEEDBACK_MARKER);
    if (at >= 0) feedback = text.slice(at + FEEDBACK_MARKER.length);
  }
  return feedback?.trim() ?? "";
}

function rejectionReason(feedback) {
  return feedback && !feedback.startsWith(CLARIFY_FEEDBACK) ? truncate(feedback, TEXT_LIMIT) : null;
}

function isInterrupt(content) {
  return (
    Array.isArray(content) &&
    content.length === 1 &&
    content[0]?.type === "text" &&
    typeof content[0].text === "string" &&
    INTERRUPTS.has(content[0].text.trim())
  );
}

function isQueuedCommand(text) {
  const [first, ...rest] = text.split(/\s+/);
  const command = first.match(/^\/[\w-]+(:[\w-]+)?$/);
  return !!command && (rest.length === 0 || !!command[1]);
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
      if (block?.type === "text" && typeof block.text === "string" && block.text.trim())
        this.lastAssistantText = block.text.trim();
      if (block?.type === "tool_use") this.handleToolUse(line, block);
    }
  }

  handleToolUse(line, block) {
    const input = block.input ?? {};
    this.tools.set(block.id, {
      name: block.name,
      input: shortInput(block.input),
      ...(block.name === "AskUserQuestion" && { questions: input.questions }),
    });
    const run = this.run;
    if (!run) return;
    const root = repoRoot(run.cwd);
    if (block.name === "Agent") {
      run.agents.push({
        subagentType: input.subagent_type ?? null,
        description: input.description ?? null,
        time: line.timestamp ?? null,
      });
    }
    if (FILE_TOOLS.has(block.name) && typeof input.file_path === "string") {
      const path = resolve(root ?? "/", input.file_path);
      if (PLAN_FILE.test(path)) addPlanFile(run, path, block.name.toLowerCase());
    }
    if (block.name === "Bash" && typeof input.command === "string") {
      for (const path of bashPlanPaths(input.command, root)) addPlanFile(run, path, "read");
    }
  }

  handleUser(line) {
    this.stats.userLines++;
    if (line.origin?.kind === "human") this.stats.humanUserLines++;
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
    if (!text || isQueuedCommand(text)) return;
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
  try {
    for await (const text of lines) {
      let line;
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

function markCopies(runs, bornMs) {
  const originals = new Map();
  const ordered = [...runs].sort(
    (a, b) => byTime(a.startTime, b.startTime) || bornMs.get(a) - bornMs.get(b),
  );
  for (const run of ordered) {
    if (!run.commandUuid) continue;
    const original = originals.get(run.commandUuid);
    if (original) run.copyOf = original.id;
    else originals.set(run.commandUuid, run);
  }
}

function formatWarnings(stats) {
  const warnings = [];
  if (stats.askResults > 0 && stats.askResultsParsed === 0) {
    warnings.push(
      `${stats.askResults} AskUserQuestion results were read but no answer parsed; the transcript format may have changed.`,
    );
  }
  if (stats.userLines > 0 && stats.humanUserLines === 0) {
    warnings.push(
      "No user line has a human origin, so typed messages cannot be told apart; the transcript format may have changed.",
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
  const stats = {
    filesSkipped: 0,
    userLines: 0,
    humanUserLines: 0,
    askResults: 0,
    askResultsParsed: 0,
  };
  const files = listFiles(dir, cutoffMs, stats);

  const runs = [];
  const entries = [];
  const bornMs = new Map();
  let filesRead = 0;
  for (const file of files) {
    const reader = await readFile(file, cutoffMs, stats);
    if (!reader) {
      stats.filesSkipped++;
      continue;
    }
    filesRead++;
    for (const run of reader.runs) {
      if (Date.parse(run.endTime) < cutoffMs) continue;
      runs.push(run);
      bornMs.set(run, file.bornMs);
    }
    entries.push(...reader.candidates);
  }
  markCopies(runs, bornMs);
  runs.sort((a, b) => byTime(a.startTime, b.startTime));
  const candidates = dedupe(entries).sort((a, b) => byTime(a.time, b.time));

  const counts = Object.fromEntries(KINDS.map((kind) => [kind, 0]));
  for (const candidate of candidates) counts[candidate.kind]++;
  const originals = runs.filter((run) => !run.copyOf);
  const summary = {
    filesRead,
    filesSkipped: stats.filesSkipped,
    runs: originals.length,
    sessions: new Set(originals.map((run) => run.sessionId)).size,
    forkCopies: runs.length - originals.length,
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
  if (summary.filesSkipped) console.log(`Files skipped (unreadable): ${summary.filesSkipped}`);
  console.log(`Runs: ${summary.runs} in ${summary.sessions} sessions`);
  console.log(`Fork copies folded: ${summary.forkCopies}`);
  console.log(`Candidates: ${KINDS.map((kind) => `${counts[kind]} ${kind}`).join(", ")}`);
  console.log(
    `Claude Code versions: ${summary.versions.min ?? "none"} to ${summary.versions.max ?? "none"}`,
  );
  for (const warning of summary.warnings) console.log(`Warning: ${warning}`);
}

await main();

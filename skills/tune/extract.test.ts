import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  answerCorrections,
  bashPlanPaths,
  buildReport,
  clarifyCorrections,
  cleanRunDir,
  compareVersions,
  formatWarnings,
  isQueuedCommand,
  isSupportedNode,
  isTypedMessage,
  planFromArgs,
  stripIde,
} from "./extract-lib.ts";
import type { Line, Report, TranscriptFile } from "./extract-lib.ts";

const SCRIPT = fileURLToPath(new URL("./extract.ts", import.meta.url));
const USAGE = "Usage: node extract.ts --days <n> [--out <file>] | --clean <path>";
const HOUR_MS = 60 * 60 * 1000;
const DAYS = 2;
const NOW_MS = Date.now();
const CUTOFF_MS = NOW_MS - DAYS * 24 * HOUR_MS;
const CWD = "/work/repo";
const VERSION = "2.1.300";
const HUMAN = { kind: "human" };
const REJECTED =
  "The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). To tell you how to proceed, the user said:\n";
const CLARIFY_QUESTIONS = [
  {
    question: "Where should it live?",
    options: [{ label: "Under the data dir" }, { label: "Under home" }],
    multiSelect: false,
  },
  {
    question: "Which commands?",
    options: [{ label: "Core set" }, { label: "Reviews" }, { label: "Extras" }],
    multiSelect: true,
  },
  {
    question: "How strict?",
    options: [{ label: "Read-only, no bash (Recommended)" }, { label: "Full" }],
    multiSelect: false,
  },
  {
    question: "Pick one:\nA or B?",
    options: [{ label: "A" }, { label: "B" }],
    multiSelect: false,
  },
  { question: "Anything else?", options: [{ label: "Yes" }, { label: "No" }], multiSelect: false },
];
const CLARIFY_FEEDBACK = `The user wants to clarify these questions.
    This means they may have additional information, context or questions for you.
    Take their response into account and then reformulate the questions if appropriate.
    Start by asking them what they would like to clarify.

    Questions asked:
- "Where should it live?"
  Answer: Somewhere in /opt
- "Which commands?"
  Answer: Core set, Reviews
- "How strict?"
  Answer: Read-only, no bash (Recommended)
  User notes: allow writes on request
but only for rescue
- "Pick one:
A or B?"
  Answer: Neither
- "Anything else?"
  (No answer provided)`;
const ASK_QUESTIONS = [
  {
    question: "Which store?",
    options: [{ label: "Redis" }, { label: "Memory" }],
    multiSelect: false,
  },
  {
    question: "Which layers?",
    options: [{ label: "API" }, { label: "Worker" }],
    multiSelect: true,
  },
];

function hoursAgo(hours: number): string {
  return new Date(NOW_MS - hours * HOUR_MS).toISOString();
}

function command(skill: string, args: string, hours: number, uuid: string, extra: Line = {}): Line {
  return {
    type: "user",
    uuid,
    timestamp: hoursAgo(hours),
    version: VERSION,
    cwd: CWD,
    gitBranch: "main",
    origin: HUMAN,
    message: {
      content: `<command-message>${skill.slice(1)}</command-message>\n<command-name>${skill}</command-name>\n<command-args>${args}</command-args>`,
    },
    ...extra,
  };
}

function typed(text: string, hours: number, uuid: string, extra: Line = {}): Line {
  return {
    type: "user",
    uuid,
    timestamp: hoursAgo(hours),
    version: VERSION,
    origin: HUMAN,
    message: { content: text },
    ...extra,
  };
}

function assistant(hours: number, uuid: string, content: unknown[]): Line {
  return {
    type: "assistant",
    uuid,
    timestamp: hoursAgo(hours),
    version: VERSION,
    message: { content },
  };
}

function toolUse(id: string, name: string, input: object): object {
  return { type: "tool_use", id, name, input };
}

function queued(prompt: string, hours: number, uuid: string, commandMode = "prompt"): Line {
  return {
    type: "attachment",
    uuid,
    timestamp: hoursAgo(hours),
    attachment: { type: "queued_command", prompt, commandMode, origin: HUMAN },
  };
}

function runLines(): Line[] {
  return [
    command("/graft:plan", "not typed", 73, "cmd-model", { origin: undefined }),
    command("/graft:plan", "add a cache", 72, "cmd-1"),
    assistant(71, "as-1", [
      { type: "text", text: "Here is the outline." },
      toolUse("tool-write", "Write", { file_path: ".claude/plans/add-cache.md", content: "x" }),
    ]),
    typed("Drop the retry logic", 70, "msg-old"),
    assistant(10, "as-2", [
      { type: "text", text: "Shall I edit the config?" },
      toolUse("tool-bash", "Bash", { command: "cat .claude/plans/add-cache.md" }),
      toolUse("tool-agent", "Agent", {
        subagent_type: "graft:researcher",
        description: "Check the cache library",
      }),
      toolUse("tool-edit", "Edit", {
        file_path: `${CWD}/config.json`,
        old_string: "a",
        new_string: "b",
      }),
    ]),
    {
      type: "user",
      uuid: "rej-1",
      timestamp: hoursAgo(9),
      toolDenialKind: "user-rejected",
      message: {
        content: [
          {
            type: "tool_result",
            tool_use_id: "tool-edit",
            is_error: true,
            content: `${REJECTED}Keep the config as it is`,
          },
        ],
      },
    },
    {
      type: "user",
      uuid: "int-1",
      timestamp: hoursAgo(9),
      message: { content: [{ type: "text", text: "[Request interrupted by user for tool use]" }] },
    },
    assistant(8, "as-3", [
      { type: "text", text: "Two questions." },
      toolUse("tool-ask", "AskUserQuestion", { questions: ASK_QUESTIONS }),
    ]),
    {
      type: "user",
      uuid: "ans-1",
      timestamp: hoursAgo(7),
      message: {
        content: [{ type: "tool_result", tool_use_id: "tool-ask", content: "Answered." }],
      },
      toolUseResult: {
        questions: ASK_QUESTIONS,
        answers: {
          "Which store?": "Use SQLite instead",
          "Which layers?": "API, also the cron job",
        },
      },
    },
    queued("Also update the README", 6, "queued-1"),
    queued("/clear", 6, "queued-2"),
    typed("Sidechain text", 5, "side-1", { isSidechain: true }),
    {
      type: "user",
      uuid: "bash-1",
      timestamp: hoursAgo(5),
      message: { content: "<bash-input>git status</bash-input>" },
    },
    queued("ls", 5, "queued-3", "bash"),
    command("/kipp:review", "", 4, "cmd-other"),
    assistant(3, "as-4", [
      { type: "text", text: "Writing review notes." },
      toolUse("tool-other", "Write", { file_path: ".claude/plans/review-notes.md", content: "x" }),
      toolUse("tool-other-bash", "Bash", { command: "cat .claude/plans/review-notes.md" }),
      toolUse("tool-other-agent", "Agent", { subagent_type: "Explore", description: "Review" }),
    ]),
    typed("That review is wrong", 2, "msg-other"),
  ];
}

function clarifyLines(): Line[] {
  return [
    command("/graft:plan", "clarify", 3, "clar-cmd"),
    assistant(2.5, "clar-as", [
      { type: "text", text: "Some questions." },
      toolUse("tool-clarify", "AskUserQuestion", { questions: CLARIFY_QUESTIONS }),
    ]),
    {
      type: "user",
      uuid: "clar-rej",
      timestamp: hoursAgo(2),
      toolDenialKind: "user-rejected",
      userFeedback: CLARIFY_FEEDBACK,
      message: {
        content: [
          {
            type: "tool_result",
            tool_use_id: "tool-clarify",
            is_error: true,
            content: `${REJECTED}${CLARIFY_FEEDBACK}`,
          },
        ],
      },
    },
  ];
}

function keptLines(): Line[] {
  return [
    command("/graft:plan", "keep", 3, "kept-cmd"),
    typed("No timestamp here", 0, "no-time", { timestamp: undefined }),
    typed("No uuid here", 2, "", { uuid: undefined }),
    typed("No uuid here", 2, "", { uuid: undefined }),
  ];
}

function copyLines(): Line[] {
  return [
    command("/graft:plan", "copy", 5, "copy-cmd"),
    typed("Use the shorter name", 4, "copy-msg"),
  ];
}

const tempDirs: string[] = [];

function tempDir(prefix = "tune-test-"): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function writeTranscript(dir: string, sessionId: string, lines: Line[]): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${sessionId}.jsonl`);
  writeFileSync(path, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`);
  return path;
}

function transcript(sessionId: string, lines: Line[], bornMs = 0): TranscriptFile {
  return { path: writeTranscript(tempDir(), sessionId, lines), sessionId, bornMs };
}

function report(files: TranscriptFile[]): Promise<Report> {
  return buildReport(files, {
    days: DAYS,
    cutoffMs: CUTOFF_MS,
    projectsDir: "/projects",
    filesSkipped: 0,
  });
}

describe("answerCorrections", () => {
  const question = (multiSelect: boolean) => ({
    question: "Which colours?",
    options: [{ label: "Red, green" }, { label: "Blue" }],
    multiSelect,
  });
  const options = ["Red, green", "Blue"];
  const corrections = (multiSelect: boolean, answer: string, notes?: string) =>
    answerCorrections({
      questions: [question(multiSelect)],
      answers: { "Which colours?": answer },
      ...(notes !== undefined && { annotations: { "Which colours?": { notes } } }),
    });

  it("finds no free text in a multi-select answer whose labels contain a comma", () => {
    expect(corrections(true, "Red, green, Blue")).toEqual([]);
  });

  it("keeps only the text typed after the labels", () => {
    expect(corrections(true, "Blue, use teal, not navy")).toEqual([
      {
        source: "other",
        question: "Which colours?",
        text: "use teal, not navy",
        context: { question: "Which colours?", options, selected: ["Blue"] },
      },
    ]);
  });

  it("reads quoted elements", () => {
    expect(corrections(true, '"Red, green", "Say \\"hi\\", then go"')).toEqual([
      {
        source: "other",
        question: "Which colours?",
        text: 'Say "hi", then go',
        context: { question: "Which colours?", options, selected: ["Red, green"] },
      },
    ]);
  });

  it("takes a single-select answer that is not a label as Other text", () => {
    expect(corrections(false, "Blue")).toEqual([]);
    expect(corrections(false, " Purple ")).toEqual([
      {
        source: "other",
        question: "Which colours?",
        text: "Purple",
        context: { question: "Which colours?", options, selected: [] },
      },
    ]);
  });

  it("adds per-option notes", () => {
    expect(corrections(false, "Blue", "  but a lighter shade ")).toEqual([
      {
        source: "note",
        question: "Which colours?",
        text: "but a lighter shade",
        context: { question: "Which colours?", options, selected: ["Blue"] },
      },
    ]);
  });

  it("ignores results without questions", () => {
    expect(answerCorrections(null)).toEqual([]);
    expect(answerCorrections({ answers: { q: "x" } })).toEqual([]);
  });
});

describe("clarifyCorrections", () => {
  it("parses the clarify feedback into answer candidates", () => {
    expect(clarifyCorrections(CLARIFY_FEEDBACK, CLARIFY_QUESTIONS)).toEqual([
      {
        source: "other",
        question: "Where should it live?",
        text: "Somewhere in /opt",
        context: {
          question: "Where should it live?",
          options: ["Under the data dir", "Under home"],
          selected: [],
        },
      },
      {
        source: "note",
        question: "How strict?",
        text: "allow writes on request\nbut only for rescue",
        context: {
          question: "How strict?",
          options: ["Read-only, no bash (Recommended)", "Full"],
          selected: ["Read-only, no bash (Recommended)"],
        },
      },
      {
        source: "other",
        question: "Pick one:\nA or B?",
        text: "Neither",
        context: { question: "Pick one:\nA or B?", options: ["A", "B"], selected: [] },
      },
    ]);
  });

  it("reads a question it was not given from its header", () => {
    expect(clarifyCorrections('Questions asked:\n- "Unknown?"\n  Answer: Typed', [])).toEqual([
      {
        source: "other",
        question: "Unknown?",
        text: "Typed",
        context: { question: "Unknown?", options: null, selected: [] },
      },
    ]);
  });

  it("finds nothing without the questions list", () => {
    expect(clarifyCorrections("The user wants to clarify these questions.", [])).toEqual([]);
  });
});

describe("stripIde", () => {
  it("strips leading and trailing IDE tags", () => {
    expect(stripIde("<ide_opened_file>The user opened a.ts</ide_opened_file> Fix this")).toBe(
      "Fix this",
    );
    expect(stripIde("Fix this\n<ide_selection>x</ide_selection>\n")).toBe("Fix this");
    expect(
      stripIde("<ide_a>1</ide_a><ide_b>2</ide_b> Fix this <ide_selection>x</ide_selection>"),
    ).toBe("Fix this");
  });

  it("keeps IDE tags in the middle of the text", () => {
    expect(stripIde("Fix <ide_selection>x</ide_selection> this")).toBe(
      "Fix <ide_selection>x</ide_selection> this",
    );
  });
});

describe("isQueuedCommand", () => {
  it("matches a bare command or a plugin command with arguments", () => {
    expect(isQueuedCommand("/clear")).toBe(true);
    expect(isQueuedCommand("/graft:plan add a cache")).toBe(true);
  });

  it("does not match a built-in command with arguments or plain text", () => {
    expect(isQueuedCommand("/compact keep the notes")).toBe(false);
    expect(isQueuedCommand("please /clear")).toBe(false);
    expect(isQueuedCommand("/path/to/file")).toBe(false);
  });
});

describe("isTypedMessage", () => {
  it("accepts human text and image content", () => {
    expect(isTypedMessage(typed("Hello", 1, "u"))).toBe(true);
    expect(
      isTypedMessage(
        typed("", 1, "u", {
          message: { content: [{ type: "text", text: "See this" }, { type: "image" }] },
        }),
      ),
    ).toBe(true);
  });

  it("refuses lines the user did not type", () => {
    expect(isTypedMessage(typed("Hello", 1, "u", { origin: undefined }))).toBe(false);
    expect(isTypedMessage(typed("Hello", 1, "u", { isMeta: true }))).toBe(false);
    expect(isTypedMessage(typed("Hello", 1, "u", { isCompactSummary: true }))).toBe(false);
    expect(isTypedMessage(typed("Hello", 1, "u", { toolUseResult: null }))).toBe(false);
    expect(isTypedMessage(typed("  <command-name>/clear</command-name>", 1, "u"))).toBe(false);
    expect(
      isTypedMessage(
        typed("", 1, "u", { message: { content: [{ type: "tool_result", content: "x" }] } }),
      ),
    ).toBe(false);
    expect(isTypedMessage(typed("", 1, "u", { message: { content: 3 } }))).toBe(false);
  });
});

describe("compareVersions", () => {
  it("compares numerically by part", () => {
    expect(compareVersions("2.1.10", "2.1.9")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0", "1.0.1")).toBeLessThan(0);
    expect(compareVersions("2.1", "2.1.0")).toBe(0);
  });
});

describe("planFromArgs", () => {
  function repo(plans: string[]): string {
    const root = tempDir("tune-repo-");
    mkdirSync(join(root, ".git"));
    mkdirSync(join(root, ".claude", "plans"), { recursive: true });
    for (const name of plans) writeFileSync(join(root, ".claude", "plans", `${name}.md`), "");
    return root;
  }
  const plan = (root: string, name: string) => join(root, ".claude", "plans", `${name}.md`);

  it("finds an existing plan named anywhere in the arguments", () => {
    const root = repo(["add-cache"]);
    expect(planFromArgs("Run the add-cache plan", root, new Set())).toBe(plan(root, "add-cache"));
    expect(planFromArgs('"add-cache.md".', root, new Set())).toBe(plan(root, "add-cache"));
  });

  it("finds an existing plan by path", () => {
    const root = repo([]);
    mkdirSync(join(root, "docs"));
    writeFileSync(join(root, "docs", "plan.md"), "");
    expect(planFromArgs("then @docs/plan.md", root, new Set())).toBe(join(root, "docs", "plan.md"));
  });

  it("prefers a recorded plan to a first-word guess", () => {
    const root = repo([]);
    expect(planFromArgs("new-plan other", root, new Set([plan(root, "other")]))).toBe(
      plan(root, "other"),
    );
  });

  it("falls back to a first word that looks like a plan name", () => {
    const root = repo([]);
    expect(planFromArgs("fresh-plan", root, new Set())).toBe(plan(root, "fresh-plan"));
    expect(planFromArgs("fresh.md", root, new Set())).toBe(plan(root, "fresh"));
    expect(planFromArgs("~/plans/x.md", root, new Set())).toBe(join(homedir(), "plans", "x.md"));
    expect(planFromArgs("fresh", root, new Set())).toBeUndefined();
    expect(planFromArgs("then fresh-plan", root, new Set())).toBeUndefined();
  });

  it("gives null without a root", () => {
    expect(planFromArgs("add-cache", null, new Set())).toBeNull();
  });
});

describe("bashPlanPaths", () => {
  it("resolves plan paths in a command against the root", () => {
    expect(bashPlanPaths("cat .claude/plans/a.md docs/.claude/plans/b.md", "/r")).toEqual([
      "/r/.claude/plans/a.md",
      "/r/docs/.claude/plans/b.md",
    ]);
    expect(bashPlanPaths("cat /abs/.claude/plans/a.md", "/r")).toEqual(["/abs/.claude/plans/a.md"]);
    expect(bashPlanPaths("cat ~/.claude/plans/a.md", "/r")).toEqual([
      join(homedir(), ".claude", "plans", "a.md"),
    ]);
    expect(bashPlanPaths("cat .claude/plans/a.md", null)).toEqual(["/.claude/plans/a.md"]);
  });

  it("reads the tail of a word as a path under the root", () => {
    expect(bashPlanPaths('cat "$root/.claude/plans/a.md"', "/r")).toEqual([
      "/r/.claude/plans/a.md",
    ]);
  });

  it("ignores paths that only start like a plan", () => {
    expect(bashPlanPaths("cat .claude/plans/a.md.bak", "/r")).toEqual([]);
  });
});

describe("isSupportedNode", () => {
  it("needs Node 24 or later", () => {
    expect(isSupportedNode("22.18.0")).toBe(false);
    expect(isSupportedNode("23.11.1")).toBe(false);
    expect(isSupportedNode("24.0.0")).toBe(true);
    expect(isSupportedNode("26.1.0")).toBe(true);
  });
});

describe("formatWarnings", () => {
  const healthy = {
    userLines: 2,
    humanUserLines: 1,
    askResults: 1,
    askResultsParsed: 1,
    askResultsLabelled: 1,
  };

  it("warns about each sign of a format change", () => {
    expect(formatWarnings(healthy)).toEqual([]);
    expect(formatWarnings({ ...healthy, askResultsParsed: 0, askResultsLabelled: 0 })).toEqual([
      "1 AskUserQuestion results were read but no answer parsed; the transcript format may have changed.",
    ]);
    expect(formatWarnings({ ...healthy, askResultsLabelled: 0 })).toEqual([
      "1 AskUserQuestion results had answers but no option labels; the transcript format may have changed.",
    ]);
    expect(formatWarnings({ ...healthy, humanUserLines: 0 })).toEqual([
      "No user line has a human origin, so typed messages cannot be told apart; the transcript format may have changed.",
    ]);
  });

  it("warns from the lines a report reads", async () => {
    const unparsed: Line = { type: "user", uuid: "w-1", toolUseResult: { questions: [{}] } };
    const unlabelled: Line = {
      type: "user",
      uuid: "w-2",
      toolUseResult: { questions: [{ question: "Q?", options: [] }], answers: { "Q?": "x" } },
    };
    expect((await report([transcript("warn-1", [unparsed])])).summary.warnings).toEqual([
      "1 AskUserQuestion results were read but no answer parsed; the transcript format may have changed.",
      "No user line has a human origin, so typed messages cannot be told apart; the transcript format may have changed.",
    ]);
    expect((await report([transcript("warn-2", [unlabelled])])).summary.warnings).toEqual([
      "1 AskUserQuestion results had answers but no option labels; the transcript format may have changed.",
      "No user line has a human origin, so typed messages cannot be told apart; the transcript format may have changed.",
    ]);
    expect((await report([transcript("run-session", runLines())])).summary.warnings).toEqual([]);
  });
});

describe("buildReport", () => {
  it("reads a run end to end", async () => {
    const { summary, runs, candidates } = await report([transcript("run-session", runLines())]);
    expect(summary).toEqual({
      filesRead: 1,
      filesSkipped: 0,
      runs: 1,
      sessions: 1,
      forkCopies: 0,
      candidates: { answer: 2, message: 2, rejection: 1, interrupt: 0 },
      versions: { min: VERSION, max: VERSION },
      warnings: [],
    });
    expect(runs).toEqual([
      {
        id: "run-session#1",
        sessionId: "run-session",
        commandUuid: "cmd-1",
        cwd: CWD,
        gitBranch: "main",
        skill: "/graft:plan",
        args: "add a cache",
        startTime: hoursAgo(72),
        endTime: hoursAgo(2),
        agents: [
          {
            subagentType: "graft:researcher",
            description: "Check the cache library",
            time: hoursAgo(10),
          },
          {
            subagentType: "Explore",
            description: "Review",
            skill: "/kipp:review",
            time: hoursAgo(3),
          },
        ],
        planFiles: [{ path: `${CWD}/.claude/plans/add-cache.md`, actions: ["write", "read"] }],
      },
    ]);
    const shared = { sessionId: "run-session", run: "run-session#1" };
    expect(candidates).toEqual([
      {
        kind: "rejection",
        ...shared,
        time: hoursAgo(9),
        uuid: "rej-1",
        text: "Keep the config as it is",
        context: {
          tool: "Edit",
          toolInput: JSON.stringify({
            file_path: `${CWD}/config.json`,
            old_string: "a",
            new_string: "b",
          }),
          lastAssistantText: "Shall I edit the config?",
        },
        interrupted: true,
      },
      {
        kind: "answer",
        source: "other",
        ...shared,
        time: hoursAgo(7),
        uuid: "ans-1",
        text: "Use SQLite instead",
        context: {
          question: "Which store?",
          options: ["Redis", "Memory"],
          selected: [],
          lastAssistantText: "Two questions.",
        },
      },
      {
        kind: "answer",
        source: "other",
        ...shared,
        time: hoursAgo(7),
        uuid: "ans-1",
        text: "also the cron job",
        context: {
          question: "Which layers?",
          options: ["API", "Worker"],
          selected: ["API"],
          lastAssistantText: "Two questions.",
        },
      },
      {
        kind: "message",
        ...shared,
        time: hoursAgo(6),
        uuid: "queued-1",
        text: "Also update the README",
        queued: true,
        context: { lastAssistantText: "Two questions." },
      },
      {
        kind: "message",
        ...shared,
        skill: "/kipp:review",
        skillTime: hoursAgo(4),
        time: hoursAgo(2),
        uuid: "msg-other",
        text: "That review is wrong",
        context: { lastAssistantText: "Writing review notes." },
      },
    ]);
  });

  it("turns a clarify rejection into answer candidates", async () => {
    const { candidates } = await report([transcript("clarify-session", clarifyLines())]);
    expect(candidates.map(({ kind, source, text }) => ({ kind, source, text }))).toEqual([
      { kind: "rejection", source: undefined, text: null },
      { kind: "answer", source: "other", text: "Somewhere in /opt" },
      { kind: "answer", source: "note", text: "allow writes on request\nbut only for rescue" },
      { kind: "answer", source: "other", text: "Neither" },
    ]);
    expect(candidates[0].context).toMatchObject({ tool: "AskUserQuestion" });
  });

  it("keeps lines with no timestamp or no uuid", async () => {
    const { candidates } = await report([transcript("kept-session", keptLines())]);
    expect(candidates.map(({ time, uuid, text }) => ({ time, uuid, text }))).toEqual([
      { time: null, uuid: "no-time", text: "No timestamp here" },
      { time: hoursAgo(2), uuid: null, text: "No uuid here" },
      { time: hoursAgo(2), uuid: null, text: "No uuid here" },
    ]);
  });

  it("credits a line copied into a later session to the earlier one", async () => {
    const fork = transcript("copy-fork", copyLines(), 2000);
    const original = transcript("copy-original", copyLines(), 1000);
    const { summary, runs, candidates } = await report([fork, original]);
    expect(summary).toMatchObject({ runs: 1, sessions: 1, forkCopies: 1 });
    expect(runs.map(({ id, copyOf }) => ({ id, copyOf }))).toEqual([
      { id: "copy-fork#1", copyOf: "copy-original#1" },
      { id: "copy-original#1", copyOf: undefined },
    ]);
    expect(candidates).toMatchObject([
      { sessionId: "copy-original", run: "copy-original#1", uuid: "copy-msg" },
    ]);
  });
});

describe("cleanRunDir", () => {
  const temp = realpathSync(tmpdir());

  it("removes a run directory", () => {
    const dir = tempDir("graft-tune-");
    writeFileSync(join(dir, "candidates.json"), "{}");
    expect(cleanRunDir(join(dir, "candidates.json"))).toEqual({
      dir: join(temp, basename(dir)),
      removed: true,
    });
    expect(existsSync(dir)).toBe(false);
  });

  it("reports a directory that is already gone", () => {
    const dir = tempDir("graft-tune-");
    rmSync(dir, { recursive: true });
    expect(cleanRunDir(dir)).toEqual({ dir: join(temp, basename(dir)), removed: false });
  });

  it("refuses a .. segment", () => {
    const dir = tempDir("graft-tune-");
    expect(() => cleanRunDir(`${dir}/../${basename(dir)}`)).toThrow("has a .. segment");
    expect(existsSync(dir)).toBe(true);
  });

  it("refuses a symlink", () => {
    const target = tempDir("graft-tune-");
    const link = `${target}-link`;
    tempDirs.push(link);
    symlinkSync(target, link);
    expect(() => cleanRunDir(link)).toThrow(`${link} is a symlink`);
    expect(existsSync(target)).toBe(true);
  });

  it("refuses a non-directory", () => {
    const dir = tempDir("graft-tune-");
    const file = `${dir}-file`;
    tempDirs.push(file);
    writeFileSync(file, "");
    expect(() => cleanRunDir(file)).toThrow(`${file} is not a directory`);
    expect(existsSync(file)).toBe(true);
  });

  it("refuses a path not directly in the temp folder", () => {
    const parent = tempDir("graft-tune-");
    const dir = join(parent, "graft-tune-child");
    mkdirSync(dir);
    expect(() => cleanRunDir(dir)).toThrow(`is not directly in ${temp}`);
    expect(existsSync(dir)).toBe(true);
  });

  it("refuses a name without the run prefix", () => {
    const dir = tempDir("tune-other-");
    expect(() => cleanRunDir(dir)).toThrow("does not start with graft-tune-");
    expect(existsSync(dir)).toBe(true);
  });

  it("refuses a directory holding anything but candidates.json", () => {
    const dir = tempDir("graft-tune-");
    writeFileSync(join(dir, "candidates.json"), "{}");
    writeFileSync(join(dir, "notes.txt"), "");
    expect(() => cleanRunDir(dir)).toThrow(
      "holds notes.txt, which is not a regular candidates.json file",
    );
    expect(existsSync(join(dir, "candidates.json"))).toBe(true);

    const nested = tempDir("graft-tune-");
    mkdirSync(join(nested, "candidates.json"));
    expect(() => cleanRunDir(nested)).toThrow(
      "holds candidates.json, which is not a regular candidates.json file",
    );
  });
});

describe("extract.ts", () => {
  function run(args: string[], config = tempDir()) {
    return spawnSync(process.execPath, [SCRIPT, ...args], {
      encoding: "utf8",
      env: { ...process.env, CLAUDE_CONFIG_DIR: config },
    });
  }

  it("writes the report and prints its summary", async () => {
    const config = tempDir();
    const projects = join(config, "projects");
    const path = writeTranscript(join(projects, "-work-repo"), "run-session", runLines());
    const out = join(tempDir(), "nested", "report.json");
    const result = run(["--days", String(DAYS), "--out", out], config);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe(
      [
        `Wrote ${out}`,
        "Files read: 1",
        "Runs: 1 in 1 sessions",
        "Fork copies folded: 0",
        "Candidates: 2 answer, 2 message, 1 rejection, 0 interrupt",
        `Claude Code versions: ${VERSION} to ${VERSION}`,
        "",
      ].join("\n"),
    );
    const written: Report = JSON.parse(readFileSync(out, "utf8"));
    const expected = await buildReport([{ path, sessionId: "run-session", bornMs: 0 }], {
      days: DAYS,
      cutoffMs: CUTOFF_MS,
      projectsDir: projects,
      filesSkipped: 0,
    });
    expect({ ...written, generatedAt: "", cutoff: "" }).toEqual({
      ...expected,
      generatedAt: "",
      cutoff: "",
    });
  });

  it("cleans a run directory", () => {
    const dir = tempDir("graft-tune-");
    const result = run(["--clean", dir]);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe(`Removed ${join(realpathSync(tmpdir()), basename(dir))}\n`);
    const refused = run(["--clean", tempDir("tune-other-")]);
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain("Not removed: ");
  });

  it.each([
    [[]],
    [["--days"]],
    [["--days", "0"]],
    [["--days", "abc"]],
    [["--days", "2", "--bogus"]],
    [["--clean", ""]],
    [["--clean", "/tmp/x", "--days", "2"]],
  ])("exits 1 with the usage line for %j", (args) => {
    const result = run(args);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`${USAGE}\n`);
    expect(result.stdout).toBe("");
  });
});

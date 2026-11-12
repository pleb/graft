// Follows skills/orchestrate/SKILL.md: Start (19-23), Find the work (27-36, a finalised plan with
// the footer), Branch (45-51), Execute (55-59), Commit and review (63-69: go on past milestones 1
// and 2, then one final pass after Clean up), Each pass (73-75), Clean up (77-80), Final checks
// (82-91), Finish the plan (121-131, left in place) and Report (133-144). The plan asks for no PR.
import type { Scenario } from "../events.ts";

const PLAN = ".claude/graft/plans/add-rate-limiting.md";

const scenario: Scenario = {
  id: "orchestrate",
  title: "Orchestrate",
  kind: "continue",
  settings: {
    "common.reviewerModel": "opus",
    "orchestrate.manualChecks": "ask",
    "orchestrate.finishedPlan": "leave",
  },
  events: [
    { type: "prompt", text: "/graft:orchestrate add-rate-limiting" },
    {
      type: "caption",
      text: "Orchestrate hands the plan to agents, commits each milestone and reviews the lot.",
    },
    {
      type: "tool",
      name: "Bash",
      args: "git rev-parse --show-toplevel",
      result: "/home/acme/notes-api",
    },
    {
      type: "tool",
      name: "Bash",
      args: "node ${CLAUDE_SKILL_DIR}/../settings.ts /home/acme/notes-api",
      result: "Defaults: manual checks ask, finished plan leave",
    },
    {
      type: "tool",
      name: "Read",
      args: PLAN,
      result: "status: finalised, Plan by Graft. footer, no open questions",
    },
    {
      type: "tool",
      name: "Bash",
      args: "gh repo view --json defaultBranchRef --jq .defaultBranchRef.name",
      result: "main",
    },
    { type: "git.branch", name: "add-rate-limiting" },
    {
      type: "tool",
      name: "Bash",
      args: "git log -10 --format=%s main",
      result: "Add note search\nReject empty note titles\n... (plain imperative subjects)",
    },
    { type: "chapter", id: "orchestrate-execute", title: "Execute" },
    {
      type: "ask",
      questions: [
        {
          header: "Manual checks",
          question:
            "Milestone 3 has a Manual check (101 requests in a minute, the last gets 429). How should I handle it?",
          options: [
            { label: "Pause", description: "Stop after milestone 3 until you report the result" },
            { label: "Defer", description: "List it in the Report" },
          ],
          answer: "Defer",
          fixed: true,
        },
      ],
    },
    {
      type: "say",
      text: "Milestones 1 and 2 are independent and touch different files, so two workers run in parallel.",
    },
    {
      type: "agent.start",
      id: "worker-limiter",
      agent: "graft:worker",
      description: "Milestone 1: limiter middleware",
      from: PLAN,
    },
    {
      type: "agent.start",
      id: "worker-config",
      agent: "graft:worker",
      description: "Milestone 2: config and env docs",
      from: PLAN,
    },
    {
      type: "agent.done",
      id: "worker-config",
      report:
        "Added RATE_LIMIT_MAX and RATE_LIMIT_WINDOW_MS to src/config.js with test/config.test.js, and to the README table. node --test test/config.test.js passes.",
    },
    {
      type: "file.modify",
      path: "README.md",
      edits: [
        {
          find: "| `PORT`   | `3000`  |\n",
          replace:
            "| `PORT`   | `3000`  |\n| `RATE_LIMIT_MAX` | `100` |\n| `RATE_LIMIT_WINDOW_MS` | `60000` |\n\nRate limiting was added so that one busy client cannot slow the API down for everyone else.\n",
        },
      ],
    },
    { type: "git.commit", id: "m2", subject: "Add rate limit config", by: ["worker-config"] },
    {
      type: "agent.done",
      id: "worker-limiter",
      report:
        "Added createRateLimiter in src/middleware/rate-limit.js with tests for the window and the 429. node --test test/rate-limit.test.js passes.",
    },
    {
      type: "git.commit",
      id: "m1",
      subject: "Add rate limiter middleware",
      by: ["worker-limiter"],
    },
    {
      type: "say",
      text: "Both commits add new code with no outside callers, so no review yet. Milestone 3 wires the limiter in.",
    },
    {
      type: "agent.start",
      id: "worker-routes",
      agent: "graft:worker",
      description: "Milestone 3: wire into routes",
      from: PLAN,
    },
    {
      type: "agent.done",
      id: "worker-routes",
      report:
        "Mounted a limiter made per app on /notes in src/app.js, with tests for the 429 and Retry-After. npm test passes.",
    },
    { type: "git.commit", id: "m3", subject: "Rate limit the notes routes", by: ["worker-routes"] },
    { type: "chapter", id: "orchestrate-clean-up", title: "Clean up" },
    {
      type: "agent.start",
      id: "comment-editor",
      agent: "graft:comment-editor",
      description: "Comments on the branch's changes",
    },
    {
      type: "agent.start",
      id: "docs-editor",
      agent: "graft:docs-editor",
      description: "Docs on the branch's changes",
    },
    {
      type: "agent.done",
      id: "comment-editor",
      report: "Removed 4 comments that restated the code, kept 1 on the window reset. Lint passes.",
    },
    {
      type: "agent.done",
      id: "docs-editor",
      report: "Cut a paragraph on why limits exist from the README; the table says what to set.",
    },
    {
      type: "file.modify",
      path: "README.md",
      edits: [
        {
          find: "\nRate limiting was added so that one busy client cannot slow the API down for everyone else.\n",
          replace: "",
        },
      ],
    },
    {
      type: "git.commit",
      id: "tidy",
      subject: "Tidy rate limiting comments and docs",
      by: ["comment-editor", "docs-editor"],
    },
    { type: "chapter", id: "orchestrate-review", title: "Final review" },
    {
      type: "say",
      text: "Milestone 3 changes src/app.js, which has callers outside the plan, so the final pass over main..HEAD runs both reviewers. The brief gives the clean-up commit's diff and its intent.",
    },
    {
      type: "agent.start",
      id: "final-reviewer",
      agent: "graft:reviewer",
      description: "Review main..HEAD against the plan",
    },
    {
      type: "agent.start",
      id: "final-adversarial",
      agent: "graft:adversarial-reviewer",
      description: "Challenge main..HEAD",
    },
    {
      type: "agent.done",
      id: "final-reviewer",
      report:
        "Ship it with one fix: Retry-After is sent in milliseconds (rate-limit.js:21), but clients read it as seconds.",
    },
    {
      type: "agent.done",
      id: "final-adversarial",
      report:
        "Ship it with the same fix: a client honouring Retry-After waits 1000 times too long. Nothing else holds up.",
    },
    {
      type: "agent.start",
      id: "worker-fix",
      agent: "graft:worker",
      description: "Send Retry-After in seconds",
    },
    {
      type: "agent.done",
      id: "worker-fix",
      report:
        "Rounded the remaining window up to whole seconds and updated the test. npm test passes.",
    },
    { type: "git.commit", id: "fix", subject: "Send Retry-After in seconds", by: ["worker-fix"] },
    { type: "say", text: "Checked the fix myself: the header and its test now use seconds." },
    { type: "chapter", id: "orchestrate-checks", title: "Final checks" },
    { type: "tool", name: "Bash", args: "npm test", result: "# tests 18\n# pass 18\n# fail 0" },
    { type: "tool", name: "Bash", args: "npm run lint", result: "No problems found" },
    { type: "tool", name: "Bash", args: "git status --porcelain", result: "(no output)" },
    { type: "chapter", id: "orchestrate-report", title: "Report" },
    {
      type: "say",
      text: "Branch add-rate-limiting: 5 commits, three milestones, the clean-up and one review fix. Final pass over main..HEAD: graft:reviewer and graft:adversarial-reviewer; acted on Retry-After in seconds. npm test and npm run lint pass.",
    },
    {
      type: "say",
      text: "Deferred Manual check, milestone 3: start the server, send 101 requests in a minute, and see the last one get 429. The plan stays in place.",
    },
    {
      type: "handoff",
      text: "Raise a PR next.",
      choices: [{ command: "/graft:pr", next: "pr" }],
    },
  ],
};

export default scenario;

// Follows skills/yolo/SKILL.md: execute's run (9) with Questions (15-17: the request is clear, so no
// clarify question, no Go or Plan more question, and the agent answers every round itself), Start
// (29-31: run start, the ignore probe, a clean tree with nothing to sort), Recording decisions
// (38-39: `(agent <run start>)` lines, no plan commits as the plan is untracked), Manual checks (49,
// Defer with no question), Screenshots (53-63), PR (67-68: a ready PR with the screenshot attached),
// Restore the stash (73, nothing stashed) and Report (77-82).
// Execute's part follows skills/execute/SKILL.md: Start (15-18, no PR request in the arguments),
// Plan phase (22-31: plan's rounds answered by the agent, then in Finish's place the full pass
// Review and finalise runs (27), finalised (30), no finalise report or hand-off (31)) and
// Orchestrate phase (35).
// Plan phase follows skills/plan/SKILL.md: Start (19-25), Find the work (35, a new topic), Check the
// Graft folder (39, common.md 52-55: the probe passes, so no question), Understand (43), Settle the
// solution (47-65, no clarify question), Write the plan (69-115, no PR milestone as execute 25
// says), Review (130-136) and the full pass Finish recommends (150-152).
// Orchestrate phase follows skills/orchestrate/SKILL.md, condensed as execute.ts condenses it: Start
// (17, its root and settings already known), Branch (45-51), Execute (55-58, Defer from yolo 49),
// Commit and review (62-66), Each pass (72-74), Clean up (76-79), Final checks (81-90), yolo's
// Screenshots step, Raise a PR (92-98, a worker following skills/pr/SKILL.md 112-114 with
// `ready-state` and the screenshot from yolo 68), Finish the plan (108-118, left in place) and
// Report (120-130).
import type { Scenario } from "../events.ts";

const PLAN = ".claude/graft/plans/add-rate-limiting.md";
const RUN = "2026-11-11 09:30";
const SHOT = "/tmp/notes-api-shots/notes-429.png";
const TITLE = "Add rate limiting to the notes API";
const BODY = `## What

Each client can make 100 requests a minute to the notes API by default. Past that, requests get 429 with a \`Retry-After\` in seconds.

## Why

One busy client could slow the API for everyone.

## How

An in-memory fixed window keeps it free of new dependencies. It assumes one instance; counts reset on restart.

_Graft: AI has reviewed and adversarially reviewed these changes._

![GET /notes answering 429 after 100 requests](https://github.com/user-attachments/assets/3f6b1c2e-8a4d-4e0b-9c7a-2d5e1f0a7b64)`;

const DRAFT = `---
status: draft
---

# Add rate limiting

## Goal

Limit how often one client can call the notes API, so a single client cannot slow it for everyone.

## Approach

A fixed window counter in memory, keyed on the client IP, answers 429 with Retry-After once a client passes its limit.

## Decisions

- Limit key: client IP (agent ${RUN})
- Scope: all /notes routes (agent ${RUN})
- Store: in memory, one process (default)
- Over the limit: 429 with Retry-After in seconds (default)

## Out of scope

- A shared store for more than one instance.

## Milestones

### 1. Limiter middleware

Files: \`src/middleware/rate-limit.js\`, \`test/rate-limit.test.js\`.

### 2. Config and env docs

Files: \`src/config.js\`, \`test/config.test.js\`, \`README.md\`.

### 3. Wire into routes

Files: \`src/app.js\`, \`test/notes.test.js\`.

## Edge cases and risks

## Open questions

---

Plan by Graft.
`;

const scenario: Scenario = {
  id: "yolo",
  title: "Yolo",
  kind: "start",
  settings: {
    "common.reviewerModel": "opus",
    "plan.questionsPerRound": "3",
    "plan.manualChecksQuestion": "orchestrate",
    "orchestrate.manualChecks": "ask",
    "orchestrate.finishedPlan": "leave",
    "pr.state": "draft",
  },
  events: [
    { type: "prompt", text: "/graft:yolo add rate limiting to the notes API" },
    {
      type: "caption",
      text: "Yolo runs execute, making the calls you would usually make, and ends in a ready PR with screenshots.",
    },
    {
      type: "tool",
      name: "Bash",
      args: "git rev-parse --show-toplevel",
      result: "/home/acme/notes-api",
    },
    { type: "tool", name: "Bash", args: "date '+%Y-%m-%d %H:%M'", result: RUN },
    {
      type: "tool",
      name: "Bash",
      args: "git -C /home/acme/notes-api check-ignore -q .claude/graft/.probe.md",
      result: "(no output, exit 0)",
    },
    { type: "tool", name: "Bash", args: "git status --porcelain", result: "(no output)" },
    {
      type: "say",
      text: `Run started ${RUN}. .claude/graft/ is ignored and the tree is clean, so nothing to include or stash. No PR request in the arguments; yolo raises a ready PR anyway.`,
    },
    { type: "chapter", id: "yolo-plan", title: "Plan phase" },
    {
      type: "tool",
      name: "Bash",
      args: "node ${CLAUDE_SKILL_DIR}/../settings.ts /home/acme/notes-api",
      result:
        "Defaults: reviewer model opus, 3 questions per round, manual checks ask, pr.state draft",
    },
    {
      type: "tool",
      name: "Read",
      args: "src/app.js",
      result: "Routes mount on /notes behind express.json()",
    },
    {
      type: "say",
      text: "The request is clear and has one sensible path, so no clarify question. I answer each round myself, with the option I would recommend.",
    },
    {
      type: "agent.start",
      id: "yolo-research",
      agent: "graft:researcher",
      description: "Rate limiting options for Express 4",
    },
    {
      type: "say",
      text: "Round 1, answered: limit key is the client IP (works for every caller today; notes-api has no API keys), and the scope is all /notes routes (one mount point, one rule).",
    },
    {
      type: "agent.done",
      id: "yolo-research",
      report:
        "express-rate-limit 7 supports Express 4; a fixed window counter is about 30 lines with no dependency. 429 with Retry-After is the standard reply (RFC 6585).",
    },
    { type: "file.create", path: PLAN, content: DRAFT },
    {
      type: "say",
      text: `Wrote ${PLAN} with the goal, approach and three milestones. Round 1's answers are in Decisions, marked (agent ${RUN}).`,
    },
    {
      type: "say",
      text: "Round 2, answered: a hand-rolled fixed window (no new dependency), and 100 requests a minute by default (generous for people, stops floods).",
    },
    {
      type: "file.modify",
      path: PLAN,
      edits: [
        {
          find: `- Scope: all /notes routes (agent ${RUN})\n`,
          replace: `- Scope: all /notes routes (agent ${RUN})\n- Limiter: hand-rolled fixed window (agent ${RUN})\n- Default limit: 100 per minute (agent ${RUN})\n`,
        },
        {
          find: "Files: `src/middleware/rate-limit.js`, `test/rate-limit.test.js`.\n",
          replace:
            "Files: `src/middleware/rate-limit.js`, `test/rate-limit.test.js`.\n\n- `createRateLimiter({ max, windowMs })` counts requests per `req.ip` in a fixed window.\n\nVerification:\n\n- **Automated**: `node --test test/rate-limit.test.js`.\n",
        },
        {
          find: "Files: `src/config.js`, `test/config.test.js`, `README.md`.\n",
          replace:
            "Files: `src/config.js`, `test/config.test.js`, `README.md`.\n\n- `RATE_LIMIT_MAX` (100) and `RATE_LIMIT_WINDOW_MS` (60000), documented in the README's table.\n\nVerification:\n\n- **Automated**: `node --test test/config.test.js`.\n",
        },
        {
          find: "Files: `src/app.js`, `test/notes.test.js`.\n",
          replace:
            "Files: `src/app.js`, `test/notes.test.js`.\n\n- Mount the limiter on `/notes`; tests cover the 429 and its Retry-After.\n\nVerification:\n\n- **Automated**: `npm test`.\n- **Manual**: start the server, send 101 requests in a minute, and see the last one get 429.\n",
        },
      ],
    },
    {
      type: "say",
      text: "Recorded the limiter and default limit, and detailed each milestone with its verification.",
    },
    { type: "chapter", id: "yolo-plan-review", title: "Plan review" },
    {
      type: "say",
      text: "No open questions remain. Finish's question is not asked: Review and finalise, the option it recommends, runs a full pass with both reviewers. Go or Plan more is not asked either.",
    },
    {
      type: "agent.start",
      id: "yolo-plan-reviewer",
      agent: "graft:reviewer",
      description: "Whole-plan review against the code",
      from: PLAN,
    },
    {
      type: "agent.start",
      id: "yolo-plan-adversarial",
      agent: "graft:adversarial-reviewer",
      description: "Whole-plan challenge of the approach",
      from: PLAN,
    },
    {
      type: "agent.done",
      id: "yolo-plan-reviewer",
      report:
        "Proceed with one change: milestone 3's tests share one app, so the limiter's counts leak between tests and later ones get 429. Give each app its own limiter.",
    },
    {
      type: "agent.done",
      id: "yolo-plan-adversarial",
      report:
        "Proceed. The in-memory count resets on restart and does not span instances; fine for one process, but name it as a risk.",
    },
    {
      type: "file.modify",
      path: PLAN,
      edits: [
        {
          find: "- Mount the limiter on `/notes`;",
          replace: "- Mount a limiter made per app on `/notes`, so tests stay independent;",
        },
        {
          find: "## Edge cases and risks\n",
          replace:
            "## Edge cases and risks\n\n- Counts reset on restart and do not span instances; a second instance needs a shared store.\n",
        },
        { find: "status: draft", replace: "status: finalised" },
      ],
    },
    {
      type: "say",
      text: "Both reviewers said proceed. Fixed milestone 3 to give each app its own limiter, added the restart reset as a risk, and finalised the plan.",
    },
    { type: "chapter", id: "yolo-orchestrate", title: "Orchestrate phase" },
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
    {
      type: "tool",
      name: "Bash",
      args: `git ls-files --error-unmatch ${PLAN}`,
      result: `error: pathspec '${PLAN}' did not match any file(s) known to git`,
    },
    {
      type: "say",
      text: "The plan is untracked, so its edits get no commits. Milestone 3's Manual check is deferred to Report without a question. Milestones 1 and 2 touch different files, so two workers run in parallel.",
    },
    {
      type: "agent.start",
      id: "yolo-worker-limiter",
      agent: "graft:worker",
      description: "Milestone 1: limiter middleware",
      from: PLAN,
    },
    {
      type: "agent.start",
      id: "yolo-worker-config",
      agent: "graft:worker",
      description: "Milestone 2: config and env docs",
      from: PLAN,
    },
    {
      type: "agent.done",
      id: "yolo-worker-config",
      report:
        "Added RATE_LIMIT_MAX and RATE_LIMIT_WINDOW_MS to src/config.js with test/config.test.js, and to the README table. node --test test/config.test.js passes.",
    },
    { type: "git.commit", id: "m2", subject: "Add rate limit config", by: ["yolo-worker-config"] },
    {
      type: "agent.done",
      id: "yolo-worker-limiter",
      report:
        "Added createRateLimiter in src/middleware/rate-limit.js with tests for the window and the 429. node --test test/rate-limit.test.js passes.",
    },
    {
      type: "git.commit",
      id: "m1",
      subject: "Add rate limiter middleware",
      by: ["yolo-worker-limiter"],
    },
    {
      type: "agent.start",
      id: "yolo-worker-routes",
      agent: "graft:worker",
      description: "Milestone 3: wire into routes",
      from: PLAN,
    },
    {
      type: "agent.done",
      id: "yolo-worker-routes",
      report:
        "Mounted a limiter made per app on /notes in src/app.js, with tests for the 429 and Retry-After. npm test passes.",
    },
    {
      type: "git.commit",
      id: "m3",
      subject: "Rate limit the notes routes",
      by: ["yolo-worker-routes"],
    },
    { type: "chapter", id: "yolo-clean-up", title: "Clean up" },
    {
      type: "agent.start",
      id: "yolo-comment-editor",
      agent: "graft:comment-editor",
      description: "Comments on the branch's changes",
    },
    {
      type: "agent.start",
      id: "yolo-docs-editor",
      agent: "graft:docs-editor",
      description: "Docs on the branch's changes",
    },
    {
      type: "agent.done",
      id: "yolo-comment-editor",
      report: "Removed 4 comments that restated the code, kept 1 on the window reset. Lint passes.",
    },
    {
      type: "agent.done",
      id: "yolo-docs-editor",
      report: "Cut a paragraph on why limits exist from the README; the table says what to set.",
    },
    {
      type: "git.commit",
      id: "tidy",
      subject: "Tidy rate limiting comments and docs",
      by: ["yolo-comment-editor", "yolo-docs-editor"],
    },
    { type: "chapter", id: "yolo-review", title: "Final review" },
    {
      type: "say",
      text: "Milestone 3 changes src/app.js, which has callers outside the plan, so the final pass over main..HEAD runs both reviewers, with the clean-up commit's diff and intent.",
    },
    {
      type: "agent.start",
      id: "yolo-final-reviewer",
      agent: "graft:reviewer",
      description: "Review main..HEAD against the plan",
    },
    {
      type: "agent.start",
      id: "yolo-final-adversarial",
      agent: "graft:adversarial-reviewer",
      description: "Challenge main..HEAD",
    },
    {
      type: "agent.done",
      id: "yolo-final-reviewer",
      report:
        "Ship it with one fix: Retry-After is sent in milliseconds (rate-limit.js:21), but clients read it as seconds.",
    },
    {
      type: "agent.done",
      id: "yolo-final-adversarial",
      report:
        "Ship it with the same fix: a client honouring Retry-After waits 1000 times too long. Nothing else holds up.",
    },
    {
      type: "agent.start",
      id: "yolo-worker-fix",
      agent: "graft:worker",
      description: "Send Retry-After in seconds",
    },
    {
      type: "agent.done",
      id: "yolo-worker-fix",
      report:
        "Rounded the remaining window up to whole seconds and updated the test. npm test passes.",
    },
    {
      type: "git.commit",
      id: "fix",
      subject: "Send Retry-After in seconds",
      by: ["yolo-worker-fix"],
    },
    { type: "chapter", id: "yolo-checks", title: "Final checks" },
    { type: "tool", name: "Bash", args: "npm test", result: "# tests 18\n# pass 18\n# fail 0" },
    { type: "tool", name: "Bash", args: "npm run lint", result: "No problems found" },
    { type: "tool", name: "Bash", args: "git status --porcelain", result: "(no output)" },
    { type: "chapter", id: "yolo-screenshots", title: "Screenshots" },
    {
      type: "tool",
      name: "Bash",
      args: "gh --version",
      result: "gh version 2.99.1 (2026-10-02)",
    },
    {
      type: "tool",
      name: "Bash",
      args: "gh repo view --json url",
      result: '{"url":"https://github.com/acme/notes-api"}',
    },
    {
      type: "tool",
      name: "Bash",
      args: "git worktree list",
      result: "/home/acme/notes-api  9c41e07 [add-rate-limiting]",
    },
    {
      type: "agent.start",
      id: "yolo-worker-shots",
      agent: "graft:worker",
      description: "Capture the changed screens on the branch",
    },
    {
      type: "agent.done",
      id: "yolo-worker-shots",
      report: `Started the server from the working tree, sent 100 requests, then opened /notes in a browser and captured the 429 reply with its Retry-After. Wrote ${SHOT} and stopped the server.`,
    },
    { type: "tool", name: "Bash", args: "git status --porcelain", result: "(no output)" },
    {
      type: "tool",
      name: "Bash",
      args: "git worktree list",
      result: "/home/acme/notes-api  9c41e07 [add-rate-limiting]",
    },
    {
      type: "agent.start",
      id: "yolo-publish-reader",
      agent: "graft:publish-reader",
      description: "Read the screenshot before it is published",
    },
    {
      type: "agent.done",
      id: "yolo-publish-reader",
      report: `Read ${SHOT} in full: a JSON 429 body and its headers on localhost. No findings.`,
    },
    {
      type: "say",
      text: "The tree and HEAD match the record, so there is nothing to restore. The screenshot is approved.",
    },
    { type: "chapter", id: "yolo-pr", title: "Raise a PR" },
    {
      type: "agent.start",
      id: "yolo-worker-pr",
      agent: "graft:worker",
      description: "Raise a ready PR with the screenshot as skills/pr/SKILL.md describes",
    },
    {
      type: "agent.done",
      id: "yolo-worker-pr",
      report: `No PR template, so What, Why and How with the Graft line, and the screenshot reference below it. Pushed add-rate-limiting and opened ready PR #18 with --attach ${SHOT}.`,
    },
    {
      type: "pr.open",
      number: 18,
      title: TITLE,
      branch: "add-rate-limiting",
      base: "main",
      draft: false,
      commits: ["m2", "m1", "m3", "tidy", "fix"],
      body: BODY,
    },
    { type: "chapter", id: "yolo-report", title: "Report" },
    {
      type: "say",
      text: "Branch add-rate-limiting: 5 commits, three milestones, the clean-up and one review fix, in ready PR #18: https://github.com/acme/notes-api/pull/18. Final pass over main..HEAD: graft:reviewer and graft:adversarial-reviewer; acted on Retry-After in seconds. npm test and npm run lint pass.",
    },
    {
      type: "say",
      text: `Decisions I made without asking (agent ${RUN}): limit key client IP, all /notes routes, a hand-rolled fixed window, 100 requests a minute. The tree was clean: nothing included, stashed or excluded, and no stash left. One screenshot attached.`,
    },
    {
      type: "say",
      text: "Deferred Manual check, milestone 3: start the server, send 101 requests in a minute, and see the last one get 429. The plan stays in place.",
    },
    { type: "end" },
  ],
};

export default scenario;

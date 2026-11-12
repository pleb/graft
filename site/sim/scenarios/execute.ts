// Follows skills/execute/SKILL.md: Start (15-18, `open a pr` taken out as the PR request), Plan
// phase (22-31: plan's rounds, then in Finish's place the full pass Review and finalise runs (27),
// no Go or Plan more question as rounds reached the user (28), finalised (30), no finalise report
// or hand-off (31)) and Orchestrate phase (35).
// Plan phase follows skills/plan/SKILL.md: Start (19-25), Find the work (35, research found or a
// new topic), Check the Graft folder skipped as the folder exists (common.md 52), Understand (43),
// Settle the solution (47-65, no clarify question), Write the plan (69-115, no PR milestone as
// execute 25 says), Review (130-136) and the full pass Finish recommends (150-152).
// Orchestrate phase follows skills/orchestrate/SKILL.md, condensed in orchestrate.ts's order: Start
// (17, its root and settings already known), Branch (45-51), Execute (55-59, Defer as
// orchestrate.manualChecks is ask and plan.manualChecksQuestion is orchestrate), Commit and review
// (63-69), Each pass (73-75), Clean up (77-80), Final checks (82-91), Raise a PR (105-111, a worker
// following skills/pr/SKILL.md), Finish the plan (121-131, left in place) and Report (133-144).
import type { Scenario } from "../events.ts";

const PLAN = ".claude/graft/plans/add-rate-limiting.md";
const REPORT = ".claude/graft/research/add-rate-limiting/report.md";
const TITLE = "Add rate limiting to the notes API";
const BODY = `## What

Each client can make 100 requests a minute to the notes API by default. Past that, requests get 429 with a \`Retry-After\` in seconds.

## Why

One busy client could slow the API for everyone.

## How

An in-memory fixed window keeps it free of new dependencies. It assumes one instance; counts reset on restart.

_Graft: AI has reviewed and adversarially reviewed these changes._`;

function draft(references: string): string {
  return `---
status: draft
---

# Add rate limiting

## Goal

Limit how often one client can call the notes API, so a single client cannot slow it for everyone.
${references}
## Approach

A fixed window counter in memory, keyed on the client IP, answers 429 with Retry-After once a client passes its limit.

## Decisions

- Limit key: client IP (you)
- Scope: all /notes routes (you)
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
}

const scenario: Scenario = {
  id: "execute",
  title: "Execute",
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
    { type: "prompt", text: "/graft:execute add-rate-limiting open a pr", after: ["research"] },
    {
      type: "prompt",
      text: "/graft:execute add rate limiting to the notes API and open a pr",
      notAfter: ["research"],
    },
    {
      type: "caption",
      text: "Execute plans with you as plan does, then runs the plan as orchestrate does, in one session.",
    },
    {
      type: "tool",
      name: "Bash",
      args: "git rev-parse --show-toplevel",
      result: "/home/acme/notes-api",
    },
    {
      type: "say",
      text: "Took `open a pr` out as the PR request, raised after Final checks. The rest goes to the plan phase.",
    },
    { type: "chapter", id: "execute-plan", title: "Plan phase" },
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
      args: REPORT,
      result: "Concluded: an in-process fixed window keyed on the client IP, 429 with Retry-After",
      after: ["research"],
    },
    {
      type: "tool",
      name: "Read",
      args: "src/app.js",
      result: "Routes mount on /notes behind express.json()",
    },
    {
      type: "agent.start",
      id: "exec-research",
      agent: "graft:researcher",
      description: "Rate limiting options for Express 4",
      notAfter: ["research"],
    },
    {
      type: "ask",
      questions: [
        {
          header: "Limit key",
          question:
            "What should a client's limit be keyed on? This decides the limiter's bucket key.",
          options: [
            {
              label: "Client IP (Recommended)",
              description: "Works for every caller today; shared NATs share a bucket",
            },
            { label: "API key header", description: "Fairer, but notes-api has no API keys yet" },
          ],
          answer: "Client IP (Recommended)",
          recommended: true,
        },
        {
          header: "Scope",
          question: "Which routes get the limit? This decides where milestone 3 wires it in.",
          options: [
            { label: "All /notes routes (Recommended)", description: "One mount point, one rule" },
            { label: "Writes only", description: "Reads stay unlimited, but can still flood" },
          ],
          answer: "All /notes routes (Recommended)",
          recommended: true,
        },
      ],
    },
    {
      type: "agent.done",
      id: "exec-research",
      report:
        "express-rate-limit 7 supports Express 4; a fixed window counter is about 30 lines with no dependency. 429 with Retry-After is the standard reply (RFC 6585).",
      notAfter: ["research"],
    },
    {
      type: "file.create",
      path: PLAN,
      content: draft(`\n## References\n\n- Research ${REPORT}\n`),
      after: ["research"],
    },
    { type: "file.create", path: PLAN, content: draft(""), notAfter: ["research"] },
    {
      type: "say",
      text: `Wrote ${PLAN} with the goal, approach and three milestones. The PR request stays out of the milestones.`,
    },
    {
      type: "ask",
      questions: [
        {
          header: "Limiter",
          question:
            "Use express-rate-limit or a hand-rolled limiter? This decides milestone 1's dependency.",
          options: [
            {
              label: "Hand-rolled fixed window (Recommended)",
              description: "No new dependency; about 30 lines to own",
            },
            {
              label: "express-rate-limit",
              description: "Maintained upstream; one more dependency",
            },
          ],
          answer: "Hand-rolled fixed window (Recommended)",
          recommended: true,
        },
        {
          header: "Default limit",
          question:
            "What limit should ship by default? This sets RATE_LIMIT_MAX and RATE_LIMIT_WINDOW_MS.",
          options: [
            {
              label: "100 per minute (Recommended)",
              description: "Generous for people, stops floods",
            },
            { label: "1000 per hour", description: "Allows bursts a minute window would block" },
          ],
          answer: "100 per minute (Recommended)",
          recommended: true,
        },
      ],
    },
    {
      type: "file.modify",
      path: PLAN,
      edits: [
        {
          find: "- Scope: all /notes routes (you)\n",
          replace:
            "- Scope: all /notes routes (you)\n- Limiter: hand-rolled fixed window (you)\n- Default limit: 100 per minute (you)\n",
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
    { type: "chapter", id: "execute-plan-review", title: "Plan review" },
    {
      type: "say",
      text: "No open questions remain. Execute asks no Finish question: it takes Review and finalise, the option Finish recommends, so a full pass runs with both reviewers.",
    },
    {
      type: "agent.start",
      id: "exec-plan-reviewer",
      agent: "graft:reviewer",
      description: "Whole-plan review against the code",
      from: PLAN,
    },
    {
      type: "agent.start",
      id: "exec-plan-adversarial",
      agent: "graft:adversarial-reviewer",
      description: "Whole-plan challenge of the approach",
      from: PLAN,
    },
    {
      type: "agent.done",
      id: "exec-plan-reviewer",
      report:
        "Proceed with one change: milestone 3's tests share one app, so the limiter's counts leak between tests and later ones get 429. Give each app its own limiter.",
    },
    {
      type: "agent.done",
      id: "exec-plan-adversarial",
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
      text: "Both reviewers said proceed, with no decision for you. Fixed milestone 3 to give each app its own limiter, added the restart reset as a risk, and finalised the plan.",
    },
    { type: "chapter", id: "execute-orchestrate", title: "Orchestrate phase" },
    {
      type: "caption",
      text: "With the plan finalised, execute carries on as orchestrate does, without a /clear.",
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
      id: "exec-worker-limiter",
      agent: "graft:worker",
      description: "Milestone 1: limiter middleware",
      from: PLAN,
    },
    {
      type: "agent.start",
      id: "exec-worker-config",
      agent: "graft:worker",
      description: "Milestone 2: config and env docs",
      from: PLAN,
    },
    {
      type: "agent.done",
      id: "exec-worker-config",
      report:
        "Added RATE_LIMIT_MAX and RATE_LIMIT_WINDOW_MS to src/config.js with test/config.test.js, and to the README table. node --test test/config.test.js passes.",
    },
    { type: "git.commit", id: "m2", subject: "Add rate limit config", by: ["exec-worker-config"] },
    {
      type: "agent.done",
      id: "exec-worker-limiter",
      report:
        "Added createRateLimiter in src/middleware/rate-limit.js with tests for the window and the 429. node --test test/rate-limit.test.js passes.",
    },
    {
      type: "git.commit",
      id: "m1",
      subject: "Add rate limiter middleware",
      by: ["exec-worker-limiter"],
    },
    {
      type: "agent.start",
      id: "exec-worker-routes",
      agent: "graft:worker",
      description: "Milestone 3: wire into routes",
      from: PLAN,
    },
    {
      type: "agent.done",
      id: "exec-worker-routes",
      report:
        "Mounted a limiter made per app on /notes in src/app.js, with tests for the 429 and Retry-After. npm test passes.",
    },
    {
      type: "git.commit",
      id: "m3",
      subject: "Rate limit the notes routes",
      by: ["exec-worker-routes"],
    },
    { type: "chapter", id: "execute-clean-up", title: "Clean up" },
    {
      type: "agent.start",
      id: "exec-comment-editor",
      agent: "graft:comment-editor",
      description: "Comments on the branch's changes",
    },
    {
      type: "agent.start",
      id: "exec-docs-editor",
      agent: "graft:docs-editor",
      description: "Docs on the branch's changes",
    },
    {
      type: "agent.done",
      id: "exec-comment-editor",
      report: "Removed 4 comments that restated the code, kept 1 on the window reset. Lint passes.",
    },
    {
      type: "agent.done",
      id: "exec-docs-editor",
      report: "Cut a paragraph on why limits exist from the README; the table says what to set.",
    },
    {
      type: "git.commit",
      id: "tidy",
      subject: "Tidy rate limiting comments and docs",
      by: ["exec-comment-editor", "exec-docs-editor"],
    },
    { type: "chapter", id: "execute-review", title: "Final review" },
    {
      type: "say",
      text: "Milestone 3 changes src/app.js, which has callers outside the plan, so the final pass over main..HEAD runs both reviewers, with the clean-up commit's diff and intent.",
    },
    {
      type: "agent.start",
      id: "exec-final-reviewer",
      agent: "graft:reviewer",
      description: "Review main..HEAD against the plan",
    },
    {
      type: "agent.start",
      id: "exec-final-adversarial",
      agent: "graft:adversarial-reviewer",
      description: "Challenge main..HEAD",
    },
    {
      type: "agent.done",
      id: "exec-final-reviewer",
      report:
        "Ship it with one fix: Retry-After is sent in milliseconds (rate-limit.js:21), but clients read it as seconds.",
    },
    {
      type: "agent.done",
      id: "exec-final-adversarial",
      report:
        "Ship it with the same fix: a client honouring Retry-After waits 1000 times too long. Nothing else holds up.",
    },
    {
      type: "agent.start",
      id: "exec-worker-fix",
      agent: "graft:worker",
      description: "Send Retry-After in seconds",
    },
    {
      type: "agent.done",
      id: "exec-worker-fix",
      report:
        "Rounded the remaining window up to whole seconds and updated the test. npm test passes.",
    },
    {
      type: "git.commit",
      id: "fix",
      subject: "Send Retry-After in seconds",
      by: ["exec-worker-fix"],
    },
    { type: "chapter", id: "execute-checks", title: "Final checks" },
    { type: "tool", name: "Bash", args: "npm test", result: "# tests 18\n# pass 18\n# fail 0" },
    { type: "tool", name: "Bash", args: "npm run lint", result: "No problems found" },
    { type: "tool", name: "Bash", args: "git status --porcelain", result: "(no output)" },
    { type: "chapter", id: "execute-pr", title: "Raise a PR" },
    {
      type: "agent.start",
      id: "exec-worker-pr",
      agent: "graft:worker",
      description: "Raise the PR as skills/pr/SKILL.md describes",
    },
    {
      type: "agent.done",
      id: "exec-worker-pr",
      report:
        "No PR template, so What, Why and How with the Graft line; no issue to resolve. Pushed add-rate-limiting and opened draft PR #18.",
    },
    {
      type: "pr.open",
      number: 18,
      title: TITLE,
      branch: "add-rate-limiting",
      base: "main",
      draft: true,
      commits: ["m2", "m1", "m3", "tidy", "fix"],
      body: BODY,
    },
    { type: "chapter", id: "execute-report", title: "Report" },
    {
      type: "say",
      text: "Branch add-rate-limiting: 5 commits, three milestones, the clean-up and one review fix, in draft PR #18: https://github.com/acme/notes-api/pull/18. Final pass over main..HEAD: graft:reviewer and graft:adversarial-reviewer; acted on Retry-After in seconds. npm test and npm run lint pass.",
    },
    {
      type: "say",
      text: "Deferred Manual check, milestone 3: start the server, send 101 requests in a minute, and see the last one get 429. The plan stays in place.",
    },
    { type: "end" },
  ],
};

export default scenario;

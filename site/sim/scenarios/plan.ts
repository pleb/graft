// Follows skills/plan/SKILL.md: Start (19-25), Find the work (35, research found or a new topic),
// Check the Graft folder skipped as the folder exists (common.md 52), Understand (43), Settle the
// solution (47-65, no clarify question as the request has one sensible path), Write the plan
// (69-115), Review (128-136) and Finish (140-154) with Review and finalise as a full pass.
import type { Scenario } from "../events.ts";

const PLAN = ".claude/graft/plans/add-rate-limiting.md";
const REPORT = ".claude/graft/research/add-rate-limiting/report.md";

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
  id: "plan",
  title: "Plan",
  kind: "start",
  settings: {
    "common.reviewerModel": "opus",
    "plan.questionsPerRound": "3",
    "plan.manualChecksQuestion": "orchestrate",
    "orchestrate.manualChecks": "ask",
  },
  events: [
    { type: "prompt", text: "/graft:plan add-rate-limiting", after: ["research"] },
    {
      type: "prompt",
      text: "/graft:plan add rate limiting to the notes API",
      notAfter: ["research"],
    },
    { type: "caption", text: "Plan settles the solution with you and writes it down." },
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
      result: "Defaults: reviewer model opus, 3 questions per round",
    },
    {
      type: "tool",
      name: "Read",
      args: REPORT,
      result: "Concluded: an in-process fixed window keyed on the client IP, 429 with Retry-After",
      after: ["research"],
    },
    {
      type: "say",
      text: "Found the add-rate-limiting research, so this is a new plan named after it.",
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
      id: "plan-research",
      agent: "graft:researcher",
      description: "Rate limiting options for Express 4",
      notAfter: ["research"],
    },
    { type: "chapter", id: "plan-rounds", title: "Settle the solution" },
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
      id: "plan-research",
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
    { type: "say", text: `Wrote ${PLAN} with the goal, approach and three milestones.` },
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
    { type: "chapter", id: "plan-finish", title: "Finish" },
    {
      type: "ask",
      questions: [
        {
          header: "Finish",
          question:
            "No open questions remain. Defaults to confirm: in-memory store for one process; 429 with Retry-After in seconds.",
          options: [
            { label: "Review and finalise", description: "A full review pass, then finalise" },
            { label: "Finalise", description: "Finalise without a review pass" },
            { label: "Continue planning", description: "Say what to change next" },
          ],
          answer: "Review and finalise",
          fixed: true,
          recommended: true,
        },
      ],
    },
    {
      type: "agent.start",
      id: "plan-reviewer",
      agent: "graft:reviewer",
      description: "Whole-plan review against the code",
      from: PLAN,
    },
    {
      type: "agent.start",
      id: "plan-adversarial",
      agent: "graft:adversarial-reviewer",
      description: "Whole-plan challenge of the approach",
      from: PLAN,
    },
    {
      type: "agent.done",
      id: "plan-reviewer",
      report:
        "Proceed with one change: milestone 3's tests share one app, so the limiter's counts leak between tests and later ones get 429. Give each app its own limiter.",
    },
    {
      type: "agent.done",
      id: "plan-adversarial",
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
      ],
    },
    {
      type: "say",
      text: "Both reviewers said proceed. Fixed milestone 3 to give each app its own limiter, and added the restart reset as a risk.",
    },
    {
      type: "file.modify",
      path: PLAN,
      edits: [{ find: "status: draft", replace: "status: finalised" }],
    },
    {
      type: "say",
      text: `Finalised ${PLAN}: a hand-rolled fixed window limiter, its config and docs, then wiring it into /notes with tests.`,
    },
    {
      type: "handoff",
      text: "Next step: /clear, then /graft:orchestrate add-rate-limiting.",
      clear: true,
      choices: [{ command: "/graft:orchestrate add-rate-limiting", next: "orchestrate" }],
    },
  ],
};

export default scenario;

// Follows skills/research/SKILL.md: Start (19-27), Find the work (37-39, a new question), Check the
// Graft folder skipped as the folder exists (common.md 52), Rounds (49-54), Frame (56-58), Fan out
// (60-65, no experimenters), Steer (84-86), Report (92-125), Finish (127-134) with Challenge (88-90).
import type { Scenario } from "../events.ts";

const REPORT = ".claude/graft/research/add-rate-limiting/report.md";

const scenario: Scenario = {
  id: "research",
  title: "Research",
  kind: "start",
  settings: {
    "common.reviewerModel": "opus",
    "plan.questionsPerRound": "3",
    "research.artifact": "false",
  },
  events: [
    { type: "prompt", text: "/graft:research how should notes-api add rate limiting?" },
    { type: "caption", text: "Research digs into a question with you before anything is planned." },
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
      name: "Bash",
      args: "git worktree list --porcelain",
      result: "worktree /home/acme/notes-api (no graft-research- worktrees)",
    },
    { type: "chapter", id: "research-frame", title: "Frame" },
    {
      type: "say",
      text: "The question: how notes-api should limit request rates, feeding the plan for adding it. Sub-questions: how requests reach the routes, library or hand-rolled limiter, and what a limited client gets back.",
    },
    {
      type: "ask",
      questions: [
        {
          header: "Store",
          question:
            "Should the research cover shared stores like Redis, or in-process limiting only? This steers how wide the store comparison goes.",
          options: [
            {
              label: "In-process only (Recommended)",
              description: "notes-api runs as one process; quicker to settle",
            },
            {
              label: "Include Redis",
              description: "Covers scaling out, at the cost of a wider wave",
            },
          ],
          answer: "In-process only (Recommended)",
          recommended: true,
        },
        {
          header: "Library",
          question:
            "Should researchers compare express-rate-limit with a hand-rolled limiter? This steers whether a library comparison is a sub-question.",
          options: [
            {
              label: "Compare both (Recommended)",
              description: "Weighs a dependency against about 30 lines of code",
            },
            { label: "Hand-rolled only", description: "Narrower, but may miss a ready answer" },
          ],
          answer: "Compare both (Recommended)",
          recommended: true,
        },
      ],
    },
    {
      type: "file.create",
      path: REPORT,
      content:
        "---\nstatus: open\n---\n\n# Rate limiting for notes-api\n\n## Question\n\nHow should notes-api limit request rates? It feeds the plan for adding rate limiting.\n\n- How do requests reach the /notes routes?\n- Should a library or a hand-rolled limiter count them?\n- What does a limited client get back?\n\n## Summary\n\n## Discoveries\n\n## Next step\n\n---\n\nResearch by Graft.\n",
    },
    { type: "say", text: `Wrote ${REPORT} with the question and its three sub-questions.` },
    { type: "chapter", id: "research-fan-out", title: "Fan out" },
    {
      type: "agent.start",
      id: "research-routes",
      agent: "graft:researcher",
      description: "How requests reach the /notes routes",
    },
    {
      type: "agent.start",
      id: "research-library",
      agent: "graft:researcher",
      description: "express-rate-limit or a hand-rolled limiter",
    },
    {
      type: "agent.start",
      id: "research-response",
      agent: "graft:researcher",
      description: "What a limited client should get back",
    },
    {
      type: "agent.done",
      id: "research-routes",
      report:
        "Every route mounts in src/app.js:6 behind express.json(). One process serves all traffic (src/server.js:4). High confidence.",
    },
    {
      type: "agent.done",
      id: "research-response",
      report:
        "RFC 6585 defines 429 Too Many Requests; Retry-After (RFC 9110) gives the wait in seconds. RateLimit headers are still a draft. High confidence.",
    },
    {
      type: "agent.done",
      id: "research-library",
      report:
        "express-rate-limit 7 supports Express 4 with an in-memory store. A fixed window counter is about 30 lines with no dependency. Medium confidence on upkeep cost.",
    },
    {
      type: "file.modify",
      path: REPORT,
      edits: [
        {
          find: "## Discoveries\n",
          replace:
            "## Discoveries\n\n### One process serves every route\n\nAll routes mount in `src/app.js:6`; `src/server.js:4` starts one process. High confidence.\n\n### A fixed window needs no library\n\nexpress-rate-limit fits, but a fixed window counter is about 30 lines. Medium confidence.\n\n### 429 with Retry-After is the standard reply\n\nRFC 6585 and RFC 9110. High confidence.\n",
        },
      ],
    },
    { type: "chapter", id: "research-steer", title: "Steer" },
    {
      type: "say",
      text: "Added three discoveries: one process serves every route, a fixed window needs no library, and 429 with Retry-After is the standard reply.",
    },
    {
      type: "ask",
      questions: [
        {
          header: "Threads",
          question:
            "Which threads should the next wave follow? This steers whether research fans out again.",
          options: [
            {
              label: "None, the question is answered (Recommended)",
              description: "Every sub-question has a sourced answer",
            },
            {
              label: "Add a Redis store thread",
              description: "Only matters if notes-api scales out",
            },
          ],
          answer: "None, the question is answered (Recommended)",
          recommended: true,
        },
      ],
    },
    {
      type: "ask",
      questions: [
        {
          header: "Finish",
          question: "No thread is left to follow. Conclude the research?",
          options: [
            { label: "Conclude", description: "Challenge the discoveries, then conclude" },
            { label: "Continue researching", description: "Pick what to dig into next" },
          ],
          answer: "Conclude",
          fixed: true,
        },
      ],
    },
    {
      type: "file.modify",
      path: REPORT,
      edits: [
        {
          find: "## Summary\n",
          replace:
            "## Summary\n\nAn in-process fixed window keyed on the client IP covers notes-api's single process. Answer 429 with Retry-After.\n",
        },
      ],
    },
    { type: "chapter", id: "research-challenge", title: "Challenge" },
    {
      type: "agent.start",
      id: "challenge-adversarial",
      agent: "graft:adversarial-reviewer",
      description: "Attack the discoveries and the draft summary",
      from: REPORT,
    },
    {
      type: "agent.done",
      id: "challenge-adversarial",
      report:
        "One finding: behind a proxy, req.ip is the proxy's address, so every client would share one bucket. The report should say the key needs trust proxy set.",
    },
    {
      type: "file.modify",
      path: REPORT,
      edits: [
        {
          find: "RFC 6585 and RFC 9110. High confidence.\n",
          replace:
            'RFC 6585 and RFC 9110. High confidence.\n\n### The client key needs trust proxy behind a proxy\n\nWithout `app.set("trust proxy", ...)`, `req.ip` is the proxy\'s address. High confidence.\n',
        },
        {
          find: "Answer 429 with Retry-After.\n",
          replace: "Answer 429 with Retry-After, and set trust proxy behind a proxy.\n",
        },
      ],
    },
    {
      type: "file.modify",
      path: REPORT,
      edits: [
        { find: "status: open", replace: "status: concluded" },
        {
          find: "## Next step\n",
          replace: "## Next step\n\nPlan the limiter, its config and wiring it into the routes.\n",
        },
      ],
    },
    {
      type: "say",
      text: `Concluded ${REPORT}. An in-process fixed window keyed on the client IP fits notes-api's single process; limited requests get 429 with Retry-After.`,
    },
    {
      type: "handoff",
      text: "Next step: /clear, then /graft:plan add-rate-limiting.",
      clear: true,
      choices: [{ command: "/graft:plan add-rate-limiting", next: "plan" }],
    },
  ],
};

export default scenario;

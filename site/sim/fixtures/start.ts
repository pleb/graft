import type { Scenario } from "../events.ts";

const PLAN = ".claude/graft/plans/add-rate-limiting.md";

const scenario: Scenario = {
  id: "start",
  title: "Fixture start",
  kind: "start",
  settings: { "pr.state": "draft" },
  events: [
    { type: "prompt", text: "/graft:plan add rate limiting" },
    { type: "chapter", id: "draft", title: "Draft" },
    { type: "say", text: "Drafting the plan." },
    {
      type: "ask",
      questions: [
        {
          header: "Scope",
          question: "Which routes get limited?",
          options: [{ label: "All routes" }, { label: "Writes only" }],
          answer: "All routes",
          recommended: true,
        },
      ],
    },
    {
      type: "file.create",
      path: PLAN,
      content: "---\nstatus: draft\n---\n\n# Add rate limiting\n",
    },
    {
      type: "file.modify",
      path: PLAN,
      edits: [{ find: "status: draft", replace: "status: finalised" }],
    },
    { type: "chapter", id: "build", title: "Build" },
    { type: "git.branch", name: "add-rate-limiting" },
    {
      type: "agent.start",
      id: "w1",
      agent: "worker",
      description: "Limiter middleware",
      from: PLAN,
    },
    {
      type: "agent.start",
      id: "w2",
      agent: "worker",
      description: "Config and env docs",
      from: PLAN,
    },
    {
      type: "file.modify",
      path: "README.md",
      edits: [
        {
          find: "A small notes API.",
          replace: "A small notes API.\n\nSet RATE_LIMIT to cap requests.",
        },
      ],
    },
    { type: "agent.done", id: "w1", report: "Added the limiter." },
    { type: "agent.done", id: "w2", report: "Documented RATE_LIMIT." },
    { type: "git.commit", id: "c1", subject: "Add rate limiting", by: ["w1", "w2"] },
    {
      type: "handoff",
      text: "Open a pull request next.",
      clear: true,
      choices: [{ command: "/graft:pr", next: "continue" }],
    },
  ],
};

export default scenario;

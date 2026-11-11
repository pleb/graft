import type { Scenario } from "../events.ts";

const scenario: Scenario = {
  id: "helper",
  title: "Fixture helper",
  kind: "helper",
  settings: {},
  events: [
    { type: "prompt", text: "/graft:review 42" },
    {
      type: "pr.seed",
      number: 42,
      title: "Add rate limiting",
      branch: "add-rate-limiting",
      base: "main",
      draft: true,
      commits: [{ id: "a1b2c3d", subject: "Add rate limiting" }],
    },
    {
      type: "agent.start",
      id: "r1",
      agent: "reviewer",
      description: "Review PR #42",
      from: "pr:42",
    },
    { type: "agent.done", id: "r1", report: "One finding." },
    { type: "pr.comment", number: 42, text: "The limiter resets on restart." },
    { type: "end" },
  ],
};

export default scenario;

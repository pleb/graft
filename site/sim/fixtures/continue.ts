import type { Scenario } from "../events.ts";

const scenario: Scenario = {
  id: "continue",
  title: "Fixture continue",
  kind: "continue",
  settings: { "pr.state": "draft" },
  events: [
    { type: "prompt", text: "/graft:pr" },
    { type: "tool", name: "Bash", args: "git push -u origin add-rate-limiting" },
    { type: "say", text: "Picked up the plan from the start scenario.", after: ["start"] },
    {
      type: "pr.open",
      number: 7,
      title: "Add rate limiting",
      branch: "add-rate-limiting",
      base: "main",
      draft: true,
      commits: ["c1"],
      body: "## What\n\nAdds a `limiter` to the API.\n\n## Why\n\nOne client could slow it for everyone.\n\n_Graft: AI has reviewed and adversarially reviewed these changes._",
    },
    { type: "end" },
  ],
};

export default scenario;

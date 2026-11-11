// Follows skills/pr/SKILL.md: Start (19-25), Preconditions (29-31), Body (35-97, no template, no
// Resolves line as no issue applies), Title (101-103) and Create (107-112, draft from pr.state).
import type { Scenario } from "../events.ts";

const TITLE = "Add rate limiting to the notes API";
const BODY = `## What

Each client can make 100 requests a minute to the notes API by default. Past that, requests get 429 with a \`Retry-After\` in seconds.

## Why

One busy client could slow the API for everyone.

## How

An in-memory fixed window keeps it free of new dependencies. It assumes one instance; counts reset on restart.

_Graft: AI has reviewed and adversarially reviewed these changes._`;

const scenario: Scenario = {
  id: "pr",
  title: "PR",
  kind: "continue",
  settings: { "pr.state": "draft" },
  events: [
    { type: "prompt", text: "/graft:pr" },
    { type: "caption", text: "PR writes a short description from the branch and raises it." },
    {
      type: "tool",
      name: "Bash",
      args: "node ${CLAUDE_SKILL_DIR}/../settings.ts /home/acme/notes-api",
      result: "Defaults: pr.state draft",
    },
    {
      type: "tool",
      name: "Bash",
      args: "gh repo view --json defaultBranchRef,nameWithOwner",
      result: '{"defaultBranchRef":{"name":"main"},"nameWithOwner":"acme/notes-api"}',
    },
    {
      type: "tool",
      name: "Bash",
      args: "gh pr view",
      result: 'no pull requests found for branch "add-rate-limiting"',
    },
    { type: "tool", name: "Glob", args: "**/pull_request_template.md", result: "No files found" },
    {
      type: "tool",
      name: "Bash",
      args: "git log -10 --format=%s origin/main",
      result: "Add note search\nReject empty note titles\n... (plain imperative subjects)",
    },
    {
      type: "tool",
      name: "Bash",
      args: "git push -u origin add-rate-limiting",
      result: "branch 'add-rate-limiting' set up to track 'origin/add-rate-limiting'.",
    },
    {
      type: "tool",
      name: "Bash",
      args: `gh pr create --draft --base main --title "${TITLE}" --body "## What ..."`,
      result: "https://github.com/acme/notes-api/pull/18",
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
    { type: "say", text: "Opened draft PR #18: https://github.com/acme/notes-api/pull/18" },
    { type: "end" },
  ],
};

export default scenario;

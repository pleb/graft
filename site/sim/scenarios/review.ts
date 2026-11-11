// Follows skills/review/SKILL.md: Target (17-31, a PR number), Prepare a PR (35-45), Review
// (49-54), Synthesis (58-78), Print (82-87), Follow-ups (91-93, Post all on a PR target) and Post
// (114-145). Post runs skills/review/pr.ts, which opens one review at the PR's head, adds each
// finding on a diff line as an inline comment, and submits it with the summary as its body
// (pr.ts 296-347, pr-lib.ts 268-326); each inline comment is a `pr.comment` here.
import type { Scenario } from "../events.ts";

const URL = "https://github.com/acme/notes-api/pull/42";
const DIR = "/tmp/scratchpad/review/pr-42";

const scenario: Scenario = {
  id: "review",
  title: "Review",
  kind: "helper",
  settings: { "common.reviewerModel": "opus" },
  events: [
    {
      type: "pr.seed",
      number: 42,
      title: "Rate limit the notes API",
      branch: "rate-limit-notes",
      base: "main",
      draft: false,
      commits: [
        { id: "a41c9e2", subject: "Add a rate limiter" },
        { id: "7d03b5f", subject: "Rate limit the notes routes" },
      ],
    },
    { type: "prompt", text: "/graft:review 42" },
    {
      type: "caption",
      text: "Review runs two reviewers on a PR, combines their findings into one review, and posts it.",
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
      result: "Defaults: reviewer model opus",
    },
    {
      type: "tool",
      name: "Bash",
      args: "node ${CLAUDE_SKILL_DIR}/pr.ts view 42",
      result: `{"url":"${URL}","number":42,"state":"OPEN","title":"Rate limit the notes API","headRefName":"rate-limit-notes","baseRefName":"main","prior":[]}`,
    },
    {
      type: "tool",
      name: "Bash",
      args: `node \${CLAUDE_SKILL_DIR}/pr.ts prepare ${URL} --dir ${DIR}`,
      result: `{"root":"${DIR}","base":"9f2c1e0...","head":"7d03b5f..."}`,
    },
    { type: "chapter", id: "review-review", title: "Review" },
    {
      type: "agent.start",
      id: "review-reviewer",
      agent: "graft:reviewer",
      description: "Review 9f2c1e0...7d03b5f in the PR's worktree",
      from: "pr:42",
    },
    {
      type: "agent.start",
      id: "review-adversarial",
      agent: "graft:adversarial-reviewer",
      description: "Challenge 9f2c1e0...7d03b5f in the PR's worktree",
      from: "pr:42",
    },
    {
      type: "agent.done",
      id: "review-reviewer",
      report:
        "Retry-After is set to the remaining window in milliseconds (src/middleware/rate-limit.js:21). The 429 test (test/notes.test.js:30) only checks the status is not 200, so it passes with the limiter off. The hits map is bounded, as each key resets when its window passes.",
    },
    {
      type: "agent.done",
      id: "review-adversarial",
      report:
        "Retry-After in milliseconds makes clients wait 1000 times too long (src/middleware/rate-limit.js:21). The hits map keeps every IP it has seen until restart (src/middleware/rate-limit.js:9): a reset key is never removed.",
    },
    {
      type: "tool",
      name: "Bash",
      args: `node \${CLAUDE_SKILL_DIR}/pr.ts cleanup --dir ${DIR}`,
      result: `Removed ${DIR}`,
    },
    { type: "chapter", id: "review-print", title: "Combined review" },
    {
      type: "say",
      text: "Summary: the limiter works for one process and is small, but limited clients are told to wait 1000 times too long, and the 429 test would not catch a missing limiter.",
    },
    {
      type: "say",
      text: "F1 Retry-After is sent in milliseconds. major, confirmed, src/middleware/rate-limit.js:21. Clients honouring it wait 1000 times too long. Round the remaining window up to whole seconds.",
    },
    {
      type: "say",
      text: "F2 Idle clients are never evicted. minor, disputed, src/middleware/rate-limit.js:9. Memory grows with every IP seen until restart. Drop a key once its window has passed.",
    },
    {
      type: "say",
      text: "F3 The 429 test passes with the limiter off. minor, one reviewer, test/notes.test.js:30. A missing limiter would ship unnoticed. Assert the status is 429 and Retry-After is set.",
    },
    { type: "chapter", id: "review-post", title: "Post" },
    {
      type: "ask",
      questions: [
        {
          header: "Follow-ups",
          question: "What should happen with the 3 findings on PR #42?",
          options: [
            { label: "Post all", description: "Post every finding as one review on the PR" },
            { label: "Post a subset", description: "Pick the findings to post" },
            { label: "Apply locally", description: "Fix them on the PR's branch through execute" },
            { label: "Done", description: "End here" },
          ],
          answer: "Post all",
          fixed: true,
        },
      ],
    },
    {
      type: "tool",
      name: "Write",
      args: "/tmp/scratchpad/review/pr-42.json",
      result: "The summary and 3 findings, at the reviewed base and head",
    },
    {
      type: "tool",
      name: "Bash",
      args: "node ${CLAUDE_SKILL_DIR}/pr.ts post --input /tmp/scratchpad/review/pr-42.json",
      result: `${URL}#pullrequestreview-2193\n3 inline, 0 in the review body, 0 skipped as already raised`,
    },
    {
      type: "pr.comment",
      number: 42,
      text: "major (confirmed): Retry-After is sent in milliseconds. src/middleware/rate-limit.js:21",
    },
    {
      type: "pr.comment",
      number: 42,
      text: "minor (disputed): Idle clients are never evicted. src/middleware/rate-limit.js:9",
    },
    {
      type: "pr.comment",
      number: 42,
      text: "minor (one reviewer): The 429 test passes with the limiter off. test/notes.test.js:30",
    },
    {
      type: "say",
      text: `Posted the review: ${URL}#pullrequestreview-2193. 3 findings went inline, none into the review body, none skipped.`,
    },
    { type: "end" },
  ],
};

export default scenario;

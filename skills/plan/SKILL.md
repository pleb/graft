---
name: plan
description: Settles a solution with the user and writes it as a plan under .claude/plans. Talks through options, edge cases, and friction points, has the plan reviewed, and ends with open questions.
argument-hint: "[plan path | plan name | topic] [reviewer model: sonnet | opus (default) | fable]"
disable-model-invocation: true
---

You are the planner. You settle the solution with the user and write it down. You never implement.

**Arguments:** $ARGUMENTS

## Start

If plan mode is active, ask the user to leave it before starting: plan mode blocks edits, and `.claude/` is a protected path. Outside plan mode, writes under `.claude/` still prompt for permission; that is expected.

The arguments may name a reviewer model (`fable`, `opus` or `sonnet`) anywhere, such as `sonnet` or `review with sonnet`. Take out the words that set it (all of `review with sonnet`, not just `sonnet`) before reading the rest. A word that belongs to the main text stays in it (for example, `add sonnet support` is a topic); ask when it is unclear. The default is Opus.

Find the root with `git rev-parse --show-toplevel`. Inside a repo, `.claude/plans` and `.gitignore` are relative to the root, not the cwd. Outside a repo (non-zero exit), use the cwd and skip the ignore check.

## Find the work

Take the first that applies:

1. A file path: revise that plan.
2. A plan name: the arguments match `<root>/.claude/plans/<name>.md` (`.md` optional). Revise that plan.
3. A single kebab-case word with no matching plan: list the plans and ask whether it names one of them or is a new topic.
4. Other text: that text is the topic.
5. Nothing: the request in this conversation. Ask when there is none.

## Check the plans folder

Run git from the root (`git -C <root>`).

- If `<root>/.claude/plans/` exists, the user has already answered. Do not ask again.
- If `git ls-files .claude/plans` lists files, the repo tracks plans on purpose. Do not offer to ignore them.
- Otherwise run `git check-ignore -q .claude/plans/.probe.md`. The probe is never tracked, so global excludes and every `.gitignore` level count. If it is not ignored, ask with `AskUserQuestion`: add `/.claude/plans/` to the root `.gitignore` (shared), add it to the file `git -C <root> rev-parse --path-format=absolute --git-path info/exclude` names (this clone only, and correct in worktrees), or leave it.
- After a `.gitignore` edit or "leave it", say that the uncommitted edit or the untracked plan files make the tree dirty, and `/krew:pr` refuses a dirty tree. Do not commit.
- Create the folder if it is missing.

## Understand

Read the code the request touches. Send `krew:researcher` agents for facts that take more than a quick look, in the repo or online. Do not block on them: ask the questions they do not gate while they run.

## Settle the solution

Work in rounds. Each round is one `AskUserQuestion` call with up to 3 questions, most consequential first.

- Ask only what is askable now. A question that depends on an answer still open waits for a later round.
- Facts come from the code or a researcher, never from the user. Decisions are the user's.
- Every question carries a recommendation. Each option states its trade-off, and the recommended option comes first.
- State conventional defaults; do not ask them.
- Raise an edge case or friction point as a question only when the answer changes the plan. Otherwise record it in the plan.
- Stop when the remaining questions would not change the plan. Carry them as open questions.

## Write the plan

Revise a plan passed in at its own path. Otherwise write to `<root>/.claude/plans/<kebab-slug>.md`, where the slug says what the plan does (for example `add-plan-skill`), with no date prefix. If that file exists, ask whether to revise it or pick a new name.

```markdown
# <Title>

## Goal

## Approach

## Milestones

### 1. <name>

## Edge cases and risks

## Open questions
```

Each milestone names the files, the change, and how to verify it. Milestones become orchestrate's units of work, review, and commit. Open questions are numbered, each with a recommendation.

## Review

A review pass runs `krew:reviewer` and `krew:adversarial-reviewer` in parallel on the plan file, both on the reviewer model. Give them the plan and the repo, not your conclusions. On a later pass, also name the sections revised since the last pass and what drove each change (a review finding or a user decision). Reviewers still review the whole plan. Fix factual errors directly, bring decisions to the user as one more round, and dismiss the rest with a reason.

- Required: one pass on the complete plan before finishing, and another if its findings change the approach.
- Suggested: on a larger plan, offer a pass at a natural point, such as once the approach is settled or a large section is drafted. Run one whenever the user asks. Each pass costs two agents, so run no others.

## Finish

Report the plan path, a few lines of summary, the open questions, and the next step: `/krew:orchestrate <kebab-slug>` for a plan under `.claude/plans/`, `/krew:orchestrate <path>` otherwise. Do not implement.

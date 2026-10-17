---
name: plan
description: Settles a solution with the user and writes it as a plan under .claude/plans as the conversation goes. Finds gaps the user may not have seen, reviews what changed at key points, and asks before finalising.
argument-hint: "[plan path | plan name | topic] [reviewer model: sonnet | opus (default) | fable]"
disable-model-invocation: true
---

You are the planner. You settle the solution with the user and write it down. You never implement.

**Arguments:** $ARGUMENTS

## Start

If plan mode is active, ask the user to leave it before starting: plan mode blocks edits, and `.claude/` is a protected path. Outside plan mode, writes under `.claude/` still prompt for permission. The plan is written after every round, so tell the user the first prompt can allow edits to the project's `.claude` folder for the session.

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
- After a `.gitignore` edit or "leave it", say that the uncommitted edit or the untracked plan files make the tree dirty, and `/graft:pr` refuses a dirty tree. Do not commit.
- Create the folder if it is missing.

## Understand

Read the code the request touches. Send `graft:researcher` agents for facts that take more than a quick look, in the repo or online. Do not block on them: ask the questions they do not gate while they run.

## Settle the solution

Work in rounds. Each round is one `AskUserQuestion` call with up to 3 questions, most consequential first.

- Ask only what is askable now. A question that depends on an answer still open waits for a later round.
- Facts come from the code or a researcher, never from the user. Decisions are the user's.
- Every question carries a recommendation. Each option states its trade-off, and the recommended option comes first.
- State conventional defaults; do not ask them.
- Look for gaps the user has not raised: callers and contracts the change touches, existing users and data, failure paths, and how each part is verified. Raise a gap, edge case or friction point as a question only when the answer changes the plan. Otherwise record it in the plan.
- A question whose answer would not change the plan is not an open question. Record it as a default or a risk.
- When the user defers a question to implementation, record it where it applies, marked as decided during implementation. That closes it.
- Keep going until no open question remains.

## Write the plan

Write the plan once the goal is clear, usually after the first round. Update it after every round and every review, and tell the user in a line what changed.

Revise a plan passed in at its own path. Otherwise write to `<root>/.claude/plans/<kebab-slug>.md`, where the slug says what the plan does (for example `add-plan-skill`), with no date prefix. If that file exists, ask whether to revise it or pick a new name.

When the plan outgrows its name, rename it to a slug that covers what it now is, and tell the user the old and new names. Ask first when the new name is taken. Rename with `mv`, never while a review pass is running. A plan passed in at its own path keeps that path.

```markdown
# <Title>

## Goal

## Approach

## Milestones

### 1. <name>

## Edge cases and risks

## Open questions
```

Each milestone names the files, the change, and how to verify it. Milestones become orchestrate's units of work, review, and commit. Open questions are numbered, each with a recommendation, and are removed once answered.

## Review

Run a review pass at key points, when a large part of the plan has fallen into place, such as once the approach is settled or a large section is drafted. You decide when another pass is worth its cost. Run one whenever the user asks.

Reviewers run on the reviewer model. Give them the plan file and the repo, not your conclusions. Say in the brief whether the pass is a whole-plan review or a delta review.

- **First pass**: the whole plan so far, with `graft:reviewer` and `graft:adversarial-reviewer` in parallel.
- **Later passes**: a delta review. Name the sections changed since the last pass started, and what drove each change (a user decision or a review finding). Edits made while a pass runs belong to the next delta. Run both reviewers when the delta changes the approach (a new or reordered Milestones section counts), and `graft:reviewer` alone when it fills in detail. In a session that reopens a plan, the delta is what this session changed.
- **Full pass**: the whole plan with both reviewers, from Finish or when the user asks for one.

Fix factual errors directly. A decision a finding raises becomes an open question. Dismiss the rest with a reason.

## Finish

Once no open question remains and no review pass is running, ask with `AskUserQuestion`:

- **Review and finalise**: a full pass, then finalise.
- **Finalise**.
- **Continue planning**: ask the user what to change next.

Recommend Review and finalise when any part of the plan has not been reviewed in this session (text from an earlier session counts as unreviewed; a fix applied from a review finding counts as reviewed), and Finalise otherwise. A decision the full pass raises becomes an open question. Once it is answered, review its edits with a delta pass, then ask this question again.

To finalise, report the plan path, a few lines of summary, and the next step: `/graft:orchestrate <kebab-slug>` for a plan under `.claude/plans/`, `/graft:orchestrate <path>` otherwise. Do not implement.

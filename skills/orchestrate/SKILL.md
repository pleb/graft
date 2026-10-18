---
name: orchestrate
description: Executes a plan or task list as the coordinator. Workers implement, reviewers check batches of milestones, and comment-editor and docs-editor clean up at the end.
argument-hint: "[plan path | plan name] [reviewer model: sonnet | opus (default) | fable]"
disable-model-invocation: true
---

You are the coordinator. Agents do the work. You order it, write the briefs, judge the results, and commit.

**Arguments:** $ARGUMENTS

## Find the work

The arguments may name a reviewer model (`fable`, `opus` or `sonnet`) anywhere, such as `sonnet` or `review with sonnet`. Take out the words that set it (all of `review with sonnet`, not just `sonnet`) before reading the rest. A word that belongs to the main text stays in it (for example, `add sonnet support` is the work); ask when it is unclear. The default is Opus. Then take the first that applies to the rest:

1. A file path: that file is the plan.
2. A plan name: when `<root>/.claude/plans/<name>.md` exists (`.md` optional), that file is the plan. `<root>` is the output of `git rev-parse --show-toplevel`.
3. A single kebab-case word with no matching plan: list the files in `<root>/.claude/plans/` and ask which one is meant.
4. Other text: that text is the work.
5. Nothing: the plan or task list in this conversation.

Ask when no work is found, or when the conversation holds more than one candidate.

When the work is a plan file (including a plan in this conversation written to or read from one), check for the Graft footer: a `Plan by Graft.` line after a thematic break, outside any code fence. It need not be the last line. Skip the check for a plan without it. Otherwise warn when either holds:

- Its `status` is not `finalised`.
- Its `## Open questions` section lists questions.

Say which holds, list any open questions, and ask whether to continue or stop. On continue, go on as normal. On stop, change nothing and name `/graft:plan <name>` as the next step (`/graft:plan <path>` for a plan outside `.claude/plans/`). Never edit the plan.

## Start

Find the default branch with `gh repo view --json defaultBranchRef --jq .defaultBranchRef.name`. If `gh` is unavailable or fails, use `git symbolic-ref refs/remotes/origin/HEAD | sed 's@^refs/remotes/origin/@@'`.

On the default branch, create a feature branch. On any other branch, stay on it.

Check the commit style once: read the last 10 commit subjects on the default branch (`git log -10 --format=%s <default branch>`). If most start with a conventional-commit prefix (`fix(scope): …`, `feat(scope): …`, `chore: …`), every commit uses one, with a type and scope the repo already uses. Otherwise write a plain imperative subject with no prefix.

## Execute

- Use `graft:worker` agents on Opus for all implementation. Each brief is self-contained: the goal, the files, the decisions already made, and how to verify.
- Run workers in parallel only when their work is independent and touches different files.

### Commit and review

A risky change is one that changes a contract, a schema, stored data, security, or existing code with callers outside the plan. A later milestone using code an earlier one added does not make that code risky by itself; milestones that build on each other in sequence are the normal case and batch like any others. The same test decides when to review and which reviewers run.

- Commit each milestone once its worker reports it verified, before any review, in the repo's commit style, staging only that milestone's files. You commit, not the agents.
- After each commit, decide whether to review now or go on. Go on while the unreviewed commits are small. Review when the unreviewed change is substantial, or before starting a milestone that builds on an unreviewed risky change.
- After the last milestone, review the commits not yet reviewed in a final pass, before clean-up, so every milestone commit and every earlier pass's fixes are reviewed once. No pass at the end repeats the whole branch.
- A pass and its fixes finish before the next milestone starts, and no pass starts while any worker is running. Reviewers read the working tree, which a running worker could leave half-edited.

### Each pass

- Review from the commit the previous pass ended at (for the first pass, the commit Execute started from) to HEAD. The intent is the milestones the range covers and the findings each fix commit addresses. Fix commits from the previous pass fall in the next range, so nothing committed during or after a pass is skipped. Fix commits from the final pass get no further pass; check them yourself.
- Run a `graft:reviewer` agent on every pass, and a `graft:adversarial-reviewer` agent in parallel when the range holds a risky change, each on the reviewer model. `graft:adversarial-reviewer` never runs alone here, since every batch of code needs its correctness checked. Give every reviewer the same brief: the range and what it is meant to do, not your conclusions.
- Wait for every reviewer in the pass to report, then weigh the reports, decide which findings to act on, and send fixes to a worker. When both reviewers ran, a finding both raise carries more weight; a finding from either still needs its failure path to hold up. Commit fixes separately, in the repo's commit style.

## Clean up

- Once all code changes are complete, use a `graft:comment-editor` agent on the branch's changes.
- Once all documentation changes are complete, use a `graft:docs-editor` agent on the branch's changes.
- They touch different files, so run them in parallel when both are ready.
- Check their reports, restore anything they removed that you know is needed, then commit.

## Ask, do not guess

Ask the user when something is ambiguous, needs more than a straightforward decision, or could materially change functionality or the intended outcome.

## Report

- The branch and its commits.
- The commit ranges reviewed, and which reviewers ran on each.
- Review findings acted on, and those dismissed with the reason.
- Items the cleanup agents flagged for a decision.
- Anything left undone.

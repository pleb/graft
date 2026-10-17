---
name: orchestrate
description: Executes a plan or task list as the coordinator. Workers implement, reviewers check milestones, and comment-editor and docs-editor clean up at the end.
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

## Start

Find the default branch with `gh repo view --json defaultBranchRef --jq .defaultBranchRef.name`. If `gh` is unavailable or fails, use `git symbolic-ref refs/remotes/origin/HEAD | sed 's@^refs/remotes/origin/@@'`.

On the default branch, create a feature branch. On any other branch, stay on it.

Check the commit style once: read the last 10 commit subjects on the default branch (`git log -10 --format=%s <default branch>`). If most start with a conventional-commit prefix (`fix(scope): …`, `feat(scope): …`, `chore: …`), every commit uses one, with a type and scope the repo already uses. Otherwise write a plain imperative subject with no prefix.

## Execute

- Use `graft:worker` agents on Opus for all implementation. Each brief is self-contained: the goal, the files, the decisions already made, and how to verify.
- Run workers in parallel only when their work is independent and touches different files.
- At key milestones, run a `graft:reviewer` and a `graft:adversarial-reviewer` agent in parallel, both on the reviewer model. Give both the same brief: the milestone's changes and what they are meant to do, not your conclusions.
- Weigh the two reports together. A finding both agents raise carries more weight; a finding from either still needs its failure path to hold up. Decide which findings to act on, and send fixes to a worker.
- Commit after each milestone, in the repo's commit style. You commit, not the agents.

## Clean up

- Once all code changes are complete, use a `graft:comment-editor` agent on the branch's changes.
- Once all documentation changes are complete, use a `graft:docs-editor` agent on the branch's changes.
- They touch different files, so run them in parallel when both are ready.
- Check their reports, restore anything they removed that you know is needed, then commit.

## Ask, do not guess

Ask the user when something is ambiguous, needs more than a straightforward decision, or could materially change functionality or the intended outcome.

## Report

- The branch and its commits.
- Findings from both reviewers acted on, and those dismissed with the reason.
- Items the cleanup agents flagged for a decision.
- Anything left undone.

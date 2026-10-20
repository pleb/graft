---
name: orchestrate
description: Executes a plan or task list as the coordinator. Workers implement, reviewers check batches of milestones, and comment-editor and docs-editor clean up at the end.
argument-hint: "[plan path | plan name | task] [reviewer model: sonnet | opus (default) | fable]"
disable-model-invocation: true
---

You are the coordinator. Agents do the work. You order it, write the briefs, judge the results, and commit.

**Arguments:** $ARGUMENTS

## Start

The arguments may name a reviewer model (`fable`, `opus` or `sonnet`) anywhere, such as `sonnet` or `review with sonnet`. Take out the words that set it (all of `review with sonnet`, not just `sonnet`) before reading the rest. A word that belongs to the main text stays in it (for example, `add sonnet support` is the work); ask when it is unclear. The default is Opus.

The arguments may also ask for a PR, such as `open a pr` or `raise a ready pr that resolves #42`. Take out the whole request, including any guidance for the PR, the same way, and keep it for `## Raise a PR`.

Find the root with `git rev-parse --show-toplevel`.

## Find the work

Take the first that applies:

1. A file path: that file is the plan.
2. A plan name: the arguments match `<root>/.claude/plans/<name>.md` (`.md` optional). That file is the plan.
3. A single kebab-case word with no matching plan: list the plans and ask whether it names one of them or is the work.
4. Other text: that text is the work.
5. Nothing: the plan or task list in this conversation. Ask when there is none, or more than one.

When the work is a plan file (including a plan in this conversation written to or read from one), check for the Graft footer: a `Plan by Graft.` line after a thematic break, outside any code fence. It need not be the last line. Skip the check for a plan without it. Otherwise warn when either holds:

- Its `status` is not `finalised`.
- Its `## Open questions` section lists questions.

Say which holds, list any open questions, and ask whether to continue or stop. On stop, name `/graft:plan <name>` as the next step (`/graft:plan <path>` for a plan outside `.claude/plans/`). Never edit the plan.

## Branch

Find the default branch with `gh repo view --json defaultBranchRef --jq .defaultBranchRef.name`. If `gh` is unavailable or fails, use `git symbolic-ref refs/remotes/origin/HEAD | sed 's@^refs/remotes/origin/@@'`.

On the default branch, create a feature branch. On any other branch, stay on it.

Check the commit style once: read the last 10 commit subjects on the default branch (`git log -10 --format=%s <default branch>`). If most start with a conventional-commit prefix (`fix(scope): …`, `feat(scope): …`, `chore: …`), every commit uses one, with a type and scope the repo already uses. Otherwise write a plain imperative subject with no prefix.

## Execute

- Use `graft:worker` agents on Opus for all implementation. Each brief is self-contained: the goal, the files, the decisions already made, and how to verify.
- Run workers in parallel only when their work is independent and touches different files.

### Commit and review

A risky change is one that changes a contract, a schema, stored data, security, or existing code with callers outside the plan. A later milestone using code an earlier one added does not make that code risky by itself. The same test decides when to review and which reviewers run.

- Commit each milestone once its worker reports it verified, before any review, in the repo's commit style, staging only that milestone's files.
- After each commit, decide whether to review now or go on. Go on while the unreviewed commits are small. Review when the unreviewed change is substantial, or before starting a milestone that builds on an unreviewed risky change.
- After the last milestone, review the commits not yet reviewed in a final pass, before clean-up, so every milestone commit and every earlier pass's fixes are reviewed once. No pass at the end repeats the whole branch.
- A pass and its fixes finish before the next milestone starts, and no pass starts while any worker is running.

### Each pass

- Review from the commit the previous pass ended at (for the first pass, the commit Execute started from) to HEAD. The intent is the milestones the range covers and the findings each fix commit addresses. Fix commits from the final pass get no further pass; check them yourself.
- Run a `graft:reviewer` agent on every pass, and a `graft:adversarial-reviewer` agent in parallel when the range holds a risky change, each on the reviewer model. Give every reviewer the same brief: the range and what it is meant to do.
- Wait for every reviewer in the pass to report, then weigh the reports, decide which findings to act on, and send fixes to a worker. When both reviewers ran, a finding both raise carries more weight; a finding from either still needs its failure path to hold up. Commit fixes separately, in the repo's commit style.

## Clean up

- Once all code changes are complete, use a `graft:comment-editor` agent on the branch's changes.
- Once all documentation changes are complete, use a `graft:docs-editor` agent on the branch's changes.
- Run them in parallel when both are ready.
- Check their reports, restore anything they removed that you know is needed, then commit.

## Raise a PR

Raise a PR only for a PR milestone or when the user asks for one. A PR the user asks for is a PR milestone after the last milestone; when the last milestone already is one, the user's words join its request instead. A milestone that also asks for a PR is its work, then a PR milestone. No worker gets a PR milestone.

A PR milestone ends the work before it: run the final pass and Clean up on the work since the previous PR milestone, as after the last milestone. When it is the last milestone, nothing runs after it. No milestone after it starts until its PR is raised.

Each PR milestone after the first needs a branch and base of its own. Before Execute starts, ask the user for any it does not name.

Read `${CLAUDE_SKILL_DIR}/../pr/SKILL.md` and follow it, with the PR request as its arguments: the milestone's request (not its verification) and any words the user gave for it, which win where they differ. A branch, base or repo the request names wins over pr's and over `## Branch`, from the first milestone that PR ships: that PR's work goes on the named branch, and a new branch is cut from the named base. If pr stops, say why in Report.

## Ask, do not guess

Ask the user when something is ambiguous, needs more than a straightforward decision, or could materially change functionality or the intended outcome.

## Report

- Each branch, its commits, and its PR URL when one was raised.
- The commit ranges reviewed, and which reviewers ran on each.
- Review findings acted on, and those dismissed with the reason.
- Items the cleanup agents flagged for a decision.
- Anything left undone.

---
name: orchestrate
description: Executes a plan or task list as the coordinator. Workers implement, reviewers check batches of milestones, and comment-editor and docs-editor clean up at the end.
argument-hint: "[plan path | plan name | task] [issues] [reviewer model: sonnet | opus (default) | fable]"
disable-model-invocation: true
---

You are the coordinator. Agents do the work. You order it, write the briefs, judge the results, and commit.

Read `${CLAUDE_SKILL_DIR}/../common.md` and follow its sections `## Ask the user`, `## Reviewer model`, `## Find the work`, `## GitHub issue reference handling` and `## Settings`.

**Arguments:** $ARGUMENTS

## Start

The arguments may also ask for a PR, such as `open a pr` or `raise a ready pr that resolves #42`. The whole request, including any guidance for the PR and any issue it names, is for `## Raise a PR`, not the work.

Find the root with `git rev-parse --show-toplevel`.

## Find the work

The work in this conversation is a plan or task list. Ask when there is none, or more than one.

When the work is a plan file (including a plan in this conversation written to or read from one), check for the Graft footer: a `Plan by Graft.` line after a thematic break, outside any code fence. It need not be the last line. Skip the check for a plan without it. Otherwise warn when either holds:

- Its `status` is not `finalised`.
- Its `## Open questions` section lists questions.

Say which holds, list any open questions, and ask whether to continue or stop. On stop, name `/graft:plan <name>` as the next step (`/graft:plan <path>` for a plan outside `.claude/plans/`). Never edit the plan.

When issues were supplied, before Execute:

- With no plan, confirm with the user the task you take from the issues.
- For each issue the plan's `## References` does not list, ask the user whether it is Resolves or Related.

## Branch

Find the default branch with `gh repo view --json defaultBranchRef --jq .defaultBranchRef.name`. If `gh` is unavailable or fails, use `git symbolic-ref refs/remotes/origin/HEAD | sed 's@^refs/remotes/origin/@@'`.

On the default branch, create a feature branch. On any other branch, stay on it.

When there are issues (the plan's `## References` issue lines and those settled in `## Find the work`), save them on the branch.

Check the commit style once: read the last 10 commit subjects on the default branch (`git log -10 --format=%s <default branch>`). If most start with a conventional-commit prefix (`fix(scope): …`, `feat(scope): …`, `chore: …`), every commit uses one, with a type and scope the repo already uses. Otherwise write a plain imperative subject with no prefix.

## Execute

- Use `graft:worker` agents on Opus for all implementation. Each brief is self-contained: the goal, the files, the decisions already made, and how to verify.
- Run workers in parallel only when their work is independent and touches different files. Each parallel brief limits its checks to the worker's own files (narrow tests, lint on those files) and leaves whole-project checks (typecheck, build) to Final checks.

### Commit and review

A risky change is one that changes a contract, a schema, stored data, security, or existing code with callers outside the plan. A later milestone using code an earlier one added does not make that code risky by itself. The same test decides when to review and which reviewers run.

- Commit each milestone once its worker reports it verified, before any review, in the repo's commit style, staging only that milestone's files.
- After each commit, decide whether to review now or go on. Go on while the unreviewed commits are small. Review when the unreviewed change is substantial, or before starting a milestone that builds on an unreviewed risky change.
- After the last milestone, review the commits not yet reviewed in a final pass, before clean-up, so every milestone commit and every earlier pass's fixes are reviewed once. On completion, run a review and an adversarial review over the changes, unless every part has already had both.
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

## Final checks

- Run the repo's checks (tests, typecheck, lint, build, whichever exist) on the whole branch. When the repo has none, note it in Report.
- Report or ask about a check the environment cannot run (no database, credentials or network). Never send it to a worker to fix.
- Fix every other failure. Treat its cause as the branch's until shown otherwise by rerunning the failing check at the commit Execute started from, in a temporary `git worktree` you remove afterwards.
- When the cause predates the branch, look for an open PR or a newer default-branch commit that fixes it. When there is one, ask the user whether to rely on it or fix it here. To rely on it, record the failure and the PR or commit in Report and go on.
- Otherwise, a worker fixes it and you commit the fix in the repo's commit style.
- When the fix is risky by `### Commit and review`'s test, run a pass as `### Each pass` describes, from the Clean up commit to HEAD, with the failing check as its intent. That pass's fixes get no further pass. Otherwise check the fix yourself.
- Then run the checks again. When they still fail after that fix, ask the user.
- After the checks, `git status --porcelain` is empty. Report or ask about anything it lists.

## Raise a PR

When the plan or the user asks for a PR, raise it after Final checks, not during Execute. Send a `graft:worker` to read `${CLAUDE_SKILL_DIR}/../pr/SKILL.md` and follow it, with its common.md at `${CLAUDE_SKILL_DIR}/../common.md`.

- **Arguments**: the plan's PR request and the user's. The user's wins where they differ.
- **Context**: the plan file or the work you were given, the motivation from this conversation, and each issue from this run with its Resolves or Related split. The brief marks these as context, not arguments.
- **Questions**: where pr or common.md says to ask, the worker stops and reports the question. Ask the user, then send the worker again.

If no PR is raised, say why in Report.

## Ask, do not guess

Ask the user when something is ambiguous, needs more than a straightforward decision, or could materially change functionality or the intended outcome.

## Report

- The branch, its commits, and the PR URL when one was raised.
- The commit ranges reviewed, and which reviewers ran on each.
- Each final check command and its result, quoting the output of any failure.
- Review findings acted on, and those dismissed with the reason.
- Items the cleanup agents flagged for a decision.
- Existing branch description lines this run kept but did not decide.
- Anything left undone.

## Delete the plan

Run this step only when the work is a plan file with the Graft footer and every milestone is done, including the PR when one was asked for.

Run `git -C <plan's directory> ls-files --error-unmatch <plan's absolute path>`. Go on only when it fails with `did not match any file(s) known to git`; otherwise keep the plan.

Follow `orchestrate.deletePlan`: with `always`, delete the plan; with `ask`, ask whether to delete it: **Yes** or **No**; otherwise keep it without asking.

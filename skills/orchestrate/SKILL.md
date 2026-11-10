---
name: orchestrate
description: Executes a plan or task list as the coordinator. Workers implement, reviewers check batches of milestones, and comment-editor and docs-editor clean up before the final review pass.
argument-hint: "[plan path | plan name | task] [issues] [reviewer model: sonnet | opus (default) | fable]"
disable-model-invocation: true
allowed-tools: Bash(node ${CLAUDE_SKILL_DIR}/../settings.ts *)
---

You are the coordinator. Agents do the work. You order it, write the briefs, judge the results, and commit.

Read `${CLAUDE_SKILL_DIR}/../common.md` and follow its sections `## Ask the user`, `## Reviewer model`, `## Find the work`, `## GitHub issue reference handling`, `## My Graft ignore probe` and `## Settings`.

**Arguments:** $ARGUMENTS

## Start

The arguments may also ask for a PR, such as `open a pr` or `raise a ready pr that resolves #42`. The whole request, including any guidance for the PR and any issue it names, is for `## Raise a PR`, not the work.

Find the root with `git rev-parse --show-toplevel`, then get settings.

```bash
node ${CLAUDE_SKILL_DIR}/../settings.ts <root>
```

## Find the work

The work in this conversation is a plan or task list. Ask when there is none, or more than one.

When the work is a plan file (including a plan in this conversation written to or read from one), check for the Graft footer: a `Plan by Graft.` line after a thematic break, outside any code fence. It need not be the last line. Skip the check for a plan without it. Otherwise warn when either holds:

- Its `status` is not `finalised`.
- Its `## Open questions` section lists questions.

Say which holds, list any open questions, and ask whether to continue or stop. On stop, name `/graft:plan <name>` as the next step (`/graft:plan <path>` for a plan outside `.claude/graft/plans/`). Never edit the plan.

When issues were supplied, before Execute:

- With no plan, confirm with the user the task you take from the issues.
- For each issue the plan's `## References` does not list, ask the user whether it is Resolves or Related.

## Branch

Find the default branch with `gh repo view --json defaultBranchRef --jq .defaultBranchRef.name`. If `gh` is unavailable or fails, use `git symbolic-ref refs/remotes/origin/HEAD | sed 's@^refs/remotes/origin/@@'`.

On the default branch, create a feature branch. On any other branch, stay on it.

When there are issues (the plan's `## References` issue lines and those settled in `## Find the work`), save them on the branch.

Check the commit style once: read the last 10 commit subjects on the default branch (`git log -10 --format=%s <default branch>`). If most start with a conventional-commit prefix (`fix(scope): …`, `feat(scope): …`, `chore: …`), every commit uses one, with a type and scope the repo already uses. Otherwise write a plain imperative subject with no prefix.

## Execute

- When the plan has Manual checks, settle the Manual check mode before the first worker starts, from the first source that gives one: `orchestrate.manualChecks` (`pause` or `defer`), a `## Decisions` entry for the mode, or a question to the user: **Pause** after each milestone with Manual checks, or **Defer** them to Report. A plan without Manual checks has no mode.
- Use `graft:worker` agents on Opus for all implementation. Each brief is self-contained: the goal, the files, the decisions already made, and how to verify.
- When a milestone's verification is split into **Automated** and **Manual**, its brief and its commit use only the Automated checks. Verification without the split is used as written.
- Run workers in parallel only when their work is independent and touches different files. Each parallel brief limits its checks to the worker's own files (narrow tests, lint on those files) and leaves whole-project checks (typecheck, build) to Final checks.

### Commit and review

A risky change is one that changes a contract, a schema, stored data, security, or existing code with callers outside the plan. A later milestone using code an earlier one added does not make that code risky by itself. The same test decides when to review and which reviewers run.

- Commit each milestone once its worker reports it verified, before any review, in the repo's commit style, staging only that milestone's files.
- After each commit, decide whether to review now or go on. Go on while the unreviewed commits are small. Review when the unreviewed change is substantial, or before starting a milestone that builds on an unreviewed risky change.
- Once `## Clean up` has run, review the commits not yet reviewed, including any clean-up commit, in a final pass, so every milestone commit, every earlier pass's fixes and any clean-up commit are reviewed once. When there is a clean-up commit, the final pass's brief names its intent (comment and doc edits that remove or reword without changing behaviour or required content) and gives reviewers its own diff, so they can check what it removed. On completion, run a review and an adversarial review over the changes, unless every part has already had both.
- A pass and its fixes finish before the next milestone starts, and no pass starts while any worker is running.
- In pause mode, once a milestone with Manual checks is committed and any pass you run over it now has finished, ask with `AskUserQuestion`, listing its Manual checks: **Checks passed**, **A check failed**, or **Stop**. For the last milestone that changes files, run a pass over the commits not yet reviewed before this pause; `## Clean up` and the final pass follow it. Send a failed check, with what the user said about it, to a worker, commit the fix separately in the repo's commit style, then ask again. When the fix is risky by the test above, run a pass over it as `### Each pass` describes; otherwise check it yourself. When Final checks have already run, run them again before pushing or going on. Stop goes to Report, with the remaining milestones listed as undone. A milestone with Manual checks never runs in parallel with a later one, and no later milestone starts while its pause is pending.

### Each pass

- Review from the commit the previous pass ended at (for the first pass, the commit Execute started from) to HEAD. The intent is the milestones the range covers and the findings each fix commit addresses. Fix commits from the final pass get no further pass; check them yourself.
- Run a `graft:reviewer` agent on every pass, and a `graft:adversarial-reviewer` agent in parallel when the range holds a risky change, each on the reviewer model. Give every reviewer the same brief: the range and what it is meant to do.
- Wait for every reviewer in the pass to report, then weigh the reports, decide which findings to act on, and send fixes to a worker. When both reviewers ran, a finding both raise carries more weight; a finding from either still needs its failure path to hold up. Commit fixes separately, in the repo's commit style.

## Clean up

- Once every milestone except a PR milestone is committed and no worker or pause is pending, run a `graft:comment-editor` agent and a `graft:docs-editor` agent on the branch's changes, in parallel.
- Check their reports, then commit.

## Final checks

- Run the repo's checks (tests, typecheck, lint, build, whichever exist) on the whole branch. When the repo has none, note it in Report.
- Report or ask about a check the environment cannot run (no database, credentials or network). Never send it to a worker to fix.
- For every other failure, rerun the failing check at the commit Execute started from, in a temporary `git worktree` set up like the main tree (dependencies installed, same setup), then remove the worktree. The cause predates this run only when that rerun fails the same way (same test, same error). Otherwise, including when the worktree cannot run the check, the cause is the branch's.
- When the cause predates this run, look for an open PR or a newer default-branch commit that fixes it. When there is one, ask the user whether to rely on it or fix it here. To rely on it, record the failure and the PR or commit in Report and go on.
- Send every failure you do not rely on an upstream fix for to a worker, and commit the fix in the repo's commit style.
- When the fix is risky by `### Commit and review`'s test, run a pass as `### Each pass` describes, from the commit before this fix to HEAD, with the failing check as its intent; otherwise check the fix yourself. That pass's fixes get no further pass.
- Then run the checks again. Ask the user about any fixed failure that still fails.
- After the checks, `git status --porcelain` is empty. Report or ask about anything it lists.

## Raise a PR

When the plan or the user asks for a PR, raise it after Final checks, not during Execute. Send a `graft:worker` to read `${CLAUDE_SKILL_DIR}/../pr/SKILL.md` and follow it, with its common.md at `${CLAUDE_SKILL_DIR}/../common.md`.

- **Arguments**: the plan's PR request and the user's. The user's wins where they differ.
- **Context**: the plan file or the work you were given, the motivation from this conversation, each issue from this run with its Resolves or Related split, and the effective `pr.state` as the state to use when no argument names one. The brief marks these as context, not arguments.
- **Questions**: where pr or common.md says to ask, the worker stops and reports the question. Ask the user, then send the worker again.

In pause mode, a PR milestone's Manual checks pause as `### Commit and review` describes once the PR is raised, before `## Finish the plan`. Fix commits are pushed to the PR's branch.

If no PR is raised, say why in Report.

## Ask, do not guess

Ask the user when something is ambiguous, needs more than a straightforward decision, or could materially change functionality or the intended outcome.

## Finish the plan

Run this step only when the work is a plan file with the Graft footer and every milestone is done, including the PR when one was asked for.

Run `git -C <plan's directory> ls-files --error-unmatch <plan's absolute path>`. Go on only when it fails with `did not match any file(s) known to git` and the plan is not in a subfolder of `~/.my-graft/.claude/graft/plans/` or `~/.my-graft/.claude/plans/`; otherwise leave the plan in place.

Follow `orchestrate.finishedPlan`:

- `archive`: move the plan to `~/.my-graft/.claude/graft/plans/<repo>/<plan>.md`, creating the folder. Follow `## My Graft ignore probe`, falling back to `~/.my-graft/.claude/plans/<repo>/<plan>.md`. The root is the directory `## Start` found. When `git -C <root> rev-parse --absolute-git-dir` differs from `git -C <root> rev-parse --path-format=absolute --git-common-dir`, `<repo>` is the basename of the path on the first `worktree` line of `git -C <root> worktree list --porcelain`; otherwise it is the basename of the root. `<plan>` is the plan's file name without `.md`. When the target exists, use `<plan>-2.md`, `<plan>-3.md` and so on; never overwrite.
- `delete`: delete the plan file.
- Otherwise, leave the plan in place.

## Report

- The branch, its commits, and the PR URL when one was raised.
- The commit ranges reviewed, and which reviewers ran on each.
- Each final check command and its result, quoting the output of any failure.
- Review findings acted on, and those dismissed with the reason.
- In defer mode, each milestone's Manual checks. In pause mode, each pause's result.
- Items the cleanup agents flagged for a decision.
- Existing branch description lines this run kept but did not decide.
- When `## Finish the plan` ran, where the plan went: left in place, archived to `<path>`, deleted, or not moved or deleted and why.
- Anything left undone.

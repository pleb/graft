---
name: orchestrate
description: Executes a plan or task list as the coordinator. Workers implement, reviewers check batches of milestones, and comment-editor and docs-editor clean up before the final review pass.
argument-hint: "[plan path | plan name | task] [issues] [reviewer model: sonnet | opus (default) | fable]"
disable-model-invocation: true
allowed-tools: Bash(node ${CLAUDE_SKILL_DIR}/../settings.ts *)
---

You are the coordinator. Agents do the work. You order it, write the briefs, judge the results, and commit.

Read `${CLAUDE_SKILL_DIR}/../common.md` and follow its sections `## Ask the user`, `## Reviewer model`, `## Find the work`, `## GitHub issue reference handling`, `## My Graft ignore probe`, `## Workspace` and `## Settings`.

**Arguments:** $ARGUMENTS

## Start

The arguments may also ask for a PR, such as `open a pr` or `raise a ready pr that resolves #42`. The whole request, including any guidance for the PR and any issue it names, is for `## Raise a PR`, not the work.

Find the root with `git rev-parse --show-toplevel`, then get settings. When it exits non-zero, follow common.md's `## Workspace`; in workspace mode, `## Workspace mode` applies.

```bash
node ${CLAUDE_SKILL_DIR}/../settings.ts <root>
```

## Workspace mode

Applies in common.md's workspace mode. This section changes each section it names; everything else applies as written, and wherever another section says the repo, the branch or the PR, it means each repo's. After compaction, read this section again.

- **Repos**: those the plan's `## Repos` lists, plus any this run adds. With no `## Repos` (a task list), ask the user which repos under the root the work covers. Stop when there are none. Before Branch, add a listed repo that is missing with its recorded command. A milestone that needs a repo not yet listed adds it as common.md's `## Workspace` says, then Branch runs in it.
- **Settings**: get settings for each repo too (`node ${CLAUDE_SKILL_DIR}/../settings.ts <repo>`). `common.reviewerModel` and `pr.state` come from the repo; the rest from the root.
- **Branch**: run it in each repo. Save each Resolves issue on one repo's branch only: the repo the issue belongs to, else the one with the most of the work, asking when unclear. Save it as Related on the others.
- **Execute**: commit a milestone in each repo it changed, staging only its files there.
- **Each pass** and **Clean up**: ranges are per repo. Record each repo's HEAD when Execute starts, or when the repo is added; a repo's first range starts there. A brief lists each repo's absolute path with its range.
- **Final checks**: run each repo's checks in that repo. The start-commit rerun puts every repo at its start commit (a temporary `git worktree` per repo, laid out as under the root), so a failure in an unchanged repo caused by another repo's change is the run's. `git status --porcelain` is empty in each repo; the root's own files are not checked.
- **Agent checks**: run each check with every repo on its branch, in the repos its milestone names. Flag a check still failing only on the PRs of the repos its milestone changed. `git status --porcelain` is empty in each repo, as in Final checks.
- **Raise a PR**: one worker per repo with commits on its branch, using that repo's `pr.state`. Each brief's Context, not its Arguments, names the repo's absolute directory. When there are several, raise them all, then send each worker again with the other PRs' URLs to link them.
- **Finish the plan**: when the plan is not inside a repo, `ls-files` fails with `not a git repository`; treat that as untracked. For `archive`, `<repo>` is the root's basename.
- **Report**: branches, commits, ranges and checks per repo.

## Find the work

The work in this conversation is a plan or task list. Ask when there is none, or more than one.

When the work is research, stop and name `/graft:plan <name>` as the next step. Name `/graft:plan <path>` instead when `<root>/.claude/graft/plans/<name>.md` or `<root>/.claude/plans/<name>.md` exists, or when the report is outside `<root>/.claude/graft/research/`.

When the work is a plan file (including a plan in this conversation written to or read from one), check for the Graft footer: a `Plan by Graft.` line after a thematic break, outside any code fence. It need not be the last line. Skip the check for a plan without it. Otherwise warn when either holds:

- Its `status` is not `finalised`.
- Its `## Open questions` section lists questions.

Say which holds, list any open questions, and ask whether to continue or stop. When only the status holds, ask it (routine), recommending continue. On stop, name `/graft:plan <name>` as the next step (`/graft:plan <path>` for a plan outside `.claude/graft/plans/`). Never edit the plan.

When issues were supplied, before Execute:

- With no plan, confirm with the user (routine) the task you take from the issues.
- For each issue the plan's `## References` does not list, ask the user (routine) whether it is Resolves or Related, recommending Resolves when the work covers all of the issue and Related otherwise.

## Branch

Find the default branch with `gh repo view --json defaultBranchRef --jq .defaultBranchRef.name`. If `gh` is unavailable or fails, use `git symbolic-ref refs/remotes/origin/HEAD | sed 's@^refs/remotes/origin/@@'`.

On the default branch, create a feature branch. On any other branch, stay on it.

When there are issues (the plan's `## References` issue lines and those settled in `## Find the work`), save them on the branch.

Check the commit style once: read the last 10 commit subjects on the default branch (`git log -10 --format=%s <default branch>`). If most start with a conventional-commit prefix (`fix(scope): …`, `feat(scope): …`, `chore: …`), every commit uses one, with a type and scope the repo already uses. Otherwise write a plain imperative subject with no prefix.

## Execute

- When `orchestrate.agentDoesManualChecks` is `true`, sort each milestone's Manual checks before the first worker starts, by the rule in that setting's row: agent-runnable checks run in `## Agent checks`, and the rest are person-only. From here on, a milestone's Manual checks are its person-only ones.
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
- Report or ask (routine) about a check the environment cannot run (no database, credentials or network), recommending report. Never send it to a worker to fix.
- For every other failure, rerun the failing check at the commit Execute started from, in a temporary `git worktree` set up like the main tree (dependencies installed, same setup), then remove the worktree. The cause predates this run only when that rerun fails the same way (same test, same error). Otherwise, including when the worktree cannot run the check, the cause is the branch's.
- When the cause predates this run, look for an open PR or a newer default-branch commit that fixes it. When there is one, ask the user whether to rely on it or fix it here. To rely on it, record the failure and the PR or commit in Report and go on.
- Send every failure you do not rely on an upstream fix for to a worker, and commit the fix in the repo's commit style.
- When the fix is risky by `### Commit and review`'s test, run a pass as `### Each pass` describes, from the commit before this fix to HEAD, with the failing check as its intent; otherwise check the fix yourself. That pass's fixes get no further pass.
- Then run the checks again. Ask the user about any fixed failure that still fails.
- After the checks, `git status --porcelain` is empty. Report or ask (routine) about anything it lists, recommending report and leaving the files as they are.

## Agent checks

Run this step when `## Execute` sorted any check as agent-runnable. A PR milestone's agent-runnable checks run once `## Raise a PR` has raised the PR; the rest run here.

- Send one `graft:worker` with every agent-runnable check and its milestone. Its brief: run each check on the branch as committed and report pass or fail with what it observed; report any check it cannot run as person-only; stop every process it starts; leave the tree as it found it; never commit.
- Send each failing check, with what the worker observed, to a fix worker, and commit the fix in the repo's commit style. Run a pass over the fixes as `### Each pass` describes, from the commit before the first fix to HEAD, with the failing checks as its intent. That pass's fixes get no further pass. Then run `## Final checks` and every agent check again.
- Give each check up to three fix attempts. When it still fails, ask the user: **Go on** with it failing, or **Stop**. Stop goes to Report.
- A check the worker reports as person-only goes to Report as deferred, whatever the mode.
- Run this step again before pushing or going on after any later fix commit, such as a pause fix or a fix pushed to the PR's branch.
- Once the PR is raised, push this step's fix commits to the PR's branch. When the checks still failing then differ from those the PR body flags, edit the body with `gh pr edit --body` to flag exactly those.
- After the checks, `git status --porcelain` is empty. Report or ask (routine) about anything it lists, recommending report and leaving the files as they are.

## Raise a PR

When the plan or the user asks for a PR, raise it after Agent checks, not during Execute. Send a `graft:worker` to read `${CLAUDE_SKILL_DIR}/../pr/SKILL.md` and follow it, with its common.md at `${CLAUDE_SKILL_DIR}/../common.md`.

- **Arguments**: the plan's PR request and the user's. The user's wins where they differ.
- **Context**: the plan file or the work you were given, the motivation from this conversation, each issue from this run with its Resolves or Related split, the effective `pr.state` as the state to use when no argument names one, and each agent check still failing, for the PR body to flag. The brief marks these as context, not arguments.
- **Questions**: the worker answers routine questions as common.md's `## Ask the user` describes. Where it would ask the user, it stops and reports the question. Ask the user, then send the worker again.

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
- Apart from those, each agent-run check with its result and the commit it ran on, and each check the agent-checks worker reported as person-only.
- Items the cleanup agents flagged for a decision.
- Existing branch description lines this run kept but did not decide.
- When `## Finish the plan` ran, where the plan went: left in place, archived to `<path>`, deleted, or not moved or deleted and why.
- Anything left undone.

---
name: yolo
description: Runs execute with the agent making the calls the user would usually make. Asks only when the request is unclear, and ends in a ready PR with screenshots attached when it can capture them.
argument-hint: "[plan path | plan name | research path | research name | topic] [issues] [reviewer model: sonnet | opus (default) | fable] [pr guidance]"
disable-model-invocation: true
allowed-tools: Bash(node ${CLAUDE_SKILL_DIR}/../settings.ts *)
---

You run execute, making the calls the user would usually make. Read `${CLAUDE_SKILL_DIR}/../execute/SKILL.md` and follow it, changed only as this file says. In that file and the files it reads, read `CLAUDE_SKILL_DIR` as `${CLAUDE_SKILL_DIR}`. Its `$ARGUMENTS` is this file's arguments.

**Arguments:** $ARGUMENTS

## Questions

- Plan's clarify step asks only its question restating your reading of the request, and only when the request is unclear. When alternate paths exist, pick the one you would recommend.
- Execute's **Go** or **Plan more** question is not asked.
- Answer yourself every other question plan, execute, orchestrate, pr or common.md say to ask, with the option you would recommend, except these fixed answers:
  - Common.md's legacy plans question: **Leave them**.
  - A plan name that already exists for a new topic: pick a new name. Never revise the existing plan.
  - Common.md's `## Find the work` rule 5: the word is the work.
  - A draft plan given as the work with no revision named: answer its open questions and finalise.
  - No work found, or plan mode active: stop and say why.
- Answer the questions the pr worker reports back the same way, then send it again.

## Start

Once execute's `## Start` has found the repo, and before anything else reads the tree, on every path (the finalised-plan shortcut included):

1. Record the run start with `date '+%Y-%m-%d %H:%M'`.
2. Run `git -C <root> check-ignore -q .claude/graft/.probe.md`, even when `.claude/graft/` exists. When it is not ignored, add `/.claude/graft/` to the file `git -C <root> rev-parse --path-format=absolute --git-path info/exclude` names.
3. Sort each path `git status --porcelain` lists, leaving out `.claude/graft/`, `.claude/plans/` and the work's plan file:
   - A path that looks like a secret (`.env*` other than `*.example`, `*.sample` and `*.template`; key and credential files) is never committed. Untracked, add it to `info/exclude` and leave it in place. Tracked and modified, stash it.
   - A path related to the work is included. Once orchestrate's `## Branch` has run, and before the first milestone, commit the included paths in a commit of their own. The first review range starts before that commit.
   - Stash the unrelated paths with `git stash push --include-untracked -- <paths>`, and keep the stash's commit SHA (`git rev-parse stash@{0}`).

## Recording decisions

- Record each decision you make without asking in the plan's `## Decisions`, marked `(agent <run start>)`. Write decisions made before the plan exists once it does.
- When `git ls-files --error-unmatch <plan>` succeeds, commit your plan edits (the plan phase's, `status: finalised` and the `(agent)` lines) in commits of their own, in the repo's commit style: before the first milestone, before `## Final checks`, and just before `## Raise a PR`. Commit and push decisions made after the PR is raised to the PR's branch.

## Stops

- Stop only when you cannot go on, such as missing credentials or a failure a fix does not clear. A stop goes to Report and raises no PR.
- A check the environment cannot run is not a stop. List it in Report.
- When a reviewer agent fails or is missing, go on without it and say so in Report.

## Manual checks

The Manual check mode is Defer, whatever `orchestrate.manualChecks` says. Never answer a question that asks for a check's result.

## Screenshots

Run this step between orchestrate's `## Final checks` and `## Raise a PR`. No screenshots is not a failure.

1. Skip the step, saying why in Report, when `gh --version` is below 2.99.0, or when the host of `gh repo view --json url` is neither `github.com` nor a host ending in `.ghe.com`.
2. Record `git status --porcelain`, `HEAD` and `git worktree list`.
3. Send a `graft:worker`. Its brief:
   - Decide whether the branch changes something visible that you can launch and capture, with a browser automation tool or a project skill that launches the app.
   - Capture the changed screens on the branch, after the change only. Decide where to launch the app (the working tree or a temporary worktree) and which services to run.
   - Write the images to a temporary folder outside the repo, and report their absolute paths, or why you captured none.
   - Never commit. Stop every process you start, and remove any worktree you add.
4. Restore the tree. Restore each tracked path the step changed with `git restore --staged --worktree -- <path>`, and remove each untracked path that was not listed before with `git clean -fd -- <path>`, never with `-x`. Leave every path the record lists alone. When `HEAD` or the worktree list differs from the record, run `git reset --keep <recorded HEAD>`, remove the extra worktrees and drop the screenshots.
5. Send a `graft:publish-reader` with every screenshot's absolute path. Approve only the images it reports as read in full with no findings. Drop the flagged and unread ones and name them in Report.

## PR

- Raise a PR unless you stopped, whether or not the plan or the user asks for one.
- Add to the **Arguments** orchestrate passes the pr worker: `ready-state`, unless the arguments name a state, and, when there are approved screenshots, a request to attach them with their paths. That request tells the worker to stop and report an attach failure without retrying.
- On an attach failure, never retry the upload. When `gh pr view` shows a PR, put it in the run's state (ready unless the arguments named one) with `gh pr ready` or `gh pr ready --undo`, and remove image references that still point at local paths with `gh pr edit --body`. When there is no PR, send the pr worker again without the screenshot request. Name the failure in Report.

## Restore the stash

Once the PR is raised, or at a stop when `git status --porcelain` prints nothing, run `git stash apply <sha>`, then drop that entry (`git stash list --format='%gd %H'` names it). On a conflict, run `git reset --merge` and leave the stash. At a stop with a dirty tree, apply nothing.

## Report

Before orchestrate's `## Finish the plan` moves or deletes the plan, read the `(agent <run start>)` decisions. Report adds:

- Every decision you made without asking.
- The dirty-tree paths you included, stashed or excluded.
- Whether screenshots were attached, or why not.
- Any stash left, by SHA.

## After compaction

When this file's text or execute's is no longer in context, read the missing file again. Execute's `## After compaction` still applies.

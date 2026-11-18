---
name: yolo
description: Runs execute with the agent making the calls the user would usually make. Asks only when the request is unclear, and ends in a ready PR with screenshots attached when it can capture them.
argument-hint: "[plan path | plan name | research path | research name | topic] [issues] [reviewer model: sonnet | opus (default) | fable] [pr guidance]"
disable-model-invocation: true
allowed-tools: Bash(node ${CLAUDE_SKILL_DIR}/../settings.ts *)
---

You run execute, making the calls the user would usually make. Read `${CLAUDE_SKILL_DIR}/../execute/SKILL.md` and follow it, changed only as this file says. In that file and the files it reads, read `CLAUDE_SKILL_DIR` as `${CLAUDE_SKILL_DIR}`. Its `$ARGUMENTS` is this file's arguments. Read `pr.mode` as `auto`, whatever it says.

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
  - Plan or orchestrate asks which command adds a missing repo, and the folder's instructions give none: stop and say why.
  - Plan or orchestrate asks for the command that creates a repo that does not exist yet: stop and say why.
  - Orchestrate asks which repos under the root the work covers, with no `## Repos`: stop and say why.
- Answer the questions the pr worker reports back the same way, then send it again.

## Start

Once execute's `## Start` has found the repo, and before anything else reads the tree, on every path (the finalised-plan shortcut included). In workspace mode, `## Workspace mode` changes steps 2 to 4.

1. Record the run start with `date '+%Y-%m-%d %H:%M'`.
2. Run `git -C <root> check-ignore -q .claude/graft/.probe.md`, even when `.claude/graft/` exists. When it is not ignored, add `/.claude/graft/` to the file `git -C <root> rev-parse --path-format=absolute --git-path info/exclude` names.
3. Sort each path `git -C <root> status --porcelain --untracked-files=all` lists, leaving out `.claude/graft/`, `.claude/plans/` and the work's plan file. Add the untracked paths left out to `info/exclude`.
   - A path that looks like a secret (`.env*` other than `*.example`, `*.sample` and `*.template`; key and credential files) is never committed. Listed as `??`, add it to `info/exclude` and leave it in place. Otherwise (tracked, modified or staged), stash it.
   - A path related to the work is included. Once orchestrate's `## Branch` has run, and before the first milestone, stage only the included paths with `git -C <root> add -- <paths>` and commit them in a commit of their own. The first review range starts before that commit.
   - Stash the unrelated paths.
4. Stash every path the sort stashes in one `git -C <root> stash push --include-untracked -- <paths>`. Run `git rev-parse -q --verify stash@{0}` before and after it. When the push created an entry, keep its SHA (the value after). Otherwise there is no stash to restore.

## Workspace mode

Applies in common.md's workspace mode, and runs each command in a repo as common.md's `## Workspace` says. This section changes each section it names. After compaction, read this section again.

- **Start**: skip step 2; the plan lives at the root. Run steps 3 and 4 in each repo under the root that exists at Start, and in a repo added later once it is added, before its Branch step. Keep one stash SHA per repo.
- **Restore the stash**: per repo, applying each repo's stash in that repo.
- **Report**: the stashes, and the paths included, stashed or added to `info/exclude`, per repo.

## Recording decisions

- Record each decision you make without asking in the plan's `## Decisions`, marked `(agent <run start>)`. Write decisions made before the plan exists once it does.
- When `git ls-files --error-unmatch <plan>` succeeds, commit your plan edits (the plan phase's, `status: finalised` and the `(agent)` lines) in commits of their own, in the repo's commit style, never on the default branch: once orchestrate's `## Branch` has run and before the first milestone, before `## Final checks`, and just before `## Raise a PR`. Commit and push decisions made after the PR is raised to the PR's branch.

## Stops

- Stop only when you cannot go on, such as missing credentials or a failure a fix does not clear. A stop goes to Report and raises no PR.
- A check the environment cannot run is not a stop. List it in Report.
- An agent check still failing after three fix attempts is not a stop.
- When a rescue reviewer (`codex:codex-rescue`, `pidex:pidex-rescue`) fails or is missing, go on without it and say so in Report.
- When a `graft:reviewer` or `graft:adversarial-reviewer` fails, run it again once. A second failure is a stop.

## Manual checks

Follow orchestrate as if `orchestrate.agentDoesManualChecks` were `true`, whatever it says. The Manual check mode is Defer, whatever `orchestrate.manualChecks` says. Never answer a question that asks for a check's result.

## Screenshots

Orchestrate's Screenshots step follows common.md's `## Screenshots`.

## PR

Add `ready-state` to the **Arguments** orchestrate passes the pr worker, unless the arguments name a state.

## Restore the stash

Once the PR is raised, or at a stop when `git status --porcelain` prints nothing, run `git stash apply --index <sha>`. In workspace mode, do this per repo. When it fails for a reason other than a conflict, run `git stash apply <sha>`. Once applied, drop that entry (`git stash list --format='%gd %H'` names it). At a stop with a dirty tree, apply nothing.

On a conflict, run `git reset --merge`. When the stash holds untracked files, remove each file `git -C <root> ls-tree -r --name-only <sha>^3` lists that was not present before the apply, and keep the stash.

## Report

Before orchestrate's `## Finish the plan` moves or deletes the plan, read the `(agent <run start>)` decisions and the `(default)` entries written during this run. Report adds:

- Every decision you made without asking, and every `(default)` entry written during this run.
- The dirty-tree paths you included, stashed or added to `info/exclude` (the paths left out of the sort among them).
- Each agent check still failing, with what the worker observed.
- Whether screenshots were attached, or why not.
- Any stash left, by SHA.

In workspace mode, list the stashes and paths per repo.

## After compaction

When this file's text or execute's is no longer in context, read the missing file again. Execute's `## After compaction` still applies.

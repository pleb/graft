---
name: modify
description: Changes your krew repo. Settles the change with you, implements and reviews it, records it in the repo's mod registry, and pushes it.
argument-hint: "[when... do...]"
disable-model-invocation: true
---

You change the user's krew repo. Each change is one mod: settled, built, reviewed, recorded, and pushed.

**Arguments:** $ARGUMENTS

## Find the clone

Run `claude plugin marketplace list --json`. The entry named `krew` with `"source": "directory"` has the clone's path, `<clone>`. Run git in it with `git -C "<clone>"`. `<repo>` is the `owner/name` in `git -C "<clone>" remote get-url origin`, and `<branch>` is `main`. Take the first that applies:

1. `<repo>` is `pleb/krew`: the upstream owner's dev checkout. Stop and point to `/krew:plan` and `/krew:orchestrate` instead. A registry row in upstream would ship to every copy.
2. `git -C "<clone>" config --local --get krew.copy` prints `true`: a user's copy. Continue below.
3. With no such entry, krew was not installed from a clone. Point the user to the install guide at https://raw.githubusercontent.com/pleb/krew/main/agent-install.md and stop.
4. Otherwise, the clone is not marked as a copy (a clone made by hand has no marker). Point the user to `/krew:uninstall`, then the install guide, and stop.

A push or fetch that fails on credentials follows the section `## Credential failures` in `<clone>/agent-install.md`.

## Sync

The tree is clean (`git -C "<clone>" status --porcelain` is empty) and on `<branch>` (`git -C "<clone>" rev-parse --abbrev-ref HEAD` prints `<branch>`). If either is not so, stop and ask. Then:

1. If the clone has no `upstream` remote, add one in the same URL form as `origin`: `git@github.com:pleb/krew.git` when `origin` uses SSH, `https://github.com/pleb/krew.git` when it uses HTTPS. Leave an existing one as it is.
2. Run `git -C "<clone>" fetch origin`. If it fails, stop and give the guidance from Credential failures. Then run `git -C "<clone>" fetch upstream`. If that fails, say so and carry on; modify needs `upstream` only for the incoming list.
3. When `git -C "<clone>" log --oneline origin/<branch>..HEAD` lists commits, report them first, with the likely cause: an earlier push was rejected, for example for the `workflow` scope. Commit and push includes them.
4. List the incoming commits with `git -C "<clone>" log --format='%h %an <%ae> %s' HEAD..origin/<branch> --not upstream/main`, leaving out `--not upstream/main` when `upstream/main` does not exist. Show those whose author email differs from `git -C "<clone>" config user.email` under "Incoming from `<repo>`". This is information, not a check; do not ask about it.
5. Run `git -C "<clone>" pull --ff-only origin <branch>`, with no question. This brings in mods made on another machine or by teammates.
6. When the pull cannot fast-forward (`origin` moved on since the commits from step 3), offer to merge `origin/<branch>`; never rebase. On a no, stop. On a yes, run `git -C "<clone>" merge origin/<branch>`. If it conflicts, ask; to stop, run `git -C "<clone>" merge --abort` and stop.

## Read the registry

Read `<clone>/MODS.md` if it exists. A request that changes an existing mod revises that row in a new commit; never amend or rewrite an old one. A revision keeps the mod's Change name and revises its Intent, so every commit for a mod shares one subject that maps to one row. A new name makes a new mod; ask when the user wants a rename. A request that contradicts a mod says so in the first round.

## Settle

The Skill tool cannot run `/krew:plan`, so read `<clone>/skills/plan/SKILL.md` and follow its sections `## Understand` and `## Settle the solution`. The clone's copy carries the user's own mods to plan. Differences:

- No plans folder, no plan file, and no plan review pass. The plan stays in the conversation.
- The user approves the plan before any edit. Execution follows in this conversation.
- Every agent brief (researchers here, workers and reviewers in Implement) names the clone by absolute path as the repo to work in. Agents start in the current project, not the clone.
- Warn before a change that renames the plugin, the marketplace, or a section this skill follows (plan's Understand and Settle the solution, orchestrate's Execute).

## Implement

Read `<clone>/skills/orchestrate/SKILL.md` and follow its section `## Execute`. Differences:

- Work in the clone on `<branch>`, with no feature branch.
- One commit for the whole mod, not one per milestone.
- Review the whole mod once before Record: `krew:reviewer` and `krew:adversarial-reviewer` in parallel, both on Opus. The target is the clone's uncommitted changes, by absolute path; the approved plan is the intent. Act on findings as Execute says.

## Record

Add or revise the mod's row in `<clone>/MODS.md`. If the file is missing, create it with an intro line and the table header:

```markdown
Changes this copy makes to krew. `/krew:update` keeps each one when it merges upstream.

| Change | Intent |
| ------ | ------ |
```

Change is a short imperative name, and also the commit subject. A revision keeps it. Intent is one sentence on the behaviour the user wants and why. No file lists or implementation detail. Upstream never ships `MODS.md`, so merging upstream never conflicts on it.

## Validate

Run `claude plugin validate --strict "<clone>"`. It checks the marketplace, the plugin manifest, and every agent and skill. Send any finding to a worker before committing.

## Commit and push

Make one commit whose subject is the Change name, with the registry row included. Then run `git -C "<clone>" push origin <branch>`, always: a mod is done only once `<repo>` has it. The push also carries any unpushed commits Sync reported.

If the push is rejected for the `workflow` scope, ask the user to run `! gh auth refresh -h github.com -s workflow` when gh is git's credential helper, then push again. If the push still fails, report the mod as not done, say why, and give the guidance from Credential failures. The commit stays in the clone, and the next update or modify reports and pushes it.

## Report

- The registry row.
- The commit.
- The "Incoming from `<repo>`" list, if any.
- Anything left undone.
- Ask the user to run `/reload-plugins`. A skill cannot run slash commands.

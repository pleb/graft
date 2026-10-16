---
name: modify
description: Changes your krew fork. Settles the change with you, implements and reviews it, records it in the fork's mod registry, and pushes it.
argument-hint: "[change]"
disable-model-invocation: true
---

You change the user's krew fork. Each change is one mod: settled, built, reviewed, recorded, and pushed.

**Arguments:** $ARGUMENTS

## Find the clone

Read `claude plugin marketplace list --json` and take the entry named `krew`. When its `source` is `directory`, its `path` is the clone. With no `krew` entry, or one with another source, krew was not installed from a fork.

Run git in the clone with `git -C <clone>`. `gh repo view "$(git -C <clone> remote get-url origin)" --json isFork,defaultBranchRef` says whether the clone is a fork and names its default branch, `<branch>`.

When krew was not installed from a fork, point the user to the install guide at https://raw.githubusercontent.com/pleb/krew/main/agent-install.md and stop. If the clone is not a fork, stop and point to `/krew:plan` and `/krew:orchestrate` instead. A registry row in upstream would ship to every fork.

## Sync

The tree is clean (`git -C <clone> status --porcelain` is empty) and on `<branch>` (`git -C <clone> rev-parse --abbrev-ref HEAD` prints `<branch>`). If either is not so, stop and ask. Then `git -C <clone> pull --ff-only origin <branch>` brings in mods made on another machine. If the pull cannot fast-forward, stop and ask.

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
Changes this fork makes to krew. `/krew:update` keeps each one when it merges upstream.

| Change | Intent |
| ------ | ------ |
```

Change is a short imperative name, and also the commit subject. A revision keeps it. Intent is one sentence on the behaviour the user wants and why. No file lists or implementation detail. Upstream never ships `MODS.md`, so merging upstream never conflicts on it.

## Validate

Run `claude plugin validate --strict <clone>`. It checks the marketplace, the plugin manifest, and every agent and skill. Send any finding to a worker before committing.

## Commit and push

Make one commit whose subject is the Change name, with the registry row included. Then run `git -C <clone> push origin <branch>`, always: a mod is done only once the fork has it. If the push fails, report the mod as not done and say why.

## Report

- The registry row.
- The commit.
- Anything left undone.
- Ask the user to run `/reload-plugins`. A skill cannot run slash commands.

---
name: modify
description: Changes your krew repo. Settles the change with you, implements and reviews it, records it in the repo's mod registry, and pushes it.
argument-hint: "[when... do...]"
disable-model-invocation: true
---

You change the user's krew clone at `~/.my-krew`, one mod at a time. The install guide at https://raw.githubusercontent.com/pleb/krew/main/agent-install.md creates the clone. If a command fails, help the user resolve it, then carry on.

**Arguments:** $ARGUMENTS

## Sync

Check that the clone is on `main` with no changed or untracked files.

```bash
git -C ~/.my-krew status --short --branch
```

It prints only the `## main...origin/main` line. If it prints more, ask, and carry on only once it prints that line alone.

Bring in mods pushed from the user's other machines.

```bash
git -C ~/.my-krew pull --ff-only origin main
```

If the pull cannot fast-forward, help the user merge `origin/main`; never rebase.

## Read the registry

Read `~/.my-krew/MODS.md` if it exists. A change to an existing mod revises its row and keeps its Change name, because update maps commit subjects to rows by that name. A request that contradicts a mod says so in the first round.

## Settle

The Skill tool cannot run `/krew:plan`, so read `~/.my-krew/skills/plan/SKILL.md` and follow its sections `## Understand` and `## Settle the solution`. The clone's copy carries the user's own mods to plan. Differences:

- No plans folder, no plan file, and no plan review pass. The plan stays in the conversation.
- The user approves the plan before any edit. Execution follows in this conversation.
- Every agent brief (researchers here, workers and reviewers in Implement) names the clone by absolute path as the repo to work in, so expand `~/.my-krew` in the brief. Agents start in the current project, not the clone.

## Implement

Read `~/.my-krew/skills/orchestrate/SKILL.md` and follow its sections `## Execute` and `## Ask, do not guess`. Differences:

- Work in the clone on `main`, with no feature branch.
- One commit for the whole mod, not one per milestone.
- Review the whole mod once before Record: `krew:reviewer` and `krew:adversarial-reviewer` in parallel, both on Opus. The target is the clone's uncommitted changes, by absolute path; the approved plan is the intent. Act on findings as Execute says.

## Record

Add or revise the mod's row in `~/.my-krew/MODS.md`. If the file is missing, create it with an intro line and the table header:

```markdown
Changes this copy makes to krew. `/krew:update` keeps each one when it merges upstream.

| Change | Intent |
| ------ | ------ |
```

Change is a short imperative name, and also the commit subject. A revision keeps it. Intent is one sentence on the behaviour the user wants and why. No file lists or implementation detail. Upstream never ships `MODS.md`, so merging upstream never conflicts on it.

## Validate

Check the marketplace, the plugin manifest, and every agent and skill.

```bash
claude plugin validate --strict ~/.my-krew
```

Send any finding to a worker before committing.

## Commit and push

Make one commit whose subject is the Change name, with the registry row included, and push it.

```bash
git -C ~/.my-krew add -A
git -C ~/.my-krew commit -m "<Change>"
git -C ~/.my-krew push origin main
```

A mod is done once `origin` has it.

## Report

- The registry row.
- The commit.
- Anything left undone.
- Ask the user to run `/reload-plugins`. A skill cannot run slash commands.

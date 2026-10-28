---
name: modify
description: Changes your Graft repo. Settles the change with you, implements and reviews it, records it in the repo's mod registry, and pushes it.
argument-hint: "[when... do...]"
disable-model-invocation: true
---

You change the user's Graft clone at `~/.my-graft`, one mod at a time.

Read `~/.my-graft/skills/common.md` and follow its sections `## Ask the user` and `## Command failures`.

The mod registry is `~/.my-graft/MODS.md`.

**Arguments:** $ARGUMENTS

## Sync

Follow common.md's `## Claude Code version`, then its `## Sync the clone`.

## Read the registry

Read the registry if it exists. A change to an existing mod revises its row and keeps its Change name. A request that contradicts a mod says so in the first round.

## Settle

Read `~/.my-graft/skills/plan/SKILL.md` and follow its sections `## Understand` and `## Settle the solution`. Differences:

- No plans folder and no plan file. The plan stays in the conversation.
- The user approves the plan before any edit. Continue to implementation once the plan is approved.
- Every agent brief (researchers here, workers and reviewers in Implement) names the clone by absolute path as the repo to work in, so expand `~/.my-graft` in the brief.
- Follow `~/.my-graft/AGENTS.md` (paths relative to the clone) if it exists, and include its rules in every agent brief.

## Implement

Read `~/.my-graft/skills/orchestrate/SKILL.md` and follow its sections `## Execute` and `## Ask, do not guess`. Differences:

- Work in the clone on `main`, with no feature branch.
- One commit for the whole mod, not one per milestone, made in Commit and push.
- Review the whole mod once before Record: `graft:reviewer` and `graft:adversarial-reviewer` in parallel, both on Opus. This single review replaces Execute's review cadence. The target is the clone's uncommitted changes, by absolute path; the approved plan is the intent. Act on findings as Execute says.
- Put review fixes in the uncommitted mod, not a separate fix commit.

## Record

Add or revise the mod's row in `~/.my-graft/MODS.md`. If the file is missing, create it with an intro line and the table header:

```markdown
Changes this copy makes to Graft. `/graft:update` keeps each one when it merges upstream.

| Change | Intent |
| ------ | ------ |
```

Change is a short imperative name, and also the commit subject. Intent is one to three sentences on the behaviour the user wants and why. No file lists or implementation detail.

## Validate

Check the marketplace, the plugin manifest, and every agent and skill.

```bash
claude plugin validate --strict ~/.my-graft
```

Send any finding to a worker before committing.

## Commit and push

Make one commit whose subject is the Change name, with the registry row included, and push it.

```bash
git -C ~/.my-graft add -A
git -C ~/.my-graft commit -m "<Change>"
git -C ~/.my-graft push origin main
```

A mod is done once `origin` has it.

## Report

- The registry row.
- The commit.
- Anything left undone.
- Ask the user to run `/reload-plugins`.

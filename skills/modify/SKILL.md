---
name: modify
description: Changes your Graft repo. Settles the change with you, implements and reviews it, records it in the repo's mod registry, and pushes it, or raises a PR for an interstock or pleb/graft.
argument-hint: "[when... do...]"
disable-model-invocation: true
allowed-tools: Bash(node ~/.my-graft/skills/settings.ts *)
---

You change the user's Graft clone at `<target>`, one mod at a time.

Read `~/.my-graft/skills/common.md` and follow its sections `## Ask the user`, `## Command failures`, `## Settings`, `## Target clone`, `## Mod registry`, `## Personal clone` and `## Publish the change`.

Once `## Target clone` sets `<target>`, get settings with this command as written, without expanding `~`.

```bash
node ~/.my-graft/skills/settings.ts <target>
```

**Arguments:** $ARGUMENTS

## Sync

Follow common.md's `## Claude Code version`, then its `## Sync the clone`, then its `## Personal clone`.

## Read the registry

Read the registry if it exists. A change to an existing mod revises its row and keeps its Change name. When the registry is `MODS.md`, a change to a mod recorded only in `INTERSTOCK-MODS.md` is a new mod in the registry under its own Change name. A request that contradicts a mod says so in the first round.

## Settle

Read `<target>/skills/plan/SKILL.md` and follow its sections `## Understand` and `## Settle the solution`. Differences:

- No plans folder and no plan file. The plan stays in the conversation.
- The user approves the plan before any edit. Continue to implementation once the plan is approved.
- Every agent brief (researchers here, workers and reviewers in Implement) names the clone by absolute path as the repo to work in, so expand `<target>` in the brief.
- Follow `<target>/AGENTS.md` (paths relative to the clone) if it exists, and include its rules in every agent brief.

## Implement

Read `<target>/skills/orchestrate/SKILL.md` and follow its sections `## Execute` and `## Ask, do not guess`. Differences:

- Work in the clone on `main`, with no feature branch.
- One commit for the whole mod, not one per milestone, made in Commit and push.
- Skip `## Clean up`.
- Review the whole mod once before Record: `graft:reviewer` and `graft:adversarial-reviewer` in parallel, both on `common.reviewerModel`, else Opus. This single review replaces Execute's review cadence. The target is the clone's uncommitted changes, by absolute path; the approved plan is the intent. Act on findings as Execute says.
- Put review fixes in the uncommitted mod, not a separate fix commit.

## Record

Add or revise the mod's row in the registry. If the registry is missing, create `<target>/MODS.md` with an intro line and the table header:

```markdown
Changes this copy makes to Graft. `/graft:update` keeps each one when it merges upstream.

| Change | Intent |
| ------ | ------ |
```

Change is a short imperative name, and also the commit subject. Intent is one to three sentences on the behaviour the user wants and why. No file lists or implementation detail.

When the registry is `INTERSTOCK-MODS.md` and the user says the interstock itself was renamed or transferred (not a fork), update the `owner/repo` the registry names in the same commit.

## Validate

Check the marketplace, the plugin manifest, and every agent and skill.

```bash
claude plugin validate --strict <target>
```

Send any finding to a worker before committing.

## Commit and push

Make one commit whose subject is the Change name, with the registry row included.

```bash
git -C <target> add -A
git -C <target> commit -m "<Change>"
```

Then follow common.md's `## Publish the change` with the branch `graft/<Change name in kebab case>` and the registry row as PR guidance.

A mod is done once `origin` has it, or its PR is raised.

## Report

- The registry row.
- The commit.
- For a shared stock, the PR URL and that it needs merging, or the branch when no PR was raised.
- When `## Personal clone` set the gh default, say so.
- Anything left undone.
- When the target is `~/.my-graft`, ask the user to run `/reload-plugins`.

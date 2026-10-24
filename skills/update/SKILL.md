---
name: update
description: Merges the latest Graft from upstream into your clone, keeping your mods, and pushes it to your Graft repo. Asks before merging unless auto is passed.
argument-hint: "[mode: ask (default) | auto]"
disable-model-invocation: true
---

You bring `~/.my-graft` up to date with Graft and keep the user's mods. If a command fails, help the user resolve it, then carry on.

The mod registry is `~/.my-graft/MODS.md`.

**Arguments:** $ARGUMENTS

## Sync

Check that the clone is on `main` with no changed or untracked files.

```bash
git -C ~/.my-graft status --short --branch
```

It prints only the `## main...origin/main` line. If it prints more, use the `AskUserQuestion` tool to work with the user until it prints that line alone, then carry on.

Bring in mods pushed to `origin` from the user's other machines.

```bash
git -C ~/.my-graft pull --ff-only origin main
```

If the pull cannot fast-forward, help the user merge `origin/main`; never rebase. For any conflicts, read the registry to understand what each mod changes, and use the `AskUserQuestion` tool to get a decision on how to resolve them.

## Check upstream

Fetch Graft and list what is new.

```bash
git -C ~/.my-graft fetch upstream
git -C ~/.my-graft log --oneline HEAD..upstream/main
```

With nothing new, say Graft is up to date and stop. If Sync pulled any commits, first ask the user to run `/reload-plugins`.

Otherwise, summarise the incoming changes in a few lines from the commit subjects and the files they change.

```bash
git -C ~/.my-graft diff --stat HEAD...upstream/main
```

Without `auto` in the arguments, ask with `AskUserQuestion` before merging.

## Merge

Merge Graft into the clone without committing.

```bash
git -C ~/.my-graft merge --no-ff --no-commit upstream/main
```

Merge, never rebase.

For the rest of the update, follow `~/.my-graft/AGENTS.md` (paths relative to the clone) if it exists, resolving it first if it is conflicted.

For each conflicted file, list the mods that changed it.

```bash
git -C ~/.my-graft log --no-merges --format=%s upstream/main..HEAD -- <file>
```

This prints their Change names, and the registry gives their intent. Resolve the file so upstream's change lands and each mod's intent still holds. Ask with `AskUserQuestion` when both cannot hold, when no mod explains the clone's side, or when upstream now does what a mod did (offer to drop the mod and its row). `auto` never skips these questions.

To stop at any point before the commit, clear the merge and any fixes, including new files.

```bash
git -C ~/.my-graft reset --hard
git -C ~/.my-graft clean -fd
```

This is safe because Sync required a clean tree. (`merge --abort` can refuse once a fix is on disk.)

## Validate

Check the marketplace, the plugin manifest, and every agent and skill.

```bash
claude plugin validate --strict ~/.my-graft
```

If it fails, fix what the merge broke, or ask with `AskUserQuestion`. If the user chooses to stop, clear the clone as Merge says.

## Commit and push

Commit the merge and push it to the user's Graft repo.

```bash
git -C ~/.my-graft add -A
git -C ~/.my-graft commit --no-edit
git -C ~/.my-graft push origin main
```

Staging everything is safe because Sync required a clean tree.

## Report

- What came in from upstream.
- Each conflict and how it was resolved.
- Mods revised or dropped, with their registry rows.
- Ask the user to run `/reload-plugins`.

---
name: update
description: Merges the latest Graft from upstream into your clone, keeping your mods, and pushes it to your Graft repo. Asks before merging unless auto is passed.
argument-hint: "[mode: ask (default) | auto]"
disable-model-invocation: true
---

You bring `~/.my-graft` up to date with Graft and keep the user's mods. The install guide at https://raw.githubusercontent.com/pleb/graft/main/agent-install.md creates `~/.my-graft`. If a command fails, help the user resolve it, then carry on.

**Arguments:** $ARGUMENTS

## Sync

Check that the clone is on `main` with no changed or untracked files.

```bash
git -C ~/.my-graft status --short --branch
```

It prints only the `## main...origin/main` line. If it prints more, ask, and carry on only once it prints that line alone.

Bring in mods pushed from the user's other machines.

```bash
git -C ~/.my-graft pull --ff-only origin main
```

If the pull cannot fast-forward, help the user merge `origin/main`; never rebase.

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

Without `auto` in the arguments, ask before merging.

## Merge

Merge Graft into the clone without committing.

```bash
git -C ~/.my-graft merge --no-ff --no-commit upstream/main
```

Merge, never rebase, so pushes never need force. `--no-commit` holds the commit until validation passes. `--no-ff` makes it hold even when the merge could fast-forward.

For each conflicted file, list the mods that changed it.

```bash
git -C ~/.my-graft log --no-merges --format=%s upstream/main..HEAD -- <file>
```

This prints their Change names, and `~/.my-graft/MODS.md` gives their intent. Resolve the file so upstream's change lands and each mod's intent still holds. Ask when both cannot hold, when no mod explains the clone's side, or when upstream now does what a mod did (offer to drop the mod and its row). `auto` never skips these questions.

To stop at any point before the commit, clear the merge and any fixes, including new files.

```bash
git -C ~/.my-graft reset --hard
git -C ~/.my-graft clean -fd
```

This is safe because Sync required a clean tree. (`merge --abort` can refuse once a fix is on disk.)

## Validate

Check the merged plugin.

```bash
claude plugin validate --strict ~/.my-graft
```

If it fails, fix what the merge broke, or ask. If the user chooses to stop, clear the clone as Merge says.

## Commit and push

Commit the merge and push it to the user's Graft repo.

```bash
git -C ~/.my-graft add -A
git -C ~/.my-graft commit --no-edit
git -C ~/.my-graft push origin main
```

Staging everything puts resolved conflicts, validation fixes and `MODS.md` edits in the merge commit. It is safe because Sync required a clean tree.

## Report

- What came in from upstream.
- Each conflict and how it was resolved.
- Mods revised or dropped, with their `MODS.md` rows.
- Ask the user to run `/reload-plugins`. A skill cannot run slash commands.

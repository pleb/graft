---
name: update
description: Merges the latest krew from upstream into your fork, keeping your mods, and pushes the fork. Asks before merging unless auto is passed.
argument-hint: "[auto]"
disable-model-invocation: true
---

You bring the user's krew fork up to date with upstream and keep their mods intact.

**Arguments:** $ARGUMENTS

## Find the clone

Read `claude plugin marketplace list --json` and take the entry named `krew`. When its `source` is `directory`, its `path` is the clone. With no `krew` entry, or one with another source, krew was not installed from a fork.

Run git in the clone with `git -C <clone>`. `gh repo view "$(git -C <clone> remote get-url origin)" --json isFork,defaultBranchRef` says whether the clone is a fork and names its default branch, `<branch>`.

When krew was not installed from a fork, point the user to the install guide at https://raw.githubusercontent.com/pleb/krew/main/agent-install.md and stop.

On a clone that is not a fork (the upstream owner's clone of `pleb/krew`), the update is `git -C <clone> pull --ff-only` and the report.

## Sync with the fork

The clone is on `<branch>` (`git -C <clone> rev-parse --abbrev-ref HEAD` prints `<branch>`) and its tree is clean (`git -C <clone> status --porcelain` prints nothing). If either is not so, stop and ask. Then run `git -C <clone> pull --ff-only origin <branch>`, which brings in mods made on other machines. If the pull cannot fast-forward, stop and ask.

## Check upstream

If the clone has no `upstream` remote, add one for `https://github.com/pleb/krew.git`. Leave an existing one as it is. Run `git -C <clone> fetch upstream`, then `git -C <clone> log --oneline HEAD..upstream/main`. With nothing new, report that krew is up to date and stop.

Summarise the incoming changes in a few lines from the commit subjects and `git -C <clone> diff --stat HEAD...upstream/main`. Without `auto` in the arguments, ask before merging.

## Merge

Merge, never rebase: the fork's history stays intact and pushes never need force. Record the pre-merge commit with `git -C <clone> rev-parse HEAD`. Then run `git -C <clone> merge --no-commit upstream/main`, so validation runs before the merge commit exists. A fork with no mods fast-forwards instead, which creates no merge commit.

To stop, restore the clone: `git -C <clone> merge --abort` while a merge is in progress, or `git -C <clone> reset --hard <pre-merge commit>` after a fast-forward. The reset is safe because Sync required a clean tree.

For each conflicted file:

1. Find the mods behind it. `git -C <clone> log --no-merges --format=%s upstream/main..HEAD -- <file>` gives Change names, and `MODS.md` at the clone root gives their intent. A commit with no row in `MODS.md` (a hand edit or a GitHub web edit) falls back to its commit message.
2. Resolve so the upstream change lands and each mod's intent still holds. Stage the file.
3. Ask when no mod explains the fork's side, when the upstream change and the intent cannot both hold, or when upstream now does what the mod did (offer to drop the mod and its row). Each question gives options with a recommendation. `auto` never skips these questions.

If the user chooses to stop, restore the clone as above.

## Validate and push

Run `claude plugin validate --strict <clone>`. It checks the marketplace and plugin manifests, the agents, and the skills. After a fast-forward, run it on the merged tree. If it fails, fix what the merge broke or ask; do not push a clone that fails. If the user chooses not to fix it, restore the clone as Merge says.

Once it passes, complete a merge with `git -C <clone> commit --no-edit`. Then run `git -C <clone> push origin <branch>`.

## Report

- What came in from upstream.
- Each conflict and how it was resolved.
- Mods revised or dropped, with their `MODS.md` rows.
- Ask the user to run `/reload-plugins`; a skill cannot run slash commands, and the session keeps the old krew until they do.

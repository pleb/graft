---
name: update
description: Merges the latest krew from upstream into your clone, keeping your mods, and pushes it to your krew repo. Asks before merging unless auto is passed.
argument-hint: "[mode: ask (default) | auto]"
disable-model-invocation: true
---

You bring the user's krew repo up to date with upstream and keep their mods intact.

**Arguments:** $ARGUMENTS

## Find the clone

Run `claude plugin marketplace list --json`. The entry named `krew` with `"source": "directory"` has the clone's path, `<clone>`. Run git in it with `git -C "<clone>"`. `<repo>` is the `owner/name` in `git -C "<clone>" remote get-url origin`, and `<branch>` is `main`. Take the first that applies:

1. `<repo>` is `pleb/krew`: the upstream owner's dev checkout. The update is `git -C "<clone>" pull --ff-only` and the report.
2. `git -C "<clone>" config --local --get krew.copy` prints `true`: a user's copy. Continue below.
3. With no such entry, krew was not installed from a clone. Point the user to the install guide at https://raw.githubusercontent.com/pleb/krew/main/agent-install.md and stop.
4. Otherwise, the clone is not marked as a copy (a clone made by hand has no marker). Point the user to `/krew:uninstall`, then the install guide, and stop.

A push or fetch that fails on credentials follows the section `## Credential failures` in `<clone>/agent-install.md`.

## Sync with the repo

The clone is on `<branch>` (`git -C "<clone>" rev-parse --abbrev-ref HEAD` prints `<branch>`) and its tree is clean (`git -C "<clone>" status --porcelain` prints nothing). If either is not so, stop and ask. Then:

1. If the clone has no `upstream` remote, add one in the same URL form as `origin`: `git@github.com:pleb/krew.git` when `origin` uses SSH, `https://github.com/pleb/krew.git` when it uses HTTPS. Leave an existing one as it is.
2. Run `git -C "<clone>" fetch origin`, then `git -C "<clone>" fetch upstream`. If either fails, stop and give the guidance from Credential failures.
3. Check that `git -C "<clone>" merge-base HEAD upstream/main` succeeds. When it fails, stop and say `<repo>` shares no history with krew.
4. When `git -C "<clone>" log --oneline origin/<branch>..HEAD` lists commits, report them first, with the likely cause: an earlier push was rejected, for example for the `workflow` scope.
5. List the incoming commits with `git -C "<clone>" log --format='%h %an <%ae> %s' HEAD..origin/<branch> --not upstream/main`. Show those whose author email differs from `git -C "<clone>" config user.email` under "Incoming from `<repo>`". This is information, not a check; do not ask about it.
6. Run `git -C "<clone>" pull --ff-only origin <branch>`, with no question. This brings in mods made on other machines or by teammates.
7. When the pull cannot fast-forward (`origin` moved on since the commits from step 4), offer to merge `origin/<branch>`; never rebase. On a no, stop. On a yes, run `git -C "<clone>" merge --no-commit origin/<branch>`, then `claude plugin validate --strict "<clone>"`. Complete it with `git -C "<clone>" commit --no-edit` only when validation passes. If the merge conflicts or validation fails, ask. To stop, run `git -C "<clone>" merge --abort` and stop.
8. When the clone now holds commits `origin` lacks (step 4 found some), run `git -C "<clone>" push origin <branch>` before checking upstream. If the push is rejected for the `workflow` scope, ask the user to run `! gh auth refresh -h github.com -s workflow` when gh is git's credential helper, then push again. Stop on any other failure and give the guidance from Credential failures.

## Check upstream

Run `git -C "<clone>" log --oneline HEAD..upstream/main`. With nothing new, report that krew is up to date and stop.

Summarise the incoming changes in a few lines from the commit subjects and `git -C "<clone>" diff --stat HEAD...upstream/main`. Without `auto` in the arguments, ask before merging.

## Merge

Merge, never rebase: the repo's history stays intact and pushes never need force. Record the pre-merge commit with `git -C "<clone>" rev-parse HEAD`. Then run `git -C "<clone>" merge --no-commit upstream/main`, so validation runs before the merge commit exists. A copy with no mods fast-forwards instead, which creates no merge commit.

To stop, restore the clone: `git -C "<clone>" merge --abort` while a merge is in progress, or `git -C "<clone>" reset --hard <pre-merge commit>` after a fast-forward. The reset is safe because Sync required a clean tree.

For each conflicted file:

1. Find the mods behind it. `git -C "<clone>" log --no-merges --format=%s upstream/main..HEAD -- <file>` gives Change names, and `MODS.md` at the clone root gives their intent. A commit with no row in `MODS.md` (a hand edit or a GitHub web edit) falls back to its commit message.
2. Resolve so the upstream change lands and each mod's intent still holds. Stage the file.
3. Ask when no mod explains the copy's side, when the upstream change and the intent cannot both hold, or when upstream now does what the mod did (offer to drop the mod and its row). Each question gives options with a recommendation. `auto` never skips these questions.

If the user chooses to stop, restore the clone as above.

## Validate and push

Run `claude plugin validate --strict "<clone>"`. It checks the marketplace and plugin manifests, the agents, and the skills. After a fast-forward, run it on the merged tree. If it fails, fix what the merge broke or ask; do not push a clone that fails. If the user chooses not to fix it, restore the clone as Merge says.

Once it passes, complete a merge with `git -C "<clone>" commit --no-edit`. Then run `git -C "<clone>" push origin <branch>`. An upstream change to `.github/workflows/` needs the `workflow` scope: when the push is rejected for it, ask the user to run `! gh auth refresh -h github.com -s workflow` when gh is git's credential helper, then push again. On any other failure, give the guidance from Credential failures, and report that the merge is committed locally but not pushed; the next update or modify pushes it.

## Report

- What came in from upstream.
- The "Incoming from `<repo>`" list, and any earlier unpushed commits that Sync pushed.
- Each conflict and how it was resolved.
- Mods revised or dropped, with their `MODS.md` rows.
- Ask the user to run `/reload-plugins`; a skill cannot run slash commands, and the session keeps the old krew until they do.

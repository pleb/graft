---
name: uninstall
description: Removes krew from Claude Code and offers to delete the local clone. Leaves your GitHub fork unless you ask for help deleting it.
disable-model-invocation: true
---

You remove krew from this machine. The fork on GitHub stays unless the user asks otherwise.

## Find the clone

Read `claude plugin marketplace list --json` and take the entry named `krew`. When its `source` is `directory`, its `path` is the clone. With no `krew` entry, or one with another source, krew was not installed from a fork.

Run git in the clone with `git -C <clone>`. `gh repo view "$(git -C <clone> remote get-url origin)" --json isFork,defaultBranchRef` says whether the clone is a fork and names its default branch, `<branch>`.

With no `krew` entry, say krew is not installed from a marketplace and stop. With another source (such as the old `pleb/krew` GitHub marketplace), run Remove and Finish only; there is no clone or fork to handle.

A clone that is not a fork is the upstream owner's clone of `pleb/krew`. It still uninstalls; there is just no fork to leave.

Note `<clone>` and the fork now. The marketplace entry is gone after Remove.

## Check for unsaved work

Look for:

- Uncommitted changes: `git -C <clone> status --porcelain`.
- Commits the fork does not have: `git -C <clone> log --oneline origin/<branch>..HEAD`, and on any branch, `git -C <clone> log --oneline --branches --not --remotes`.
- Stashes: `git -C <clone> stash list`. A stash counts as unsaved work.

If there are any, list them and offer to commit and push them first. Carry on either way; the clone keeps them until it is deleted.

## Remove

```bash
claude plugin uninstall krew@krew
claude plugin marketplace remove krew
```

## Local clone

First list the ignored files that would be lost: the `!!` lines of `git -C <clone> status --porcelain --ignored`, such as plans kept out of git through `info/exclude`. Ask with `AskUserQuestion` whether to delete the clone, showing its path and that list. Ignored files do not block the delete (they may be just `node_modules/`); the user decides. Delete only on a yes. While there is unsaved work, refuse and say what would be lost.

Before deleting, check that the path is the one from the marketplace entry, that `git -C <clone> rev-parse --show-toplevel` returns that same folder, and that its `origin` is the fork (or `pleb/krew` for the upstream owner). If any check fails, do not delete. Never delete a parent folder or the home directory.

## Fork

Leave it. Report its URL (`https://github.com/<fork>`) and that a reinstall finds and reuses it.

If the user asks for help deleting it:

1. Ask the user to run `! gh auth refresh -h github.com -s delete_repo` and wait until they confirm.
2. Ask the user to type the exact repo name, `<owner>/<repo>`. Continue only when it matches the fork.
3. Run `gh repo delete <fork> --yes`.

Never delete `pleb/krew`.

## Finish

Report what was removed and what remains. Ask the user to run `/reload-plugins` or restart Claude Code. A skill cannot run slash commands, so until then the session keeps the old krew.

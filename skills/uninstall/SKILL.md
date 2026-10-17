---
name: uninstall
description: Removes krew from Claude Code and offers to delete the local clone. Leaves your krew repo on GitHub unless you ask for help deleting it.
disable-model-invocation: true
---

You remove krew from this machine. The user's krew repo on GitHub stays unless the user asks otherwise.

## Find the clone

Run `claude plugin marketplace list --json` and take the entry named `krew`:

- No entry: say krew is not installed from a marketplace and stop.
- Another source (such as the old `pleb/krew` GitHub marketplace): run Remove and Finish only. There is no clone or repo to handle.
- `"source": "directory"`: its `path` is the clone, `<clone>`.

Run git in the clone with `git -C "<clone>"`. `<repo>` is the `owner/name` in `git -C "<clone>" remote get-url origin` (none without an `origin`), and `<branch>` is `main`. Take the first that applies:

1. `<repo>` is `pleb/krew`: the upstream owner's dev checkout. It still uninstalls; its GitHub repo is never deleted.
2. There is a `<repo>`, and `git -C "<clone>" config --local --get krew.copy` prints `true`: a user's copy, whose GitHub repo is `<repo>`.
3. Otherwise: an unmarked clone. It still uninstalls, and its GitHub repo is left alone.

Note `<clone>`, `<repo>` and the classification now. The marketplace entry is gone after Remove.

## Check for unsaved work

Look for:

- Uncommitted changes: `git -C "<clone>" status --porcelain`.
- Commits `origin` does not have: `git -C "<clone>" log --oneline origin/<branch>..HEAD` (skip this one without a `<repo>`), and on any branch, `git -C "<clone>" log --oneline --branches --not --remotes`.
- Stashes: `git -C "<clone>" stash list`. A stash counts as unsaved work.

If there are any, list them and offer to commit and push them first. Carry on either way; the clone keeps them until it is deleted.

## Remove

```bash
claude plugin uninstall krew@krew
claude plugin marketplace remove krew
```

## Local clone

First list the ignored files that would be lost: the `!!` lines of `git -C "<clone>" status --porcelain --ignored`, such as plans kept out of git through `info/exclude`. Ask with `AskUserQuestion` whether to delete the clone, showing its path and that list. Ignored files do not block the delete (they may be just `node_modules/`); the user decides. Delete only on a yes. While there is unsaved work, refuse and say what would be lost. When the clone stays and `<clone>` is `~/.my-krew`, say that a reinstall stops while that folder is in use.

Before deleting, check that the folder is a krew clone:

- The path is the one from the marketplace entry.
- `git -C "<clone>" rev-parse --show-prefix` exits 0 and prints nothing, so the folder is the repo's top level. (Outside any repo it also prints nothing, but exits 128.)
- `git -C "<clone>" merge-base --is-ancestor 4141bfcf833d96b72875ae7b54dca430db058e4b HEAD` exits 0, so the folder holds krew's history.

If any check fails, do not delete. Never delete a parent folder or the home directory.

## GitHub repo

Only a user's copy has a GitHub repo to handle here. For the dev checkout and an unmarked clone, leave the GitHub repo alone and offer no deletion.

Leave `<repo>` by default. Report its URL (`https://github.com/<repo>`), and that a reinstall reuses it only when it is `<login>/my-krew` for the active gh account (`gh api user --jq .login`); otherwise a reinstall uses `<login>/my-krew` (creating it when missing), not this repo.

If the user asks for help deleting it:

1. When `gh api users/<owner> --jq .type` prints `Organization` for the owner of `<repo>`, warn that deleting it removes it for everyone with access.
2. Ask the user to run `! gh auth refresh -h github.com -s delete_repo` and wait until they confirm.
3. Ask the user to type the exact repo name, `<owner>/<name>`. Continue only when it matches `<repo>`.
4. Run `gh repo delete <repo> --yes`.
5. When that succeeds and the clone was kept, run `git -C "<clone>" config --local --unset krew.copy`, so update and modify no longer treat the clone as a copy.

Never delete `pleb/krew`.

## Finish

Report what was removed and what remains. Ask the user to run `/reload-plugins` or restart Claude Code. A skill cannot run slash commands, so until then the session keeps the old krew.

---
name: uninstall
description: Removes krew from Claude Code and offers to delete the local clone. Leaves your krew repo on GitHub unless you ask for help deleting it.
disable-model-invocation: true
---

You remove krew from this machine. The user's krew repo on GitHub stays unless the user asks otherwise.

## Find the clone

Read `claude plugin marketplace list --json` and take the entry named `krew`. When its `source` is `directory`, its `path` is the clone. With no `krew` entry, or one with another source, krew was not installed from a clone.

With no `krew` entry, say krew is not installed from a marketplace and stop. With another source (such as the old `pleb/krew` GitHub marketplace), run Remove and Finish only; there is no clone or repo to handle.

Run git in the clone with `git -C "<clone>"`. `<repo>` is the last two path segments of `git -C "<clone>" remote get-url origin`, splitting on both `/` and `:`, with a trailing `.git` removed. The host and any user part are ignored, so `https://github.com/o/r.git`, `git@github.com:o/r.git` and `git@github-personal:o/r.git` all give `o/r`. When the URL has no `owner/name` path (or there is no `origin`), say so; the clone has no `<repo>` and is handled as unmarked.

Classify the clone, in this order:

1. `<repo>` is `pleb/krew` (compared case-insensitively): the upstream owner's dev checkout. It still uninstalls; its GitHub repo is never deleted.
2. `git -C "<clone>" config --local --type=bool --get krew.copy` prints `true`: a user's copy, whose GitHub repo is `<repo>`.
3. Anything else: an unmarked clone. It still uninstalls, and its GitHub repo is left alone.

`<branch>` is the `ref: refs/heads/<branch>` line of `git -C "<clone>" ls-remote --symref origin HEAD`. When `ls-remote` fails (for example, offline), report that git cannot reach `origin`. Suggest `! gh auth setup-git`, or checking the active gh account when gh is git's credential helper. Then carry on without `<branch>`.

Note `<clone>`, `<repo>`, the classification and `<branch>` now. The marketplace entry is gone after Remove.

## Check for unsaved work

Look for:

- Uncommitted changes: `git -C "<clone>" status --porcelain`.
- Commits `origin` does not have: `git -C "<clone>" log --oneline origin/<branch>..HEAD` (skip this one without `<branch>`), and on any branch, `git -C "<clone>" log --oneline --branches --not --remotes`.
- Stashes: `git -C "<clone>" stash list`. A stash counts as unsaved work.

If there are any, list them and offer to commit and push them first. Carry on either way; the clone keeps them until it is deleted.

## Remove

```bash
claude plugin uninstall krew@krew
claude plugin marketplace remove krew
```

## Local clone

First list the ignored files that would be lost: the `!!` lines of `git -C "<clone>" status --porcelain --ignored`, such as plans kept out of git through `info/exclude`. Ask with `AskUserQuestion` whether to delete the clone, showing its path and that list. Ignored files do not block the delete (they may be just `node_modules/`); the user decides. Delete only on a yes. While there is unsaved work, refuse and say what would be lost.

Before deleting, check that the folder is a krew clone:

- The path is the one from the marketplace entry.
- `git -C "<clone>" rev-parse --show-prefix` exits 0 and prints nothing, so the folder is the repo's top level. (Outside any repo it also prints nothing, but exits 128.)
- `git -C "<clone>" merge-base --is-ancestor 4141bfcf833d96b72875ae7b54dca430db058e4b HEAD` exits 0, so the folder holds krew's history.

If any check fails, do not delete. Never delete a parent folder or the home directory.

## GitHub repo

Only a user's copy has a GitHub repo to handle here. For the dev checkout and an unmarked clone, leave the GitHub repo alone and offer no deletion.

Leave `<repo>` by default. Report its URL (`https://github.com/<repo>`), and that a reinstall finds it on its own only when it is `<login>/my-krew` for the active gh account (`gh api user --jq .login`); otherwise the reinstall asks for its name.

If the user asks for help deleting it:

1. When `gh api users/<owner> --jq .type` prints `Organization` for the owner of `<repo>`, warn that deleting it removes it for everyone with access.
2. Ask the user to run `! gh auth refresh -h github.com -s delete_repo` and wait until they confirm.
3. Ask the user to type the exact repo name, `<owner>/<name>`. Continue only when it matches `<repo>`.
4. Run `gh repo delete <repo> --yes`.
5. When that succeeds and the clone was kept, run `git -C "<clone>" config --local --unset krew.copy`, so a later install does not treat the clone as set up.

Never delete `pleb/krew`.

## Finish

Report what was removed and what remains. Ask the user to run `/reload-plugins` or restart Claude Code. A skill cannot run slash commands, so until then the session keeps the old krew.

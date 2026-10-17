---
name: uninstall
description: Removes krew from Claude Code and deletes ~/.my-krew. Your my-krew repo on GitHub stays.
disable-model-invocation: true
---

You remove krew from this machine. The user's `my-krew` repo on GitHub stays. If a command fails, help the user resolve it, then carry on.

## Confirm

When `~/.my-krew` exists, check it for work that is not on GitHub.

```bash
git -C ~/.my-krew status --short --branch
```

Always ask with `AskUserQuestion` whether to delete `~/.my-krew`, and show that output. It lists uncommitted files, and `[ahead N]` means N commits are not pushed. Ask even when the status is clean: it does not list stashes, other branches or ignored files.

On no, stop before removing anything, so the user can push first.

When `~/.my-krew` does not exist (a krew dev checkout), skip this step: ask nothing and carry on.

## Remove krew

Remove the `krew` marketplace. This also uninstalls krew.

```bash
claude plugin marketplace remove krew
```

## Delete the clone

Delete `~/.my-krew`, when it exists.

```bash
rm -rf ~/.my-krew
```

## Finish

Report what was removed. If `~/.my-krew` existed, say that the `my-krew` repo on GitHub stays: a reinstall reuses it, and the user can delete it on GitHub if they no longer want it.

Ask the user to run `/reload-plugins` or restart Claude Code. A skill cannot run slash commands, so until then the session keeps the old krew.

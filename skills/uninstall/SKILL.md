---
name: uninstall
description: Removes Graft from Claude Code and deletes ~/.my-graft. Your my-graft repo on GitHub stays.
disable-model-invocation: true
---

You remove Graft from this machine. The user's `my-graft` repo on GitHub stays. If a command fails, help the user resolve it, then carry on.

## Confirm

When `~/.my-graft` exists, check it for work that is not on GitHub.

```bash
git -C ~/.my-graft status --short --branch
```

Always ask with `AskUserQuestion` whether to delete `~/.my-graft`, and show that output. It does not list stashes, other branches or ignored files.

On no, stop before removing anything.

When `~/.my-graft` does not exist, skip this step.

## Remove Graft

Remove the `graft` marketplace. This also uninstalls Graft.

```bash
claude plugin marketplace remove graft
```

## Delete the clone

Delete `~/.my-graft`, when it exists.

```bash
rm -rf ~/.my-graft
```

## Finish

Report what was removed. If `~/.my-graft` existed, say that the `my-graft` repo on GitHub stays: a reinstall reuses it, and the user can delete it on GitHub if they no longer want it.

Ask the user to run `/reload-plugins` or restart Claude Code.

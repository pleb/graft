# Install krew

You are installing krew, a Claude Code plugin, for the user. Each user installs krew from their own fork of `pleb/krew`, cloned locally and registered as a local-folder marketplace. Follow these steps in order. Report each command you run.

## 1. Check tools

Run `git --version`, `gh --version`, and `claude --version`. If any is missing, tell the user which one and stop.

Run `gh auth status`. If `gh` is not logged in, ask the user to run `! gh auth login` and wait until they confirm.

## 2. Find the fork

Run `gh api user --jq .login` to get the login. Then find the user's fork under any name:

```bash
gh api repos/pleb/krew/forks --paginate --jq '.[] | select(.owner.login == "<login>") | .full_name'
```

- **Login `pleb`**: the upstream owner. GitHub does not let an account fork its own repo, so use `pleb/krew` itself.
- **No fork**: this is a new install. Say so, then run `gh repo fork pleb/krew --clone=false --default-branch-only`. The fork is `<login>/krew`, or the name `gh` reports.
- **A fork**: this is an install on a new machine, or a reinstall. Use it. Never create a second fork.

## 3. Check for an install

Run `claude plugin marketplace list --json`. A local folder entry looks like `{"name": "krew", "source": "directory", "path": "/abs/path", ...}`; a GitHub entry has `"source": "github"` and `"repo": "owner/repo"`.

If the `krew` entry has `source` `directory`, and `git -C <path> remote get-url origin` names the fork (in HTTPS or SSH form), the marketplace is the fork's clone. Then run `claude plugin list --json` and find the entry with `id` `krew@krew`, such as `{"id": "krew@krew", "scope": "user", "enabled": true, ...}`:

- **Enabled**: krew is already installed. Skip to step 6.
- **Missing**: run `claude plugin install krew@krew --scope user`, then skip to step 6.
- **`enabled` is false**: run `claude plugin enable krew@krew`, then skip to step 6.

## 4. Clone

Ask for the clone location with `AskUserQuestion`. The default is `~/.krew` on macOS and Linux, and `%USERPROFILE%\.krew` on Windows.

Then check the location:

- **Missing or empty**: run `gh repo clone <fork> <path>`. For a fork, `gh` adds an `upstream` remote for `pleb/krew`. GitHub creates forks asynchronously, so a clone straight after `gh repo fork` can fail. Retry up to 5 times, waiting about 10 seconds between tries, before reporting the error.
- **Already a clone of the fork** (its `origin` names the fork): reuse it, then run `git -C <path> pull --ff-only`.
- **Anything else**: ask for another location. Never clear or delete a folder.

## 5. Install

`<path>` is absolute and native to the OS. On Windows, use `C:\Users\<name>\.krew`, not the Git Bash form `/c/Users/<name>/.krew`. Claude Code on Windows runs Bash through Git Bash, where `~` expands to the Git Bash form.

If a `krew` marketplace exists with another source (such as the `pleb/krew` GitHub marketplace from the old install instructions), tell the user it will be replaced, then run `claude plugin marketplace remove krew`. This also uninstalls `krew@krew`.

Then run:

```bash
claude plugin marketplace add <path>
claude plugin install krew@krew --scope user
```

Never remove and re-add the marketplace as a refresh. Removing it uninstalls the plugin.

## 6. Finish

Report the fork URL (`https://github.com/<fork>`), the clone path, and the commands you ran. Tell the user the fork is public, so their mods are public too. Ask the user to run `/reload-plugins` or restart Claude Code to load krew.

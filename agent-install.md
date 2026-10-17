# Install krew

You are installing krew, a Claude Code plugin, for the user. Krew lives in the user's private GitHub repo `<login>/my-krew`, which holds krew's history plus their mods. Its clone at `~/.my-krew` has `origin` set to that repo, and Claude Code installs krew from the clone. Report each command you run.

`<path>` is `~/.my-krew` as an absolute path native to the OS. On Windows, Claude Code runs commands through Git Bash, which writes the home folder as `/c/Users/<name>`; use `C:\Users\<name>\.my-krew` instead. Quote `"<path>"` in every command.

## 1. Check gh

If `gh auth status` shows gh is not logged in, ask the user to run `! gh auth login` and wait until they confirm. Run `gh api user --jq .login` to get `<login>`. `<repo>` is `<login>/my-krew`.

## 2. Check for an install

Run `claude plugin marketplace list --json`. When it has an entry named `krew` with `"source": "directory"`, krew is already installed from a clone:

- If `claude plugin list --json` has no `krew@krew` entry, run `claude plugin install krew@krew --scope user`. If its `enabled` is false, run `claude plugin enable krew@krew`.
- Say krew is installed and point to `/krew:update`. If you installed or enabled it, ask the user to run `/reload-plugins` or restart Claude Code first. Then stop.

Otherwise (no `krew` entry, or one with another source), continue.

If `<path>` exists and is not empty, say what it holds and stop.

## 3. Set up the clone

Run `gh repo view <repo>`. When it succeeds, clone the repo:

```bash
gh repo clone <repo> "<path>"
```

If `"<path>/.claude-plugin/marketplace.json"` does not exist, `<repo>` does not hold krew. Say so and stop. When `<repo>` is empty (left by an earlier install whose push failed), tell the user that deleting both `<path>` and `<repo>` lets this guide start over.

When `gh repo view` fails with "Could not resolve to a Repository", create the repo:

```bash
gh repo clone pleb/krew "<path>" -- --origin upstream
gh repo create <repo> --private --source "<path>" --remote origin --description "My krew, from pleb/krew"
git -C "<path>" push --set-upstream origin main
```

On any other error, stop and report it. If the push fails, follow Credential failures, then push again. Repeat while each failure has a new cause. When a failure repeats, stop and report it; do not mark or register the clone.

Then mark the clone as a copy, for update, modify and uninstall:

```bash
git -C "<path>" config --local krew.copy true
```

## 4. Install

If `claude plugin marketplace list --json` has a `krew` entry (such as the `pleb/krew` GitHub marketplace from the old install instructions), tell the user it will be replaced, then run `claude plugin marketplace remove krew`. Then:

```bash
claude plugin marketplace add "<path>"
claude plugin install krew@krew --scope user
```

## 5. Finish

Report `https://github.com/<repo>`, `<path>`, and the commands you ran. Ask the user to run `/reload-plugins` or restart Claude Code to load krew.

## Credential failures

When a push or fetch fails, fix the cause, then run the command again:

- **Rejected for the `workflow` scope**: when gh is git's credential helper, ask the user to run `! gh auth refresh -h github.com -s workflow`. Otherwise, the token git uses needs that scope.
- **"could not read Username"**, or another auth prompt failure: for HTTPS, ask the user to run `! gh auth setup-git`. For SSH, check the SSH key.
- **"Repository not found"**, or **"Permission to `<repo>`.git denied to `<user>`"**: git signs in as a different GitHub account from gh's (`gh api user --jq .login`). Point git's github.com credentials at that account, or ask the user to run `! gh auth setup-git`.

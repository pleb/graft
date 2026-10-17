# Install krew

You are installing krew, a Claude Code plugin, for the user. Krew lives in the user's private GitHub repo `<login>/my-krew`, which holds krew's history plus their mods. Its clone at `~/.my-krew` has `origin` set to that repo, and Claude Code installs krew from the clone. Report each command you run. If a command fails, help the user resolve it, then carry on.

## 1. Find the login

Get the user's GitHub login.

```bash
gh api user --jq .login
```

This prints `<login>`. `<repo>` is `<login>/my-krew`.

## 2. Set up the clone

Check whether the user already has a `my-krew` repo.

```bash
gh repo view <repo>
```

When it succeeds, clone the repo and add krew as `upstream`.

```bash
gh repo clone <repo> ~/.my-krew
git -C ~/.my-krew remote add upstream https://github.com/pleb/krew.git
```

When it reports the repo does not exist ("Could not resolve to a Repository"), clone krew and push it to a new private repo.

```bash
gh repo clone pleb/krew ~/.my-krew -- --origin upstream
gh repo create <repo> --private --source ~/.my-krew --remote origin --description "My krew, from pleb/krew"
git -C ~/.my-krew push --set-upstream origin main
```

## 3. Install

Register the clone as the `krew` marketplace and install krew from it.

```bash
claude plugin marketplace add ~/.my-krew
claude plugin install krew@krew --scope user
```

## 4. Finish

Report `https://github.com/<repo>`, `~/.my-krew`, and the commands you ran. Ask the user to run `/reload-plugins` or restart Claude Code to load krew.

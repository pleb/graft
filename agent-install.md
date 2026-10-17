# Install Graft

You are installing Graft, a Claude Code plugin, for the user. Graft lives in the user's private GitHub repo `<login>/my-graft`, which holds Graft's history plus their mods. Its clone at `~/.my-graft` has `origin` set to that repo, and Claude Code installs Graft from the clone. Report each command you run. If a command fails, help the user resolve it, then carry on.

## 1. Find the login

Get the user's GitHub login.

```bash
gh api user --jq .login
```

This prints `<login>`. `<repo>` is `<login>/my-graft`.

## 2. Set up the clone

Check whether the user already has a `my-graft` repo.

```bash
gh repo view <repo>
```

When it succeeds, clone the repo and add Graft as `upstream`.

```bash
gh repo clone <repo> ~/.my-graft
git -C ~/.my-graft remote add upstream https://github.com/pleb/graft.git
```

When it reports the repo does not exist ("Could not resolve to a Repository"), clone Graft and push it to a new private repo.

```bash
gh repo clone pleb/graft ~/.my-graft -- --origin upstream
gh repo create <repo> --private --source ~/.my-graft --remote origin --description "My Graft, from pleb/graft"
git -C ~/.my-graft push --set-upstream origin main
```

## 3. Install

Register the clone as the `graft` marketplace and install Graft from it.

```bash
claude plugin marketplace add ~/.my-graft
claude plugin install graft@graft --scope user
```

## 4. Finish

Report `https://github.com/<repo>`, `~/.my-graft`, and the commands you ran. Ask the user to run `/reload-plugins` or restart Claude Code to load Graft.

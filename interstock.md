# Create an interstock

You are creating an interstock for the user: an organisation's copy of Graft in a GitHub repo `<owner>/<repo>`, holding `pleb/graft`'s history, that colleagues install Graft from instead of `pleb/graft`. Report each command you run. Ask every question with `AskUserQuestion`. If a command fails, help the user resolve it before the next step.

## 1. Choose the repo

Ask for `<owner>/<repo>`, whether it is public or private, and `<dir>`, where to clone it (default `<cwd>/<repo>`).

## 2. Create the repo

Clone Graft and push it to the new repo.

```bash
gh repo clone pleb/graft <dir> -- --origin upstream
gh repo create <owner>/<repo> --<public|private> --source <dir> --remote origin --description "Graft for <owner>, from pleb/graft"
```

## 3. Make it the interstock

In `<dir>/agent-install.md`, replace the `pleb/graft` references that say where to install from (`gh repo clone pleb/graft`, each `upstream` URL `https://github.com/pleb/graft.git`, the repo description) with `<owner>/<repo>`.

In `<dir>/README.md`, replace the install command under `## Install` with the colleague install command. Leave `## Interstocks` alone.

- Public: `Claude, install Graft https://raw.githubusercontent.com/<owner>/<repo>/main/agent-install.md`
- Private: `Claude, install Graft by reading agent-install.md from <owner>/<repo> with gh api -H "Accept: application/vnd.github.raw" repos/<owner>/<repo>/contents/agent-install.md`

Commit and push.

```bash
git -C <dir> commit -am "Make <owner>/<repo> an interstock"
git -C <dir> push --set-upstream origin main
```

## 4. Finish

Report `https://github.com/<owner>/<repo>`, `<dir>`, and the colleague install command. For a private repo, say colleagues need read access and `gh auth setup-git`. Say the caretaker runs `/graft:update` and `/graft:modify` in `<dir>` to update or modify the interstock.

Offer to switch the user's own Graft to the interstock by following `<dir>/agent-install.md`.

# Create an interstock

You are creating an interstock for the user: an organisation's copy of Graft in a GitHub repo `<owner>/<repo>`, holding `pleb/graft`'s history, that colleagues install Graft from instead of `pleb/graft`. Report each command you run. Ask every question with `AskUserQuestion`. If a command fails, help the user resolve it before the next step.

## 1. Choose the repo

Ask for `<owner>/<repo>`, whether it is public or private, `<dir>`, where to clone it (default `<cwd>/<repo>`), and whether to publish the simulator to the repo's GitHub Pages. For a private repo, say Pages needs a paid plan, the site is public on Pro and Team, and private Pages needs an organisation on Enterprise Cloud that allows private sites.

## 2. Create the repo

Clone Graft and push it to the new repo.

```bash
gh repo clone pleb/graft <dir> -- --origin upstream
gh repo create <owner>/<repo> --<public|private> --source <dir> --remote origin --description "Graft for <owner>, from pleb/graft"
```

## 3. Make it the interstock

An interstock clone has these properties. Make each one true in `<dir>`.

- **Install references.** In `agent-install.md`, the `pleb/graft` references that say where to install from (`gh repo clone pleb/graft`, each `upstream` URL `https://github.com/pleb/graft.git`, the repo description) name `<owner>/<repo>`.
- **Install command.** In `README.md`, the install command under `## Install` is the colleague install command in the repo's form. `## Interstocks` stays as it is.
  - Public: `Claude, install Graft https://raw.githubusercontent.com/<owner>/<repo>/main/agent-install.md`
  - Private: `Claude, install Graft by reading agent-install.md from <owner>/<repo> with gh api -H "Accept: application/vnd.github.raw" repos/<owner>/<repo>/contents/agent-install.md`
- **Simulator link.** Read the repo's `GRAFT_SIMULATOR` variable. Only when it prints `publish`, read the newest `github-pages` deployment's id, that deployment's newest status, and the Pages URL.
  ```bash
  gh variable get GRAFT_SIMULATOR -R <owner>/<repo>
  gh api "repos/<owner>/<repo>/deployments?environment=github-pages&per_page=1" --jq '.[0].id'
  gh api repos/<owner>/<repo>/deployments/<id>/statuses --jq '.[0].state'
  gh api repos/<owner>/<repo>/pages --jq .html_url
  ```
  - When the state is `success`, `README.md` has the line `[Watch it run in the simulator](<html_url>).` as its own paragraph after the README's opening paragraph, and no other line linking to the simulator.
  - When the variable "was not found" or reads anything but `publish`, there is no deployment or status, the state is anything but `success`, or Pages returns 404, `README.md` has no line linking to the simulator, whether `https://pleb.github.io/graft/` or an earlier Pages URL of `<owner>/<repo>`. Remove each such line, together with one blank line next to it.
  - When a read fails any other way, keep `HEAD`'s simulator link line as it is and ask the user.

## 4. Record and push

Create `<dir>/INTERSTOCK-MODS.md`:

```markdown
Changes the interstock <owner>/<repo> makes to Graft. Clones of it keep their own in `MODS.md`. `/graft:update` keeps each one when it merges upstream.

| Change | Intent |
| ------ | ------ |
```

Commit and push.

```bash
git -C <dir> add INTERSTOCK-MODS.md
git -C <dir> commit -am "Make <owner>/<repo> an interstock"
git -C <dir> push --set-upstream origin main
```

When the user chose to publish the simulator, follow `## Publish the simulator` outside `/graft:update`. Otherwise record the decline.

```bash
gh variable set GRAFT_SIMULATOR --body declined -R <owner>/<repo>
```

Then make step 3's simulator link property true. When that changed `README.md`, commit and push.

```bash
git -C <dir> commit -am "Link the simulator"
git -C <dir> push
```

## 5. Finish

Report `https://github.com/<owner>/<repo>`, `<dir>`, and the colleague install command. For a private repo, say colleagues need read access and `gh auth setup-git`. Say the caretaker runs `/graft:update` and `/graft:modify` in `<dir>` to update or modify the interstock. Report the simulator's Pages URL and whether the site is public, or that publishing was declined or skipped and why.

Offer to switch the user's own Graft to the interstock by following `<dir>/agent-install.md`.

## Publish the simulator

Publish the simulator (`site/`) to the GitHub Pages of the interstock `<owner>/<repo>`, cloned at `<dir>`. The caller says whether this runs inside `/graft:update`. Edit no files.

When a command here fails in a way its step does not name, report its cause and who must act, in place of the rule at the top of this file. Before step 5, the section then ends. From step 5 on, `GRAFT_SIMULATOR` stays `publish`.

1. Check the user is a repo admin. Unless it prints `true`, say an admin must follow this section, and end.
   ```bash
   gh api repos/<owner>/<repo> --jq .permissions.admin
   ```
2. Read the repo's Pages site.
   ```bash
   gh api repos/<owner>/<repo>/pages
   ```
   On 404, enable it.
   ```bash
   gh api -X POST repos/<owner>/<repo>/pages -f build_type=workflow
   ```
   When it exists, the simulator owns it only when its `build_type` is `workflow` and either `GRAFT_SIMULATOR` reads `publish` or the `github-pages` environment has no deployments (the second command prints `0`). A variable read that says it "was not found" means unset. Otherwise say the simulator needs the repo's Pages and the existing site is left as it is, and end.
   ```bash
   gh variable get GRAFT_SIMULATOR -R <owner>/<repo>
   gh api "repos/<owner>/<repo>/deployments?environment=github-pages&per_page=1" --jq length
   ```
3. Read the repo's visibility; anything but `PUBLIC` is private. For a public repo, skip this step.
   ```bash
   gh repo view <owner>/<repo> --json visibility
   ```
   For a private repo, make the site private, then read `public` back whether or not that succeeded. Anything but `false` is public.
   ```bash
   gh api -X PUT repos/<owner>/<repo>/pages -F public=false
   gh api repos/<owner>/<repo>/pages --jq .public
   ```
   When public, warn that the site would be public to anyone and ask whether to publish publicly. On no, delete Pages and end.
   ```bash
   gh api -X DELETE repos/<owner>/<repo>/pages
   ```
4. In `<dir>`, run `npm ci` and `npm run test:site`. On failure, warn that deploys fail until the scenarios pass, and continue.
5. Record the choice.
   ```bash
   gh variable set GRAFT_SIMULATOR --body publish -R <owner>/<repo>
   ```
6. Outside `/graft:update`, start the deploy.
   ```bash
   gh workflow run pages.yml -R <owner>/<repo>
   ```
   When it prints a run URL, the URL's last segment is `<run-id>`. Otherwise list dispatched runs until one created after the dispatch appears, and take its `databaseId`.
   ```bash
   gh run list --workflow pages.yml --event workflow_dispatch -R <owner>/<repo> --json databaseId,createdAt
   ```
   Watch the run, then read its `deploy` job's conclusion. Report success only when it is `success`.
   ```bash
   gh run watch <run-id> -R <owner>/<repo> --exit-status
   gh run view <run-id> -R <owner>/<repo> --json jobs --jq '.jobs[] | select(.name == "deploy") | .conclusion'
   ```
   Inside `/graft:update`, say the first deploy runs when the update PR merges, and the README link follows on the next update.
7. Report the Pages URL.
   ```bash
   gh api repos/<owner>/<repo>/pages --jq .html_url
   ```

When the section ends before step 5, except at step 1, ask **Not now**, which leaves `GRAFT_SIMULATOR` unset so `/graft:update` offers this section again, or **Never**, which records the decline.

```bash
gh variable set GRAFT_SIMULATOR --body declined -R <owner>/<repo>
```

# Install krew

You are installing krew, a Claude Code plugin, for the user. Each user installs krew from their own private GitHub repo (not a fork) that holds krew's history plus their mods. The local clone has `origin` set to that repo and `upstream` set to `pleb/krew`, and is registered as a local-folder marketplace. Follow these steps in order. Report each command you run. If you stop on an error, also report the clone location and the repo, so a rerun can pick both.

## Terms

- **`<path>`** is the clone location. It is absolute and native to the OS. On Windows, Claude Code runs commands through Git Bash, which writes the home folder as `/c/Users/<name>`. Do not build `<path>` from `~` or `$HOME`; use the Windows form, `C:\Users\<name>\.krew`.
- **`<clone>`** is the folder you are checking: the marketplace entry's path in step 2, or a location in steps 3 and 5.
- **Quote** every `"<path>"` and `"<clone>"` in commands. Git Bash mangles an unquoted Windows path.
- **`<repo>`** is the user's krew repo, as `owner/name`. **`<default>`** is its default branch.
- **The root commit** is krew's first commit, `4141bfcf833d96b72875ae7b54dca430db058e4b`.
- **A krew clone** is a folder where this exits 0:

  ```bash
  git -C "<clone>" merge-base --is-ancestor 4141bfcf833d96b72875ae7b54dca430db058e4b HEAD
  ```

- **The marker** says the copy is set up. A clone is marked only when this prints `true`:

  ```bash
  git -C "<clone>" config --local --type=bool --get krew.copy
  ```

  Install writes it with `git -C "<path>" config --local krew.copy true`. Always use `--local`, so a global setting never marks a clone.

- **A remote's repo** comes from `git -C "<clone>" remote get-url <remote>`. Split the URL on both `/` and `:`, remove a trailing `.git`, and keep the last two segments as `owner/name`. The host and any user part are ignored, so `https://user@github.com/o/r.git`, `git@github.com:o/r.git`, `ssh://git@github.com/o/r.git` and `git@github-personal:o/r.git` all give `o/r`. When the URL has no `owner/name` path, stop and report it. Compare repo names case-insensitively.
- **A development clone** is a krew clone whose `origin`'s repo is `pleb/krew`. It is never an install, and install never uses `pleb/krew` as `<repo>`.

## 1. Check tools

Run `git --version`, `gh --version`, and `claude --version`. If any is missing, tell the user which one and stop.

Run `gh auth status`. If `gh` is not logged in, ask the user to run `! gh auth login` and wait until they confirm.

Run `gh api user --jq .login` to get `<login>`, the active gh account.

## 2. Check for an install

Run `claude plugin marketplace list --json`. A local folder entry looks like `{"name": "krew", "source": "directory", "path": "/abs/path", ...}`; a GitHub entry has `"source": "github"` and `"repo": "owner/repo"`.

A `krew` entry with `source` `directory` is an install when all of these hold for its path, `<clone>`:

- `<clone>` exists and is a krew clone;
- it is marked;
- its `origin`'s repo is not `pleb/krew`.

Then `<repo>` is `origin`'s repo. Run `claude plugin list --json` and find the entry with `id` `krew@krew`, such as `{"id": "krew@krew", "scope": "user", "enabled": true, ...}`:

- **Enabled**: krew is already installed. Skip to step 8.
- **Missing**: run `claude plugin install krew@krew --scope user`, then skip to step 8.
- **`enabled` is false**: run `claude plugin enable krew@krew`, then skip to step 8.

When any condition fails, or there is no such entry, continue to step 3; step 7 replaces the entry. When `<clone>` is an unmarked krew clone with an `origin`, keep its path and `origin`'s repo for step 5.

## 3. Check the default location's folder state

The default location is `~/.krew` on macOS and Linux, and `%USERPROFILE%\.krew` on Windows, written as an absolute `<path>`. Find its state with the table below. Check the rows in order; the first match wins. A development clone counts as Anything else.

| State                                                                                  | What it means                                                                |
| -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| **Missing or empty**                                                                   | Nothing yet.                                                                 |
| **Marked**: a krew clone, marked                                                       | The copy is set up, and may not be registered. `<repo>` is `origin`'s repo.  |
| **With an `origin`**: a krew clone with an `origin`, unmarked                          | An earlier run stopped after choosing `origin`'s repo, or a hand-made clone. |
| **No `origin`**: a krew clone, no `origin`, `upstream`'s repo is `pleb/krew`, unmarked | An earlier run stopped right after cloning `pleb/krew`.                      |
| **Anything else**                                                                      | Not krew's. Say what it holds; step 5 asks for another location.             |

Rules for the middle three states (resuming):

- **Marked**: step 4 checks `origin`'s repo. When it is a Match, the folder stays Marked. Otherwise, run `git -C "<path>" config --local --unset krew.copy` and handle the folder as With an `origin`.
- **With an `origin`**: step 4 checks `origin`'s repo instead of `<login>/my-krew`. When that repo is empty without install's description, ask whether to use it, as step 4 says; on a yes it counts as Ours, empty. When it is otherwise Not usable, say why, treat the folder as Anything else, and look up `<login>/my-krew`.
- **No `origin`**: step 4 looks up `<login>/my-krew` as usual.

## 4. Find the repo

Check `<login>/my-krew` (or the repo step 3 named) as below.

**A typed name** is reduced to `owner/name` first:

- Strip a `https://github.com/` or `git@github.com:` prefix and a trailing `.git`.
- Both parts must match `[A-Za-z0-9._-]+`. Otherwise ask again.
- Refuse `pleb/krew`: it is upstream, not a copy. Ask again.

**Check a repo** in two steps:

1. Run:

   ```bash
   gh repo view <repo> --json nameWithOwner,visibility,isEmpty,isFork,isArchived,description,viewerPermission,defaultBranchRef
   ```

   - Only "Could not resolve to a Repository" means the repo is missing. Any other error stops install; report it.
   - From here on, use `nameWithOwner` as `<repo>` (it fixes case and follows a rename), and `defaultBranchRef.name` as `<default>` (empty for an empty repo; Create pushes `main`, then checks the default branch).

2. When the repo exists, is not empty, and is neither a fork nor archived, check that `<default>` contains the root commit:

   ```bash
   gh api repos/<repo>/compare/4141bfcf833d96b72875ae7b54dca430db058e4b...<default> --jq .status
   ```

   | Result                         | Meaning                                    |
   | ------------------------------ | ------------------------------------------ |
   | `ahead` or `identical`         | `<default>` contains the commit.           |
   | `behind` or `diverged`         | The repo is unrelated.                     |
   | Exits non-zero with `HTTP 404` | The repo is unrelated (no shared history). |
   | Any other error                | Stop and report it.                        |

   Do not use the `commits/<sha>` endpoint instead. It also finds commits that exist only in another repo of the fork network.

**Outcomes:**

- **Match**: contains the commit, not a fork, not archived, and `viewerPermission` is `WRITE`, `MAINTAIN` or `ADMIN`.
- **Ours, empty**: private, empty, and its description is exactly `My krew, from pleb/krew`. An earlier run stopped before its push.
- **Missing**: offer to create it. When the name came from a folder's `origin`, "Could not resolve" means the repo is missing or the active gh account (`<login>`) cannot see it. Say both, and name the account, before offering to create it.
- **Not usable**: unrelated, a fork, archived, read-only, or empty without that description. Say which. An empty repo without the description can still be used if the user says so (say whether it is public first); it then counts as Ours, empty.

## 5. Choose the clone location

**Resuming.** When step 3 found one of the middle three states and step 4's outcome is not Not usable, ask one `AskUserQuestion` confirmation:

- "Resume in `<path>` with `<repo>`" (recommended). Say if the repo is public, or that it will be created private when Missing.
- "Start elsewhere". Then look up `<login>/my-krew` (step 4) if you have not, and ask the question below without the default location.

**Otherwise**, ask one `AskUserQuestion` call with two questions, the repo and the clone location.

The repo question always has a second option, so a match never blocks choosing a team repo or a different copy:

| Outcome     | Recommended option                   | Second option               |
| ----------- | ------------------------------------ | --------------------------- |
| Match       | "Use `<repo>`" (say if it is public) | "Another repo"              |
| Ours, empty | "Finish setting up `<repo>`"         | "Another repo"              |
| Missing     | "Create private `<repo>`"            | "Another repo"              |
| Not usable  | "Create a new private repo"          | "Use an existing krew repo" |

- For "Another repo" and the Not usable options, the user types `owner/name` as Other. If they pick the option without typing a name, ask for it next.
- Check every typed name (step 4) and act on its outcome. When it is Missing, confirm before creating it, so a typo does not make a second copy. When it is Not usable, say why and ask again.

The location question offers:

- the default location, unless its state is Anything else;
- the clone from step 2, when its `origin`'s repo is `<repo>` and it is not the default location;
- any other absolute path, typed as Other.

When that leaves only Other, ask the repo question alone, then ask for the path in plain text.

**Then check the chosen folder's state** with step 3's table, unless it is the default location you already checked:

- **Anything else**: say what it holds, and ask for another location.
- **A different repo.** When the folder's `origin` names a different repo from `<repo>`, say both and ask which to use. For the folder's repo, check it (step 4). For `<repo>`, re-point `origin` (`git -C "<path>" remote set-url origin <url>`, with `<url>` as in Create) only on an explicit yes; otherwise ask for another location. Re-pointing also unsets the marker when it is set (`git -C "<path>" config --local --unset krew.copy`), so step 6 handles the folder as With an `origin`.
- **Marked, when `<repo>` is not a Match**: unset the marker as above, and handle the folder as With an `origin`.

## 6. Set up the clone

Run what the outcome and the folder state say. Then, after Create or Finish a clone, and for a Marked folder, run Set the gh default.

| Repo outcome | Folder state                                      | Run                                                         |
| ------------ | ------------------------------------------------- | ----------------------------------------------------------- |
| Match        | Marked                                            | Only "Set the gh default" below.                            |
| Missing      | Missing or empty                                  | Create, from the start.                                     |
| Missing      | No `origin`                                       | Create, from `remote add origin`.                           |
| Missing      | With an `origin` that is `<repo>`                 | Create, from `gh repo create`.                              |
| Ours, empty  | Missing or empty                                  | Create, from the start, without `gh repo create`.           |
| Ours, empty  | No `origin`                                       | Create, from `remote add origin`, without `gh repo create`. |
| Ours, empty  | With an `origin` that is `<repo>`                 | Create, from the push.                                      |
| Match        | Missing or empty                                  | `gh repo clone <repo> "<path>"`, then Finish a clone.       |
| Match        | No `origin`, or With an `origin` that is `<repo>` | Finish a clone.                                             |

### Create

```bash
gh repo clone pleb/krew "<path>" -- --origin upstream
git -C "<path>" remote add origin <url>
gh repo create <repo> --private --description "My krew, from pleb/krew"
git -C "<path>" push --set-upstream origin main
```

- **`<url>`** is the `upstream` URL (`git -C "<path>" remote get-url upstream`) with `pleb/krew` replaced by `<repo>`, so it keeps the user's protocol: `git@github.com:<repo>.git` or `https://github.com/<repo>.git`. Do not use `gh config get git_protocol`; it misses the per-host value.
- **`origin` comes before the repo**, so a stopped run records the chosen name in the folder.
- **The created name.** `gh repo create` prints the new repo's URL. When its `owner/name` differs from `<repo>`, use it as `<repo>` and run `git -C "<path>" remote set-url origin <url>` before pushing.
- **A failed `gh repo create`** may still have created the repo (for example, after a timeout). Check `<repo>` again (step 4). When it is now Ours, empty, continue at the push. Otherwise (name taken, no permission to create repos in an org) the failure left nothing on GitHub. Report it, and ask for another `owner/name`. Re-point `origin` to it only with the user's yes.
- **A failed push** follows Credential failures. The empty repo stays, and a rerun finds it as Ours, empty.
- **Do not use `gh repo create --source "<path>" --push`.** Its push uses gh's own token, which may lack the `workflow` scope, and a plain `git push` tests the credentials every later update uses.

After the push, run `gh api repos/<repo> --jq .default_branch`. If it is not `main`, run `gh repo edit <repo> --default-branch main`.

Then run `git -C "<path>" config --local krew.copy true`.

### Finish a clone

For a Match repo, whether the folder is a fresh `gh repo clone`, a leftover, or a reused clone:

1. Check that the tree is clean: `git -C "<path>" status --porcelain` prints nothing. Otherwise stop and ask.
2. If `origin` is missing, run `git -C "<path>" remote add origin <url>`, with `<url>` as in Create.
3. If `upstream` is missing, add it in the same URL form as `origin`: `git -C "<path>" remote add upstream git@github.com:pleb/krew.git` or `https://github.com/pleb/krew.git`.
4. Run `git -C "<path>" fetch origin`. A failure follows Credential failures.
5. Move the folder onto the repo's history:
   - When `git -C "<path>" log --branches --not --remotes` prints nothing (no local-only commits), run `git -C "<path>" checkout -B <default> origin/<default>`.
   - Otherwise, when `git -C "<path>" rev-parse --abbrev-ref HEAD` prints `<default>`, run `git -C "<path>" pull --ff-only origin <default>`. When it prints another branch, or the pull cannot fast-forward, stop and ask, because the folder holds work.
6. Run `git -C "<path>" config --local krew.copy true`.

### Set the gh default

gh prefers a remote named `upstream`, so plain `gh` commands in the clone would target `pleb/krew`. Run this as one command, because a `cd` in a separate call does not carry over:

```bash
cd "<path>" && gh repo set-default <repo>
```

Use `owner/name`, not `origin`: gh accepts a remote name only from version 2.85.0.

## 7. Install

If a `krew` marketplace exists that is not this clone (another source, such as the `pleb/krew` GitHub marketplace from the old install instructions, or a directory at another path), tell the user it will be replaced, then run `claude plugin marketplace remove krew`. This also uninstalls `krew@krew`.

If the `krew` marketplace is already this clone, skip `marketplace add`, and install or enable `krew@krew` as in step 2. Otherwise run:

```bash
claude plugin marketplace add "<path>"
claude plugin install krew@krew --scope user
```

Never remove and re-add the marketplace as a refresh. Removing it uninstalls the plugin.

## 8. Finish

- Report the repo URL (`https://github.com/<repo>`), the clone path, and the commands you ran.
- Say whether the repo is private or public, from `visibility`. If you have not read it, run `gh repo view <repo> --json visibility --jq .visibility`. When that fails, say the active gh account (`<login>`) cannot see the repo, rather than guessing.
- Ask the user to run `/reload-plugins` or restart Claude Code to load krew.

## Credential failures

Each of these applies to a push or a fetch. During install, the empty repo stays after a failed push, and a rerun pushes into it.

| Symptom                                                        | Cause                                                                                                   | Fix, then rerun                                                                                                                                   |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rejected for the `workflow` scope                              | The credential git uses lacks the scope.                                                                | `! gh auth refresh -h github.com -s workflow` when gh is git's credential helper. Otherwise, update the token git uses.                           |
| "could not read Username", or another auth prompt failure      | Git has no credentials for github.com.                                                                  | For HTTPS: `! gh auth setup-git`, then `! gh auth refresh -h github.com -s workflow`. For SSH: check the SSH key.                                 |
| "Repository not found", or "Permission ... denied to `<user>`" | Git authenticates as a different GitHub account from the active gh account (`gh api user --jq .login`). | Point git's github.com credentials at that account, or run `! gh auth setup-git`. This never means the repo is missing, so do not create another. |

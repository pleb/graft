---
name: update
description: Merges the latest Graft from upstream into your clone, keeping your mods, reviews the merge when the registry has mods, and pushes it to your Graft repo, or raises a PR outside a my-graft. Asks before merging unless the arguments, or update.mode when they name no mode, say auto.
argument-hint: "[mode: ask (default) | auto]"
disable-model-invocation: true
allowed-tools: Bash(node ${CLAUDE_SKILL_DIR}/../settings.ts *)
---

You bring `<target>` up to date with Graft and keep the user's mods.

Read `${CLAUDE_SKILL_DIR}/../common.md` and follow its sections `## Ask the user`, `## Command failures`, `## Settings`, `## Target clone`, `## Mod registry`, `## Personal clone` and `## Publish the change`.

Once `## Target clone` sets `<target>`, get settings.

```bash
node ${CLAUDE_SKILL_DIR}/../settings.ts <target>
```

**Arguments:** $ARGUMENTS

## Sync

Follow common.md's `## Claude Code version`, then its `## Sync the clone`.

## Check upstream

`upstream` is where the target gets Graft from: `pleb/graft`, or an interstock (an organisation's copy of Graft). Use it as it is. When the target has no `upstream` remote, add the URL in `<target>/agent-install.md`'s `remote add upstream` command, or `https://github.com/pleb/graft.git` when that URL is the target's `origin`.

```bash
git -C <target> remote add upstream <url>
```

Fetch Graft and list what is new.

```bash
git -C <target> fetch upstream
git -C <target> log --oneline HEAD..upstream/main
```

With nothing new, say Graft is up to date and stop. If Sync pulled any commits and the target is `~/.my-graft`, first ask the user to run `/reload-plugins`.

Otherwise, summarise the incoming changes in a few lines from the commit subjects and the files they change.

```bash
git -C <target> diff --stat HEAD...upstream/main
```

The mode is `ask` or `auto` from the arguments, else `update.mode`. With `ask`, ask before merging.

Follow common.md's `## Personal clone`. For a target that is not personal, check that `origin` allows merge commits.

```bash
gh repo view <origin-repo> --json mergeCommitAllowed
```

When it is `false`, ask the user to enable merge commits on the repo, then check again; stop if they decline.

## Merge

Merge Graft into the clone without committing.

```bash
git -C <target> merge --no-ff --no-commit upstream/main
```

Merge, never rebase.

For the rest of the update, follow `<target>/AGENTS.md` (paths relative to the clone) if it exists, resolving it first if it is conflicted.

For each conflicted file, list the mods that changed it.

```bash
git -C <target> log --no-merges --format=%s upstream/main..HEAD -- <file>
```

This prints their Change names, and the registry gives their intent. Resolve the file so upstream's change lands and each mod's intent still holds. Ask when both cannot hold, when no mod explains the clone's side, or when upstream now does what a mod did (offer to drop the mod and its row). `auto` never skips these questions. Record the conflicted files and each decision the user makes.

To stop at any point before the commit, clear the merge and any fixes, including new files.

```bash
git -C <target> reset --hard
git -C <target> clean -fd
```

This is safe because Sync required a clean tree. (`merge --abort` can refuse once a fix is on disk.)

## Review

Run this step when the registry has at least one mod row. Stage everything.

```bash
git -C <target> add -A
```

Run `graft:reviewer` and `graft:adversarial-reviewer` in parallel, both on `common.reviewerModel`, else Opus. The target is the staged merge against upstream, with `<target>` by absolute path and the conflicted files named. The intent is the registry rows, the Merge decisions, and that upstream's incoming changes land intact.

```bash
git -C <target> diff --cached upstream/main
```

Weigh the findings and send fixes to a `graft:worker`, which leaves them in the uncommitted merge. Ask the user before a fix that changes a mod's behaviour or reverses a Merge decision. Record the findings acted on and their fixes.

## Validate

Check the marketplace, the plugin manifest, and every agent and skill.

```bash
claude plugin validate --strict <target>
```

If it fails, fix what the merge broke, or ask the user. If the user chooses to stop, clear the clone as Merge says.

## Commit and push

Commit the merge.

```bash
git -C <target> add -A
git -C <target> commit --no-edit
```

Staging everything is safe because Sync required a clean tree.

Then follow common.md's `## Publish the change` with the branch `graft/update-<YYYY-MM-DD>` (today's date) and this PR guidance:

- Start the body with this alert, verbatim:

```markdown
> [!IMPORTANT]
> Merge this PR with a merge commit. Squash or rebase merging drops upstream's history, and the next `/graft:update` re-conflicts.
```

- Require as listed items the incoming changes, each conflict resolution, and each review finding acted on with its fix.
- When Review ran, keep the PR skill's Graft line; otherwise the Graft line is `_Graft: validated, not AI-reviewed._`.

## Report

- What came in from upstream.
- Each conflict and how it was resolved.
- Mods revised or dropped, with their registry rows.
- Review findings acted on, with their fixes.
- Outside a personal my-graft, the PR URL, or the branch when no PR was raised, with the PR guidance above (the Graft line chosen and the items filled in) as the arguments to pass to `/graft:pr`.
- When `## Personal clone` set the gh default, say so.
- Outside a personal my-graft, say to merge the PR with a merge commit, not squash or rebase.
- When the target is `~/.my-graft`, ask the user to run `/reload-plugins`.

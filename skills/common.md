# Shared rules

Skills follow the sections they name.

## Ask the user

Ask every question with `AskUserQuestion`.

## Command failures

If a command fails, help the user resolve it, then carry on.

## Reviewer model

The arguments may name a reviewer model (`fable`, `opus` or `sonnet`) anywhere, such as `sonnet` or `review with sonnet`. Take out the words that set it (all of `review with sonnet`, not just `sonnet`) before reading the rest. A word that belongs to the main text stays in it (for example, `sonnet` in `add sonnet support`); ask when it is unclear. The default is Opus.

## Find the work

Take the first that applies:

1. A file path: that plan file is the work.
2. A plan name: the arguments match `<root>/.claude/plans/<name>.md` (`.md` optional). That plan is the work.
3. A single kebab-case word with no matching plan: list the plans and ask whether it names one of them or is the work.
4. Other text: that text is the work.
5. Nothing: the work in this conversation.

## Sync the clone

Check that the clone is on `main` with no changed or untracked files.

```bash
git -C ~/.my-graft status --short --branch
```

It prints only the `## main...origin/main` line. If it prints more, work with the user until it prints that line alone, then carry on.

Bring in mods pushed to `origin` from the user's other machines.

```bash
git -C ~/.my-graft pull --ff-only origin main
```

If the pull cannot fast-forward, help the user merge `origin/main`; never rebase. For any conflicts, read the registry to understand what each mod changes, and get a decision from the user on how to resolve them.

## Settings

Settings live in `~/.my-graft/graft-settings.json`, a JSON object keyed by skill, then by setting (for example, `{"plan": {"outsideRepoPlans": "always"}}`). A missing file means no settings. If the file is not valid JSON, tell the user, treat it as no settings, and never write to it.

Write a setting only when `git -C ~/.my-graft rev-parse --show-toplevel` prints `~/.my-graft` (expanded). Otherwise the setting holds for this run only, and nothing is created. Do not pull before writing.

1. Skip the write while the clone has a merge in progress (`git -C ~/.my-graft rev-parse -q --verify MERGE_HEAD` succeeds). Note whether the commit may run: the clone is on `main`, `git -C ~/.my-graft status --porcelain -- graft-settings.json` prints nothing, and `git -C ~/.my-graft rev-list origin/main..HEAD` prints nothing.
2. Re-read the file and change only the one key.
3. Only when step 1 found the commit may run, commit and push the file.

   ```bash
   git -C ~/.my-graft add -- graft-settings.json
   git -C ~/.my-graft commit -m "Update graft settings" -- graft-settings.json
   git -C ~/.my-graft push origin main
   ```

4. When a step fails or the commit may not run, tell the user what is left (an uncommitted or unpushed settings file) and carry on. A rejected push is reported; the next Sync merges it.

Whenever a "don't ask again" answer cannot be saved, tell the user why.

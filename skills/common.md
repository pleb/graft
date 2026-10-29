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

## Claude Code version

Check the Claude Code version.

```bash
claude --version
```

If it is below 2.1.273, stop and tell the user to update Claude Code first.

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

Settings live in `~/.my-graft/graft-settings.json`, a JSON object keyed by skill, then by setting (for example, `{"plan": {"outsideRepoPlans": "always"}}`). A missing file means no settings.

| Key                      | Values            | Default | What it does                                                                                              |
| ------------------------ | ----------------- | ------- | --------------------------------------------------------------------------------------------------------- |
| `plan.outsideRepoPlans`  | `always`          | ask     | Outside a repo, `always` saves plans in `~/.my-graft/.claude/plans/` without asking.                      |
| `orchestrate.deletePlan` | `always`, `never` | ask     | After every milestone is done, `always` deletes an untracked Graft plan without asking; `never` keeps it. |

Save a setting only when `~/.my-graft` is the Graft clone (`git -C ~/.my-graft rev-parse --show-toplevel` prints it); otherwise the setting holds for this run only. To save, re-read the file, change only that key, then commit `graft-settings.json` alone and push it to `origin main`.

When a "don't ask again" answer cannot be saved, tell the user why.

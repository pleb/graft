# Shared rules

Skills follow the sections they name.

## Ask the user

Ask every question with `AskUserQuestion`.

## Command failures

If a command fails, help the user resolve it, then carry on.

## Reviewer model

The arguments may name a reviewer model (`fable`, `opus` or `sonnet`) anywhere, such as `sonnet` or `review with sonnet`. Take out the words that set it (all of `review with sonnet`, not just `sonnet`) before reading the rest. A word that belongs to the main text stays in it (for example, `sonnet` in `add sonnet support`); ask when it is unclear. The default is `common.reviewerModel`, else Opus.

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

Settings live in `~/.my-graft/graft-settings.json`, a JSON object keyed by skill (`common` for settings this file's shared sections read), then by setting, with string values (for example, `{"plan": {"questionsPerRound": "2"}}`). A missing file means no settings. A missing key, or a value not in the row's Values, means the Default.

| Key                      | Values            | Default | What it does                                                                                        |
| ------------------------ | ----------------- | ------- | --------------------------------------------------------------------------------------------------- |
| `common.reviewerModel`   | `fable`, `sonnet` | opus    | The reviewer model when the arguments name none.                                                    |
| `plan.outsideRepoPlans`  | `always`, `never` | ask     | Outside a repo, `always` saves plans in `~/.my-graft/.claude/plans/` without asking; `never` stops. |
| `plan.questionsPerRound` | `1`, `2`, `4`     | 3       | The most questions plan asks in one round.                                                          |
| `orchestrate.deletePlan` | `always`, `ask`   | never   | After every milestone is done, `always` deletes an untracked Graft plan; `ask` asks first.          |
| `pr.state`               | `ready`           | draft   | The state a new PR opens in when the arguments name none.                                           |
| `update.mode`            | `auto`            | ask     | `auto` merges without asking first when the arguments name no mode.                                 |

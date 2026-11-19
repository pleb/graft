# Graft settings

Settings change how Graft's commands behave. To make Graft ask fewer questions, see [Fewer questions](../README.md#fewer-questions). When a setting lets Graft answer a question for you, it says what it picked.

## Change a setting

Run `/graft-settings` to open the settings pane. It sets your defaults, or overrides for one repo or folder, in `~/.my-graft/graft-settings.json` (your copy of Graft), then commits and pushes. It won't save when it can't reach your `my-graft` repo, or while `~/.my-graft` has uncommitted or unpushed changes or isn't on `main`.

You can also edit that file yourself, then commit and push it. Settings nest by command, so `pr.state` is written `{ "pr": { "state": "ready" } }`. To see each setting's value in a repo and which file set it:

```bash
node ~/.my-graft/skills/settings.ts <repo path> --explain
```

## General

### `common.reviewerModel`

The model the reviewer agents use when the command doesn't name one.

- `opus` (default)
- `fable`
- `sonnet`

### `common.routineQuestions`

Small housekeeping questions, such as whether an issue is Resolves or Related, whether to gitignore `.claude/graft/`, or how to set up research worktrees.

- `ask` (default)
- `auto`: take the recommended answer.

## Plan and research

### `plan.questionsPerRound`

The most questions `/graft:plan` and `/graft:research` ask at once.

- `1`
- `2`
- `3` (default)
- `4`

### `plan.clearQuestions`

Plan questions that have a clear recommendation.

- `ask` (default)
- `default`: record the recommendation as a decision in the plan. Plan still asks about risky parts (contracts, schemas, stored data, security, migrations) and about naming.

### `plan.finishQuestion`

The last question `/graft:plan` and `/graft:research` ask before they wrap up.

- `ask` (default)
- `skip`: plan takes the recommended option and lists the answers it chose in its report. Research stops once its findings answer the question, even partly, and lists what is still open.

### `plan.manualChecksQuestion`

Which command asks how a plan's [manual checks](#orchestrate) are handled. Applies only when `orchestrate.manualChecks` is `ask`.

- `orchestrate` (default): `/graft:orchestrate`, when it starts.
- `finish`: `/graft:plan`, at the end of planning.

### `plan.outsideRepoPlans`

Where `/graft:plan` and `/graft:research` save their files when you run them outside a repo without naming a file.

- `ask` (default): ask whether to use `~/.my-graft`.
- `always`: `~/.my-graft/.claude/graft/`.
- `here`: this folder's `.claude/graft/`, working across the repos under it ([Working across repos](../README.md#working-across-repos)). Set it in the folder's `.claude/graft-settings.json`.
- `never`: stop.

### `research.steer`

Choosing which leads `/graft:research` follows after each round of agents.

- `ask` (default)
- `auto`: follow the ones it recommends.

### `research.uncommittedChanges`

What `/graft:research` experiments run on when you have uncommitted changes.

- `ask` (default): ask once per run.
- `always`: your changes.
- `never`: the last commit.

### `research.artifact`

Publishing the `/graft:research` report as a private claude.ai artifact as well as Markdown.

- `false` (default)
- `true`

## Orchestrate

Manual checks are the hands-on checks a plan lists, such as trying a page in a browser.

### `orchestrate.manualChecks`

How `/graft:orchestrate` handles manual checks.

- `ask` (default): use the mode recorded in the plan, or ask when the run starts.
- `pause`: stop after each milestone that has them until you report the result.
- `defer`: list them in the final report.

### `orchestrate.agentDoesManualChecks`

Having an agent run the manual checks it can (browser, scripts, database) once the branch is finished.

- `false` (default): you run every check.
- `true`: the agent runs what it can. Some checks may write to a shared database or service. Checks that need a person, a device or an account the agent lacks stay with you.

### `orchestrate.finishedPlan`

What happens to a finished Graft plan that git doesn't track and that isn't already archived in `~/.my-graft`.

- `leave` (default)
- `archive`: move it to `~/.my-graft/.claude/graft/plans/<repo>/`, on this machine only.
- `delete`

## Pull requests and review

### `pr.state`

The state `/graft:pr` opens a new PR in when the command doesn't name one.

- `draft` (default)
- `ready`

### `pr.mode`

Whether Graft raises PRs and attaches screenshots without being asked.

- `manual` (default): `/graft:orchestrate` and `/graft:execute` raise a PR only when you ask, and `/graft:pr` captures no screenshots, attaching only image files you name.
- `auto`: `/graft:orchestrate` and `/graft:execute` raise one PR per changed repo, and they and `/graft:pr` attach screenshots when the work changes a UI they can capture. For a UI fix, orchestrate and execute also take before shots when the work starts; other changes, and every direct `/graft:pr`, get after shots only. On a branch that already has a PR, a direct `/graft:pr` captures them only when you ask.

### `diff.comments`

How `/graft:diff` handles your comments when the command doesn't name a mode.

- `batch` (default): reply in each thread, and change code when you give the go-ahead or press Finish review.
- `auto`: apply each comment as it arrives and republish.

### `diff.fileList`

The file list layout a new `/graft:diff` page starts in. Your browser remembers a switch you make on the page.

- `flat` (default)
- `tree`

## Updates

### `update.mode`

Asking before `/graft:update` merges, when the command doesn't name a mode.

- `ask` (default)
- `auto`: merge straight away.

### `update.notify`

When Graft tells you your clone is behind upstream. Only the value at the top level of `~/.my-graft/graft-settings.json` counts, whatever `--explain` shows for a repo.

- `session` (default): a notice at each session start.
- `daily`: at most once a day.
- `sha`: once per new upstream commit.
- `persistent`: a status line until you update.
- `off`: never, and Graft doesn't check.

Graft checks at session start, at most once a day, with a read-only `git ls-remote` against the `upstream` remote of `~/.my-graft`: `pleb/graft`, or your organisation's [interstock](../README.md#interstocks). After a failed check it waits an hour, then two, four and so on, up to a day. It doesn't check in non-interactive runs, when `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` is set, or when there is no `upstream` remote.

## How settings combine

The top level of `~/.my-graft/graft-settings.json` holds your defaults. A path key overrides them for that repo, or, ending in `/*`, for that folder and every repo under it:

```json
{
  "pr": { "state": "draft" },
  "~/work/*": { "overrides": { "pr": { "state": "ready" } } },
  "/Users/me/oss/graft": { "overrides": { "plan": { "questionsPerRound": "4" } } }
}
```

Paths start with `/`, `~` or a drive letter. On Windows, use forward slashes (`C:/work/*`). Paths match the main checkout, so a linked worktree gets the same overrides.

A repo, or a folder outside one, can also hold `.claude/graft-settings.json` (shared) and `.claude/graft-settings.local.json` (yours; keep it out of git) at its top level. They hold settings, not paths, and you edit them by hand. A linked worktree reads its own copies.

When a setting is set in more than one place, the later one in this list wins:

1. Built-in defaults
2. The top level of `~/.my-graft/graft-settings.json`
3. Path overrides, broadest first, then the exact repo path
4. `.claude/graft-settings.json`
5. `.claude/graft-settings.local.json`

An invalid value is ignored, and the next valid one up the list applies. A file that isn't valid JSON, or isn't shaped like the example, stops Graft's commands until you fix it.

When `/graft:orchestrate` works across repos, it takes `common.reviewerModel` and `pr.state` from each repo and the rest from the folder.

`/graft:yolo` overrides several settings. It answers its own questions, asking only when the request is unclear. It has an agent run the manual checks it can, defers the rest, acts as `pr.mode: auto`, and opens PRs as ready unless you name a state.

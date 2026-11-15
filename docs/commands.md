# Graft commands

Every Graft command, with its arguments. In each signature, square brackets mark an optional argument, `|` separates the choices, and `(default)` marks the one used when you give none. Arguments are free text, and Graft picks out the issues and reviewer model wherever they appear, so `/graft:plan add a dark mode #12 sonnet` names a topic, an issue and a reviewer model.

Your clone is `~/.my-graft`, the local copy of your private `my-graft` repo that Claude Code loads Graft from.

[Shared arguments](#shared-arguments) explains the issues and reviewer model arguments that several commands take.

**Plan and build**

- [`/graft:research`](#graftresearch): investigate a question before planning
- [`/graft:plan`](#graftplan): write a plan with you
- [`/graft:orchestrate`](#graftorchestrate): build a plan with agents, reviewed as it goes
- [`/graft:execute`](#graftexecute): plan and build in one run
- [`/graft:yolo`](#graftyolo): plan, build and raise a PR, asking only when unclear

**Review and ship**

- [`/graft:diff`](#graftdiff): comment on your branch's changes line by line
- [`/graft:pr`](#graftpr): raise or update a pull request
- [`/graft:review`](#graftreview): review a pull request or your branch

**Change and update your copy**

- [`/graft:update`](#graftupdate): merge upstream changes into your clone
- [`/graft:modify`](#graftmodify): change your copy of Graft
- [`/graft:tune`](#grafttune): find mods from corrections you repeat

**Settings and removal**

- [`/graft-settings`](#graft-settings): edit settings in a pane
- [`/graft:uninstall`](#graftuninstall): remove Graft

## Shared arguments

`[issues]` takes GitHub issues as `#N`, `owner/repo#N` or an issue URL. Graft reads each one and links it as Resolves (the work closes it) or Related (linked only). A pull request raised later carries a `Resolves` line for each open Resolves issue.

`[reviewer model]` picks the model for the reviewer agents: `fable`, `opus` or `sonnet`. Without one, Graft uses [`common.reviewerModel`](./settings.md#commonreviewermodel), which defaults to `opus`.

## Plan and build

### /graft:research

```text
/graft:research [research path | research name | question] [issues] [reviewer model: sonnet | opus (default) | fable]
```

Investigates a question with you before anything is planned, and never changes code. Researcher agents read code and sources, experimenter agents run code in throwaway git worktrees, and an adversarial reviewer challenges what they found before the research concludes. The report is written to `.claude/graft/research/<name>/report.md` as the research goes. Pass its name to `/graft:plan` or `/graft:execute` to plan from it, or pass it back to `/graft:research` to continue.

```text
/graft:research which testing framework should we use? compare maintainability, speed and ecosystem
```

### /graft:plan

```text
/graft:plan [plan path | plan name | research path | research name | topic] [issues] [reviewer model: sonnet | opus (default) | fable]
```

Works out a plan with you, starting from a one-line topic, a full spec or a research report. Graft reads the code the request touches and asks questions in rounds until the approach is settled, then writes it to `.claude/graft/plans/<name>.md` in the repo, split into milestones (steps small enough to build and check one at a time). The first time, it asks whether git should ignore that folder. Name an existing plan to revise it.

```text
/graft:plan deployment of the static site under /web to an azure static website using bicep
```

### /graft:orchestrate

```text
/graft:orchestrate [plan path | plan name | task] [issues] [reviewer model: sonnet | opus (default) | fable]
```

Builds a finished plan, or a task list you give it, on a branch (a new feature branch when you start on the default branch). A worker agent implements each milestone and Graft commits it. A reviewer checks the commits as they build up, joined by an adversarial reviewer when a change is risky, and both check every milestone commit before the run ends. Comment and docs editors then tidy the branch, and the repo's tests and other checks run on the result. Ask for a PR in the arguments, such as `open a pr`, and it raises one when the work is done.

Run `/clear` between `/graft:plan` and `/graft:orchestrate`, so the build starts with an empty context:

```text
/graft:orchestrate deploy-static-site-to-azure
```

### /graft:execute

```text
/graft:execute [plan path | plan name | research path | research name | topic] [issues] [reviewer model: sonnet | opus (default) | fable] [pr request]
```

Plans and then orchestrates in one session, with no `/clear` in between. Use it for work small enough that the plan and the build fit in one conversation. You still answer the plan's questions, but once the plan is written it runs a review of the plan instead of asking whether to, then starts building. Add a PR request, such as `open a pr`, to raise one at the end.

### /graft:yolo

```text
/graft:yolo [plan path | plan name | research path | research name | topic] [issues] [reviewer model: sonnet | opus (default) | fable] [pr guidance]
```

Runs `/graft:execute` and makes the calls you would usually make, asking only when the request is unclear. Each decision it makes without asking is recorded in the plan's `## Decisions`. It ends in a pull request, ready for review unless the arguments name a state, with screenshots when it can capture them. Before it starts, it commits uncommitted changes related to the work and stashes the unrelated ones. Once the PR is raised it puts the stash back if it applies cleanly; otherwise its closing summary names the stash it left.

## Review and ship

### /graft:diff

```text
/graft:diff [mode: batch (default) | auto]
```

Publishes the current branch's changes against the default branch, uncommitted ones included, as a private claude.ai artifact you can comment on line by line. It needs the claude.ai Artifact tools in Claude Code. Send each comment to Claude from the page; plain comments do not reach the session. In `batch` mode, Claude replies in each thread and changes code only when you reply with a go-ahead or press Finish review. In `auto` mode, it applies each comment as it arrives. [`diff.comments`](./settings.md#diffcomments) sets the default mode.

### /graft:pr

```text
/graft:pr [guidance] [state: draft (default) | ready-state (pr.state: ready)]
```

Pushes the branch and opens a pull request, following the repo's PR template when it has one. A new PR opens in the state the arguments name, else in the state [`pr.state`](./settings.md#prstate) sets (draft by default). When the branch already has a PR, Graft rewrites its title and body instead, and changes its state only when the arguments name one. It stops if the working tree has uncommitted changes. Anything else you write is guidance for the description.

### /graft:review

```text
/graft:review [pr number | url] [reviewer model: sonnet | opus (default) | fable]
```

Gets two reviews of a change, one from a reviewer looking for bugs and one from an adversarial reviewer looking for reasons it should not ship, and combines them into one list with a severity for each finding. Reviewing a PR needs a clone of the PR's repo. With no PR named, it offers the current branch's PR if there is one; otherwise it reviews the current branch against the default branch, plus uncommitted and untracked changes. Afterwards you can post the findings you pick to the PR as comments, or have `/graft:execute` fix them.

## Change and update your copy

### /graft:update

```text
/graft:update [mode: ask (default) | auto]
```

Merges the latest Graft from upstream (the repo your clone takes updates from: `pleb/graft`, or your organisation's [interstock](../README.md#interstocks), its shared copy of Graft) into your clone, keeping your mods. A mod is a change you made to your clone with `/graft:modify`. In `ask` mode it lists what is new and asks before merging; [`update.mode`](./settings.md#updatemode) sets the default. When a conflict touches a mod, Graft resolves it so the mod's recorded intent still holds, and asks when it cannot. When you have mods, a reviewer and an adversarial reviewer check the merge before it is committed. The merge is pushed to your `my-graft` repo, or raised as a PR when you run it in a clone of an interstock or of `pleb/graft`. It needs Claude Code 2.1.273 or later.

### /graft:modify

```text
/graft:modify [when... do...]
```

Changes your copy of Graft, one mod at a time. Each mod is recorded with its intent in `MODS.md` so `/graft:update` can keep it. Describe the behaviour you want. Graft settles the change with you, implements it, has a reviewer and an adversarial reviewer check it, then commits it and pushes it to your `my-graft` repo. Run it in a clone of an interstock or of `pleb/graft` and it raises a PR instead. Like update, it needs Claude Code 2.1.273 or later.

```text
/graft:modify after raising a pr, monitor the ci checks and fix anything that fails
```

### /graft:tune

```text
/graft:tune [guidance] [window: 14 days (default) | <n> days]
```

Reads your `/graft:plan`, `/graft:orchestrate`, `/graft:execute` and `/graft:yolo` runs from the last 14 days (or the window you give) for corrections you keep making to how Graft works. A correction counts only when it shows up in at least two tasks across at least two sessions. You pick which findings to keep, and each one becomes a mod through `/graft:modify`.

## Settings and removal

### /graft-settings

```text
/graft-settings
```

Opens a pane in Claude Code that edits Graft's defaults and per-repo overrides in `~/.my-graft/graft-settings.json`. Each change is committed and pushed to your `my-graft` repo. Where the pane cannot open, the command prints the current settings instead. [Graft settings](./settings.md) lists every setting and how the settings files combine.

### /graft:uninstall

```text
/graft:uninstall
```

Removes Graft from Claude Code and deletes `~/.my-graft`, after asking first. Before it asks, it shows the output of `git status --short --branch` for the clone (its branch, uncommitted changes and untracked files) and lists any files under `.claude/graft/` or `.claude/plans/` that deleting the clone would delete. It does not list stashes, other branches or ignored files. Your `my-graft` repo on GitHub stays, so installing again later brings your mods back.

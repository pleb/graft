# Graft

A minimal software engineering flow for Claude Code (plan → implement → ship) that lives in your own private copy.

[Try the simulator](https://pleb.github.io/graft/) to watch Graft run a session in your browser.

> [!NOTE]
> These docs are minimal on purpose. Graft's skills and agents are short Markdown files written for people to read, so they describe themselves. Start with [plan](./skills/plan/SKILL.md), [orchestrate](./skills/orchestrate/SKILL.md) and [pr](./skills/pr/SKILL.md).

## Install

```text
Claude, install Graft https://raw.githubusercontent.com/pleb/graft/main/agent-install.md
```

That's it! Install creates (or reuses) a private `<login>/my-graft` repo holding Graft's history. Your mods live there, and `/graft:update` merges the latest Graft into it.

To install Graft on another machine, or again after `/graft:uninstall`, run the same command. Install clones your existing `my-graft` repo, so your mods come with it.

## How it works

Graft has three levels to start from, depending on the size of the work and how much you already know:

- `/graft:research` when the question is still open and you want facts before deciding.
- `/graft:plan` when you know what you want and need a plan to build it.
- `/graft:execute` when the work is small enough to plan and build in one session. `/graft:yolo` runs it with the agent making the calls, ending in a ready PR.

![Graft's flow: /graft:research, /graft:plan and /graft:execute are where you begin. /graft:research works with you, a researcher, an experimenter and an adversarial reviewer to write a research report, which /graft:plan takes as context. /graft:plan works with you, a researcher and two reviewers to write a plan file. /graft:orchestrate has a worker implement each milestone and commits it, with two reviewers alongside, then comment-editor and docs-editor clean up, leaving commits on a branch. /graft:execute runs plan and then orchestrate in one session with you deciding. /graft:yolo runs the same with the agent deciding, ending in a ready PR with screenshots. /graft:diff publishes a Claude Code artifact for you to review the changes and comment on, then Claude acts on your feedback. /graft:pr pushes the branch and opens a PR.](./docs/flow.svg)

### Research

```text
/graft:research [research path | research name | question] [issues] [reviewer model: sonnet | opus (default) | fable]
```

Investigates a question with you before planning. It sends researchers to read code and sources and experimenters to run code in throwaway git worktrees, then has an adversarial reviewer challenge what it found. It writes a report to `.claude/graft/research/<name>/report.md`. Pass the research name to `/graft:plan` or `/graft:execute` to plan from the report.

```text
/graft:research why do static site deploys take ten minutes
```

### Plan

```text
/graft:plan [plan path | plan name | research path | research name | topic] [issues] [reviewer model: sonnet | opus (default) | fable]
```

Settles a plan with you. The plan can be a task with any level of initial detail; Graft helps build enough context for successful plan execution. Plans are saved to `.claude/graft/plans` in the repo. The first time, Graft asks whether to ignore them.

```text
/graft:plan deployment of the static site under /web to an azure static website using bicep
```

### Orchestrate

```text
/graft:orchestrate [plan path | plan name | task] [issues] [reviewer model: sonnet | opus (default) | fable]
```

Implements a ready plan, milestone by milestone.

```text
/graft:orchestrate deploy-static-site-to-azure
```

### Execute

```text
/graft:execute [plan path | plan name | research path | research name | topic] [issues] [reviewer model: sonnet | opus (default) | fable] [pr request]
```

Plans and then orchestrates in one session, with no `/clear` in between.

### Yolo

```text
/graft:yolo [plan path | plan name | research path | research name | topic] [issues] [reviewer model: sonnet | opus (default) | fable] [pr guidance]
```

Runs `/graft:execute` and makes the calls you would usually make. It asks only when the request is unclear, and ends in a ready PR, with screenshots when it can capture them. It commits uncommitted changes related to the work. It stashes the unrelated ones and, once the PR is raised, restores them when they apply cleanly; otherwise Report names the stash left.

### Diff

```text
/graft:diff [mode: batch (default) | auto]
```

Publishes your changes as a private artifact to comment on. In `batch` mode (the default), Claude replies to each comment and changes code only when you give a go-ahead or press Finish review. In `auto` mode, Claude applies each comment as it arrives. [`diff.comments`](./docs/settings.md#settings) sets the default.

### PR

```text
/graft:pr [guidance] [state: draft (default) | ready-state]
```

Pushes the branch and opens a PR when you're ready to ship the changes.

### Review

```text
/graft:review [pr number | url] [reviewer model: sonnet | opus (default) | fable]
```

Reviews a PR or the working tree with the reviewer and adversarial reviewer, prints one combined review, then offers to post findings to the PR or apply them through execute.

## Utility commands

```text
/graft:update [mode: ask (default) | auto]
/graft:uninstall
/graft:modify [when... do...]
/graft:tune [guidance] [window: 14 days (default) | <n> days]
```

Make Graft your own with `/graft:modify when ... do ...`. `/graft:update` keeps your mods when it brings in upstream changes.

`/graft:tune` finds corrections you keep making to plan, orchestrate, execute and yolo runs and turns the ones you pick into mods.

![How your copy of Graft stays current, in two lanes. Where Graft lives: /graft:update merges the latest Graft from pleb/graft, the upstream, into your clone at ~/.my-graft, keeping your mods. The clone pushes to your private repo <login>/my-graft, and your other machines pull from it. Using and changing it: Claude Code loads Graft from the clone, and /reload-plugins picks up changes. In Claude Code, Graft tells you to run /graft:update when it is due. You run /graft:modify and /graft:tune. /graft:modify commits a mod to the clone, recorded in MODS.md. /graft:tune finds corrections you keep making and turns the ones you pick into mods through /graft:modify.](./docs/update.svg)

## Update notices

When a session starts, Graft checks whether your clone at `~/.my-graft` has the latest `main` from its upstream (`pleb/graft`, or your [interstock](#interstocks)). It asks upstream with a read-only `git ls-remote`, at most once a day after a successful look, and never fetches or changes the clone. It skips the check in non-interactive runs and when `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` is set.

When the clone is behind, a notice says so and suggests `/graft:update` at the prompt. [`update.notify`](./docs/settings.md#update-notices) sets how often, or shows a status line instead.

## Working across repos

Research, plan, execute, orchestrate and yolo can run from a folder of repos. Turn it on in the folder's `.claude/graft-settings.json`:

```json
{ "plan": { "outsideRepoPlans": "here" } }
```

Graft adds a repo the work needs with the command the folder's `CLAUDE.md` (or a parent's) gives for adding one, and asks when it gives none. For a repo that does not exist yet, it asks for a command that creates one with at least one commit and an `origin` to push to.

The plan's `## Repos` lists each repo the work changes, with the command that adds it or `existing`. When asked for a PR, orchestrate raises one per changed repo and links them.

## Settings

`/graft-settings` opens a pane that edits the defaults and per-repo overrides. A change is saved, then committed and pushed.

Settings live in `~/.my-graft/graft-settings.json`. A repo can override them in `.claude/graft-settings.json` and `.claude/graft-settings.local.json`. [Graft settings](./docs/settings.md) lists every setting and how these files combine.

### Fewer questions

These settings remove questions Graft asks. Opting in trades questions for risk: for each, the agent decides instead and says what it chose.

- `orchestrate.agentDoesManualChecks: true` removes the Manual checks an agent can run itself from the ones you are asked to run.
- `plan.finishQuestion: skip` removes the Finish question in `/graft:plan` and `/graft:research`.
- `plan.clearQuestions: default` removes the plan questions that have a clear recommendation.
- `research.steer: auto` removes the question of which threads to follow after each research wave.
- `common.routineQuestions: auto` removes routine questions, such as linking an issue, ignoring the Graft folder or setting up research worktrees.
- `plan.outsideRepoPlans: always` or `never` removes the question of whether to save plans and research outside a repo.
- `research.uncommittedChanges: always` or `never` removes the question of whether experiments run on your uncommitted changes.
- `orchestrate.manualChecks: defer` or `pause` removes the question of how to handle a plan's Manual checks.
- `update.mode: auto` removes the question before `/graft:update` merges.
- `diff.comments: auto` removes the go-ahead `/graft:diff` waits for before changing code.

For the fewest questions, use [`/graft:yolo`](#yolo). It asks only when the request is unclear.

## Interstocks

An interstock (in horticulture, the middle piece of a double graft) is an organisation's shared copy of Graft that sits between `pleb/graft` and its users, replacing `pleb/graft` with its own repo. To create one:

```text
Claude, install Graft https://raw.githubusercontent.com/pleb/graft/main/interstock.md
```

Colleagues install with the install command in the interstock repo's README.

The caretaker updates and modifies the interstock by running `/graft:update` and `/graft:modify` in a clone of its repo. In that clone, and in a clone of `pleb/graft`, both commands raise a PR for you to merge. In your own copy, they push straight to `main`. `/graft:update` also keeps the interstock in line with `interstock.md`.

The interstock records its mods in `INTERSTOCK-MODS.md`. Each copy records its own in `MODS.md`.

## Acknowledgements

Inspired by:

- [staff0rd/assist](https://github.com/staff0rd/assist)
- [openai/codex-plugin-cc](https://github.com/openai/codex-plugin-cc)
- [mattpocock/skills](https://github.com/mattpocock/skills)
- [github/spec-kit](https://github.com/github/spec-kit)
- [obra/superpowers](https://github.com/obra/superpowers)
- [humanlayer/claudelayer](https://github.com/humanlayer/claudelayer)
- [MakerXStudio/yoke](https://github.com/MakerXStudio/yoke)

# Graft

A minimal software engineering flow for Claude Code (plan → implement → ship) that lives in your own private copy.

> [!NOTE]
> These docs are minimal on purpose. Graft's skills and agents are short Markdown files written for people to read, so they describe themselves. Start with [plan](./skills/plan/SKILL.md), [orchestrate](./skills/orchestrate/SKILL.md) and [pr](./skills/pr/SKILL.md).

## Install

```text
Claude, install Graft https://raw.githubusercontent.com/pleb/graft/main/agent-install.md
```

That's it! Install creates (or reuses) a private `<login>/my-graft` repo holding Graft's history. Your mods live there, and `/graft:update` merges the latest Graft into it.

To install Graft on another machine, or again after `/graft:uninstall`, run the same command. Install clones your existing `my-graft` repo, so your mods come with it.

## How it works

![Graft's flow: /graft:plan works with you, a researcher and two reviewers to write a plan file. /graft:orchestrate has a worker implement each milestone and commits it, with two reviewers alongside, then comment-editor and docs-editor clean up, leaving commits on a branch. /graft:execute runs plan and then orchestrate in one session. /graft:diff publishes a Claude Code artifact for you to review the changes and comment on, then Claude acts on your feedback. /graft:pr pushes the branch and opens a PR.](./docs/flow.svg)

Start by creating a plan. Plans are automatically saved to `.claude/plans` in the repo. The first time, Graft asks whether to ignore them.

The plan can be a task with any level of initial detail. Graft will help build enough context for successful plan execution.

```text
/graft:plan deployment of the static site under /web to an azure static website using bicep
```

Once the plan is ready to execute, use the orchestrator to implement the plan.

```text
/graft:orchestrate deploy-static-site-to-azure
```

Or use `/graft:execute` to plan and then orchestrate in one session, with no `/clear` in between.

And when you're ready to ship the changes:

```text
/graft:pr
```

## Flow commands

```text
/graft:plan [plan path | plan name | topic] [issues] [reviewer model: sonnet | opus (default) | fable]
/graft:orchestrate [plan path | plan name | task] [issues] [reviewer model: sonnet | opus (default) | fable]
/graft:execute [plan path | plan name | topic] [issues] [reviewer model: sonnet | opus (default) | fable] [pr request]
/graft:diff
/graft:pr [guidance] [state: draft (default) | ready-state]
```

## Helper commands

```text
/graft:review [pr number | url] [reviewer model: sonnet | opus (default) | fable]
```

`/graft:review` reviews a PR or the working tree with the reviewer and adversarial reviewer, prints one combined review, then offers to post findings to the PR or apply them through execute.

## Utility commands

```text
/graft:update [mode: ask (default) | auto]
/graft:uninstall
/graft:modify [when... do...]
/graft:tune [guidance] [window: 14 days (default) | <n> days]
```

Make Graft your own with `/graft:modify when ... do ...`. `/graft:update` keeps your mods when it brings in upstream changes.

`/graft:tune` finds corrections you keep making to plan, orchestrate and execute runs and turns the ones you pick into mods.

![How your copy of Graft stays current: /graft:update merges the latest Graft from pleb/graft into your clone at ~/.my-graft, keeping your mods. /graft:modify commits a mod to the clone, recorded in MODS.md. /graft:tune finds corrections you keep making and hands the ones you pick to /graft:modify. The clone pushes to your private \<login\>/my-graft repo, and your other machines pull from it. Claude Code loads Graft from the clone, and /reload-plugins picks up changes. Graft's mod in Claude Code tells you when /graft:update is due.](./docs/update.svg)

## Update notices

When a session starts, Graft checks whether your clone at `~/.my-graft` lacks commits on its upstream's `main` (`pleb/graft`, or your interstock). It asks upstream at most once a day with a read-only `git ls-remote` and reuses that answer in between; after a failed look it retries in an hour, doubling up to a day. It never fetches or changes the clone. It skips the check in non-interactive runs and when `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` is set.

When the clone is behind, a notice says so and suggests `/graft:update` at the prompt; in `persistent` mode a status line says so instead. `update.notify` sets how often:

- `session` (default): at each session start.
- `daily`: at most once a day.
- `sha`: once per upstream commit.
- `persistent`: a status line that stays until you update.
- `off`: never, and upstream is not contacted.

The notice changes nothing. `/graft:update` is how you bring the changes in.

## Settings

```text
/graft-settings
```

`/graft-settings` opens a pane that edits the defaults and per-repo overrides. A change is saved, then committed and pushed.

| Key                         | Values                                         | Default     | Shown when                       | What it does                                                                                                                                                                                                                                                                         |
| --------------------------- | ---------------------------------------------- | ----------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `common.reviewerModel`      | `fable`, `opus`, `sonnet`                      | opus        |                                  | The reviewer model when the command names none.                                                                                                                                                                                                                                      |
| `plan.outsideRepoPlans`     | `always`, `ask`, `never`                       | ask         |                                  | What `/graft:plan` does outside a repo: save plans in `~/.my-graft/.claude/plans/` (`always`), ask first (`ask`) or stop (`never`).                                                                                                                                                  |
| `plan.questionsPerRound`    | `1`, `2`, `3`, `4`                             | 3           |                                  | The most questions `/graft:plan` asks at once.                                                                                                                                                                                                                                       |
| `plan.manualChecksQuestion` | `finish`, `orchestrate`                        | orchestrate | `orchestrate.manualChecks = ask` | When `orchestrate.manualChecks` is `ask`, whether `/graft:plan` asks how a plan's Manual checks are handled in its Finish question (`finish`) or leaves it to `/graft:orchestrate` (`orchestrate`).                                                                                  |
| `orchestrate.finishedPlan`  | `archive`, `delete`, `leave`                   | leave       |                                  | What `/graft:orchestrate` does with an untracked plan once every milestone is done: move it to `~/.my-graft/.claude/plans/<repo>/<plan>.md` (`archive`), delete it (`delete`) or leave it in place (`leave`). Archives stay on this machine.                                         |
| `orchestrate.manualChecks`  | `ask`, `defer`, `pause`                        | ask         |                                  | How `/graft:orchestrate` handles a plan's Manual checks: stop after each milestone that has them until you report the result (`pause`), list them in its report (`defer`) or ask at the start of the run (`ask`).                                                                    |
| `pr.state`                  | `draft`, `ready`                               | draft       |                                  | The state `/graft:pr` opens a new PR in when the command names none.                                                                                                                                                                                                                 |
| `update.mode`               | `ask`, `auto`                                  | ask         |                                  | Whether `/graft:update` asks before merging (`ask`) or merges straight away (`auto`) when the command names no mode.                                                                                                                                                                 |
| `update.notify`             | `daily`, `off`, `persistent`, `session`, `sha` | session     |                                  | When Graft tells you `/graft:update` is due: a notice at each session start (`session`), at most once a day (`daily`) or once per upstream commit (`sha`), a status line until you update (`persistent`), or never, with no upstream check (`off`). Per-repo overrides do not apply. |

Settings live in `~/.my-graft/graft-settings.json`:

```json
{
  "pr": { "state": "draft" },
  "~/work/*": { "overrides": { "pr": { "state": "ready" } } },
  "/Users/me/oss/graft": { "overrides": { "plan": { "questionsPerRound": "4" } } },
  "C:/work/*": { "overrides": { "pr": { "state": "ready" } } }
}
```

Top-level skill keys are the defaults. A key that is a path is a scope whose `overrides` apply to that repo, or to every repo under a directory ending in `/*`; scopes apply from the broadest to the repo's own path. On Windows, write scope paths with forward slashes; `/c/...` and local admin shares such as `//localhost/C$/...` are read as `C:/...`.

## Interstocks

An interstock (in horticulture, the middle piece of a double graft) is an organisation's shared copy of Graft that sits between `pleb/graft` and its users, replacing `pleb/graft` with its own repo. To create one:

```text
Claude, install Graft https://raw.githubusercontent.com/pleb/graft/main/interstock.md
```

Colleagues install with the install command in the interstock repo's README.

The caretaker updates and modifies the interstock by running `/graft:update` and `/graft:modify` in a clone of its repo. In that clone, and in a clone of `pleb/graft`, both commands raise a PR for you to merge. In your own copy, they push straight to `main`.

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

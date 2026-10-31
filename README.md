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

![Graft's flow: /graft:plan works with you, a researcher and two reviewers to write a plan file. /graft:orchestrate has a worker implement each milestone and commits it, with two reviewers alongside, then comment-editor and docs-editor clean up, leaving commits on a branch. /graft:diff publishes a Claude Code artifact for you to review the changes and comment on, then Claude acts on your feedback. /graft:pr pushes the branch and opens a PR.](./docs/flow.svg)

Start by creating a plan. Plans are automatically saved to `.claude/plans` in the repo. The first time, Graft asks whether to ignore them.

The plan can be a task with any level of initial detail. Graft will help build enough context for successful plan execution.

```text
/graft:plan deployment of the static site under /web to an azure static website using bicep
```

Once the plan is ready to execute, use the orchestrator to implement the plan.

```text
/graft:orchestrate deploy-static-site-to-azure
```

And when you're ready to ship the changes:

```text
/graft:pr
```

Plan and orchestrate also take GitHub issues (`#42`, `owner/repo#42` or an issue URL) and read each one, comments included. A plan lists them under `## References`. Orchestrate asks which issues the work resolves, and `/graft:pr` links those.

## Flow commands

```text
/graft:plan [plan path | plan name | topic] [issues] [reviewer model: sonnet | opus (default) | fable]
/graft:orchestrate [plan path | plan name | task] [issues] [reviewer model: sonnet | opus (default) | fable]
/graft:diff
/graft:pr [guidance] [state: draft (default) | ready-state]
```

## Utility commands

```text
/graft:update [mode: ask (default) | auto]
/graft:uninstall
/graft:modify [when... do...]
/graft:tune [guidance] [window: 14 days (default) | <n> days]
```

Make Graft your own with `/graft:modify when ... do ...`. `/graft:update` keeps your mods when it brings in upstream changes.

`/graft:tune` finds corrections you keep making to plan and orchestrate runs and turns the ones you pick into mods.

![How your copy of Graft stays current: /graft:update merges the latest Graft from pleb/graft into your clone at ~/.my-graft, keeping your mods. /graft:modify commits a mod to the clone, recorded in MODS.md. /graft:tune finds corrections you keep making and hands the ones you pick to /graft:modify. The clone pushes to your private \<login\>/my-graft repo, and your other machines pull from it. Claude Code loads Graft from the clone, and /reload-plugins picks up changes.](./docs/update.svg)

## Settings

```text
/graft-settings
```

`/graft-settings` opens a pane listing each Graft setting with its allowed values, default and current value. A change is saved to `~/.my-graft/graft-settings.json`, then committed and pushed.

| Key                      | Values                    | Default | What it does                                                                                                                                |
| ------------------------ | ------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `common.reviewerModel`   | `fable`, `opus`, `sonnet` | opus    | The reviewer model when the command names none.                                                                                             |
| `plan.outsideRepoPlans`  | `always`, `ask`, `never`  | ask     | What `/graft:plan` does outside a repo: save plans in `~/.my-graft/.claude/plans/` (`always`), ask first (`ask`) or stop (`never`).         |
| `plan.questionsPerRound` | `1`, `2`, `3`, `4`        | 3       | The most questions `/graft:plan` asks at once.                                                                                              |
| `orchestrate.deletePlan` | `always`, `ask`, `never`  | never   | What `/graft:orchestrate` does with an untracked plan once every milestone is done: delete it (`always`), ask (`ask`) or keep it (`never`). |
| `pr.state`               | `draft`, `ready`          | draft   | The state `/graft:pr` opens a new PR in when the command names none.                                                                        |
| `update.mode`            | `ask`, `auto`             | ask     | Whether `/graft:update` asks before merging (`ask`) or merges straight away (`auto`) when the command names no mode.                        |

## Interstocks

An interstock (in horticulture, the middle piece of a double graft) is an organisation's shared copy of Graft that sits between `pleb/graft` and its users, replacing `pleb/graft` with its own repo. To create one:

```text
Claude, install Graft https://raw.githubusercontent.com/pleb/graft/main/interstock.md
```

Colleagues install with the install command in the interstock repo's README. Running `/graft:update` and `/graft:modify` in a clone of the interstock repo is how its caretaker updates or modifies it.

## Acknowledgements

Inspired by:

- [staff0rd/assist](https://github.com/staff0rd/assist)
- [openai/codex-plugin-cc](https://github.com/openai/codex-plugin-cc)
- [mattpocock/skills](https://github.com/mattpocock/skills)

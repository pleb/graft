# Graft

A minimal software engineering flow for Claude Code (plan → implement → ship) that lives in your own private copy.

> [!NOTE]
> These docs are minimal on purpose. Graft's skills and agents are short Markdown files written for people to read, so they describe themselves. Start with [plan](./skills/plan/SKILL.md), [orchestrate](./skills/orchestrate/SKILL.md) and [pr](./skills/pr/SKILL.md).

## Install

```text
Claude, install Graft https://raw.githubusercontent.com/pleb/graft/main/agent-install.md
```

That's it! Install creates (or reuses) a private `<login>/my-graft` repo holding Graft's history. Your mods live there, and `/graft:update` merges the latest Graft into it.

To install Graft on another machine, or again after `/graft:uninstall`, run the same command. Install finds your `my-graft` repo and clones it, so your mods come with it.

## How it works

![Graft's flow: /graft:plan works with you, a researcher and two reviewers to write a plan file. /graft:orchestrate has a worker implement each milestone and commits it, with two reviewers alongside, then comment-editor and docs-editor clean up, leaving commits on a branch. /graft:pr pushes the branch and opens a PR.](./docs/flow.svg)

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

## Flow commands

```text
/graft:plan [plan path | plan name | topic] [reviewer model: sonnet | opus (default) | fable]
/graft:orchestrate [plan path | plan name | task] [reviewer model: sonnet | opus (default) | fable]
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

`/graft:tune` finds corrections you keep making to plan and orchestrate runs and turns the ones you pick into mods. It needs Node 24 or later.

![How your copy of Graft stays current: /graft:update merges the latest Graft from pleb/graft into your clone at ~/.my-graft, keeping your mods. /graft:modify commits a mod to the clone, recorded in MODS.md. /graft:tune finds corrections you keep making and hands the ones you pick to /graft:modify. The clone pushes to your private \<login\>/my-graft repo, and your other machines pull from it. Claude Code loads Graft from the clone, and /reload-plugins picks up changes.](./docs/update.svg)

## Graft development

Install from a local checkout:

```bash
claude plugin marketplace add /path/to/graft
claude plugin install graft@graft
```

## Acknowledgements

Inspired by:

- [staff0rd/assist](https://github.com/staff0rd/assist)
- [openai/codex-plugin-cc](https://github.com/openai/codex-plugin-cc)
- [mattpocock/skills](https://github.com/mattpocock/skills)

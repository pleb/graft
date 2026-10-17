# Graft

A minimal software engineering flow for Claude Code (plan → implement → ship) that lives in your own private copy.

The name comes from grafting: your changes are joined onto Graft and grow with it.

## Install

```text
Claude, install Graft https://raw.githubusercontent.com/pleb/graft/main/agent-install.md
```

That's it! Install creates (or reuses) a private `<login>/my-graft` repo holding Graft's history. Your mods live there, and `/graft:update` merges new Graft releases into it.

## Flow commands

```text
/graft:plan [plan path | plan name | topic] [reviewer model: sonnet | opus (default) | fable]
/graft:orchestrate [plan path | plan name] [reviewer model: sonnet | opus (default) | fable]
/graft:pr [guidance] [state: draft (default) | ready-state]
```

_How does it work?_

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

Graft is designed so you can understand it. If you want to know more, start with [plan](./skills/plan/SKILL.md), [orchestrate](./skills/orchestrate/SKILL.md), [pr](./skills/pr/SKILL.md).

## Utility commands

```text
/graft:update [mode: ask (default) | auto]
/graft:uninstall
/graft:modify [when... do...]
```

Make Graft your own with `/graft:modify when ... do ...`. `/graft:update` keeps your mods when it brings in upstream changes.

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

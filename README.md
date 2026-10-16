# Krew

A minimal software engineering flow for Claude Code (plan → implement → ship) that you fork and make your own.

## Install

```text
Claude, install krew https://raw.githubusercontent.com/pleb/krew/main/agent-install.md
```

That's it!

## Flow commands

```text
/krew:plan [plan path | plan name | topic] [reviewer model: default opus]
/krew:orchestrate [plan path | plan name] [reviewer model: default opus]
/krew:pr [ready-state] [guidance]
```

_How does it work?_

Start by creating a plan. Plans are automatically saved to `.claude/plans` in the repo. The first time, krew asks whether to ignore them.

The plan can be a task with any level of initial detail. Krew will help build enough context for successful plan execution.

```text
/krew:plan add dark mode for #123
/krew:plan deployment of the static site under /web to an azure static website using bicep
```

Once the plan is ready to execute, use the orchestrator to implement the plan.

```text
/krew:orchestrate add-dark-mode
/krew:orchestrate deploy-static-site-to-azure
```

And when you're ready to ship the changes:

```text
/krew:pr
```

Krew is designed so you can understand it. If you want to know more, start with [plan](./skills/plan/SKILL.md), [orchestrate](./skills/orchestrate/SKILL.md), [pr](./skills/pr/SKILL.md).

## Utility commands

```text
/krew:update [auto: default ask]
/krew:uninstall
/krew:modify [change]
```

Make krew your own with `/krew:modify when ... do ...`. `/krew:update` keeps your mods when it brings in upstream changes.

## Local development

Install from a local checkout:

```bash
claude plugin marketplace add /path/to/krew
claude plugin install krew@krew
```

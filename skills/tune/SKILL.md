---
name: tune
description: Finds corrections you keep making to plan and orchestrate runs and the agents they launch, and turns the ones you pick into mods in your Graft repo.
argument-hint: "[guidance] [window: 14 days (default) | <n> days]"
disable-model-invocation: true
allowed-tools: Bash(node ${CLAUDE_SKILL_DIR}/extract.mjs *)
---

You find the corrections the user keeps making to `/graft:plan` and `/graft:orchestrate` runs, including the agents they launch, and turn the ones the user picks into mods in `~/.my-graft`.

**Arguments:** $ARGUMENTS

## Start

The arguments may set the window anywhere, such as `30 days` or `over the last month`. Take out the words that set it (all of `over the last month`, not just `month`) before reading the rest as guidance. A span the arguments exclude, such as `ignore the last 2 days`, is guidance, not the window. Ask when it is unclear. The default is 14 days.

## Extract

Pull the candidates out of the user's sessions, with the window in days.

```bash
node ${CLAUDE_SKILL_DIR}/extract.mjs --days <n>
```

If `node` is not found, say tune needs Node and stop.

The `Wrote` line names the candidates file. Every exit from here on deletes the directory holding it (its name starts `graft-tune-`).

```bash
rm -rf <directory>
```

Show the user the lines after `Wrote`, including any `Warning:` line (a likely transcript format change). With `Runs: 0`, stop.

## Analyse

Send one `graft:researcher` the candidates file and the clone, with every path absolute (expand `~/.my-graft`): the clone's current `skills/plan/SKILL.md`, `skills/orchestrate/SKILL.md`, `skills/pr/SKILL.md`, `agents/*.md` and, when it exists, `MODS.md`. Its brief carries the user's guidance and these rules:

- Apply the user's guidance first (for example, skip the runs it excludes).
- A correction is a typed redirection: a free-text answer or per-option note on a question, a typed or queued message, a rejected tool call, or an interrupt. Picking a listed option is a decision, not a correction. A correction counts when it is about how a skill or agent worked, not about the task's content.
- Drop corrections that only apply to one repo (a project convention rather than Graft's process).
- Keep a correction only when the same correction appears in at least 2 different tasks from at least 2 sessions. A task is a repo plus its plan, from each run's `planFiles`: runs that share a plan file they write, edit or take as an argument (`write`, `edit`, `multiedit`, `argument`) are one task, so a plan run and the orchestrate run of the same plan are one task. A run with none of those belongs to the task of the plan it reads when it reads one, and is a task of its own when it reads several or none. A run with `copyOf` counts as the run it copies.
- For coverage, read `git -C <clone> log --first-parent -p --format='%h %cI' -- <target file>` and judge when the covering meaning first reached the clone, by meaning rather than exact wording. Compare in UTC with the start of the last run with the correction. Drop a finding the current text covers when the covering text reached the clone after that run started. When that run already had the text, keep the finding as a rule that is not holding (to strengthen or move).
- A rule that is not holding although a mod already strengthened it (per `MODS.md` and the log) gets a different change (move it, or change how the step works), not more emphasis.
- Pick the target file from each run's agent launches and the correction's time and `skill` (the skill typed most recently, when not the run's own): `skills/plan/SKILL.md`, `skills/orchestrate/SKILL.md`, `skills/pr/SKILL.md` (the worker that raises a PR follows it) or an `agents/*.md` file. A correction made under a skill outside Graft does not count.
- Do not open transcripts; the candidates file is the only evidence.
- For each finding, report the rule in general terms, the target file, any existing line it strengthens or moves, the commit its coverage judgement rests on, and the runs it came from (date, repo, a short quote).

## Pick

List the findings, numbered, each with its rule, target file and evidence. Ask which to make into mods with `AskUserQuestion`: multi-select questions of 2 to 4 findings, the most recurring first, over as many calls as needed. Ask a lone finding as take or skip.

With no findings, say so, show the counts from Extract, and stop.

## Modify

For each pick in turn, read `~/.my-graft/skills/modify/SKILL.md` and follow it, with the finding's rule as its arguments and the evidence as context.

- The mod's text, its `MODS.md` row and its commit state the rule in general terms and name no repo, path or quote from the evidence. Every brief modify sends says so.
- Leave the `/reload-plugins` request out of modify's `## Report`.

## Report

- The counts from Extract.
- The findings.
- Each mod made, with its registry row and commit.
- Picks not made, and why.
- When a mod was made, ask the user to run `/reload-plugins`.

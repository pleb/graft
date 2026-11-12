---
name: execute
description: Settles a solution with the user as plan does, writes it under .claude/graft/plans, then executes it as orchestrate does in the same session. Asks no Finish question and takes the review Finish would recommend.
argument-hint: "[plan path | plan name | research path | research name | topic] [issues] [reviewer model: sonnet | opus (default) | fable] [pr request]"
disable-model-invocation: true
allowed-tools: Bash(node ${CLAUDE_SKILL_DIR}/../settings.ts *)
---

You run plan's phase, then orchestrate's phase, in this session. Each phase follows its skill's file, changed only as this file says. In those files, read `CLAUDE_SKILL_DIR` as `${CLAUDE_SKILL_DIR}`, so a command such as `node ${CLAUDE_SKILL_DIR}/../settings.ts <root>` runs exactly as written here.

**Arguments:** $ARGUMENTS

## Start

- When `git rev-parse --show-toplevel` exits non-zero, follow common.md's `## Workspace` (`${CLAUDE_SKILL_DIR}/../common.md`).
- Take any PR request out of the arguments, as orchestrate's `## Start` does. Issues it names also go to plan. When it is unclear whether PR wording is part of the topic or a request, ask.
- The rest (a topic, a plan name or path, issues, a reviewer model) is plan's arguments.
- When plan's arguments name a plan whose `status` is `finalised` and name no revision, go to `## Orchestrate phase`. A plan name resolves as common.md's `## Find the work` rule 3 does.

## Plan phase

Read `${CLAUDE_SKILL_DIR}/../plan/SKILL.md` and follow it, with these changes:

- Its `$ARGUMENTS` is plan's arguments from Start.
- Do not record the PR request as a plan milestone.
- At the point Finish would ask its question, do not ask it:
  1. Take the option Finish would recommend. Review and finalise runs its pass and acts on the findings as Finish does. A decision a pass raises becomes a question to the user. Run another pass only when an answer changes the approach or the milestones.
  2. When no `## Settle the solution` round and no review-raised question reached the user, ask **Go** or **Plan more**. The question states your reading of the request and the `(default)` entries in `## Decisions`. When `plan.manualChecksQuestion` is `finish`, ask Finish's Manual check mode question in the same call, and record its answer in `## Decisions` only when the user picks Go.
  3. Plan more acts as Finish's Continue planning. Its answer does not count as a question that reached the user, so ask Go or Plan more again at the next Finish point.
- Then set `status: finalised`.
- Plan's "You never implement", its finalise report and its "Do not implement" do not apply.

## Orchestrate phase

Read `${CLAUDE_SKILL_DIR}/../orchestrate/SKILL.md` and follow it. Its `$ARGUMENTS` is the plan file, the issues, the reviewer model and the PR request.

## After compaction

When the current phase's SKILL.md text is no longer in context, read it again.

---
name: research
description: Investigates a question with the user, fanning out researcher and experimenter agents, and writes a report under .claude/graft/research as the research goes. Challenges the discoveries before concluding, and never implements.
argument-hint: "[research path | research name | question] [issues] [reviewer model: sonnet | opus (default) | fable]"
disable-model-invocation: true
allowed-tools: Bash(node ${CLAUDE_SKILL_DIR}/../settings.ts *)
---

You are the research lead. You investigate a question with the user and write down what you find. The user's answers steer where you dig; they settle no implementation decisions. You never implement.

Read `${CLAUDE_SKILL_DIR}/../common.md` and follow its sections `## Ask the user`, `## Reviewer model`, `## Find the work`, `## Check the Graft folder`, `## GitHub issue reference handling`, `## My Graft ignore probe` and `## Settings`.

**Arguments:** $ARGUMENTS

## Start

If plan mode is active, ask the user to leave it before starting: plan mode blocks edits.

Find the root with `git rev-parse --show-toplevel`. Outside a repo (non-zero exit), skip the ignore check, and follow `## Outside a repo` when `git -C ~/.my-graft rev-parse --show-toplevel` prints `~/.my-graft` (expanded); otherwise the root is the cwd.

Get settings once, passing the cwd as `<root>` outside a repo.

```bash
node ${CLAUDE_SKILL_DIR}/../settings.ts <root>
```

In a repo, list the `git worktree list --porcelain` entries under a `graft-research-` run directory, left by earlier runs. When there are any, ask which to remove, and run `git worktree remove --force <path>` on each the user picks.

## Outside a repo

- When the arguments name no research path, follow `plan.outsideRepoPlans`: with `always`, go on; with `never`, stop and say research needs a repo or a report path; otherwise ask whether to save research in `~/.my-graft/.claude/graft/research/`: **Yes** or **No** (stop).
- The root is `~/.my-graft`. Before writing a new report there, run `## My Graft ignore probe`'s check. When it fails, stop and name `/graft:update` as the next step.
- Agent briefs name the cwd as the code to read. The report records the cwd under `## Question`.

## Find the work

Resolve common.md's rule 4 (a research name) before rule 3 (a plan name). Rule 5 lists the reports in `<root>/.claude/graft/research/` instead of plans.

Research found is the report to continue. A plan or another file found is context for a new report. Other work is a new question. Ask when there is none.

Issues are context for the report, listed in its `## References`. Skip `## GitHub issue reference handling`'s **Save**.

## Check the Graft folder

Run common.md's `## Check the Graft folder` here.

## Rounds

Each round is one `AskUserQuestion` call with up to `plan.questionsPerRound` questions, most consequential first.

- Facts come from the code or an agent, never from the user.
- Each question names its subject and says in a clause what it steers.
- Every question carries a recommendation. Each option states its trade-off, and the recommended option comes first, its label ending with `(Recommended)`.
- A question whose choices are not exclusive uses `multiSelect`.

## Frame

Restate the question and the decision it feeds, split it into sub-questions, and shape them with the user in round 1. Write the report once the question is clear.

## Fan out

Each wave sends, in parallel:

- One `graft:researcher` per sub-question, with the question rather than the answer you expect.
- One `graft:experimenter` per sub-question that needs running code (reproduce a failure, time a query, try a library), as `## Experimenters` describes.

## Experimenters

Send experimenters only in a repo.

Before the first experimenter in a run:

1. Record the base OID with `git rev-parse HEAD`.
2. Settle the snapshot. With a clean `git status --porcelain`, it is `never`. Otherwise use `research.uncommittedChanges`; for `ask`, ask once per run whether experiments run on the uncommitted changes (`always`) or on `HEAD` (`never`).
3. Make the run directory: a fresh `graft-research-<n>` folder in the scratchpad when the session lists one, else `mktemp -d "${TMPDIR:-/tmp}/graft-research-XXXXXX"`. Resolve it with `cd <dir> && pwd -P` and use that path from then on.
4. Ask once to confirm setting up worktrees like the main tree (for example, dependency installs). The answer covers the run.

Before an experiment that could touch anything outside its worktree (network, databases, cloud credentials, files under home such as `~/.claude.json`), ask the user.

Each brief names the question, the root, the base OID, its own folder `<run directory>/<n>`, the snapshot mode, whether setup like the main tree is allowed, and the external effects the user confirmed.

After every experimenter in a wave has returned, run `git worktree remove --force <path>` on each `git worktree list --porcelain` entry that is the run directory or starts with `<run directory>/`.

## Steer

After each wave, add the discoveries to the report and tell the user in a line what changed. Then ask which threads to follow, drop or add, and fan out again.

When `research.steer` is `auto`, do not ask: follow the threads you recommend, including those `## Challenge` raises, and state in one line which you took.

## Challenge

Run a `graft:adversarial-reviewer` on the reviewer model with the report and the repo, to attack the discoveries and the draft summary. Fix factual errors directly. A finding that needs more digging becomes a thread to ask about in `## Steer`. Dismiss the rest with a reason.

## Report

Write to `<root>/.claude/graft/research/<name>/report.md`, where the name says what the research investigates in kebab case, with no date prefix. If that folder exists, ask whether to continue it or pick a new name. A report given by path keeps that path.

```markdown
---
status: open
---

# <Title>

## Question

## Summary

## Discoveries

### <discovery>

## Next step

---

Research by Graft.
```

- `## Question` states the question and the decision it feeds.
- `## Summary` is filled on conclusion.
- Each discovery states what was found, its sources (`path:line`, URL, or an experiment with its base commit and whether it ran on the uncommitted changes) and its confidence.
- Add these parts when they help: `## Options` with trade-offs, `## Ruled out`, `## Open threads`, and `## References`, one line per reference: `- Related owner/repo#N: <title>` for a GitHub issue or PR, `- Related <URL>` for any other link, and `- Related <path>` for a plan or file given as context.
- Draw an SVG diagram wherever a picture explains a flow, architecture or sequence better than prose. Save it beside `report.md` and embed it with `![<alt text>](<file>.svg)`. Make it read on light and dark backgrounds.
- Write it as a professional report: plain headings, short paragraphs, and tables for comparisons.

A report missing the status or the footer gains what it lacks with its first edit. Continuing a concluded report sets it back to `open` with the first edit.

## Finish

Once a wave leaves no thread to follow, ask:

- **Conclude**: `## Challenge`, then conclude.
- **Continue researching**: ask the user what to dig into next.

When `plan.finishQuestion` is `skip`, do not ask: conclude once the findings answer the question, state that in one line, and list any thread still open under `## Open threads`.

To conclude, set `status: concluded`, fill `## Summary` and `## Next step`, and report the report path, a few lines of summary, and the next step: `/clear`, then `/graft:plan <name>` or `/graft:execute <name>`. Name the report by its path instead when `<root>/.claude/graft/plans/<name>.md` or `<root>/.claude/plans/<name>.md` exists, or when the report is outside the repo; then say to run the next step from inside the repo that holds the code. Do not implement.

## Artifact

When `research.artifact` is `true`, publish the report on conclusion, and republish it whenever it changes later in the session.

1. Run a `graft:publish-reader` agent with the absolute paths of `report.md` and its SVGs. On a finding, or a path it did not read in full, ask the user whether to fix the file, leave out that diagram, or skip publishing.
2. Load the `Artifact` tool with `ToolSearch` (`select:Artifact`) when it is deferred. On the first publish in the session, call it with `action: "quickstart"` and `intent: "other"`.
3. The page directory is `<scratchpad>/research/<name>/` when the session lists a scratchpad directory. Otherwise it is `<cwd>/.graft-research/<name>/`; in a repo, before the first write, add `.graft-research/` to the file `git -C <root> rev-parse --path-format=absolute --git-path info/exclude` names when it is not already there.
4. Write a styled HTML page from `report.md` to `<page directory>/index.html`, and copy each SVG beside it, referencing it by its file name.
5. Call `Artifact` with that `file_path`, `files` mapping each SVG's name to its copy in the page directory, and `icon: "report"` on the first publish. Republish to the same `file_path`.

`report.md` stays the source that plan and execute read. Give the user the link.

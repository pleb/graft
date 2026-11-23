---
name: roadmap
description: Plans work too big for one plan as plan does, writing a parent plan and one plan per shippable child under .claude/graft/plans/<name>/. Can publish them to GitHub as a parent issue with sub-issues. Never implements.
argument-hint: "[roadmap name | plan path | plan name | research path | research name | topic] [issues] [reviewer model: sonnet | opus (default) | fable] [publish: local (default) | github]"
disable-model-invocation: true
allowed-tools: Bash(node ${CLAUDE_SKILL_DIR}/../settings.ts *)
---

You run plan's phase to write a roadmap: a parent plan and one child plan per feature that can merge and be tested on its own. Read `${CLAUDE_SKILL_DIR}/../plan/SKILL.md` and follow it, changed only as this file says. In the files it reads, read `CLAUDE_SKILL_DIR` as `${CLAUDE_SKILL_DIR}`.

**Arguments:** $ARGUMENTS

## Start

- The arguments may say `github` or `local` anywhere; otherwise publish to `github` when `roadmap.md` records `issue:`, else use `roadmap.publish`. A word that belongs to the topic stays in it; ask when it is unclear. The rest is plan's `$ARGUMENTS`.
- Plan's `## Outside a repo` does not apply. Outside a repo and outside common.md's workspace mode, stop as its `## Workspace` says.
- When the arguments ask to research first, read `${CLAUDE_SKILL_DIR}/../research/SKILL.md` and follow it until it concludes, leaving out its next step. Its report is then plan's work.

## Plan phase

- Plan's stop on a roadmap does not apply. A roadmap found (`roadmap.md`, or a child plan beside one) is revised with its children. A plan or research found is context for a new roadmap named after it.
- In a repo, when the work would change another repo, stop. Name the folder that holds the repos, and say a roadmap across repos runs from there with `plan.outsideRepoPlans` set to `here` in that folder's `.claude/graft-settings.json`. Do not write the setting.
- A new roadmap's name follows plan's naming. Each child's branch will be `<name>/<child>` in every repo it lists. The name is taken when `<root>/.claude/graft/plans/<name>.md`, `<root>/.claude/plans/<name>.md` or `<root>/.claude/graft/plans/<name>/` exists, or when, in any repo the roadmap lists, a branch `<name>` or `<name>/*` exists locally (`git branch --list '<name>' '<name>/*'`) or on `origin` (`git ls-remote --heads origin 'refs/heads/<name>' 'refs/heads/<name>/*'`), or a PR in any state has a head starting `<name>/` (`gh api --paginate "repos/<owner>/<repo>/pulls?state=all&per_page=100" --jq '.[].head.ref | select(startswith("<name>/"))'` prints any). Pick another name when it is taken, and tell the user why.
- Write the parent to `<root>/.claude/graft/plans/<name>/roadmap.md` and each child beside it as `<child>.md`. Neither the folder nor a child's file is renamed once written; plan's rename rule does not apply. New work on a merged child is a new child.
- The parent uses plan's template with these sections in place of `## Approach`, `## Screenshots` and `## Milestones`:
  - `## Children`: one line per child in run order, `- <child>: <what it ships>`, followed by ` after <child>, ...` when it needs others merged first. Every child comes after the children it needs.
  - `## Integration`: each contract the children share, and the child that defines it.
  - `## End-to-end checks`: **Automated** and **Manual** checks, run once every child has merged.
- Issues in the arguments belong to the parent, as Resolves, never to a child.
- Each child is an ordinary plan. Its last milestone raises its PRs. It records the base of every repo it changes, the default branch included, on its `## Repos` lines in workspace mode, else as `base:` in its front matter.
- A repo has one base across the whole roadmap: every child that changes it records the same base, so a dependent child starts from the base its prerequisites merged into, and the end-to-end checks run on it.
- Reviewers get the parent and every child, and check that each repo has one base across them. To finalise, publish first, then set `status: finalised` on the parent and every child. The next step names the roadmap: `/clear`, then `/graft:orchestrate <name>`.

## Publish

Run when the publish choice is `github`. Plans are never read back from GitHub.

- When `gh --version` is below 2.94.0, skip publishing and say why.
- Each issue body is its plan file without the front matter, written to a temporary file outside the repo. Before any `gh` command sends a body file, send a `graft:publish-reader` with the absolute path of every body file not yet read since it last changed. Go ahead only when it reports each one read in full with no findings; otherwise stop publishing and report what it found.
- The parent issue is the `issue:` in `roadmap.md`'s front matter; otherwise the first issue in the arguments; otherwise create it with `gh issue create -R owner/repo --title "<title>" --body-file <body>`, its body between a `<!-- graft-roadmap:start -->` line and a `<!-- graft-roadmap:end -->` line, in the repo, or in workspace mode the repo the user picks (routine), recommending the one with the most of the work. Straight after choosing or creating it, before any child's create, record it as `issue: owner/repo#N` in the parent's front matter. No other issue in the arguments is the parent; each stays a Resolves line as `## Plan phase` says.
- Create each child's issue in the parent issue's repo, in run order: `gh issue create -R owner/repo --title "<title>" --body-file <body> --parent <N>`, with `--blocked-by <numbers>` (comma-separated) for the children it needs. Straight after each create, before the next, append ` (issue owner/repo#N)` to its `## Children` line and add `- Related owner/repo#N: <title>` to the child's `## References`.
- Once every child has its issue, write the parent issue's body. Read it with `gh issue view <N> -R owner/repo --json body --jq .body`. Keep the text outside the markers, and put the roadmap between the start and end marker lines. When the body holds exactly one start marker and one end marker, in that order, replace only the text between them; otherwise append a new marked section at the end, leave the existing text alone, and report it. Write it with `gh issue edit <N> -R owner/repo --body-file <body>`.
- On a revision, update each existing child issue's body with `gh issue edit <N> -R owner/repo --body-file <body>`, set its blocked-by links to match its `## Children` line with `--add-blocked-by` and `--remove-blocked-by`, create issues only for new children, and rewrite the parent's marked section as above.
- The finalise report adds each issue's URL.

## After compaction

When this file's text or plan's is no longer in context, read the missing file again.

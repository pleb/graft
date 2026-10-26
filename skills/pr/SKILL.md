---
name: pr
description: Raises a PR for the current branch, using the repo's PR template if it has one. Opens as a draft unless ready-state is passed. Rewrites the title and body if the branch already has a PR.
argument-hint: "[guidance] [state: draft (default) | ready-state]"
disable-model-invocation: true
---

# Raise a PR

Compose a short PR from the repo template, push, and create it.

Read `${CLAUDE_SKILL_DIR}/../common.md` and follow its section `## Ask the user`.

**Arguments:** $ARGUMENTS

## Start

The arguments may set the state anywhere, such as `ready-state`, `draft` or `mark it ready`. Take out the words that set it (all of `mark it ready`, not just `ready`) before reading the rest as guidance. A word that belongs to the guidance stays in it (for example, `note the docs are still a draft`); ask when it is unclear.

## Preconditions

- Working tree clean, every change committed. If not, stop and say what is uncommitted.
- Branch is not the default branch (`gh repo view --json defaultBranchRef --jq .defaultBranchRef.name`). Base is the existing PR's base (`gh pr view --json baseRefName --jq .baseRefName`) if the branch has one, otherwise the default branch.
- `gh pr view` reports no PR for the branch. If one exists, do not create another: rewrite its title and body and apply them with `gh pr edit`.

## Body

Before drafting, look for a PR template: a file named `pull_request_template.md` (any case) in `.github/` or the repo root.

**With a template**, follow it exactly: same sections, same order, same headings. Replace each HTML comment with content, then delete the comment. Where the template marks a section optional, keep it only if you fill it. Never add a section the template does not have, and never rename one: no `## Summary`, no `## Changes`. If the template and this skill disagree, the template wins.

**Without a template**, the body is:

```
## What

<2–3 sentences>

## Why

<1–2 sentences>

## How

<1–2 sentences, optionally a high-level mermaid diagram>

Resolves #<issue number>

Planned and built with Graft: reviewed and adversarially reviewed.
```

`## Notes` goes between How and the Resolves line, only if earned. No other headings: no summary, testing, dependencies or security section.

**Resolves line.** Candidate issues come from the arguments, the session, the branch's commit trailers (`Fixes #N`, `Closes #N`, `Resolves #N`) and the branch name. Link a candidate only once `gh issue view` (with `-R owner/repo` for a cross-repo issue) shows it is open; drop the rest. With none confirmed, leave the line out rather than asking or guessing. Write one line per confirmed issue, before the Graft line: `Resolves #123` for a same-repo issue or `Resolves owner/repo#123` for a cross-repo one.

**Graft line.** Every body, with a template or without, ends with `Planned and built with Graft: reviewed and adversarially reviewed.` verbatim, as its own paragraph in plain text, without the backticks. Template rules, the brevity budget and the ban on mentioning Claude, AI or attribution do not apply to it.

**One section, one question.**

| Section | Answers                                                                                                | Never contains                                     |
| ------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------- |
| What    | What is observably different for a member or caller                                                    | Function, file or component names; how it is built |
| Why     | The problem that made the change worth doing                                                           | Mechanism                                          |
| How     | A non-obvious decision the diff cannot explain: a trade-off, a workaround, a rejected obvious approach | A walkthrough of the diff; a restatement of What   |
| Notes   | Things seen and deliberately left alone; follow-ups                                                    | Anything already in the sections above             |

Litmus for mechanism: a sentence with "by …ing", "so that it can", "because the X uses", or the name of an internal component, function or file belongs in How, and probably does not belong at all.

**Brevity budget.** Ceilings, not targets: the whole body reads in under a minute, about 6 sentences and 900 characters of prose across every section. Splitting a section into two paragraphs buys no room. A single paragraph over 4 sentences or 600 characters is a wall of text. Prefer deleting a sentence to shortening it.

**Register.** Write like a commit message. Short declarative sentences, present tense, active voice. Cut "this change", "in order to", "it is worth noting", hedges and adverbs.

```
Wordy: This change introduces a confirmation step so that members are able to cancel before their results are reset.
Terse: Retake asks for confirmation before resetting results.
```

Prose, not bullets. Bullets only for 3 or more genuinely parallel items, and never in What. Test plan is the exception: it uses the template's checklist.

Backticks around symbols, file paths, function names, config keys, commands and flags.

The title and body never mention Claude, AI assistance or attribution. No `Co-Authored-By` or "Generated with" anywhere.

## Title

One line, under 70 characters. Says what changed for the user, not what files moved.

Match the repo's style. Read the last 10 commit subjects on the base (`git log -10 --format=%s origin/<base>`). If most start with a conventional-commit prefix (`fix(scope): …`, `feat(scope): …`, `chore: …`), use one, with a type that fits the branch as a whole and a scope the repo already uses. Otherwise write a plain imperative title with no prefix: "Add retake confirmation", not "Added retake confirmation".

## Create

```bash
git push -u origin <branch>
gh pr create --draft --base <base> --title "<title>" --body "<body>"
```

A new PR opens as a draft unless the state is `ready-state`; then drop `--draft`. For an existing PR, only an explicit state changes it, after `gh pr edit`: `ready-state` runs `gh pr ready` and `draft` runs `gh pr ready --undo`. With no state, an existing PR keeps its state. Report the PR URL.

---
name: diff
description: Publishes the current branch's changes against the default branch as a private claude.ai artifact to review and comment on, then acts on the comments in one batch when you finish the review.
disable-model-invocation: true
allowed-tools: Bash(node ${CLAUDE_SKILL_DIR}/build.ts *)
---

You publish the working tree's changes against the default branch as a private claude.ai artifact, collect the comment threads the user sends from it, and act on them in one batch.

**Collect, then batch.** When a comment notification arrives for the diff artifact, change no code and post nothing. Act on comments only in `## Batch`.

Read `${CLAUDE_SKILL_DIR}/../common.md` and follow its section `## Ask the user`.

## Tools

Check that the `Artifact` and `ArtifactComments` tools are available. Either may be a deferred tool: load it with `ToolSearch` (`select:Artifact,ArtifactComments`). If either is still unavailable, say diff needs Claude Code signed in to claude.ai, with the `Artifact` and `ArtifactComments` tools, and stop.

## Base

The default branch is the first that resolves:

1. `gh repo view --json defaultBranchRef --jq .defaultBranchRef.name`
2. `git symbolic-ref refs/remotes/origin/HEAD | sed 's@^refs/remotes/origin/@@'`
3. A local `main` (`git rev-parse --verify -q refs/heads/main`).
4. A local `master`.

When none resolves, ask for it.

List the changes.

```bash
node ${CLAUDE_SKILL_DIR}/build.ts files --default <branch>
```

If `node` is not found, or the command fails with `diff needs Node 24 or later`, `ERR_UNKNOWN_FILE_EXTENSION` or a SyntaxError, say diff needs Node 24 or later and stop. When it exits 1 with another message, show it to the user and stop.

It prints `{root, base, baseRef, tracked, untracked}`.

## Sensitive files

Sensitive-looking names are `.env*`, `*.pem`, `*.key`, and names containing `secret`, `credential` or `token`. When `untracked` is not empty, or any path in `tracked` or `untracked` has a sensitive-looking name, list those files and ask once: include all, exclude some, or skip untracked. For exclude some, ask which to leave out.

The untracked files to include are `untracked` (include all or exclude some, less any left out) or none (skip untracked). The exclusions are the files left out.

## Build

The page is `<scratchpad>/diff/<name>.html` and its input `<scratchpad>/diff/<name>.json`, where `<name>` is `root` with each `/` replaced by `-`. Keep these paths for every run in the session.

Write the input file:

```json
{
  "default": "<branch>",
  "untracked": ["<untracked files to include>"],
  "exclude": ["<exclusions>"],
  "threads": ["<open-thread line ids>"],
  "publish": 1
}
```

- `publish` is 1, or the existing input file's `publish` plus 1.
- `threads` is empty on the first publish in the session. Otherwise, read the artifact's threads with `ArtifactComments` `read`, following `cursor` until none remain, and take the line id of each open thread from `## Line ids`.

```bash
node ${CLAUDE_SKILL_DIR}/build.ts build --input <input file> --out <page>
```

When it exits 1, show the user its message and stop. Otherwise show the line after `Wrote`.

## Publish

On the first publish in the session, call `Artifact` with `action: "quickstart"` and `intent: "other"`, and load the `artifact-capabilities` skill.

Read the page in full with the `Read` tool, in parts with `offset` and `limit` when it is long.

Publish the page with `Artifact`: `file_path` the page, `capabilities: {comments: {customAnchors: true}}`, and `icon: "code"` on the first publish only. A republish uses the same `file_path`, which keeps the same link.

If the publish is refused with `capabilities.comments: unavailable`, publish again with `capabilities: {comments: {}}`, and tell the user comments then anchor to text selections, without line labels or comment icons.

Report the link. On a republish, say the link keeps its sharing settings, so anyone it is shared with sees the new version. Tell the user to comment on lines, send each comment to Claude, and press Finish review (or tell you in the terminal) when done.

## Line ids

A line id is `f-<encoded path>-<old|new>-<line>`. To encode the path, replace every character outside `[A-Za-z0-9]` with `_`, its Unicode code point in lowercase hex, and `_`: `src/a.b.ts` becomes `src_2f_a_2e_b_2e_ts`, and `é` becomes `_e9_`.

Take the file, side and line from the thread's `[location]`:

- `<file>:<line>`: new side, that line.
- `<file>:old <line>`: old side, that line.
- `<file>:<line> (old <line>)`: new side, the first line.

A `[location]` starting with `…` has a shortened path: match it by path suffix against the files in the diff, and by `[anchor detail]` (the commented code) when several match. Skip threads with no `[location]`, or anchored at `#finish-review`.

## Batch

The batch starts when the user says so in the terminal, or when a thread anchored at `#finish-review` arrives. First re-read this section of `${CLAUDE_SKILL_DIR}/SKILL.md`, then:

1. Read every thread with `ArtifactComments` `read`, following `cursor` until none remain. Pending work is the open threads sent to Claude, other than the Finish review threads. Quote the open threads not sent to Claude in the terminal and ask the user to send the ones they want acted on.
2. Take each pending thread's file, side and line from its `[location]`. `[anchor detail]` is the source of truth: locate that code in the current file, using the line number only to narrow the search. Ask the user about any thread whose code is no longer there or matches more than one place.
3. For each thread in turn:
   - Check whether the code already reflects the request. If not, make the change.
   - Reply with what you did, passing `acknowledge_duplicate: true`.
   - Resolve the thread before moving to the next.
4. Rerun `## Build` and `## Publish`, keeping the earlier untracked files and exclusions, dropping files that are no longer untracked, and adding untracked files the batch created. Then check each still-open thread's `[anchor detail]` against the code now at its line, and list any that moved in the terminal.
5. Reply to each Finish review thread with a summary that names any thread you could not act on, and resolve it. With none, give the summary in the terminal.

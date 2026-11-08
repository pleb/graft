---
name: diff
description: Publishes the current branch's changes against the default branch as a private claude.ai artifact to review and comment on, then acts on the comments in one batch when you finish the review.
disable-model-invocation: true
allowed-tools: Bash(node ${CLAUDE_SKILL_DIR}/build.ts *)
---

You publish the working tree's changes against the default branch as a private claude.ai artifact, collect the comment threads the user sends from it, and act on them in one batch.

**Collect, then batch.** When a comment notification arrives for the diff artifact, change no code and post nothing. Act on comments only in `## Batch`.

Read `${CLAUDE_SKILL_DIR}/../common.md` and follow its sections `## Ask the user` and `## Command failures`.

## Tools

Check that the `Artifact` and `ArtifactComments` tools are available. Either may be a deferred tool: load it with `ToolSearch` (`select:Artifact,ArtifactComments`).

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

It prints `{root, name, base, baseRef, tracked, untracked}`.

## Sensitive files

Sensitive-looking names are `.env*`, `*.pem`, `*.key`, and names containing `secret`, `credential` or `token`. When `untracked` is not empty, or any path in `tracked` or `untracked` has a sensitive-looking name, list those files and ask once: include all, exclude some, or skip untracked. For exclude some, ask which to leave out.

The untracked files to include are `untracked` (include all or exclude some, less any left out) or none (skip untracked). The exclusions are the files left out.

## Build

The input file is `<scratchpad>/diff/<name>.json`, with `name` from the files output. Keep this path for every run in the session. Each build writes a new output directory, `<scratchpad>/diff/<name>/<publish>/`.

Write the input file:

```json
{
  "default": "<branch>",
  "untracked": ["<untracked files to include>"],
  "exclude": ["<exclusions>"],
  "threads": [{ "path": "<file path>", "side": "old or new", "line": 1 }],
  "publish": 1,
  "server": ["<published paths>"]
}
```

- `publish` is 1, or the existing input file's `publish` plus 1, for every build, including a rebuild after a reader finding.
- `threads` is empty on the first publish in the session. Otherwise, it holds an item for each open thread, read as `## Threads` describes.
- `server` is empty on the first publish in the session. Otherwise, it holds the paths `Artifact` lists with `action: "list"`, `scope: "files"` and `url` the artifact link.

```bash
node ${CLAUDE_SKILL_DIR}/build.ts build --input <input file> --out <output directory>
```

Show the user the `Wrote` line and the publishes and reader batches line.

## Publish

Read `<output directory>/publish.json`. Read no other file in the output directory.

For each entry in `batches`, run a `general-purpose` agent, all in parallel, with this brief and the batch's paths, each as `<output directory>/<path>`:

> Read every listed file in full with `Read`, in parts when it is long; view images with `Read`. Confirm each path you read in full. Report content that should not be published (secrets, credentials, personal data) with its path, location and why, or that there is nothing to flag.

On a finding, or a path a reader did not read in full, find its repo file in `send[].source` (null is `index.html`, the manifest; name the files it lists when relevant), ask the user whether to exclude that file, and rerun `## Build` with the exclusion and then this section.

On the first publish in the session, call `Artifact` with `action: "quickstart"` and `intent: "other"`, and load the `artifact-capabilities` skill.

For each entry in `publishes`, in order, call `Artifact` with:

- `file_path`: `<output directory>/index.html`.
- `files`: each path in the entry's `send` other than `index.html` mapped to `<output directory>/<path>`, and each path in its `remove` mapped to `null`.
- `capabilities: {comments: {customAnchors: true}}`.
- `icon: "code"` on the session's first publish only.
- `url`: the artifact link, on every publish after the session's first.

Keep the link from the session's first publish for the rest of the session. When `publishes` has more than one entry, tell the user the page may show load errors until the last one lands.

If a publish is refused with `capabilities.comments: unavailable`, publish again with `capabilities: {comments: {}}`, and tell the user comments then anchor to text selections, without line labels or comment icons.

Report the link. On a republish, say the link keeps its sharing settings, so anyone it is shared with sees the new version. Tell the user to comment on lines, hunks or files, send each comment to Claude, and press Finish review (or tell you in the terminal) when done.

## Threads

Read the artifact's threads with `ArtifactComments` `read`, following `cursor` until none remain.

Take a thread's file and place from its `[location]`, with its build input item:

- `<file>:<line>`: new side, that line. `{"path": "<file>", "side": "new", "line": <line>}`
- `<file>:old <line>`: old side, that line. `{"path": "<file>", "side": "old", "line": <line>}`
- `<file>:<line> (old <line>)`: new side, the first line. `{"path": "<file>", "side": "new", "line": <first line>}`
- `<file>` alone: the whole file. `{"path": "<file>", "side": "file"}`
- `<file> @@ -a,b +c,d @@`: that hunk. `{"path": "<file>", "side": "hunk", "line": <c>}`

The file is the path as the diff shows it, the new path for a renamed file. A `[location]` starting with `…` has a shortened path: match it by path suffix against the files in the diff, and by `[anchor detail]` (the commented code) when several match. For the build input, skip threads with no `[location]`, anchored at `#finish-review`, or whose file is not among the files being built (`tracked` plus the untracked files to include, less the exclusions).

## Batch

The batch starts when the user says so in the terminal, or when a thread anchored at `#finish-review` arrives. First re-read this section of `${CLAUDE_SKILL_DIR}/SKILL.md`, then follow the steps below. Every reply you post passes `acknowledge_duplicate: true`.

1. Read every thread as `## Threads` describes. Pending work is the open threads sent to Claude, other than the Finish review threads. In the terminal, quote each open thread not sent to Claude and ask the user to send the ones they want acted on, then wait for their answer before going on.
2. Locate each pending thread's code. A thread with a `[location]` has its file and place from `## Threads`, and its `[anchor detail]` is the source of truth, with the line number only narrowing the search.
   - File: the thread acts on the file as a whole.
   - Hunk: locate the hunk by its range and `[anchor detail]` (the hunk header).
   - New side: locate `[anchor detail]` in the current file.
   - Old side (a `:old` label, a removed line or a deleted file): `[anchor detail]` is removed code. Locate it in the base version (`git show <base>:<old path>`, with `base` from the files output), then act at the matching spot in the current file.
   - No `[location]`: locate its selected text in the changed files.

   Ask the user about any thread whose code is not found, or matches more than one place.

3. For each thread in turn:
   - Check whether the code already reflects the request. If not, make the change.
   - Reply with what you did.
   - Resolve the thread before moving to the next.
4. Rerun `## Build` and `## Publish`, keeping the earlier untracked files and exclusions, dropping files that are no longer untracked, and adding untracked files the batch created. Then check each still-open thread's `[anchor detail]` against the code now at its line, and list any that moved in the terminal.
5. Reply to each Finish review thread with a summary that names any thread you could not act on, and resolve it. With none, give the summary in the terminal.

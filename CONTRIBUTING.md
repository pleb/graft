# Contributing

## Testing

Test changes to skills and agents in a tester: a background Claude Code session named `graft-tester-<id>` that loads this checkout and sends its questions to your session.

Your session must run in `auto` permission mode. To opt into auto mode, run `claude --permission-mode auto` interactively once.

The tester also runs in auto mode. It blocks actions it judges destructive, such as deleting a plan file, because your answers are not user consent.

### Run a test

1. Stop any tester left from an earlier test: `npm run stop-graft-tester`.
2. Choose a scratch directory: a fresh git repo, or a plain directory to test outside a repo. It cannot be your home directory, an ancestor of it, or a drive or share root. The tester trusts it, or its repo, in `~/.claude.json`.
3. Note whether `~/.my-graft/graft-settings.json` exists, and its content.
4. Find your session name. It is the `name` of the entry in `claude agents --json` whose `sessionId` is `$CLAUDE_CODE_SESSION_ID`. If that entry has no name, set one with `/rename`.
5. Start the tester: `npm run start-graft-tester -- <dir> <your session name> "<slash command>"`, where `<dir>` is the scratch directory.
6. Start a `Monitor` that prints the tester's `state` from `claude agents --json` every 5 minutes.
7. Answer its questions with `SendMessage` to the tester name on step 5's `backgrounded` line until the test is done.
8. When a poll shows `done` or `blocked` and no question has arrived, read the last assistant message in the tester's transcript and act on it. The transcript is `~/.claude/projects/<encoded dir>/<session id>.jsonl`, where `<encoded dir>` is the scratch directory's absolute path with each `/` and `.` replaced by `-`, and `<session id>` is the `sessionId` of the tester's entry in `claude agents --json`.
9. If your session's name changes, such as when it moves to the background, send the new name to the tester.
10. Stop the tester: `npm run stop-graft-tester`.
11. Restore the settings file to what you noted in step 3, or delete it if it did not exist.

## Windows

Before `npm ci`, stop any editor's oxfmt language server, or close the editor. The server locks `node_modules/@oxfmt/binding-win32-x64-msvc/*.node`, and `npm ci` then empties `node_modules` and fails with `EPERM`.

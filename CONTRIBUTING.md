# Contributing

## Testing

Test changes to skills and agents in a tester: a background Claude Code session named `graft-tester-<id>` that loads this checkout and sends its questions to your session.

Your session must run in `auto` permission mode. To opt into auto mode, run `claude --permission-mode auto` interactively once.

The tester also runs in auto mode. It blocks actions it judges destructive, such as deleting a plan file, because your answers are not user consent.

### Run a test

1. Stop any tester left from an earlier test: `npm run stop-graft-tester`.
2. Choose a scratch directory: a fresh git repo, or a plain directory to test outside a repo. The tester trusts it, or its repo, in `~/.claude.json`, and refuses the home directory, drive and share roots, and ancestors of home.
3. Note whether `~/.my-graft/graft-settings.json` exists, and its content.
4. Find your session name. It is the `name` of the entry in `claude agents --json` whose `sessionId` is `$CLAUDE_CODE_SESSION_ID`. If that entry has no name, set one with `/rename`.
5. Start the tester: `npm run start-graft-tester -- <dir> <your session name> "<slash command>"`, where `<dir>` is the scratch directory.
6. Answer its questions with `SendMessage` to the name in start's `backgrounded` line until the test is done.
7. Stop the tester: `npm run stop-graft-tester`.
8. Restore the settings file to what you noted in step 3, or delete it if it did not exist.

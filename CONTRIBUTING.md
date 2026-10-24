# Contributing

## Testing

Test changes to skills and agents in `graft-tester`, a background Claude Code session that loads this checkout and sends its questions to your session.

Your session must run in `auto` permission mode. To opt into auto mode, run `claude --permission-mode auto` interactively once. The tester's auto mode blocks actions it judges destructive, such as deleting a plan file, since your answers are not user consent.

1. Run `npm run stop-graft-tester` to stop any `graft-tester` left from an earlier test.
2. Note whether `~/.my-graft/graft-settings.json` exists, and its content.
3. Find your session name: it is the `name` of the entry in `claude agents --json` whose `sessionId` is `$CLAUDE_CODE_SESSION_ID`. If it has none, set one with `/rename`.
4. Run `npm run start-graft-tester -- <dir> <your session name> "<slash command>"`, where `<dir>` is a scratch directory: a fresh git repo, or a plain directory to test outside a repo. Before using a fresh repo, run `claude` in it interactively once and accept the trust prompt.
5. Answer the questions it sends you with `SendMessage` until the test is done.
6. Run `npm run stop-graft-tester`.
7. Restore the settings file to what you noted in step 2 (delete it if it did not exist), then commit and push the change to `~/.my-graft`.

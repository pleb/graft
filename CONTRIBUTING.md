# Contributing

## Testing

Test skill changes in a `graft-tester` session that loads this checkout. Run your own session in `auto` permission mode, and opt into auto mode once by running `claude --permission-mode auto` interactively.

1. Run `npm run stop-graft-tester` to stop any `graft-tester` left from an earlier test.
2. Note whether `~/.my-graft/graft-settings.json` exists, and its content.
3. Find your session name: it is the `name` of the entry in `claude agents --json` whose `sessionId` is `$CLAUDE_CODE_SESSION_ID`. Set one with `/rename` if it has none.
4. Run `npm run start-graft-tester -- <dir> <your session name> "<slash command>"`, where `<dir>` is a scratch directory (a fresh git repo, or a plain directory to test outside a repo).
5. Answer the questions it sends you with `SendMessage` until the test is done.
6. Run `npm run stop-graft-tester`.
7. Put the settings file back as it was (delete it if it did not exist), then commit and push the change to `~/.my-graft`.

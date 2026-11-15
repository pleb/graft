# Agent instructions

In skills and agents, state each instruction once per file, without its reason unless the reason changes what the model does.

`docs/assets/flow.svg` draws `skills/research`, `skills/plan`, `skills/orchestrate`, `skills/execute`, `skills/yolo`, `skills/pr`, `skills/diff` and their agents. `docs/assets/update.svg` draws `agent-install.md`, `skills/update`, `skills/modify` and `skills/tune`.

When a change or merge alters what a graphic shows, update the graphic, its `<desc>` and its alt text in `README.md` in the same change. Show names and roles only, not conditions.

Match the existing style and palette, keep the 830px width (grow taller, not wider), keep text at least 14px and inside its box, and check that it reads on light and dark backgrounds. Keep preview files and screenshots outside the repo.

The `README.md` explains how graft works and what it does.

When the README's simulator link changes, update `interstock.md` step 3 to match.

Name Vitest tests `*.spec.ts`. `*.test.ts` and `*.test.tsx` are for `claude plugin test`, which runs every such file under the repo.

When this clone's `origin` is `pleb/graft` (`git remote get-url origin`), test changes to skills and agents as `CONTRIBUTING.md` describes.

When this clone's `origin` is `pleb/graft` and a change alters what a scenario in `site/sim/scenarios/` shows, update the scenario in the same change and make `npm run test:site` pass.

When merging, carry across settings and commands a clone added to the README. A setting from the README's settings table goes in `docs/settings.md` under the `##` section for its command, as a ``### `skill.name` `` heading followed by a summary paragraph, then one single-line bullet per value: ``- `value` (default): what it does.`` for exactly one value and ``- `value`: what it does.`` for the rest. If the setting only applies when another is set, the summary's last sentence is ``Applies only when `other.key` is `value`.`` in that wording. A free-text setting has the single bullet ``- Any text (default: `<value>`)``. A command from the README's command list goes in `docs/commands.md` as a `## /graft:name` section, with a link to it in the list at the top.

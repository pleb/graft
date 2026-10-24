# Agent instructions

In skills and agents, state each instruction once per file, without its reason unless the reason changes what the model does.

`docs/flow.svg` draws `skills/plan`, `skills/orchestrate`, `skills/pr` and their agents. `docs/update.svg` draws `agent-install.md`, `skills/update`, `skills/modify` and `skills/tune`.

When a change or merge alters what a graphic shows, update the graphic, its `<desc>` and its alt text in `README.md` in the same change. Show names and roles only, not conditions.

Match the existing style and palette, keep the 830px width (grow taller, not wider), keep text at least 14px and inside its box, and check that it reads on light and dark backgrounds. Keep preview files and screenshots outside the repo.

The `README.md` explains how graft works and what it does.

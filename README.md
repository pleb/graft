# Krew

An opinionated Claude Code software engineer plugin, built around a dev flow: plan → implement → ship.

Krew currently covers the implement step. Plan and ship are not included yet.

## Installing

1. Start Claude Code: `claude`
2. Add the marketplace:

   ```text
   /plugin marketplace add pleb/krew
   ```

3. Install the plugin, then choose a scope in the panel that opens:

   ```text
   /plugin install krew@krew
   ```

4. Restart Claude Code to load the plugin.

## Contents

| Component | Name                  | What it does                                                                                                                                                                     |
| --------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Skill     | `/krew:orchestrate`   | Executes a plan or task list as the coordinator. Workers implement, reviewers check milestones, and comment-editor and docs-editor clean up at the end.                          |
| Agent     | `krew:worker`         | Implements a bounded, already-decided coding task end to end, then reports what changed and how it was verified.                                                                 |
| Agent     | `krew:reviewer`       | Independent review of code changes for correctness, security, and contract breakage, with every finding backed by a concrete failure path.                                       |
| Agent     | `krew:docs-editor`    | Edits documentation changes down to what readers need. Removes content that does not need documenting, and rewrites the rest as plain statements of what each thing is and does. |
| Agent     | `krew:comment-editor` | Removes and rewrites code comments in a change so only comments that state what the code cannot remain. Edits comments only, never code.                                         |

## Local development

To install the plugin from a local checkout, add the checkout as a marketplace, then install the plugin:

```bash
claude plugin marketplace add /path/to/krew
claude plugin install krew@krew
```

# Graft

Graft is a Claude Code plugin that takes a task from idea to pull request. It plans the work with you, splits the plan into milestones (steps small enough to build and check one at a time) and commits each one as it's built.

[Watch it run in the simulator](https://pleb.github.io/graft/).

> [!TIP]
> Quick reference: [commands](./docs/commands.md) and [settings](./docs/settings.md).

## Why Graft

Your changes to Graft, which it calls mods, survive its updates. Install gives you a private GitHub repo holding your own copy, and an update merges into it by what each mod is meant to do. `/graft:tune` learns from the corrections you keep making and offers to turn them into mods. [Make it yours](#make-it-yours) covers how.

Before an orchestrate run ends, a reviewer has checked its milestone commits for bugs and an adversarial reviewer has looked for reasons they should not ship. Each is told to report a finding only when it can show how the change would go wrong.

Plans are Markdown files in `.claude/graft/plans`. You can read and edit one before anything is built.

Graft runs only in Claude Code. By default it asks a lot of questions and runs several agents per task, which costs more tokens than a plain session. `/graft:yolo` makes the calls itself, and [Fewer questions](#fewer-questions) lists settings that cut them one at a time.

## Install

You need git, Node 24 or later, and the [GitHub CLI](https://cli.github.com/) signed in with `gh auth login`. Then paste this into Claude Code:

```text
Claude, install Graft https://raw.githubusercontent.com/pleb/graft/main/agent-install.md
```

Install creates a private repo, `<your-github-login>/my-graft`, or reuses it if you already have one. It clones that repo to `~/.my-graft` and installs Graft from the clone, your local copy that Claude Code loads. If `~/.my-graft` is already there, install keeps it and asks you to run `/graft:update`.

On another machine, or after `/graft:uninstall`, run the same line. It clones your repo, so the mods you have pushed come with it.

## Using it

![Graft's flow: /graft:research, /graft:plan and /graft:execute are where you begin. /graft:research works with you, a researcher, an experimenter and an adversarial reviewer to write a research report, which /graft:plan takes as context. /graft:plan works with you, a researcher and two reviewers to write a plan file. /graft:orchestrate has a worker implement each milestone and commits it, with two reviewers alongside, then comment-editor and docs-editor clean up, leaving commits on a branch. /graft:execute runs plan and then orchestrate in one session with you deciding. /graft:yolo runs the same with the agent deciding, ending in a ready PR with screenshots. /graft:diff publishes a claude.ai artifact for you to review the changes and comment on, then Claude acts on your feedback. /graft:pr pushes the branch and opens a PR.](./docs/assets/flow.svg)

Start from what you know:

| Run               | When                                                     | You end up with                 |
| ----------------- | -------------------------------------------------------- | ------------------------------- |
| `/graft:research` | You need facts before deciding                           | A report to plan from           |
| `/graft:plan`     | You know what you want built                             | A plan file                     |
| `/graft:execute`  | The job is small enough to plan and build in one session | Commits on a branch             |
| `/graft:yolo`     | You want Graft to decide for you                         | A pull request ready for review |

A plan on its own builds nothing. Run `/clear` so the build starts with an empty context, then `/graft:orchestrate` with the plan's name:

```text
/graft:plan deploy the static site in /web to Azure with Bicep
/clear
/graft:orchestrate deploy-static-site-to-azure
```

Orchestrate works on a branch. A worker agent builds each milestone and Graft commits it, and both reviewers check its milestone commits before the run ends.

Once the branch is done, `/graft:diff` publishes its changes as a private claude.ai artifact you can comment on line by line, and Claude acts on your comments. `/graft:pr` pushes the branch and opens the pull request, or rewrites the title and body of the one it already has. `/graft:review` runs the two reviewers over a PR, or over your branch and its uncommitted changes, and can post the findings you pick to the PR.

Every command and its arguments are in [docs/commands.md](./docs/commands.md).

## Make it yours

Describe a mod in plain words, such as `/graft:modify when a plan touches a database, add a rollback milestone`. Graft agrees the change with you, makes it, has both reviewers check it, and pushes it to your `my-graft` repo. Each mod and its intent go in `MODS.md`.

`/graft:tune` finds mods for you. It reads your recent plan, orchestrate, execute and yolo runs (the last two weeks by default) for corrections you keep repeating. A correction only counts when you made it in at least two tasks across at least two sessions, and you pick which findings to keep.

`/graft:update` merges new Graft into your clone from its upstream, the repo it takes updates from: `pleb/graft`, or your organisation's [interstock](#interstocks) (a shared copy of Graft). When a conflict touches a mod, Graft resolves it so the mod still does what you recorded, and asks when it can't. `/graft:modify` and `/graft:update` need Claude Code 2.1.273 or later.

At the start of a session, Graft tells you when your clone is behind its upstream and suggests `/graft:update`. The check only reads from upstream; it never fetches into or changes your clone. [Update notices](./docs/settings.md#updatenotify) covers how often it looks and how to quiet it.

`/graft:uninstall` removes the plugin and deletes `~/.my-graft`, but first shows you what is uncommitted there and asks. Your `my-graft` repo on GitHub stays.

![How your copy of Graft stays current, in two lanes. Where Graft lives: /graft:update merges the latest Graft from pleb/graft, the upstream, into your clone at ~/.my-graft, keeping your mods. The clone pushes to your private repo <login>/my-graft, and your other machines pull from it. Using and changing it: Claude Code loads Graft from the clone, and /reload-plugins picks up changes. In Claude Code, Graft tells you to run /graft:update when it is due. You run /graft:modify and /graft:tune. /graft:modify commits a mod to the clone, recorded in MODS.md. /graft:tune finds corrections you keep making and turns the ones you pick into mods through /graft:modify.](./docs/assets/update.svg)

## Working across repos

Research, plan, execute, orchestrate and yolo can also run from a folder of repos. Turn it on in the folder's `.claude/graft-settings.json`:

```json
{ "plan": { "outsideRepoPlans": "here" } }
```

When the work needs a repo that isn't in the folder yet, Graft adds it with the command the folder's `CLAUDE.md` (or a parent's) gives, and asks if there isn't one. A brand new repo needs a command that creates it with at least one commit and an `origin` to push to.

The plan's `## Repos` section lists each repo the work changes. Ask orchestrate for a PR and it raises one per changed repo, linked to each other.

## Interstocks

An interstock (in horticulture, the middle piece of a double graft) is an organisation's shared copy of Graft. It sits between `pleb/graft` and its users and takes the place of `pleb/graft` as their upstream. To create one:

```text
Claude, install Graft https://raw.githubusercontent.com/pleb/graft/main/interstock.md
```

Colleagues then install with the command in the interstock repo's README.

A caretaker keeps the interstock current by running `/graft:update` and `/graft:modify` in a clone of its repo. There, and in a clone of `pleb/graft`, both commands raise a PR to merge instead of pushing to `main` as they do in your own copy. `/graft:update` also keeps the interstock in line with `interstock.md`.

Creating an interstock offers to publish the simulator to its GitHub Pages, and `/graft:update` offers again until a repo admin publishes or declines it. A caretaker can also follow `interstock.md`'s Publish the simulator section at any time. Once it is published, changes to the interstock keep the simulator's scenarios current.

The interstock records its mods in `INTERSTOCK-MODS.md`, and each person's copy keeps its own in `MODS.md`.

## Settings

Settings live in `~/.my-graft/graft-settings.json`, which holds your defaults and overrides for repo or folder paths. `/graft-settings` opens a pane that edits only this file, and commits and pushes each change.

A repo can also override settings in `.claude/graft-settings.json` and `.claude/graft-settings.local.json`, which you edit by hand. [Graft settings](./docs/settings.md) lists every setting and how these files combine.

### Fewer questions

These settings remove questions Graft asks. Opting in trades questions for risk: for each, the agent decides instead and says what it chose.

- `orchestrate.agentDoesManualChecks: true` has an agent run the Manual checks (a plan's hands-on checks) it can, leaving you only those that need a person.
- `plan.finishQuestion: skip` removes the Finish question, the last one `/graft:plan` and `/graft:research` ask before they wrap up.
- `plan.clearQuestions: default` removes the plan questions that have a clear recommendation.
- `research.steer: auto` removes the question of which threads to follow after each round of research.
- `common.routineQuestions: auto` removes routine questions, such as linking an issue, ignoring the Graft folder or setting up research worktrees.
- `plan.outsideRepoPlans: always` or `never` removes the question of whether to save plans and research outside a repo.
- `research.uncommittedChanges: always` or `never` removes the question of whether experiments run on your uncommitted changes.
- `orchestrate.manualChecks: defer` or `pause` removes the question of how to handle a plan's Manual checks.
- `update.mode: auto` removes the question before `/graft:update` merges.
- `diff.comments: auto` removes the go-ahead `/graft:diff` waits for before changing code.

For the fewest questions, use [`/graft:yolo`](./docs/commands.md#graftyolo). It asks only when the request is unclear.

## Acknowledgements

Inspired by:

- [staff0rd/assist](https://github.com/staff0rd/assist)
- [openai/codex-plugin-cc](https://github.com/openai/codex-plugin-cc)
- [mattpocock/skills](https://github.com/mattpocock/skills)
- [github/spec-kit](https://github.com/github/spec-kit)
- [obra/superpowers](https://github.com/obra/superpowers)
- [humanlayer/claudelayer](https://github.com/humanlayer/claudelayer)
- [MakerXStudio/yoke](https://github.com/MakerXStudio/yoke)

## License

[MIT](./LICENSE)

# Agent instructions

This file keeps the graphics in `docs/` in step with the skills they draw.

`/graft:modify` and `/graft:update` read and follow this file in each user's own copy at `~/.my-graft`, straight after a merge. Every rule here must work there: that copy has no `node_modules`, and its `MODS.md` fails `oxfmt --check`. Rules that only work in `pleb/graft`, such as `npm run check`, do not belong here. Paths and commands are relative to the root of the repo that holds this file.

## What the graphics draw

- `docs/flow.svg` draws `skills/plan`, `skills/orchestrate`, `skills/pr` and the agents in `agents/` that they use.
- `docs/update.svg` draws `agent-install.md`, `skills/update` and `skills/modify`.

A change to any drawn file that alters what a graphic shows (a command, agent, role, node, edge or output) updates the graphic in the same change, including its `<desc>` and its alt text in `README.md`. This applies in `pleb/graft` and in users' copies alike. The graphics show names and roles only, never conditions such as "by default" or "at key milestones".

## After a merge

When a merge from `upstream/main` changes `docs/*.svg` or a drawn file, and the copy has its own commits touching any of them, check that the graphics still show both upstream's change and the copy's mods, then run all the render checks before committing. This covers clean merges too: SVG edits in different hunks merge without a conflict and can still overlap. The copy has such commits when this prints anything:

```bash
git log --no-merges --oneline upstream/main..HEAD -- docs agents skills/plan skills/orchestrate skills/pr skills/update skills/modify agent-install.md
```

After any merge that changes `docs/*.svg`, run at least step 1 of the render checks.

## Graphic rules

- The root `<svg>` declares `xmlns="http://www.w3.org/2000/svg"`, a `viewBox` 830 wide with matching `width` and `height`, a `<title>` and a `<desc>`. Grow taller, never wider.
- Text is at least 14px (headings are 15px bold).
- Fonts come only from the `<style>` block's `.sans` and `.mono` classes, written exactly as `-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif` and `ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace`. Paths, commands and agent names use `.mono`.
- The background is transparent. Every `<text>` sits inside a filled box or pill. Size boxes for wide fallback fonts, not the Mac's.
- Each box or pill is a `<g>` holding exactly one `<rect>` and its `<text>` elements. Groups may nest (a panel holding its pills).
- No web fonts, scripts, `<foreignObject>`, `<image>` or external references.
- Palette (fill / stroke):
  - Text `#1f2328`, secondary text `#57606a`.
  - Headers `#0969da` with `#ffffff` text.
  - Panels and nodes `#f6f8fa` / `#d0d7de`. Plain pills `#ffffff` / `#d0d7de`.
  - Agent and command pills `#ddf4ff` / `#54aeff`. The user `#fff8c5` / `#d4a72c`. Outputs `#dafbe1` / `#4ac26b`.
  - Arrows `#8c959f`, stroke width 2.

## Render checks

Put every scratch file (wrapper pages, PNGs, font-substituted and broken copies) outside the repo, for example in `T=$(mktemp -d)` under `$TMPDIR`. Modify and update stage with `git add -A`, which would commit them. Run every step for each changed SVG; the examples use `docs/flow.svg`.

1. Validate the XML and its namespace. No Chrome needed.

   ```bash
   xmllint --noout docs/flow.svg
   xmllint --xpath 'namespace-uri(/*)' docs/flow.svg
   ```

   The second command prints `http://www.w3.org/2000/svg`. Without the namespace, browsers show a broken image even though `xmllint` accepts the file.

2. Screenshot it as GitHub shows it. Write two wrapper pages, one with a `#ffffff` background and one with `#0d1117`, each holding `<div style="width:830px"><img src="file:///<absolute path to the svg>" style="max-width: 100%"></div>`. Screenshot each with headless Chrome. Set `CHROME` to its binary: on macOS `"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"`, elsewhere any Chromium that runs `--headless`.

   ```bash
   "$CHROME" --headless --hide-scrollbars --screenshot="$T/flow-dark.png" --window-size=870,<svg height + 40> "$T/wrap-dark.html"
   ```

   Look at both PNGs: text legible, nothing clipped, nothing overlapping.

3. Repeat step 2 with fallback fonts. Copy the SVG into `$T` with the sans stack replaced by `Verdana` and the monospace stack by `'Courier New'`, and confirm neither original stack remains.

   ```bash
   sed -e "s/-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif/Verdana/" \
       -e "s/ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace/'Courier New'/" \
       docs/flow.svg > "$T/flow-fallback.svg"
   ```

   No text may spill out of its box. Judge spills on both backgrounds: dark text spilling onto `#0d1117` nearly vanishes, and white text spilling out of a coloured box vanishes on `#ffffff`.

4. Run the mechanical fit check on the fallback-font copy. Write a scratch HTML page that inlines that SVG inside `<div style="width:830px">`, followed by a script that:
   - Compares each `<text>` with the one `<rect>` that is a direct child of its nearest `<g>`. A text outside that rect, or whose group has no `<rect>` or more than one, is an overflow.
   - Checks every pair of `<rect>`s whose parent is a `<g>`. Two overlap if their areas intersect or they sit at the same place, unless one's group is an ancestor of the other's.
   - Uses page coordinates from `getBoundingClientRect()` throughout. Plain `getBBox()` ignores a parent `<g transform>`, so moved groups would never overlap.
   - Writes `checked N texts, M overflows, K overlaps` into the page, followed by a line per failure, and writes the error instead if it throws.

   Run it with `"$CHROME" --headless --dump-dom "$T/check.html"` and read the line. It passes when `M` and `K` are 0 and `N` equals the count from `xmllint --xpath 'count(//*[local-name()="text"])' docs/flow.svg`, so a script that stops part way cannot pass. Prove it can fail: run it on a copy with one pill's `<rect>` narrowed until its text spills (`M` must be at least 1), and on a copy with one pill moved onto another (`K` must be at least 1).

Where headless Chrome is unavailable, run step 1 and report that steps 2 to 4 were not run. Never skip them silently.

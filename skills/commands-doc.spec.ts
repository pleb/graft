import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const EXEMPT = new Set(["/graft:uninstall", "/graft-settings"]);

function argumentHint(skill: string): string | undefined {
  const markdown = readFileSync(new URL(`./${skill}/SKILL.md`, import.meta.url), "utf8");
  const frontmatter = /^---\n([\s\S]*?)\n---\n/.exec(markdown)?.[1] ?? "";
  const value = /^argument-hint:\s*(.*)$/m.exec(frontmatter)?.[1]?.trim();
  if (value === undefined) {
    return undefined;
  }
  const quoted = /^(["'])(.*)\1$/.exec(value);

  return quoted ? quoted[2] : value;
}

// Each `## /graft:<name>` heading maps to the first line of the first ```text block under it.
function signatures(markdown: string): Map<string, string | undefined> {
  const found = new Map<string, string | undefined>();
  for (const section of markdown.split(/^## /m).slice(1)) {
    const heading = section.slice(0, section.indexOf("\n")).trim();
    if (heading.startsWith("/graft:")) {
      found.set(heading, /^```text\n(.*)$/m.exec(section)?.[1]);
    }
  }

  return found;
}

const hints = readdirSync(new URL(".", import.meta.url), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .flatMap((entry) => {
    const hint = argumentHint(entry.name);

    return hint === undefined ? [] : [[entry.name, hint] as const];
  });
const documented = signatures(
  readFileSync(new URL("../docs/commands.md", import.meta.url), "utf8"),
);

describe("docs/commands.md", () => {
  it.each(hints)("documents /graft:%s with its argument-hint", (skill, hint) => {
    expect(documented.get(`/graft:${skill}`), skill).toBe(`/graft:${skill} ${hint}`);
  });

  it.each([...documented.keys()].filter((command) => !EXEMPT.has(command)))(
    "documents %s for a skill with an argument-hint",
    (command) => {
      const skill = command.slice("/graft:".length);
      expect(
        hints.some(([name]) => name === skill),
        `${skill} has no skills/${skill}/SKILL.md with an argument-hint`,
      ).toBe(true);
    },
  );
});

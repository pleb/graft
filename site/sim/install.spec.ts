import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { BuildError, installLines, resolveSite } from "./build-lib.ts";
import { installUrl } from "./player/finale.ts";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const README = readFileSync(join(ROOT, "README.md"), "utf8");
const HEADING = "Install";

function section(heading: string): string {
  const start = README.indexOf(`\n${heading}\n`);
  if (start === -1) return "";
  const end = README.indexOf("\n## ", start + heading.length + 2);
  return README.slice(start, end === -1 ? undefined : end);
}

describe("Install Graft", () => {
  it("takes the one install line in the README's Install section", () => {
    const { repo, installLine } = resolveSite(ROOT);
    const found = section(`## ${HEADING}`)
      .split("\n")
      .filter((line) => line.startsWith("Claude, install Graft"));
    expect(found).toEqual([installLine]);
    expect(installLines(repo)).toContain(installLine);
    expect(existsSync(join(ROOT, "agent-install.md"))).toBe(true);
  });

  it("links to the README's Install heading", () => {
    const { repo } = resolveSite(ROOT);
    const [page, anchor] = installUrl(repo).split("#");
    expect(page).toBe(`https://github.com/${repo}`);
    expect(section(`## ${HEADING}`)).not.toBe("");
    // GitHub's anchor for a heading: lowercased, punctuation dropped, spaces as hyphens.
    expect(anchor).toBe(
      HEADING.toLowerCase()
        .replace(/[^\w\- ]/g, "")
        .replace(/ /g, "-"),
    );
  });
});

describe("resolveSite", () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  function repoRoot(installLine: string, mods?: string): string {
    const root = mkdtempSync(join(tmpdir(), "graft-site-"));
    roots.push(root);
    writeFileSync(
      join(root, "README.md"),
      `# Graft\n\n## Install\n\n\`\`\`text\n${installLine}\n\`\`\`\n\n## Interstocks\n\nClaude, install Graft elsewhere\n`,
    );
    if (mods !== undefined) writeFileSync(join(root, "INTERSTOCK-MODS.md"), mods);
    return root;
  }

  const mods = (repo: string): string =>
    `Changes the interstock ${repo} makes to Graft. Clones of it keep their own in \`MODS.md\`.\n\n| Change | Intent |\n`;
  const [publicLine, privateLine] = installLines("acme/graft");

  it("defaults to pleb/graft", () => {
    const line = installLines("pleb/graft")[0];
    expect(resolveSite(repoRoot(line))).toEqual({ repo: "pleb/graft", installLine: line });
  });

  it("takes the repo from INTERSTOCK-MODS.md with the public install line", () => {
    expect(resolveSite(repoRoot(publicLine, mods("acme/graft")))).toEqual({
      repo: "acme/graft",
      installLine: publicLine,
    });
  });

  it("takes the repo from INTERSTOCK-MODS.md with the private install line", () => {
    expect(resolveSite(repoRoot(privateLine, mods("acme/graft")))).toEqual({
      repo: "acme/graft",
      installLine: privateLine,
    });
  });

  it("prefers the repo it is given", () => {
    const root = repoRoot(publicLine, mods("other/graft"));
    expect(resolveSite(root, "acme/graft")).toEqual({
      repo: "acme/graft",
      installLine: publicLine,
    });
  });

  it("fails when the install line names another repo", () => {
    expect(() => resolveSite(repoRoot(installLines("pleb/graft")[0]), "acme/graft")).toThrow(
      BuildError,
    );
    expect(() => resolveSite(repoRoot(publicLine, mods("acme/other")))).toThrow(/acme\/other/);
  });

  it("fails without exactly one install line", () => {
    expect(() => resolveSite(repoRoot("Install it by hand"))).toThrow(/holds 0 lines/);
    expect(() => resolveSite(repoRoot(`${publicLine}\n${privateLine}`), "acme/graft")).toThrow(
      /holds 2 lines/,
    );
  });
});

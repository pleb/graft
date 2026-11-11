// Checks that the finale's Install Graft line and link still match the README's Install section.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { INSTALL_LINE, INSTALL_URL } from "./player/finale.ts";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const README = readFileSync(join(ROOT, "README.md"), "utf8");
const HEADING = "Install";
const RAW = "https://raw.githubusercontent.com/pleb/graft/main/";

function section(heading: string): string {
  const start = README.indexOf(`\n${heading}\n`);
  if (start === -1) return "";
  const end = README.indexOf("\n## ", start + heading.length + 2);
  return README.slice(start, end === -1 ? undefined : end);
}

describe("Install Graft", () => {
  it("copies the line in the README's Install section", () => {
    expect(section(`## ${HEADING}`).split("\n")).toContain(INSTALL_LINE);
  });

  it("points the line at a file in the repo", () => {
    const url = INSTALL_LINE.split(" ").find((word) => word.startsWith("https://"));
    expect(url?.startsWith(RAW)).toBe(true);
    const path = url!.slice(RAW.length);
    expect(path).toBe("agent-install.md");
    expect(existsSync(join(ROOT, path))).toBe(true);
  });

  it("links to the README's Install heading", () => {
    const [page, anchor] = INSTALL_URL.split("#");
    expect(page).toBe("https://github.com/pleb/graft");
    expect(section(`## ${HEADING}`)).not.toBe("");
    // GitHub's anchor for a heading: lowercased, punctuation dropped, spaces as hyphens.
    expect(anchor).toBe(
      HEADING.toLowerCase()
        .replace(/[^\w\- ]/g, "")
        .replace(/ /g, "-"),
    );
  });
});

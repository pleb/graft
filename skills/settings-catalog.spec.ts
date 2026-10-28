import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseCatalog } from "./settings-catalog.ts";

const TABLE = `## Settings

Intro.

| Key       | Values            | Default | What it does |
| --------- | ----------------- | ------- | ------------ |
| \`a.one\` | \`always\`, \`never\` | ask     | Does one.    |

After.

## Next
`;

const TWO_ROWS = TABLE.replace(
  "| Does one.    |\n",
  "| Does one.    |\n| `b.two` | `on`              | ask     | Does two.    |\n",
);

describe("parseCatalog", () => {
  it("reads every setting in the real common.md", () => {
    const markdown = readFileSync(new URL("./common.md", import.meta.url), "utf8");
    const catalog = parseCatalog(markdown);

    expect(catalog).toMatchObject({ isParsed: true });
    if (!catalog.isParsed) {
      return;
    }
    expect(catalog.settings.map((setting) => setting.key)).toEqual([
      "plan.outsideRepoPlans",
      "orchestrate.deletePlan",
    ]);
    expect(catalog.settings[1]).toMatchObject({
      skill: "orchestrate",
      name: "deletePlan",
      values: ["always", "never"],
      defaultValue: "ask",
    });
    for (const setting of catalog.settings) {
      expect(setting.description).not.toBe("");
    }
  });

  it("trims padded cells and stops at the table's end", () => {
    expect(parseCatalog(TABLE)).toEqual({
      isParsed: true,
      settings: [
        {
          key: "a.one",
          skill: "a",
          name: "one",
          values: ["always", "never"],
          defaultValue: "ask",
          description: "Does one.",
        },
      ],
    });
  });

  it("refuses a file with no Settings section", () => {
    expect(parseCatalog("# Rules\n")).toMatchObject({ isParsed: false });
  });

  it("refuses changed columns", () => {
    expect(parseCatalog(TABLE.replace("What it does", "Meaning"))).toMatchObject({
      isParsed: false,
    });
  });

  it("refuses a key without backticks or a skill", () => {
    expect(parseCatalog(TABLE.replace("`a.one`", "a.one"))).toMatchObject({ isParsed: false });
    expect(parseCatalog(TABLE.replace("`a.one`", "`one`"))).toMatchObject({ isParsed: false });
  });

  it("refuses a value without backticks", () => {
    expect(parseCatalog(TABLE.replace("`never`", "never"))).toMatchObject({ isParsed: false });
  });

  it("refuses an extra cell", () => {
    expect(parseCatalog(TABLE.replace("Does one.    |", "Does one. | x |"))).toMatchObject({
      isParsed: false,
    });
  });

  it("reads a second row", () => {
    const catalog = parseCatalog(TWO_ROWS);
    expect(catalog.isParsed && catalog.settings.map((setting) => setting.key)).toEqual([
      "a.one",
      "b.two",
    ]);
  });

  it("refuses a row that lost its leading pipe, so no setting is dropped", () => {
    expect(parseCatalog(TWO_ROWS.replace("| `a.one`", "`a.one`"))).toMatchObject({
      isParsed: false,
    });
    expect(parseCatalog(TWO_ROWS.replace("| `b.two`", "`b.two`"))).toMatchObject({
      isParsed: false,
    });
  });

  it("refuses a duplicate key", () => {
    expect(parseCatalog(TWO_ROWS.replace("`b.two`", "`a.one`"))).toMatchObject({
      isParsed: false,
      error: expect.stringContaining("listed twice"),
    });
  });

  it("refuses a value listed twice in a row", () => {
    expect(parseCatalog(TABLE.replace("`never`", "`always`"))).toMatchObject({
      isParsed: false,
      error: expect.stringContaining("listed twice"),
    });
  });
});

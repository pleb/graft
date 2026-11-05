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
      "common.reviewerModel",
      "plan.outsideRepoPlans",
      "plan.questionsPerRound",
      "plan.manualChecksQuestion",
      "orchestrate.finishedPlan",
      "orchestrate.manualChecks",
      "pr.state",
      "update.mode",
    ]);
    expect(catalog.settings).toMatchObject([
      { skill: "common", name: "reviewerModel", values: ["fable", "sonnet"], defaultValue: "opus" },
      { skill: "plan", name: "outsideRepoPlans", values: ["always", "never"], defaultValue: "ask" },
      { skill: "plan", name: "questionsPerRound", values: ["1", "2", "4"], defaultValue: "3" },
      {
        skill: "plan",
        name: "manualChecksQuestion",
        values: ["finish"],
        defaultValue: "orchestrate",
      },
      {
        skill: "orchestrate",
        name: "finishedPlan",
        values: ["archive", "delete"],
        defaultValue: "leave",
      },
      {
        skill: "orchestrate",
        name: "manualChecks",
        values: ["pause", "defer"],
        defaultValue: "ask",
      },
      { skill: "pr", name: "state", values: ["ready"], defaultValue: "draft" },
      { skill: "update", name: "mode", values: ["auto"], defaultValue: "ask" },
    ]);
    for (const setting of catalog.settings) {
      expect(setting.description).not.toBe("");
    }
    expect(catalog.settings.filter((setting) => setting.shownWhen !== undefined)).toMatchObject([
      {
        key: "plan.manualChecksQuestion",
        shownWhen: { key: "orchestrate.manualChecks", value: "ask" },
      },
    ]);
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

  it("refuses a row that lists its default as a value", () => {
    expect(parseCatalog(TABLE.replace("`never`", "`ask`"))).toMatchObject({
      isParsed: false,
      error: expect.stringContaining("the default is also listed"),
    });
  });

  it("with isDefaultListed, reads a row that lists its default and refuses one that does not", () => {
    const listed = TABLE.replace("`never`", "`never`, `ask`");
    expect(parseCatalog(listed, { isDefaultListed: true })).toMatchObject({
      isParsed: true,
      settings: [{ values: ["always", "never", "ask"], defaultValue: "ask" }],
    });
    expect(parseCatalog(TABLE, { isDefaultListed: true })).toMatchObject({
      isParsed: false,
      error: expect.stringContaining("the default is not listed"),
    });
  });

  describe("text", () => {
    const TEXT = TABLE.replace(
      "| Does one.    |\n",
      "| Does one.    |\n| `b.two` | text | Other model | Names it. |\n",
    );

    it("reads a bare text Values cell as a free-text setting with no values", () => {
      expect(parseCatalog(TEXT)).toMatchObject({
        isParsed: true,
        settings: [
          { key: "a.one", values: ["always", "never"] },
          {
            key: "b.two",
            values: [],
            isText: true,
            defaultValue: "Other model",
            description: "Names it.",
          },
        ],
      });
      const catalog = parseCatalog(TEXT);
      expect(catalog.isParsed && catalog.settings[0]).not.toHaveProperty("isText");
    });

    it("reads a backticked text as a listed value and refuses text in a list", () => {
      expect(parseCatalog(TEXT.replace("| text |", "| `text` |"))).toMatchObject({
        isParsed: true,
        settings: [{}, { values: ["text"] }],
      });
      expect(parseCatalog(TEXT.replace("| text |", "| text, `a` |"))).toMatchObject({
        isParsed: false,
      });
    });

    it("with isDefaultListed, reads a text row without listing its default", () => {
      const listed = TEXT.replace("`never`", "`never`, `ask`");
      expect(parseCatalog(listed, { isDefaultListed: true })).toMatchObject({
        isParsed: true,
        settings: [{}, { key: "b.two", values: [], isText: true }],
      });
    });

    it("reads a condition on any value of a text setting", () => {
      const shown = `## Settings

| Key       | Values | Default     | Shown when      | What it does |
| --------- | ------ | ----------- | --------------- | ------------ |
| \`a.one\` | text   | Other model |                 | Names it.    |
| \`b.two\` | \`on\`   | off         | \`a.one = GPT\` | Does two.    |
`;
      expect(parseCatalog(shown)).toMatchObject({
        isParsed: true,
        settings: [{ isText: true }, { shownWhen: { key: "a.one", value: "GPT" } }],
      });
    });
  });

  describe("Shown when", () => {
    const SHOWN = `## Settings

| Key       | Values            | Default | Shown when | What it does |
| --------- | ----------------- | ------- | ---------- | ------------ |
| \`a.one\` | \`always\`, \`never\` | ask     |            | Does one.    |
| \`b.two\` | \`on\`              | off     | CONDITION  | Does two.    |
`;
    const shown = (condition: string) => parseCatalog(SHOWN.replace("CONDITION", condition));

    it("reads a condition on a listed value or the Default, and none from an empty cell", () => {
      expect(shown("`a.one = never`")).toMatchObject({
        isParsed: true,
        settings: [{ key: "a.one" }, { key: "b.two", shownWhen: { key: "a.one", value: "never" } }],
      });
      expect(shown("`a.one = ask`")).toMatchObject({
        settings: [{}, { shownWhen: { key: "a.one", value: "ask" } }],
      });
      const catalog = shown("");
      expect(catalog.isParsed && catalog.settings.map((setting) => setting.shownWhen)).toEqual([
        undefined,
        undefined,
      ]);
    });

    it("reads a condition on a later row", () => {
      const later = SHOWN.replace("|            | Does one.", "| `b.two = on` | Does one.").replace(
        "CONDITION",
        "",
      );
      expect(parseCatalog(later)).toMatchObject({
        settings: [{ shownWhen: { key: "b.two", value: "on" } }, {}],
      });
    });

    it("refuses a condition naming an unknown key", () => {
      expect(shown("`c.three = on`")).toMatchObject({
        isParsed: false,
        error: expect.stringContaining("unknown key"),
      });
    });

    it("refuses a condition on a value the key cannot take", () => {
      expect(shown("`a.one = sometimes`")).toMatchObject({
        isParsed: false,
        error: expect.stringContaining("which it cannot be"),
      });
    });

    it.each(["a.one = never", "`a.one=never`", "`a.one`", "`a.one = never` x"])(
      "refuses the unreadable condition %j",
      (condition) => {
        expect(shown(condition)).toMatchObject({ isParsed: false });
      },
    );
  });

  it("matches the README's settings table to common.md", () => {
    const common = parseCatalog(readFileSync(new URL("./common.md", import.meta.url), "utf8"));
    const readme = parseCatalog(readFileSync(new URL("../README.md", import.meta.url), "utf8"), {
      isDefaultListed: true,
    });

    expect(common).toMatchObject({ isParsed: true });
    expect(readme).toMatchObject({ isParsed: true });
    if (!common.isParsed || !readme.isParsed) {
      return;
    }
    expect(readme.settings.map(({ key, defaultValue }) => ({ key, defaultValue }))).toEqual(
      common.settings.map(({ key, defaultValue }) => ({ key, defaultValue })),
    );
    expect(readme.settings.map(({ shownWhen }) => shownWhen)).toEqual(
      common.settings.map(({ shownWhen }) => shownWhen),
    );
    readme.settings.forEach((setting, i) => {
      const expected = common.settings[i]!;
      expect(setting.isText, setting.key).toBe(expected.isText);
      if (!expected.isText) {
        expect(new Set(setting.values), setting.key).toEqual(
          new Set([...expected.values, expected.defaultValue]),
        );
      }
    });
  });
});

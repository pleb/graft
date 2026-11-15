import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseCatalog, parseSettingsPage } from "./settings-catalog.ts";

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
      "common.routineQuestions",
      "plan.outsideRepoPlans",
      "plan.questionsPerRound",
      "plan.manualChecksQuestion",
      "plan.finishQuestion",
      "plan.clearQuestions",
      "research.artifact",
      "research.uncommittedChanges",
      "research.steer",
      "orchestrate.finishedPlan",
      "orchestrate.manualChecks",
      "orchestrate.agentDoesManualChecks",
      "diff.comments",
      "diff.fileList",
      "pr.state",
      "update.mode",
      "update.notify",
    ]);
    expect(catalog.settings).toMatchObject([
      { skill: "common", name: "reviewerModel", values: ["fable", "sonnet"], defaultValue: "opus" },
      { skill: "common", name: "routineQuestions", values: ["auto"], defaultValue: "ask" },
      {
        skill: "plan",
        name: "outsideRepoPlans",
        values: ["always", "here", "never"],
        defaultValue: "ask",
      },
      { skill: "plan", name: "questionsPerRound", values: ["1", "2", "4"], defaultValue: "3" },
      {
        skill: "plan",
        name: "manualChecksQuestion",
        values: ["finish"],
        defaultValue: "orchestrate",
      },
      { skill: "plan", name: "finishQuestion", values: ["skip"], defaultValue: "ask" },
      { skill: "plan", name: "clearQuestions", values: ["default"], defaultValue: "ask" },
      { skill: "research", name: "artifact", values: ["true"], defaultValue: "false" },
      {
        skill: "research",
        name: "uncommittedChanges",
        values: ["always", "never"],
        defaultValue: "ask",
      },
      { skill: "research", name: "steer", values: ["auto"], defaultValue: "ask" },
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
      {
        skill: "orchestrate",
        name: "agentDoesManualChecks",
        values: ["true"],
        defaultValue: "false",
      },
      { skill: "diff", name: "comments", values: ["auto"], defaultValue: "batch" },
      { skill: "diff", name: "fileList", values: ["tree"], defaultValue: "flat" },
      { skill: "pr", name: "state", values: ["ready"], defaultValue: "draft" },
      { skill: "update", name: "mode", values: ["auto"], defaultValue: "ask" },
      {
        skill: "update",
        name: "notify",
        values: ["daily", "sha", "persistent", "off"],
        defaultValue: "session",
      },
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
});

const PAGE = `# Settings

Intro with a bullet:

- not a setting.

## First

Prose before the section's first entry.

### \`a.one\`

Does one. Over two lines.

- \`ask\` (default)
- \`always\`: always does it.
- \`never\`

Prose after the bullets.

### \`b.two\`

Names it. Applies only when \`a.one\` is \`never\`.

- Any text (default: \`Other model\`)

## After

- not a setting either.
`;

describe("parseSettingsPage", () => {
  it("reads text, bare and free-text bullets, a condition, and ignores prose around entries", () => {
    expect(parseSettingsPage(PAGE)).toEqual([
      {
        key: "a.one",
        skill: "a",
        name: "one",
        values: ["always", "never"],
        defaultValue: "ask",
        description: "Does one. Over two lines.",
      },
      {
        key: "b.two",
        skill: "b",
        name: "two",
        values: [],
        isText: true,
        defaultValue: "Other model",
        description: "Names it.",
        shownWhen: { key: "a.one", value: "never" },
      },
    ]);
  });

  it("reads a condition on the default", () => {
    expect(
      parseSettingsPage(PAGE.replace("is `never`.", "is `ask`.")).map(({ shownWhen }) => shownWhen),
    ).toEqual([undefined, { key: "a.one", value: "ask" }]);
  });

  it.each([
    ["an unreadable heading", "### `a.one`", "### a.one", "cannot read the heading"],
    ["an unreadable bullet", "- `never`\n", "- never\n", "cannot read the bullet"],
    ["a comma-list bullet", "- `never`\n", "- `never`, `x`\n", "cannot read the bullet"],
    ["a bullet after the prose", "Prose after the bullets.", "- x", "cannot read the bullet"],
    [
      "a second free-text bullet",
      "`Other model`)\n",
      "`Other model`)\n- Any text (default: `x`)\n",
      "cannot read the bullet",
    ],
    ["free text with a value", "`Other model`)\n", "`Other model`)\n- `x`\n", "mixes free text"],
    [
      "a condition not last in the summary",
      "is `never`.",
      "is `never`. Then more.",
      "cannot read the condition",
    ],
    [
      "a condition in another wording",
      "Applies only when",
      "Applies when",
      "cannot read the condition",
    ],
    [
      "a condition after the bullets",
      "Prose after the bullets.",
      "Applies only when `b.two` is `x`.",
      "cannot read the condition",
    ],
    ["a missing summary", "Does one. Over two lines.\n\n", "", "has no summary"],
    ["a duplicate key", "### `b.two`", "### `a.one`", "the key is listed twice"],
    ["a duplicate value", "- `never`\n", "- `always`\n", "a value is listed twice"],
    ["a default listed as a value", "- `never`\n", "- `ask`\n", "a value is listed twice"],
    ["no default", "- `ask` (default)\n", "", "exactly one default"],
    ["two defaults", "- `never`\n", "- `never` (default)\n", "exactly one default"],
    ["a condition on an unknown key", "`a.one` is", "`c.three` is", "unknown key"],
    [
      "a condition on a value the key cannot take",
      "is `never`.",
      "is `sometimes`.",
      "which it cannot be",
    ],
  ])("refuses %s", (_, from, to, error) => {
    expect(PAGE).toContain(from);
    expect(() => parseSettingsPage(PAGE.replace(from, to))).toThrow(error);
  });

  it("refuses a page with no settings", () => {
    expect(() => parseSettingsPage("# Settings\n")).toThrow("no settings");
  });

  it("matches docs/settings.md to common.md", () => {
    const common = parseCatalog(readFileSync(new URL("./common.md", import.meta.url), "utf8"));
    const docs = parseSettingsPage(
      readFileSync(new URL("../docs/settings.md", import.meta.url), "utf8"),
    );

    expect(common).toMatchObject({ isParsed: true });
    if (!common.isParsed) {
      return;
    }
    expect(new Set(docs.map(({ key }) => key))).toEqual(
      new Set(common.settings.map(({ key }) => key)),
    );
    for (const expected of common.settings) {
      const setting = docs.find(({ key }) => key === expected.key)!;
      expect(setting.defaultValue, expected.key).toBe(expected.defaultValue);
      expect(new Set(setting.values), expected.key).toEqual(new Set(expected.values));
      expect(setting.isText, expected.key).toBe(expected.isText);
      expect(setting.shownWhen, expected.key).toEqual(expected.shownWhen);
    }
  });
});

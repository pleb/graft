// Parses the `## Settings` table in common.md, or in README.md with
// `isDefaultListed`, where Values include the Default. An optional `Shown when`
// column after Default, or a `<sub>(shown when ...)</sub>` note in the Key cell,
// names the setting a row depends on. A Values cell of the
// bare word `text` marks a free-text setting, which lists no values. Keep it
// free of JSX and Node or claude-code imports: hooks/register.tsx and vitest
// both load it.

export type CatalogSetting = {
  key: string;
  skill: string;
  name: string;
  values: string[];
  isText?: true;
  defaultValue: string;
  description: string;
  shownWhen?: Condition;
};

export type Condition = { key: string; value: string };

export type Catalog =
  | { isParsed: true; settings: CatalogSetting[] }
  | { isParsed: false; error: string };

const HEADER = ["Key", "Values", "Default", "What it does"];
const SHOWN_HEADER = ["Key", "Values", "Default", "Shown when", "What it does"];
const KEY = /^`([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)`$/;
// README.md names the condition under the key instead of in a `Shown when` column.
const KEY_NOTE =
  /^(`[^`]+`) <br><sub>\(shown when ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+ = [^\s<()]+)\)<\/sub>$/;
const CONDITION = /^`([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+) = ([^`\s]+)`$/;
const VALUE = /^`([^`]+)`$/;
const TEXT = "text";

function cells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

export function parseCatalog(markdown: string, { isDefaultListed = false } = {}): Catalog {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === "## Settings");
  if (start === -1) {
    return { isParsed: false, error: "common.md has no `## Settings` section" };
  }
  const end = lines.findIndex((line, i) => i > start && line.startsWith("## "));
  const section = lines.slice(start + 1, end === -1 ? undefined : end);
  const first = section.findIndex((line) => line.trim().startsWith("|"));
  if (first === -1) {
    return { isParsed: false, error: "`## Settings` has no table" };
  }
  const rows: string[] = [];
  for (const line of section.slice(first)) {
    if (!line.trim().startsWith("|")) {
      break;
    }
    rows.push(line);
  }
  const after = section.slice(first + rows.length).find((line) => line.includes("|"));
  if (after !== undefined) {
    return { isParsed: false, error: `cannot read the row: ${after.trim()}` };
  }
  const [header, separator, ...body] = rows;
  const columns = header === undefined ? "" : cells(header).join("|");
  const hasShownWhen = columns === SHOWN_HEADER.join("|");
  if (!hasShownWhen && columns !== HEADER.join("|")) {
    return { isParsed: false, error: `the table's columns are not ${HEADER.join(", ")}` };
  }
  if (separator === undefined || !cells(separator).every((cell) => /^:?-+:?$/.test(cell))) {
    return { isParsed: false, error: "the table has no separator row" };
  }

  const settings: CatalogSetting[] = [];
  for (const row of body) {
    const rowCells = cells(row);
    let shownWhen = hasShownWhen ? rowCells.splice(3, 1)[0] : "";
    let [key = "", values = "", defaultValue = "", description = "", ...rest] = rowCells;
    const note = KEY_NOTE.exec(key);
    if (note !== null && !hasShownWhen) {
      key = note[1]!;
      shownWhen = `\`${note[2]}\``;
    }
    const keyMatch = KEY.exec(key);
    const conditionMatch = shownWhen ? CONDITION.exec(shownWhen) : undefined;
    if (rest.length > 0 || keyMatch === null || conditionMatch === null) {
      return { isParsed: false, error: `cannot read the row: ${row.trim()}` };
    }
    const isText = values === TEXT;
    const parsedValues = isText ? [] : values.split(", ").map((value) => VALUE.exec(value)?.[1]);
    if (parsedValues.some((value) => value === undefined) || defaultValue === "") {
      return { isParsed: false, error: `cannot read the row: ${row.trim()}` };
    }
    if (new Set(parsedValues).size !== parsedValues.length) {
      return { isParsed: false, error: `a value is listed twice: ${row.trim()}` };
    }
    if (!isDefaultListed && parsedValues.includes(defaultValue)) {
      return { isParsed: false, error: `the default is also listed as a value: ${row.trim()}` };
    }
    if (isDefaultListed && !isText && !parsedValues.includes(defaultValue)) {
      return { isParsed: false, error: `the default is not listed as a value: ${row.trim()}` };
    }
    if (settings.some((setting) => setting.key === `${keyMatch[1]}.${keyMatch[2]}`)) {
      return { isParsed: false, error: `the key is listed twice: ${key}` };
    }
    settings.push({
      key: `${keyMatch[1]}.${keyMatch[2]}`,
      skill: keyMatch[1]!,
      name: keyMatch[2]!,
      values: parsedValues as string[],
      ...(isText ? { isText: true as const } : {}),
      defaultValue,
      description,
      ...(conditionMatch === undefined
        ? {}
        : { shownWhen: { key: conditionMatch[1]!, value: conditionMatch[2]! } }),
    });
  }
  if (settings.length === 0) {
    return { isParsed: false, error: "the table has no settings" };
  }
  for (const { key, shownWhen } of settings) {
    if (shownWhen === undefined) {
      continue;
    }
    const target = settings.find((setting) => setting.key === shownWhen.key);
    if (target === undefined) {
      return {
        isParsed: false,
        error: `${key} is shown when an unknown key is set: ${shownWhen.key}`,
      };
    }
    if (
      !target.isText &&
      shownWhen.value !== target.defaultValue &&
      !target.values.includes(shownWhen.value)
    ) {
      return {
        isParsed: false,
        error: `${key} is shown when ${shownWhen.key} is ${shownWhen.value}, which it cannot be`,
      };
    }
  }

  return { isParsed: true, settings };
}

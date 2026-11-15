// `parseCatalog` parses the `## Settings` table in common.md. An optional
// `Shown when` column after Default names the setting a row depends on. A
// Values cell of the bare word `text` marks a free-text setting, which lists no
// values. `parseSettingsPage` parses docs/settings.md, where each `###` heading
// names a setting and starts an entry: a summary paragraph, optionally ending
// in the condition sentence, then one bullet per value or one free-text bullet.
// Keep this file free of JSX and Node or claude-code imports: hooks/register.tsx
// and vitest both load it.

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

export function parseCatalog(markdown: string): Catalog {
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
    const shownWhen = hasShownWhen ? rowCells.splice(3, 1)[0] : "";
    const [key = "", values = "", defaultValue = "", description = "", ...rest] = rowCells;
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
    if (parsedValues.includes(defaultValue)) {
      return { isParsed: false, error: `the default is also listed as a value: ${row.trim()}` };
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
  const error = conditionError(settings);
  if (error !== undefined) {
    return { isParsed: false, error };
  }

  return { isParsed: true, settings };
}

function conditionError(settings: CatalogSetting[]): string | undefined {
  for (const { key, shownWhen } of settings) {
    if (shownWhen === undefined) {
      continue;
    }
    const target = settings.find((setting) => setting.key === shownWhen.key);
    if (target === undefined) {
      return `${key} is shown when an unknown key is set: ${shownWhen.key}`;
    }
    if (
      !target.isText &&
      shownWhen.value !== target.defaultValue &&
      !target.values.includes(shownWhen.value)
    ) {
      return `${key} is shown when ${shownWhen.key} is ${shownWhen.value}, which it cannot be`;
    }
  }
  return undefined;
}

const HEADING = /^###\s/;
const ENTRY_KEY = /^### `([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)`$/;
const SUMMARY_CONDITION =
  /^(.*?)\s*Applies only when `([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)` is `([^`\s]+)`\.$/;
const CONDITION_LIKE = /\bapplies (only )?when\b/i;
const LIST_ITEM = /^\s*([-*+]|\d+[.)])\s/;
const VALUE_BULLET = /^- `([^`]+)`( \(default\))?(?:: (\S.*))?$/;
const TEXT_BULLET = /^- Any text \(default: `([^`]+)`\)$/;
const FENCE = /^\s*(```|~~~)/;

// Parses the entries in docs/settings.md and throws on any it cannot read.
export function parseSettingsPage(markdown: string): CatalogSetting[] {
  const settings: CatalogSetting[] = [];
  let entry: string[] | undefined;
  let isFenced = false;
  const finish = () => {
    if (entry !== undefined) {
      settings.push(parseEntry(entry));
    }
    entry = undefined;
  };
  for (const line of markdown.split(/\r?\n/)) {
    if (FENCE.test(line)) {
      isFenced = !isFenced;
    }
    if (!isFenced && (HEADING.test(line) || line.startsWith("## ") || line.startsWith("# "))) {
      finish();
      if (HEADING.test(line)) {
        entry = [line];
      }
      continue;
    }
    entry?.push(isFenced || FENCE.test(line) ? "" : line);
  }
  finish();

  if (settings.length === 0) {
    throw new Error("the page has no settings");
  }
  const keys = new Set<string>();
  for (const { key } of settings) {
    if (keys.has(key)) {
      throw new Error(`the key is listed twice: ${key}`);
    }
    keys.add(key);
  }
  const error = conditionError(settings);
  if (error !== undefined) {
    throw new Error(error);
  }
  return settings;
}

function parseEntry([heading = "", ...lines]: string[]): CatalogSetting {
  const keyMatch = ENTRY_KEY.exec(heading.trim());
  if (keyMatch === null) {
    throw new Error(`cannot read the heading: ${heading.trim()}`);
  }
  const key = `${keyMatch[1]}.${keyMatch[2]}`;
  const first = lines.findIndex((line) => line.trim() !== "");
  const length = lines.slice(first).findIndex((line) => line.trim() === "");
  const summaryLines = lines.slice(first, length === -1 ? undefined : first + length);
  if (first === -1 || LIST_ITEM.test(summaryLines[0]!)) {
    throw new Error(`${key} has no summary`);
  }
  if (summaryLines.some((line) => LIST_ITEM.test(line))) {
    throw new Error(
      `${key} has a summary that runs into the bullets; add a blank line between them`,
    );
  }
  let summary = summaryLines.map((line) => line.trim()).join(" ");
  let shownWhen: Condition | undefined;
  const conditionMatch = SUMMARY_CONDITION.exec(summary);
  if (conditionMatch !== null) {
    summary = conditionMatch[1]!;
    shownWhen = { key: conditionMatch[2]!, value: conditionMatch[3]! };
  }
  if (summary === "") {
    throw new Error(`${key} has no summary`);
  }
  const rest = lines.slice(first + summaryLines.length);
  const paragraphs = rest
    .join("\n")
    .split(/\n\s*\n/)
    .map((paragraph) =>
      paragraph
        .split("\n")
        .map((line) => line.trim())
        .join(" ")
        .trim(),
    );
  const conditionLike = [summary, ...paragraphs].find((text) => CONDITION_LIKE.test(text));
  if (conditionLike !== undefined) {
    throw new Error(`cannot read the condition in ${key}: ${conditionLike}`);
  }
  const continued = rest.findIndex(
    (line, index) =>
      index > 0 && LIST_ITEM.test(rest[index - 1]!) && line.trim() !== "" && !LIST_ITEM.test(line),
  );
  if (continued !== -1) {
    throw new Error(`a bullet continues onto the next line in ${key}: ${rest[continued]!.trim()}`);
  }

  const values: string[] = [];
  const defaults: string[] = [];
  let textDefault: string | undefined;
  for (const line of rest.filter((line) => LIST_ITEM.test(line))) {
    const valueMatch = VALUE_BULLET.exec(line);
    const textMatch = TEXT_BULLET.exec(line);
    if (textMatch !== null && textDefault === undefined) {
      textDefault = textMatch[1]!;
    } else if (valueMatch !== null) {
      if (values.includes(valueMatch[1]!) || defaults.includes(valueMatch[1]!)) {
        throw new Error(`a value is listed twice in ${key}: ${valueMatch[1]}`);
      }
      (valueMatch[2] === undefined ? values : defaults).push(valueMatch[1]!);
    } else {
      throw new Error(`cannot read the bullet in ${key}: ${line.trim()}`);
    }
  }
  if (textDefault !== undefined && (values.length > 0 || defaults.length > 0)) {
    throw new Error(`${key} mixes free text with listed values`);
  }
  const defaultValue = textDefault ?? defaults[0];
  if (defaultValue === undefined || defaults.length > 1) {
    throw new Error(`${key} needs exactly one default`);
  }
  return {
    key,
    skill: keyMatch[1]!,
    name: keyMatch[2]!,
    values,
    ...(textDefault === undefined ? {} : { isText: true as const }),
    defaultValue,
    description: summary,
    ...(shownWhen === undefined ? {} : { shownWhen }),
  };
}

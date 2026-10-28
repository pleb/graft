// Reads the settings catalog, the table under `## Settings` in common.md.
// Pure: the settings pane (hooks/register.tsx) and vitest both import it.

export type CatalogSetting = {
  key: string;
  skill: string;
  name: string;
  values: string[];
  defaultValue: string;
  description: string;
};

export type Catalog =
  | { isParsed: true; settings: CatalogSetting[] }
  | { isParsed: false; error: string };

const HEADER = ["Key", "Values", "Default", "What it does"];
const KEY = /^`([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)`$/;
const VALUE = /^`([^`]+)`$/;

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
  const [header, separator, ...body] = rows;
  if (header === undefined || cells(header).join("|") !== HEADER.join("|")) {
    return { isParsed: false, error: `the table's columns are not ${HEADER.join(", ")}` };
  }
  if (separator === undefined || !cells(separator).every((cell) => /^:?-+:?$/.test(cell))) {
    return { isParsed: false, error: "the table has no separator row" };
  }

  const settings: CatalogSetting[] = [];
  for (const row of body) {
    const [key = "", values = "", defaultValue = "", description = "", ...rest] = cells(row);
    const keyMatch = KEY.exec(key);
    if (rest.length > 0 || keyMatch === null) {
      return { isParsed: false, error: `cannot read the row: ${row.trim()}` };
    }
    const parsedValues = values.split(", ").map((value) => VALUE.exec(value)?.[1]);
    if (parsedValues.some((value) => value === undefined) || defaultValue === "") {
      return { isParsed: false, error: `cannot read the row: ${row.trim()}` };
    }
    settings.push({
      key: `${keyMatch[1]}.${keyMatch[2]}`,
      skill: keyMatch[1]!,
      name: keyMatch[2]!,
      values: parsedValues as string[],
      defaultValue,
      description,
    });
  }
  if (settings.length === 0) {
    return { isParsed: false, error: "the table has no settings" };
  }

  return { isParsed: true, settings };
}

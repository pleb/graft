import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  BuildError,
  collectPage,
  isSupportedNode,
  listChanges,
  parseInput,
  renderBuild,
  writeBuild,
} from "./build-lib.ts";
import type { BuildInput } from "./build-lib.ts";

const TEMPLATE = fileURLToPath(new URL("./template.html", import.meta.url));

type Cli = { command: "files"; branch: string } | { command: "build"; input: string; out: string };

class UsageError extends Error {}

function usage(): never {
  throw new UsageError(
    "Usage: node build.ts files --default <branch> | build --input <file> --out <dir>",
  );
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function parseCli(): Cli {
  let values;
  let positionals;
  try {
    ({ values, positionals } = parseArgs({
      allowPositionals: true,
      options: {
        default: { type: "string" },
        input: { type: "string" },
        out: { type: "string" },
      },
    }));
  } catch {
    usage();
  }
  if (positionals.length !== 1) usage();
  if (positionals[0] === "files") {
    if (!values.default || values.input !== undefined || values.out !== undefined) usage();
    return { command: "files", branch: values.default };
  }
  if (positionals[0] === "build") {
    if (!values.input || !values.out || values.default !== undefined) usage();
    return { command: "build", input: values.input, out: values.out };
  }
  usage();
}

function readInput(path: string): BuildInput {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    fail(`Cannot read ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    fail(`${path} is not valid JSON`);
  }
  return parseInput(json);
}

function main(): void {
  const version = process.versions.node;
  if (!isSupportedNode(version)) fail(`diff needs Node 24 or later; this is v${version}`);
  let cli: Cli;
  try {
    cli = parseCli();
  } catch (error) {
    if (error instanceof UsageError) fail(error.message);
    throw error;
  }
  try {
    if (cli.command === "files") {
      console.log(JSON.stringify(listChanges(process.cwd(), cli.branch)));
      return;
    }
    const input = readInput(cli.input);
    const data = collectPage(process.cwd(), input);
    const out = resolve(cli.out);
    const output = renderBuild(readFileSync(TEMPLATE, "utf8"), data, input.server, out);
    writeBuild(output);
    const { publishes, batches } = output.publish;
    const add = data.files.reduce((sum, file) => sum + file.add, 0);
    const del = data.files.reduce((sum, file) => sum + file.del, 0);
    console.log(`Wrote ${out}`);
    console.log(
      `${data.files.length} files (${data.uncommitted} uncommitted, ${data.untracked} untracked), +${add} -${del} against ${data.base}`,
    );
    console.log(
      `${publishes.length} publish${publishes.length === 1 ? "" : "es"}, ${batches.length} reader batch${batches.length === 1 ? "" : "es"}`,
    );
  } catch (error) {
    if (error instanceof BuildError) fail(error.message);
    throw error;
  }
}

main();

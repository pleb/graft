import { parseArgs } from "node:util";
import {
  buildReport,
  cleanRunDir,
  isSupportedNode,
  KINDS,
  listFiles,
  PartialRemovalError,
  projectsDir,
  writeReport,
} from "./extract-lib.ts";
import type { CleanResult } from "./extract-lib.ts";

type Cli = { clean: string } | { days: number; out: string | undefined };

class UsageError extends Error {}

function usage(): never {
  throw new UsageError("Usage: node extract.ts --days <n> [--out <file>] | --clean <path>");
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function parseCli(): Cli {
  let values;
  try {
    ({ values } = parseArgs({
      options: { days: { type: "string" }, out: { type: "string" }, clean: { type: "string" } },
    }));
  } catch {
    usage();
  }
  if (values.clean !== undefined) {
    if (!values.clean || values.days !== undefined || values.out !== undefined) usage();
    return { clean: values.clean };
  }
  const days = Number(values.days);
  if (!values.days || !Number.isFinite(days) || days <= 0) usage();
  return { days, out: values.out };
}

async function main(): Promise<void> {
  const version = process.versions.node;
  if (!isSupportedNode(version)) fail(`tune needs Node 24 or later; this is v${version}`);
  let cli: Cli;
  try {
    cli = parseCli();
  } catch (error) {
    if (error instanceof UsageError) fail(error.message);
    throw error;
  }
  if ("clean" in cli) {
    let result: CleanResult;
    try {
      result = cleanRunDir(cli.clean);
    } catch (error) {
      if (error instanceof PartialRemovalError) fail(error.message);
      fail(`Not removed: ${error instanceof Error ? error.message : String(error)}`);
    }
    console.log(result.removed ? `Removed ${result.dir}` : `${result.dir} is already clean`);
    return;
  }
  const { days, out } = cli;
  const cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000;
  const dir = projectsDir();
  const { files, skipped } = listFiles(dir, cutoffMs);
  const report = await buildReport(files, {
    days,
    cutoffMs,
    projectsDir: dir,
    filesSkipped: skipped,
  });
  const path = writeReport(report, out);

  const { summary } = report;
  console.log(`Wrote ${path}`);
  console.log(`Files read: ${summary.filesRead}`);
  if (summary.filesSkipped) console.log(`Files skipped (unreadable): ${summary.filesSkipped}`);
  console.log(`Runs: ${summary.runs} in ${summary.sessions} sessions`);
  console.log(`Fork copies folded: ${summary.forkCopies}`);
  console.log(
    `Candidates: ${KINDS.map((kind) => `${summary.candidates[kind]} ${kind}`).join(", ")}`,
  );
  console.log(
    `Claude Code versions: ${summary.versions.min ?? "none"} to ${summary.versions.max ?? "none"}`,
  );
  for (const warning of summary.warnings) console.log(`Warning: ${warning}`);
}

await main();

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { BuildError, check, linkPlayer, loadScenarios, renderPage } from "./build-lib.ts";

const HERE = fileURLToPath(new URL(".", import.meta.url));
// Dependency order: each file imports only from files before it.
const PLAYER = ["core.ts", "terminal.ts", "stage.ts", "finale.ts", "controls.ts", "main.ts"];
const USAGE = "Usage: node site/sim/build.ts [--scenarios <dir>] [--out <dir>] [--commit <sha>]";

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

async function main(): Promise<void> {
  let values;
  try {
    ({ values } = parseArgs({
      options: {
        scenarios: { type: "string" },
        out: { type: "string" },
        commit: { type: "string" },
      },
    }));
  } catch {
    fail(USAGE);
  }
  const scenariosDir = values.scenarios ? resolve(values.scenarios) : join(HERE, "scenarios");
  const out = values.out ? resolve(values.out) : join(HERE, "..", "dist");
  try {
    const loaded = await loadScenarios(scenariosDir);
    const failures = check(loaded.scenarios, loaded.repo);
    if (failures.length > 0) fail(`check() failed:\n${failures.map((f) => `- ${f}`).join("\n")}`);
    const player = linkPlayer(
      PLAYER.map((name) => ({ name, text: readFileSync(join(HERE, "player", name), "utf8") })),
    );
    const template = readFileSync(join(HERE, "template.html"), "utf8");
    const page = renderPage(template, loaded, player, values.commit);
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, "index.html"), page);
    console.log(`Wrote ${join(out, "index.html")} (${loaded.scenarios.length} scenarios)`);
  } catch (error) {
    if (error instanceof BuildError) fail(error.message);
    throw error;
  }
}

await main();

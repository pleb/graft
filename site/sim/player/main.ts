import { initControls } from "./controls.ts";
import { initCore } from "./core.ts";
import { initFinale } from "./finale.ts";
import { initStage } from "./stage.ts";
import { initTerminal } from "./terminal.ts";

function main(): void {
  initCore();
  initTerminal();
  initStage();
  initFinale();
  initControls();
}

main();

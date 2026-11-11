import { initControls, loadSpeed, renderControls, saveSpeed } from "./controls.ts";
import {
  choose,
  createPlayback,
  formatHash,
  parseHash,
  restart,
  seek,
  setPlaying,
  setSpeed,
  startPath,
} from "./core.ts";
import type { Clock, Playback, SimData, View } from "./core.ts";
import { hideFinale, initFinale, showFinale } from "./finale.ts";
import { initStage, renderStage } from "./stage.ts";
import { initTerminal, playTermStep, renderTerm } from "./terminal.ts";

function main(): void {
  const data = JSON.parse(document.getElementById("sim-data")!.textContent!) as SimData;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const clock: Clock = {
    now: () => performance.now(),
    set: (run, ms) => window.setTimeout(run, ms),
    clear: (timer) => window.clearTimeout(timer as number),
  };
  const show = (playback: Playback): void => {
    renderTerm(playback.term);
    renderStage(playback);
    if (playback.term.ended) showFinale(playback);
    else hideFinale();
  };
  const view: View = {
    reset: show,
    play: playTermStep,
    commit: show,
    changed: renderControls,
  };
  const playback = createPlayback(data, clock, view, loadSpeed());
  const writeHash = (): void => history.replaceState(null, "", formatHash(playback.path));

  initTerminal(
    document.getElementById("terminal")!,
    document.getElementById("caption")!,
    data.repo.name || "graft",
    reduced,
    (at, next) => {
      choose(playback, at, next);
      writeHash();
    },
  );
  initStage();
  initFinale();
  initControls(
    document.getElementById("entries")!,
    document.getElementById("controls")!,
    data.scenarios,
    playback.speed,
    {
      start: (id) => {
        startPath(playback, [id], true);
        writeHash();
      },
      speed: (speed) => {
        setSpeed(playback, speed);
        saveSpeed(speed);
      },
      toggle: () => setPlaying(playback, !playback.playing),
      restart: () => restart(playback),
      seek: (position) => seek(playback, position),
    },
  );

  const open = (): void => {
    const hash = window.location.hash;
    startPath(playback, parseHash(hash, data.scenarios), !reduced);
    if (hash !== "") writeHash();
    if (reduced) seek(playback, 1);
  };
  window.addEventListener("hashchange", open);
  open();
}

main();

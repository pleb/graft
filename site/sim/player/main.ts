import { engage, initControls, loadSpeed, renderControls, saveSpeed } from "./controls.ts";
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
      engage();
      choose(playback, at, next);
      writeHash();
    },
  );
  initStage();
  initFinale();
  const fit = fitPanel();
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
      picker: (open) => {
        fit();
        if (open) revealPanel();
      },
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
  fit();
}

// Marks :root with `vrange` when the browser lays a range input out vertically.
function probeVerticalRange(): void {
  const probe = document.createElement("input");
  probe.type = "range";
  probe.style.cssText = "writing-mode:vertical-lr;position:absolute;visibility:hidden";
  document.body.append(probe);
  const box = probe.getBoundingClientRect();
  document.documentElement.classList.toggle("vrange", box.height > box.width);
  probe.remove();
}

// Measures the panel cell's document top into --term-top, which sizes it on narrow screens.
// It is not refitted on every resize, so a collapsing browser toolbar does not move it.
function fitPanel(): () => void {
  probeVerticalRange();
  const root = document.documentElement;
  const panel = document.getElementById("panel")!;
  const fit = (): void => {
    const top = panel.getBoundingClientRect().top + window.scrollY;
    root.style.setProperty("--term-top", `${Math.round(top)}px`);
  };
  let width = window.innerWidth;
  window.addEventListener("resize", () => {
    if (window.innerWidth === width) return;
    width = window.innerWidth;
    fit();
  });
  window.addEventListener("orientationchange", fit);
  window.matchMedia("(max-height: 599px)").addEventListener("change", fit);
  return fit;
}

// Scrolls the page so the panel's bottom, and so the terminal input, is in view.
function revealPanel(): void {
  const below =
    document.getElementById("panel")!.getBoundingClientRect().bottom - window.innerHeight;
  if (below > 0) window.scrollBy(0, below);
}

main();

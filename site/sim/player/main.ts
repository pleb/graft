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
import type { Clock, PageData, Playback, View } from "./core.ts";
import { hideFinale, initFinale, installUrl, showFinale } from "./finale.ts";
import { initHistory, renderHistory } from "./history.ts";
import { initStage, redrawWires, renderStage } from "./stage.ts";
import { initTerminal, playTermStep, renderTerm } from "./terminal.ts";

function main(): void {
  const data = JSON.parse(document.getElementById("sim-data")!.textContent!) as PageData;
  linkSite(data.site.repo);
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const clock: Clock = {
    now: () => performance.now(),
    set: (run, ms) => window.setTimeout(run, ms),
    clear: (timer) => window.clearTimeout(timer as number),
  };
  const show = (playback: Playback): void => {
    renderTerm(playback.term);
    renderHistory(playback);
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
  initFinale(data.site);
  const fit = fitPanel();
  const handlers = initControls(
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
  initHistory(
    document.getElementById("panel")!,
    document.getElementById("tabs")!,
    document.getElementById("history")!,
    { seek: handlers.seek, view: redrawWires, resize: redrawWires },
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

function linkSite(repo: string): void {
  const home = `https://github.com/${repo}`;
  (document.getElementById("install") as HTMLAnchorElement).href = installUrl(repo);
  const name = document.getElementById("repo-name") as HTMLAnchorElement;
  name.href = home;
  name.textContent = repo;
  (document.getElementById("repo-link") as HTMLAnchorElement).href = home;
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

// Scrolls the page toward the panel's bottom, and so the terminal input, but never past the
// top of the picker's selected entry, which the reader reopened the picker to see.
function revealPanel(): void {
  const below =
    document.getElementById("panel")!.getBoundingClientRect().bottom - window.innerHeight;
  const selected = document.querySelector("#entries [aria-pressed=true]");
  const room = selected ? selected.getBoundingClientRect().top : Infinity;
  const by = Math.min(Math.max(below, 0), room);
  if (by !== 0) window.scrollBy(0, by);
}

main();

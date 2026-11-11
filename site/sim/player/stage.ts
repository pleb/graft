import type { Playback } from "./core.ts";

export function initStage(): void {}

// Called after every reset and every applied step.
export function renderStage(_playback: Playback): void {}

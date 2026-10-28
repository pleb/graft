// What the settings pane keeps in `$.state`: whether a save runs, and a count
// that each finished save bumps so the pane reads the file again.
export type GraftSettingsPane = { isSaving: boolean; revision: number };

declare module "claude-code" {
  interface PluginState {
    graft: { isSaving: boolean; revision: number };
  }
}

// `revision` bumps after each finished save so the pane re-reads the file.
export type GraftSettingsPane = { isSaving: boolean; revision: number };

declare module "claude-code" {
  interface PluginState {
    graft: { isSaving: boolean; revision: number };
  }
}

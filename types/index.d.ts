// `revision` bumps after each finished save so the pane re-reads the file.
// `view` is the picked scope key, or `:defaults`, `:effective` or `:add`.
// `newScopes` holds scopes added or edited in the pane, kept in the picker
// while they have no overrides. `effectivePath` is empty for the session's cwd.
export type GraftSettingsPane = {
  isSaving: boolean;
  revision: number;
  view: string;
  newScopes: string[];
  notice: string;
  effectivePath: string;
};

declare module "claude-code" {
  interface PluginState {
    graft: {
      isSaving: boolean;
      revision: number;
      view: string;
      newScopes: string[];
      notice: string;
      effectivePath: string;
      hasNotifiedUpdate: boolean;
      isUpdateStatusShown: boolean;
    };
  }
}

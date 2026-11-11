export type Option = { label: string; description?: string };

export type Question = {
  header: string;
  question: string;
  options: Option[];
  answer: string;
  // The options come verbatim from the skill.
  fixed?: boolean;
  // The skill recommends the first option, which is the answer.
  recommended?: boolean;
};

export type Edit = { find: string; replace: string };

export type SeedCommit = { id: string; subject: string };

export type Choice = { command: string; next: string };

// Scenario ids earlier in the walked path that an event needs, or must not follow.
export type Guard = { after?: string[]; notAfter?: string[] };

export type Event = Guard &
  (
    | { type: "chapter"; id: string; title: string }
    | { type: "caption"; text: string }
    | { type: "prompt"; text: string }
    | { type: "say"; text: string }
    | { type: "tool"; name: string; args: string; result?: string }
    | { type: "ask"; questions: Question[] }
    // `from` is an agent id, a file path or `pr:<number>`; the default is the terminal line.
    | { type: "agent.start"; id: string; agent: string; description: string; from?: string }
    | { type: "agent.done"; id: string; report?: string }
    | { type: "file.create"; path: string; content: string }
    | { type: "file.modify"; path: string; edits: Edit[] }
    | { type: "git.branch"; name: string }
    | { type: "git.commit"; id: string; subject: string; by?: string[] }
    | {
        type: "pr.seed";
        number: number;
        title: string;
        branch: string;
        base: string;
        draft: boolean;
        commits: SeedCommit[];
      }
    | {
        type: "pr.open";
        number: number;
        title: string;
        branch: string;
        base: string;
        draft: boolean;
        // `git.commit` ids.
        commits: string[];
        body: string;
      }
    | { type: "pr.comment"; number: number; text: string }
    // With `clear`, the player types `/clear` and clears the terminal before the chosen command.
    | { type: "handoff"; text: string; clear?: boolean; choices: Choice[] }
    | { type: "end" }
  );

export type Scenario = {
  id: string;
  title: string;
  kind: "start" | "helper" | "continue";
  settings: Record<string, string>;
  events: Event[];
};

// The default export of `<scenarios dir>/repo.ts`.
export type Repo = { name: string; files: Record<string, string> };

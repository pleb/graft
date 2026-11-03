import { expect, mock, test } from "claude-code/testing";
import type { Engine } from "claude-code/testing";
import type { On } from "claude-code";

const HOME = "/home/u";
const CLONE = `${HOME}/.my-graft`;
const SETTINGS = `${CLONE}/graft-settings.json`;
const COMMON = `# Shared rules

## Settings

| Key                      | Values            | Default | What it does       |
| ------------------------ | ----------------- | ------- | ------------------ |
| \`plan.outsideRepoPlans\`  | \`always\`          | ask     | Saves plans.       |
| \`orchestrate.deletePlan\` | \`always\`, \`never\` | ask     | Deletes the plan.  |

## Next
`;
const SURFACES = ["terminal", "desktop", "vscode", "mobile"] as const;
const EDITABLE = ["terminal", "desktop", "vscode"] as const;

const RUN = {
  command: "graft-settings",
  args: "",
  origin: { kind: "composer" },
  presentation: { isFullscreen: true, columns: 160 },
} as const;

const PANE = {
  plugin: "graft",
  component: "Pane",
  requestId: "graft-settings",
  props: {
    title: "Graft settings",
    isFocused: false,
    bodyColumns: 80,
    placement: "dock",
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const;

type Answer = { exitCode: number; stdout?: string; stderr?: string } | "reject";

type World = {
  files: Map<string, string>;
  runs: string[][];
  inits: { argv: readonly string[]; timeoutMs?: number; env?: Record<string, string> }[];
  placed: { isPlaced: true } | { isPlaced: false; reason: string };
  toasts: string[];
  head: string;
  parent: string;
  subject: string;
  cwd: string;
  tops: Record<string, string>;
  worktrees: Record<string, string>;
  land: (argv: readonly string[]) => void;
  git: (
    sub: string,
    answer: Answer | ((argv: readonly string[]) => Promise<Answer> | Answer),
  ) => void;
};

// A fake engine: HOME set, an in-memory file system, and git answering as a
// clean, up-to-date clone on main. Other directories are repos only when
// `tops` maps them to a top level.
function world(
  on: On,
  settings?: string,
  common = COMMON,
  env: Record<string, string> = {},
): World {
  const files = new Map<string, string>();
  files.set("common", common);
  if (settings !== undefined) {
    files.set(SETTINGS, settings);
  }
  const runs: string[][] = [];
  const inits: World["inits"] = [];
  const toasts: string[] = [];
  const answers = new Map<string, (argv: readonly string[]) => Promise<Answer> | Answer>([
    [
      "rev-parse --show-toplevel",
      (argv) => {
        const top = argv[2] === CLONE ? CLONE : w.tops[argv[2]!];

        return top === undefined
          ? { exitCode: 128, stderr: "fatal" }
          : { exitCode: 0, stdout: `${top}\n` };
      },
    ],
    [
      "worktree list",
      (argv) => ({
        exitCode: 0,
        stdout: w.worktrees[argv[2]!] ?? `worktree ${argv[2]}\nHEAD c0\n`,
      }),
    ],
    ["symbolic-ref", () => ({ exitCode: 0, stdout: "main\n" })],
    ["rev-parse -q", () => ({ exitCode: 1 })],
    ["status", () => ({ exitCode: 0, stdout: "" })],
    ["rev-list", () => ({ exitCode: 0, stdout: "0\n" })],
    ["rev-parse HEAD^", () => ({ exitCode: 0, stdout: `${w.parent}\n` })],
    ["rev-parse HEAD", () => ({ exitCode: 0, stdout: `${w.head}\n` })],
    ["log -1", () => ({ exitCode: 0, stdout: `${w.subject}\n` })],
    ["config core.sshCommand", () => ({ exitCode: 1 })],
    [
      "commit",
      (argv) => {
        w.land(argv);

        return { exitCode: 0 };
      },
    ],
  ]);
  // On Windows the engine hands fs.* native paths: backslashes, and a drive on POSIX fixture paths.
  const posix = (p: string) => p.replaceAll("\\", "/").replace(/^[A-Za-z]:(?=\/)/, "");
  const path = (p: string) => (posix(p).endsWith("/skills/common.md") ? "common" : posix(p));

  mock.env(on, { HOME, ...env });
  on("fs.exists", (_, e) => ({ value: files.has(path(e.path)) }));
  on("fs.read", (_, e) => {
    const text = files.get(path(e.path));

    return text === undefined ? { deny: `ENOENT: ${e.path}` } : { value: text };
  });
  on("fs.write", (_, e) => {
    files.set(path(e.path), e.text);

    return { value: undefined };
  });
  on("fs.stat", (_, e) => ({
    value: { kind: "dir", size: 0, mtimeMs: 0, isLink: false, realPath: path(e.path) },
  }));
  on("process.run", async (_, e) => {
    runs.push([...e.argv]);
    inits.push({ argv: e.argv, ...e.init });
    if (e.argv[0] === "rm") {
      files.delete(e.argv[e.argv.length - 1]!);

      return {
        value: {
          exitCode: 0,
          stdout: "",
          stderr: "",
          isStdoutTruncated: false,
          isStderrTruncated: false,
        },
      };
    }
    const args = e.argv.slice(3);
    const key = [...answers.keys()].find((k) => args.join(" ").startsWith(k));
    const answer = key === undefined ? { exitCode: 0 } : await answers.get(key)!(e.argv);
    if (answer === "reject") {
      return { deny: "timed out" };
    }

    return {
      value: {
        exitCode: answer.exitCode,
        stdout: answer.stdout ?? "",
        stderr: answer.stderr ?? "",
        isStdoutTruncated: false,
        isStderrTruncated: false,
      },
    };
  });
  on("ui.toast", (_, e) => {
    toasts.push(e.text);

    return { value: undefined };
  });
  on("ui.open", () => ({ value: w.placed }));
  on("ui.close", () => ({ value: undefined }));
  on("command.register", () => ({ value: { command: "graft-settings" } }));
  on("session.start", (_, e) => ({ cwd: e.cwd }));
  on("session.cwd", () => ({ value: w.cwd }));

  const w: World = {
    files,
    runs,
    inits,
    placed: { isPlaced: true },
    toasts,
    head: "c0",
    parent: "",
    subject: "init",
    cwd: "/",
    tops: {},
    worktrees: {},
    land: (argv) => {
      w.parent = w.head;
      w.head = `${w.head}+`;
      w.subject = argv[6]!;
    },
    git: (sub, answer) => answers.set(sub, typeof answer === "function" ? answer : () => answer),
  };

  return w;
}

const gitRuns = (w: World, sub: string) =>
  w.runs.filter((argv) => argv[0] === "git" && argv[3] === sub);

const mountOn = <S extends (typeof SURFACES)[number]>($: Engine, surface: S) =>
  $.ui.mount({ ...PANE, surface });

const settingSelects = async (ui: {
  findAll: (q: { type: string }) => Promise<{ key?: string }[]>;
}) => (await ui.findAll({ type: "Select" })).filter((select) => select.key !== "scope");

test("a missing settings file shows every setting as ask, on every surface", async ($, on) => {
  world(on);
  for (const surface of EDITABLE) {
    const ui = await mountOn($, surface);
    const select = await ui.find({ type: "Select", key: "orchestrate.deletePlan" });
    expect(select?.props.value).toBe(":default");
    expect(await settingSelects(ui)).toHaveLength(2);
    expect(
      await ui.find({ type: "Text", text: /Deletes the plan\. Default: ask\./ }),
    ).toBeDefined();
    await ui.unmount();
  }
});

test("the settings file is found under USERPROFILE when HOME is unset", async ($, on) => {
  world(on, '{"orchestrate":{"deletePlan":"never"}}', COMMON, { HOME: "", USERPROFILE: HOME });
  const ui = await mountOn($, "terminal");
  expect((await ui.find({ key: "orchestrate.deletePlan" }))?.props.value).toBe("never");
  await ui.unmount();
});

test("mobile draws the settings as read-only text", async ($, on) => {
  world(on, '{"orchestrate":{"deletePlan":"never"}}');
  const ui = await mountOn($, "mobile");
  expect(await ui.find({ type: "Text", text: /orchestrate\.deletePlan: never/ })).toBeDefined();
  expect(await ui.find({ type: "Text", text: /plan\.outsideRepoPlans: ask/ })).toBeDefined();
  await ui.unmount();
});

test("a partial file shows set keys and leaves the rest at ask", async ($, on) => {
  world(on, '{"plan":{"outsideRepoPlans":"always"}}');
  for (const surface of EDITABLE) {
    const ui = await mountOn($, surface);
    expect((await ui.find({ key: "plan.outsideRepoPlans" }))?.props.value).toBe("always");
    expect((await ui.find({ key: "orchestrate.deletePlan" }))?.props.value).toBe(":default");
    await ui.unmount();
  }
});

test("a malformed file is shown read-only with its parse error", async ($, on) => {
  const w = world(on, '{"plan":');
  for (const surface of SURFACES) {
    const ui = await mountOn($, surface);
    expect(await ui.find({ type: "Select" })).toBeUndefined();
    expect(
      await ui.find({ type: "Text", text: /graft-settings\.json does not parse/ }),
    ).toBeDefined();
    await ui.unmount();
  }
  expect(w.files.get(SETTINGS)).toBe('{"plan":');
});

test("keys not in the catalog are listed read-only", async ($, on) => {
  world(on, '{"plan":{"outsideRepoPlans":"always","other":1},"extra":{"x":"y"}}');
  for (const surface of SURFACES) {
    const ui = await mountOn($, surface);
    expect(await ui.find({ type: "Text", text: /plan\.other: 1/ })).toBeDefined();
    expect(await ui.find({ type: "Text", text: /extra\.x: y/ })).toBeDefined();
    expect(await ui.find({ key: "plan.other" })).toBeUndefined();
    await ui.unmount();
  }
});

test("a non-object entry, which skills refuse, is shown read-only with the reason", async ($, on) => {
  world(on, '{"plan":{"outsideRepoPlans":"always"},"extra":"x"}');
  for (const surface of SURFACES) {
    const ui = await mountOn($, surface);
    expect(await ui.find({ type: "Select" })).toBeUndefined();
    expect(
      await ui.find({ type: "Text", text: /does not parse: the skill "extra" is not an object/ }),
    ).toBeDefined();
    await ui.unmount();
  }
});

test("a catalog that does not parse lists the raw keys read-only", async ($, on) => {
  world(
    on,
    '{"plan":{"outsideRepoPlans":"always"}}',
    "# Shared rules\n\n## Settings\n\nNo table.\n",
  );
  for (const surface of SURFACES) {
    const ui = await mountOn($, surface);
    expect(await ui.find({ type: "Select" })).toBeUndefined();
    expect(
      await ui.find({ type: "Text", text: /catalog in common\.md does not parse/ }),
    ).toBeDefined();
    expect(await ui.find({ type: "Text", text: /plan\.outsideRepoPlans: always/ })).toBeDefined();
    await ui.unmount();
  }
});

test("a first save to a missing file creates, adds, commits and pushes it", async ($, on) => {
  const w = world(on);
  const ui = await mountOn($, "terminal");
  await ui.select({ key: "orchestrate.deletePlan", value: "never" });

  expect(JSON.parse(w.files.get(SETTINGS)!)).toEqual({ orchestrate: { deletePlan: "never" } });
  expect(w.runs.filter((argv) => argv[0] === "git").map((argv) => argv[3])).toEqual([
    "config",
    "rev-parse",
    "symbolic-ref",
    "rev-parse",
    "status",
    "rev-list",
    "pull",
    "rev-parse",
    "add",
    "commit",
    "push",
  ]);
  expect(gitRuns(w, "add")[0]).toEqual(["git", "-C", CLONE, "add", "--", "graft-settings.json"]);
  expect(gitRuns(w, "commit")[0]).toEqual([
    "git",
    "-C",
    CLONE,
    "commit",
    "--only",
    "-m",
    "Set orchestrate.deletePlan to never",
    "--",
    "graft-settings.json",
  ]);
  expect(w.toasts).toEqual([]);
  expect((await ui.find({ key: "orchestrate.deletePlan" }))?.props.value).toBe("never");
  await ui.unmount();
});

test("setting then clearing a key keeps the other keys and drops an emptied skill", async ($, on) => {
  const w = world(on, '{"plan":{"outsideRepoPlans":"always"}}');
  const ui = await mountOn($, "desktop");
  await ui.select({ key: "orchestrate.deletePlan", value: "always" });
  expect(JSON.parse(w.files.get(SETTINGS)!)).toEqual({
    plan: { outsideRepoPlans: "always" },
    orchestrate: { deletePlan: "always" },
  });
  await ui.select({ key: "orchestrate.deletePlan", value: ":default" });
  expect(JSON.parse(w.files.get(SETTINGS)!)).toEqual({ plan: { outsideRepoPlans: "always" } });
  expect(gitRuns(w, "commit").map((argv) => argv[6])).toEqual([
    "Set orchestrate.deletePlan to always",
    "Clear orchestrate.deletePlan",
  ]);
  expect(gitRuns(w, "push")).toHaveLength(2);
  await ui.unmount();
});

test("a save that changes nothing stops after the re-read", async ($, on) => {
  const w = world(on, '{"plan":{"outsideRepoPlans":"always"}}');
  const ui = await mountOn($, "vscode");
  await ui.select({ key: "plan.outsideRepoPlans", value: "always" });
  expect(gitRuns(w, "pull")).toHaveLength(1);
  expect(gitRuns(w, "add")).toHaveLength(0);
  expect(gitRuns(w, "commit")).toHaveLength(0);
  expect(w.toasts).toEqual([]);
  await ui.unmount();
});

const REFUSALS: [string, string, Answer, RegExp][] = [
  [
    "not the clone",
    "rev-parse --show-toplevel",
    { exitCode: 0, stdout: `${HOME}\n` },
    /not the Graft clone/,
  ],
  [
    "not a repository",
    "rev-parse --show-toplevel",
    { exitCode: 128, stderr: "fatal" },
    /not the Graft clone/,
  ],
  ["not on main", "symbolic-ref", { exitCode: 0, stdout: "feature\n" }, /not on main/],
  [
    "a dirty tree",
    "status",
    { exitCode: 0, stdout: "?? notes.md\n" },
    /changed or untracked files/,
  ],
  ["a merge in progress", "rev-parse -q", { exitCode: 0, stdout: "abc\n" }, /merge in progress/],
  ["unpushed commits", "rev-list", { exitCode: 0, stdout: "2\n" }, /not pushed to origin/],
  [
    "a failed pull",
    "pull",
    { exitCode: 1, stderr: "fatal: Not possible to fast-forward" },
    /pulling origin main failed \(fatal: Not possible to fast-forward\)/,
  ],
  ["a timed-out pull", "pull", "reject", /pulling origin main failed/],
];

for (const [name, sub, answer, toast] of REFUSALS) {
  test(`a save is refused on ${name}`, async ($, on) => {
    const w = world(on, '{"plan":{"outsideRepoPlans":"always"}}');
    w.git(sub, answer);
    const ui = await mountOn($, "terminal");
    await ui.select({ key: "orchestrate.deletePlan", value: "never" });

    expect(w.toasts).toHaveLength(1);
    expect(w.toasts[0]).toMatch(toast);
    expect(w.files.get(SETTINGS)).toBe('{"plan":{"outsideRepoPlans":"always"}}');
    expect(gitRuns(w, "commit")).toHaveLength(0);
    expect((await ui.find({ key: "orchestrate.deletePlan" }))?.props.value).toBe(":default");
    await ui.unmount();
  });
}

for (const [name, answer] of [
  ["failed", { exitCode: 1, stderr: "Author identity unknown" }],
  ["timed-out", "reject"],
] as const) {
  test(`a ${name} commit restores an existing file`, async ($, on) => {
    const w = world(on, '{"plan":{"outsideRepoPlans":"always"}}');
    w.git("commit", answer);
    const ui = await mountOn($, "terminal");
    await ui.select({ key: "orchestrate.deletePlan", value: "never" });

    expect(w.files.get(SETTINGS)).toBe('{"plan":{"outsideRepoPlans":"always"}}');
    expect(gitRuns(w, "reset")[0]).toEqual([
      "git",
      "-C",
      CLONE,
      "reset",
      "-q",
      "--",
      "graft-settings.json",
    ]);
    expect(gitRuns(w, "push")).toHaveLength(0);
    expect(w.toasts[0]).toMatch(/the commit failed .* was restored/);
    await ui.unmount();
  });

  test(`a ${name} commit deletes a file it created`, async ($, on) => {
    const w = world(on);
    w.git("commit", answer);
    const ui = await mountOn($, "terminal");
    await ui.select({ key: "orchestrate.deletePlan", value: "never" });

    expect(w.files.has(SETTINGS)).toBe(false);
    expect(w.runs).toContainEqual(["rm", "-f", "--", SETTINGS]);
    expect(w.toasts[0]).toMatch(/was restored/);
    await ui.unmount();
  });

  test(`a ${name} commit that moved HEAD counts as made and is pushed`, async ($, on) => {
    const w = world(on, '{"plan":{"outsideRepoPlans":"always"}}');
    w.git("commit", (argv) => {
      w.land(argv);

      return answer;
    });
    const ui = await mountOn($, "terminal");
    await ui.select({ key: "orchestrate.deletePlan", value: "never" });

    expect(JSON.parse(w.files.get(SETTINGS)!)).toEqual({
      plan: { outsideRepoPlans: "always" },
      orchestrate: { deletePlan: "never" },
    });
    expect(gitRuns(w, "reset")).toHaveLength(0);
    expect(gitRuns(w, "push")).toHaveLength(1);
    expect(w.toasts).toEqual([]);
    await ui.unmount();
  });

  test(`a ${name} commit with HEAD moved to a foreign commit is left for the user`, async ($, on) => {
    const w = world(on, '{"plan":{"outsideRepoPlans":"always"}}');
    w.git("commit", () => {
      w.parent = "c0";
      w.head = "f1";
      w.subject = "Someone else's change";

      return answer;
    });
    w.git("diff --quiet", { exitCode: 1 });
    const ui = await mountOn($, "terminal");
    await ui.select({ key: "orchestrate.deletePlan", value: "never" });

    expect(gitRuns(w, "reset")).toHaveLength(0);
    expect(gitRuns(w, "push")).toHaveLength(0);
    expect(JSON.parse(w.files.get(SETTINGS)!)).toEqual({
      plan: { outsideRepoPlans: "always" },
      orchestrate: { deletePlan: "never" },
    });
    expect(w.toasts[0]).toMatch(/may not be saved: .*not this save's.*git -C ~\/\.my-graft log -1/);
    await ui.unmount();
  });

  test(`a ${name} commit with HEAD moved past a foreign parent is left for the user`, async ($, on) => {
    const w = world(on, '{"plan":{"outsideRepoPlans":"always"}}');
    w.git("commit", (argv) => {
      w.land(argv);
      w.parent = "f1";

      return answer;
    });
    const ui = await mountOn($, "terminal");
    await ui.select({ key: "orchestrate.deletePlan", value: "never" });

    expect(gitRuns(w, "push")).toHaveLength(0);
    expect(w.toasts[0]).toMatch(/not this save's/);
    await ui.unmount();
  });

  test(`a ${name} commit with an unreadable HEAD is left for the user`, async ($, on) => {
    const w = world(on, '{"plan":{"outsideRepoPlans":"always"}}');
    w.git("commit", answer);
    let heads = 0;
    w.git("rev-parse HEAD", () => {
      heads += 1;

      return heads === 1 ? { exitCode: 0, stdout: "c0\n" } : "reject";
    });
    const ui = await mountOn($, "terminal");
    await ui.select({ key: "orchestrate.deletePlan", value: "never" });

    expect(gitRuns(w, "reset")).toHaveLength(0);
    expect(gitRuns(w, "push")).toHaveLength(0);
    expect(w.toasts[0]).toMatch(/may not be saved: .*HEAD could not be read/);
    await ui.unmount();
  });

  test(`a ${name} push keeps the commit and says what to run`, async ($, on) => {
    const w = world(on);
    w.git("push", answer);
    const ui = await mountOn($, "terminal");
    await ui.select({ key: "orchestrate.deletePlan", value: "never" });

    expect(JSON.parse(w.files.get(SETTINGS)!)).toEqual({ orchestrate: { deletePlan: "never" } });
    expect(gitRuns(w, "commit")).toHaveLength(1);
    expect(w.toasts[0]).toMatch(/committed but not pushed.*git -C ~\/\.my-graft push origin main/);
    await ui.unmount();
  });
}

test("network calls never prompt and every call has a timeout", async ($, on) => {
  const w = world(on);
  const inits = w.inits;
  const ui = await mountOn($, "terminal");
  await ui.select({ key: "orchestrate.deletePlan", value: "never" });

  expect(inits.length).toBeGreaterThan(0);
  for (const init of inits) {
    expect(init.timeoutMs).toBeGreaterThan(0);
    const isNetwork = init.argv[3] === "pull" || init.argv[3] === "push";
    expect(init.env).toEqual(
      isNetwork ? { GIT_TERMINAL_PROMPT: "0", GIT_SSH_COMMAND: "ssh -o BatchMode=yes" } : undefined,
    );
  }
  expect(w.toasts).toEqual([]);
  await ui.unmount();
});

const sshCommands = (w: World) =>
  w.inits
    .filter((init) => init.argv[3] === "pull" || init.argv[3] === "push")
    .map((init) => init.env?.GIT_SSH_COMMAND);

test("network calls keep the ssh command from core.sshCommand", async ($, on) => {
  const w = world(on);
  w.git("config core.sshCommand", { exitCode: 0, stdout: "ssh -i ~/.ssh/graft\n" });
  const ui = await mountOn($, "terminal");
  await ui.select({ key: "orchestrate.deletePlan", value: "never" });

  expect(sshCommands(w)).toEqual([
    "ssh -o BatchMode=yes -i ~/.ssh/graft",
    "ssh -o BatchMode=yes -i ~/.ssh/graft",
  ]);
  await ui.unmount();
});

test("network calls prefer GIT_SSH_COMMAND from the environment", async ($, on) => {
  const w = world(on, undefined, COMMON, { GIT_SSH_COMMAND: "ssh -i ~/.ssh/env" });
  w.git("config core.sshCommand", { exitCode: 0, stdout: "ssh -i ~/.ssh/graft\n" });
  const ui = await mountOn($, "terminal");
  await ui.select({ key: "orchestrate.deletePlan", value: "never" });

  expect(sshCommands(w)).toEqual([
    "ssh -o BatchMode=yes -i ~/.ssh/env",
    "ssh -o BatchMode=yes -i ~/.ssh/env",
  ]);
  await ui.unmount();
});

test("BatchMode=yes comes before a user's own BatchMode=no", async ($, on) => {
  const w = world(on, undefined, COMMON, { GIT_SSH_COMMAND: "ssh -o BatchMode=no" });
  const ui = await mountOn($, "terminal");
  await ui.select({ key: "orchestrate.deletePlan", value: "never" });

  expect(sshCommands(w)[0]).toBe("ssh -o BatchMode=yes -o BatchMode=no");
  await ui.unmount();
});

test("network calls use GIT_SSH when no ssh command is set", async ($, on) => {
  const w = world(on, undefined, COMMON, { GIT_SSH: "/opt/my ssh/bin/ssh" });
  const ui = await mountOn($, "terminal");
  await ui.select({ key: "orchestrate.deletePlan", value: "never" });

  expect(sshCommands(w)[0]).toBe("'/opt/my ssh/bin/ssh' -o BatchMode=yes");
  await ui.unmount();
});

test("core.sshCommand wins over GIT_SSH", async ($, on) => {
  const w = world(on, undefined, COMMON, { GIT_SSH: "/usr/bin/ssh" });
  w.git("config core.sshCommand", { exitCode: 0, stdout: "ssh -i ~/.ssh/graft\n" });
  const ui = await mountOn($, "terminal");
  await ui.select({ key: "orchestrate.deletePlan", value: "never" });

  expect(sshCommands(w)[0]).toBe("ssh -o BatchMode=yes -i ~/.ssh/graft");
  await ui.unmount();
});

test("network calls quote a Windows GIT_SSH path with spaces", async ($, on) => {
  const w = world(on, undefined, COMMON, { GIT_SSH: "C:\\Program Files\\OpenSSH\\ssh.exe" });
  const ui = await mountOn($, "terminal");
  await ui.select({ key: "orchestrate.deletePlan", value: "never" });

  expect(sshCommands(w)[0]).toBe("'C:\\Program Files\\OpenSSH\\ssh.exe' -o BatchMode=yes");
  await ui.unmount();
});

test("BatchMode=yes follows a double-quoted core.sshCommand program with spaces", async ($, on) => {
  const w = world(on);
  w.git("config core.sshCommand", {
    exitCode: 0,
    stdout: '"C:\\Program Files\\OpenSSH\\ssh.exe" -i ~/.ssh/graft\n',
  });
  const ui = await mountOn($, "terminal");
  await ui.select({ key: "orchestrate.deletePlan", value: "never" });

  expect(sshCommands(w)[0]).toBe(
    '"C:\\Program Files\\OpenSSH\\ssh.exe" -o BatchMode=yes -i ~/.ssh/graft',
  );
  await ui.unmount();
});

test("BatchMode=yes follows a single-quoted GIT_SSH_COMMAND program with spaces", async ($, on) => {
  const w = world(on, undefined, COMMON, {
    GIT_SSH_COMMAND: "'/opt/my ssh/bin/ssh' -i ~/.ssh/env",
  });
  const ui = await mountOn($, "terminal");
  await ui.select({ key: "orchestrate.deletePlan", value: "never" });

  expect(sshCommands(w)[0]).toBe("'/opt/my ssh/bin/ssh' -o BatchMode=yes -i ~/.ssh/env");
  await ui.unmount();
});

for (const [program, expected] of [
  ["C:\\Program Files\\PuTTY\\plink.exe", "'C:\\Program Files\\PuTTY\\plink.exe' -batch"],
  [
    "C:\\Program Files\\TortoiseGit\\bin\\TortoisePlink.exe",
    "'C:\\Program Files\\TortoiseGit\\bin\\TortoisePlink.exe' -batch",
  ],
  ["/usr/bin/plink", "'/usr/bin/plink' -batch"],
] as const) {
  test(`plink and TortoisePlink get -batch instead of BatchMode=yes: ${program}`, async ($, on) => {
    const w = world(on, undefined, COMMON, { GIT_SSH: program });
    const ui = await mountOn($, "terminal");
    await ui.select({ key: "orchestrate.deletePlan", value: "never" });

    expect(sshCommands(w)[0]).toBe(expected);
    await ui.unmount();
  });
}

test("a plink core.sshCommand gets -batch after its program", async ($, on) => {
  const w = world(on);
  w.git("config core.sshCommand", {
    exitCode: 0,
    stdout: '"C:\\Program Files\\PuTTY\\PLINK.EXE" -i key.ppk\n',
  });
  const ui = await mountOn($, "terminal");
  await ui.select({ key: "orchestrate.deletePlan", value: "never" });

  expect(sshCommands(w)[0]).toBe('"C:\\Program Files\\PuTTY\\PLINK.EXE" -batch -i key.ppk');
  await ui.unmount();
});

test("the selects give way to text while a save runs", async ($, on) => {
  const clock = mock.clock(on);
  const w = world(on);
  w.git("push", async () => {
    await clock.sleep(1000);

    return { exitCode: 0 };
  });
  const ui = await mountOn($, "terminal");
  const other = await mountOn($, "desktop");
  const first = ui.select({ key: "orchestrate.deletePlan", value: "never" });
  await clock.settle();

  expect(await settingSelects(ui)).toHaveLength(0);
  expect(await settingSelects(other)).toHaveLength(0);
  expect(await other.find({ type: "Text", text: /\(saving\)/ })).toBeDefined();
  await expect(other.select({ key: "plan.outsideRepoPlans", value: "always" })).rejects.toThrow();

  await clock.advance(1000);
  await first;
  expect(gitRuns(w, "commit")).toHaveLength(1);
  expect(await settingSelects(other)).toHaveLength(2);
  await ui.unmount();
  await other.unmount();
});

test("a session start clears a lock that a reload left behind", async ($, on) => {
  const clock = mock.clock(on);
  const w = world(on);
  w.git("push", async () => {
    await clock.sleep(1000);

    return { exitCode: 0 };
  });
  const ui = await mountOn($, "terminal");
  const first = ui.select({ key: "orchestrate.deletePlan", value: "never" });
  await clock.settle();
  expect(await settingSelects(ui)).toHaveLength(0);

  await $.session.start({ cwd: "/", surface: "terminal", isInteractive: true });
  expect(await settingSelects(ui)).toHaveLength(2);

  await clock.advance(1000);
  await first;
  await ui.unmount();
});

test("a save that loses the race for the lock says a save is running", async ($, on) => {
  const w = world(on);
  on("state.set", { plugin: "graft", key: "isSaving" }, (_, e, next) =>
    e.value === true ? { value: { isSet: false, version: 7 } } : next(e),
  );
  const ui = await mountOn($, "terminal");
  await ui.select({ key: "orchestrate.deletePlan", value: "never" });

  expect(w.toasts).toEqual(["Graft settings: a save is still running. Try again when it ends."]);
  expect(w.runs).toEqual([]);
  expect(w.files.has(SETTINGS)).toBe(false);
  await ui.unmount();
});

test("the command opens the pane where a surface draws it", async ($, on) => {
  world(on);
  await $.session.start({ cwd: "/", surface: "terminal", isInteractive: true });

  const ran = await $.command.run(RUN);
  expect(ran.text).toBe("Opened the Graft settings pane.");
});

test("the command replies with the text list where nothing draws", async ($, on) => {
  const w = world(on, '{"orchestrate":{"deletePlan":"always"},"extra":{"key":true}}');
  w.placed = { isPlaced: false, reason: "no-surface: a -p run" };
  await $.session.start({ cwd: "/", surface: null, isInteractive: false });

  const ran = await $.command.run(RUN);
  expect(ran.text).toBe(
    [
      "Graft settings in ~/.my-graft/graft-settings.json",
      "plan.outsideRepoPlans: ask (always, ask)",
      "  Saves plans.",
      "orchestrate.deletePlan: always (always, never, ask)",
      "  Deletes the plan.",
      "Not in the catalog:",
      "extra.key: true",
    ].join("\n"),
  );
});

const ASK_AND_NUMBERS = `# Shared rules

## Settings

| Key                      | Values            | Default | What it does    |
| ------------------------ | ----------------- | ------- | --------------- |
| \`orchestrate.deletePlan\` | \`always\`, \`ask\`   | never   | Deletes it.     |
| \`plan.questionsPerRound\` | \`1\`, \`2\`, \`4\`     | 3       | Asks in rounds. |
`;

test("a row that lists ask stores ask, and its default clears the key", async ($, on) => {
  const w = world(on, undefined, ASK_AND_NUMBERS);
  const ui = await mountOn($, "terminal");
  const select = await ui.find({ key: "orchestrate.deletePlan" });
  expect(select?.props.options).toEqual([
    { value: "always" },
    { value: "ask" },
    { value: ":default", label: "never" },
  ]);
  expect(select?.props.value).toBe(":default");

  await ui.select({ key: "orchestrate.deletePlan", value: "ask" });
  expect(JSON.parse(w.files.get(SETTINGS)!)).toEqual({ orchestrate: { deletePlan: "ask" } });
  expect((await ui.find({ key: "orchestrate.deletePlan" }))?.props.value).toBe("ask");

  await ui.select({ key: "orchestrate.deletePlan", value: ":default" });
  expect(JSON.parse(w.files.get(SETTINGS)!)).toEqual({});
  expect(gitRuns(w, "commit").map((argv) => argv[6])).toEqual([
    "Set orchestrate.deletePlan to ask",
    "Clear orchestrate.deletePlan",
  ]);
  await ui.unmount();
});

test("a stored value equal to the default selects the default option", async ($, on) => {
  const w = world(on, '{"orchestrate":{"deletePlan":"never"}}', ASK_AND_NUMBERS);
  const ui = await mountOn($, "terminal");
  const select = await ui.find({ key: "orchestrate.deletePlan" });
  expect(select?.props.value).toBe(":default");
  expect(select?.props.options).toHaveLength(3);
  expect(await ui.find({ type: "Text", text: /not allowed/ })).toBeUndefined();

  await ui.select({ key: "orchestrate.deletePlan", value: ":default" });
  expect(JSON.parse(w.files.get(SETTINGS)!)).toEqual({});
  await ui.unmount();
});

test("numeric values are offered in numeric order, with a not-allowed value last", async ($, on) => {
  world(on, '{"plan":{"questionsPerRound":"5"}}', ASK_AND_NUMBERS);
  const ui = await mountOn($, "terminal");
  const select = await ui.find({ key: "plan.questionsPerRound" });
  expect(select?.props.options).toEqual([
    { value: "1" },
    { value: "2" },
    { value: ":default", label: "3" },
    { value: "4" },
    { value: ":unlisted", label: "5 (not allowed)" },
  ]);
  expect(select?.props.value).toBe(":unlisted");
  await ui.unmount();
});

test("the text list gives numeric values in numeric order", async ($, on) => {
  const w = world(on, '{"plan":{"questionsPerRound":"2"}}', ASK_AND_NUMBERS);
  w.placed = { isPlaced: false, reason: "no-surface: a -p run" };
  await $.session.start({ cwd: "/", surface: null, isInteractive: false });

  const ran = await $.command.run(RUN);
  expect(ran.text).toBe(
    [
      "Graft settings in ~/.my-graft/graft-settings.json",
      "orchestrate.deletePlan: never (always, ask, never)",
      "  Deletes it.",
      "plan.questionsPerRound: 2 (1, 2, 3, 4)",
      "  Asks in rounds.",
    ].join("\n"),
  );
});

const REPO = `${HOME}/w/repo`;
const SCOPED = JSON.stringify({
  orchestrate: { deletePlan: "always" },
  extra: { kept: true },
  "~/w/*": { overrides: { orchestrate: { deletePlan: "never" } } },
  [REPO]: { overrides: { plan: { outsideRepoPlans: "always" } } },
});

test("the picker lists Defaults, the effective view, each scope and Add override", async ($, on) => {
  world(on, SCOPED);
  const ui = await mountOn($, "terminal");
  const picker = await ui.find({ key: "scope" });
  expect(picker?.props.value).toBe(":defaults");
  expect(picker?.props.options).toEqual([
    { value: ":defaults", label: "Defaults" },
    { value: ":effective", label: "Effective for this repo" },
    { value: "~/w/*" },
    { value: REPO },
    { value: ":add", label: "Add override…" },
  ]);
  expect((await ui.find({ key: "orchestrate.deletePlan" }))?.props.value).toBe("always");
  await ui.unmount();
});

test("a scope view starts at Inherit with the inherited value and source", async ($, on) => {
  world(on, SCOPED);
  const ui = await mountOn($, "terminal");
  await ui.select({ key: "scope", value: REPO });

  const deletePlan = await ui.find({ key: "orchestrate.deletePlan" });
  expect(deletePlan?.props.value).toBe(":inherit");
  expect(deletePlan?.props.options).toEqual([
    { value: ":inherit", label: "Inherit: never (from ~/w/*)" },
    { value: "always" },
    { value: "never" },
    { value: "ask" },
  ]);
  expect((await ui.find({ key: "plan.outsideRepoPlans" }))?.props.value).toBe("always");
  expect(await ui.find({ type: "Text", text: "plan.outsideRepoPlans (overridden)" })).toBeDefined();
  expect(
    await ui.find({ type: "Text", text: "orchestrate.deletePlan (overridden)" }),
  ).toBeUndefined();

  await ui.select({ key: "scope", value: "~/w/*" });
  expect((await ui.find({ key: "orchestrate.deletePlan" }))?.props.value).toBe("never");
  expect((await ui.find({ key: "plan.outsideRepoPlans" }))?.props.options).toEqual([
    { value: ":inherit", label: "Inherit: ask (Default)" },
    { value: "always" },
    { value: "ask" },
  ]);
  await ui.unmount();
});

test("a scope inherits from other keys for the same scope, as if it did not set the value", async ($, on) => {
  world(
    on,
    JSON.stringify({
      [`${HOME}/w/*`]: { overrides: { orchestrate: { deletePlan: "never" } } },
      "~/w/*": { overrides: { orchestrate: { deletePlan: "always" } } },
      [`${REPO}/`]: { overrides: { plan: { outsideRepoPlans: "always" } } },
      [REPO]: { overrides: {} },
    }),
  );
  const ui = await mountOn($, "terminal");
  await ui.select({ key: "scope", value: "~/w/*" });
  expect((await ui.find({ key: "orchestrate.deletePlan" }))?.props.options).toContainEqual({
    value: ":inherit",
    label: `Inherit: never (from ${HOME}/w/*)`,
  });

  await ui.select({ key: "scope", value: REPO });
  expect((await ui.find({ key: "orchestrate.deletePlan" }))?.props.options).toContainEqual({
    value: ":inherit",
    label: "Inherit: always (from ~/w/*)",
  });
  expect((await ui.find({ key: "plan.outsideRepoPlans" }))?.props.options).toContainEqual({
    value: ":inherit",
    label: `Inherit: always (from ${REPO}/)`,
  });
  await ui.unmount();
});

test("a scoped write keeps other keys and scopes, and Inherit removes an emptied scope", async ($, on) => {
  const w = world(on, SCOPED);
  const ui = await mountOn($, "terminal");
  await ui.select({ key: "scope", value: REPO });
  await ui.select({ key: "orchestrate.deletePlan", value: "always" });

  expect(JSON.parse(w.files.get(SETTINGS)!)).toEqual({
    ...JSON.parse(SCOPED),
    [REPO]: {
      overrides: { plan: { outsideRepoPlans: "always" }, orchestrate: { deletePlan: "always" } },
    },
  });
  expect((await ui.find({ key: "orchestrate.deletePlan" }))?.props.value).toBe("always");

  await ui.select({ key: "orchestrate.deletePlan", value: ":inherit" });
  await ui.select({ key: "plan.outsideRepoPlans", value: ":inherit" });
  const { [REPO]: _, ...rest } = JSON.parse(SCOPED);
  expect(JSON.parse(w.files.get(SETTINGS)!)).toEqual(rest);
  expect(gitRuns(w, "commit").map((argv) => argv[6])).toEqual([
    `Set orchestrate.deletePlan to always for ${REPO}`,
    `Clear orchestrate.deletePlan for ${REPO}`,
    `Clear plan.outsideRepoPlans for ${REPO}`,
  ]);
  const picker = await ui.find({ key: "scope" });
  expect(picker?.props.value).toBe(REPO);
  expect(picker?.props.options).toContainEqual({ value: REPO, label: `${REPO} (new)` });
  await ui.unmount();
});

test("a scope stores the Default as an override", async ($, on) => {
  const w = world(on, SCOPED);
  const ui = await mountOn($, "terminal");
  await ui.select({ key: "scope", value: "~/w/*" });
  await ui.select({ key: "orchestrate.deletePlan", value: "ask" });

  expect(JSON.parse(w.files.get(SETTINGS)!)["~/w/*"]).toEqual({
    overrides: { orchestrate: { deletePlan: "ask" } },
  });
  expect((await ui.find({ key: "orchestrate.deletePlan" }))?.props.value).toBe("ask");
  await ui.unmount();
});

test("adding a scope refuses a relative path and keeps a new one in the pane", async ($, on) => {
  const w = world(on);
  const ui = await mountOn($, "terminal");
  await ui.select({ key: "scope", value: ":add" });
  await ui.input({ key: "scopePath", text: "work/*" });

  expect(
    await ui.find({ type: "Text", text: /^A scope path starts with \/, ~\/, a drive/ }),
  ).toBeDefined();
  expect((await ui.find({ key: "scope" }))?.props.value).toBe(":add");

  await ui.input({ key: "scopePath", text: "~/work/*/" });
  const picker = await ui.find({ key: "scope" });
  expect(picker?.props.value).toBe("~/work/*");
  expect(picker?.props.options).toContainEqual({ value: "~/work/*", label: "~/work/* (new)" });
  expect(await ui.find({ type: "Text", text: /A new scope is saved/ })).toBeDefined();
  expect(w.files.has(SETTINGS)).toBe(false);

  await ui.select({ key: "orchestrate.deletePlan", value: "never" });
  expect(JSON.parse(w.files.get(SETTINGS)!)).toEqual({
    "~/work/*": { overrides: { orchestrate: { deletePlan: "never" } } },
  });
  expect((await ui.find({ key: "scope" }))?.props.options).toContainEqual({ value: "~/work/*" });
  await ui.unmount();
});

test("adding a scope refuses a path that normalises to a scope it has", async ($, on) => {
  world(on, SCOPED);
  const ui = await mountOn($, "terminal");
  await ui.select({ key: "scope", value: ":add" });
  await ui.input({ key: "scopePath", text: "~/w/repo/" });

  expect(
    await ui.find({ type: "Text", text: `~/w/repo is the same scope as ${REPO}.` }),
  ).toBeDefined();
  expect((await ui.find({ key: "scope" }))?.props.value).toBe(":add");
  await ui.unmount();
});

test("adding a scope warns for a linked worktree or a path below the top level", async ($, on) => {
  const w = world(on);
  w.tops = { "/r/wt": "/r/wt", "/r/main/sub": "/r/main", "/r/main": "/r/main" };
  w.worktrees = {
    "/r/wt": "worktree /r/main\nHEAD c0\n\nworktree /r/wt\nHEAD c1\n",
  };
  const ui = await mountOn($, "terminal");
  await ui.select({ key: "scope", value: ":add" });
  await ui.input({ key: "scopePath", text: "/r/wt" });
  expect(
    await ui.find({
      type: "Text",
      text: "/r/wt is a linked worktree. Skills there use the settings for /r/main.",
    }),
  ).toBeDefined();

  await ui.select({ key: "scope", value: ":add" });
  await ui.input({ key: "scopePath", text: "/r/main/sub" });
  expect(
    await ui.find({ type: "Text", text: /^\/r\/main\/sub is not a repo's top level\./ }),
  ).toBeDefined();

  await ui.select({ key: "scope", value: ":add" });
  await ui.input({ key: "scopePath", text: "/r/main" });
  expect((await ui.find({ key: "scope" }))?.props.value).toBe("/r/main");
  expect(await ui.find({ type: "Text", text: /linked worktree|top level/ })).toBeUndefined();
  await ui.unmount();
});

const SHOWN_WHEN = `# Shared rules

## Settings

| Key                         | Values           | Default     | Shown when                       | What it does       |
| --------------------------- | ---------------- | ----------- | -------------------------------- | ------------------ |
| \`plan.manualChecksQuestion\` | \`finish\`         | orchestrate | \`orchestrate.manualChecks = ask\` | Asks at Finish.    |
| \`orchestrate.manualChecks\`  | \`pause\`, \`defer\` | ask         |                                  | Handles the checks. |
`;

test("the effective view resolves the session's repo and shows each value's scope", async ($, on) => {
  const w = world(
    on,
    JSON.stringify({
      plan: { manualChecksQuestion: "finish" },
      "~/w/*": { overrides: { orchestrate: { manualChecks: "defer" } } },
    }),
    SHOWN_WHEN,
  );
  w.cwd = `${HOME}/w/repo-wt/sub`;
  w.tops = { [w.cwd]: `${HOME}/w/repo-wt`, "/elsewhere": "/elsewhere" };
  w.worktrees = {
    [`${HOME}/w/repo-wt`]: `worktree ${REPO}\nHEAD c0\n\nworktree ${HOME}/w/repo-wt\nHEAD c1\n`,
  };
  const ui = await mountOn($, "terminal");
  await ui.select({ key: "scope", value: ":effective" });

  expect(await ui.find({ type: "Text", text: `Effective for ${REPO}` })).toBeDefined();
  expect(
    await ui.find({ type: "Text", text: "orchestrate.manualChecks: defer (from ~/w/*)" }),
  ).toBeDefined();
  expect(await ui.find({ type: "Text", text: /^plan\.manualChecksQuestion/ })).toBeUndefined();

  await ui.input({ key: "effectivePath", text: "/elsewhere" });
  expect(await ui.find({ type: "Text", text: "Effective for /elsewhere" })).toBeDefined();
  expect(
    await ui.find({ type: "Text", text: "orchestrate.manualChecks: ask (Default)" }),
  ).toBeDefined();
  expect(
    await ui.find({ type: "Text", text: "plan.manualChecksQuestion: finish (from Defaults)" }),
  ).toBeDefined();
  await ui.unmount();
});

test("a dependent setting stays editable with a note in the Defaults and scope views", async ($, on) => {
  world(
    on,
    JSON.stringify({ "~/w/*": { overrides: { orchestrate: { manualChecks: "defer" } } } }),
    SHOWN_WHEN,
  );
  const ui = await mountOn($, "terminal");
  const note =
    /Asks at Finish\. Default: orchestrate\. Applies when orchestrate\.manualChecks is ask\./;
  expect(await ui.find({ type: "Text", text: note })).toBeDefined();
  expect(await ui.find({ key: "plan.manualChecksQuestion" })).toBeDefined();

  await ui.select({ key: "scope", value: "~/w/*" });
  expect(await ui.find({ type: "Text", text: note })).toBeDefined();
  expect(await ui.find({ key: "plan.manualChecksQuestion" })).toBeDefined();
  await ui.unmount();
});

test("the text list gives the defaults, then each scope's overrides", async ($, on) => {
  const w = world(
    on,
    JSON.stringify({
      orchestrate: { deletePlan: "always" },
      "~/w/*": { overrides: { orchestrate: { deletePlan: "bogus" }, plan: { other: 1 } } },
      [REPO]: { overrides: {} },
    }),
  );
  w.placed = { isPlaced: false, reason: "no-surface: a -p run" };
  await $.session.start({ cwd: "/", surface: null, isInteractive: false });

  const ran = await $.command.run(RUN);
  expect(ran.text).toBe(
    [
      "Graft settings in ~/.my-graft/graft-settings.json",
      "plan.outsideRepoPlans: ask (always, ask)",
      "  Saves plans.",
      "orchestrate.deletePlan: always (always, never, ask)",
      "  Deletes the plan.",
      "Overrides for ~/w/*:",
      "  orchestrate.deletePlan: bogus (not allowed)",
      "  plan.other: 1 (not in the catalog)",
      `Overrides for ${REPO}:`,
      "  No overrides.",
    ].join("\n"),
  );
});

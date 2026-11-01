import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { Catalog } from "./settings-catalog.ts";
import {
  effectiveValues,
  explainLayers,
  inheritedLayers,
  mainWorktree,
  newScopeKey,
  parseSettingsFile,
  resolveSettings,
  withSetting,
} from "./settings-lib.ts";
import type { Environment, ExplainedSetting, SettingsFile } from "./settings-lib.ts";

const SCRIPT = fileURLToPath(new URL("./settings.ts", import.meta.url));
const HOME = "/home/me";

const CATALOG: Catalog = {
  isParsed: true,
  settings: [
    {
      key: "plan.questionsPerRound",
      skill: "plan",
      name: "questionsPerRound",
      values: ["1", "2", "4"],
      defaultValue: "3",
      description: "",
    },
    {
      key: "pr.state",
      skill: "pr",
      name: "state",
      values: ["ready"],
      defaultValue: "draft",
      description: "",
    },
  ],
};

function env({
  links = {},
  missing = [],
  roots = {},
}: {
  links?: Record<string, string>;
  missing?: string[];
  roots?: Record<string, string>;
} = {}): Environment {
  return {
    home: HOME,
    // Like realpath: each component is followed through links before `..` applies.
    resolve: async (path) => {
      let real = "";
      for (const part of path.split("/")) {
        if (part === "..") {
          real = real.slice(0, real.lastIndexOf("/"));
        } else if (part !== "" && part !== ".") {
          real = links[`${real}/${part}`] ?? `${real}/${part}`;
        }
      }
      real ||= "/";
      return missing.some((gone) => real === gone || real.startsWith(`${gone}/`))
        ? undefined
        : real;
    },
    normaliseRoot: async (path) => roots[path] ?? path,
  };
}

async function resolved(
  file: object | undefined,
  root: string,
  environment = env(),
): Promise<{ root: string; settings: ExplainedSetting[] }> {
  const text = file === undefined ? undefined : JSON.stringify(file);
  const result = await resolveSettings(text, CATALOG, root, environment);
  if (!result.isResolved) {
    throw new Error(result.error);
  }

  return result;
}

async function values(file: object | undefined, root: string, environment = env()) {
  return effectiveValues((await resolved(file, root, environment)).settings);
}

async function sources(file: object | undefined, root: string, environment = env()) {
  return Object.fromEntries(
    (await resolved(file, root, environment)).settings.map(({ key, value, source }) => [
      key,
      `${value} from ${source}`,
    ]),
  );
}

describe("parseSettingsFile", () => {
  it("reads today's file as defaults", () => {
    expect(parseSettingsFile('{"plan": {"questionsPerRound": "2"}}')).toEqual({
      isParsed: true,
      file: { defaults: { plan: { questionsPerRound: "2" } }, scopes: [] },
    });
  });

  it("reads scope keys apart from skill keys", () => {
    expect(
      parseSettingsFile(
        JSON.stringify({
          "~/work/*": { overrides: { pr: { state: "ready" } } },
          "/oss/graft": { overrides: {} },
        }),
      ),
    ).toEqual({
      isParsed: true,
      file: {
        defaults: {},
        scopes: [
          { key: "~/work/*", overrides: { pr: { state: "ready" } } },
          { key: "/oss/graft", overrides: {} },
        ],
      },
    });
  });

  it("reads a missing file as no settings", () => {
    expect(parseSettingsFile(undefined)).toEqual({
      isParsed: true,
      file: { defaults: {}, scopes: [] },
    });
  });

  it.each([
    ["malformed JSON", "{"],
    ["a non-object file", "[]"],
    ["a non-object skill entry", '{"plan": "2"}'],
    ["a non-object scope", '{"/a": []}'],
    ["non-object overrides", '{"/a": {"overrides": "x"}}'],
    ["null overrides", '{"/a": {"overrides": null}}'],
    ["a non-object skill entry in overrides", '{"/a": {"overrides": {"plan": 2}}}'],
  ])("refuses %s", (_, text) => {
    expect(parseSettingsFile(text)).toMatchObject({ isParsed: false });
  });
});

describe("resolveSettings", () => {
  it("gives every setting its Default for a missing file", async () => {
    expect(await sources(undefined, "/r")).toEqual({
      "plan.questionsPerRound": "3 from Default",
      "pr.state": "draft from Default",
    });
  });

  it("applies today's defaults", async () => {
    expect(await sources({ plan: { questionsPerRound: "2" } }, "/r")).toEqual({
      "plan.questionsPerRound": "2 from Defaults",
      "pr.state": "draft from Default",
    });
  });

  it("applies a file with only scope keys", async () => {
    const file = { "/r": { overrides: { pr: { state: "ready" } } } };
    expect(await values(file, "/r")).toEqual({
      plan: { questionsPerRound: "3" },
      pr: { state: "ready" },
    });
    expect(await values(file, "/other")).toEqual({
      plan: { questionsPerRound: "3" },
      pr: { state: "draft" },
    });
  });

  it("puts an exact path over a /* scope, whatever the file order", async () => {
    const file = {
      "/w/repo": { overrides: { plan: { questionsPerRound: "4" } } },
      "/w/*": { overrides: { plan: { questionsPerRound: "1" }, pr: { state: "ready" } } },
    };
    expect(await sources(file, "/w/repo")).toEqual({
      "plan.questionsPerRound": "4 from /w/repo",
      "pr.state": "ready from /w/*",
    });
  });

  it("puts the deepest /* scope last, mixing ~ and absolute keys", async () => {
    const file = {
      [`${HOME}/work/team/*`]: { overrides: { plan: { questionsPerRound: "4" } } },
      "~/work/*": { overrides: { plan: { questionsPerRound: "1" }, pr: { state: "ready" } } },
      "/*": { overrides: { plan: { questionsPerRound: "2" } } },
    };
    expect(await sources(file, `${HOME}/work/team/deep/repo`)).toEqual({
      "plan.questionsPerRound": `4 from ${HOME}/work/team/*`,
      "pr.state": "ready from ~/work/*",
    });
    expect(await sources(file, `${HOME}/work/repo`)).toEqual({
      "plan.questionsPerRound": "1 from ~/work/*",
      "pr.state": "ready from ~/work/*",
    });
  });

  it("does not match path/* to path itself", async () => {
    const file = { "/w/*": { overrides: { pr: { state: "ready" } } } };
    expect(await values(file, "/w")).toMatchObject({ pr: { state: "draft" } });
    expect(await values(file, "/wx/repo")).toMatchObject({ pr: { state: "draft" } });
    expect(await values(file, "/w/repo")).toMatchObject({ pr: { state: "ready" } });
  });

  it("compares keys and the root after expanding ~ and resolving symlinks", async () => {
    const file = {
      "~/link/*": { overrides: { pr: { state: "ready" } } },
      "/alias/repo/": { overrides: { plan: { questionsPerRound: "4" } } },
    };
    const environment = env({
      links: { [`${HOME}/link`]: "/real/work", "/alias/repo": "/real/work/repo" },
    });
    expect(await resolved(file, "/real/work/repo", environment)).toMatchObject({
      root: "/real/work/repo",
    });
    expect(await sources(file, "/real/work/repo", environment)).toEqual({
      "plan.questionsPerRound": "4 from /alias/repo/",
      "pr.state": "ready from ~/link/*",
    });
    expect(await values(file, "~/link/repo", environment)).toMatchObject({
      pr: { state: "ready" },
    });
  });

  it("follows a symlink before applying ..", async () => {
    const file = {
      "/real/repo": { overrides: { pr: { state: "ready" } } },
      "/work/link/../other": { overrides: { plan: { questionsPerRound: "1" } } },
    };
    const environment = env({ links: { "/work/link": "/real/team" } });
    expect(await resolved(file, "/work/link/../repo", environment)).toMatchObject({
      root: "/real/repo",
    });
    expect(await values(file, "/work/link/../repo", environment)).toMatchObject({
      pr: { state: "ready" },
    });
    expect(await values(file, "/real/other", environment)).toMatchObject({
      plan: { questionsPerRound: "1" },
    });
  });

  it("normalises a path that does not exist lexically", async () => {
    const file = { "/gone/x/../repo/": { overrides: { pr: { state: "ready" } } } };
    const environment = env({ missing: ["/gone"] });
    expect(await values(file, "/gone/./repo", environment)).toMatchObject({
      pr: { state: "ready" },
    });
  });

  it("compares a key whose path does not exist unresolved", async () => {
    const file = {
      "/gone/*": { overrides: { pr: { state: "ready" } } },
      "/elsewhere/repo": { overrides: { plan: { questionsPerRound: "1" } } },
    };
    const environment = env({ missing: ["/gone", "/elsewhere/repo"] });
    expect(await values(file, "/gone/repo", environment)).toEqual({
      plan: { questionsPerRound: "3" },
      pr: { state: "ready" },
    });
    expect(await values(file, "/real", environment)).toEqual({
      plan: { questionsPerRound: "3" },
      pr: { state: "draft" },
    });
  });

  it.each([
    ["a subdirectory", "/w/repo/src/lib", "/w/repo"],
    ["a linked worktree", "/w/repo-feature", "/w/repo"],
    ["a bare layout's worktree", "/w/bare/feature", "/w/bare/feature"],
    ["a non-git path", "/w/notes", "/w/notes"],
  ])("resolves against the root normaliseRoot gives for %s", async (_, root, expected) => {
    const environment = env({
      roots: { "/w/repo/src/lib": "/w/repo", "/w/repo-feature": "/w/repo" },
    });
    const file = {
      "/w/repo": { overrides: { pr: { state: "ready" } } },
      "/w/bare/feature": { overrides: { pr: { state: "ready" } } },
      "/w/notes": { overrides: { pr: { state: "ready" } } },
    };
    expect(await resolved(file, root, environment)).toMatchObject({ root: expected });
    expect(await values(file, root, environment)).toMatchObject({ pr: { state: "ready" } });
  });

  it("lets an invalid override fall through to the inherited value", async () => {
    const file = {
      plan: { questionsPerRound: "2" },
      "/w/*": { overrides: { plan: { questionsPerRound: "4" } } },
      "/w/repo": { overrides: { plan: { questionsPerRound: "9" }, pr: { state: 1 } } },
    };
    expect(await sources(file, "/w/repo")).toEqual({
      "plan.questionsPerRound": "4 from /w/*",
      "pr.state": "draft from Default",
    });
    expect(await sources({ plan: { questionsPerRound: "9" } }, "/r")).toMatchObject({
      "plan.questionsPerRound": "3 from Default",
    });
  });

  it("applies a stored Default as an override", async () => {
    const file = {
      pr: { state: "ready" },
      "/w/repo": { overrides: { pr: { state: "draft" } } },
    };
    expect(await sources(file, "/w/repo")).toMatchObject({ "pr.state": "draft from /w/repo" });
  });

  it("merges keys that normalise to the same scope in file order", async () => {
    const file = {
      "~/w/repo": { overrides: { plan: { questionsPerRound: "1" }, pr: { state: "ready" } } },
      [`${HOME}/w/repo/`]: { overrides: { plan: { questionsPerRound: "4" } } },
      "~/w/*": { overrides: { plan: { questionsPerRound: "2" } } },
      [`${HOME}/w/./*`]: { overrides: { plan: { questionsPerRound: "1" } } },
    };
    expect(await sources(file, `${HOME}/w/repo`)).toEqual({
      "plan.questionsPerRound": `4 from ${HOME}/w/repo/`,
      "pr.state": "ready from ~/w/repo",
    });
    expect(await sources(file, `${HOME}/w/other`)).toMatchObject({
      "plan.questionsPerRound": `1 from ${HOME}/w/./*`,
    });
  });

  describe("inheritedLayers", () => {
    const file = (
      parseSettingsFile(
        JSON.stringify({
          "/*": { overrides: {} },
          [`${HOME}/w/*`]: { overrides: {} },
          "~/w/*": { overrides: {} },
          "~/w/./*": { overrides: {} },
          "~/w/repo/*": { overrides: {} },
          "~/w/repo": { overrides: {} },
          [`${HOME}/w/repo/`]: { overrides: {} },
          "/other": { overrides: {} },
        }),
      ) as { file: SettingsFile }
    ).file;
    const inherited = async (key: string) =>
      (await inheritedLayers(file, key, env())).map(({ source }) => source);

    it("gives a /* scope the /* scopes at or above its path, in file order, without itself", async () => {
      expect(await inherited("~/w/*")).toEqual(["Defaults", "/*", `${HOME}/w/*`, "~/w/./*"]);
      expect(await inherited("~/w/repo/*")).toEqual([
        "Defaults",
        "/*",
        `${HOME}/w/*`,
        "~/w/*",
        "~/w/./*",
      ]);
    });

    it("gives an exact scope the /* scopes above it and the other exact keys for its path", async () => {
      expect(await inherited("~/w/repo")).toEqual([
        "Defaults",
        "/*",
        `${HOME}/w/*`,
        "~/w/*",
        "~/w/./*",
        `${HOME}/w/repo/`,
      ]);
    });

    it("resolves a scope's setting as if the scope did not set it", async () => {
      const values = parseSettingsFile(
        JSON.stringify({
          [`${HOME}/w/*`]: { overrides: { pr: { state: "ready" } } },
          "~/w/*": { overrides: {} },
        }),
      ) as { file: SettingsFile };
      const settings = CATALOG.isParsed ? CATALOG.settings : [];
      expect(
        explainLayers(await inheritedLayers(values.file, "~/w/*", env()), settings)[1],
      ).toMatchObject({ value: "ready", source: `${HOME}/w/*` });
    });
  });

  it("refuses a catalog that does not parse", async () => {
    expect(
      await resolveSettings(undefined, { isParsed: false, error: "bad" }, "/r", env()),
    ).toEqual({ isResolved: false, error: "the settings catalog does not parse: bad" });
  });
});

describe("mainWorktree", () => {
  it("gives the first worktree, or none when it is bare", () => {
    const linked =
      "worktree /r/main\nHEAD abc\nbranch refs/heads/main\n\nworktree /r/wt\nHEAD def\n";
    expect(mainWorktree(linked)).toBe("/r/main");
    expect(mainWorktree("worktree /r/bare.git\nbare\n\nworktree /r/wt\nHEAD def\n")).toBe(
      undefined,
    );
    expect(mainWorktree("")).toBe(undefined);
  });
});

describe("withSetting", () => {
  const file = {
    plan: { questionsPerRound: "2", other: 1 },
    extra: { kept: true },
    "~/w/*": { overrides: { pr: { state: "ready" } }, note: "kept" },
    "/w/repo": { overrides: { plan: { questionsPerRound: "4" } } },
  };

  it("sets and clears a default, dropping an emptied skill", () => {
    const set = withSetting(file, undefined, "pr", "state", "ready");
    expect(set).toEqual({ isEdited: true, json: { ...file, pr: { state: "ready" } } });
    const cleared = withSetting(file, undefined, "plan", "questionsPerRound", undefined);
    expect(cleared).toEqual({ isEdited: true, json: { ...file, plan: { other: 1 } } });
    expect(withSetting({ pr: { state: "ready" } }, undefined, "pr", "state", undefined)).toEqual({
      isEdited: true,
      json: {},
    });
  });

  it("sets an override at a scope, keeping the scope's other keys", () => {
    expect(withSetting(file, "~/w/*", "plan", "questionsPerRound", "1")).toEqual({
      isEdited: true,
      json: {
        ...file,
        "~/w/*": {
          overrides: { pr: { state: "ready" }, plan: { questionsPerRound: "1" } },
          note: "kept",
        },
      },
    });
  });

  it("stores a Default as an override", () => {
    expect(withSetting(file, "/w/repo", "pr", "state", "draft")).toMatchObject({
      json: {
        "/w/repo": { overrides: { plan: { questionsPerRound: "4" }, pr: { state: "draft" } } },
      },
    });
  });

  it("adds a scope with its first override, after the other keys", () => {
    const edited = withSetting(file, "/new", "pr", "state", "ready");
    expect(edited).toEqual({
      isEdited: true,
      json: { ...file, "/new": { overrides: { pr: { state: "ready" } } } },
    });
    expect(Object.keys((edited as { json: object }).json).at(-1)).toBe("/new");
  });

  it("removes an override on Inherit, and a scope left with no overrides", () => {
    const { "/w/repo": _, ...rest } = file;
    expect(withSetting(file, "/w/repo", "plan", "questionsPerRound", undefined)).toEqual({
      isEdited: true,
      json: rest,
    });
    expect(withSetting(file, "~/w/*", "pr", "state", undefined)).toEqual({
      isEdited: true,
      json: { ...file, "~/w/*": { note: "kept" } },
    });
  });

  it("leaves a file alone when Inherit names nothing stored", () => {
    expect(withSetting(file, "/none", "pr", "state", undefined)).toEqual({
      isEdited: true,
      json: file,
    });
  });

  it.each([
    ["a non-object skill", { plan: 2 }, undefined],
    ["a non-object scope", { "/a": [] }, "/a"],
    ["non-object overrides", { "/a": { overrides: "x" } }, "/a"],
    ["a non-object skill in overrides", { "/a": { overrides: { plan: 2 } } }, "/a"],
  ])("refuses %s", (_, json, scope) => {
    expect(withSetting(json, scope, "plan", "questionsPerRound", "1")).toMatchObject({
      isEdited: false,
    });
  });
});

describe("newScopeKey", () => {
  it.each(["work/*", "~", "~work", "", " "])(
    "refuses %j, which does not start with / or ~/",
    async (input) => {
      expect(await newScopeKey(input, [], env())).toEqual({
        isValid: false,
        error: "A scope path starts with / or ~/.",
      });
    },
  );

  it.each([
    ["/w/repo/", "/w/repo"],
    ["~/w/*/", "~/w/*"],
    [" ~/w/repo ", "~/w/repo"],
    ["/", "/"],
  ])("takes %j as %j", async (input, key) => {
    expect(await newScopeKey(input, [], env())).toEqual({ isValid: true, key });
  });

  it("refuses a path that normalises to a scope it has", async () => {
    const environment = env({ links: { "/l": `${HOME}/w` } });
    expect(await newScopeKey("/l/repo/", ["~/w/repo"], environment)).toEqual({
      isValid: false,
      error: "/l/repo is the same scope as ~/w/repo.",
    });
    expect(await newScopeKey(`${HOME}/w/*`, ["~/w/*"], environment)).toMatchObject({
      isValid: false,
    });
    expect(await newScopeKey("~/w/*", ["~/w"], environment)).toEqual({
      isValid: true,
      key: "~/w/*",
    });
  });
});

describe("settings.ts", () => {
  const tempDirs: string[] = [];

  function tempDir(): string {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "graft-settings-test-")));
    tempDirs.push(dir);
    return dir;
  }

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function run(
    args: string[],
    settings?: string,
    {
      script = SCRIPT,
      home = tempDir(),
      cwd,
    }: { script?: string; home?: string; cwd?: string } = {},
  ) {
    if (settings !== undefined) {
      mkdirSync(join(home, ".my-graft"), { recursive: true });
      writeFileSync(join(home, ".my-graft", "graft-settings.json"), settings);
    }
    return spawnSync(process.execPath, [script, ...args], {
      cwd,
      encoding: "utf8",
      env: { ...process.env, HOME: home },
    });
  }

  function git(cwd: string, ...args: string[]) {
    execFileSync("git", ["-C", cwd, ...args], {
      stdio: "ignore",
      env: {
        ...process.env,
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_AUTHOR_NAME: "t",
        GIT_AUTHOR_EMAIL: "t@t",
        GIT_COMMITTER_NAME: "t",
        GIT_COMMITTER_EMAIL: "t@t",
      },
    });
  }

  it("prints the effective settings, with a Default for every setting", () => {
    const root = tempDir();
    const result = run(
      [root],
      JSON.stringify({ [root]: { overrides: { pr: { state: "ready" } } } }),
    );
    expect(result.status).toBe(0);
    const output = JSON.parse(result.stdout);
    expect(output).toMatchObject({
      pr: { state: "ready" },
      plan: { questionsPerRound: "3" },
      common: { reviewerModel: "opus" },
    });
  });

  it("prints each setting's source with --explain", () => {
    const root = tempDir();
    const result = run(
      [root, "--explain"],
      JSON.stringify({
        plan: { questionsPerRound: "2" },
        "~/../*": { overrides: { pr: { state: "ready" } } },
      }),
    );
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      plan: { questionsPerRound: { value: "2", source: "Defaults" } },
      pr: { state: { value: "ready", source: "~/../*" } },
      common: { reviewerModel: { value: "opus", source: "Default" } },
    });
  });

  it("treats a missing file as no settings", () => {
    const result = run([tempDir()]);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ pr: { state: "draft" } });
  });

  it("normalises the root through git", () => {
    const base = tempDir();
    const repo = join(base, "repo");
    mkdirSync(join(repo, "src"), { recursive: true });
    git(base, "init", "-q", "repo");
    git(repo, "commit", "-q", "--allow-empty", "-m", "init");
    git(repo, "worktree", "add", "-q", join(base, "linked"));
    git(base, "init", "-q", "--bare", "bare.git");
    git(join(base, "bare.git"), "worktree", "add", "-q", "--orphan", join(base, "bare-tree"));
    mkdirSync(join(base, "plain"));
    const settings = JSON.stringify({
      [repo]: { overrides: { pr: { state: "ready" } } },
      [join(base, "bare-tree")]: { overrides: { plan: { questionsPerRound: "4" } } },
      [join(base, "plain")]: { overrides: { plan: { questionsPerRound: "1" } } },
    });
    for (const path of [join(repo, "src"), join(base, "linked")]) {
      expect(JSON.parse(run([path], settings).stdout), path).toMatchObject({
        pr: { state: "ready" },
      });
    }
    expect(JSON.parse(run([join(base, "bare-tree")], settings).stdout)).toMatchObject({
      plan: { questionsPerRound: "4" },
    });
    expect(JSON.parse(run([join(base, "plain")], settings).stdout)).toMatchObject({
      plan: { questionsPerRound: "1" },
    });
  });

  it("expands a ~ root", () => {
    const home = tempDir();
    mkdirSync(join(home, "work", "repo"), { recursive: true });
    const settings = JSON.stringify({
      "~": { overrides: { plan: { questionsPerRound: "1" } } },
      "~/work/repo": { overrides: { pr: { state: "ready" } } },
    });
    expect(JSON.parse(run(["~/work/repo"], settings, { home }).stdout)).toMatchObject({
      plan: { questionsPerRound: "3" },
      pr: { state: "ready" },
    });
    expect(JSON.parse(run(["~"], settings, { home }).stdout)).toMatchObject({
      plan: { questionsPerRound: "1" },
      pr: { state: "draft" },
    });
  });

  it("follows a symlink in the root before applying ..", () => {
    const base = tempDir();
    mkdirSync(join(base, "real", "team"), { recursive: true });
    mkdirSync(join(base, "real", "repo"));
    mkdirSync(join(base, "work"));
    symlinkSync(join(base, "real", "team"), join(base, "work", "link"));
    const settings = JSON.stringify({
      [join(base, "real", "repo")]: { overrides: { pr: { state: "ready" } } },
    });
    for (const [root, cwd] of [
      [`${base}/work/link/../repo`, undefined],
      ["link/../repo", join(base, "work")],
    ]) {
      const result = run([root as string], settings, { cwd });
      expect(result.status, root).toBe(0);
      expect(JSON.parse(result.stdout), root).toMatchObject({ pr: { state: "ready" } });
    }
  });

  it.each([
    ["malformed JSON", "{", "graft-settings.json does not parse"],
    ["a non-object scope", '{"/a": 1}', 'the scope "/a" is not an object'],
    ["non-object overrides", '{"/a": {"overrides": []}}', 'the overrides of "/a"'],
    ["a non-object skill entry", '{"plan": "2"}', 'the skill "plan" is not an object'],
  ])("exits 1 with the reason on %s", (_, settings, reason) => {
    const result = run([tempDir()], settings);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(reason);
    expect(result.stdout).toBe("");
  });

  it("exits 1 when the catalog does not parse", () => {
    const dir = tempDir();
    for (const name of ["settings.ts", "settings-lib.ts", "settings-catalog.ts"]) {
      copyFileSync(fileURLToPath(new URL(`./${name}`, import.meta.url)), join(dir, name));
    }
    writeFileSync(join(dir, "package.json"), '{"type": "module"}');
    writeFileSync(join(dir, "common.md"), "# Rules\n");
    const result = run([dir], undefined, { script: join(dir, "settings.ts") });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("the settings catalog does not parse");
  });

  it("exits 1 with the usage line without a root", () => {
    const result = run([]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Usage: node settings.ts <root> [--explain]");
  });
});

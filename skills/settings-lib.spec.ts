import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { Catalog } from "./settings-catalog.ts";
import { effectiveValues, layersFor, parseSettingsFile, resolveSettings } from "./settings-lib.ts";
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
    resolve: async (path) => {
      if (missing.includes(path)) {
        return undefined;
      }
      const link = Object.keys(links).find((from) => path === from || path.startsWith(`${from}/`));
      return link === undefined ? path : `${links[link]}${path.slice(link.length)}`;
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

  it("gives the layers a scope inherits without exact scopes", async () => {
    const parsed = parseSettingsFile(
      JSON.stringify({
        "/w/*": { overrides: {} },
        "/w/repo": { overrides: {} },
      }),
    );
    const file = (parsed as { file: SettingsFile }).file;
    const layers = await layersFor(file, "/w/repo", env(), { isExactIncluded: false });
    expect(layers.map(({ source }) => source)).toEqual(["Defaults", "/w/*"]);
  });

  it("refuses a catalog that does not parse", async () => {
    expect(
      await resolveSettings(undefined, { isParsed: false, error: "bad" }, "/r", env()),
    ).toEqual({ isResolved: false, error: "the settings catalog does not parse: bad" });
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

  function run(args: string[], settings?: string, script = SCRIPT) {
    const home = tempDir();
    if (settings !== undefined) {
      mkdirSync(join(home, ".my-graft"));
      writeFileSync(join(home, ".my-graft", "graft-settings.json"), settings);
    }
    return spawnSync(process.execPath, [script, ...args], {
      encoding: "utf8",
      env: { ...process.env, HOME: home },
    });
  }

  function git(cwd: string, ...args: string[]) {
    execFileSync("git", ["-C", cwd, ...args], {
      stdio: "ignore",
      env: {
        ...process.env,
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
    const result = run([dir], undefined, join(dir, "settings.ts"));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("the settings catalog does not parse");
  });

  it("exits 1 with the usage line without a root", () => {
    const result = run([]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Usage: node settings.ts <root> [--explain]");
  });
});

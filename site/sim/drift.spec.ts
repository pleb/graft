// Checks that the scenarios still name what the skills name: skills, agents, settings, fixed
// question labels, Graft paths and footers, git and gh commands, `node ${CLAUDE_SKILL_DIR}` script
// commands, and hand-off commands. The checks catch renamed or removed names, labels and commands, not
// changed order, conditions or defaults, and not other commands or what a script prints.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseCatalog } from "../../skills/settings-catalog.ts";
import { loadScenarios } from "./build-lib.ts";
import type { Event, Scenario } from "./events.ts";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const COMMON = readFileSync(join(ROOT, "skills", "common.md"), "utf8");

// The skill each scenario depicts.
const OWNER: Record<string, string> = {
  research: "research",
  plan: "plan",
  orchestrate: "orchestrate",
  pr: "pr",
  execute: "execute",
  yolo: "yolo",
  review: "review",
};

// Skills whose SKILL.md a skill reads and follows: yolo's run of execute, execute's Plan phase and
// Orchestrate phase, and orchestrate's Raise a PR worker.
const FOLLOWS: Record<string, string[]> = {
  yolo: ["execute"],
  execute: ["plan", "orchestrate"],
  orchestrate: ["pr"],
};

// Hand-offs the owning skill does not name. Orchestrate's Report names no next step; the README's
// flow (docs/flow.svg) has /graft:pr push orchestrate's branch and open the PR.
const UNTOLD_HANDOFFS: Record<string, string[]> = { orchestrate: ["/graft:pr"] };

const { scenarios } = await loadScenarios(join(ROOT, "site", "sim", "scenarios"));

function skillText(skill: string): string {
  return readFileSync(join(ROOT, "skills", skill, "SKILL.md"), "utf8");
}

function followed(skill: string): string[] {
  const seen = [skill];
  for (let i = 0; i < seen.length; i++) {
    for (const next of FOLLOWS[seen[i]!] ?? []) if (!seen.includes(next)) seen.push(next);
  }
  return seen;
}

// The owning skill and every skill it follows.
function skillsText(scenario: Scenario): string {
  return followed(OWNER[scenario.id]!).map(skillText).join("\n");
}

// common.md's sections whose `## Heading` the given skill text names.
function delegatedSections(text: string): string {
  return COMMON.split(/^(?=## )/m)
    .filter((section) => {
      const heading = section.split("\n", 1)[0]!;
      return heading.startsWith("## ") && text.includes(`\`${heading}\``);
    })
    .join("\n");
}

function mentions(text: string, name: string): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`${escaped}(?![\\w-])`).test(text);
}

function eventsOf<T extends Event["type"]>(
  scenario: Scenario,
  type: T,
): Extract<Event, { type: T }>[] {
  return scenario.events.filter(
    (event): event is Extract<Event, { type: T }> => event.type === type,
  );
}

function tokens(command: string): string[] {
  return [...command.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map(
    (match) => match[1] ?? match[2] ?? match[3]!,
  );
}

const PLACEHOLDER = "<>";

const CHECKED_COMMAND = /^(git\s|gh\s|node \$\{CLAUDE_SKILL_DIR\}\/)/;

// Checked commands in a skill's code spans and fenced lines, tokenised, with each `<placeholder>`
// and `${CLAUDE_SKILL_DIR}` turned into a wildcard.
function skillCommands(markdown: string): string[][] {
  const found: string[] = [];
  let fenced = false;
  for (const line of markdown.split("\n")) {
    if (line.trimStart().startsWith("```")) {
      fenced = !fenced;
    } else if (fenced) {
      found.push(line.trim());
    } else {
      for (const match of line.matchAll(/`([^`]+)`/g)) found.push(match[1]!);
    }
  }
  return found
    .filter((command) => CHECKED_COMMAND.test(command))
    .map((command) =>
      tokens(
        command.replace(/<[^<>]*>/g, PLACEHOLDER).replaceAll("${CLAUDE_SKILL_DIR}", PLACEHOLDER),
      ),
    );
}

// A scenario command matches when it has the same number of words and each word equals the skill's,
// with each wildcard standing for one or more characters.
function matchesCommand(command: string[], skill: string[]): boolean {
  return (
    command.length === skill.length &&
    skill.every((word, i) => {
      const pattern = word
        .split(PLACEHOLDER)
        .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        .join(".+");
      return new RegExp(`^${pattern}$`).test(command[i]!);
    })
  );
}

const PATHS = [".claude/graft/plans/", ".claude/graft/research/"];
const FOOTERS = ["Plan by Graft.", "Research by Graft."];

describe("scenario drift", () => {
  it("maps every scenario to a skill", () => {
    expect(scenarios.map((scenario) => scenario.id).filter((id) => !(id in OWNER))).toEqual([]);
  });

  describe.each(scenarios)("$id", (scenario) => {
    const owner = OWNER[scenario.id]!;
    const skills = skillsText(scenario);
    const withCommon = `${skills}\n${COMMON}`;

    it("names only skills that exist", () => {
      const named = [...JSON.stringify(scenario).matchAll(/\/graft:([a-z0-9-]+)/g)].map(
        (match) => match[1]!,
      );
      expect(
        [...new Set(named)].filter((skill) => !existsSync(join(ROOT, "skills", skill, "SKILL.md"))),
      ).toEqual([]);
    });

    it("runs only agents that exist and its skills name", () => {
      const problems: string[] = [];
      for (const { agent } of eventsOf(scenario, "agent.start")) {
        const name = /^graft:([a-z0-9-]+)$/.exec(agent)?.[1];
        if (name === undefined || !existsSync(join(ROOT, "agents", `${name}.md`))) {
          problems.push(`${agent} has no agents/<name>.md`);
        } else if (!mentions(withCommon, agent)) {
          problems.push(`${agent} is not named by ${owner}, the skills it follows or common.md`);
        }
      }
      expect(problems).toEqual([]);
    });

    it("declares only settings the catalog lists", () => {
      const catalog = parseCatalog(COMMON);
      if (!catalog.isParsed) throw new Error(catalog.error);
      const problems: string[] = [];
      for (const [key, value] of Object.entries(scenario.settings)) {
        const setting = catalog.settings.find((entry) => entry.key === key);
        if (setting === undefined) problems.push(`${key} is not a setting`);
        else if (
          !setting.isText &&
          value !== setting.defaultValue &&
          !setting.values.includes(value)
        ) {
          problems.push(`${key} cannot be ${value}`);
        }
      }
      expect(problems).toEqual([]);
    });

    it("uses fixed option labels its skills bold", () => {
      const problems: string[] = [];
      for (const { questions } of eventsOf(scenario, "ask")) {
        for (const question of questions.filter((entry) => entry.fixed)) {
          for (const { label } of question.options) {
            const bare = label.replace(/ \(Recommended\)$/, "");
            if (!withCommon.includes(`**${bare}**`))
              problems.push(`**${bare}** (${question.header})`);
          }
        }
      }
      expect(problems).toEqual([]);
    });

    it("writes Graft paths and footers its skills name", () => {
      const problems: string[] = [];
      const written = [...eventsOf(scenario, "file.create"), ...eventsOf(scenario, "file.modify")];
      for (const { path } of written) {
        for (const prefix of PATHS.filter((entry) => path.startsWith(entry))) {
          if (!skills.includes(prefix)) problems.push(`writes under ${prefix}`);
        }
      }
      for (const { content } of eventsOf(scenario, "file.create")) {
        for (const footer of FOOTERS.filter((entry) => content.includes(entry))) {
          if (!skills.includes(footer)) problems.push(`writes ${footer}`);
        }
      }
      // Paths and footers the scenario only reads or mentions may come from common.md's Find the work.
      const text = JSON.stringify(scenario);
      for (const name of [...PATHS, ...FOOTERS].filter((entry) => text.includes(entry))) {
        if (!withCommon.includes(name)) problems.push(`mentions ${name}`);
      }
      expect([...new Set(problems)]).toEqual([]);
    });

    it("runs git, gh and skill script commands as its skills write them", () => {
      const commands = skillCommands(`${skills}\n${delegatedSections(skills)}`);
      const unmatched = eventsOf(scenario, "tool")
        .filter((tool) => tool.name === "Bash" && CHECKED_COMMAND.test(tool.args))
        .map((tool) => tool.args)
        .filter((args) => !commands.some((command) => matchesCommand(tokens(args), command)));
      expect(unmatched).toEqual([]);
    });

    it("hands off with the next step its skill names", () => {
      const ownerText = skillText(owner);
      const problems: string[] = [];
      for (const { choices } of eventsOf(scenario, "handoff")) {
        for (const { command } of choices) {
          const [skill = "", argument] = tokens(command);
          if ((UNTOLD_HANDOFFS[scenario.id] ?? []).includes(command)) continue;
          const expected =
            argument === undefined
              ? skill
              : `${skill} ${argument.includes("/") ? "<path>" : "<name>"}`;
          if (!ownerText.includes(`\`${expected}\``)) problems.push(`${command} (${expected})`);
        }
      }
      expect(problems).toEqual([]);
    });
  });
});

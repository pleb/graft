import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { BuildError, DIFF_ARGS, isSupportedNode } from "../diff/build-lib.ts";
import {
  commentableLines,
  MAX_OUTPUT,
  parseInput,
  parsePrior,
  parsePrUrl,
  parseTarget,
  planPost,
  PrError,
  remoteFor,
  repoSlug,
  reviewBody,
  withoutMarkers,
  worktreePaths,
} from "./pr-lib.ts";
import type { Finding, InlineComment, PostInput, PrRef, PriorComment } from "./pr-lib.ts";

const VIEW_FIELDS = "url,number,state,title,body,headRefName,headRefOid,baseRefName,baseRefOid";
const COMMENT_FIELDS =
  '.[] | {path, line: (.line // .original_line), author: (.user.login // "ghost"), body}';
const REVIEW_FIELDS =
  '.[] | select((.body // "") != "") | {path: null, line: null, author: (.user.login // "ghost"), body}';
const ADD_THREAD = `mutation($review: ID!, $path: String!, $line: Int!, $body: String!) {
  addPullRequestReviewThread(input: {pullRequestReviewId: $review, path: $path, line: $line, side: RIGHT, body: $body}) { thread { id } }
}`;

type Cli =
  | { command: "view"; target?: string }
  | { command: "prepare"; url: string; dir: string }
  | { command: "cleanup"; dir: string }
  | { command: "post"; input: string; allowMoved: boolean };

interface PrView {
  url: string;
  number: number;
  state: string;
  title: string;
  body: string;
  headRefName: string;
  headRefOid: string;
  baseRefName: string;
  baseRefOid: string;
}

class UsageError extends Error {}

function usage(): never {
  throw new UsageError(
    "Usage: node pr.ts view [<number | url>] | prepare <url> --dir <dir> | cleanup --dir <dir> | post --input <file> [--allow-moved]",
  );
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function parseCli(): Cli {
  let values;
  let positionals;
  try {
    ({ values, positionals } = parseArgs({
      allowPositionals: true,
      options: {
        dir: { type: "string" },
        input: { type: "string" },
        "allow-moved": { type: "boolean" },
      },
    }));
  } catch {
    usage();
  }
  const [command, ...rest] = positionals;
  const { dir, input } = values;
  const allowMoved = values["allow-moved"] ?? false;
  if (command === "view") {
    if (rest.length > 1 || dir !== undefined || input !== undefined || allowMoved) usage();
    return { command, target: rest[0] };
  }
  if (command === "prepare") {
    if (rest.length !== 1 || !dir || input !== undefined || allowMoved) usage();
    return { command, url: rest[0], dir };
  }
  if (command === "cleanup") {
    if (rest.length || !dir || input !== undefined || allowMoved) usage();
    return { command, dir };
  }
  if (command === "post") {
    if (rest.length || !input || dir !== undefined) usage();
    return { command, input, allowMoved };
  }
  usage();
}

function run(
  command: string,
  args: string[],
  { cwd, input, label }: { cwd?: string; input?: string; label?: string } = {},
): string {
  const name = label ?? `${command} ${args.join(" ")}`;
  const result = spawnSync(command, args, { cwd, input, encoding: "utf8", maxBuffer: MAX_OUTPUT });
  if (result.error) throw new PrError(`${name} failed: ${result.error.message}`);
  if (result.status !== 0) {
    // gh api prints GitHub's error response on stdout and only the HTTP status on stderr.
    const detail = [result.stderr.trim(), result.stdout.trim()].filter(Boolean).join("\n");
    throw new PrError(`${name} failed: ${detail || `exit status ${result.status}`}`);
  }
  return result.stdout;
}

function git(root: string, args: string[], ok: number[] = [0]): { status: number; stdout: string } {
  const result = spawnSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    maxBuffer: MAX_OUTPUT,
  });
  if (result.error) throw new PrError(`git ${args.join(" ")} failed: ${result.error.message}`);
  const status = result.status ?? -1;
  if (!ok.includes(status)) {
    throw new PrError(
      `git ${args.join(" ")} failed: ${result.stderr.trim() || `exit status ${status}`}`,
    );
  }
  return { status, stdout: result.stdout };
}

function repoRoot(): string {
  const result = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    encoding: "utf8",
    maxBuffer: MAX_OUTPUT,
  });
  if (result.error || result.status !== 0) {
    throw new PrError(`${process.cwd()} is not inside a git repository`);
  }
  return resolve(result.stdout.trim());
}

function pullsPath(ref: PrRef): string {
  return `repos/${ref.owner}/${ref.repo}/pulls/${ref.number}`;
}

function viewPr(target: number | PrRef | undefined): PrView {
  const args = ["pr", "view", "--json", VIEW_FIELDS];
  if (typeof target === "number") args.splice(2, 0, String(target));
  else if (target) args.splice(2, 0, String(target.number), "-R", repoSlug(target));
  return JSON.parse(run("gh", args)) as PrView;
}

function fetchPrior(ref: PrRef): PriorComment[] {
  const api = ["api", "--hostname", ref.host, "--paginate"];
  const comments = run("gh", [...api, `${pullsPath(ref)}/comments`, "--jq", COMMENT_FIELDS]);
  const reviews = run("gh", [...api, `${pullsPath(ref)}/reviews`, "--jq", REVIEW_FIELDS]);
  return [...parsePrior(comments), ...parsePrior(reviews)];
}

function view(target: string | undefined): void {
  const pr = viewPr(target === undefined ? undefined : parseTarget(target));
  if (target === undefined && pr.state !== "OPEN") {
    console.error(`The branch's PR ${pr.url} is ${pr.state}`);
    console.log("null");
    return;
  }
  const ref = parsePrUrl(pr.url);
  const prior = withoutMarkers(fetchPrior(ref));
  const { url, number, state, title, body, headRefName, headRefOid, baseRefName, baseRefOid } = pr;
  console.log(
    JSON.stringify({
      url,
      repo: repoSlug(ref),
      number,
      state,
      title,
      body,
      headRefName,
      headRefOid,
      baseRefName,
      baseRefOid,
      prior,
    }),
  );
}

function resolvesCommit(root: string, oid: string): boolean {
  return git(root, ["rev-parse", "--verify", "-q", `${oid}^{commit}`], [0, 1]).status === 0;
}

function sameDir(a: string, b: string): boolean {
  const real = (path: string) => (existsSync(path) ? realpathSync(path) : resolve(path));
  return resolve(a) === resolve(b) || real(a) === real(b);
}

function isWorktree(root: string, dir: string): boolean {
  const paths = worktreePaths(git(root, ["worktree", "list", "--porcelain"]).stdout);
  return paths.slice(1).some((path) => sameDir(path, dir));
}

function sshHostname(host: string): string {
  // ssh would read a host starting with "-" as an option.
  if (host.startsWith("-")) return host;
  try {
    const config = run("ssh", ["-G", host]);
    return /^hostname\s+(\S+)$/m.exec(config)?.[1] ?? host;
  } catch (error) {
    if (!(error instanceof PrError)) throw error;
    return host;
  }
}

function prepare(url: string, dir: string): void {
  const ref = parsePrUrl(url);
  const root = repoRoot();
  const remote = remoteFor(git(root, ["remote", "-v"]).stdout, ref, sshHostname);
  if (remote === null) {
    throw new PrError(
      `No remote of ${root} is ${repoSlug(ref)}; run the review from a clone of that repo. A remote still pointing at a renamed or transferred repo's old name does not match, so update its URL with git remote set-url`,
    );
  }
  const pr = JSON.parse(
    run("gh", [
      "pr",
      "view",
      String(ref.number),
      "-R",
      repoSlug(ref),
      "--json",
      "headRefOid,baseRefOid",
    ]),
  ) as Pick<PrView, "headRefOid" | "baseRefOid">;
  const { baseRefOid: base, headRefOid: head } = pr;
  git(root, ["fetch", "--quiet", "--no-tags", remote, `pull/${ref.number}/head`, base]);
  for (const oid of [base, head]) {
    if (!resolvesCommit(root, oid)) throw new PrError(`${oid} does not resolve after fetching`);
  }
  if (git(root, ["merge-base", base, head], [0, 1]).status !== 0) {
    throw new PrError(`${base} and ${head} have no merge base`);
  }
  const atHead = git(root, ["rev-parse", "HEAD"], [0, 128]).stdout.trim() === head;
  if (atHead && !git(root, ["status", "--porcelain"]).stdout.trim()) {
    console.log(JSON.stringify({ root, base, head }));
    return;
  }
  const tree = resolve(dir);
  git(root, ["worktree", "prune"]);
  if (isWorktree(root, tree)) git(root, ["worktree", "remove", "--force", tree]);
  git(root, ["worktree", "add", "--quiet", "--detach", tree, head]);
  console.log(JSON.stringify({ root: tree, base, head }));
}

function cleanup(dir: string): void {
  const root = repoRoot();
  const tree = resolve(dir);
  if (!isWorktree(root, tree)) {
    console.log(`No worktree at ${tree}`);
    return;
  }
  git(root, ["worktree", "remove", "--force", tree]);
  console.log(`Removed ${tree}`);
}

function readInput(path: string): PostInput {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    fail(`Cannot read ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    fail(`${path} is not valid JSON`);
  }
  return parseInput(json);
}

function addThread(ref: PrRef, review: string, comment: InlineComment): boolean {
  const args = ["api", "--hostname", ref.host, "graphql", "-f", `query=${ADD_THREAD}`];
  args.push("-f", `review=${review}`, "-f", `path=${comment.path}`, "-F", `line=${comment.line}`);
  args.push("-f", `body=${comment.body}`, "--jq", ".data.addPullRequestReviewThread.thread.id");
  const label = `Adding the comment on ${comment.path}:${comment.line}`;
  try {
    const id = run("gh", args, { label }).trim();
    if (id && id !== "null") return true;
    console.error(`${label} returned no thread, so it goes in the review body`);
  } catch (error) {
    if (!(error instanceof PrError)) throw error;
    console.error(`${error.message}\nIt goes in the review body.`);
  }
  return false;
}

function post(path: string, allowMoved: boolean): void {
  const input = readInput(path);
  const ref = parsePrUrl(input.url);
  const root = repoRoot();
  const current = JSON.parse(
    run("gh", ["pr", "view", String(ref.number), "-R", repoSlug(ref), "--json", "headRefOid"]),
  ).headRefOid as string;
  if (current !== input.head && !allowMoved) {
    console.log(JSON.stringify({ moved: true, current }));
    process.exit(3);
  }
  const diff = git(root, [...DIFF_ARGS, "-U3", `${input.base}...${input.head}`, "--"]).stdout;
  const plan = planPost(input.findings, commentableLines(diff), fetchPrior(ref));
  if (!plan.inline.length && !plan.outside.length) {
    console.log(`Nothing new to post; ${plan.skipped.length} skipped as already raised`);
    return;
  }
  const reviews = `${pullsPath(ref)}/reviews`;
  const api = ["api", "--hostname", ref.host];
  const opened = JSON.parse(
    run("gh", [...api, "--method", "POST", reviews, "--input", "-", "--jq", "{id, node_id}"], {
      input: JSON.stringify({ commit_id: input.head }),
      label: "Opening a pending review",
    }),
  ) as { id: number; node_id: string };
  try {
    const rejected: Finding[] = [];
    for (const comment of plan.inline) {
      if (!addThread(ref, opened.node_id, comment)) rejected.push(comment.finding);
    }
    const outside = [...plan.outside, ...rejected];
    const url = run(
      "gh",
      [
        ...api,
        "--method",
        "POST",
        `${reviews}/${opened.id}/events`,
        "--input",
        "-",
        "--jq",
        ".html_url",
      ],
      {
        input: JSON.stringify({ event: "COMMENT", body: reviewBody(input.summary, outside) }),
        label: "Submitting the review",
      },
    ).trim();
    console.log(url);
    console.log(
      `${plan.inline.length - rejected.length} inline, ${outside.length} in the review body, ${plan.skipped.length} skipped as already raised`,
    );
  } catch (error) {
    try {
      run("gh", [...api, "--method", "DELETE", `${reviews}/${opened.id}`]);
    } catch (deleteError) {
      console.error(
        `Could not delete the pending review: ${deleteError instanceof Error ? deleteError.message : String(deleteError)}`,
      );
    }
    throw error;
  }
}

function main(): void {
  const version = process.versions.node;
  if (!isSupportedNode(version)) fail(`review needs Node 24 or later; this is v${version}`);
  let cli: Cli;
  try {
    cli = parseCli();
  } catch (error) {
    if (error instanceof UsageError) fail(error.message);
    throw error;
  }
  try {
    if (cli.command === "view") view(cli.target);
    else if (cli.command === "prepare") prepare(cli.url, cli.dir);
    else if (cli.command === "cleanup") cleanup(cli.dir);
    else post(cli.input, cli.allowMoved);
  } catch (error) {
    if (cli.command === "view" && cli.target === undefined) {
      console.error(error instanceof Error ? error.message : String(error));
      console.log("null");
      return;
    }
    if (error instanceof PrError || error instanceof BuildError) fail(error.message);
    throw error;
  }
}

main();

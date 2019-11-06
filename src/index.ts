import { promises as fs } from "fs";
import * as path from "path";
import { getInput } from "@actions/core";
import { context, GitHub } from "@actions/github";
import {
  Linter,
  ILinterOptions,
  Configuration,
  LintResult,
  RuleSeverity
} from "tslint";
import Octokit from "@octokit/rest";
import { fail } from "assert";

const ctx = context;
const NAME = "Strict TSLint";

const SeverityAnnotationLevelMap = new Map<RuleSeverity, "warning" | "failure">(
  [["warning", "warning"], ["error", "failure"]]
);

const linterOptions: ILinterOptions = {
  fix: false,
  formatter: "json"
};

interface ActionSettings {
  tsConfigFileName: string;
  lintConfigFileName: string;
  ghToken: string;
  failOnError: boolean;
}

const readSettings = (): ActionSettings => {
  return {
    tsConfigFileName: getInput("ts_config"),
    lintConfigFileName: getInput("tslint_config"),
    ghToken: getInput("token"),
    failOnError: Boolean(getInput("failOnInput")) || false
  };
};

const octokit = new GitHub(readSettings().ghToken);

const getChangedFiles = async (): Promise<string[] | undefined> => {
  const pullRequest = ctx.payload.pull_request;
  if (!pullRequest) {
    throw new Error("This action is for PRs only");
  }
  let response: Octokit.Response<Octokit.PullsListFilesResponse>;
  response = await octokit.pulls.listFiles({
    owner: ctx.repo.owner,
    repo: ctx.repo.repo,
    pull_number: pullRequest.number
  });

  return response.data.map((f: any) => path.resolve(f.filename));
};

const createCheck = async (): Promise<
  Octokit.Response<Octokit.ChecksCreateResponse>
> => {
  const pullRequest = ctx.payload.pull_request;
  if (!pullRequest) {
    throw new Error("pull request was undefined");
  }

  return octokit.checks.create({
    owner: ctx.repo.owner,
    repo: ctx.repo.repo,
    name: NAME,
    head_sha: pullRequest.head.sha,
    status: "in_progress"
  });
};

const updateCheck = async (id: number, results: LintResult) => {
  const pullRequest = ctx.payload.pull_request;
  if (!pullRequest) {
    throw new Error("pull request was undefined");
  }
  const bodies: string[] = [];

  const annotations = results.failures.map((failure: any) => {
    const annotation: Octokit.ChecksCreateParamsOutputAnnotations = {
      path: failure.getFileName(),
      start_line: failure.getStartPosition().getLineAndCharacter().line,
      end_line: failure.getEndPosition().getLineAndCharacter().line,
      start_column: failure.getStartPosition().getLineAndCharacter().character,
      end_column: failure.getStartPosition().getLineAndCharacter().character,
      annotation_level:
        SeverityAnnotationLevelMap.get(failure.getRuleSeverity()) || "notice",
      message: `[${failure.getRuleName()}] ${failure.getFailure()}`
    };
    const relativePath = failure.getFileName().slice(18);

    const filePathString = `${relativePath}#L${
      failure.getStartPosition().getLineAndCharacter().line
    }-L${failure.getEndPosition().getLineAndCharacter().line}`;
    const filePathLink = `https://github.com/${ctx.repo.owner}/${
      ctx.repo.repo
    }/blob/${pullRequest.head.sha}/${relativePath}#L${
      failure.getStartPosition().getLineAndCharacter().line
    }-L${failure.getEndPosition().getLineAndCharacter().line}`;
    const body = `Rule: ${failure.getRuleName()}
- File Path: [${filePathString}](${filePathLink})
- Message: ${failure.getFailure()}`;

    bodies.push(body);
    return annotation;
  });
  let conclusion:
    | "success"
    | "failure"
    | "neutral"
    | "cancelled"
    | "timed_out"
    | "action_required";
  if (readSettings().failOnError) {
    conclusion = results.errorCount > 0 ? "failure" : "success";
  } else {
    conclusion = results.errorCount > 0 ? "neutral" : "success";
  }

  for (let i = 0; i < annotations.length; i += 50) {
    const chunk = annotations.slice(i, i + 50);

    await octokit.checks.update({
      owner: ctx.repo.owner,
      repo: ctx.repo.repo,
      check_run_id: id,
      name: NAME,
      status: "completed",
      conclusion,
      output: {
        title: NAME,
        summary: `${results.errorCount} error(s).`,
        annotations: chunk
      }
    });
  }

  if (bodies.length > 0) {
    const checkURL = `https://github.com/${ctx.repo.owner}/${ctx.repo.repo}/runs/${id})`;

    const showCount = 5;

    let body = `These linting rules are not necessarily related to your code changes. They're setup to bring awareness to code quality issues. Some of the links may be off by a line or two.`;
    body += "\n\n";
    body += bodies.slice(0, showCount).join("\n");
    if (bodies.length > showCount) {
      body += `\n\nand [${bodies.length - showCount} more](${checkURL})`;
    }

    await octokit.issues.createComment({
      owner: ctx.repo.owner,
      repo: ctx.repo.repo,
      issue_number: pullRequest.number,
      body
    });
  }
};

const run = async () => {
  const settings = readSettings();
  const changedFiles = await getChangedFiles();
  if (!changedFiles) {
    throw new Error("No changed files found...");
  }

  const check = await createCheck();
  const program = Linter.createProgram(settings.tsConfigFileName);
  const linter = new Linter(linterOptions, program);
  let files = Linter.getFileNames(program);
  files = files.map((f: string) => {
    return path.resolve(f);
  });
  files = files.filter((f: string) => {
    return changedFiles.includes(f);
  });

  const tslintConfiguration = Configuration.findConfiguration(
    settings.lintConfigFileName
  ).results;

  for (let file of files) {
    const fileContents = await fs.readFile(file, { encoding: "utf8" });
    linter.lint(file, fileContents, tslintConfiguration);
  }

  const results = linter.getResult();
  await updateCheck(check.data.id, results);
};

run()
  .then(() => {
    console.log("complete!");
  })
  .catch(ex => {
    console.log(ex);
  });

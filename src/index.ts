import { promises as fs } from 'fs';
import * as path from 'path';
import { getInput } from '@actions/core';
import { context, GitHub } from '@actions/github';
import { Linter, ILinterOptions, Configuration, LintResult, RuleSeverity } from 'tslint';
import Octokit from '@octokit/rest';

const ctx = context;
const NAME = 'Strict TSLint';

const SeverityAnnotationLevelMap = new Map<RuleSeverity, "warning" | "failure">([
    ["warning", "warning"],
    ["error", "failure"],
]);

const linterOptions: ILinterOptions = {
    fix: false,
    formatter: 'json',
};

interface ActionSettings {
    configFileName: string;
    ghToken: string;
}

const readSettings = ((): ActionSettings => {
    return {
        configFileName: getInput('tslint_config'),
        ghToken: getInput('gh_token'),
    };
});

const octokit = new GitHub(readSettings().ghToken);

const getChangedFiles = (async (): Promise<string[] | undefined> => {
    const pullRequest = ctx.payload.pull_request;
    if (!pullRequest) {
        throw new Error('This action is for PRs only');
    }
    let response: Octokit.Response<Octokit.PullsListFilesResponse>;
    response = await octokit.pulls.listFiles({
        owner: ctx.repo.owner,
        repo: ctx.repo.repo,
        pull_number: pullRequest.pull_number
    })

    return response.data.map((f) => path.resolve(f.filename));
});

const createCheck = (async (): Promise<Octokit.Response<Octokit.ChecksCreateResponse>> => {
    return octokit.checks.create({
        owner: ctx.repo.owner,
        repo: ctx.repo.repo,
        name: NAME,
        head_sha: (ctx.payload.pull_request as any).head.sha,
        status: 'in_progress',
    });
})

const updateCheck = (async (id: number, results: LintResult) => {
    const annotations = results.failures.map((failure) => {
        const annotation: Octokit.ChecksCreateParamsOutputAnnotations = {
            path: failure.getFileName(),
            start_line: failure.getStartPosition().getLineAndCharacter().line,
            end_line: failure.getEndPosition().getLineAndCharacter().line,
            start_column: failure.getStartPosition().getLineAndCharacter().character,
            end_column: failure.getStartPosition().getLineAndCharacter().character,
            annotation_level: SeverityAnnotationLevelMap.get(failure.getRuleSeverity()) || "notice",
            message: `[${failure.getRuleName()}] ${failure.getFailure()}`
        }

        return annotation;
    });

    await octokit.checks.update({
        owner: ctx.repo.owner,
        repo: ctx.repo.repo,
        check_run_id: id,
        name: NAME,
        status: 'completed',
        conclusion: results.errorCount > 0 ? 'failure' : 'success',
        output: {
            title: NAME,
            summary: `${results.errorCount} error(s).`,
            annotations,
        }
    });
});

const run = (async () => {
    const settings = readSettings();
    const changedFiles = await getChangedFiles();
    if (!changedFiles) {
        throw new Error('No changed files found...');
    }

    const check = await createCheck();
    const program = Linter.createProgram(settings.configFileName);
    const linter = new Linter(linterOptions, program);
    let files = Linter.getFileNames(program);
    files = files.map((f) => {
        return path.resolve(f);
    });
    files = files.filter(f => {
        return changedFiles.includes(f);
    });

    const tslintConfiguration = Configuration.findConfiguration(settings.configFileName).results;

    for (let file of files) {
        const fileContents = await fs.readFile(file, { encoding: 'utf8' });
        linter.lint(file, fileContents, tslintConfiguration);
        console.log(file);
    }

    const results = linter.getResult();
    await updateCheck(check.data.id, results);
});

run().then(() => {
    console.log('complete!');
}).catch((ex) => {
    console.log(ex);
});

console.log('testing');

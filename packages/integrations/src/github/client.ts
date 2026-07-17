import { Octokit } from '@octokit/rest';
import { createAppAuth } from '@octokit/auth-app';

export function getGithubClient(installationId: number): Octokit {
  return new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId: process.env.GITHUB_APP_ID!,
      privateKey: process.env.GITHUB_APP_PRIVATE_KEY!,
      installationId,
    },
  });
}

export async function getAuthorizedRepos(): Promise<{ fullName: string; defaultBranch: string }[]> {
  const appOctokit = new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId: process.env.GITHUB_APP_ID!,
      privateKey: process.env.GITHUB_APP_PRIVATE_KEY!,
    },
  });
  
  const { data: installations } = await appOctokit.apps.listInstallations();
  const allRepos = [];
  
  for (const inst of installations) {
    const client = getGithubClient(inst.id);
    const { data } = await client.apps.listReposAccessibleToInstallation();
    allRepos.push(...data.repositories.map((r) => ({ fullName: r.full_name, defaultBranch: r.default_branch })));
  }
  
  return allRepos;
}

/** Post (or update) the AI-review comment on a PR. Returns the comment id. */
export async function postPrComment(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number,
  body: string,
): Promise<string> {
  const { data } = await octokit.issues.createComment({ owner, repo, issue_number: prNumber, body });
  return String(data.id);
}

/**
 * Open a docs PR from updated file contents (doc agent). Creates a branch off
 * the default branch head, commits each file via the contents API, opens the
 * PR and labels it.
 */
export async function openDocPr(
  octokit: Octokit,
  opts: {
    owner: string;
    repo: string;
    baseBranch: string;
    branchName: string;
    title: string;
    body: string;
    files: Array<{ path: string; content: string }>;
    labels: string[];
  },
): Promise<{ prNumber: number; url: string }> {
  const { owner, repo } = opts;
  const { data: baseRef } = await octokit.git.getRef({ owner, repo, ref: `heads/${opts.baseBranch}` });
  await octokit.git.createRef({ owner, repo, ref: `refs/heads/${opts.branchName}`, sha: baseRef.object.sha });

  for (const file of opts.files) {
    let existingSha: string | undefined;
    try {
      const { data } = await octokit.repos.getContent({ owner, repo, path: file.path, ref: opts.branchName });
      if (!Array.isArray(data) && data.type === 'file') existingSha = data.sha;
    } catch {
      /* new file */
    }
    await octokit.repos.createOrUpdateFileContents({
      owner,
      repo,
      path: file.path,
      message: `docs: update ${file.path}`,
      content: Buffer.from(file.content, 'utf8').toString('base64'),
      branch: opts.branchName,
      sha: existingSha,
    });
  }

  const { data: pr } = await octokit.pulls.create({
    owner,
    repo,
    title: opts.title,
    body: opts.body,
    head: opts.branchName,
    base: opts.baseBranch,
  });
  await octokit.issues.addLabels({ owner, repo, issue_number: pr.number, labels: opts.labels });
  return { prNumber: pr.number, url: pr.html_url };
}

export interface ChangedFile {
  path: string;
  status: 'modified' | 'renamed' | 'deleted';
  oldPath?: string;
}

export async function getChangedFiles(
  octokit: Octokit,
  owner: string,
  repo: string,
  baseSha: string,
  headSha: string,
): Promise<ChangedFile[]> {
  const { data } = await octokit.repos.compareCommitsWithBasehead({
    owner,
    repo,
    basehead: `${baseSha}...${headSha}`,
  });
  return (
    data.files?.map((f) => ({
      path: f.filename,
      status: f.status as ChangedFile['status'],
      oldPath: f.previous_filename,
    })) ?? []
  );
}

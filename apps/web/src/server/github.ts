import 'server-only';
import { Octokit } from '@octokit/rest';
import { createAppAuth } from '@octokit/auth-app';

const APP_ID = process.env.GITHUB_APP_ID;
const PRIVATE_KEY = process.env.GITHUB_APP_PRIVATE_KEY?.replace(/\\n/g, '\n');

export const githubConfigured = Boolean(APP_ID && PRIVATE_KEY);

function appOctokit(): Octokit {
  return new Octokit({ authStrategy: createAppAuth, auth: { appId: APP_ID!, privateKey: PRIVATE_KEY! } });
}

function installationOctokit(installationId: number): Octokit {
  return new Octokit({ authStrategy: createAppAuth, auth: { appId: APP_ID!, privateKey: PRIVATE_KEY!, installationId } });
}

export interface AuthorizedRepo {
  fullName: string;
  owner: string;
  repo: string;
  defaultBranch: string;
  githubRepoId: string;
  installationId: number;
  private: boolean;
}

/** Every repo the GitHub App is installed on and can access. [] when not installed. */
export async function listAuthorizedRepos(): Promise<AuthorizedRepo[]> {
  if (!githubConfigured) return [];
  const app = appOctokit();
  const { data: installs } = await app.apps.listInstallations({ per_page: 100 });
  const out: AuthorizedRepo[] = [];
  for (const inst of installs) {
    try {
      const octo = installationOctokit(inst.id);
      const repos = await octo.paginate(octo.apps.listReposAccessibleToInstallation, { per_page: 100 });
      for (const r of repos as Array<Record<string, any>>) {
        const [owner, repo] = r.full_name.split('/');
        out.push({
          fullName: r.full_name,
          owner,
          repo,
          defaultBranch: r.default_branch ?? 'main',
          githubRepoId: String(r.id),
          installationId: inst.id,
          private: Boolean(r.private),
        });
      }
    } catch {
      /* skip an installation we can't read */
    }
  }
  return out;
}

export async function resolveRepo(fullName: string): Promise<AuthorizedRepo | null> {
  const repos = await listAuthorizedRepos();
  return repos.find((r) => r.fullName.toLowerCase() === fullName.toLowerCase()) ?? null;
}

const CODE_EXT = /\.(ts|tsx|js|jsx|mts|cts)$/;
const SKIP_PATH = /(^|\/)(node_modules|dist|build|\.next|\.turbo|coverage|vendor|\.git)\//;

/** Recursive file listing for a ref, filtered to source files (capped). */
export async function getSourceFiles(r: AuthorizedRepo, ref: string, cap = 600): Promise<string[]> {
  const octo = installationOctokit(r.installationId);
  const { data: refData } = await octo.git.getRef({ owner: r.owner, repo: r.repo, ref: `heads/${ref}` });
  const { data: tree } = await octo.git.getTree({ owner: r.owner, repo: r.repo, tree_sha: refData.object.sha, recursive: 'true' });
  return tree.tree
    .filter((t) => t.type === 'blob' && t.path && CODE_EXT.test(t.path) && !SKIP_PATH.test(`/${t.path}`) && !t.path.endsWith('.d.ts'))
    .map((t) => t.path!)
    .slice(0, cap);
}

export async function getHeadSha(r: AuthorizedRepo, ref: string): Promise<string> {
  const octo = installationOctokit(r.installationId);
  const { data } = await octo.git.getRef({ owner: r.owner, repo: r.repo, ref: `heads/${ref}` });
  return data.object.sha;
}

export async function getFileContent(r: AuthorizedRepo, path: string, ref: string): Promise<string | null> {
  const octo = installationOctokit(r.installationId);
  try {
    const { data } = await octo.repos.getContent({ owner: r.owner, repo: r.repo, path, ref });
    if (!Array.isArray(data) && 'content' in data && data.content) {
      return Buffer.from(data.content, 'base64').toString('utf-8');
    }
  } catch {
    /* missing file */
  }
  return null;
}

export interface OpenPR {
  number: number;
  title: string;
  author: string;
  url: string;
  createdAt: string;
  updatedAt: string;
  changedPaths: string[];
  filesChanged: number;
  additions: number;
  deletions: number;
}

export async function listOpenPullRequests(r: AuthorizedRepo, max = 20): Promise<OpenPR[]> {
  const octo = installationOctokit(r.installationId);
  const { data: prs } = await octo.pulls.list({ owner: r.owner, repo: r.repo, state: 'open', per_page: max, sort: 'updated', direction: 'desc' });
  const out: OpenPR[] = [];
  for (const pr of prs) {
    let changedPaths: string[] = [];
    try {
      const files = await octo.paginate(octo.pulls.listFiles, { owner: r.owner, repo: r.repo, pull_number: pr.number, per_page: 100 });
      changedPaths = (files as Array<{ filename: string }>).map((f) => f.filename);
    } catch {
      /* ignore */
    }
    out.push({
      number: pr.number,
      title: pr.title,
      author: pr.user?.login ?? 'unknown',
      url: pr.html_url,
      createdAt: pr.created_at,
      updatedAt: pr.updated_at,
      changedPaths,
      filesChanged: changedPaths.length || (pr as any).changed_files || 0,
      additions: (pr as any).additions ?? 0,
      deletions: (pr as any).deletions ?? 0,
    });
  }
  return out;
}

export interface RepoEvent {
  kind: 'commit' | 'pr';
  actor: string;
  text: string;
  at: string;
}

export async function listRecentEvents(r: AuthorizedRepo, max = 8): Promise<RepoEvent[]> {
  const octo = installationOctokit(r.installationId);
  const events: RepoEvent[] = [];
  try {
    const { data: commits } = await octo.repos.listCommits({ owner: r.owner, repo: r.repo, per_page: max });
    for (const c of commits) {
      events.push({
        kind: 'commit',
        actor: c.author?.login ?? c.commit.author?.name ?? 'unknown',
        text: `pushed to ${r.fullName}: ${c.commit.message.split('\n')[0]}`,
        at: c.commit.author?.date ?? new Date().toISOString(),
      });
    }
  } catch {
    /* ignore */
  }
  return events.slice(0, max);
}

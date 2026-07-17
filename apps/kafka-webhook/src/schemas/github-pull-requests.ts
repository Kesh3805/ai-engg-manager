/** Payload for topic `github.pull_requests` (schemaVersion 1). */
export interface PullRequestEventPayload {
  action: string; // opened | synchronize | closed | reopened | review_submitted
  repoGithubId: string;
  repoFullName: string;
  pr: {
    githubPrId: string;
    number: number;
    title: string;
    state: 'open' | 'closed';
    merged: boolean;
    authorLogin: string | null;
    baseSha: string;
    headSha: string;
    createdAt: string | null;
    mergedAt: string | null;
  };
  /** Present only on review events. */
  review?: {
    reviewerLogin: string | null;
    state: 'approved' | 'changes_requested' | 'commented';
    submittedAt: string | null;
  };
  installationId?: number;
}

import { App } from '@octokit/app';
import { PRState, ReviewComment, CIStatus } from '../types/index.js';

interface PRFetchResult {
  state: PRState;
  baseBranch: string;
}

interface ReviewThread {
  isResolved: boolean;
  comments: { nodes: { author: { login: string; __typename: string } }[] };
}

export class GitHubClient {
  private app: App;
  private installationId: number;
  private octokit: Awaited<ReturnType<App['getInstallationOctokit']>> | null = null;

  constructor(appId: string, privateKey: string, installationId: number) {
    this.app = new App({ appId, privateKey });
    this.installationId = installationId;
  }

  private async getOctokit() {
    if (!this.octokit) {
      this.octokit = await this.app.getInstallationOctokit(this.installationId);
    }
    return this.octokit;
  }

  async getRequiredApprovals(
    owner: string,
    repo: string,
    branch: string,
    fallback = 1,
  ): Promise<number> {
    try {
      const octokit = await this.getOctokit();
      const { data } = await octokit.request(
        'GET /repos/{owner}/{repo}/branches/{branch}/protection',
        { owner, repo, branch },
      );
      return (data as any).required_pull_request_reviews?.required_approving_review_count ?? fallback;
    } catch {
      return fallback;
    }
  }

  async fetchPRState(
    owner: string,
    repo: string,
    prNumber: number,
    blocklist: Set<string>,
  ): Promise<PRFetchResult> {
    const octokit = await this.getOctokit();

    const { data: pr } = await octokit.request(
      'GET /repos/{owner}/{repo}/pulls/{pull_number}',
      { owner, repo, pull_number: prNumber },
    );

    const { data: reviews } = await octokit.request(
      'GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews',
      { owner, repo, pull_number: prNumber },
    );

    const { data: checksData } = await octokit.request(
      'GET /repos/{owner}/{repo}/commits/{ref}/check-runs',
      { owner, repo, ref: (pr as any).head.sha },
    );

    const threadsResult = await octokit.graphql<{
      repository: { pullRequest: { reviewThreads: { nodes: ReviewThread[] } } };
    }>(
      `query GetPRReviewThreads($owner: String!, $repo: String!, $number: Int!) {
        repository(owner: $owner, name: $repo) {
          pullRequest(number: $number) {
            reviewThreads(first: 100) {
              nodes {
                isResolved
                comments(first: 1) {
                  nodes {
                    author {
                      login
                      __typename
                    }
                  }
                }
              }
            }
          }
        }
      }`,
      { owner, repo, number: prNumber },
    );

    const threads: ReviewThread[] =
      threadsResult.repository.pullRequest.reviewThreads.nodes;

    const ciStatus = this.aggregateCheckRuns((checksData as any).check_runs ?? []);

    const approvalCount = ((reviews as any[]) ?? []).filter((r: any) => {
      if (r.state !== 'APPROVED') return false;
      if (r.user?.type === 'Bot') return false;
      if (blocklist.has(r.user?.login ?? '')) return false;
      return true;
    }).length;

    const reviewComments = this.aggregateThreads(threads, blocklist);

    return {
      state: {
        merged: !!(pr as any).merged,
        closed: (pr as any).state === 'closed',
        approvalCount,
        reviewComments,
        ciStatus,
      },
      baseBranch: (pr as any).base.ref,
    };
  }

  private aggregateCheckRuns(
    checkRuns: { conclusion: string | null; status?: string }[],
  ): CIStatus {
    if (checkRuns.length === 0) return 'none';

    if (checkRuns.some(c => c.conclusion === 'failure' || c.conclusion === 'cancelled')) {
      return 'failing';
    }
    if (checkRuns.some(c => c.conclusion === null && (c.status === 'in_progress' || c.status === 'queued' || c.status === 'waiting'))) {
      return 'pending';
    }
    const terminal = new Set(['success', 'skipped', 'neutral']);
    if (checkRuns.every(c => terminal.has(c.conclusion ?? ''))) {
      return 'passing';
    }
    return 'pending';
  }

  private aggregateThreads(
    threads: ReviewThread[],
    blocklist: Set<string>,
  ): ReviewComment[] {
    const byUser = new Map<string, { open: number; resolved: number }>();

    for (const thread of threads) {
      const author = thread.comments.nodes[0]?.author;
      if (!author) continue;
      if (author.__typename === 'Bot') continue;
      if (blocklist.has(author.login)) continue;

      if (!byUser.has(author.login)) {
        byUser.set(author.login, { open: 0, resolved: 0 });
      }
      const counts = byUser.get(author.login)!;
      if (thread.isResolved) {
        counts.resolved++;
      } else {
        counts.open++;
      }
    }

    return Array.from(byUser.entries()).map(([user, counts]) => ({ user, ...counts }));
  }
}

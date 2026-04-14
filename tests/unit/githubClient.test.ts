import { GitHubClient } from '../../src/clients/githubClient';
import { PRState } from '../../src/types/index';

// Mock @octokit/app
const mockRequest = jest.fn();
const mockGraphql = jest.fn();
const mockGetInstallationOctokit = jest.fn().mockResolvedValue({
  request: mockRequest,
  graphql: mockGraphql,
});

jest.mock('@octokit/app', () => ({
  App: jest.fn().mockImplementation(() => ({
    getInstallationOctokit: mockGetInstallationOctokit,
  })),
}));

describe('GitHubClient', () => {
  let client: GitHubClient;

  beforeEach(() => {
    jest.clearAllMocks();
    client = new GitHubClient('123', 'fake-private-key', 456);
  });

  describe('getRequiredApprovals', () => {
    it('returns required_approving_review_count from branch protection', async () => {
      mockRequest.mockResolvedValueOnce({
        data: {
          required_pull_request_reviews: {
            required_approving_review_count: 2,
          },
        },
      });

      const result = await client.getRequiredApprovals('org', 'repo', 'main');
      expect(result).toBe(2);
      expect(mockRequest).toHaveBeenCalledWith(
        'GET /repos/{owner}/{repo}/branches/{branch}/protection',
        { owner: 'org', repo: 'repo', branch: 'main' }
      );
    });

    it('returns fallback value when branch protection throws', async () => {
      mockRequest.mockRejectedValueOnce(new Error('Not Found'));
      const result = await client.getRequiredApprovals('org', 'repo', 'main', 3);
      expect(result).toBe(3);
    });

    it('returns 1 when branch protection throws and no fallback provided', async () => {
      mockRequest.mockRejectedValueOnce(new Error('Not Found'));
      const result = await client.getRequiredApprovals('org', 'repo', 'main');
      expect(result).toBe(1);
    });
  });

  describe('fetchPRState', () => {
    const blocklist = new Set(['dependabot[bot]']);

    it('returns merged:true when PR is merged', async () => {
      setupMocksForPR({ merged: true, state: 'closed' });
      const { state } = await client.fetchPRState('org', 'repo', 1, blocklist);
      expect(state.merged).toBe(true);
      expect(state.closed).toBe(true);
    });

    it('returns closed:true merged:false for closed-not-merged PR', async () => {
      setupMocksForPR({ merged: false, state: 'closed' });
      const { state } = await client.fetchPRState('org', 'repo', 1, blocklist);
      expect(state.merged).toBe(false);
      expect(state.closed).toBe(true);
    });

    it('counts non-bot approvals', async () => {
      setupMocksForPR({
        reviews: [
          { state: 'APPROVED', user: { login: 'alice', type: 'User' } },
          { state: 'APPROVED', user: { login: 'dependabot[bot]', type: 'Bot' } },
        ],
      });
      const { state } = await client.fetchPRState('org', 'repo', 1, blocklist);
      expect(state.approvalCount).toBe(1);
    });

    it('does not count dismissed approvals', async () => {
      setupMocksForPR({
        reviews: [
          { state: 'DISMISSED', user: { login: 'alice', type: 'User' } },
        ],
      });
      const { state } = await client.fetchPRState('org', 'repo', 1, blocklist);
      expect(state.approvalCount).toBe(0);
    });

    it('aggregates check runs: failing when any check fails', async () => {
      setupMocksForPR({ checkRuns: [{ conclusion: 'success' }, { conclusion: 'failure' }] });
      const { state } = await client.fetchPRState('org', 'repo', 1, blocklist);
      expect(state.ciStatus).toBe('failing');
    });

    it('aggregates check runs: passing when all checks succeed', async () => {
      setupMocksForPR({ checkRuns: [{ conclusion: 'success' }, { conclusion: 'skipped' }] });
      const { state } = await client.fetchPRState('org', 'repo', 1, blocklist);
      expect(state.ciStatus).toBe('passing');
    });

    it('aggregates check runs: pending when any check is in_progress', async () => {
      setupMocksForPR({ checkRuns: [{ conclusion: null, status: 'in_progress' }] });
      const { state } = await client.fetchPRState('org', 'repo', 1, blocklist);
      expect(state.ciStatus).toBe('pending');
    });

    it('returns ciStatus:none when no check runs exist', async () => {
      setupMocksForPR({ checkRuns: [] });
      const { state } = await client.fetchPRState('org', 'repo', 1, blocklist);
      expect(state.ciStatus).toBe('none');
    });

    it('maps review threads to open/resolved counts per user, filtering bots', async () => {
      setupMocksForPR({
        reviewThreads: [
          { isResolved: false, comments: { nodes: [{ author: { login: 'alice', __typename: 'User' } }] } },
          { isResolved: true, comments: { nodes: [{ author: { login: 'alice', __typename: 'User' } }] } },
          { isResolved: false, comments: { nodes: [{ author: { login: 'dependabot[bot]', __typename: 'Bot' } }] } },
        ],
      });
      const { state } = await client.fetchPRState('org', 'repo', 1, blocklist);
      expect(state.reviewComments).toHaveLength(1);
      expect(state.reviewComments[0]).toEqual({ user: 'alice', open: 1, resolved: 1 });
    });

    it('returns the base branch name', async () => {
      setupMocksForPR({ baseBranch: 'develop' });
      const { baseBranch } = await client.fetchPRState('org', 'repo', 1, blocklist);
      expect(baseBranch).toBe('develop');
    });
  });
});

// Helper: set up mockRequest and mockGraphql for a full PR fetch sequence
function setupMocksForPR(overrides: {
  merged?: boolean;
  state?: string;
  baseBranch?: string;
  headSha?: string;
  reviews?: { state: string; user: { login: string; type: string } }[];
  checkRuns?: { conclusion: string | null; status?: string }[];
  reviewThreads?: { isResolved: boolean; comments: { nodes: { author: { login: string; __typename: string } }[] } }[];
}) {
  const {
    merged = false,
    state = 'open',
    baseBranch = 'main',
    headSha = 'abc123',
    reviews = [],
    checkRuns = [],
    reviewThreads = [],
  } = overrides;

  // GET /repos/{owner}/{repo}/pulls/{pull_number}
  mockRequest.mockResolvedValueOnce({
    data: {
      merged,
      state,
      base: { ref: baseBranch },
      head: { sha: headSha },
    },
  });

  // GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews
  mockRequest.mockResolvedValueOnce({ data: reviews });

  // GET /repos/{owner}/{repo}/commits/{ref}/check-runs
  mockRequest.mockResolvedValueOnce({ data: { check_runs: checkRuns } });

  // GraphQL review threads
  mockGraphql.mockResolvedValueOnce({
    repository: {
      pullRequest: {
        reviewThreads: { nodes: reviewThreads },
      },
    },
  });
}

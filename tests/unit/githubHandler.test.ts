import crypto from 'node:crypto';
import { GitHubHandler } from '../../src/handlers/githubHandler';
import { StateStore } from '../../src/store/stateStore';
import { PRStatusService } from '../../src/services/prStatusService';
import { TrackedPR, PRState } from '../../src/types/index';

const mockFetchPRState = jest.fn();
const mockGetRequiredApprovals = jest.fn().mockResolvedValue(1);
jest.mock('../../src/clients/githubClient', () => ({
  GitHubClient: jest.fn().mockImplementation(() => ({
    fetchPRState: mockFetchPRState,
    getRequiredApprovals: mockGetRequiredApprovals,
  })),
}));

const mockAddReaction = jest.fn().mockResolvedValue(undefined);
const mockRemoveReaction = jest.fn().mockResolvedValue(undefined);
const mockPostThreadReply = jest.fn().mockResolvedValue('555.666');
const mockEditMessage = jest.fn().mockResolvedValue(undefined);
jest.mock('../../src/clients/slackClient', () => ({
  SlackClient: jest.fn().mockImplementation(() => ({
    addReaction: mockAddReaction,
    removeReaction: mockRemoveReaction,
    postThreadReply: mockPostThreadReply,
    editMessage: mockEditMessage,
  })),
}));

import { GitHubClient } from '../../src/clients/githubClient';
import { SlackClient } from '../../src/clients/slackClient';

const SECRET = 'test-secret';

function sign(body: string): string {
  return 'sha256=' + crypto.createHmac('sha256', SECRET).update(body).digest('hex');
}

const makeTrackedPR = (overrides: Partial<TrackedPR> = {}): TrackedPR => ({
  prUrl: 'https://github.com/org/repo/pull/1',
  repoFullName: 'org/repo',
  prNumber: 1,
  baseBranch: 'main',
  slackMessageTs: '100.000',
  threadReplyTs: '200.000',
  requiredApprovals: 1,
  lastKnownState: null,
  activeEmojis: [],
  ...overrides,
});

const makePRState = (overrides: Partial<PRState> = {}): PRState => ({
  merged: false,
  closed: false,
  approvalCount: 1,
  reviewComments: [],
  ciStatus: 'passing',
  ...overrides,
});

describe('GitHubHandler', () => {
  let store: StateStore;
  let handler: GitHubHandler;

  beforeEach(() => {
    jest.clearAllMocks();
    store = new StateStore();
    const ghClient = new GitHubClient('', '', 0) as jest.Mocked<GitHubClient>;
    const slackClient = new SlackClient('') as jest.Mocked<SlackClient>;
    handler = new GitHubHandler(store, new PRStatusService(), slackClient, ghClient, SECRET);
  });

  describe('verifySignature', () => {
    it('returns true for a valid HMAC-SHA256 signature', () => {
      const body = JSON.stringify({ action: 'test' });
      expect(handler.verifySignature(body, sign(body))).toBe(true);
    });

    it('returns false for an invalid signature', () => {
      const body = JSON.stringify({ action: 'test' });
      expect(handler.verifySignature(body, 'sha256=bad')).toBe(false);
    });

    it('returns false for a missing signature', () => {
      expect(handler.verifySignature('body', '')).toBe(false);
    });
  });

  describe('handleWebhook', () => {
    beforeEach(() => {
      store.addTrackedPR('C001', makeTrackedPR());
      mockFetchPRState.mockResolvedValue({
        state: makePRState(),
        baseBranch: 'main',
      });
    });

    it('updates reactions and edits thread on pull_request.closed', async () => {
      await handler.handleWebhook('pull_request', {
        action: 'closed',
        pull_request: { number: 1, base: { repo: { full_name: 'org/repo' } } },
      });
      expect(mockFetchPRState).toHaveBeenCalled();
      expect(mockEditMessage).toHaveBeenCalled();
    });

    it('updates on pull_request_review.submitted', async () => {
      await handler.handleWebhook('pull_request_review', {
        action: 'submitted',
        pull_request: { number: 1, base: { repo: { full_name: 'org/repo' } } },
      });
      expect(mockFetchPRState).toHaveBeenCalled();
    });

    it('updates on pull_request_review.dismissed', async () => {
      await handler.handleWebhook('pull_request_review', {
        action: 'dismissed',
        pull_request: { number: 1, base: { repo: { full_name: 'org/repo' } } },
      });
      expect(mockFetchPRState).toHaveBeenCalled();
    });

    it('updates on pull_request_review_thread.resolved', async () => {
      await handler.handleWebhook('pull_request_review_thread', {
        action: 'resolved',
        pull_request: { number: 1, base: { repo: { full_name: 'org/repo' } } },
      });
      expect(mockFetchPRState).toHaveBeenCalled();
    });

    it('updates on pull_request_review_thread.unresolved', async () => {
      await handler.handleWebhook('pull_request_review_thread', {
        action: 'unresolved',
        pull_request: { number: 1, base: { repo: { full_name: 'org/repo' } } },
      });
      expect(mockFetchPRState).toHaveBeenCalled();
    });

    it('updates on check_run.completed', async () => {
      await handler.handleWebhook('check_run', {
        action: 'completed',
        check_run: { pull_requests: [{ number: 1, base: { repo: { full_name: 'org/repo' } } }] },
      });
      expect(mockFetchPRState).toHaveBeenCalled();
    });

    it('ignores untracked PRs gracefully', async () => {
      await handler.handleWebhook('pull_request', {
        action: 'closed',
        pull_request: { number: 999, base: { repo: { full_name: 'org/repo' } } },
      });
      expect(mockFetchPRState).not.toHaveBeenCalled();
    });

    it('ignores unknown event types without throwing', async () => {
      await expect(
        handler.handleWebhook('ping', { zen: 'hello' })
      ).resolves.not.toThrow();
      expect(mockFetchPRState).not.toHaveBeenCalled();
    });

    it('posts a new thread reply when threadReplyTs is null', async () => {
      const freshStore = new StateStore();
      freshStore.addTrackedPR('C001', makeTrackedPR({ threadReplyTs: null }));
      const freshHandler = new GitHubHandler(
        freshStore,
        new PRStatusService(),
        new SlackClient('') as jest.Mocked<SlackClient>,
        new GitHubClient('', '', 0) as jest.Mocked<GitHubClient>,
        SECRET,
      );
      mockFetchPRState.mockResolvedValue({ state: makePRState(), baseBranch: 'main' });

      await freshHandler.handleWebhook('pull_request_review', {
        action: 'submitted',
        pull_request: { number: 1, base: { repo: { full_name: 'org/repo' } } },
      });

      expect(mockPostThreadReply).toHaveBeenCalled();
    });

    it('skips update when state has not changed', async () => {
      const existingState = makePRState();
      store.updateTrackedPR('C001', makeTrackedPR().prUrl, { lastKnownState: existingState });
      mockFetchPRState.mockResolvedValue({ state: existingState, baseBranch: 'main' });

      await handler.handleWebhook('pull_request_review', {
        action: 'submitted',
        pull_request: { number: 1, base: { repo: { full_name: 'org/repo' } } },
      });

      expect(mockEditMessage).not.toHaveBeenCalled();
    });
  });
});

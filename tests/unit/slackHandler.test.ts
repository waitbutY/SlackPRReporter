import { SlackHandler } from '../../src/handlers/slackHandler';
import { StateStore } from '../../src/store/stateStore';
import { PRStatusService } from '../../src/services/prStatusService';

const mockFetchPRState = jest.fn().mockResolvedValue({
  state: { merged: false, closed: false, approvalCount: 0, reviewComments: [], ciStatus: 'none' },
  baseBranch: 'main',
});
const mockGetRequiredApprovals = jest.fn().mockResolvedValue(1);
jest.mock('../../src/clients/githubClient', () => ({
  GitHubClient: jest.fn().mockImplementation(() => ({
    fetchPRState: mockFetchPRState,
    getRequiredApprovals: mockGetRequiredApprovals,
  })),
}));

const mockAddReaction = jest.fn().mockResolvedValue(undefined);
const mockPostThreadReply = jest.fn().mockResolvedValue('555.666');
jest.mock('../../src/clients/slackClient', () => ({
  SlackClient: jest.fn().mockImplementation(() => ({
    addReaction: mockAddReaction,
    removeReaction: jest.fn().mockResolvedValue(undefined),
    editMessage: jest.fn().mockResolvedValue(undefined),
    postThreadReply: mockPostThreadReply,
    postMessage: jest.fn().mockResolvedValue(undefined),
    getJoinedChannels: jest.fn().mockResolvedValue([]),
  })),
}));

import { GitHubClient } from '../../src/clients/githubClient';
import { SlackClient } from '../../src/clients/slackClient';

describe('SlackHandler', () => {
  let store: StateStore;
  let handler: SlackHandler;

  beforeEach(() => {
    jest.clearAllMocks();
    store = new StateStore();
    handler = new SlackHandler(
      store,
      new PRStatusService(),
      new GitHubClient('', '', 0) as any,
      new SlackClient('') as any,
    );
  });

  describe('extractPRUrls', () => {
    it('extracts a single GitHub PR URL', () => {
      const result = handler.extractPRUrls('Check out https://github.com/org/repo/pull/42');
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ owner: 'org', repo: 'repo', prNumber: 42, repoFullName: 'org/repo' });
    });

    it('extracts multiple PR URLs from one message', () => {
      const result = handler.extractPRUrls(
        'https://github.com/org/repo/pull/1 and https://github.com/org/repo/pull/2'
      );
      expect(result).toHaveLength(2);
    });

    it('deduplicates identical URLs in the same message', () => {
      const result = handler.extractPRUrls(
        'https://github.com/org/repo/pull/1 https://github.com/org/repo/pull/1'
      );
      expect(result).toHaveLength(1);
    });

    it('returns empty array for messages with no PR URLs', () => {
      expect(handler.extractPRUrls('just a regular message')).toHaveLength(0);
    });

    it('returns empty array for GitHub URLs that are not PRs', () => {
      expect(handler.extractPRUrls('https://github.com/org/repo/issues/1')).toHaveLength(0);
    });

    it('extracts full URL including in the result', () => {
      const result = handler.extractPRUrls('https://github.com/org/repo/pull/42');
      expect(result[0].url).toBe('https://github.com/org/repo/pull/42');
    });
  });

  describe('handleMessage', () => {
    it('adds a new PR to the store when a PR URL is posted', async () => {
      await handler.handleMessage('C001', '123.456', 'Check https://github.com/org/repo/pull/1', 'U001');
      expect(store.getTrackedPR('C001', 'https://github.com/org/repo/pull/1')).toBeDefined();
    });

    it('calls fetchPRState and posts initial thread reply for new PR', async () => {
      await handler.handleMessage('C001', '123.456', 'https://github.com/org/repo/pull/1', 'U001');
      expect(mockFetchPRState).toHaveBeenCalledWith('org', 'repo', 1, expect.any(Set));
      expect(mockPostThreadReply).toHaveBeenCalled();
    });

    it('does not add a duplicate PR URL in the same channel', async () => {
      await handler.handleMessage('C001', '123.456', 'https://github.com/org/repo/pull/1', 'U001');
      jest.clearAllMocks();
      await handler.handleMessage('C001', '789.012', 'https://github.com/org/repo/pull/1', 'U002');
      expect(mockFetchPRState).not.toHaveBeenCalled();
    });

    it('does not process messages with no PR URLs', async () => {
      await handler.handleMessage('C001', '123.456', 'just chatting', 'U001');
      expect(mockFetchPRState).not.toHaveBeenCalled();
    });

    it('stores the threadReplyTs returned by postThreadReply', async () => {
      mockPostThreadReply.mockResolvedValueOnce('999.000');
      await handler.handleMessage('C001', '123.456', 'https://github.com/org/repo/pull/1', 'U001');
      const tracked = store.getTrackedPR('C001', 'https://github.com/org/repo/pull/1');
      expect(tracked?.threadReplyTs).toBe('999.000');
    });
  });

  describe('handleSlashCommand', () => {
    it('config emoji: updates emoji config and confirms', () => {
      const result = handler.handleSlashCommand('C001', 'config emoji merged :tada:');
      expect(result.text).toContain('Updated');
      expect(store.getEmojiConfig('C001').merged).toBe('tada');
    });

    it('config emoji: rejects invalid emoji key', () => {
      const result = handler.handleSlashCommand('C001', 'config emoji unknown_key :tada:');
      expect(result.text.toLowerCase()).toContain('invalid');
    });

    it('config required-approvals: sets override and confirms', () => {
      const result = handler.handleSlashCommand('C001', 'config required-approvals 3');
      expect(result.text).toContain('3');
      expect(store.getRequiredApprovalsOverride('C001')).toBe(3);
    });

    it('config required-approvals: rejects non-numeric value', () => {
      const result = handler.handleSlashCommand('C001', 'config required-approvals abc');
      expect(result.text.toLowerCase()).toContain('invalid');
    });

    it('blocklist add: adds username and confirms', () => {
      const result = handler.handleSlashCommand('C001', 'blocklist add my-bot[bot]');
      expect(result.text).toContain('my-bot[bot]');
      expect(store.getBotBlocklist('C001').has('my-bot[bot]')).toBe(true);
    });

    it('blocklist list: lists hardcoded and custom bots', () => {
      store.addToBotBlocklist('C001', 'custom-bot');
      const result = handler.handleSlashCommand('C001', 'blocklist list');
      expect(result.text).toContain('custom-bot');
      expect(result.text).toContain('dependabot[bot]');
    });

    it('returns usage text for unknown subcommand', () => {
      const result = handler.handleSlashCommand('C001', 'unknown command');
      expect(result.text.toLowerCase()).toContain('usage');
    });
  });
});

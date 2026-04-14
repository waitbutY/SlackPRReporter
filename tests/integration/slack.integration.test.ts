import { buildApp } from '../../src/app';

jest.mock('../../src/clients/githubClient', () => ({
  GitHubClient: jest.fn().mockImplementation(() => ({
    fetchPRState: jest.fn().mockResolvedValue({
      state: { merged: false, closed: false, approvalCount: 1, reviewComments: [], ciStatus: 'passing' },
      baseBranch: 'main',
    }),
    getRequiredApprovals: jest.fn().mockResolvedValue(1),
  })),
}));

const mockAddReaction = jest.fn().mockResolvedValue(undefined);
const mockPostThreadReply = jest.fn().mockResolvedValue('555.666');
const mockGetJoinedChannels = jest.fn().mockResolvedValue([]);
jest.mock('../../src/clients/slackClient', () => ({
  SlackClient: jest.fn().mockImplementation(() => ({
    addReaction: mockAddReaction,
    removeReaction: jest.fn().mockResolvedValue(undefined),
    editMessage: jest.fn().mockResolvedValue(undefined),
    postThreadReply: mockPostThreadReply,
    postMessage: jest.fn().mockResolvedValue(undefined),
    getJoinedChannels: mockGetJoinedChannels,
  })),
}));

describe('Slack Handler Integration', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    jest.clearAllMocks();
    app = buildApp({
      slackBotToken: 'xoxb-test',
      slackSigningSecret: 'test-signing',
      githubAppId: '123',
      githubPrivateKey: 'fake-key',
      githubInstallationId: 456,
      githubWebhookSecret: 'wh-secret',
      port: 3002,
      tokenVerificationEnabled: false,
    });
  });

  it('buildApp returns boltApp, store, slackClient, and slackHandler', () => {
    expect(app.boltApp).toBeDefined();
    expect(app.store).toBeDefined();
    expect(app.slackClient).toBeDefined();
    expect(app.slackHandler).toBeDefined();
  });

  it('store starts with no tracked PRs for channel C001', () => {
    expect(app.store.getTrackedPR('C001', 'https://github.com/org/repo/pull/1')).toBeUndefined();
  });

  it('handleMessage: tracks a PR and posts initial thread reply', async () => {
    await app.slackHandler.handleMessage(
      'C001',
      '123.456',
      'https://github.com/org/repo/pull/7',
      'U001',
    );

    expect(app.store.getTrackedPR('C001', 'https://github.com/org/repo/pull/7')).toBeDefined();
    expect(mockPostThreadReply).toHaveBeenCalled();
  });
});

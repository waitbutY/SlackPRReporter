import request from 'supertest';
import crypto from 'node:crypto';
import { buildApp } from '../../src/app';
import { TrackedPR } from '../../src/types/index';

// Mock external clients
const mockFetchPRState = jest.fn().mockResolvedValue({
  state: { merged: true, closed: true, approvalCount: 2, reviewComments: [], ciStatus: 'passing' },
  baseBranch: 'main',
});
jest.mock('../../src/clients/githubClient', () => ({
  GitHubClient: jest.fn().mockImplementation(() => ({
    fetchPRState: mockFetchPRState,
    getRequiredApprovals: jest.fn().mockResolvedValue(2),
    getInstallationOctokit: jest.fn(),
  })),
}));

const mockAddReaction = jest.fn().mockResolvedValue(undefined);
const mockRemoveReaction = jest.fn().mockResolvedValue(undefined);
const mockEditMessage = jest.fn().mockResolvedValue(undefined);
const mockPostThreadReply = jest.fn().mockResolvedValue('555.666');
const mockPostMessage = jest.fn().mockResolvedValue(undefined);
const mockGetJoinedChannels = jest.fn().mockResolvedValue([]);
jest.mock('../../src/clients/slackClient', () => ({
  SlackClient: jest.fn().mockImplementation(() => ({
    addReaction: mockAddReaction,
    removeReaction: mockRemoveReaction,
    editMessage: mockEditMessage,
    postThreadReply: mockPostThreadReply,
    postMessage: mockPostMessage,
    getJoinedChannels: mockGetJoinedChannels,
  })),
}));

const WEBHOOK_SECRET = 'integration-test-secret';

function sign(body: string): string {
  return 'sha256=' + crypto.createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex');
}

describe('GitHub Webhook Integration', () => {
  let app: ReturnType<typeof buildApp>;
  let expressApp: any;

  beforeAll(() => {
    app = buildApp({
      slackBotToken: 'xoxb-test',
      slackSigningSecret: 'test-signing-secret',
      githubAppId: '123',
      githubPrivateKey: 'fake-key',
      githubInstallationId: 456,
      githubWebhookSecret: WEBHOOK_SECRET,
      port: 3001,
      tokenVerificationEnabled: false,
    });
    // Access the underlying express app via boltApp receiver
    expressApp = (app.boltApp as any).receiver.app;
  });

  beforeEach(() => {
    // Reset call counts without clearing mock implementations/return values
    mockFetchPRState.mockClear();
    mockAddReaction.mockClear();
    mockRemoveReaction.mockClear();
    mockEditMessage.mockClear();
    mockPostThreadReply.mockClear();
    mockPostMessage.mockClear();
    mockGetJoinedChannels.mockClear();
  });

  it('returns 200 for a valid webhook with correct signature', async () => {
    const body = JSON.stringify({
      action: 'closed',
      pull_request: { number: 1, base: { repo: { full_name: 'org/repo' } } },
    });
    const res = await request(expressApp)
      .post('/github')
      .set('Content-Type', 'application/json')
      .set('x-hub-signature-256', sign(body))
      .set('x-github-event', 'pull_request')
      .send(body);

    expect(res.status).toBe(200);
  });

  it('returns 401 for a webhook with invalid signature', async () => {
    const body = JSON.stringify({ action: 'closed' });
    const res = await request(expressApp)
      .post('/github')
      .set('Content-Type', 'application/json')
      .set('x-hub-signature-256', 'sha256=badsig')
      .set('x-github-event', 'pull_request')
      .send(body);

    expect(res.status).toBe(401);
  });

  it('triggers PR state fetch and Slack update for a tracked PR on pull_request.closed', async () => {
    // Pre-populate state with a tracked PR
    const trackedPR: TrackedPR = {
      prUrl: 'https://github.com/org/repo/pull/5',
      repoFullName: 'org/repo',
      prNumber: 5,
      baseBranch: 'main',
      slackMessageTs: '100.000',
      threadReplyTs: '200.000',
      requiredApprovals: 2,
      lastKnownState: null,
      activeEmojis: ['eyes'],
    };
    app.store.addTrackedPR('C001', trackedPR);

    const body = JSON.stringify({
      action: 'closed',
      pull_request: { number: 5, base: { repo: { full_name: 'org/repo' } } },
    });

    await request(expressApp)
      .post('/github')
      .set('Content-Type', 'application/json')
      .set('x-hub-signature-256', sign(body))
      .set('x-github-event', 'pull_request')
      .send(body);

    // Allow async handler to complete
    await new Promise(r => setTimeout(r, 50));

    expect(mockFetchPRState).toHaveBeenCalledWith('org', 'repo', 5, expect.any(Set));
    expect(mockEditMessage).toHaveBeenCalled();
  });

  it('returns 200 for /healthz', async () => {
    const res = await request(expressApp).get('/healthz');
    expect(res.status).toBe(200);
  });
});

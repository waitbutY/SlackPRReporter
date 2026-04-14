import { SlackClient } from '../../src/clients/slackClient';

const mockReactionsAdd = jest.fn().mockResolvedValue({ ok: true });
const mockReactionsRemove = jest.fn().mockResolvedValue({ ok: true });
const mockChatPostMessage = jest.fn().mockResolvedValue({ ok: true, ts: '111.222' });
const mockChatUpdate = jest.fn().mockResolvedValue({ ok: true });
const mockConversationsList = jest.fn().mockResolvedValue({
  ok: true,
  channels: [{ id: 'C001' }, { id: 'C002' }],
  response_metadata: { next_cursor: '' },
});

jest.mock('@slack/web-api', () => ({
  WebClient: jest.fn().mockImplementation(() => ({
    reactions: { add: mockReactionsAdd, remove: mockReactionsRemove },
    chat: { postMessage: mockChatPostMessage, update: mockChatUpdate },
    conversations: { list: mockConversationsList },
  })),
}));

describe('SlackClient', () => {
  let client: SlackClient;

  beforeEach(() => {
    jest.clearAllMocks();
    client = new SlackClient('xoxb-fake-token');
  });

  describe('addReaction', () => {
    it('calls reactions.add with correct params', async () => {
      await client.addReaction('C001', '1234.5678', 'eyes');
      expect(mockReactionsAdd).toHaveBeenCalledWith({
        channel: 'C001',
        timestamp: '1234.5678',
        name: 'eyes',
      });
    });

    it('does not throw if reaction already exists (already_reacted)', async () => {
      mockReactionsAdd.mockRejectedValueOnce({ data: { error: 'already_reacted' } });
      await expect(client.addReaction('C001', '1234.5678', 'eyes')).resolves.not.toThrow();
    });
  });

  describe('removeReaction', () => {
    it('calls reactions.remove with correct params', async () => {
      await client.removeReaction('C001', '1234.5678', 'eyes');
      expect(mockReactionsRemove).toHaveBeenCalledWith({
        channel: 'C001',
        timestamp: '1234.5678',
        name: 'eyes',
      });
    });

    it('does not throw if reaction does not exist (no_reaction)', async () => {
      mockReactionsRemove.mockRejectedValueOnce({ data: { error: 'no_reaction' } });
      await expect(client.removeReaction('C001', '1234.5678', 'eyes')).resolves.not.toThrow();
    });
  });

  describe('postThreadReply', () => {
    it('calls chat.postMessage with thread_ts and returns the new TS', async () => {
      mockChatPostMessage.mockResolvedValueOnce({ ok: true, ts: '999.000' });
      const ts = await client.postThreadReply('C001', '1234.5678', 'hello');
      expect(mockChatPostMessage).toHaveBeenCalledWith({
        channel: 'C001',
        thread_ts: '1234.5678',
        text: 'hello',
      });
      expect(ts).toBe('999.000');
    });
  });

  describe('editMessage', () => {
    it('calls chat.update with correct params', async () => {
      await client.editMessage('C001', '999.000', 'updated text');
      expect(mockChatUpdate).toHaveBeenCalledWith({
        channel: 'C001',
        ts: '999.000',
        text: 'updated text',
      });
    });
  });

  describe('postMessage', () => {
    it('calls chat.postMessage without thread_ts', async () => {
      await client.postMessage('C001', 'hello channel');
      expect(mockChatPostMessage).toHaveBeenCalledWith({
        channel: 'C001',
        text: 'hello channel',
      });
    });
  });

  describe('getJoinedChannels', () => {
    it('returns all channel IDs from conversations.list', async () => {
      const channels = await client.getJoinedChannels();
      expect(channels).toEqual(['C001', 'C002']);
    });
  });
});

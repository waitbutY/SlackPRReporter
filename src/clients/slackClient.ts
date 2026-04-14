import { WebClient } from '@slack/web-api';

export class SlackClient {
  private web: WebClient;

  constructor(token: string) {
    this.web = new WebClient(token);
  }

  async addReaction(channelId: string, messageTs: string, emoji: string): Promise<void> {
    try {
      await this.web.reactions.add({ channel: channelId, timestamp: messageTs, name: emoji });
    } catch (err: any) {
      if (err?.data?.error === 'already_reacted') return;
      throw err;
    }
  }

  async removeReaction(channelId: string, messageTs: string, emoji: string): Promise<void> {
    try {
      await this.web.reactions.remove({ channel: channelId, timestamp: messageTs, name: emoji });
    } catch (err: any) {
      if (err?.data?.error === 'no_reaction') return;
      throw err;
    }
  }

  async postThreadReply(channelId: string, messageTs: string, text: string): Promise<string> {
    const result = await this.web.chat.postMessage({
      channel: channelId,
      thread_ts: messageTs,
      text,
    });
    return result.ts as string;
  }

  async editMessage(channelId: string, messageTs: string, text: string): Promise<void> {
    await this.web.chat.update({ channel: channelId, ts: messageTs, text });
  }

  async postMessage(channelId: string, text: string): Promise<void> {
    await this.web.chat.postMessage({ channel: channelId, text });
  }

  async getJoinedChannels(): Promise<string[]> {
    const result = await this.web.conversations.list({ types: 'public_channel,private_channel' });
    return ((result.channels ?? []) as { id: string }[]).map(c => c.id);
  }
}

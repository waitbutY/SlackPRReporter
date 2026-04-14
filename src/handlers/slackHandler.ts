import { StateStore } from '../store/stateStore.js';
import { PRStatusService } from '../services/prStatusService.js';
import { GitHubClient } from '../clients/githubClient.js';
import { SlackClient } from '../clients/slackClient.js';
import { ParsedPRUrl, SlashCommandResult } from '../types/index.js';
import { VALID_EMOJI_KEYS } from '../config/defaults.js';

const PR_URL_REGEX = /https:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/pull\/(\d+)/g;

export class SlackHandler {
  constructor(
    private store: StateStore,
    private prService: PRStatusService,
    private ghClient: GitHubClient,
    private slackClient: SlackClient,
  ) {}

  extractPRUrls(text: string): ParsedPRUrl[] {
    const seen = new Set<string>();
    const results: ParsedPRUrl[] = [];
    let match: RegExpExecArray | null;
    PR_URL_REGEX.lastIndex = 0;
    while ((match = PR_URL_REGEX.exec(text)) !== null) {
      const [url, owner, repo, prNumberStr] = match;
      if (seen.has(url)) continue;
      seen.add(url);
      results.push({
        url,
        owner,
        repo,
        repoFullName: `${owner}/${repo}`,
        prNumber: parseInt(prNumberStr, 10),
      });
    }
    return results;
  }

  async handleMessage(
    channelId: string,
    messageTs: string,
    text: string,
    _userId: string,
  ): Promise<void> {
    const prs = this.extractPRUrls(text);
    if (prs.length === 0) return;

    for (const parsed of prs) {
      const added = this.store.addTrackedPR(channelId, {
        prUrl: parsed.url,
        repoFullName: parsed.repoFullName,
        prNumber: parsed.prNumber,
        baseBranch: '',
        slackMessageTs: messageTs,
        threadReplyTs: null,
        requiredApprovals: 1,
        lastKnownState: null,
        activeEmojis: [],
      });

      if (!added) continue;

      const blocklist = this.store.getBotBlocklist(channelId);
      const { state, baseBranch } = await this.ghClient.fetchPRState(
        parsed.owner, parsed.repo, parsed.prNumber, blocklist,
      );

      const channelOverride = this.store.getRequiredApprovalsOverride(channelId);
      const requiredApprovals = await this.ghClient.getRequiredApprovals(
        parsed.owner, parsed.repo, baseBranch, channelOverride ?? 1,
      );

      this.store.updateTrackedPR(channelId, parsed.url, { baseBranch, requiredApprovals });

      const config = this.store.getEmojiConfig(channelId);
      const emojis = this.prService.computeEmojis(state, requiredApprovals, config);

      await Promise.allSettled(
        emojis.map(e => this.slackClient.addReaction(channelId, messageTs, e))
      );

      const threadText = this.prService.formatThreadText(state, requiredApprovals);
      const threadTs = await this.slackClient.postThreadReply(channelId, messageTs, threadText);

      this.store.updateTrackedPR(channelId, parsed.url, {
        threadReplyTs: threadTs,
        lastKnownState: state,
        activeEmojis: emojis,
      });
    }
  }

  handleSlashCommand(channelId: string, text: string): SlashCommandResult {
    const parts = text.trim().split(/\s+/);
    const [subcommand, ...args] = parts;

    switch (subcommand) {
      case 'config':
        return this.handleConfig(channelId, args);
      case 'blocklist':
        return this.handleBlocklist(channelId, args);
      default:
        return {
          text: 'Usage:\n`/prbot config emoji <key> <:emoji:>`\n`/prbot config required-approvals <n>`\n`/prbot blocklist add <github-username>`\n`/prbot blocklist list`',
        };
    }
  }

  private handleConfig(channelId: string, args: string[]): SlashCommandResult {
    const [setting, ...rest] = args;

    if (setting === 'emoji') {
      const [key, emojiRaw] = rest;
      if (!key || !VALID_EMOJI_KEYS.has(key as any)) {
        return { text: `Invalid emoji key. Valid keys: ${[...VALID_EMOJI_KEYS].join(', ')}` };
      }
      const emojiName = emojiRaw?.replace(/^:|:$/g, '');
      if (!emojiName) {
        return { text: 'Invalid emoji. Usage: `/prbot config emoji <key> <:emoji:>`' };
      }
      this.store.setEmojiConfigKey(channelId, key as any, emojiName);
      return { text: `Updated: \`${key}\` → :${emojiName}:` };
    }

    if (setting === 'required-approvals') {
      const n = parseInt(rest[0], 10);
      if (isNaN(n) || n < 1) {
        return { text: 'Invalid value. Usage: `/prbot config required-approvals <number>`' };
      }
      this.store.setRequiredApprovalsOverride(channelId, n);
      return { text: `Required approvals set to ${n} for this channel.` };
    }

    return { text: 'Unknown config setting. Use `emoji` or `required-approvals`.' };
  }

  private handleBlocklist(channelId: string, args: string[]): SlashCommandResult {
    const [action, username] = args;

    if (action === 'add') {
      if (!username) {
        return { text: 'Usage: `/prbot blocklist add <github-username>`' };
      }
      this.store.addToBotBlocklist(channelId, username);
      return { text: `Added \`${username}\` to the bot blocklist for this channel.` };
    }

    if (action === 'list') {
      const allBots = [...this.store.getBotBlocklist(channelId)];
      return {
        text: `*Bot blocklist for this channel:*\n${allBots.map(b => `• \`${b}\``).join('\n')}`,
      };
    }

    return { text: 'Usage: `/prbot blocklist add <username>` or `/prbot blocklist list`' };
  }
}

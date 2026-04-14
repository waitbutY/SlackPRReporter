import { TrackedPR, EmojiConfig, EmojiKey } from '../types/index.js';
import { DEFAULT_EMOJI_CONFIG, HARDCODED_BOT_BLOCKLIST } from '../config/defaults.js';

export class StateStore {
  private trackedPRs: Map<string, Map<string, TrackedPR>> = new Map();
  private emojiConfigs: Map<string, Partial<EmojiConfig>> = new Map();
  private customBotBlocklists: Map<string, Set<string>> = new Map();
  private requiredApprovalsOverrides: Map<string, number> = new Map();
  private prToChannels: Map<string, Set<string>> = new Map();

  private prKey(repoFullName: string, prNumber: number): string {
    return `${repoFullName}#${prNumber}`;
  }

  addTrackedPR(channelId: string, pr: TrackedPR): boolean {
    if (!this.trackedPRs.has(channelId)) {
      this.trackedPRs.set(channelId, new Map());
    }
    const channelPRs = this.trackedPRs.get(channelId)!;
    if (channelPRs.has(pr.prUrl)) {
      return false;
    }
    channelPRs.set(pr.prUrl, { ...pr });

    const key = this.prKey(pr.repoFullName, pr.prNumber);
    if (!this.prToChannels.has(key)) {
      this.prToChannels.set(key, new Set());
    }
    this.prToChannels.get(key)!.add(channelId);

    return true;
  }

  getTrackedPR(channelId: string, prUrl: string): TrackedPR | undefined {
    return this.trackedPRs.get(channelId)?.get(prUrl);
  }

  updateTrackedPR(channelId: string, prUrl: string, updates: Partial<TrackedPR>): void {
    const pr = this.trackedPRs.get(channelId)?.get(prUrl);
    if (pr) {
      Object.assign(pr, updates);
    }
  }

  getChannelsForPR(repoFullName: string, prNumber: number): string[] {
    return Array.from(this.prToChannels.get(this.prKey(repoFullName, prNumber)) ?? []);
  }

  getAllTrackedChannels(): string[] {
    return Array.from(this.trackedPRs.keys());
  }

  getEmojiConfig(channelId: string): EmojiConfig {
    const overrides = this.emojiConfigs.get(channelId) ?? {};
    return { ...DEFAULT_EMOJI_CONFIG, ...overrides };
  }

  setEmojiConfigKey(channelId: string, key: EmojiKey, value: string): void {
    if (!this.emojiConfigs.has(channelId)) {
      this.emojiConfigs.set(channelId, {});
    }
    this.emojiConfigs.get(channelId)![key] = value;
  }

  getRequiredApprovalsOverride(channelId: string): number | undefined {
    return this.requiredApprovalsOverrides.get(channelId);
  }

  setRequiredApprovalsOverride(channelId: string, n: number): void {
    this.requiredApprovalsOverrides.set(channelId, n);
  }

  getBotBlocklist(channelId: string): Set<string> {
    const custom = this.customBotBlocklists.get(channelId) ?? new Set<string>();
    return new Set([...HARDCODED_BOT_BLOCKLIST, ...custom]);
  }

  addToBotBlocklist(channelId: string, username: string): void {
    if (!this.customBotBlocklists.has(channelId)) {
      this.customBotBlocklists.set(channelId, new Set());
    }
    this.customBotBlocklists.get(channelId)!.add(username);
  }

  getCustomBotBlocklist(channelId: string): string[] {
    return Array.from(this.customBotBlocklists.get(channelId) ?? []);
  }
}

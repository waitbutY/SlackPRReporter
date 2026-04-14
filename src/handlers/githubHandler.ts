import crypto from 'node:crypto';
import { StateStore } from '../store/stateStore.js';
import { PRStatusService } from '../services/prStatusService.js';
import { SlackClient } from '../clients/slackClient.js';
import { GitHubClient } from '../clients/githubClient.js';
import { PRState } from '../types/index.js';

export class GitHubHandler {
  constructor(
    private store: StateStore,
    private prService: PRStatusService,
    private slackClient: SlackClient,
    private ghClient: GitHubClient,
    private webhookSecret: string,
  ) {}

  verifySignature(rawBody: string, signature: string): boolean {
    if (!signature) return false;
    try {
      const digest = 'sha256=' + crypto.createHmac('sha256', this.webhookSecret).update(rawBody).digest('hex');
      return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(signature));
    } catch {
      return false;
    }
  }

  async handleWebhook(eventType: string, payload: unknown): Promise<void> {
    const p = payload as any;

    switch (eventType) {
      case 'pull_request': {
        const { action, pull_request: pr } = p;
        if (!['closed', 'reopened', 'opened'].includes(action)) return;
        await this.updatePR(pr.base.repo.full_name, pr.number);
        break;
      }
      case 'pull_request_review': {
        const { action, pull_request: pr } = p;
        if (!['submitted', 'dismissed'].includes(action)) return;
        await this.updatePR(pr.base.repo.full_name, pr.number);
        break;
      }
      case 'pull_request_review_thread': {
        const { action, pull_request: pr } = p;
        if (!['resolved', 'unresolved'].includes(action)) return;
        await this.updatePR(pr.base.repo.full_name, pr.number);
        break;
      }
      case 'pull_request_review_comment': {
        const { pull_request: pr } = p;
        await this.updatePR(pr.base.repo.full_name, pr.number);
        break;
      }
      case 'check_run': {
        const { action, check_run } = p;
        if (action !== 'completed') return;
        for (const pr of check_run.pull_requests ?? []) {
          await this.updatePR(pr.base.repo.full_name, pr.number);
        }
        break;
      }
      case 'check_suite': {
        const { action, check_suite } = p;
        if (action !== 'completed') return;
        for (const pr of check_suite.pull_requests ?? []) {
          await this.updatePR(pr.base.repo.full_name, pr.number);
        }
        break;
      }
      case 'status':
        // status events don't carry a PR number directly; no-op
        break;
      default:
        break;
    }
  }

  private async updatePR(repoFullName: string, prNumber: number): Promise<void> {
    const [owner, repo] = repoFullName.split('/');
    const channelIds = this.store.getChannelsForPR(repoFullName, prNumber);
    if (channelIds.length === 0) return;

    for (const channelId of channelIds) {
      const prUrl = `https://github.com/${repoFullName}/pull/${prNumber}`;
      const tracked = this.store.getTrackedPR(channelId, prUrl);
      if (!tracked) continue;

      const blocklist = this.store.getBotBlocklist(channelId);
      const { state: newState, baseBranch } = await this.ghClient.fetchPRState(
        owner, repo, prNumber, blocklist,
      );

      if (this.statesEqual(tracked.lastKnownState, newState) && tracked.threadReplyTs) {
        continue;
      }

      const config = this.store.getEmojiConfig(channelId);
      const newEmojis = this.prService.computeEmojis(newState, tracked.requiredApprovals, config);
      const { add, remove } = this.prService.diffEmojis(tracked.activeEmojis, newEmojis);

      await Promise.all([
        ...add.map(e => this.slackClient.addReaction(channelId, tracked.slackMessageTs, e)),
        ...remove.map(e => this.slackClient.removeReaction(channelId, tracked.slackMessageTs, e)),
      ]);

      const threadText = this.prService.formatThreadText(newState, tracked.requiredApprovals);

      if (tracked.threadReplyTs) {
        await this.slackClient.editMessage(channelId, tracked.threadReplyTs, threadText);
      } else {
        const newTs = await this.slackClient.postThreadReply(channelId, tracked.slackMessageTs, threadText);
        this.store.updateTrackedPR(channelId, prUrl, { threadReplyTs: newTs });
      }

      this.store.updateTrackedPR(channelId, prUrl, {
        lastKnownState: newState,
        activeEmojis: newEmojis,
        baseBranch,
      });
    }
  }

  private statesEqual(a: PRState | null, b: PRState): boolean {
    if (!a) return false;
    return JSON.stringify(a) === JSON.stringify(b);
  }
}

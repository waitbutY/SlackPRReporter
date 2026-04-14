import crypto from 'node:crypto';
import { StateStore } from '../store/stateStore.js';
import { PRStatusService } from '../services/prStatusService.js';
import { SlackClient } from '../clients/slackClient.js';
import { GitHubClient } from '../clients/githubClient.js';
import { PRState } from '../types/index.js';
import { logger } from '../logger.js';

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
      if (digest.length !== signature.length) return false;
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
      case 'status': {
        // NOTE: Commit status events do not carry a PR number. Resolving the PR from
        // a commit SHA requires an extra API call (GET /repos/{owner}/{repo}/commits/{sha}/pulls)
        // which is not implemented. Repositories using commit statuses (legacy CI integrations,
        // many third-party CI tools) will not have CI state reflected in thread replies.
        // PRs using Check Runs (GitHub Actions, most modern CI) are fully supported via
        // check_run / check_suite events.
        logger.debug({ event: 'status' }, 'status events not implemented — no PR number in payload');
        break;
      }
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
      let fetchResult: { state: PRState; baseBranch: string };
      try {
        fetchResult = await this.ghClient.fetchPRState(owner, repo, prNumber, blocklist);
      } catch (err) {
        logger.error({ err }, `Failed to fetch PR state for ${repoFullName}#${prNumber}`);
        continue;
      }
      const { state: newState, baseBranch } = fetchResult;

      if (this.statesEqual(tracked.lastKnownState, newState) && tracked.threadReplyTs) {
        continue;
      }

      const config = this.store.getEmojiConfig(channelId);
      const newEmojis = this.prService.computeEmojis(newState, tracked.requiredApprovals, config);
      const { add, remove } = this.prService.diffEmojis(tracked.activeEmojis, newEmojis);

      await Promise.allSettled([
        ...add.map(e => this.slackClient.addReaction(channelId, tracked.slackMessageTs, e)),
        ...remove.map(e => this.slackClient.removeReaction(channelId, tracked.slackMessageTs, e)),
      ]);

      const threadText = this.prService.formatThreadText(newState, tracked.requiredApprovals);

      let threadReplyTs = tracked.threadReplyTs;
      if (threadReplyTs) {
        await this.slackClient.editMessage(channelId, threadReplyTs, threadText);
      } else {
        threadReplyTs = await this.slackClient.postThreadReply(channelId, tracked.slackMessageTs, threadText);
      }

      this.store.updateTrackedPR(channelId, prUrl, {
        threadReplyTs,
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

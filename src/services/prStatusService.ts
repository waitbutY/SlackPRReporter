import { PRState, EmojiConfig } from '../types/index.js';

export class PRStatusService {
  computeEmojis(state: PRState, requiredApprovals: number, config: EmojiConfig): string[] {
    if (state.merged) {
      const emojis = [config.merged];
      if (state.reviewComments.some(c => c.open > 0)) {
        emojis.push(config.hasOpenComments);
      }
      return emojis;
    }

    if (state.closed) {
      return [config.closed];
    }

    const emojis: string[] = [];

    if (state.approvalCount >= requiredApprovals) {
      emojis.push(config.approved);
    } else {
      emojis.push(config.needsReview);
    }

    switch (state.ciStatus) {
      case 'passing':
        emojis.push(config.ciPassing);
        break;
      case 'failing':
        emojis.push(config.ciFailing);
        break;
      case 'pending':
        emojis.push(config.ciPending);
        break;
    }

    if (state.reviewComments.some(c => c.open > 0)) {
      emojis.push(config.hasOpenComments);
    }

    return emojis;
  }

  diffEmojis(
    oldEmojis: string[],
    newEmojis: string[],
  ): { add: string[]; remove: string[] } {
    const oldSet = new Set(oldEmojis);
    const newSet = new Set(newEmojis);
    return {
      add: newEmojis.filter(e => !oldSet.has(e)),
      remove: oldEmojis.filter(e => !newSet.has(e)),
    };
  }

  formatThreadText(state: PRState, requiredApprovals: number): string {
    const lines: string[] = [];

    if (state.merged) {
      lines.push('*Status:* Merged ✅');
    } else if (state.closed) {
      lines.push('*Status:* Closed ❌');
    }

    lines.push(`*Reviews:* ${state.approvalCount} / ${requiredApprovals} approved`);

    const openComments = state.reviewComments.filter(c => c.open > 0);
    if (openComments.length > 0) {
      lines.push('*Open conversations:*');
      for (const comment of openComments) {
        lines.push(`  • @${comment.user}: ${comment.open} open, ${comment.resolved} resolved`);
      }
    }

    const ciLabels: Record<string, string> = {
      passing: 'passing 🟢',
      failing: 'failing 🔴',
      pending: 'pending 🟡',
      none: 'none',
    };
    lines.push(`*CI:* ${ciLabels[state.ciStatus]}`);

    return lines.join('\n');
  }
}

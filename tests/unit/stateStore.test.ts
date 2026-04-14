import { StateStore } from '../../src/store/stateStore';
import { TrackedPR } from '../../src/types/index';
import { DEFAULT_EMOJI_CONFIG, HARDCODED_BOT_BLOCKLIST } from '../../src/config/defaults';

const makePR = (overrides: Partial<TrackedPR> = {}): TrackedPR => ({
  prUrl: 'https://github.com/org/repo/pull/1',
  repoFullName: 'org/repo',
  prNumber: 1,
  baseBranch: 'main',
  slackMessageTs: '1234567890.000100',
  threadReplyTs: null,
  requiredApprovals: 1,
  lastKnownState: null,
  activeEmojis: [],
  ...overrides,
});

describe('StateStore', () => {
  let store: StateStore;

  beforeEach(() => {
    store = new StateStore();
  });

  describe('addTrackedPR', () => {
    it('returns true when adding a new PR', () => {
      expect(store.addTrackedPR('C001', makePR())).toBe(true);
    });

    it('returns false when adding a duplicate PR URL in the same channel', () => {
      store.addTrackedPR('C001', makePR());
      expect(store.addTrackedPR('C001', makePR())).toBe(false);
    });

    it('allows same PR URL in different channels', () => {
      store.addTrackedPR('C001', makePR());
      expect(store.addTrackedPR('C002', makePR())).toBe(true);
    });

    it('does not double-register in the reverse index on duplicate add', () => {
      store.addTrackedPR('C001', makePR());
      store.addTrackedPR('C001', makePR()); // duplicate — should be ignored
      expect(store.getChannelsForPR('org/repo', 1)).toHaveLength(1);
    });
  });

  describe('getTrackedPR', () => {
    it('returns the PR after adding it', () => {
      const pr = makePR();
      store.addTrackedPR('C001', pr);
      expect(store.getTrackedPR('C001', pr.prUrl)).toEqual(pr);
    });

    it('returns undefined for unknown channel', () => {
      expect(store.getTrackedPR('C999', 'https://github.com/org/repo/pull/1')).toBeUndefined();
    });

    it('returns undefined for unknown PR URL', () => {
      store.addTrackedPR('C001', makePR());
      expect(store.getTrackedPR('C001', 'https://github.com/org/repo/pull/99')).toBeUndefined();
    });
  });

  describe('updateTrackedPR', () => {
    it('updates fields on an existing PR', () => {
      const pr = makePR();
      store.addTrackedPR('C001', pr);
      store.updateTrackedPR('C001', pr.prUrl, { threadReplyTs: '111.222' });
      expect(store.getTrackedPR('C001', pr.prUrl)?.threadReplyTs).toBe('111.222');
    });

    it('is a no-op for unknown PR', () => {
      expect(() => store.updateTrackedPR('C001', 'unknown', { threadReplyTs: '1' })).not.toThrow();
    });
  });

  describe('getChannelsForPR', () => {
    it('returns all channels tracking a given repo+prNumber', () => {
      store.addTrackedPR('C001', makePR());
      store.addTrackedPR('C002', makePR());
      const channels = store.getChannelsForPR('org/repo', 1);
      expect(channels).toHaveLength(2);
      expect(channels).toContain('C001');
      expect(channels).toContain('C002');
    });

    it('returns empty array for untracked PR', () => {
      expect(store.getChannelsForPR('org/repo', 999)).toEqual([]);
    });
  });

  describe('getAllTrackedChannels', () => {
    it('returns all channels that have at least one tracked PR', () => {
      store.addTrackedPR('C001', makePR({ prUrl: 'https://github.com/org/repo/pull/1', prNumber: 1 }));
      store.addTrackedPR('C002', makePR({ prUrl: 'https://github.com/org/repo/pull/2', prNumber: 2 }));
      const channels = store.getAllTrackedChannels();
      expect(channels).toHaveLength(2);
    });

    it('returns empty array when nothing tracked', () => {
      expect(store.getAllTrackedChannels()).toEqual([]);
    });
  });

  describe('emoji config', () => {
    it('returns DEFAULT_EMOJI_CONFIG for a channel with no overrides', () => {
      expect(store.getEmojiConfig('C001')).toEqual(DEFAULT_EMOJI_CONFIG);
    });

    it('applies a per-channel override', () => {
      store.setEmojiConfigKey('C001', 'merged', 'tada');
      expect(store.getEmojiConfig('C001').merged).toBe('tada');
    });

    it('does not affect other keys when one is overridden', () => {
      store.setEmojiConfigKey('C001', 'merged', 'tada');
      expect(store.getEmojiConfig('C001').approved).toBe(DEFAULT_EMOJI_CONFIG.approved);
    });
  });

  describe('required approvals override', () => {
    it('returns undefined when no override is set', () => {
      expect(store.getRequiredApprovalsOverride('C001')).toBeUndefined();
    });

    it('returns the override after setting it', () => {
      store.setRequiredApprovalsOverride('C001', 3);
      expect(store.getRequiredApprovalsOverride('C001')).toBe(3);
    });
  });

  describe('removeTrackedPR', () => {
    it('removes a tracked PR from the store', () => {
      store.addTrackedPR('C001', makePR());
      store.removeTrackedPR('C001', 'https://github.com/org/repo/pull/1');
      expect(store.getTrackedPR('C001', 'https://github.com/org/repo/pull/1')).toBeUndefined();
    });

    it('removes the PR from the reverse index', () => {
      store.addTrackedPR('C001', makePR());
      store.removeTrackedPR('C001', 'https://github.com/org/repo/pull/1');
      // Adding same PR again should succeed (not treated as duplicate)
      const added = store.addTrackedPR('C001', makePR());
      expect(added).toBe(true);
    });
  });

  describe('bot blocklist', () => {
    it('always includes hardcoded bots', () => {
      const list = store.getBotBlocklist('C001');
      for (const bot of HARDCODED_BOT_BLOCKLIST) {
        expect(list.has(bot)).toBe(true);
      }
    });

    it('includes custom additions', () => {
      store.addToBotBlocklist('C001', 'my-review-bot[bot]');
      expect(store.getBotBlocklist('C001').has('my-review-bot[bot]')).toBe(true);
    });

    it('getCustomBotBlocklist returns only channel-specific additions', () => {
      store.addToBotBlocklist('C001', 'my-bot');
      expect(store.getCustomBotBlocklist('C001')).toContain('my-bot');
      expect(store.getCustomBotBlocklist('C001')).not.toContain('dependabot[bot]');
    });

    it('custom additions in one channel do not affect another', () => {
      store.addToBotBlocklist('C001', 'my-bot');
      expect(store.getBotBlocklist('C002').has('my-bot')).toBe(false);
    });
  });
});

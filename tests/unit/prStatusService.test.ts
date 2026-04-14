import { PRStatusService } from '../../src/services/prStatusService';
import { PRState, EmojiConfig } from '../../src/types/index';
import { DEFAULT_EMOJI_CONFIG } from '../../src/config/defaults';

const service = new PRStatusService();

const makeState = (overrides: Partial<PRState> = {}): PRState => ({
  merged: false,
  closed: false,
  approvalCount: 0,
  reviewComments: [],
  ciStatus: 'none',
  ...overrides,
});

describe('PRStatusService.computeEmojis', () => {
  it('returns merged emoji when PR is merged', () => {
    const emojis = service.computeEmojis(makeState({ merged: true }), 1, DEFAULT_EMOJI_CONFIG);
    expect(emojis).toContain(DEFAULT_EMOJI_CONFIG.merged);
  });

  it('returns closed emoji when PR is closed but not merged', () => {
    const emojis = service.computeEmojis(makeState({ closed: true, merged: false }), 1, DEFAULT_EMOJI_CONFIG);
    expect(emojis).toContain(DEFAULT_EMOJI_CONFIG.closed);
  });

  it('does not return merged emoji for a closed-not-merged PR', () => {
    const emojis = service.computeEmojis(makeState({ closed: true, merged: false }), 1, DEFAULT_EMOJI_CONFIG);
    expect(emojis).not.toContain(DEFAULT_EMOJI_CONFIG.merged);
  });

  it('returns needsReview when approvals < required', () => {
    const emojis = service.computeEmojis(makeState({ approvalCount: 0 }), 2, DEFAULT_EMOJI_CONFIG);
    expect(emojis).toContain(DEFAULT_EMOJI_CONFIG.needsReview);
    expect(emojis).not.toContain(DEFAULT_EMOJI_CONFIG.approved);
  });

  it('returns approved when approvals >= required', () => {
    const emojis = service.computeEmojis(makeState({ approvalCount: 2 }), 2, DEFAULT_EMOJI_CONFIG);
    expect(emojis).toContain(DEFAULT_EMOJI_CONFIG.approved);
    expect(emojis).not.toContain(DEFAULT_EMOJI_CONFIG.needsReview);
  });

  it('returns ciPassing emoji when CI is passing', () => {
    const emojis = service.computeEmojis(makeState({ ciStatus: 'passing' }), 1, DEFAULT_EMOJI_CONFIG);
    expect(emojis).toContain(DEFAULT_EMOJI_CONFIG.ciPassing);
  });

  it('returns ciFailing emoji when CI is failing', () => {
    const emojis = service.computeEmojis(makeState({ ciStatus: 'failing' }), 1, DEFAULT_EMOJI_CONFIG);
    expect(emojis).toContain(DEFAULT_EMOJI_CONFIG.ciFailing);
  });

  it('returns ciPending emoji when CI is pending', () => {
    const emojis = service.computeEmojis(makeState({ ciStatus: 'pending' }), 1, DEFAULT_EMOJI_CONFIG);
    expect(emojis).toContain(DEFAULT_EMOJI_CONFIG.ciPending);
  });

  it('returns no CI emoji when CI status is none', () => {
    const emojis = service.computeEmojis(makeState({ ciStatus: 'none' }), 1, DEFAULT_EMOJI_CONFIG);
    expect(emojis).not.toContain(DEFAULT_EMOJI_CONFIG.ciPassing);
    expect(emojis).not.toContain(DEFAULT_EMOJI_CONFIG.ciFailing);
    expect(emojis).not.toContain(DEFAULT_EMOJI_CONFIG.ciPending);
  });

  it('returns hasOpenComments when any reviewer has open comments', () => {
    const state = makeState({ reviewComments: [{ user: 'alice', open: 2, resolved: 0 }] });
    const emojis = service.computeEmojis(state, 1, DEFAULT_EMOJI_CONFIG);
    expect(emojis).toContain(DEFAULT_EMOJI_CONFIG.hasOpenComments);
  });

  it('does not return hasOpenComments when all comments are resolved', () => {
    const state = makeState({ reviewComments: [{ user: 'alice', open: 0, resolved: 2 }] });
    const emojis = service.computeEmojis(state, 1, DEFAULT_EMOJI_CONFIG);
    expect(emojis).not.toContain(DEFAULT_EMOJI_CONFIG.hasOpenComments);
  });

  it('uses channel-specific emoji config', () => {
    const config: EmojiConfig = { ...DEFAULT_EMOJI_CONFIG, merged: 'tada' };
    const emojis = service.computeEmojis(makeState({ merged: true }), 1, config);
    expect(emojis).toContain('tada');
    expect(emojis).not.toContain('white_check_mark');
  });

  it('no review or CI emojis for merged PR (merged takes precedence)', () => {
    const state = makeState({ merged: true, approvalCount: 0, ciStatus: 'failing' });
    const emojis = service.computeEmojis(state, 2, DEFAULT_EMOJI_CONFIG);
    expect(emojis).toContain(DEFAULT_EMOJI_CONFIG.merged);
    expect(emojis).not.toContain(DEFAULT_EMOJI_CONFIG.needsReview);
    expect(emojis).not.toContain(DEFAULT_EMOJI_CONFIG.ciFailing);
  });
});

describe('PRStatusService.diffEmojis', () => {
  it('returns emojis to add when new set has more', () => {
    const diff = service.diffEmojis(['eyes'], ['eyes', 'green_circle']);
    expect(diff.add).toEqual(['green_circle']);
    expect(diff.remove).toEqual([]);
  });

  it('returns emojis to remove when old set has more', () => {
    const diff = service.diffEmojis(['eyes', 'green_circle'], ['eyes']);
    expect(diff.add).toEqual([]);
    expect(diff.remove).toEqual(['green_circle']);
  });

  it('returns both add and remove for changed sets', () => {
    const diff = service.diffEmojis(['eyes'], ['green_circle']);
    expect(diff.add).toEqual(['green_circle']);
    expect(diff.remove).toEqual(['eyes']);
  });

  it('returns empty diff for identical sets', () => {
    const diff = service.diffEmojis(['eyes', 'green_circle'], ['eyes', 'green_circle']);
    expect(diff.add).toEqual([]);
    expect(diff.remove).toEqual([]);
  });
});

describe('PRStatusService.formatThreadText', () => {
  it('shows approval count and required', () => {
    const text = service.formatThreadText(makeState({ approvalCount: 1 }), 2);
    expect(text).toContain('1 / 2');
  });

  it('shows CI status passing', () => {
    const text = service.formatThreadText(makeState({ ciStatus: 'passing' }), 1);
    expect(text.toLowerCase()).toContain('passing');
  });

  it('shows CI status failing', () => {
    const text = service.formatThreadText(makeState({ ciStatus: 'failing' }), 1);
    expect(text.toLowerCase()).toContain('failing');
  });

  it('shows CI status pending', () => {
    const text = service.formatThreadText(makeState({ ciStatus: 'pending' }), 1);
    expect(text.toLowerCase()).toContain('pending');
  });

  it('shows open comment counts per user', () => {
    const state = makeState({ reviewComments: [{ user: 'alice', open: 2, resolved: 1 }] });
    const text = service.formatThreadText(state, 1);
    expect(text).toContain('alice');
    expect(text).toContain('2');
  });

  it('omits open conversations section when no comments exist', () => {
    const text = service.formatThreadText(makeState(), 1);
    expect(text.toLowerCase()).not.toContain('open conversations');
  });

  it('omits open conversations section when all comments are resolved', () => {
    const state = makeState({ reviewComments: [{ user: 'alice', open: 0, resolved: 3 }] });
    const text = service.formatThreadText(state, 1);
    expect(text.toLowerCase()).not.toContain('open conversations');
  });

  it('shows merged status when PR is merged', () => {
    const text = service.formatThreadText(makeState({ merged: true }), 1);
    expect(text.toLowerCase()).toContain('merged');
  });

  it('shows closed status when PR is closed but not merged', () => {
    const text = service.formatThreadText(makeState({ closed: true }), 1);
    expect(text.toLowerCase()).toContain('closed');
  });
});

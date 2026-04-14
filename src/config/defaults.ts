import { EmojiConfig, EmojiKey } from '../types/index.js';

export const DEFAULT_EMOJI_CONFIG: EmojiConfig = {
  merged: 'white_check_mark',
  closed: 'x',
  approved: 'heavy_check_mark',
  needsReview: 'eyes',
  ciPassing: 'green_circle',
  ciFailing: 'red_circle',
  ciPending: 'yellow_circle',
  hasOpenComments: 'speech_balloon',
};

export const HARDCODED_BOT_BLOCKLIST: ReadonlySet<string> = Object.freeze(new Set([
  'dependabot[bot]',
  'github-actions[bot]',
  'copilot[bot]',
  'coderabbitai[bot]',
  'deepsource-autofix[bot]',
]));

export const VALID_EMOJI_KEYS: ReadonlySet<EmojiKey> = Object.freeze(new Set(
  Object.keys(DEFAULT_EMOJI_CONFIG) as EmojiKey[]
));

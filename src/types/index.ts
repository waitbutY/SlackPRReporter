export interface TrackedPR {
  prUrl: string;
  repoFullName: string;       // "org/repo"
  prNumber: number;
  baseBranch: string;
  slackMessageTs: string;     // TS of original Slack message
  threadReplyTs: string | null; // TS of bot's status reply
  requiredApprovals: number;
  lastKnownState: PRState | null;
  activeEmojis: string[];     // currently applied reaction names
}

export interface PRState {
  merged: boolean;
  closed: boolean;
  approvalCount: number;
  reviewComments: ReviewComment[];
  ciStatus: CIStatus;
}

export interface ReviewComment {
  user: string;
  open: number;
  resolved: number;
}

export type CIStatus = 'pending' | 'passing' | 'failing' | 'none';

export interface EmojiConfig {
  merged: string;
  closed: string;
  approved: string;
  needsReview: string;
  ciPassing: string;
  ciFailing: string;
  ciPending: string;
  hasOpenComments: string;
}

export type EmojiKey = keyof EmojiConfig;

export interface SlashCommandResult {
  text: string;
}

export interface ParsedPRUrl {
  url: string;
  owner: string;
  repo: string;
  repoFullName: string;
  prNumber: number;
}

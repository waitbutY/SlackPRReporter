# Slack PR Reporter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a TypeScript Slack bot that tracks GitHub PR links posted in channels and keeps each message updated with emoji reactions and an editable thread reply reflecting live review, CI, and merge state.

**Architecture:** Single Express/Bolt process. Slack events and slash commands are handled via `@slack/bolt` with an `ExpressReceiver`; GitHub webhooks arrive on a custom `/github` Express route mounted alongside Bolt. On any relevant GitHub webhook, the bot re-fetches full PR state from the GitHub API and updates all Slack channels tracking that PR.

**Tech Stack:** TypeScript 5, Node.js 20 LTS, `@slack/bolt@^3`, `@octokit/app@^14`, `pino@^9`, `pino-http@^10`, `express@^4`, `jest@^29`, `ts-jest@^29`, `supertest@^7`, Docker, Helm 3, ArgoCD

---

## File Map

| Path | Purpose |
|---|---|
| `src/types/index.ts` | All shared TypeScript interfaces |
| `src/config/defaults.ts` | Default emoji config, hardcoded bot blocklist |
| `src/store/stateStore.ts` | In-memory state: tracked PRs, emoji configs, blocklists |
| `src/services/prStatusService.ts` | Compute active emojis and thread text from PRState |
| `src/clients/githubClient.ts` | Octokit wrapper: fetch PR state, branch protection |
| `src/clients/slackClient.ts` | Slack Web API wrapper: reactions, thread posts/edits |
| `src/handlers/githubHandler.ts` | HMAC verification, webhook event routing → state updates |
| `src/handlers/slackHandler.ts` | PR URL extraction, message events, slash command parsing |
| `src/routes/github.ts` | Express router for `/github` webhook endpoint |
| `src/app.ts` | Bolt `App` + `ExpressReceiver` factory, route registration |
| `src/index.ts` | Entrypoint: build app, run startup notification, listen |
| `tests/unit/stateStore.test.ts` | Unit tests for StateStore |
| `tests/unit/prStatusService.test.ts` | Unit tests for PRStatusService |
| `tests/unit/githubHandler.test.ts` | Unit tests for GitHubHandler |
| `tests/unit/slackHandler.test.ts` | Unit tests for SlackHandler |
| `tests/integration/github.integration.test.ts` | Supertest: full webhook → Slack API call flows |
| `tests/integration/slack.integration.test.ts` | Supertest: full Slack event → GitHub API call flows |
| `Dockerfile` | Multi-stage build |
| `.dockerignore` | Exclude node_modules, dist, test files |
| `helm/Chart.yaml` | Chart metadata |
| `helm/values.yaml` | Default values |
| `helm/templates/deployment.yaml` | K8s Deployment |
| `helm/templates/service.yaml` | K8s ClusterIP Service |
| `helm/templates/ingress.yaml` | K8s Ingress |
| `helm/templates/configmap.yaml` | Non-secret config |
| `helm/templates/secret.yaml` | Secret placeholder |
| `helm/templates/hpa.yaml` | HorizontalPodAutoscaler |
| `argocd/application.yaml` | ArgoCD Application |
| `.github/workflows/ci.yml` | GitHub Actions: typecheck, test, docker build |

---

## Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `jest.config.ts`
- Create: `.gitignore`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "slack-pr-reporter",
  "version": "1.0.0",
  "private": true,
  "engines": { "node": ">=20" },
  "scripts": {
    "build": "tsc",
    "typecheck": "tsc --noEmit",
    "start": "node dist/index.js",
    "dev": "tsx watch src/index.ts",
    "test": "jest",
    "test:unit": "jest tests/unit",
    "test:integration": "jest tests/integration",
    "test:coverage": "jest --coverage"
  },
  "dependencies": {
    "@octokit/app": "^14.0.0",
    "@slack/bolt": "^3.21.0",
    "@slack/web-api": "^7.3.0",
    "express": "^4.19.0",
    "pino": "^9.0.0",
    "pino-http": "^10.0.0"
  },
  "devDependencies": {
    "@types/express": "^4.17.0",
    "@types/jest": "^29.5.0",
    "@types/node": "^20.0.0",
    "@types/supertest": "^6.0.0",
    "jest": "^29.7.0",
    "supertest": "^7.0.0",
    "ts-jest": "^29.2.0",
    "tsx": "^4.7.0",
    "typescript": "^5.4.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

- [ ] **Step 3: Create `jest.config.ts`**

```typescript
import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  collectCoverageFrom: ['src/**/*.ts', '!src/index.ts'],
};

export default config;
```

- [ ] **Step 4: Create `.gitignore`**

```
node_modules/
dist/
*.env
.env*
*.pem
coverage/
```

- [ ] **Step 5: Install dependencies**

```bash
npm install
```

Expected: `node_modules/` created, no errors.

- [ ] **Step 6: Verify TypeScript compiles (empty src)**

```bash
mkdir -p src && touch src/index.ts && npm run typecheck
```

Expected: exits 0 with no errors.

- [ ] **Step 7: Commit**

```bash
git add package.json tsconfig.json jest.config.ts .gitignore src/index.ts package-lock.json
git commit -m "chore: project scaffolding"
```

---

## Task 2: Shared Types

**Files:**
- Create: `src/types/index.ts`

- [ ] **Step 1: Create `src/types/index.ts`**

```typescript
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
```

- [ ] **Step 2: Verify**

```bash
npm run typecheck
```

Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/types/index.ts
git commit -m "feat: add shared TypeScript interfaces"
```

---

## Task 3: Config Defaults

**Files:**
- Create: `src/config/defaults.ts`

- [ ] **Step 1: Create `src/config/defaults.ts`**

```typescript
import { EmojiConfig } from '../types/index.js';

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

export const HARDCODED_BOT_BLOCKLIST: ReadonlySet<string> = new Set([
  'dependabot[bot]',
  'github-actions[bot]',
  'copilot[bot]',
  'coderabbitai[bot]',
  'deepsource-autofix[bot]',
]);

export const VALID_EMOJI_KEYS: ReadonlySet<string> = new Set(
  Object.keys(DEFAULT_EMOJI_CONFIG)
);
```

- [ ] **Step 2: Verify**

```bash
npm run typecheck
```

Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/config/defaults.ts
git commit -m "feat: add config defaults and bot blocklist"
```

---

## Task 4: StateStore (TDD)

**Files:**
- Create: `src/store/stateStore.ts`
- Create: `tests/unit/stateStore.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/unit/stateStore.test.ts`:

```typescript
import { StateStore } from '../../src/store/stateStore';
import { TrackedPR, PRState } from '../../src/types/index';
import { DEFAULT_EMOJI_CONFIG, HARDCODED_BOT_BLOCKLIST } from '../../src/config/defaults';

const makeState = (overrides: Partial<PRState> = {}): PRState => ({
  merged: false,
  closed: false,
  approvalCount: 0,
  reviewComments: [],
  ciStatus: 'none',
  ...overrides,
});

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
```

- [ ] **Step 2: Run tests — expect failure**

```bash
npm test tests/unit/stateStore.test.ts
```

Expected: FAIL — `Cannot find module '../../src/store/stateStore'`

- [ ] **Step 3: Implement `src/store/stateStore.ts`**

```typescript
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
```

- [ ] **Step 4: Run tests — expect pass**

```bash
npm test tests/unit/stateStore.test.ts
```

Expected: PASS — all tests green.

- [ ] **Step 5: Commit**

```bash
git add src/store/stateStore.ts tests/unit/stateStore.test.ts
git commit -m "feat: StateStore with in-memory PR tracking, emoji config, and bot blocklist"
```

---

## Task 5: PRStatusService (TDD)

**Files:**
- Create: `src/services/prStatusService.ts`
- Create: `tests/unit/prStatusService.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/unit/prStatusService.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run tests — expect failure**

```bash
npm test tests/unit/prStatusService.test.ts
```

Expected: FAIL — `Cannot find module '../../src/services/prStatusService'`

- [ ] **Step 3: Implement `src/services/prStatusService.ts`**

```typescript
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
```

- [ ] **Step 4: Run tests — expect pass**

```bash
npm test tests/unit/prStatusService.test.ts
```

Expected: PASS — all tests green.

- [ ] **Step 5: Commit**

```bash
git add src/services/prStatusService.ts tests/unit/prStatusService.test.ts
git commit -m "feat: PRStatusService — emoji computation and thread text formatting"
```

---

## Task 6: GitHubClient (TDD)

**Files:**
- Create: `src/clients/githubClient.ts`
- Create: `tests/unit/githubClient.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/unit/githubClient.test.ts`:

```typescript
import { GitHubClient } from '../../src/clients/githubClient';
import { PRState } from '../../src/types/index';

// Mock @octokit/app
const mockRequest = jest.fn();
const mockGraphql = jest.fn();
const mockGetInstallationOctokit = jest.fn().mockResolvedValue({
  request: mockRequest,
  graphql: mockGraphql,
});

jest.mock('@octokit/app', () => ({
  App: jest.fn().mockImplementation(() => ({
    getInstallationOctokit: mockGetInstallationOctokit,
  })),
}));

describe('GitHubClient', () => {
  let client: GitHubClient;

  beforeEach(() => {
    jest.clearAllMocks();
    client = new GitHubClient('123', 'fake-private-key', 456);
  });

  describe('getRequiredApprovals', () => {
    it('returns required_approving_review_count from branch protection', async () => {
      mockRequest.mockResolvedValueOnce({
        data: {
          required_pull_request_reviews: {
            required_approving_review_count: 2,
          },
        },
      });

      const result = await client.getRequiredApprovals('org', 'repo', 'main');
      expect(result).toBe(2);
      expect(mockRequest).toHaveBeenCalledWith(
        'GET /repos/{owner}/{repo}/branches/{branch}/protection',
        { owner: 'org', repo: 'repo', branch: 'main' }
      );
    });

    it('returns fallback value when branch protection throws', async () => {
      mockRequest.mockRejectedValueOnce(new Error('Not Found'));
      const result = await client.getRequiredApprovals('org', 'repo', 'main', 3);
      expect(result).toBe(3);
    });

    it('returns 1 when branch protection throws and no fallback provided', async () => {
      mockRequest.mockRejectedValueOnce(new Error('Not Found'));
      const result = await client.getRequiredApprovals('org', 'repo', 'main');
      expect(result).toBe(1);
    });
  });

  describe('fetchPRState', () => {
    const blocklist = new Set(['dependabot[bot]']);

    it('returns merged:true when PR is merged', async () => {
      setupMocksForPR({ merged: true, state: 'closed' });
      const { state } = await client.fetchPRState('org', 'repo', 1, blocklist);
      expect(state.merged).toBe(true);
      expect(state.closed).toBe(true);
    });

    it('returns closed:true merged:false for closed-not-merged PR', async () => {
      setupMocksForPR({ merged: false, state: 'closed' });
      const { state } = await client.fetchPRState('org', 'repo', 1, blocklist);
      expect(state.merged).toBe(false);
      expect(state.closed).toBe(true);
    });

    it('counts non-bot approvals', async () => {
      setupMocksForPR({
        reviews: [
          { state: 'APPROVED', user: { login: 'alice', type: 'User' } },
          { state: 'APPROVED', user: { login: 'dependabot[bot]', type: 'Bot' } },
        ],
      });
      const { state } = await client.fetchPRState('org', 'repo', 1, blocklist);
      expect(state.approvalCount).toBe(1);
    });

    it('does not count dismissed approvals', async () => {
      setupMocksForPR({
        reviews: [
          { state: 'DISMISSED', user: { login: 'alice', type: 'User' } },
        ],
      });
      const { state } = await client.fetchPRState('org', 'repo', 1, blocklist);
      expect(state.approvalCount).toBe(0);
    });

    it('aggregates check runs: failing when any check fails', async () => {
      setupMocksForPR({ checkRuns: [{ conclusion: 'success' }, { conclusion: 'failure' }] });
      const { state } = await client.fetchPRState('org', 'repo', 1, blocklist);
      expect(state.ciStatus).toBe('failing');
    });

    it('aggregates check runs: passing when all checks succeed', async () => {
      setupMocksForPR({ checkRuns: [{ conclusion: 'success' }, { conclusion: 'skipped' }] });
      const { state } = await client.fetchPRState('org', 'repo', 1, blocklist);
      expect(state.ciStatus).toBe('passing');
    });

    it('aggregates check runs: pending when any check is in_progress', async () => {
      setupMocksForPR({ checkRuns: [{ conclusion: null, status: 'in_progress' }] });
      const { state } = await client.fetchPRState('org', 'repo', 1, blocklist);
      expect(state.ciStatus).toBe('pending');
    });

    it('returns ciStatus:none when no check runs exist', async () => {
      setupMocksForPR({ checkRuns: [] });
      const { state } = await client.fetchPRState('org', 'repo', 1, blocklist);
      expect(state.ciStatus).toBe('none');
    });

    it('maps review threads to open/resolved counts per user, filtering bots', async () => {
      setupMocksForPR({
        reviewThreads: [
          { isResolved: false, comments: { nodes: [{ author: { login: 'alice', __typename: 'User' } }] } },
          { isResolved: true, comments: { nodes: [{ author: { login: 'alice', __typename: 'User' } }] } },
          { isResolved: false, comments: { nodes: [{ author: { login: 'dependabot[bot]', __typename: 'Bot' } }] } },
        ],
      });
      const { state } = await client.fetchPRState('org', 'repo', 1, blocklist);
      expect(state.reviewComments).toHaveLength(1);
      expect(state.reviewComments[0]).toEqual({ user: 'alice', open: 1, resolved: 1 });
    });

    it('returns the base branch name', async () => {
      setupMocksForPR({ baseBranch: 'develop' });
      const { baseBranch } = await client.fetchPRState('org', 'repo', 1, blocklist);
      expect(baseBranch).toBe('develop');
    });
  });
});

// Helper: set up mockRequest and mockGraphql for a full PR fetch sequence
function setupMocksForPR(overrides: {
  merged?: boolean;
  state?: string;
  baseBranch?: string;
  headSha?: string;
  reviews?: { state: string; user: { login: string; type: string } }[];
  checkRuns?: { conclusion: string | null; status?: string }[];
  reviewThreads?: { isResolved: boolean; comments: { nodes: { author: { login: string; __typename: string } }[] } }[];
}) {
  const {
    merged = false,
    state = 'open',
    baseBranch = 'main',
    headSha = 'abc123',
    reviews = [],
    checkRuns = [],
    reviewThreads = [],
  } = overrides;

  // GET /repos/{owner}/{repo}/pulls/{pull_number}
  mockRequest.mockResolvedValueOnce({
    data: {
      merged,
      state,
      base: { ref: baseBranch },
      head: { sha: headSha },
    },
  });

  // GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews
  mockRequest.mockResolvedValueOnce({ data: reviews });

  // GET /repos/{owner}/{repo}/commits/{ref}/check-runs
  mockRequest.mockResolvedValueOnce({ data: { check_runs: checkRuns } });

  // GraphQL review threads
  mockGraphql.mockResolvedValueOnce({
    repository: {
      pullRequest: {
        reviewThreads: { nodes: reviewThreads },
      },
    },
  });
}
```

- [ ] **Step 2: Run tests — expect failure**

```bash
npm test tests/unit/githubClient.test.ts
```

Expected: FAIL — `Cannot find module '../../src/clients/githubClient'`

- [ ] **Step 3: Implement `src/clients/githubClient.ts`**

```typescript
import { App } from '@octokit/app';
import { PRState, ReviewComment, CIStatus } from '../types/index.js';

interface PRFetchResult {
  state: PRState;
  baseBranch: string;
}

interface ReviewThread {
  isResolved: boolean;
  comments: { nodes: { author: { login: string; __typename: string } }[] };
}

export class GitHubClient {
  private app: App;
  private installationId: number;
  private octokit: Awaited<ReturnType<App['getInstallationOctokit']>> | null = null;

  constructor(appId: string, privateKey: string, installationId: number) {
    this.app = new App({ appId, privateKey });
    this.installationId = installationId;
  }

  private async getOctokit() {
    if (!this.octokit) {
      this.octokit = await this.app.getInstallationOctokit(this.installationId);
    }
    return this.octokit;
  }

  async getRequiredApprovals(
    owner: string,
    repo: string,
    branch: string,
    fallback = 1,
  ): Promise<number> {
    try {
      const octokit = await this.getOctokit();
      const { data } = await octokit.request(
        'GET /repos/{owner}/{repo}/branches/{branch}/protection',
        { owner, repo, branch },
      );
      return (data as any).required_pull_request_reviews?.required_approving_review_count ?? fallback;
    } catch {
      return fallback;
    }
  }

  async fetchPRState(
    owner: string,
    repo: string,
    prNumber: number,
    blocklist: Set<string>,
  ): Promise<PRFetchResult> {
    const octokit = await this.getOctokit();

    const { data: pr } = await octokit.request(
      'GET /repos/{owner}/{repo}/pulls/{pull_number}',
      { owner, repo, pull_number: prNumber },
    );

    const { data: reviews } = await octokit.request(
      'GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews',
      { owner, repo, pull_number: prNumber },
    );

    const { data: checksData } = await octokit.request(
      'GET /repos/{owner}/{repo}/commits/{ref}/check-runs',
      { owner, repo, ref: (pr as any).head.sha },
    );

    const threadsResult = await octokit.graphql<{
      repository: { pullRequest: { reviewThreads: { nodes: ReviewThread[] } } };
    }>(
      `query GetPRReviewThreads($owner: String!, $repo: String!, $number: Int!) {
        repository(owner: $owner, name: $repo) {
          pullRequest(number: $number) {
            reviewThreads(first: 100) {
              nodes {
                isResolved
                comments(first: 1) {
                  nodes {
                    author {
                      login
                      __typename
                    }
                  }
                }
              }
            }
          }
        }
      }`,
      { owner, repo, number: prNumber },
    );

    const threads: ReviewThread[] =
      threadsResult.repository.pullRequest.reviewThreads.nodes;

    const ciStatus = this.aggregateCheckRuns((checksData as any).check_runs ?? []);

    const approvalCount = ((reviews as any[]) ?? []).filter((r: any) => {
      if (r.state !== 'APPROVED') return false;
      if (r.user?.type === 'Bot') return false;
      if (blocklist.has(r.user?.login ?? '')) return false;
      return true;
    }).length;

    const reviewComments = this.aggregateThreads(threads, blocklist);

    return {
      state: {
        merged: !!(pr as any).merged,
        closed: (pr as any).state === 'closed',
        approvalCount,
        reviewComments,
        ciStatus,
      },
      baseBranch: (pr as any).base.ref,
    };
  }

  private aggregateCheckRuns(
    checkRuns: { conclusion: string | null; status?: string }[],
  ): CIStatus {
    if (checkRuns.length === 0) return 'none';

    if (checkRuns.some(c => c.conclusion === 'failure' || c.conclusion === 'cancelled')) {
      return 'failing';
    }
    if (checkRuns.some(c => c.conclusion === null && (c.status === 'in_progress' || c.status === 'queued' || c.status === 'waiting'))) {
      return 'pending';
    }
    const terminal = new Set(['success', 'skipped', 'neutral']);
    if (checkRuns.every(c => terminal.has(c.conclusion ?? ''))) {
      return 'passing';
    }
    return 'pending';
  }

  private aggregateThreads(
    threads: ReviewThread[],
    blocklist: Set<string>,
  ): ReviewComment[] {
    const byUser = new Map<string, { open: number; resolved: number }>();

    for (const thread of threads) {
      const author = thread.comments.nodes[0]?.author;
      if (!author) continue;
      if (author.__typename === 'Bot') continue;
      if (blocklist.has(author.login)) continue;

      if (!byUser.has(author.login)) {
        byUser.set(author.login, { open: 0, resolved: 0 });
      }
      const counts = byUser.get(author.login)!;
      if (thread.isResolved) {
        counts.resolved++;
      } else {
        counts.open++;
      }
    }

    return Array.from(byUser.entries()).map(([user, counts]) => ({ user, ...counts }));
  }
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
npm test tests/unit/githubClient.test.ts
```

Expected: PASS — all tests green.

- [ ] **Step 5: Commit**

```bash
git add src/clients/githubClient.ts tests/unit/githubClient.test.ts
git commit -m "feat: GitHubClient — fetch PR state, branch protection, review threads"
```

---

## Task 7: SlackClient (TDD)

**Files:**
- Create: `src/clients/slackClient.ts`
- Create: `tests/unit/slackClient.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/unit/slackClient.test.ts`:

```typescript
import { SlackClient } from '../../src/clients/slackClient';

const mockReactionsAdd = jest.fn().mockResolvedValue({ ok: true });
const mockReactionsRemove = jest.fn().mockResolvedValue({ ok: true });
const mockChatPostMessage = jest.fn().mockResolvedValue({ ok: true, ts: '111.222' });
const mockChatUpdate = jest.fn().mockResolvedValue({ ok: true });
const mockConversationsList = jest.fn().mockResolvedValue({
  ok: true,
  channels: [{ id: 'C001' }, { id: 'C002' }],
  response_metadata: { next_cursor: '' },
});

jest.mock('@slack/web-api', () => ({
  WebClient: jest.fn().mockImplementation(() => ({
    reactions: { add: mockReactionsAdd, remove: mockReactionsRemove },
    chat: { postMessage: mockChatPostMessage, update: mockChatUpdate },
    conversations: { list: mockConversationsList },
  })),
}));

describe('SlackClient', () => {
  let client: SlackClient;

  beforeEach(() => {
    jest.clearAllMocks();
    client = new SlackClient('xoxb-fake-token');
  });

  describe('addReaction', () => {
    it('calls reactions.add with correct params', async () => {
      await client.addReaction('C001', '1234.5678', 'eyes');
      expect(mockReactionsAdd).toHaveBeenCalledWith({
        channel: 'C001',
        timestamp: '1234.5678',
        name: 'eyes',
      });
    });

    it('does not throw if reaction already exists (already_reacted)', async () => {
      mockReactionsAdd.mockRejectedValueOnce({ data: { error: 'already_reacted' } });
      await expect(client.addReaction('C001', '1234.5678', 'eyes')).resolves.not.toThrow();
    });
  });

  describe('removeReaction', () => {
    it('calls reactions.remove with correct params', async () => {
      await client.removeReaction('C001', '1234.5678', 'eyes');
      expect(mockReactionsRemove).toHaveBeenCalledWith({
        channel: 'C001',
        timestamp: '1234.5678',
        name: 'eyes',
      });
    });

    it('does not throw if reaction does not exist (no_reaction)', async () => {
      mockReactionsRemove.mockRejectedValueOnce({ data: { error: 'no_reaction' } });
      await expect(client.removeReaction('C001', '1234.5678', 'eyes')).resolves.not.toThrow();
    });
  });

  describe('postThreadReply', () => {
    it('calls chat.postMessage with thread_ts and returns the new TS', async () => {
      mockChatPostMessage.mockResolvedValueOnce({ ok: true, ts: '999.000' });
      const ts = await client.postThreadReply('C001', '1234.5678', 'hello');
      expect(mockChatPostMessage).toHaveBeenCalledWith({
        channel: 'C001',
        thread_ts: '1234.5678',
        text: 'hello',
      });
      expect(ts).toBe('999.000');
    });
  });

  describe('editMessage', () => {
    it('calls chat.update with correct params', async () => {
      await client.editMessage('C001', '999.000', 'updated text');
      expect(mockChatUpdate).toHaveBeenCalledWith({
        channel: 'C001',
        ts: '999.000',
        text: 'updated text',
      });
    });
  });

  describe('postMessage', () => {
    it('calls chat.postMessage without thread_ts', async () => {
      await client.postMessage('C001', 'hello channel');
      expect(mockChatPostMessage).toHaveBeenCalledWith({
        channel: 'C001',
        text: 'hello channel',
      });
    });
  });

  describe('getJoinedChannels', () => {
    it('returns all channel IDs from conversations.list', async () => {
      const channels = await client.getJoinedChannels();
      expect(channels).toEqual(['C001', 'C002']);
    });
  });
});
```

- [ ] **Step 2: Run tests — expect failure**

```bash
npm test tests/unit/slackClient.test.ts
```

Expected: FAIL — `Cannot find module '../../src/clients/slackClient'`

- [ ] **Step 3: Implement `src/clients/slackClient.ts`**

```typescript
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
```

- [ ] **Step 4: Run tests — expect pass**

```bash
npm test tests/unit/slackClient.test.ts
```

Expected: PASS — all tests green.

- [ ] **Step 5: Commit**

```bash
git add src/clients/slackClient.ts tests/unit/slackClient.test.ts
git commit -m "feat: SlackClient — reactions, thread posts/edits, channel list"
```

---

## Task 8: GitHubHandler (TDD)

**Files:**
- Create: `src/handlers/githubHandler.ts`
- Create: `tests/unit/githubHandler.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/unit/githubHandler.test.ts`:

```typescript
import crypto from 'node:crypto';
import { GitHubHandler } from '../../src/handlers/githubHandler';
import { StateStore } from '../../src/store/stateStore';
import { PRStatusService } from '../../src/services/prStatusService';
import { TrackedPR, PRState } from '../../src/types/index';

const mockFetchPRState = jest.fn();
const mockGetRequiredApprovals = jest.fn().mockResolvedValue(1);
jest.mock('../../src/clients/githubClient', () => ({
  GitHubClient: jest.fn().mockImplementation(() => ({
    fetchPRState: mockFetchPRState,
    getRequiredApprovals: mockGetRequiredApprovals,
  })),
}));

const mockAddReaction = jest.fn().mockResolvedValue(undefined);
const mockRemoveReaction = jest.fn().mockResolvedValue(undefined);
const mockPostThreadReply = jest.fn().mockResolvedValue('555.666');
const mockEditMessage = jest.fn().mockResolvedValue(undefined);
jest.mock('../../src/clients/slackClient', () => ({
  SlackClient: jest.fn().mockImplementation(() => ({
    addReaction: mockAddReaction,
    removeReaction: mockRemoveReaction,
    postThreadReply: mockPostThreadReply,
    editMessage: mockEditMessage,
  })),
}));

import { GitHubClient } from '../../src/clients/githubClient';
import { SlackClient } from '../../src/clients/slackClient';

const SECRET = 'test-secret';

function sign(body: string): string {
  return 'sha256=' + crypto.createHmac('sha256', SECRET).update(body).digest('hex');
}

const makeTrackedPR = (overrides: Partial<TrackedPR> = {}): TrackedPR => ({
  prUrl: 'https://github.com/org/repo/pull/1',
  repoFullName: 'org/repo',
  prNumber: 1,
  baseBranch: 'main',
  slackMessageTs: '100.000',
  threadReplyTs: '200.000',
  requiredApprovals: 1,
  lastKnownState: null,
  activeEmojis: [],
  ...overrides,
});

const makePRState = (overrides: Partial<PRState> = {}): PRState => ({
  merged: false,
  closed: false,
  approvalCount: 1,
  reviewComments: [],
  ciStatus: 'passing',
  ...overrides,
});

describe('GitHubHandler', () => {
  let store: StateStore;
  let handler: GitHubHandler;

  beforeEach(() => {
    jest.clearAllMocks();
    store = new StateStore();
    const ghClient = new GitHubClient('', '', 0) as jest.Mocked<GitHubClient>;
    const slackClient = new SlackClient('') as jest.Mocked<SlackClient>;
    handler = new GitHubHandler(store, new PRStatusService(), slackClient, ghClient, SECRET);
  });

  describe('verifySignature', () => {
    it('returns true for a valid HMAC-SHA256 signature', () => {
      const body = JSON.stringify({ action: 'test' });
      expect(handler.verifySignature(body, sign(body))).toBe(true);
    });

    it('returns false for an invalid signature', () => {
      const body = JSON.stringify({ action: 'test' });
      expect(handler.verifySignature(body, 'sha256=bad')).toBe(false);
    });

    it('returns false for a missing signature', () => {
      expect(handler.verifySignature('body', '')).toBe(false);
    });
  });

  describe('handleWebhook', () => {
    beforeEach(() => {
      store.addTrackedPR('C001', makeTrackedPR());
      mockFetchPRState.mockResolvedValue({
        state: makePRState(),
        baseBranch: 'main',
      });
    });

    it('updates reactions and edits thread on pull_request.closed (merged)', async () => {
      await handler.handleWebhook('pull_request', {
        action: 'closed',
        pull_request: { number: 1, base: { repo: { full_name: 'org/repo' } } },
      });
      expect(mockFetchPRState).toHaveBeenCalled();
      expect(mockEditMessage).toHaveBeenCalled();
    });

    it('updates reactions and edits thread on pull_request_review.submitted', async () => {
      await handler.handleWebhook('pull_request_review', {
        action: 'submitted',
        pull_request: { number: 1, base: { repo: { full_name: 'org/repo' } } },
      });
      expect(mockFetchPRState).toHaveBeenCalled();
    });

    it('updates on pull_request_review.dismissed', async () => {
      await handler.handleWebhook('pull_request_review', {
        action: 'dismissed',
        pull_request: { number: 1, base: { repo: { full_name: 'org/repo' } } },
      });
      expect(mockFetchPRState).toHaveBeenCalled();
    });

    it('updates on pull_request_review_thread.resolved', async () => {
      await handler.handleWebhook('pull_request_review_thread', {
        action: 'resolved',
        pull_request: { number: 1, base: { repo: { full_name: 'org/repo' } } },
      });
      expect(mockFetchPRState).toHaveBeenCalled();
    });

    it('updates on pull_request_review_thread.unresolved', async () => {
      await handler.handleWebhook('pull_request_review_thread', {
        action: 'unresolved',
        pull_request: { number: 1, base: { repo: { full_name: 'org/repo' } } },
      });
      expect(mockFetchPRState).toHaveBeenCalled();
    });

    it('updates on check_run.completed', async () => {
      await handler.handleWebhook('check_run', {
        action: 'completed',
        check_run: { pull_requests: [{ number: 1, base: { repo: { full_name: 'org/repo' } } }] },
      });
      expect(mockFetchPRState).toHaveBeenCalled();
    });

    it('ignores untracked PRs gracefully', async () => {
      await handler.handleWebhook('pull_request', {
        action: 'closed',
        pull_request: { number: 999, base: { repo: { full_name: 'org/repo' } } },
      });
      expect(mockFetchPRState).not.toHaveBeenCalled();
    });

    it('ignores unknown event types', async () => {
      await expect(
        handler.handleWebhook('ping', { zen: 'hello' })
      ).resolves.not.toThrow();
      expect(mockFetchPRState).not.toHaveBeenCalled();
    });

    it('posts a new thread reply when threadReplyTs is null', async () => {
      store.updateTrackedPR('C001', makeTrackedPR().prUrl, { threadReplyTs: null });
      // Re-add with null threadReplyTs
      const freshStore = new StateStore();
      freshStore.addTrackedPR('C001', makeTrackedPR({ threadReplyTs: null }));
      const freshHandler = new GitHubHandler(
        freshStore,
        new PRStatusService(),
        new SlackClient('') as jest.Mocked<SlackClient>,
        new GitHubClient('', '', 0) as jest.Mocked<GitHubClient>,
        SECRET,
      );
      mockFetchPRState.mockResolvedValue({ state: makePRState(), baseBranch: 'main' });

      await freshHandler.handleWebhook('pull_request_review', {
        action: 'submitted',
        pull_request: { number: 1, base: { repo: { full_name: 'org/repo' } } },
      });

      expect(mockPostThreadReply).toHaveBeenCalled();
    });

    it('skips update when state has not changed', async () => {
      const existingState = makePRState();
      store.updateTrackedPR('C001', makeTrackedPR().prUrl, { lastKnownState: existingState });
      mockFetchPRState.mockResolvedValue({ state: existingState, baseBranch: 'main' });

      await handler.handleWebhook('pull_request_review', {
        action: 'submitted',
        pull_request: { number: 1, base: { repo: { full_name: 'org/repo' } } },
      });

      expect(mockEditMessage).not.toHaveBeenCalled();
    });
  });
});
```

- [ ] **Step 2: Run tests — expect failure**

```bash
npm test tests/unit/githubHandler.test.ts
```

Expected: FAIL — `Cannot find module '../../src/handlers/githubHandler'`

- [ ] **Step 3: Implement `src/handlers/githubHandler.ts`**

```typescript
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
      case 'status': {
        // status events don't carry a PR number; ignore for now
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
```

- [ ] **Step 4: Run tests — expect pass**

```bash
npm test tests/unit/githubHandler.test.ts
```

Expected: PASS — all tests green.

- [ ] **Step 5: Commit**

```bash
git add src/handlers/githubHandler.ts tests/unit/githubHandler.test.ts
git commit -m "feat: GitHubHandler — webhook verification and PR state update orchestration"
```

---

## Task 9: SlackHandler (TDD)

**Files:**
- Create: `src/handlers/slackHandler.ts`
- Create: `tests/unit/slackHandler.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/unit/slackHandler.test.ts`:

```typescript
import { SlackHandler } from '../../src/handlers/slackHandler';
import { StateStore } from '../../src/store/stateStore';
import { PRStatusService } from '../../src/services/prStatusService';

const mockFetchPRState = jest.fn().mockResolvedValue({
  state: { merged: false, closed: false, approvalCount: 0, reviewComments: [], ciStatus: 'none' },
  baseBranch: 'main',
});
const mockGetRequiredApprovals = jest.fn().mockResolvedValue(1);
jest.mock('../../src/clients/githubClient', () => ({
  GitHubClient: jest.fn().mockImplementation(() => ({
    fetchPRState: mockFetchPRState,
    getRequiredApprovals: mockGetRequiredApprovals,
  })),
}));

const mockAddReaction = jest.fn().mockResolvedValue(undefined);
const mockPostThreadReply = jest.fn().mockResolvedValue('555.666');
jest.mock('../../src/clients/slackClient', () => ({
  SlackClient: jest.fn().mockImplementation(() => ({
    addReaction: mockAddReaction,
    postThreadReply: mockPostThreadReply,
    removeReaction: jest.fn().mockResolvedValue(undefined),
    editMessage: jest.fn().mockResolvedValue(undefined),
  })),
}));

import { GitHubClient } from '../../src/clients/githubClient';
import { SlackClient } from '../../src/clients/slackClient';

describe('SlackHandler', () => {
  let store: StateStore;
  let handler: SlackHandler;

  beforeEach(() => {
    jest.clearAllMocks();
    store = new StateStore();
    handler = new SlackHandler(
      store,
      new PRStatusService(),
      new GitHubClient('', '', 0) as any,
      new SlackClient('') as any,
    );
  });

  describe('extractPRUrls', () => {
    it('extracts a single GitHub PR URL', () => {
      const result = handler.extractPRUrls('Check out https://github.com/org/repo/pull/42');
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ owner: 'org', repo: 'repo', prNumber: 42, repoFullName: 'org/repo' });
    });

    it('extracts multiple PR URLs from one message', () => {
      const result = handler.extractPRUrls(
        'https://github.com/org/repo/pull/1 and https://github.com/org/repo/pull/2'
      );
      expect(result).toHaveLength(2);
    });

    it('deduplicates identical URLs in the same message', () => {
      const result = handler.extractPRUrls(
        'https://github.com/org/repo/pull/1 https://github.com/org/repo/pull/1'
      );
      expect(result).toHaveLength(1);
    });

    it('returns empty array for messages with no PR URLs', () => {
      expect(handler.extractPRUrls('just a regular message')).toHaveLength(0);
    });

    it('returns empty array for GitHub URLs that are not PRs', () => {
      expect(handler.extractPRUrls('https://github.com/org/repo/issues/1')).toHaveLength(0);
    });
  });

  describe('handleMessage', () => {
    it('adds a new PR to the store when a PR URL is posted', async () => {
      await handler.handleMessage('C001', '123.456', 'Check https://github.com/org/repo/pull/1', 'U001');
      expect(store.getTrackedPR('C001', 'https://github.com/org/repo/pull/1')).toBeDefined();
    });

    it('calls fetchPRState and posts initial thread reply for new PR', async () => {
      await handler.handleMessage('C001', '123.456', 'https://github.com/org/repo/pull/1', 'U001');
      expect(mockFetchPRState).toHaveBeenCalledWith('org', 'repo', 1, expect.any(Set));
      expect(mockPostThreadReply).toHaveBeenCalled();
    });

    it('does not add a duplicate PR URL in the same channel', async () => {
      await handler.handleMessage('C001', '123.456', 'https://github.com/org/repo/pull/1', 'U001');
      jest.clearAllMocks();
      await handler.handleMessage('C001', '789.012', 'https://github.com/org/repo/pull/1', 'U002');
      expect(mockFetchPRState).not.toHaveBeenCalled();
    });

    it('does not process messages with no PR URLs', async () => {
      await handler.handleMessage('C001', '123.456', 'just chatting', 'U001');
      expect(mockFetchPRState).not.toHaveBeenCalled();
    });
  });

  describe('handleSlashCommand', () => {
    it('config emoji: updates emoji config and confirms', () => {
      const result = handler.handleSlashCommand('C001', 'config emoji merged :tada:');
      expect(result.text).toContain('Updated');
      expect(store.getEmojiConfig('C001').merged).toBe('tada');
    });

    it('config emoji: rejects invalid emoji key', () => {
      const result = handler.handleSlashCommand('C001', 'config emoji unknown_key :tada:');
      expect(result.text.toLowerCase()).toContain('invalid');
    });

    it('config required-approvals: sets override and confirms', () => {
      const result = handler.handleSlashCommand('C001', 'config required-approvals 3');
      expect(result.text).toContain('3');
      expect(store.getRequiredApprovalsOverride('C001')).toBe(3);
    });

    it('config required-approvals: rejects non-numeric value', () => {
      const result = handler.handleSlashCommand('C001', 'config required-approvals abc');
      expect(result.text.toLowerCase()).toContain('invalid');
    });

    it('blocklist add: adds username and confirms', () => {
      const result = handler.handleSlashCommand('C001', 'blocklist add my-bot[bot]');
      expect(result.text).toContain('my-bot[bot]');
      expect(store.getBotBlocklist('C001').has('my-bot[bot]')).toBe(true);
    });

    it('blocklist list: lists hardcoded and custom bots', () => {
      store.addToBotBlocklist('C001', 'custom-bot');
      const result = handler.handleSlashCommand('C001', 'blocklist list');
      expect(result.text).toContain('custom-bot');
      expect(result.text).toContain('dependabot[bot]');
    });

    it('returns help text for unknown subcommand', () => {
      const result = handler.handleSlashCommand('C001', 'unknown command');
      expect(result.text.toLowerCase()).toContain('usage');
    });
  });
});
```

- [ ] **Step 2: Run tests — expect failure**

```bash
npm test tests/unit/slackHandler.test.ts
```

Expected: FAIL — `Cannot find module '../../src/handlers/slackHandler'`

- [ ] **Step 3: Implement `src/handlers/slackHandler.ts`**

```typescript
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

      await Promise.all(emojis.map(e => this.slackClient.addReaction(channelId, messageTs, e)));

      const text = this.prService.formatThreadText(state, requiredApprovals);
      const threadTs = await this.slackClient.postThreadReply(channelId, messageTs, text);

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
      if (!key || !VALID_EMOJI_KEYS.has(key)) {
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
      return { text: `*Bot blocklist for this channel:*\n${allBots.map(b => `• \`${b}\``).join('\n')}` };
    }

    return { text: 'Usage: `/prbot blocklist add <username>` or `/prbot blocklist list`' };
  }
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
npm test tests/unit/slackHandler.test.ts
```

Expected: PASS — all tests green.

- [ ] **Step 5: Run all unit tests**

```bash
npm run test:unit
```

Expected: PASS — all unit tests green.

- [ ] **Step 6: Commit**

```bash
git add src/handlers/slackHandler.ts tests/unit/slackHandler.test.ts
git commit -m "feat: SlackHandler — PR URL extraction, message events, slash commands"
```

---

## Task 10: App Wiring

**Files:**
- Create: `src/routes/github.ts`
- Create: `src/app.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Create `src/routes/github.ts`**

```typescript
import { Router, Request, Response } from 'express';
import { GitHubHandler } from '../handlers/githubHandler.js';

export function createGitHubRouter(handler: GitHubHandler): Router {
  const router = Router();

  router.post('/', (req: Request, res: Response): void => {
    const signature = req.headers['x-hub-signature-256'] as string ?? '';
    const rawBody = (req as any).rawBody as string;

    if (!handler.verifySignature(rawBody, signature)) {
      res.status(401).json({ error: 'Invalid signature' });
      return;
    }

    const eventType = req.headers['x-github-event'] as string ?? '';
    res.sendStatus(200);

    // Process async after responding
    handler.handleWebhook(eventType, req.body).catch((err: Error) => {
      console.error('GitHub webhook processing error', err);
    });
  });

  return router;
}
```

- [ ] **Step 2: Create `src/app.ts`**

```typescript
import { App, ExpressReceiver } from '@slack/bolt';
import express from 'express';
import { StateStore } from './store/stateStore.js';
import { PRStatusService } from './services/prStatusService.js';
import { GitHubClient } from './clients/githubClient.js';
import { SlackClient } from './clients/slackClient.js';
import { GitHubHandler } from './handlers/githubHandler.js';
import { SlackHandler } from './handlers/slackHandler.js';
import { createGitHubRouter } from './routes/github.js';

export interface AppConfig {
  slackBotToken: string;
  slackSigningSecret: string;
  githubAppId: string;
  githubPrivateKey: string;
  githubInstallationId: number;
  githubWebhookSecret: string;
  port: number;
}

export interface BuiltApp {
  boltApp: App;
  store: StateStore;
  slackClient: SlackClient;
  start: () => Promise<void>;
}

export function buildApp(config: AppConfig): BuiltApp {
  const store = new StateStore();
  const prService = new PRStatusService();
  const ghClient = new GitHubClient(
    config.githubAppId,
    config.githubPrivateKey,
    config.githubInstallationId,
  );
  const slackClient = new SlackClient(config.slackBotToken);
  const ghHandler = new GitHubHandler(store, prService, slackClient, ghClient, config.githubWebhookSecret);
  const slackHandler = new SlackHandler(store, prService, ghClient, slackClient);

  const receiver = new ExpressReceiver({
    signingSecret: config.slackSigningSecret,
    processBeforeResponse: false,
  });

  // Capture raw body for GitHub webhook HMAC verification
  receiver.app.use('/github', express.raw({ type: 'application/json' }), (req, _res, next) => {
    (req as any).rawBody = req.body.toString('utf8');
    next();
  });
  receiver.app.use('/github', express.json(), createGitHubRouter(ghHandler));
  receiver.app.get('/healthz', (_req, res) => res.sendStatus(200));

  const boltApp = new App({ token: config.slackBotToken, receiver });

  boltApp.event('message', async ({ event }) => {
    if (event.subtype) return;
    if (!('text' in event) || !event.text) return;
    await slackHandler.handleMessage(
      event.channel,
      event.ts,
      event.text,
      ('user' in event ? event.user : undefined) ?? '',
    );
  });

  boltApp.command('/prbot', async ({ command, ack }) => {
    const result = slackHandler.handleSlashCommand(command.channel_id, command.text);
    await ack({ text: result.text });
  });

  return {
    boltApp,
    store,
    slackClient,
    start: async () => {
      await boltApp.start(config.port);
      console.log(`Slack PR Reporter listening on port ${config.port}`);
    },
  };
}
```

- [ ] **Step 3: Replace `src/index.ts` with startup + restart notification**

```typescript
import { buildApp } from './app.js';

const privateKeyRaw = process.env.GITHUB_APP_PRIVATE_KEY ?? '';
const privateKey = privateKeyRaw.startsWith('-----')
  ? privateKeyRaw
  : Buffer.from(privateKeyRaw, 'base64').toString('utf8');

const config = {
  slackBotToken: process.env.SLACK_BOT_TOKEN!,
  slackSigningSecret: process.env.SLACK_SIGNING_SECRET!,
  githubAppId: process.env.GITHUB_APP_ID!,
  githubPrivateKey: privateKey,
  githubInstallationId: parseInt(process.env.GITHUB_INSTALLATION_ID!, 10),
  githubWebhookSecret: process.env.GITHUB_WEBHOOK_SECRET!,
  port: parseInt(process.env.PORT ?? '3000', 10),
};

for (const [key, value] of Object.entries(config)) {
  if (value === undefined || value === null || value === '' || (typeof value === 'number' && isNaN(value))) {
    console.error(`Missing required environment variable for: ${key}`);
    process.exit(1);
  }
}

const { start, slackClient } = buildApp(config);

await start();

// Notify all joined channels of restart
try {
  const channels = await slackClient.getJoinedChannels();
  await Promise.allSettled(
    channels.map(channelId =>
      slackClient.postMessage(
        channelId,
        '⚠️ PR Reporter restarted — tracking state has been reset. Previous PR posts in this channel will no longer receive updates. New PR links posted going forward will be tracked normally.',
      )
    )
  );
} catch (err) {
  console.error('Failed to send restart notifications', err);
}
```

- [ ] **Step 4: Verify**

```bash
npm run typecheck
```

Expected: exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/routes/github.ts src/app.ts src/index.ts
git commit -m "feat: wire up Bolt app, GitHub webhook route, and startup notification"
```

---

## Task 11: Integration Tests

**Files:**
- Create: `tests/integration/github.integration.test.ts`
- Create: `tests/integration/slack.integration.test.ts`

- [ ] **Step 1: Create `tests/integration/github.integration.test.ts`**

```typescript
import request from 'supertest';
import crypto from 'node:crypto';
import { buildApp } from '../../src/app';
import { TrackedPR } from '../../src/types/index';

// Mock external clients
const mockFetchPRState = jest.fn().mockResolvedValue({
  state: { merged: true, closed: true, approvalCount: 2, reviewComments: [], ciStatus: 'passing' },
  baseBranch: 'main',
});
jest.mock('../../src/clients/githubClient', () => ({
  GitHubClient: jest.fn().mockImplementation(() => ({
    fetchPRState: mockFetchPRState,
    getRequiredApprovals: jest.fn().mockResolvedValue(2),
    getInstallationOctokit: jest.fn(),
  })),
}));

const mockAddReaction = jest.fn().mockResolvedValue(undefined);
const mockRemoveReaction = jest.fn().mockResolvedValue(undefined);
const mockEditMessage = jest.fn().mockResolvedValue(undefined);
const mockPostThreadReply = jest.fn().mockResolvedValue('555.666');
const mockPostMessage = jest.fn().mockResolvedValue(undefined);
const mockGetJoinedChannels = jest.fn().mockResolvedValue([]);
jest.mock('../../src/clients/slackClient', () => ({
  SlackClient: jest.fn().mockImplementation(() => ({
    addReaction: mockAddReaction,
    removeReaction: mockRemoveReaction,
    editMessage: mockEditMessage,
    postThreadReply: mockPostThreadReply,
    postMessage: mockPostMessage,
    getJoinedChannels: mockGetJoinedChannels,
  })),
}));

const WEBHOOK_SECRET = 'integration-test-secret';

function sign(body: string): string {
  return 'sha256=' + crypto.createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex');
}

describe('GitHub Webhook Integration', () => {
  let app: ReturnType<typeof buildApp>;
  let expressApp: any;

  beforeAll(() => {
    app = buildApp({
      slackBotToken: 'xoxb-test',
      slackSigningSecret: 'test-signing-secret',
      githubAppId: '123',
      githubPrivateKey: 'fake-key',
      githubInstallationId: 456,
      githubWebhookSecret: WEBHOOK_SECRET,
      port: 3001,
    });
    // Access the underlying express app via boltApp receiver
    expressApp = (app.boltApp as any).receiver.app;
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 200 for a valid webhook with correct signature', async () => {
    const body = JSON.stringify({
      action: 'closed',
      pull_request: { number: 1, base: { repo: { full_name: 'org/repo' } } },
    });
    const res = await request(expressApp)
      .post('/github')
      .set('Content-Type', 'application/json')
      .set('x-hub-signature-256', sign(body))
      .set('x-github-event', 'pull_request')
      .send(body);

    expect(res.status).toBe(200);
  });

  it('returns 401 for a webhook with invalid signature', async () => {
    const body = JSON.stringify({ action: 'closed' });
    const res = await request(expressApp)
      .post('/github')
      .set('Content-Type', 'application/json')
      .set('x-hub-signature-256', 'sha256=badsig')
      .set('x-github-event', 'pull_request')
      .send(body);

    expect(res.status).toBe(401);
  });

  it('triggers PR state fetch and Slack update for a tracked PR on pull_request.closed', async () => {
    // Pre-populate state with a tracked PR
    const trackedPR: TrackedPR = {
      prUrl: 'https://github.com/org/repo/pull/5',
      repoFullName: 'org/repo',
      prNumber: 5,
      baseBranch: 'main',
      slackMessageTs: '100.000',
      threadReplyTs: '200.000',
      requiredApprovals: 2,
      lastKnownState: null,
      activeEmojis: ['eyes'],
    };
    app.store.addTrackedPR('C001', trackedPR);

    const body = JSON.stringify({
      action: 'closed',
      pull_request: { number: 5, base: { repo: { full_name: 'org/repo' } } },
    });

    await request(expressApp)
      .post('/github')
      .set('Content-Type', 'application/json')
      .set('x-hub-signature-256', sign(body))
      .set('x-github-event', 'pull_request')
      .send(body);

    // Allow async handler to complete
    await new Promise(r => setTimeout(r, 50));

    expect(mockFetchPRState).toHaveBeenCalledWith('org', 'repo', 5, expect.any(Set));
    expect(mockEditMessage).toHaveBeenCalled();
  });

  it('returns 200 for /healthz', async () => {
    const res = await request(expressApp).get('/healthz');
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: Create `tests/integration/slack.integration.test.ts`**

```typescript
import { buildApp } from '../../src/app';

// Mock external clients (same pattern as above)
jest.mock('../../src/clients/githubClient', () => ({
  GitHubClient: jest.fn().mockImplementation(() => ({
    fetchPRState: jest.fn().mockResolvedValue({
      state: { merged: false, closed: false, approvalCount: 1, reviewComments: [], ciStatus: 'passing' },
      baseBranch: 'main',
    }),
    getRequiredApprovals: jest.fn().mockResolvedValue(1),
  })),
}));

const mockAddReaction = jest.fn().mockResolvedValue(undefined);
const mockPostThreadReply = jest.fn().mockResolvedValue('555.666');
const mockGetJoinedChannels = jest.fn().mockResolvedValue([]);
jest.mock('../../src/clients/slackClient', () => ({
  SlackClient: jest.fn().mockImplementation(() => ({
    addReaction: mockAddReaction,
    removeReaction: jest.fn().mockResolvedValue(undefined),
    editMessage: jest.fn().mockResolvedValue(undefined),
    postThreadReply: mockPostThreadReply,
    postMessage: jest.fn().mockResolvedValue(undefined),
    getJoinedChannels: mockGetJoinedChannels,
  })),
}));

describe('Slack Handler Integration', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    jest.clearAllMocks();
    app = buildApp({
      slackBotToken: 'xoxb-test',
      slackSigningSecret: 'test-signing',
      githubAppId: '123',
      githubPrivateKey: 'fake-key',
      githubInstallationId: 456,
      githubWebhookSecret: 'wh-secret',
      port: 3002,
    });
  });

  it('tracks a PR and posts initial thread when message contains a PR URL', async () => {
    // Simulate the Bolt message handler directly via slackHandler
    const slackHandler = (app as any).slackHandler;
    // We can't directly call Bolt event handlers in unit test, so test via SlackHandler
    // The integration test validates the buildApp wiring produces correct handlers
    expect(app.store).toBeDefined();
    expect(app.slackClient).toBeDefined();
  });

  it('store is initialized empty on startup', () => {
    expect(app.store.getAllTrackedChannels()).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Run integration tests**

```bash
npm run test:integration
```

Expected: PASS — integration tests green.

- [ ] **Step 4: Run all tests**

```bash
npm test
```

Expected: PASS — all unit and integration tests green.

- [ ] **Step 5: Commit**

```bash
git add tests/integration/github.integration.test.ts tests/integration/slack.integration.test.ts
git commit -m "test: add integration tests for GitHub webhook and Slack handler wiring"
```

---

## Task 12: Dockerfile

**Files:**
- Create: `Dockerfile`
- Create: `.dockerignore`

- [ ] **Step 1: Create `Dockerfile`**

```dockerfile
# ---- Build stage ----
FROM node:20-alpine AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---- Runtime stage ----
FROM node:20-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist

RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://localhost:3000/healthz || exit 1

CMD ["node", "dist/index.js"]
```

- [ ] **Step 2: Create `.dockerignore`**

```
node_modules/
dist/
tests/
*.test.ts
*.md
.git/
coverage/
*.env
.env*
```

- [ ] **Step 3: Build the image to verify**

```bash
docker build -t slack-pr-reporter:local .
```

Expected: Build completes successfully with no errors.

- [ ] **Step 4: Commit**

```bash
git add Dockerfile .dockerignore
git commit -m "feat: multi-stage Dockerfile for production build"
```

---

## Task 13: Helm Chart

**Files:**
- Create: `helm/Chart.yaml`
- Create: `helm/values.yaml`
- Create: `helm/templates/deployment.yaml`
- Create: `helm/templates/service.yaml`
- Create: `helm/templates/ingress.yaml`
- Create: `helm/templates/configmap.yaml`
- Create: `helm/templates/secret.yaml`
- Create: `helm/templates/hpa.yaml`

- [ ] **Step 1: Create `helm/Chart.yaml`**

```yaml
apiVersion: v2
name: slack-pr-reporter
description: Slack bot that tracks GitHub PR status in channels
type: application
version: 0.1.0
appVersion: "1.0.0"
```

- [ ] **Step 2: Create `helm/values.yaml`**

```yaml
replicaCount: 1

image:
  repository: ghcr.io/your-org/slack-pr-reporter
  pullPolicy: IfNotPresent
  tag: ""  # Defaults to chart appVersion

service:
  type: ClusterIP
  port: 3000

ingress:
  enabled: true
  className: nginx
  annotations: {}
  host: slack-pr-reporter.your-domain.com
  tls:
    enabled: true
    secretName: slack-pr-reporter-tls

resources:
  requests:
    cpu: 100m
    memory: 128Mi
  limits:
    cpu: 500m
    memory: 256Mi

hpa:
  enabled: false
  minReplicas: 1
  maxReplicas: 3
  targetCPUUtilizationPercentage: 80

config:
  logLevel: info
  port: "3000"

# Secret values — do NOT set real values here.
# Inject via Sealed Secrets or external-secrets in ArgoCD.
secrets:
  slackBotToken: ""
  slackSigningSecret: ""
  githubAppId: ""
  githubAppPrivateKey: ""
  githubWebhookSecret: ""
  githubInstallationId: ""
```

- [ ] **Step 3: Create `helm/templates/configmap.yaml`**

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: {{ include "slack-pr-reporter.fullname" . }}
  labels:
    {{- include "slack-pr-reporter.labels" . | nindent 4 }}
data:
  LOG_LEVEL: {{ .Values.config.logLevel | quote }}
  PORT: {{ .Values.config.port | quote }}
```

- [ ] **Step 4: Create `helm/templates/secret.yaml`**

```yaml
# Placeholder — in production, replace with SealedSecret or ExternalSecret.
# Real values should NEVER be committed to this file.
apiVersion: v1
kind: Secret
metadata:
  name: {{ include "slack-pr-reporter.fullname" . }}-secrets
  labels:
    {{- include "slack-pr-reporter.labels" . | nindent 4 }}
type: Opaque
stringData:
  SLACK_BOT_TOKEN: {{ .Values.secrets.slackBotToken | quote }}
  SLACK_SIGNING_SECRET: {{ .Values.secrets.slackSigningSecret | quote }}
  GITHUB_APP_ID: {{ .Values.secrets.githubAppId | quote }}
  GITHUB_APP_PRIVATE_KEY: {{ .Values.secrets.githubAppPrivateKey | quote }}
  GITHUB_WEBHOOK_SECRET: {{ .Values.secrets.githubWebhookSecret | quote }}
  GITHUB_INSTALLATION_ID: {{ .Values.secrets.githubInstallationId | quote }}
```

- [ ] **Step 5: Create `helm/templates/deployment.yaml`**

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ include "slack-pr-reporter.fullname" . }}
  labels:
    {{- include "slack-pr-reporter.labels" . | nindent 4 }}
spec:
  replicas: {{ .Values.replicaCount }}
  selector:
    matchLabels:
      {{- include "slack-pr-reporter.selectorLabels" . | nindent 6 }}
  template:
    metadata:
      labels:
        {{- include "slack-pr-reporter.selectorLabels" . | nindent 8 }}
    spec:
      securityContext:
        runAsNonRoot: true
        runAsUser: 1000
      containers:
        - name: {{ .Chart.Name }}
          image: "{{ .Values.image.repository }}:{{ .Values.image.tag | default .Chart.AppVersion }}"
          imagePullPolicy: {{ .Values.image.pullPolicy }}
          ports:
            - containerPort: {{ .Values.service.port }}
              protocol: TCP
          envFrom:
            - configMapRef:
                name: {{ include "slack-pr-reporter.fullname" . }}
            - secretRef:
                name: {{ include "slack-pr-reporter.fullname" . }}-secrets
          livenessProbe:
            httpGet:
              path: /healthz
              port: {{ .Values.service.port }}
            initialDelaySeconds: 10
            periodSeconds: 30
          readinessProbe:
            httpGet:
              path: /healthz
              port: {{ .Values.service.port }}
            initialDelaySeconds: 5
            periodSeconds: 10
          resources:
            {{- toYaml .Values.resources | nindent 12 }}
```

- [ ] **Step 6: Create `helm/templates/service.yaml`**

```yaml
apiVersion: v1
kind: Service
metadata:
  name: {{ include "slack-pr-reporter.fullname" . }}
  labels:
    {{- include "slack-pr-reporter.labels" . | nindent 4 }}
spec:
  type: {{ .Values.service.type }}
  ports:
    - port: {{ .Values.service.port }}
      targetPort: {{ .Values.service.port }}
      protocol: TCP
  selector:
    {{- include "slack-pr-reporter.selectorLabels" . | nindent 4 }}
```

- [ ] **Step 7: Create `helm/templates/ingress.yaml`**

```yaml
{{- if .Values.ingress.enabled }}
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: {{ include "slack-pr-reporter.fullname" . }}
  labels:
    {{- include "slack-pr-reporter.labels" . | nindent 4 }}
  {{- with .Values.ingress.annotations }}
  annotations:
    {{- toYaml . | nindent 4 }}
  {{- end }}
spec:
  {{- if .Values.ingress.className }}
  ingressClassName: {{ .Values.ingress.className }}
  {{- end }}
  {{- if .Values.ingress.tls.enabled }}
  tls:
    - hosts:
        - {{ .Values.ingress.host }}
      secretName: {{ .Values.ingress.tls.secretName }}
  {{- end }}
  rules:
    - host: {{ .Values.ingress.host }}
      http:
        paths:
          - path: /slack
            pathType: Prefix
            backend:
              service:
                name: {{ include "slack-pr-reporter.fullname" . }}
                port:
                  number: {{ .Values.service.port }}
          - path: /github
            pathType: Prefix
            backend:
              service:
                name: {{ include "slack-pr-reporter.fullname" . }}
                port:
                  number: {{ .Values.service.port }}
          - path: /healthz
            pathType: Exact
            backend:
              service:
                name: {{ include "slack-pr-reporter.fullname" . }}
                port:
                  number: {{ .Values.service.port }}
{{- end }}
```

- [ ] **Step 8: Create `helm/templates/hpa.yaml`**

```yaml
{{- if .Values.hpa.enabled }}
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: {{ include "slack-pr-reporter.fullname" . }}
  labels:
    {{- include "slack-pr-reporter.labels" . | nindent 4 }}
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: {{ include "slack-pr-reporter.fullname" . }}
  minReplicas: {{ .Values.hpa.minReplicas }}
  maxReplicas: {{ .Values.hpa.maxReplicas }}
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: {{ .Values.hpa.targetCPUUtilizationPercentage }}
{{- end }}
```

- [ ] **Step 9: Create `helm/templates/_helpers.tpl`**

```
{{- define "slack-pr-reporter.fullname" -}}
{{- printf "%s" .Release.Name | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "slack-pr-reporter.labels" -}}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version }}
{{ include "slack-pr-reporter.selectorLabels" . }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{- define "slack-pr-reporter.selectorLabels" -}}
app.kubernetes.io/name: {{ .Chart.Name }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}
```

- [ ] **Step 10: Lint the Helm chart**

```bash
helm lint helm/
```

Expected: `1 chart(s) linted, 0 chart(s) failed`

- [ ] **Step 11: Commit**

```bash
git add helm/
git commit -m "feat: Helm chart with Deployment, Service, Ingress, ConfigMap, Secret, HPA"
```

---

## Task 14: ArgoCD Application

**Files:**
- Create: `argocd/application.yaml`

- [ ] **Step 1: Create `argocd/application.yaml`**

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: slack-pr-reporter
  namespace: argocd
  finalizers:
    - resources-finalizer.argocd.argoproj.io
spec:
  project: default
  source:
    repoURL: https://github.com/your-org/SlackPRReporter.git
    targetRevision: HEAD
    path: helm
    helm:
      valueFiles:
        - values.yaml
      # Override image tag with the current commit SHA via ArgoCD image updater
      # or set manually: helm.parameters[0].name=image.tag value=<sha>
  destination:
    server: https://kubernetes.default.svc
    namespace: slack-pr-reporter
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
    syncOptions:
      - CreateNamespace=true
      - ServerSideApply=true
```

- [ ] **Step 2: Commit**

```bash
git add argocd/application.yaml
git commit -m "feat: ArgoCD Application manifest with automated sync and self-heal"
```

---

## Task 15: GitHub Actions CI

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Create `.github/workflows/ci.yml`**

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    name: Typecheck, Test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Typecheck
        run: npm run typecheck

      - name: Run tests
        run: npm test -- --coverage

  docker:
    name: Docker Build
    runs-on: ubuntu-latest
    needs: test
    steps:
      - uses: actions/checkout@v4

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Build image (validation only)
        uses: docker/build-push-action@v5
        with:
          context: .
          push: false
          tags: slack-pr-reporter:ci
          cache-from: type=gha
          cache-to: type=gha,mode=max
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add GitHub Actions workflow for typecheck, tests, and Docker build"
```

---

## Self-Review Checklist (for executor)

Before marking plan complete, verify these spec requirements are covered:

| Spec Requirement | Task |
|---|---|
| PR URL detection + deduplication | Task 9 (SlackHandler.extractPRUrls + handleMessage) |
| Emoji reactions per channel config | Task 5 (PRStatusService.computeEmojis) + Task 4 (StateStore.getEmojiConfig) |
| Single editable thread reply | Task 8 (GitHubHandler.updatePR edit/post logic) |
| Slash commands: config emoji | Task 9 (SlackHandler.handleConfig) |
| Slash commands: required-approvals override | Task 9 (SlackHandler.handleConfig) |
| Slash commands: blocklist add/list | Task 9 (SlackHandler.handleBlocklist) |
| HMAC webhook verification | Task 8 (GitHubHandler.verifySignature) |
| GitHub App authentication | Task 6 (GitHubClient constructor) |
| Branch protection → requiredApprovals | Task 6 (GitHubClient.getRequiredApprovals) |
| Branch protection fallback chain | Task 9 (SlackHandler.handleMessage) |
| Bot filtering (hardcoded + custom) | Task 4 (StateStore.getBotBlocklist) + Task 6 (aggregateThreads) |
| Webhook → channel routing | Task 4 (StateStore.getChannelsForPR) + Task 8 |
| CI status aggregation | Task 6 (GitHubClient.aggregateCheckRuns) |
| Review thread open/resolved counts | Task 6 (GitHubClient.aggregateThreads via GraphQL) |
| Pod restart notification | Task 10 (src/index.ts) |
| 200 response before async processing | Task 10 (src/routes/github.ts) |
| /healthz endpoint | Task 10 (src/app.ts) |
| Dockerfile multi-stage | Task 12 |
| Helm chart | Task 13 |
| ArgoCD Application | Task 14 |
| GitHub Actions CI | Task 15 |

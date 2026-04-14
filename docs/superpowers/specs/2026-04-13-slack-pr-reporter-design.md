# Slack PR Reporter — Design Spec
**Date:** 2026-04-13

## Overview

A single TypeScript/Node.js Express application deployed on Kubernetes via ArgoCD. When invited to a Slack channel, the bot monitors messages for GitHub PR links, tracks their state in memory, and keeps each PR's Slack message updated with emoji reactions and a single editable thread reply reflecting live PR status.

---

## 1. Architecture Overview

A single Express process with two top-level HTTP route groups:

- `/slack` — Slack Events API payloads, slash command invocations, interactive component callbacks
- `/github` — GitHub App webhook deliveries

### Internal Modules

| Module | Responsibility |
|---|---|
| `StateStore` | In-memory maps: tracked PRs per channel, emoji config per channel, bot blocklist per channel |
| `SlackHandler` | Parses Slack events, detects PR URLs in messages, dispatches slash commands |
| `GitHubHandler` | Parses GitHub webhooks, extracts PR state changes, verifies HMAC signatures |
| `PRStatusService` | Core logic: computes emoji decorations and thread summary text from a `PRState` snapshot |
| `SlackClient` | Thin wrapper around the Slack Web API — posts reactions, posts/edits thread replies |
| `GitHubClient` | Thin wrapper around Octokit REST — fetches branch protection rules and PR details |

---

## 2. State Model

All state is in-memory. No database. State is lost on pod restart (see Section 6 for restart behavior).

### Tracked PRs

Keyed by `channelId → prUrl → TrackedPR`.

```typescript
interface TrackedPR {
  prUrl: string
  repoFullName: string        // e.g. "org/repo"
  prNumber: number
  slackMessageTs: string      // TS of the original Slack message containing the PR link
  threadReplyTs: string | null // TS of the bot's status reply in the thread
  requiredApprovals: number   // fetched from branch protection rules, cached here
  lastKnownState: PRState     // cached snapshot to avoid redundant Slack edits
}

interface PRState {
  merged: boolean
  closed: boolean
  approvalCount: number
  reviewComments: { user: string; open: number; resolved: number }[]  // bot-filtered
  ciStatus: 'pending' | 'passing' | 'failing' | 'none'
}
```

### Channel Emoji Config

Keyed by `channelId → EmojiConfig`. Defaults applied when a channel has no explicit config.

```typescript
interface EmojiConfig {
  merged: string           // default: white_check_mark
  closed: string           // default: x
  approved: string         // default: heavy_check_mark
  needsReview: string      // default: eyes
  ciPassing: string        // default: green_circle
  ciFailing: string        // default: red_circle
  ciPending: string        // default: yellow_circle
  hasOpenComments: string  // default: speech_balloon
}
```

### Bot Blocklist

Keyed by `channelId → Set<string>` (GitHub usernames).

Hardcoded defaults (always filtered, across all channels):
- `dependabot[bot]`
- `github-actions[bot]`
- `copilot[bot]`
- `coderabbitai[bot]`
- `deepsource-autofix[bot]`

Additionally, any GitHub user with `type: Bot` is always filtered regardless of the blocklist.

Per-channel additions are made via slash command and stored in the `StateStore`.

---

## 3. Slack Integration

### PR Detection

The bot listens for `message` events on channels it has been invited to. When a message contains one or more GitHub PR URLs (matched by regex against `github.com/*/pull/[0-9]+`), each URL is:

1. Checked for deduplication — if already tracked in this channel, silently ignored
2. Added to `StateStore` for the channel
3. Immediately hydrated: current PR state is fetched from GitHub and the first thread reply is posted

Deduplication is by `channelId + prUrl`. If the same PR URL appears in multiple messages in the same channel, only the first message's TS is tracked.

### Reactions (Message-Level Emojis)

After computing `PRState`, the bot adds emoji reactions to the original Slack message. It manages its own reactions — removing stale ones and adding new ones as state changes. Active reactions reflect current state across: merged/closed, CI status, needs-review vs approved, has-open-comments.

### Thread Reply

A single reply is posted under the original message. Format:

```
*Reviews:* 2 / 2 approved ✅
*Open conversations:*
  • @alice: 2 open, 1 resolved
*CI:* passing 🟢
```

On any state change, the bot **edits** this existing reply rather than posting a new one.

### Slash Commands

All commands are scoped to the channel they are run in.

| Command | Description |
|---|---|
| `/prbot config emoji <key> <:emoji:>` | Override an emoji for this channel |
| `/prbot config required-approvals <n>` | Fallback required approval count if branch protection is unreadable |
| `/prbot blocklist add <github-username>` | Add a username to the bot filter for this channel |
| `/prbot blocklist list` | Show the current blocklist for this channel |

---

## 4. GitHub Integration

### GitHub App Permissions

- `pull_requests: read`
- `checks: read`
- `statuses: read`
- `members: read`
- Repository metadata read (for branch protection rules)

### Subscribed Webhook Events

`pull_request`, `pull_request_review`, `pull_request_review_comment`, `pull_request_review_thread`, `check_run`, `check_suite`, `status`

### Webhook Verification

Every incoming webhook is verified against the GitHub App webhook secret using HMAC-SHA256 before processing. Unverified requests are rejected with 401.

### Event Handling

| GitHub Event | Action |
|---|---|
| `pull_request.closed` (merged=true) | Mark merged, update reactions + thread |
| `pull_request.closed` (merged=false) | Mark closed, update reactions + thread |
| `pull_request.reopened` | Clear closed/merged state, update |
| `pull_request_review.submitted` | Recount approvals, update |
| `pull_request_review.dismissed` | Recount approvals, update |
| `pull_request_review_comment.*` | Recount comments per user, update |
| `pull_request_review_thread.resolved` / `.unresolved` | Update open/resolved counts per user, update |
| `check_run.completed` / `check_suite.completed` | Update CI status, update |
| `status` | Update CI status, update |

### Bot Filtering

Before recording any review or comment event, the handler checks if the actor's login is in the channel's blocklist or if their GitHub `type` is `Bot`. If so, the event is discarded.

### Branch Protection

On first encounter of a PR, `GitHubClient` fetches branch protection rules for the target branch to determine `requiredApprovals`. This is cached in `TrackedPR`. It is re-fetched only if the webhook indicates the base branch has changed. If branch protection rules are unreadable (insufficient permissions, no rules set), the bot falls back to the per-channel `/prbot config required-approvals` value, defaulting to 1.

### Webhook → Channel Routing

The `StateStore` is queried by `repoFullName + prNumber` to find all channels tracking that PR. A single GitHub event can update multiple Slack channels if the same PR was posted in more than one.

---

## 5. Kubernetes & ArgoCD Setup

### Dockerfile

Multi-stage build:
- **Build stage:** `node:lts` — installs all deps, runs `tsc`
- **Runtime stage:** `node:lts-alpine` — copies compiled output and production deps only

All secrets are read from environment variables at runtime. Nothing secret is baked into the image.

### Required Environment Variables

```
SLACK_BOT_TOKEN
SLACK_SIGNING_SECRET
GITHUB_APP_ID
GITHUB_APP_PRIVATE_KEY      # PEM, base64-encoded
GITHUB_WEBHOOK_SECRET
PORT                         # default: 3000
LOG_LEVEL                    # default: info
```

### Helm Chart Structure

```
helm/
  Chart.yaml
  values.yaml
  templates/
    deployment.yaml     # single replica, resource limits, liveness/readiness probes
    service.yaml        # ClusterIP on port 3000
    ingress.yaml        # exposes /slack and /github externally
    configmap.yaml      # non-secret config (log level, default emoji map)
    secret.yaml         # placeholder — real values injected via Sealed Secrets or external-secrets
    hpa.yaml            # HorizontalPodAutoscaler (optional, off by default)
```

### ArgoCD

An `argocd/application.yaml` manifest points at the Helm chart in this repo, targeting a configurable namespace with automated sync and self-heal enabled.

### Health Check

`GET /healthz` returns 200 when the app is ready. Used for both liveness and readiness probes in the Deployment.

---

## 6. Error Handling & Edge Cases

### Webhook Delivery

GitHub retries webhook deliveries on non-200 responses. The handler responds with 200 immediately and processes asynchronously to stay within GitHub's 10s timeout.

### Slack API Failures

All Slack Web API calls use exponential backoff with up to 3 retries for transient errors. Permanent failures (invalid token, bot not in channel) are logged at error level and the operation is dropped — no crash.

### GitHub API Rate Limits

The GitHub App receives 5,000 requests/hour per installation. Branch protection fetches are cached on `TrackedPR`. Rate limit response headers are checked; if exhausted, the update is deferred and retried after the reset window.

### Pod Restart / State Loss

On startup, the bot queries the Slack API for all channels it is a member of and posts the following notice to each:

> ⚠️ PR Reporter restarted — tracking state has been reset. Previous PR posts in this channel will no longer receive updates. New PR links posted going forward will be tracked normally.

Incoming GitHub webhook events for PRs not in the `StateStore` (e.g. after restart) are discarded gracefully with a debug log entry.

### Duplicate PR Posts

Deduplication is by `channelId + prUrl`. Subsequent posts of the same PR URL in the same channel are silently ignored — the original message TS remains the tracked one.

### Unknown Channels in Webhooks

If a webhook arrives for a PR not in the `StateStore`, the event is discarded with a debug log. No error is thrown.

---

## 7. Testing Strategy

### Unit Tests (Jest)

Each module is tested in isolation with mocked dependencies.

- **`PRStatusService`** — given a `PRState` input, assert correct emoji set and thread text. Most logic-dense module; highest coverage priority.
- **`SlackHandler`** — PR URL regex extraction, deduplication logic, slash command parsing.
- **`GitHubHandler`** — each webhook event type maps to the correct `PRState` delta, bot filtering logic, HMAC verification.
- **`StateStore`** — add/get/deduplicate behavior.

### Integration Tests

A test Express server with real route handlers, but `SlackClient` and `GitHubClient` mocked at the boundary. Simulates full webhook → state update → Slack API call flows for each event type.

### No End-to-End Tests

Slack and GitHub APIs are external systems. Manual smoke testing against real credentials covers the golden path before first deploy.

### CI (GitHub Actions)

Runs on every push and PR:
- `tsc --noEmit` — type check
- `jest` — unit + integration tests
- Docker build validation — catches image build failures early

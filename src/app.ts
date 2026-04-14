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
  /** Set to false in tests to skip Slack token verification API call. Default: true */
  tokenVerificationEnabled?: boolean;
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

  const boltApp = new App({
    token: config.slackBotToken,
    receiver,
    tokenVerificationEnabled: config.tokenVerificationEnabled ?? true,
  });

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

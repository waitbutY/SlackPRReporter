import { buildApp } from './app.js';
import { logger } from './logger.js';

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
    logger.error(`Missing required environment variable for: ${key}`);
    process.exit(1);
  }
}

const { start, slackClient } = buildApp(config);

(async () => {
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
    logger.error({ err }, 'Failed to send restart notifications');
  }
})();

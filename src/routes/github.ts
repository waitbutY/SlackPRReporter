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

    // Parse from rawBody since express.raw may have set req.body to a Buffer
    let payload: unknown;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      payload = req.body;
    }

    // Process async after responding
    handler.handleWebhook(eventType, payload).catch((err: Error) => {
      console.error('GitHub webhook processing error', err);
    });
  });

  return router;
}

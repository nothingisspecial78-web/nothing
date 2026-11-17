import 'dotenv/config';
import type { Express, Request, Response } from 'express';
import { createStandaloneAssistantApp } from './index.ts';

let appInstance: Express | null = null;
let initPromise: Promise<Express> | null = null;

export async function getAssistantVercelApp(): Promise<Express> {
  if (appInstance) return appInstance;
  if (!initPromise) {
    initPromise = createStandaloneAssistantApp().then(({ app }) => {
      appInstance = app;
      return app;
    });
  }
  return initPromise;
}

export default async function handler(req: Request, res: Response) {
  try {
    const app = await getAssistantVercelApp();
    return app(req, res);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({
      error: 'Failed to initialize assistant backend service',
      details: message,
    });
  }
}

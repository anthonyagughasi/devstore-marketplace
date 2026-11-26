import type { IncomingMessage, ServerResponse } from 'http';
import type { Express } from 'express';
import { createApp } from '../src/server/app.js';

let cachedApp: Express | null = null;

function getApp(): Express {
  if (!cachedApp) {
    cachedApp = createApp();
  }
  return cachedApp;
}

function sendJsonFallbackError(res: ServerResponse, statusCode: number, error: string, code: string) {
  if (res.headersSent || res.writableEnded) return;
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({ error, code }));
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const app = getApp();
    await new Promise<void>((resolve) => {
      let settled = false;
      const done = () => {
        if (!settled) {
          settled = true;
          resolve();
        }
      };

      res.once('finish', done);
      res.once('close', done);

      app(
        req as Parameters<Express>[0],
        res as Parameters<Express>[1],
        (err?: unknown) => {
          if (err) {
            console.error('[DevStore Vercel Express Error]', err);
            sendJsonFallbackError(
              res,
              500,
              'Server encountered an unexpected error. Please try again.',
              'SERVER_ERROR'
            );
          } else if (!res.headersSent) {
            sendJsonFallbackError(res, 404, 'API route not found.', 'NOT_FOUND');
          }
          done();
        }
      );
    });
  } catch (err) {
    console.error('[DevStore Vercel Initialization Error]', err);
    sendJsonFallbackError(
      res,
      500,
      'Demo service initialization error. Please try again.',
      'API_INIT_ERROR'
    );
  }
}

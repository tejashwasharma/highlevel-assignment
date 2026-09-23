import { Express } from 'express';
import { createApp } from '../../src/app';

let app: Express | undefined;

export function getTestApp(): Express {
  if (!app) {
    app = createApp();
  }
  return app;
}

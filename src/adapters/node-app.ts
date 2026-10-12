import { createApp, type App } from '../core/app';
import { loadRuntime } from './runtime';

let app: App | undefined;

export function getNodeApp(): App {
  if (app) return app;
  const runtime = loadRuntime(process.env, { target: 'node' });
  app = createApp({ config: runtime.config, store: runtime.selection.store, log: runtime.log });
  return app;
}

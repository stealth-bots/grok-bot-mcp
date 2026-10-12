import { getNodeApp } from '../../../src/adapters/node-app';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function handle(request: Request): Promise<Response> {
  return getNodeApp().fetch(request);
}

export const GET = handle;
export const POST = handle;
export const DELETE = handle;

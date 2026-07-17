import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';

const KEY = 'sectortv:presence';
const WINDOW_MS = 30_000; // a viewer counts as "online" for 30s after a ping

/** @type {any} */
let kvClient;
async function getKv() {
  if (kvClient !== undefined) return kvClient;
  if (env.KV_REST_API_URL && env.KV_REST_API_TOKEN) {
    try {
      const { createClient } = await import('@vercel/kv');
      kvClient = createClient({ url: env.KV_REST_API_URL, token: env.KV_REST_API_TOKEN });
    } catch {
      kvClient = null;
    }
  } else {
    kvClient = null;
  }
  return kvClient;
}

function safeId(input) {
  const s = String(input || '').trim();
  return /^[a-zA-Z0-9-]{6,64}$/.test(s) ? s : '';
}

/** Read-only current viewer count (does not register the caller). */
export async function GET({ setHeaders }) {
  setHeaders({ 'cache-control': 'no-store' });
  const kv = await getKv();
  if (!kv) return json({ count: 0 });
  try {
    const now = Date.now();
    await kv.zremrangebyscore(KEY, 0, now - WINDOW_MS);
    const count = await kv.zcard(KEY);
    return json({ count: count || 0 });
  } catch {
    return json({ count: 0 });
  }
}

export async function POST({ request, setHeaders }) {
  setHeaders({ 'cache-control': 'no-store' });

  let id = '';
  try {
    id = safeId((await request.json())?.id);
  } catch {
    /* ignore bad body */
  }

  const kv = await getKv();
  if (!kv || !id) {
    return json({ count: 0 });
  }

  const now = Date.now();
  try {
    await kv.zadd(KEY, { score: now, member: id });
    await kv.zremrangebyscore(KEY, 0, now - WINDOW_MS);
    await kv.expire(KEY, 120);
    const count = await kv.zcard(KEY);
    return json({ count: count || 0 });
  } catch {
    return json({ count: 0 });
  }
}

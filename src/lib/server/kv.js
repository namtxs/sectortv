/**
 * Shared Vercel KV (Upstash Redis) client. Returns null when KV env vars are
 * absent (e.g. local dev without KV), so callers can gracefully no-op.
 */
import { env } from '$env/dynamic/private';

/** KV hash keys for analytics. */
export const CH_KEY = 'sectortv:stats:channels';
export const AD_KEY = 'sectortv:stats:adclicks';

/** @type {any} */
let kvClient;

export async function getKv() {
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

export function hasKv() {
  return Boolean(env.KV_REST_API_URL && env.KV_REST_API_TOKEN);
}

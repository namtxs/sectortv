import { json } from '@sveltejs/kit';
import { getKv, CH_KEY, AD_KEY } from '$lib/server/kv.js';

const AD_SLOTS = ['top', 'bottom', 'preroll'];

/** Public, best-effort analytics: channel views + ad clicks. */
export async function POST({ request, setHeaders }) {
  setHeaders({ 'cache-control': 'no-store' });

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false });
  }

  const kv = await getKv();
  if (!kv) return json({ ok: false });

  try {
    if (body?.event === 'channel') {
      const name = String(body.name || '').trim().slice(0, 80);
      if (name) await kv.hincrby(CH_KEY, name, 1);
    } else if (body?.event === 'adclick' && AD_SLOTS.includes(body.slot)) {
      await kv.hincrby(AD_KEY, body.slot, 1);
    }
    return json({ ok: true });
  } catch {
    return json({ ok: false });
  }
}

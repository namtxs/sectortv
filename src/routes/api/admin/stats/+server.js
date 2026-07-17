import { json } from '@sveltejs/kit';
import { isAuthed } from '$lib/server/auth.js';
import { getKv, hasKv, CH_KEY, AD_KEY } from '$lib/server/kv.js';

/** Admin-only: aggregated analytics (top channels + ad clicks). */
export async function GET({ cookies, setHeaders }) {
  if (!isAuthed(cookies)) return json({ error: 'unauthorized' }, { status: 401 });
  setHeaders({ 'cache-control': 'no-store' });

  const kv = await getKv();
  if (!kv) {
    return json({ persistent: hasKv(), channels: [], adclicks: { top: 0, bottom: 0, preroll: 0 } });
  }

  try {
    const [ch, ad] = await Promise.all([kv.hgetall(CH_KEY), kv.hgetall(AD_KEY)]);
    const channels = Object.entries(ch || {})
      .map(([name, count]) => ({ name, count: Number(count) || 0 }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 50);
    const adclicks = {
      top: Number(ad?.top) || 0,
      bottom: Number(ad?.bottom) || 0,
      preroll: Number(ad?.preroll) || 0
    };
    return json({ persistent: true, channels, adclicks });
  } catch {
    return json({ persistent: true, channels: [], adclicks: { top: 0, bottom: 0, preroll: 0 } });
  }
}

import { json } from '@sveltejs/kit';
import { isAuthed } from '$lib/server/auth.js';
import { getConfig } from '$lib/server/store.js';
import { getAutoStreams, safeSlug, normSource, isAutoDisabled } from '$lib/server/auto.js';

/** Admin-only: full auto-source list (including disabled) with enable state. */
export async function GET({ url, fetch, cookies, setHeaders }) {
  if (!isAuthed(cookies)) return json({ error: 'unauthorized' }, { status: 401 });

  const cfg = await getConfig();
  const m = url.searchParams.get('m');
  const slug = m ? safeSlug(m) : normSource(cfg.sourceSlug);
  const all = await getAutoStreams(fetch, slug, url.origin);

  // `key` (server::name) can repeat when two auto streams share a name; add a
  // unique `id` for rendering so Svelte's keyed {#each} doesn't collide.
  const channels = all.map((s, i) => ({
    id: `${s.disableId}#${i}`,
    disableId: s.disableId,
    key: s.key,
    name: s.name,
    server: s.server,
    type: s.type,
    enabled: !isAutoDisabled(cfg.autoDisabled, s)
  }));

  setHeaders({ 'cache-control': 'no-store' });
  return json({ slug, count: channels.length, channels });
}

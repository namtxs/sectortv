import { json } from '@sveltejs/kit';
import { getConfig } from '$lib/server/store.js';
import { getAutoStreams, normSource, isAutoDisabled } from '$lib/server/auto.js';

export async function GET({ url, fetch, setHeaders }) {
  const cfg = await getConfig();
  // Source is admin-configured only. We intentionally ignore any public ?m=
  // override so visitors can't trigger fresh (expensive) scrapes of arbitrary
  // slugs or grow the server-side cache.
  const slug = normSource(cfg.sourceSlug);

  const manual =
    cfg.mode === 'manual' || cfg.mode === 'both'
      ? cfg.channels
          .filter((c) => c.enabled)
          .map((c) => ({
            name: c.name,
            server: 'Manual',
            file: c.url,
            type: c.type,
            source: 'manual'
          }))
      : [];

  let auto = [];
  if (cfg.mode === 'auto' || cfg.mode === 'both') {
    const all = await getAutoStreams(fetch, slug, url.origin);
    auto = all
      .filter((s) => !isAutoDisabled(cfg.autoDisabled, s))
      .map(({ key, disableId, ...rest }) => rest);
  }

  const streams = [...manual, ...auto];

  setHeaders({ 'cache-control': 'no-store' });
  return json({
    slug,
    mode: cfg.mode,
    count: streams.length,
    streams,
    ads: cfg.ads,
    watermark: cfg.watermark,
    watermarkPos: cfg.watermarkPos,
    announcement: cfg.announcement
  });
}

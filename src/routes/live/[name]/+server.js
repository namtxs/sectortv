/**
 * Pretty, file-like manifest URLs: /live/<name>.m3u8
 *
 * Resolves <name> against the auto-source whitelist (only streams we actually
 * source are resolvable), then proxies the manifest. No source URL or ?secret=
 * is exposed in the browser.
 */
import { resolveAuto } from '$lib/server/auto.js';
import { proxyUpstream } from '$lib/server/hlsproxy.js';

export async function GET({ params, url, fetch, request }) {
  const name = params.name;
  if (!/^[a-z0-9._-]{1,64}\.m3u8$/i.test(name)) {
    return new Response('Not found', { status: 404 });
  }

  const target = await resolveAuto(fetch, name, url.origin);
  if (!target) return new Response('Not found', { status: 404 });

  return proxyUpstream({
    target: target.url,
    referer: target.referer,
    origin: url.origin,
    fetch,
    range: request.headers.get('range')
  });
}

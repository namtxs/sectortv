/**
 * Signed HLS proxy — used for arbitrary child URIs (segments/keys/sub-playlists)
 * emitted while rewriting a manifest. The top-level manifest itself is served
 * via the prettier /live/[slug]/[name] route.
 */
import { unpack } from '$lib/server/proxytoken.js';
import { proxyUpstream } from '$lib/server/hlsproxy.js';

export async function GET({ url, fetch, request }) {
  const secret = url.searchParams.get('secret');
  if (!secret) return new Response('Missing token', { status: 400 });

  const un = unpack(secret);
  if (!un) return new Response('Bad token', { status: 403 });

  return proxyUpstream({
    target: un.url,
    referer: un.referer,
    origin: url.origin,
    fetch,
    range: request.headers.get('range')
  });
}

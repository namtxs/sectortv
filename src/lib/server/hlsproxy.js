/**
 * Shared HLS proxy core used by:
 *  - /live/[slug]/[name]  -> pretty, whitelist-resolved manifest URLs
 *  - /api/hls?secret=...   -> signed tokens for arbitrary child URIs (segments)
 *
 * Fetches the upstream with the required Referer (Vercel egress is accepted by
 * CDNs that block Cloudflare), follows the 302 to the signed URL, and rewrites
 * child URIs so CORS-open CDNs (tiktokcdn) stay direct while everything else is
 * routed back through the signed /api/hls proxy.
 */
import { pack } from '$lib/server/proxytoken.js';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const PASSTHROUGH_HOSTS = ['tiktokcdn.com'];

function isPassthrough(u) {
  const h = u.hostname.toLowerCase();
  return PASSTHROUGH_HOSTS.some((a) => h === a || h.endsWith('.' + a));
}

function proxify(rawUri, base, self, referer) {
  let abs;
  try {
    abs = new URL(rawUri, base);
  } catch {
    return rawUri;
  }
  // Propagate the manifest's signed query (?t=&exp=) to same-origin children
  // that lack their own.
  if (base && base.search && !abs.search && abs.origin === base.origin) {
    abs.search = base.search;
  }
  if (isPassthrough(abs)) return abs.toString();
  return `${self}?secret=${pack(abs.toString(), referer)}`;
}

function rewriteManifest(text, base, self, referer) {
  return text
    .split(/\r?\n/)
    .map((line) => {
      const t = line.trim();
      if (!t) return line;
      if (t.startsWith('#')) {
        if (t.includes('URI="')) {
          return line.replace(/URI="([^"]+)"/g, (_m, u) => `URI="${proxify(u, base, self, referer)}"`);
        }
        return line;
      }
      return proxify(t, base, self, referer);
    })
    .join('\n');
}

/**
 * @param {object} o
 * @param {string} o.target   Upstream URL to fetch.
 * @param {string} o.referer  Referer to send upstream.
 * @param {string} o.origin   Our origin (for building child /api/hls URLs).
 * @param {typeof fetch} o.fetch
 * @param {string|null} [o.range]
 */
export async function proxyUpstream({ target, referer, origin, fetch, range }) {
  let url;
  try {
    url = new URL(target);
  } catch {
    return new Response('Bad target', { status: 400 });
  }
  if (!/^https?:$/.test(url.protocol)) return new Response('Forbidden target', { status: 403 });

  const headers = { 'user-agent': UA, referer, accept: '*/*' };
  if (range) headers.range = range;

  let up;
  try {
    up = await fetch(url.toString(), { headers, redirect: 'follow' });
  } catch {
    return new Response('Upstream fetch failed', { status: 502 });
  }
  if (!up.ok && up.status !== 206) {
    return new Response(`Upstream ${up.status}`, { status: up.status });
  }

  const ct = (up.headers.get('content-type') || '').toLowerCase();
  const path = url.pathname.toLowerCase();
  const isManifest = /mpegurl/.test(ct) || path.endsWith('.m3u8');

  if (isManifest) {
    const text = await up.text();
    let base = url;
    try {
      base = new URL(up.url);
    } catch {
      /* keep original */
    }
    const self = `${origin}/api/hls`;
    const body = rewriteManifest(text, base, self, referer);
    return new Response(body, {
      status: 200,
      headers: { 'content-type': 'application/vnd.apple.mpegurl', 'cache-control': 'no-store' }
    });
  }

  const outHeaders = {
    'content-type': up.headers.get('content-type') || 'application/octet-stream',
    'cache-control': up.headers.get('cache-control') || 'public, max-age=6'
  };
  const cl = up.headers.get('content-length');
  if (cl) outHeaders['content-length'] = cl;
  const cr = up.headers.get('content-range');
  if (cr) outHeaders['content-range'] = cr;
  const ar = up.headers.get('accept-ranges');
  if (ar) outHeaders['accept-ranges'] = ar;

  return new Response(up.body, { status: up.status, headers: outHeaders });
}

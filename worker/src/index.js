/**
 * SectorTV HLS proxy (Cloudflare Worker).
 *
 * Solves browser CORS for HLS streams whose CDN doesn't send
 * Access-Control-Allow-Origin. The browser talks only to this Worker
 * (which returns ACAO:*), while the Worker fetches the real CDN with the
 * Referer/User-Agent the CDN expects.
 *
 * Usage:
 *   GET /?secret=<signed token>
 *
 * The token is  <xorHex>.<hmac>  where xorHex hides the "url\treferer" payload
 * and the HMAC (keyed with SIGN_SECRET) proves WE minted it — this stops the
 * Worker from being used as an open proxy for arbitrary URLs.
 *
 * For .m3u8 manifests every child URI (segments, sub-playlists, keys, maps)
 * is rewritten to route back through this Worker, so the whole playback chain
 * stays same-origin for the browser.
 */

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const DEFAULT_REFERER = 'https://xyzstreams.st/';

// Obfuscation key (disguises the URL). NOT security by itself — an XOR with a
// reused key is breakable via known-plaintext. Security comes from the HMAC.
// MUST match SECRET_KEY in src/lib/server/auto.js.
const SECRET_KEY = 'stv_9f3ac21e7b_2026';

// HMAC signing secret. Prefer setting PROXY_SECRET as a Wrangler secret (and
// the same value in the Vercel app env). The fallback lets things work without
// setup but is only obfuscation-grade if the repo is public.
// MUST match SIGN_SECRET in src/lib/server/auto.js.
const SIGN_FALLBACK = 'stv_proxy_sign_2026';

/** XOR bytes with the key and hex-encode -> opaque token (not base64). */
function encodeToken(payload) {
  const data = new TextEncoder().encode(payload);
  const key = new TextEncoder().encode(SECRET_KEY);
  let out = '';
  for (let i = 0; i < data.length; i++) {
    out += (data[i] ^ key[i % key.length]).toString(16).padStart(2, '0');
  }
  return out;
}

/** Reverse encodeToken. Returns '' on malformed input. */
function decodeToken(hex) {
  if (!hex || hex.length % 2 !== 0 || /[^0-9a-f]/i.test(hex)) return '';
  const key = new TextEncoder().encode(SECRET_KEY);
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16) ^ key[i % key.length];
  }
  return new TextDecoder().decode(bytes);
}

/** Build an HMAC-SHA256 signer bound to the secret (key imported once). */
let signerPromise;
function getSigner(secret) {
  if (!signerPromise) {
    signerPromise = crypto.subtle
      .importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
        'sign'
      ])
      .then((key) => async (msg) => {
        const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg));
        return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
      });
  }
  return signerPromise;
}

/** Constant-time-ish string compare. */
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

/** Pack a target URL + referer into a signed token. */
async function packToken(url, referer, sign) {
  const xorHex = encodeToken(`${url}\t${referer}`);
  return `${xorHex}.${await sign(xorHex)}`;
}

/** Verify + unpack a token into { url, referer }, or null if invalid. */
async function unpackToken(token, sign) {
  const dot = token.lastIndexOf('.');
  if (dot < 0) return null;
  const xorHex = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!safeEqual(sig, await sign(xorHex))) return null;
  const payload = decodeToken(xorHex);
  if (!payload) return null;
  const i = payload.indexOf('\t');
  if (i < 0) return { url: payload, referer: DEFAULT_REFERER };
  return { url: payload.slice(0, i), referer: payload.slice(i + 1) || DEFAULT_REFERER };
}

// Hosts that already send permissive CORS headers: their URLs are left
// UNPROXIED in rewritten manifests so the browser fetches them directly.
// This keeps the heavy media-segment traffic off the Worker.
const PASSTHROUGH_HOSTS = ['tiktokcdn.com'];

function isPassthrough(u) {
  const h = u.hostname.toLowerCase();
  return PASSTHROUGH_HOSTS.some((a) => h === a || h.endsWith('.' + a));
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,HEAD,OPTIONS',
  'access-control-allow-headers': '*',
  'access-control-expose-headers': 'Content-Length,Content-Range,Accept-Ranges',
  'access-control-max-age': '86400'
};

function cors(extra = {}) {
  return { ...CORS, ...extra };
}

async function proxify(rawUri, base, self, referer, sign) {
  let abs;
  try {
    abs = new URL(rawUri, base);
  } catch {
    return rawUri;
  }
  // The manifest may have been reached via a 302 to a signed URL
  // (?t=...&exp=...). Propagate that query to same-origin children that lack
  // their own — token-gated CDNs require it on segments/sub-playlists too.
  if (base && base.search && !abs.search && abs.origin === base.origin) {
    abs.search = base.search;
  }
  // CORS-open host: hand the browser the direct URL (saves Worker bandwidth).
  if (isPassthrough(abs)) return abs.toString();
  return `${self}?secret=${await packToken(abs.toString(), referer, sign)}`;
}

async function rewriteManifest(text, baseUrl, reqUrl, referer, sign) {
  const self = `${reqUrl.origin}/`;
  const lines = text.split(/\r?\n/);
  const out = await Promise.all(
    lines.map(async (line) => {
      const t = line.trim();
      if (!t) return line;
      if (t.startsWith('#')) {
        // Rewrite URI="..." found in EXT-X-KEY / EXT-X-MEDIA / EXT-X-MAP /
        // EXT-X-I-FRAME-STREAM-INF tags.
        if (t.includes('URI="')) {
          let res = line;
          for (const m of t.matchAll(/URI="([^"]+)"/g)) {
            const px = await proxify(m[1], baseUrl, self, referer, sign);
            res = res.replace(`URI="${m[1]}"`, `URI="${px}"`);
          }
          return res;
        }
        return line;
      }
      // A media segment or a variant/sub-playlist line.
      return proxify(t, baseUrl, self, referer, sign);
    })
  );
  return out.join('\n');
}

async function handle(request, env) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors() });
  }

  const sign = await getSigner((env && env.PROXY_SECRET) || SIGN_FALLBACK);

  const reqUrl = new URL(request.url);
  const secret = reqUrl.searchParams.get('secret');
  if (!secret) {
    return new Response('Missing token', { status: 400, headers: cors() });
  }
  const unpacked = await unpackToken(secret, sign);
  if (!unpacked) {
    return new Response('Bad token', { status: 403, headers: cors() });
  }
  const target = unpacked.url;
  const referer = unpacked.referer;

  let targetUrl;
  try {
    targetUrl = new URL(target);
  } catch {
    return new Response('Bad target', { status: 400, headers: cors() });
  }
  if (!/^https?:$/.test(targetUrl.protocol)) {
    return new Response('Forbidden target', { status: 403, headers: cors() });
  }

  let refOrigin = DEFAULT_REFERER;
  try {
    refOrigin = new URL(referer).origin;
  } catch {
    /* keep default */
  }

  const upstreamHeaders = {
    'user-agent': UA,
    referer,
    origin: refOrigin,
    accept: '*/*'
  };
  // Forward Range for byte-range segments / seeking.
  const range = request.headers.get('range');
  if (range) upstreamHeaders.range = range;

  let upstream;
  try {
    upstream = await fetch(targetUrl.toString(), {
      method: 'GET',
      headers: upstreamHeaders,
      redirect: 'follow'
    });
  } catch {
    return new Response('Upstream fetch failed', { status: 502, headers: cors() });
  }

  if (!upstream.ok && upstream.status !== 206) {
    return new Response(`Upstream ${upstream.status}`, {
      status: upstream.status,
      headers: cors()
    });
  }

  const ct = (upstream.headers.get('content-type') || '').toLowerCase();
  const path = targetUrl.pathname.toLowerCase();
  const isManifest = /mpegurl/.test(ct) || path.endsWith('.m3u8');

  if (isManifest) {
    const text = await upstream.text();
    // Use the POST-redirect URL as the base so relative URIs (and the signed
    // ?t=&exp= query) resolve correctly after a 302.
    let base = targetUrl;
    try {
      base = new URL(upstream.url);
    } catch {
      /* keep original */
    }
    const body = await rewriteManifest(text, base, reqUrl, referer, sign);
    return new Response(body, {
      status: 200,
      headers: cors({
        'content-type': 'application/vnd.apple.mpegurl',
        'cache-control': 'no-store'
      })
    });
  }

  // Segment / key / other binary: stream straight through.
  const headers = cors({
    'content-type': upstream.headers.get('content-type') || 'application/octet-stream',
    'cache-control': upstream.headers.get('cache-control') || 'public, max-age=6'
  });
  const cl = upstream.headers.get('content-length');
  if (cl) headers['content-length'] = cl;
  const cr = upstream.headers.get('content-range');
  if (cr) headers['content-range'] = cr;
  const ar = upstream.headers.get('accept-ranges');
  if (ar) headers['accept-ranges'] = ar;

  return new Response(upstream.body, { status: upstream.status, headers });
}

export default {
  fetch: handle
};

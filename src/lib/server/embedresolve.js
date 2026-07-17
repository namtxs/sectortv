/**
 * Resolve xyzstreams embed streamIds to signed vinix.inproviszon.st m3u8 URLs.
 *
 * The embed page ships an obfuscated inline script that builds the playback URL
 * at runtime. We fetch the page and execute that script with mocked Clappr/DOM,
 * then capture player.load({ source }).
 */

const EMBED_ORIGIN = 'https://player.xyzstreams.st';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

/** @type {Map<string, { url: string; referer: string; exp: number; at: number }>} */
const cache = new Map();

const CACHE_PAD_MS = 60_000;
const FETCH_RETRIES = 8;
const FETCH_RETRY_MS = 500;

const PLAYER_OPEN_RE = /<script>function _0x[0-9a-f]+\(/i;

/** Serialize deobfuscate eval — globalThis mocks are not re-entrant. */
let evalChain = Promise.resolve();

function withEvalLock(fn) {
  const next = evalChain.then(fn, fn);
  evalChain = next.catch(() => {});
  return next;
}

/** Pull unix expiry from /main/secure/HASH/EXP/stream.m3u8 */
function expiryFromUrl(url) {
  try {
    const parts = new URL(url).pathname.split('/').filter(Boolean);
    const exp = parseInt(parts[parts.length - 2], 10);
    return Number.isFinite(exp) ? exp * 1000 : 0;
  } catch {
    return 0;
  }
}

/** True when the player script tag is intact (not split by injected HTML). */
function isValidPlayerScript(script) {
  if (!script) return false;
  if (script.includes('<script>') || /<\/html>,0x/i.test(script)) return false;
  return script.includes('Clappr') && script.includes('if(ID)');
}

/**
 * Extract obfuscated player script between
 * `<script>function _0x....(` and the closing `</script>` after `}else console`.
 */
function extractPlayerScript(html) {
  const open = html.match(PLAYER_OPEN_RE);
  if (!open || open.index == null) return null;

  const bodyStart = open.index + '<script>'.length;
  const footer = html.indexOf('}else console', bodyStart);
  if (footer < 0) return null;

  const close = html.indexOf('</script>', footer);
  if (close < 0) return null;

  const script = html.slice(bodyStart, close);
  return isValidPlayerScript(script) ? script : null;
}

/** Extract and run the obfuscated player bootstrap from embed HTML. */
function sourceFromHtml(html, streamId) {
  const script = extractPlayerScript(html);
  if (!script) return null;
  let captured = null;

  const makePlayer = () => ({
    load(src) {
      captured = src;
    },
    on() {},
    setVolume() {},
    getVolume() {
      return 0;
    }
  });

  const Clappr = new Proxy(
    { Events: { PLAYER_PLAY: 'play', PLAYER_VOLUME_UPDATE: 'vol' } },
    {
      get(target, prop) {
        if (prop in target) return target[prop];
        if (prop === 'then' || prop === Symbol.toStringTag) return undefined;
        return function Player() {
          return makePlayer();
        };
      }
    }
  );

  const document = {
    getElementById() {
      return { style: {}, addEventListener() {} };
    },
    addEventListener() {},
    referrer: 'https://xyzstreams.st/'
  };
  const win = {
    location: {
      href: `${EMBED_ORIGIN}/embed/${streamId}`,
      pathname: `/embed/${streamId}`
    },
    self: null,
    top: null
  };
  win.self = win;
  win.top = win;

  try {
    globalThis.Clappr = Clappr;
    globalThis.document = document;
    globalThis.window = win;
    globalThis.self = win;
    globalThis.top = win;
    // eslint-disable-next-line no-eval
    (0, eval)(script);
  } catch (err) {
    console.error('[embedresolve] deobfuscate failed:', err?.message || err);
    return null;
  } finally {
    delete globalThis.Clappr;
    delete globalThis.document;
    delete globalThis.window;
    delete globalThis.self;
    delete globalThis.top;
  }

  const src = captured?.source || captured;
  return typeof src === 'string' && src.includes('.m3u8') ? src : null;
}

/**
 * Resolve a streamId (e.g. "fox-usa") to a signed upstream m3u8 URL.
 * @returns {{ url: string; referer: string } | null}
 */
export async function resolveEmbedStream(fetch, streamId) {
  const id = (streamId || '').trim();
  if (!/^[a-z0-9._-]{1,80}$/i.test(id)) return null;

  const referer = EMBED_ORIGIN + '/';
  const hit = cache.get(id);
  const now = Date.now();
  if (hit && hit.exp - CACHE_PAD_MS > now) {
    return { url: hit.url, referer: hit.referer };
  }

  let url = null;
  for (let attempt = 0; attempt < FETCH_RETRIES; attempt++) {
    let html;
    try {
      const r = await fetch(`${EMBED_ORIGIN}/embed/${id}`, {
        headers: {
          'user-agent': UA,
          referer: 'https://xyzstreams.st/',
          accept: 'text/html',
          'cache-control': 'no-cache',
          pragma: 'no-cache'
        }
      });
      if (!r.ok) {
        console.warn(`[embedresolve] fetch ${id} attempt ${attempt + 1}: HTTP ${r.status}`);
        continue;
      }
      html = await r.text();
    } catch (err) {
      console.warn(`[embedresolve] fetch ${id} attempt ${attempt + 1}:`, err?.message || err);
      continue;
    }

    const hasOpen = PLAYER_OPEN_RE.test(html);
    url = await withEvalLock(() => sourceFromHtml(html, id));

    if (url) break;

    console.warn(
      `[embedresolve] ${id} attempt ${attempt + 1} failed` +
        (hasOpen ? ' (script corrupt or eval error)' : ' (no <script>function _0x block)')
    );

    if (attempt < FETCH_RETRIES - 1) {
      await new Promise((r) => setTimeout(r, FETCH_RETRY_MS * (attempt + 1)));
    }
  }

  if (!url) return null;

  const exp = expiryFromUrl(url);
  cache.set(id, { url, referer, exp, at: now });
  return { url, referer };
}

export { EMBED_ORIGIN, sourceFromHtml, extractPlayerScript, isValidPlayerScript };

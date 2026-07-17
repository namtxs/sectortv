/**
 * Auto-source pipeline: scrape xyzstreams, verify/classify each stream, and
 * return a normalized list. Shared by the public /api/streams endpoint and the
 * admin endpoint (which lets an admin enable/disable individual auto channels).
 */
import { parseStreams, cleanName } from '$lib/parse.js';
import { getConfig } from '$lib/server/store.js';
import { resolveEmbedStream } from '$lib/server/embedresolve.js';
import { getKv } from '$lib/server/kv.js';

const ORIGIN = 'https://xyzstreams.st';

/** Slug scraped by default when no source is configured in the admin panel. */
const DEFAULT_SLUG = 'worldcup26-2-0714';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

/** Hosts to skip entirely when auto-sourcing (substring match on the URL). */
const BLOCKED_HOSTS = ['247v2.xyzstreams.st'];

// Shared in-memory cache (per warm serverless instance). Scraping + probing
// every stream is expensive (~20-40s); without this, every viewer poll (8s)
// would re-run the whole pipeline and hammer the upstream site.
const FRESH_MS = 30_000; // serve cached result without re-scraping
const STALE_MS = 5 * 60_000; // on scrape failure, keep serving last-good this long
/** @type {Map<string, { at: number; data: any[] }>} */
const cache = new Map();
/** @type {Map<string, Promise<any[]>>} */
const inflight = new Map();

// Maps a pretty stream name ("fox-xyz.m3u8") back to its real upstream URL +
// referer, so /live/[name] can proxy WITHOUT exposing the source URL or a
// ?secret= token. Only names we actually source are resolvable, so this is a
// whitelist (not an open proxy).
/** @type {Map<string, { url: string; referer: string; at: number }>} */
const resolveMap = new Map();

// Hard cap so a long-lived warm instance with churning stream names can't grow
// resolveMap without bound.
const MAX_RESOLVE = 1000;
const RESOLVE_KV_PREFIX = 'sectortv:resolve:';

/** @param {string} name @param {{ url: string; referer: string; at: number }} entry */
async function persistResolve(name, entry) {
  const kv = await getKv();
  if (!kv) return;
  try {
    await kv.set(`${RESOLVE_KV_PREFIX}${name}`, JSON.stringify(entry), {
      ex: Math.ceil(STALE_MS / 1000)
    });
  } catch {
    /* KV optional */
  }
}

/** @param {string} name */
async function loadResolveFromKv(name) {
  const kv = await getKv();
  if (!kv) return null;
  try {
    const raw = await kv.get(`${RESOLVE_KV_PREFIX}${name}`);
    if (!raw) return null;
    const hit = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!hit?.url || Date.now() - (hit.at || 0) > STALE_MS) return null;
    return hit;
  } catch {
    return null;
  }
}

/** Drop stale cache/resolve entries so long-lived instances don't leak memory. */
function pruneMaps() {
  const now = Date.now();
  for (const [k, v] of resolveMap) if (now - v.at > STALE_MS) resolveMap.delete(k);
  for (const [k, v] of cache) if (now - v.at > STALE_MS) cache.delete(k);
  if (resolveMap.size > MAX_RESOLVE) {
    const oldest = [...resolveMap.entries()].sort((a, b) => a[1].at - b[1].at);
    const drop = resolveMap.size - MAX_RESOLVE;
    for (let i = 0; i < drop; i++) resolveMap.delete(oldest[i][0]);
  }
}

/** Allow only safe page slugs like "worldcup-1", "wc-12". Used for the PUBLIC
 * `?m=` query param, so it must stay strict (no arbitrary URLs -> no SSRF). */
export function safeSlug(input) {
  const s = (input || 'worldcup-1').trim().toLowerCase();
  return /^[a-z0-9-]{1,60}$/.test(s) ? s : 'worldcup-1';
}

/**
 * Canonicalize an admin-configured source. Admins may enter either a page slug
 * (e.g. "worldcup26-2-0703") or a full URL to the source page. Trusted input,
 * so a full http(s) URL is allowed here (unlike the public safeSlug). Empty ->
 * default slug.
 */
export function normSource(input) {
  const s = (input || '').trim();
  if (!s) return DEFAULT_SLUG;
  if (/^https?:\/\//i.test(s)) return s.slice(0, 300);
  return safeSlug(s);
}

/** Build the page URL to scrape from a canonical source (slug or full URL). */
function sourceTarget(source) {
  const s = source || DEFAULT_SLUG;
  return /^https?:\/\//i.test(s) ? s : `${ORIGIN}/${safeSlug(s)}`;
}

/** The source currently configured by the admin (falls back to default). */
async function currentSource() {
  try {
    const c = await getConfig();
    return normSource(c.sourceSlug);
  } catch {
    return DEFAULT_SLUG;
  }
}

/** Stable identifier for an auto channel (survives changing stream tokens). */
export function autoKey(server, name) {
  return `${server || 'Server'}::${name || ''}`;
}

/** Unique disable id per stream (file path differs even when names repeat). */
export function autoDisableId(server, file) {
  return `${server || 'Server'}::${file || ''}`;
}

/** @param {string[]} disabled @param {{ disableId?: string; key?: string; server?: string; file?: string }} s */
export function isAutoDisabled(disabled, s) {
  const id = s.disableId || autoDisableId(s.server, s.file);
  return disabled.includes(id) || Boolean(s.key && disabled.includes(s.key));
}

function isBlocked(u) {
  const s = (u || '').toLowerCase();
  return BLOCKED_HOSTS.some((h) => s.includes(h));
}

/** Pretty, file-like name for an upstream URL or streamId. */
function baseName(fileUrl, streamId) {
  if (streamId) {
    const clean = streamId.replace(/[^a-z0-9._-]/gi, '');
    return clean.toLowerCase().endsWith('.m3u8') ? clean : clean + '.m3u8';
  }
  try {
    const p = new URL(fileUrl).pathname;
    const last = p.split('/').filter(Boolean).pop() || 'stream.m3u8';
    const clean = last.replace(/[^a-z0-9._-]/gi, '');
    return clean.toLowerCase().endsWith('.m3u8') ? clean : clean + '.m3u8';
  } catch {
    return 'stream.m3u8';
  }
}

/** Resolve a pretty stream name back to its upstream URL (whitelist lookup). */
export async function resolveAuto(fetch, name, origin) {
  let hit = resolveMap.get(name);
  if (!hit || Date.now() - hit.at > STALE_MS) {
    hit = await loadResolveFromKv(name);
    if (hit) resolveMap.set(name, hit);
  }
  if (!hit || Date.now() - hit.at > STALE_MS) {
    await getAutoStreams(fetch, await currentSource(), origin);
    hit = resolveMap.get(name);
    if (!hit) {
      hit = await loadResolveFromKv(name);
      if (hit) resolveMap.set(name, hit);
    }
  }
  return hit ? { url: hit.url, referer: hit.referer } : null;
}

/**
 * Probe a stream URL, imitating the browser's request (Origin + Referer from
 * OUR site) so we learn whether the CDN allows cross-origin playback for us.
 */
async function probe(fetch, fileUrl, origin) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);
  const site = origin || ORIGIN;
  try {
    const r = await fetch(fileUrl, {
      headers: { 'user-agent': UA, referer: site + '/', origin: site },
      signal: ctrl.signal
    });
    if (!r.ok) return { ok: false, cors: false, hls: false, gated: false };
    const acao = r.headers.get('access-control-allow-origin') || '';
    const cors = acao === '*' || acao === site;
    const ct = r.headers.get('content-type') || '';
    let hls = /mpegurl/i.test(ct);
    let ok = hls || /dash\+xml/i.test(ct);
    if (!ok) {
      const head = (await r.text()).slice(0, 128);
      hls = head.includes('#EXTM3U');
      ok = hls || head.includes('<MPD');
    }
    // Reached via a 302 (e.g. -> ...m3u8?t=..&exp=..): segments are likely
    // token-gated, and hls.js won't carry that query -> must go via proxy.
    return { ok, cors, hls, gated: r.redirected === true };
  } catch {
    return { ok: false, cors: false, hls: false, gated: false };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Is the underlying stream actually still live? Uses CDN-friendly headers
 * (xyzstreams referer) so referer-gated CDNs still serve us the manifest.
 */
async function liveCheck(fetch, fileUrl, referer = ORIGIN + '/') {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);
  try {
    const r = await fetch(fileUrl, {
      headers: { 'user-agent': UA, referer },
      signal: ctrl.signal
    });
    if (!r.ok) return { live: false, hls: false };
    const ct = r.headers.get('content-type') || '';
    if (/mpegurl/i.test(ct)) return { live: true, hls: true };
    if (/dash\+xml/i.test(ct)) return { live: true, hls: false };
    const head = (await r.text()).slice(0, 128);
    if (head.includes('#EXTM3U')) return { live: true, hls: true };
    if (head.includes('<MPD')) return { live: true, hls: false };
    return { live: false, hls: false };
  } catch {
    return { live: false, hls: false };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Decide how a single candidate should be served (or dropped).
 *  - direct: HLS + live (native CORS or via proxy Worker)
 *  - embed:  live but CORS/referer-gated with an embed page available
 *  - null:   dead/stopped or unplayable (e.g. DASH) -> drop
 */
async function classify(fetch, s, origin) {
  // New Server 1 format: embed streamId -> vinix signed m3u8 via player page.
  if (s.streamId && !s.file) {
    const resolved = await resolveEmbedStream(fetch, s.streamId);
    if (!resolved?.url) return null;
    const lc = await liveCheck(fetch, resolved.url, resolved.referer);
    if (!lc.live || !lc.hls) return null;
    return {
      type: 'direct',
      file: resolved.url,
      proxy: true,
      referer: resolved.referer,
      upstream: resolved.url
    };
  }

  if (!s.file) {
    return s.embedUrl ? { type: 'embed', file: s.embedUrl } : null;
  }

  // A .mpd URL is MPEG-DASH, which our HLS-only player can't play.
  const isDash = /\.mpd(\?|#|$)/i.test(s.file);

  const b = await probe(fetch, s.file, origin);
  if (b.ok) {
    const canDirect = b.hls && !isDash;
    // Non-gated + CORS-open: cheapest path, browser plays it directly.
    if (canDirect && b.cors && !b.gated) return { type: 'direct', file: s.file };
    // Gated or CORS-blocked: route via our proxy (pretty /live URL).
    if (canDirect) return { type: 'direct', file: s.file, proxy: true };
    if (s.embedUrl) return { type: 'embed', file: s.embedUrl };
    return null;
  }

  const lc = await liveCheck(fetch, s.file);
  if (!lc.live) return null;
  if (lc.hls && !isDash) return { type: 'direct', file: s.file, proxy: true };
  if (s.embedUrl) return { type: 'embed', file: s.embedUrl };
  return null;
}

/** Fetch a page's HTML with CDN-friendly headers. Returns null on any failure. */
async function fetchHtml(fetch, target) {
  try {
    const res = await fetch(target, {
      headers: { 'user-agent': UA, referer: ORIGIN + '/', accept: 'text/html' }
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

/**
 * Turn one event page's HTML into normalized channels, classifying/probing each
 * candidate. `seen` (source URLs) and `usedNames` (pretty /live names) are
 * SHARED across pages so merging multiple events removes duplicate sources.
 */
async function pageToStreams(fetch, html, origin, seen, usedNames) {
  const candidates = parseStreams(html).filter(
    (s) => !isBlocked(s.file) && !isBlocked(s.embedUrl)
  );
  const decisions = await Promise.all(candidates.map((s) => classify(fetch, s, origin)));

  const out = [];
  const now = Date.now();
  candidates.forEach((s, i) => {
    const d = decisions[i];
    if (!d || seen.has(d.file)) return; // dedupe by source
    seen.add(d.file);

    let file = d.file;
    // Proxied streams get a pretty, file-like URL that hides the source and
    // needs no ?secret=; /live resolves it via the whitelist below.
    if (d.proxy) {
      let base = baseName(s.file, s.streamId);
      if (usedNames.has(base)) {
        const dot = base.lastIndexOf('.');
        base = `${base.slice(0, dot)}-${i}${base.slice(dot)}`;
      }
      usedNames.add(base);
      const entry = {
        url: d.upstream || s.file,
        referer: d.referer || ORIGIN + '/',
        at: now
      };
      resolveMap.set(base, entry);
      void persistResolve(base, entry);
      file = `/live/${base}`;
    }

    const name = cleanName(s);
    const server = s.server || 'Server';
    out.push({
      name,
      server,
      file,
      type: d.type,
      source: 'auto',
      key: autoKey(server, name),
      disableId: autoDisableId(server, file)
    });
  });

  return out;
}

/** Turn an event `href` (e.g. "worldcup26-2-0703.html") into a clean slug. */
function hrefToSlug(href) {
  let h = String(href || '').trim().toLowerCase();
  h = h.split(/[?#]/)[0];
  h = h.split('/').filter(Boolean).pop() || '';
  h = h.replace(/\.html?$/i, '');
  return /^[a-z0-9-]{1,60}$/.test(h) ? h : null;
}

/**
 * Parse the home page's embedded `EVENTS_DATA = [...]` (JS, not strict JSON) to
 * discover current event slugs. Prefers events that are live now / not yet
 * ended, live-first, and caps the count to keep probing cheap.
 */
async function discoverEventSlugs(fetch) {
  const html = await fetchHtml(fetch, ORIGIN + '/');
  if (!html) return [];

  const block = (html.match(/EVENTS_DATA\s*=\s*\[([\s\S]*?)\]\s*;/) || [])[1] || html;
  const events = [];
  const objRe = /\{[^{}]*\}/g;
  let om;
  while ((om = objRe.exec(block))) {
    const o = om[0];
    const href = (o.match(/href\s*:\s*["']([^"']+)["']/) || [])[1];
    if (!href) continue;
    events.push({
      slug: hrefToSlug(href),
      start: Date.parse((o.match(/start\s*:\s*["']([^"']+)["']/) || [])[1] || ''),
      end: Date.parse((o.match(/end\s*:\s*["']([^"']+)["']/) || [])[1] || '')
    });
  }
  // Fallback: no object blocks matched but hrefs exist somewhere in the page.
  if (events.length === 0) {
    const re = /href\s*:\s*["']([^"']+\.html)["']/g;
    let hm;
    while ((hm = re.exec(html))) events.push({ slug: hrefToSlug(hm[1]), start: NaN, end: NaN });
  }

  const now = Date.now();
  const valid = events.filter((e) => e.slug);
  const notEnded = valid.filter((e) => Number.isNaN(e.end) || e.end > now);
  const pool = notEnded.length ? notEnded : valid;
  const liveScore = (e) =>
    !Number.isNaN(e.start) && !Number.isNaN(e.end) && e.start <= now && now <= e.end ? 1 : 0;
  pool.sort((a, b) => {
    const d = liveScore(b) - liveScore(a);
    if (d) return d;
    return (Number.isNaN(a.start) ? Infinity : a.start) - (Number.isNaN(b.start) ? Infinity : b.start);
  });

  const slugs = [];
  for (const e of pool) if (!slugs.includes(e.slug)) slugs.push(e.slug);
  return slugs.slice(0, 8);
}

/**
 * The scrape + probe pipeline (uncached). Scrapes the configured `source`
 * (slug or URL); if that yields nothing, falls back to discovering the current
 * event slugs from the home page and scraping each, merging + deduping sources.
 */
async function scrape(fetch, source, origin) {
  const seen = new Set();
  const usedNames = new Set();

  const primaryHtml = await fetchHtml(fetch, sourceTarget(source));
  let out = primaryHtml ? await pageToStreams(fetch, primaryHtml, origin, seen, usedNames) : [];
  if (out.length > 0) return out;

  // Fallback: figure out what's actually on now from the home page listing.
  const primarySlug = /^https?:\/\//i.test(source) ? null : safeSlug(source);
  const slugs = (await discoverEventSlugs(fetch)).filter((s) => s !== primarySlug);
  if (slugs.length === 0) return out;

  const pages = await Promise.all(slugs.map((s) => fetchHtml(fetch, `${ORIGIN}/${s}`)));
  for (const html of pages) {
    if (!html) continue;
    out.push(...(await pageToStreams(fetch, html, origin, seen, usedNames)));
  }
  return out;
}

/**
 * Fetch + verify the auto-sourced streams from xyzstreams. Returns a
 * normalized list; each item has a stable `key` for admin enable/disable.
 *
 * Cached in-memory (FRESH_MS) and deduped so concurrent viewer polls share a
 * single scrape. On scrape failure the last-good result is served (STALE_MS).
 */
export async function getAutoStreams(fetch, source, origin) {
  pruneMaps();
  const key = normSource(source);
  const now = Date.now();

  const hit = cache.get(key);
  if (hit && now - hit.at < FRESH_MS) return hit.data;

  // Coalesce concurrent scrapes for the same slug into one.
  let promise = inflight.get(key);
  if (!promise) {
    promise = (async () => {
      const out = await scrape(fetch, key, origin);
      const prev = cache.get(key);
      // Don't let a transient empty result wipe a recent good list.
      if (out.length === 0 && prev && Date.now() - prev.at < STALE_MS) {
        return prev.data;
      }
      cache.set(key, { at: Date.now(), data: out });
      return out;
    })().finally(() => inflight.delete(key));
    inflight.set(key, promise);
  }
  return promise;
}

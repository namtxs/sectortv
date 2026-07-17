/**
 * Test parse + classify streamIds (mirrors auto.js classify logic)
 */
import { parseStreams } from '../src/lib/parse.js';
import { resolveEmbedStream } from '../src/lib/server/embedresolve.js';

const SLUG = 'worldcup26-2-0714';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

async function liveCheck(url, referer) {
  try {
    const r = await fetch(url, {
      headers: { referer, 'user-agent': UA },
      signal: AbortSignal.timeout(8000)
    });
    const body = await r.text();
    return { live: r.ok, hls: body.includes('#EXTM3U') };
  } catch {
    return { live: false, hls: false };
  }
}

console.log('=== 1) Parse worldcup page ===');
const pr = await fetch(`https://xyzstreams.st/${SLUG}`, { headers: { 'user-agent': UA } });
const html = await pr.text();
const s1 = parseStreams(html).filter((s) => s.server === 'Server 1' && s.streamId);
console.log(`Server 1 streamIds: ${s1.length}`);
for (const s of s1) console.log(`  ${s.streamId} — ${s.title}`);

console.log('\n=== 2) Classify each streamId ===');
const results = [];
for (const s of s1) {
  const t0 = Date.now();
  const resolved = await resolveEmbedStream(fetch, s.streamId);
  if (!resolved?.url) {
    console.log(`  FAIL ${s.streamId}: no vinix URL (${Date.now() - t0}ms)`);
    results.push({ ...s, status: 'no-url' });
    continue;
  }
  const lc = await liveCheck(resolved.url, resolved.referer);
  const status = lc.live && lc.hls ? 'LIVE' : 'offline';
  console.log(
    `  ${status} ${s.streamId} (${Date.now() - t0}ms) manifest=${lc.live ? 'OK' : lc.hls ? '?' : 'fail'}`
  );
  results.push({ ...s, status, url: resolved.url });
}

const live = results.filter((r) => r.status === 'LIVE');
console.log(`\n=== SUMMARY: ${live.length}/${s1.length} LIVE ===`);
for (const r of live) console.log(`  ✓ ${r.title} (${r.streamId})`);
for (const r of results.filter((r) => r.status !== 'LIVE')) {
  console.log(`  ✗ ${r.title} (${r.streamId}) — ${r.status}`);
}

process.exit(live.length > 0 ? 0 : 1);

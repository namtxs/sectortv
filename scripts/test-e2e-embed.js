/**
 * End-to-end test: extract → deobfuscate → vinix manifest
 * Run: node scripts/test-e2e-embed.js [streamId]
 */
import fs from 'node:fs';
import {
  resolveEmbedStream,
  extractPlayerScript,
  sourceFromHtml,
  EMBED_ORIGIN
} from '../src/lib/server/embedresolve.js';

const streamId = process.argv[2] || 'fox-usa';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

function hr(title) {
  console.log('\n' + '='.repeat(60));
  console.log(title);
  console.log('='.repeat(60));
}

function pass(msg) {
  console.log('  PASS:', msg);
}
function fail(msg) {
  console.log('  FAIL:', msg);
}

// ── 1. Cached corrupt samples (must reject) ──
hr('1) Cached HTML samples (expect reject)');
for (const file of ['tmp-live.html', 'example.html']) {
  if (!fs.existsSync(file)) {
    console.log(`  SKIP: ${file} not found`);
    continue;
  }
  const html = fs.readFileSync(file, 'utf8');
  const hasOpen = /<script>function _0x/i.test(html);
  const script = extractPlayerScript(html);
  const url = sourceFromHtml(html, streamId);
  console.log(`  ${file}:`);
  console.log(`    has <script>function _0x: ${hasOpen}`);
  console.log(`    extract: ${script ? `ok (${script.length}b)` : 'null (corrupt)'}`);
  console.log(`    deobfuscate: ${url ? 'unexpected success' : 'null'}`);
  if (!script && !url) pass(`${file} correctly rejected`);
  else fail(`${file} should have been rejected`);
}

// ── 2. Live fetch + deobfuscate ──
hr(`2) Live resolve: ${streamId}`);
const t0 = Date.now();
const resolved = await resolveEmbedStream(fetch, streamId);
const elapsed = Date.now() - t0;

if (!resolved?.url) {
  fail(`resolveEmbedStream returned null after ${elapsed}ms`);
  process.exit(1);
}

pass(`got vinix URL in ${elapsed}ms`);
console.log('  url:', resolved.url);
console.log('  referer:', resolved.referer);

// validate URL shape
const urlOk =
  /^https:\/\/vinix\.inproviszon\.st\/main\/secure\/[0-9a-f]{64}\/\d+\/.+\.m3u8$/i.test(
    resolved.url
  );
if (urlOk) pass('URL format valid (secure/HMAC/exp/stream.m3u8)');
else fail(`URL format unexpected: ${resolved.url}`);

// ── 3. Manifest fetch with correct referer ──
hr('3) Vinix manifest fetch');
const referer = resolved.referer || EMBED_ORIGIN + '/';

for (const [label, headers] of [
  ['WITH player referer', { referer, 'user-agent': UA }],
  ['WITHOUT referer (control)', { 'user-agent': UA }]
]) {
  try {
    const r = await fetch(resolved.url, { headers });
    const body = await r.text();
    const isM3u8 = body.includes('#EXTM3U');
    console.log(`  ${label}:`);
    console.log(`    HTTP ${r.status}, ${body.length}b, m3u8=${isM3u8}`);
    if (label.includes('WITH') && r.ok && isM3u8) pass('manifest accessible with referer');
    else if (label.includes('WITHOUT')) {
      if (!r.ok || !isM3u8) pass('manifest blocked without referer (expected)');
      else console.log('    note: manifest also works without referer');
    }
    if (isM3u8) {
      const lines = body.split('\n').filter((l) => l && !l.startsWith('#'));
      console.log(`    segments/sample: ${lines.slice(0, 2).join(' | ').slice(0, 120)}...`);
    }
  } catch (err) {
    fail(`${label}: ${err.message}`);
  }
}

// ── 4. Re-fetch embed page directly, verify clean script ──
hr('4) Direct embed page inspection');
let cleanFound = false;
for (let i = 0; i < 8; i++) {
  const r = await fetch(`${EMBED_ORIGIN}/embed/${streamId}`, {
    headers: {
      'user-agent': UA,
      referer: 'https://xyzstreams.st/',
      accept: 'text/html',
      'cache-control': 'no-cache'
    }
  });
  const html = await r.text();
  const script = extractPlayerScript(html);
  const corrupt = script
    ? false
    : /<script>function _0x/i.test(html) && html.includes('<script>\n  (function()');
  console.log(`  attempt ${i + 1}: script=${script ? `clean (${script.length}b)` : corrupt ? 'corrupt' : 'missing'}, html=${html.length}b`);
  if (script) {
    const url = sourceFromHtml(html, streamId);
    if (url?.includes('.m3u8')) {
      cleanFound = true;
      pass(`clean script + deobfuscate OK on attempt ${i + 1}`);
      break;
    }
    console.log('    script extracted but eval failed');
  }
  await new Promise((r) => setTimeout(r, 500 * (i + 1)));
}
if (!cleanFound) fail('no clean script found in 8 direct attempts');

hr('SUMMARY');
if (resolved?.url && urlOk) {
  console.log(`  streamId "${streamId}" → vinix URL OK`);
  console.log('  manifest with referer → tested above');
  process.exit(cleanFound ? 0 : 1);
} else {
  process.exit(1);
}

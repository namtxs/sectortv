import fs from 'node:fs';
import { resolveEmbedStream, extractPlayerScript } from '../src/lib/server/embedresolve.js';

// 1) cached samples — expect corrupt → null
for (const file of ['tmp-live.html', 'example.html']) {
  const html = fs.readFileSync(file, 'utf8');
  const script = extractPlayerScript(html);
  console.log(file, 'extract:', script ? `ok (${script.length}b)` : 'reject (corrupt/missing)');
}

// 2) live fetch with retry
console.log('\n--- live fetch fox-usa ---');
const r = await resolveEmbedStream(fetch, 'fox-usa');
console.log('result:', r?.url?.slice(0, 90) + '...' || 'FAILED');

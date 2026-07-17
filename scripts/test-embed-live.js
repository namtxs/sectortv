import fs from 'node:fs';
import { resolveEmbedStream } from '../src/lib/server/embedresolve.js';

const r = await fetch('https://player.xyzstreams.st/embed/fox-usa', {
  headers: { 'user-agent': 'Mozilla/5.0', referer: 'https://xyzstreams.st/' }
});
console.log('status', r.status, 'len', r.headers.get('content-length'));
const html = await r.text();
fs.writeFileSync('tmp-embed-live.html', html);
console.log('has script', /<script>function _0x/i.test(html));
console.log('resolve', await resolveEmbedStream(async () => ({ ok: true, text: async () => html }), 'fox-usa'));

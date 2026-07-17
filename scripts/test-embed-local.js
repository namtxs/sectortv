import fs from 'node:fs';
import { resolveEmbedStream } from '../src/lib/server/embedresolve.js';

// Test deobfuscation from cached HTML (no network)
const html = fs.readFileSync('tmp-embed.html', 'utf8');

// inline test sourceFromHtml by importing and calling resolve with mock fetch
const mockFetch = async () => ({
  ok: true,
  text: async () => html
});

const r = await resolveEmbedStream(mockFetch, 'fox-usa');
console.log('from cache:', r);

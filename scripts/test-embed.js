import fs from 'node:fs';
import { sourceFromHtml } from '../src/lib/server/embedresolve.js';

const html = fs.readFileSync('tmp-live.html', 'utf8');
console.log('sourceFromHtml', sourceFromHtml(html, 'fox-usa'));

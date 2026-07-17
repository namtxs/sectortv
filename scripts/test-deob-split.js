import fs from 'node:fs';

const html = fs.readFileSync('tmp-live.html', 'utf8');
const bodyStart = html.indexOf('<script>(function(_0x') + '<script>'.length;
const firstClose = html.indexOf('</script>', bodyStart);
const partA = html.slice(bodyStart, firstClose);
const orphan = html.match(/<\/html>,0x[a-f0-9,]+;/i);
const tailStart = html.indexOf(orphan[0]) + orphan[0].length;
const tailEnd = html.indexOf('</script>', tailStart);
const partB = html.slice(tailStart, tailEnd);
const script = partA + partB;

console.log('partA', partA.length, 'partB', partB.length, 'total', script.length);
console.log('partA tail:', partA.slice(-80));
console.log('partB head:', partB.slice(0, 80));

let captured = null;
const makePlayer = () => ({
  load(s) {
    captured = s;
  },
  on() {},
  setVolume() {},
  getVolume() {
    return 0;
  }
});
const Clappr = new Proxy(
  { Events: { PLAYER_PLAY: 'p', PLAYER_VOLUME_UPDATE: 'v' } },
  {
    get(t, p) {
      if (p in t) return t[p];
      if (p === 'then') return undefined;
      return function () {
        return makePlayer();
      };
    }
  }
);
const document = {
  getElementById: () => ({ style: {}, addEventListener() {} }),
  addEventListener: () => {},
  referrer: 'https://xyzstreams.st/'
};
const window = { location: { href: 'https://player.xyzstreams.st/embed/fox-usa' }, self: null, top: null };
window.self = window;
window.top = window;
globalThis.Clappr = Clappr;
globalThis.document = document;
globalThis.window = window;
globalThis.self = window;
globalThis.top = window;
try {
  (0, eval)(script);
  console.log('OK', captured?.source || captured);
} catch (e) {
  console.error('ERR', e.message);
  // try partA only
  try {
    (0, eval)(partA);
    console.log('partA only OK');
  } catch (e2) {
    console.error('partA ERR', e2.message);
  }
}

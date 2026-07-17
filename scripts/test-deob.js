import fs from 'node:fs';

const html = fs.readFileSync('tmp-embed.html', 'utf8');
const m = html.match(/<script>function _0x[a-f0-9]+[\s\S]*?<\/script>/i);
console.log('match', !!m, 'len', m?.[0]?.length);

const script = m[0].replace(/^<script>/i, '').replace(/<\/script>$/i, '');
let captured = null;
const makePlayer = () => ({
  load(src) {
    captured = src;
    console.log('loaded', typeof src === 'string' ? src : src?.source);
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
  getElementById: () => ({ style: {}, addEventListener: () => {} }),
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
  console.log('captured', captured?.source || captured);
} catch (e) {
  console.error('err', e.message);
}

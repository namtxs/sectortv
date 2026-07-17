/**
 * Persistent config store for the admin panel.
 *
 * Uses Vercel KV (Upstash Redis) when its env vars are present — required for
 * production on Vercel, where the filesystem is read-only/ephemeral. Falls back
 * to a local JSON file for development.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { env } from '$env/dynamic/private';

const KEY = 'sectortv:config';
const FILE = path.join(process.cwd(), 'data', 'config.json');
const MODES = ['auto', 'manual', 'both'];
const WM_POS = [
  'center',
  'top-left',
  'top-center',
  'top-right',
  'bottom-left',
  'bottom-center',
  'bottom-right'
];

const DEFAULT = {
  mode: 'both',
  channels: [],
  autoDisabled: [],
  watermark: true,
  watermarkPos: 'center',
  sourceSlug: '',
  ads: defaultAds(),
  announcement: defaultAnnouncement()
};

function defaultAnnouncement() {
  return {
    enabled: false,
    title: '',
    body: '',
    image: '',
    buttonText: '',
    buttonUrl: '',
    frequency: 'once' // 'always' | 'once' | 'daily'
  };
}

function defaultAds() {
  return {
    preroll: {
      enabled: false,
      type: 'image', // 'image' | 'video'
      src: '',
      url: '',
      playDuration: 5,
      totalDuration: 10,
      muted: true
    },
    banner: defaultBanner(),
    bannerBottom: defaultBanner()
  };
}

function defaultBanner() {
  return {
    enabled: false,
    mode: 'image', // 'image' | 'code'
    src: '',
    url: '',
    code: ''
  };
}

/** @type {any} */
let kvClient;

async function getKv() {
  if (kvClient !== undefined) return kvClient;
  if (env.KV_REST_API_URL && env.KV_REST_API_TOKEN) {
    try {
      const { createClient } = await import('@vercel/kv');
      kvClient = createClient({
        url: env.KV_REST_API_URL,
        token: env.KV_REST_API_TOKEN
      });
    } catch {
      kvClient = null;
    }
  } else {
    kvClient = null;
  }
  return kvClient;
}

function normChannel(c) {
  if (!c || !c.name || !c.url) return null;
  return {
    id: c.id || randomUUID(),
    name: String(c.name).trim(),
    url: String(c.url).trim(),
    type: c.type === 'embed' ? 'embed' : 'direct',
    enabled: c.enabled !== false
  };
}

function clampInt(v, min, max, fallback) {
  const n = parseInt(v, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function normBanner(b) {
  const o = b || {};
  return {
    enabled: o.enabled === true,
    mode: o.mode === 'code' ? 'code' : 'image',
    src: String(o.src || '').trim(),
    url: String(o.url || '').trim(),
    code: String(o.code || '')
  };
}

function normAds(a) {
  const d = defaultAds();
  const o = a || {};
  const p = o.preroll || {};
  return {
    preroll: {
      enabled: p.enabled === true,
      type: p.type === 'video' ? 'video' : 'image',
      src: String(p.src || '').trim(),
      url: String(p.url || '').trim(),
      playDuration: clampInt(p.playDuration, 0, 120, d.preroll.playDuration),
      totalDuration: clampInt(p.totalDuration, 1, 300, d.preroll.totalDuration),
      muted: p.muted !== false
    },
    banner: normBanner(o.banner),
    bannerBottom: normBanner(o.bannerBottom)
  };
}

function normAnnouncement(a) {
  const o = a || {};
  const freq = ['always', 'once', 'daily'].includes(o.frequency) ? o.frequency : 'once';
  return {
    enabled: o.enabled === true,
    title: String(o.title || '').trim().slice(0, 120),
    body: String(o.body || '').trim().slice(0, 2000),
    image: String(o.image || '').trim().slice(0, 500),
    buttonText: String(o.buttonText || '').trim().slice(0, 40),
    buttonUrl: String(o.buttonUrl || '').trim().slice(0, 500),
    frequency: freq
  };
}

function normalize(v) {
  const o = v || {};
  return {
    mode: MODES.includes(o.mode) ? o.mode : 'both',
    channels: Array.isArray(o.channels) ? o.channels.map(normChannel).filter(Boolean) : [],
    autoDisabled: Array.isArray(o.autoDisabled)
      ? o.autoDisabled.filter((x) => typeof x === 'string')
      : [],
    watermark: o.watermark !== false,
    watermarkPos: WM_POS.includes(o.watermarkPos) ? o.watermarkPos : 'center',
    sourceSlug: String(o.sourceSlug || '').trim().slice(0, 300),
    ads: normAds(o.ads),
    announcement: normAnnouncement(o.announcement)
  };
}

export async function getConfig() {
  const kv = await getKv();
  if (kv) {
    const v = await kv.get(KEY);
    return normalize(v);
  }
  try {
    return normalize(JSON.parse(await fs.readFile(FILE, 'utf-8')));
  } catch {
    return { ...DEFAULT, channels: [] };
  }
}

export async function saveConfig(cfg) {
  const data = normalize(cfg);
  const kv = await getKv();
  if (kv) {
    await kv.set(KEY, data);
    return data;
  }
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(data, null, 2));
  return data;
}

/** True when a persistent backend (KV) is configured. */
export function hasPersistentStore() {
  return Boolean(env.KV_REST_API_URL && env.KV_REST_API_TOKEN);
}

import { fail, redirect } from '@sveltejs/kit';
import { randomUUID } from 'node:crypto';
import { isAuthed, logout, usingDefaultPassword } from '$lib/server/auth.js';
import { getConfig, saveConfig, hasPersistentStore } from '$lib/server/store.js';

function guard(cookies) {
  if (!isAuthed(cookies)) throw redirect(303, '/admin/login');
}

export async function load({ cookies }) {
  guard(cookies);
  const config = await getConfig();
  return {
    config,
    persistent: hasPersistentStore(),
    defaultPassword: usingDefaultPassword()
  };
}

function readChannel(data) {
  const name = (data.get('name') || '').toString().trim();
  const url = (data.get('url') || '').toString().trim();
  const type = data.get('type') === 'embed' ? 'embed' : 'direct';
  return { name, url, type };
}

export const actions = {
  setMode: async ({ request, cookies }) => {
    guard(cookies);
    const data = await request.formData();
    const mode = (data.get('mode') || '').toString();
    const cfg = await getConfig();
    cfg.mode = mode;
    await saveConfig(cfg);
    return { ok: 'Mode disimpan.' };
  },

  addChannel: async ({ request, cookies }) => {
    guard(cookies);
    const data = await request.formData();
    const { name, url, type } = readChannel(data);
    if (!name || !url) return fail(400, { error: 'Nama dan URL wajib diisi.' });
    const cfg = await getConfig();
    cfg.channels.push({ id: randomUUID(), name, url, type, enabled: true });
    await saveConfig(cfg);
    return { ok: 'Channel ditambahkan.' };
  },

  editChannel: async ({ request, cookies }) => {
    guard(cookies);
    const data = await request.formData();
    const id = (data.get('id') || '').toString();
    const { name, url, type } = readChannel(data);
    if (!name || !url) return fail(400, { error: 'Nama dan URL wajib diisi.' });
    const cfg = await getConfig();
    const ch = cfg.channels.find((c) => c.id === id);
    if (!ch) return fail(404, { error: 'Channel tidak ditemukan.' });
    ch.name = name;
    ch.url = url;
    ch.type = type;
    await saveConfig(cfg);
    return { ok: 'Channel diperbarui.' };
  },

  toggleChannel: async ({ request, cookies }) => {
    guard(cookies);
    const data = await request.formData();
    const id = (data.get('id') || '').toString();
    const cfg = await getConfig();
    const ch = cfg.channels.find((c) => c.id === id);
    if (!ch) return fail(404, { error: 'Channel tidak ditemukan.' });
    ch.enabled = !ch.enabled;
    await saveConfig(cfg);
    return { ok: 'Status channel diubah.' };
  },

  deleteChannel: async ({ request, cookies }) => {
    guard(cookies);
    const data = await request.formData();
    const id = (data.get('id') || '').toString();
    const cfg = await getConfig();
    cfg.channels = cfg.channels.filter((c) => c.id !== id);
    await saveConfig(cfg);
    return { ok: 'Channel dihapus.' };
  },

  toggleAuto: async ({ request, cookies }) => {
    guard(cookies);
    const data = await request.formData();
    const id = (data.get('id') || data.get('key') || '').toString();
    if (!id) return fail(400, { error: 'ID channel kosong.' });
    const cfg = await getConfig();
    const set = new Set(cfg.autoDisabled);
    if (set.has(id)) set.delete(id);
    else set.add(id);
    cfg.autoDisabled = [...set];
    await saveConfig(cfg);
    return { ok: 'Status channel otomatis diubah.' };
  },

  savePreroll: async ({ request, cookies }) => {
    guard(cookies);
    const data = await request.formData();
    const cfg = await getConfig();
    const prev = cfg.ads.preroll;
    cfg.ads.preroll = {
      enabled: data.get('enabled') === 'on',
      type: data.get('type') === 'video' ? 'video' : 'image',
      src: (data.get('src') || '').toString().trim(),
      url: (data.get('url') || '').toString().trim(),
      playDuration: (data.get('playDuration') || '').toString(),
      totalDuration: (data.get('totalDuration') || '').toString(),
      muted: data.has('muted') ? data.get('muted') === 'on' : prev.muted
    };
    await saveConfig(cfg);
    return { ok: 'Iklan pre-roll disimpan.' };
  },

  saveBanner: async ({ request, cookies }) => {
    guard(cookies);
    const data = await request.formData();
    const slot = data.get('slot') === 'bottom' ? 'bannerBottom' : 'banner';
    const cfg = await getConfig();
    const prev = cfg.ads[slot];
    cfg.ads[slot] = {
      enabled: data.get('enabled') === 'on',
      mode: data.get('mode') === 'code' ? 'code' : 'image',
      src: data.has('src') ? (data.get('src') || '').toString().trim() : prev.src,
      url: data.has('url') ? (data.get('url') || '').toString().trim() : prev.url,
      code: data.has('code') ? (data.get('code') || '').toString() : prev.code
    };
    await saveConfig(cfg);
    return { ok: slot === 'bannerBottom' ? 'Banner bawah disimpan.' : 'Banner atas disimpan.' };
  },

  saveWatermark: async ({ request, cookies }) => {
    guard(cookies);
    const data = await request.formData();
    const cfg = await getConfig();
    cfg.watermark = data.get('watermark') === 'on';
    if (data.has('position')) cfg.watermarkPos = (data.get('position') || '').toString();
    await saveConfig(cfg);
    return { ok: cfg.watermark ? 'Watermark diaktifkan.' : 'Watermark dinonaktifkan.' };
  },

  saveAnnouncement: async ({ request, cookies }) => {
    guard(cookies);
    const data = await request.formData();
    const cfg = await getConfig();
    cfg.announcement = {
      enabled: data.get('enabled') === 'on',
      title: (data.get('title') || '').toString(),
      body: (data.get('body') || '').toString(),
      image: (data.get('image') || '').toString(),
      buttonText: (data.get('buttonText') || '').toString(),
      buttonUrl: (data.get('buttonUrl') || '').toString(),
      frequency: (data.get('frequency') || 'once').toString()
    };
    await saveConfig(cfg);
    return { ok: cfg.announcement.enabled ? 'Pengumuman disimpan & aktif.' : 'Pengumuman disimpan.' };
  },

  saveSource: async ({ request, cookies }) => {
    guard(cookies);
    const data = await request.formData();
    const raw = (data.get('sourceSlug') || '').toString().trim();
    if (raw && !/^https?:\/\//i.test(raw) && !/^[a-z0-9-]{1,60}$/i.test(raw)) {
      return fail(400, {
        error: 'Sumber harus berupa slug (huruf/angka/strip) atau URL lengkap (https://…).'
      });
    }
    const cfg = await getConfig();
    cfg.sourceSlug = raw;
    await saveConfig(cfg);
    return { ok: raw ? 'Sumber otomatis disimpan.' : 'Sumber otomatis dikembalikan ke default.' };
  },

  logout: async ({ cookies }) => {
    logout(cookies);
    throw redirect(303, '/admin/login');
  }
};

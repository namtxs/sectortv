<script>
  import { onMount, onDestroy } from 'svelte';
  import Schedule from '$lib/components/Schedule.svelte';
  import Flag from '$lib/components/Flag.svelte';
  import { timeLabel, relDay } from '$lib/fifa.js';

  let { data } = $props();

  let streams = $state([]);
  let loading = $state(true);
  let errorMsg = $state('');
  let activeFile = $state('');
  let activeEmbed = $state('');
  let mobileTab = $state('live'); // 'live' | 'jadwal' (phones only)
  let now = $state(Date.now());
  let viewers = $state(0);
  let ads = $state(null);
  let watermark = $state(true);
  let watermarkPos = $state('center');
  /** @type {any} */ let announcement = $state(null);
  let annOpen = $state(false);

  let container;
  /** @type {any} */ let adsPlugin = null;
  let prerollDone = false;
  /** @type {any} */ let pollTimer = null;
  /** @type {any} */ let clockTimer = null;
  /** @type {any} */ let presenceTimer = null;
  let vid = '';
  /** @type {any} */ let art = null;
  /** @type {any} */ let Artplayer = null;
  /** @type {any} */ let Hls = null;
  /** @type {any} */ let chromecast = null;
  let lastPrerollSig = '';

  const groups = $derived(
    Object.values(
      streams.reduce((acc, s) => {
        const key = s.server || 'Server';
        (acc[key] ??= { server: key, items: [] }).items.push(s);
        return acc;
      }, {})
    )
  );

  // Next fixture to show on the standby screen: any live match first,
  // otherwise the soonest upcoming one.
  const nextMatch = $derived.by(() => {
    const ms = data.matches || [];
    const liveOne = ms.find((m) => m.status === 'live');
    if (liveOne) return liveOne;
    return (
      ms
        .filter((m) => m.status === 'upcoming')
        .slice()
        .sort((a, b) => new Date(a.date) - new Date(b.date))[0] || null
    );
  });

  function countdown(iso) {
    const diff = new Date(iso).getTime() - now;
    if (diff <= 0) return '';
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    const s = Math.floor((diff % 60000) / 1000);
    const d = Math.floor(h / 24);
    if (d > 0) return `${d}h ${h % 24}j ${m}m ${s}d`;
    if (h > 0) return `${h}j ${m}m ${s}d`;
    if (m > 0) return `${m}m ${s}d`;
    return `${s}d`;
  }

  function mono(name) {
    const words = (name || '')
      .replace(/\(.*?\)/g, '')
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (!words.length) return '?';
    if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
    return (words[0][0] + words[1][0]).toUpperCase();
  }

  function quality(name) {
    if (/\b4k\b/i.test(name) || /uhd/i.test(name)) return '4K';
    if (/\bhd\b/i.test(name)) return 'HD';
    return '';
  }

  function baseName(name) {
    return (
      (name || '')
        .replace(/\(?\b4k\b\)?/gi, '')
        .replace(/\(?\buhd\b\)?/gi, '')
        .replace(/\(?\bhd\b\)?/gi, '')
        .replace(/\(\s*\)/g, '')
        .replace(/\s+/g, ' ')
        .trim() || name
    );
  }

  // The source wraps each TS segment behind a fake ~70-byte PNG header
  // (IHDR/IDAT/IEND) as anti-scraping. Native players tolerate the junk and
  // resync, but hls.js's demuxer expects the TS sync byte (0x47) at offset 0,
  // so the leading bytes cause constant buffering/parse errors. Strip anything
  // before the first aligned TS-sync run.
  function stripPngWrapper(ab) {
    const u = new Uint8Array(ab);
    if (!(u[0] === 0x89 && u[1] === 0x50 && u[2] === 0x4e && u[3] === 0x47)) return ab;
    const limit = Math.min(u.length - 188 * 3, 4096);
    for (let i = 0; i < limit; i++) {
      if (u[i] === 0x47 && u[i + 188] === 0x47 && u[i + 376] === 0x47) {
        return i === 0 ? ab : ab.slice(i);
      }
    }
    return ab;
  }

  // Fragment loader that unwraps PNG-wrapped segments before demuxing.
  /** @type {any} */ let PngStripLoader = null;
  function getFragLoader() {
    if (PngStripLoader) return PngStripLoader;
    const Base = Hls.DefaultConfig.loader;
    class Loader extends Base {
      load(context, config, callbacks) {
        const orig = callbacks.onSuccess;
        callbacks.onSuccess = (response, stats, ctx, net) => {
          if (response.data instanceof ArrayBuffer) {
            response.data = stripPngWrapper(response.data);
          }
          orig(response, stats, ctx, net);
        };
        super.load(context, config, callbacks);
      }
    }
    PngStripLoader = Loader;
    return Loader;
  }

  // Browsers block play() until the stream is ready and the video is muted.
  // ArtPlayer calls play() early (before hls.js has a manifest), which fails
  // and leaves the big center play button visible — retry once media is ready.
  function kickAutoplay(video, art) {
    if (!video || !art) return;
    video.muted = true;
    video.playsInline = true;
    video.setAttribute('playsinline', '');
    video.setAttribute('webkit-playsinline', '');
    const p = art.play?.() ?? video.play();
    if (p?.catch) p.catch(() => {});
  }

  function playM3u8(video, url, art) {
    if (Hls.isSupported()) {
      if (art.hls) art.hls.destroy();
      // NOTE: lowLatencyMode makes hls.js aggressively reload the playlist and
      // abort ("cancelled") segment fetches on non-LL-HLS live streams, causing
      // a constant reload/flicker. Keep it off and use a slightly larger live
      // buffer + generous retries for these fragile third-party streams.
      const hls = new Hls({
        lowLatencyMode: false,
        liveSyncDurationCount: 6,
        maxBufferLength: 30,
        maxMaxBufferLength: 60,
        backBufferLength: 30,
        manifestLoadingMaxRetry: 4,
        levelLoadingMaxRetry: 4,
        fragLoadingMaxRetry: 6,
        fLoader: getFragLoader()
      });
      hls.loadSource(url);
      hls.attachMedia(video);
      art.hls = hls;
      video.muted = true;

      // Live streams die often. Try to recover in place; if a fatal error keeps
      // recurring, jump to the next channel automatically.
      let netRetries = 0;
      let mediaRecovers = 0;
      hls.on(Hls.Events.ERROR, (_e, d) => {
        if (!d.fatal) return;
        if (d.type === Hls.ErrorTypes.NETWORK_ERROR) {
          if (netRetries++ < 3) {
            hls.startLoad();
          } else {
            playNext('Stream terputus, pindah channel…');
          }
        } else if (d.type === Hls.ErrorTypes.MEDIA_ERROR) {
          // Bounded recovery: retrying forever causes the visible flicker/reload
          // loop on undecodable streams. Try twice, then skip to a working one.
          if (mediaRecovers === 0) {
            mediaRecovers++;
            hls.recoverMediaError();
          } else if (mediaRecovers === 1) {
            mediaRecovers++;
            hls.swapAudioCodec();
            hls.recoverMediaError();
          } else {
            playNext('Stream tidak dapat diputar, pindah channel…');
          }
        } else {
          playNext('Stream tidak dapat diputar, pindah channel…');
        }
      });
      // A clean frag load means the stream is recovering — reset per-stream
      // retry counters only (not autoSkips; that tracks channel-hopping budget).
      hls.on(Hls.Events.FRAG_LOADED, () => {
        netRetries = 0;
        mediaRecovers = 0;
      });

      // Add a quality switch ONLY when the stream really has multiple
      // resolutions; single-bitrate streams get no (useless) menu.
      hls.on(Hls.Events.MANIFEST_PARSED, (_e, data) => {
        kickAutoplay(video, art);
        const levels = data.levels || [];
        try {
          art.setting.remove('quality');
        } catch {
          /* not added yet */
        }
        if (levels.length > 1) {
          art.setting.add({
            name: 'quality',
            html: 'Kualitas',
            tooltip: 'Auto',
            selector: [
              { html: 'Auto', default: true, value: -1 },
              ...levels.map((l, i) => ({
                html: l.height ? `${l.height}P` : `${Math.round((l.bitrate || 0) / 1000)}k`,
                value: i
              }))
            ],
            onSelect: (item) => {
              art.hls.currentLevel = item.value;
              return item.html;
            }
          });
        }
      });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.muted = true;
      video.playsInline = true;
      video.onerror = () => playNext('Stream tidak dapat diputar, pindah channel…');
      video.oncanplay = () => kickAutoplay(video, art);
      video.src = url;
    } else {
      art.notice.show = 'Format tidak didukung: m3u8';
    }
  }

  // Build the artplayer-plugin-ads config from the admin settings. Returns
  // null when no valid pre-roll is configured (so we don't add the plugin).
  function escAttr(s) {
    return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function prerollSig() {
    const p = ads?.preroll;
    return p ? `${p.enabled}|${p.src}|${p.type}` : '';
  }

  function prerollAvailable() {
    const p = ads?.preroll;
    return Boolean(adsPlugin && p?.enabled && p?.src);
  }

  function buildPreroll() {
    const p = ads?.preroll;
    if (!prerollAvailable() || prerollDone) return null;
    const isVideo = p.type === 'video';
    return adsPlugin({
      [isVideo ? 'video' : 'html']: isVideo
        ? p.src
        : `<img src="${escAttr(p.src)}" style="width:100%;height:100%;object-fit:contain" alt="Iklan" />`,
      url: p.url || undefined,
      playDuration: Number(p.playDuration) || 5,
      totalDuration: Number(p.totalDuration) || 10,
      muted: p.muted !== false,
      i18n: {
        close: 'Lewati Iklan ›',
        countdown: '%s dtk',
        detail: 'Selengkapnya ›',
        canBeClosed: 'Lewati dalam %s dtk'
      }
    });
  }

  // Position of the watermark layer within the player. Corner/edge offsets use
  // container query units so they scale with the player, matching wm-logo size.
  function wmStyle(pos) {
    const pad = 'clamp(8px, 2.5cqw, 22px)';
    const base = { position: 'absolute', pointerEvents: 'none' };
    switch (pos) {
      case 'top-left':
        return { ...base, top: pad, left: pad };
      case 'top-center':
        return { ...base, top: pad, left: '50%', transform: 'translateX(-50%)' };
      case 'top-right':
        return { ...base, top: pad, right: pad };
      case 'bottom-left':
        return { ...base, bottom: pad, left: pad };
      case 'bottom-center':
        return { ...base, bottom: pad, left: '50%', transform: 'translateX(-50%)' };
      case 'bottom-right':
        return { ...base, bottom: pad, right: pad };
      case 'center':
      default:
        return { ...base, top: '50%', left: '50%', transform: 'translate(-50%, -50%)' };
    }
  }
  function makeWmLayer() {
    return {
      name: 'watermark',
      html: '<img class="wm-logo" src="/watermark.png" alt="" />',
      style: wmStyle(watermarkPos)
    };
  }

  // Add/remove/reposition the watermark layer live when the admin changes it.
  let wmApplied = { on: false, pos: '' };
  function syncWatermark() {
    if (!art) return;
    if (watermark === wmApplied.on && watermarkPos === wmApplied.pos) return;
    try {
      try {
        art.layers.remove('watermark');
      } catch {
        /* not added */
      }
      if (watermark) art.layers.add(makeWmLayer());
      wmApplied = { on: watermark, pos: watermarkPos };
    } catch {
      /* layers not ready yet */
    }
  }

  function ensurePlayer(url) {
    if (!Artplayer || !container) return;
    if (art) {
      art.switchUrl(url);
      return;
    }
    const preroll = buildPreroll();
    if (preroll) prerollDone = true;
    wmApplied = { on: watermark, pos: watermarkPos };
    art = new Artplayer({
      container,
      url,
      type: 'm3u8',
      customType: { m3u8: playM3u8 },
      plugins: preroll ? [chromecast({}), preroll] : [chromecast({})],
      layers: watermark ? [makeWmLayer()] : [],
      controls: [
        {
          name: 'live',
          position: 'left',
          html: '<span class="art-live"><i></i>LIVE</span>'
        }
      ],
      isLive: true,
      autoplay: true,
      muted: true,
      playsInline: true,
      moreVideoAttr: {
        playsinline: '',
        'webkit-playsinline': '',
        'x-webkit-airplay': 'allow'
      },
      autoSize: false,
      setting: true,
      playbackRate: true,
      pip: true,
      fullscreen: true,
      fullscreenWeb: false,
      theme: '#2dd36f'
    });
    art.on('ready', () => kickAutoplay(art.video, art));
    art.on('video:canplay', () => kickAutoplay(art.video, art));
    // Single, persistent cleanup for whichever hls instance is current when the
    // player is destroyed (each channel switch replaces art.hls and destroys the
    // previous one in playM3u8, so we must not add a listener per switch).
    art.on('destroy', () => {
      try {
        art?.hls?.destroy();
      } catch {
        /* already gone */
      }
    });
  }

  function destroyPlayer() {
    if (!art) return;
    try {
      art.hls?.destroy();
    } catch {
      /* already gone */
    }
    art.hls = null;
    try {
      art.destroy(false);
    } catch {
      /* already gone */
    }
    art = null;
  }

  // Auto-advance to the next channel when the current one fails. Guarded so a
  // run of all-dead channels doesn't loop forever.
  let autoSkips = 0;
  function playNext(msg) {
    if (!streams.length) return;
    if (autoSkips >= streams.length) {
      errorMsg = 'Semua channel sedang bermasalah. Coba lagi nanti.';
      return;
    }
    autoSkips++;
    const idx = streams.findIndex((s) => s.file === activeFile);
    const next = streams[(idx + 1) % streams.length];
    if (art && msg) art.notice.show = msg;
    if (next && next.file !== activeFile) select(next);
  }

  // Manual channel pick from the list: give it a fresh retry budget.
  function pick(s) {
    autoSkips = 0;
    errorMsg = '';
    track('channel', { name: s.name });
    select(s);
  }

  function select(s) {
    activeFile = s.file;
    if ((s.type || 'direct') === 'embed') {
      destroyPlayer();
      activeEmbed = s.file;
    } else {
      activeEmbed = '';
      ensurePlayer(s.file);
    }
  }

  let mounted = false;

  async function load() {
    loading = true;
    errorMsg = '';
    try {
      const r = await fetch('/api/streams', { cache: 'no-store' });
      if (!r.ok) throw new Error();
      const d = await r.json();
      if (!mounted) return;
      streams = d.streams || [];
      ads = d.ads || null;
      watermark = d.watermark !== false;
      watermarkPos = d.watermarkPos || 'center';
      announcement = d.announcement || null;
      maybeShowAnnouncement();
      if (streams.length) {
        track('channel', { name: streams[0].name });
        select(streams[0]);
      } else {
        destroyPlayer();
        activeFile = '';
        activeEmbed = '';
        errorMsg = 'Tidak ada channel yang aktif saat ini.';
      }
    } catch {
      if (!mounted) return;
      streams = [];
      destroyPlayer();
      activeFile = '';
      activeEmbed = '';
      errorMsg = 'Gagal memuat daftar channel.';
    } finally {
      if (mounted) loading = false;
    }
  }

  // Silent refresh: keep the channel list in sync with the admin panel
  // without interrupting whatever the user is currently watching.
  let refreshing = false;
  async function refresh() {
    if (refreshing) return; // avoid overlapping polls stacking up
    if (typeof document !== 'undefined' && document.hidden) return;
    refreshing = true;
    try {
      const r = await fetch('/api/streams', { cache: 'no-store' });
      if (!r.ok) return;
      const d = await r.json();
      const next = d.streams || [];
      streams = next;
      ads = d.ads || null;
      watermark = d.watermark !== false;
      watermarkPos = d.watermarkPos || 'center';
      announcement = d.announcement || null;
      maybeShowAnnouncement();
      syncWatermark();

      const sig = prerollSig();
      if (sig !== lastPrerollSig) {
        lastPrerollSig = sig;
        if (prerollAvailable() && art && activeFile && !activeEmbed && !prerollDone) {
          const url = activeFile;
          destroyPlayer();
          prerollDone = false;
          ensurePlayer(url);
        }
      }

      if (!next.length) {
        destroyPlayer();
        activeFile = '';
        activeEmbed = '';
        errorMsg = 'Tidak ada channel yang aktif saat ini.';
        return;
      }
      errorMsg = '';

      // Nothing playing yet -> start the first one.
      if (!activeFile) {
        select(next[0]);
        return;
      }
      // The channel being watched was removed/disabled -> move on.
      if (!next.some((s) => s.file === activeFile)) {
        autoSkips = 0;
        select(next[0]);
      }
      // Otherwise leave the running stream untouched.
    } catch {
      /* transient error: keep current state */
    } finally {
      refreshing = false;
    }
  }

  // ---- Announcement modal ----
  // Content-derived id so a changed announcement re-shows even if "once"/"daily"
  // was previously dismissed for the old content.
  function annId(a) {
    const s = `${a.title}|${a.body}|${a.image}|${a.buttonText}|${a.buttonUrl}`;
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return 'a' + (h >>> 0).toString(36);
  }
  function annKey(a) {
    const base = 'stv_ann_' + annId(a);
    return a.frequency === 'daily' ? base + '_' + new Date().toISOString().slice(0, 10) : base;
  }
  function maybeShowAnnouncement() {
    const a = announcement;
    if (!a || !a.enabled || (!a.title && !a.body && !a.image)) {
      annOpen = false;
      return;
    }
    if (a.frequency === 'always') {
      annOpen = true;
      return;
    }
    try {
      annOpen = !localStorage.getItem(annKey(a));
    } catch {
      annOpen = true;
    }
  }
  function closeAnnouncement() {
    const a = announcement;
    if (a && a.frequency !== 'always') {
      try {
        localStorage.setItem(annKey(a), '1');
      } catch {
        /* ignore */
      }
    }
    annOpen = false;
  }

  // Fire-and-forget analytics beacon (no-op if it fails).
  function track(event, extra) {
    try {
      const body = JSON.stringify({ event, ...extra });
      if (navigator.sendBeacon) {
        navigator.sendBeacon('/api/track', new Blob([body], { type: 'application/json' }));
      } else {
        fetch('/api/track', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body,
          keepalive: true
        });
      }
    } catch {
      /* ignore */
    }
  }
  function trackAd(slot) {
    track('adclick', { slot });
  }

  // Live viewer presence: ping every 12s, server returns the count of
  // sessions seen in the last 30s.
  async function heartbeat() {
    if (typeof document !== 'undefined' && document.hidden) return;
    try {
      const r = await fetch('/api/presence', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: vid })
      });
      if (r.ok) {
        const d = await r.json();
        viewers = d.count || 0;
      }
    } catch {
      /* ignore */
    }
  }

  onMount(async () => {
    mounted = true;
    vid = (crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`).slice(0, 64);
    heartbeat();
    presenceTimer = setInterval(heartbeat, 12000);

    const [a, h, cc, ap] = await Promise.all([
      import('artplayer'),
      import('hls.js'),
      import('artplayer-plugin-chromecast'),
      import('artplayer-plugin-ads')
    ]);
    Artplayer = a.default;
    Hls = h.default;
    chromecast = cc.default;
    adsPlugin = ap.default;
    lastPrerollSig = prerollSig();
    await load();
    pollTimer = setInterval(refresh, 8000);
    clockTimer = setInterval(() => (now = Date.now()), 1000);
  });

  // Inject arbitrary banner HTML/JS (ad-network snippets). innerHTML does not
  // execute <script> tags, so we recreate them to make them run.
  function bannerCode(node, code) {
    let current;
    function render(html) {
      // The `ads` object is reassigned on every poll (8s); skip re-injecting
      // when the actual markup hasn't changed so ad scripts don't re-run.
      if (html === current) return;
      current = html;
      node.innerHTML = html || '';
      node.querySelectorAll('script').forEach((old) => {
        const s = document.createElement('script');
        for (const a of old.attributes) s.setAttribute(a.name, a.value);
        s.textContent = old.textContent;
        old.replaceWith(s);
      });
    }
    render(code);
    return {
      update: render,
      destroy() {
        node.innerHTML = '';
        current = undefined;
      }
    };
  }

  onDestroy(() => {
    mounted = false;
    if (pollTimer) clearInterval(pollTimer);
    if (clockTimer) clearInterval(clockTimer);
    if (presenceTimer) clearInterval(presenceTimer);
    destroyPlayer();
  });
</script>

<svelte:head>
  <title>SectorTV — Live Streaming Bola & FIFA World Cup 2026</title>
  <meta
    name="description"
    content="Nonton live streaming sepak bola dan FIFA World Cup 2026 gratis di SectorTV — jadwal, hasil, dan channel HD."
  />
  <link rel="canonical" href="https://tv.sector.web.id/" />
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="SectorTV" />
  <meta property="og:title" content="SectorTV — Live Streaming Bola & FIFA World Cup 2026" />
  <meta
    property="og:description"
    content="Nonton live streaming sepak bola dan FIFA World Cup 2026 gratis di SectorTV."
  />
  <meta property="og:url" content="https://tv.sector.web.id/" />
  <meta property="og:image" content="https://tv.sector.web.id/favicon.svg" />
  <meta name="twitter:card" content="summary" />
  <meta name="twitter:title" content="SectorTV — Live Streaming Bola" />
  <meta
    name="twitter:description"
    content="Live streaming sepak bola & FIFA World Cup 2026 gratis."
  />
</svelte:head>

{#snippet bannerSlot(b, slot)}
  {#if b?.enabled}
    {#if b.mode === 'code' && b.code}
      <div class="ad-banner" use:bannerCode={b.code}></div>
    {:else if b.src}
      <div class="ad-banner">
        {#if b.url}
          <a href={b.url} target="_blank" rel="noopener nofollow sponsored" onclick={() => trackAd(slot)}>
            <img src={b.src} alt="Iklan" />
          </a>
        {:else}
          <img src={b.src} alt="Iklan" />
        {/if}
      </div>
    {/if}
  {/if}
{/snippet}

<div class="sec live-sec" class:m-hide={mobileTab !== 'live'}>
{@render bannerSlot(ads?.banner, 'top')}
<div class="layout">
  <div class="main">
    <div class="player-wrap">
      <div class="player" bind:this={container}></div>
      {#if activeEmbed}
        <iframe
          class="embed-frame"
          src={activeEmbed}
          title="Stream"
          allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
          allowfullscreen
          referrerpolicy="no-referrer"
        ></iframe>
      {/if}
      {#if !activeFile}
        {#if loading}
          <div class="placeholder">
            <span class="spinner"></span>
            <span>Memuat stream…</span>
          </div>
        {:else}
          <div class="standby">
            <div class="sb-body">
              {#if nextMatch}
                <span class="sb-label">
                  {nextMatch.status === 'live' ? 'SEDANG BERLANGSUNG' : 'PERTANDINGAN BERIKUTNYA'}
                </span>

                <div class="sb-match">
                  <div class="sb-team">
                    <Flag src={nextMatch.home.flag} code={nextMatch.home.code} size={46} />
                    <span class="sb-tname">{nextMatch.home.name}</span>
                  </div>

                  <div class="sb-center">
                    {#if nextMatch.status === 'live'}
                      <span class="sb-livebadge"><span class="sb-dot"></span>LIVE</span>
                    {:else}
                      <span class="sb-cd">{countdown(nextMatch.date) || 'Segera'}</span>
                    {/if}
                    <span class="sb-vs">VS</span>
                  </div>

                  <div class="sb-team">
                    <Flag src={nextMatch.away.flag} code={nextMatch.away.code} size={46} />
                    <span class="sb-tname">{nextMatch.away.name}</span>
                  </div>
                </div>

                <span class="sb-meta">
                  {[nextMatch.group || nextMatch.stage, relDay(nextMatch.date) + ' · ' + timeLabel(nextMatch.date), nextMatch.city]
                    .filter(Boolean)
                    .join('  ·  ')}
                </span>
              {:else}
                <span class="sb-label">TIDAK ADA SIARAN</span>
                <p class="sb-empty">Belum ada siaran langsung saat ini. Jadwal pertandingan akan segera tersedia.</p>
              {/if}

              <a class="sb-jadwal" href="#jadwal" onclick={() => (mobileTab = 'jadwal')}>Lihat jadwal lengkap →</a>
            </div>
          </div>
        {/if}
      {/if}
    </div>
  </div>

  <aside class="side-col">
    <div class="side">
      <div class="side-head">
        <span class="side-title">
          <svg class="side-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <rect x="2" y="7" width="20" height="14" rx="2" />
            <path d="m17 2-5 5-5-5" />
          </svg>
          Channel
        </span>
        <div class="side-meta">
          <span class="viewers" title="Penonton online">
            <svg class="v-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
            {(viewers + 1000).toLocaleString('id-ID')}
          </span>
          {#if streams.length}<span class="badge">{streams.length}</span>{/if}
        </div>
      </div>

      <div class="side-body">
        {#if loading}
          <div class="hint"><span class="spinner sm"></span> Memuat channel…</div>
        {:else if streams.length === 0}
          <p class="hint">{errorMsg || 'Tidak ada channel.'}</p>
        {:else}
          {#each groups as g (g.server)}
            <div class="group">
              {#each g.items as s (s.file)}
                {@const q = quality(s.name)}
                <button class="ch" class:active={activeFile === s.file} onclick={() => pick(s)}>
                  <span class="mono">{mono(s.name)}</span>
                  <span class="ch-name">{baseName(s.name)}</span>
                  {#if s.type === 'embed'}
                    <span class="q embed">EMBED</span>
                  {:else if q}
                    <span class="q">{q}</span>
                  {/if}
                  {#if activeFile === s.file}
                    <span class="eq" aria-hidden="true"><span></span><span></span><span></span></span>
                  {/if}
                </button>
              {/each}
            </div>
          {/each}
        {/if}
      </div>
    </div>
  </aside>
</div>
{@render bannerSlot(ads?.bannerBottom, 'bottom')}
</div>

<div class="sec sched-sec" class:m-hide={mobileTab !== 'jadwal'}>
  <Schedule matches={data.matches} error={data.error} />
</div>

<!-- Mobile-only screens -->
<div class="mscreen" class:show={mobileTab === 'kontak'}>
  <h2 class="ms-title">Kontak Admin</h2>
  <p class="ms-sub">Butuh bantuan atau ingin request channel? Hubungi kami.</p>
  <div class="ms-list">
    <a class="ms-item" href="https://t.me/" target="_blank" rel="noreferrer">
      <span class="ms-ic tg">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21.9 4.3 18.6 19c-.2 1-.9 1.3-1.8.8l-4.9-3.6-2.4 2.3c-.3.3-.5.5-1 .5l.3-5 9.1-8.2c.4-.4-.1-.6-.6-.2L6 12.7l-4.8-1.5c-1-.3-1-.9.2-1.4L20.7 3c.9-.3 1.6.2 1.2 1.3Z" fill="currentColor"/></svg>
      </span>
      <span class="ms-tx"><b>Telegram</b><small>@sectortv_admin</small></span>
      <span class="ms-arrow">›</span>
    </a>
    <a class="ms-item" href="https://wa.me/" target="_blank" rel="noreferrer">
      <span class="ms-ic wa">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.5 15.2L2 22l4.9-1.3A10 10 0 1 0 12 2Zm5.3 14.1c-.2.6-1.3 1.2-1.8 1.2-.5.1-1 .1-1.7-.1-.4-.1-.9-.3-1.6-.6-2.8-1.2-4.6-4-4.7-4.2-.1-.2-1.1-1.5-1.1-2.8s.7-2 .9-2.2c.2-.2.5-.3.7-.3h.5c.2 0 .4 0 .6.5l.8 1.9c.1.2.1.4 0 .5l-.4.6c-.2.2-.3.4-.1.7.2.3.8 1.3 1.7 2.1 1.2 1 2.1 1.4 2.4 1.5.2.1.4.1.6-.1l.7-.8c.2-.2.3-.2.6-.1l1.8.9c.3.1.4.2.5.3.1.2.1.7-.1 1.2Z" fill="currentColor"/></svg>
      </span>
      <span class="ms-tx"><b>WhatsApp</b><small>+62 812-0000-0000</small></span>
      <span class="ms-arrow">›</span>
    </a>
    <a class="ms-item" href="mailto:admin@sectortv.id">
      <span class="ms-ic mail">
        <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>
      </span>
      <span class="ms-tx"><b>Email</b><small>admin@sectortv.id</small></span>
      <span class="ms-arrow">›</span>
    </a>
  </div>
</div>

<div class="mscreen" class:show={mobileTab === 'tentang'}>
  <h2 class="ms-title">Tentang</h2>
  <p class="ms-sub">SectorTV — streaming langsung FIFA World Cup 2026™.</p>
  <div class="ms-list">
    <div class="ms-item static">
      <span class="ms-tx"><b>Versi Aplikasi</b><small>1.0.0</small></span>
    </div>
    <a class="ms-item" href="#jadwal" onclick={() => (mobileTab = 'jadwal')}>
      <span class="ms-tx"><b>Jadwal & Hasil</b><small>Lihat semua pertandingan</small></span>
      <span class="ms-arrow">›</span>
    </a>
    <a class="ms-item" href="#tentang">
      <span class="ms-tx"><b>Kebijakan Privasi</b><small>Bagaimana data digunakan</small></span>
      <span class="ms-arrow">›</span>
    </a>
    <div class="ms-item static">
      <span class="ms-tx"><b>Disclaimer</b><small>Konten stream disediakan oleh pihak ketiga.</small></span>
    </div>
  </div>
</div>

<nav class="mnav" aria-label="Navigasi">
  <button class="mnav-btn" class:active={mobileTab === 'live'} onclick={() => (mobileTab = 'live')}>
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" fill="currentColor" /></svg>
    <span>Live</span>
  </button>
  <button class="mnav-btn" class:active={mobileTab === 'jadwal'} onclick={() => (mobileTab = 'jadwal')}>
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></svg>
    <span>Jadwal</span>
  </button>
  <button class="mnav-btn" class:active={mobileTab === 'kontak'} onclick={() => (mobileTab = 'kontak')}>
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
    <span>Kontak</span>
  </button>
  <button class="mnav-btn" class:active={mobileTab === 'tentang'} onclick={() => (mobileTab = 'tentang')}>
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 16v-4M12 8h.01" /></svg>
    <span>Tentang</span>
  </button>
</nav>

<svelte:window
  onkeydown={(e) => {
    if (annOpen && e.key === 'Escape') closeAnnouncement();
  }}
/>

{#if annOpen && announcement}
  <div
    class="ann-overlay"
    role="dialog"
    aria-modal="true"
    aria-label={announcement.title || 'Pengumuman'}
    tabindex="-1"
    onclick={closeAnnouncement}
    onkeydown={() => {}}
  >
    <div class="ann-card" role="document" onclick={(e) => e.stopPropagation()} onkeydown={() => {}}>
      <button class="ann-x" type="button" onclick={closeAnnouncement} aria-label="Tutup">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
      </button>
      {#if announcement.image}
        <img class="ann-img" src={announcement.image} alt="" />
      {/if}
      <div class="ann-content">
        {#if announcement.title}<h2 class="ann-title">{announcement.title}</h2>{/if}
        {#if announcement.body}<p class="ann-text">{announcement.body}</p>{/if}
        <div class="ann-actions">
          {#if announcement.buttonText && announcement.buttonUrl}
            <a
              class="ann-btn"
              href={announcement.buttonUrl}
              target="_blank"
              rel="noopener nofollow"
              onclick={closeAnnouncement}>{announcement.buttonText}</a
            >
          {/if}
          <button class="ann-dismiss" type="button" onclick={closeAnnouncement}>Tutup</button>
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  /* ---------- Announcement modal ---------- */
  .ann-overlay {
    position: fixed;
    inset: 0;
    z-index: 100;
    display: grid;
    place-items: center;
    padding: 18px;
    background: rgba(4, 6, 10, 0.72);
    -webkit-backdrop-filter: blur(6px);
    backdrop-filter: blur(6px);
    animation: annFade 0.2s ease;
  }
  .ann-card {
    position: relative;
    width: 100%;
    max-width: 540px;
    max-height: 88dvh;
    overflow: auto;
    border: 1px solid var(--line);
    border-radius: 18px;
    background: var(--bg-elev);
    box-shadow: var(--shadow);
    animation: annPop 0.28s cubic-bezier(0.2, 0.7, 0.3, 1);
  }
  .ann-x {
    position: absolute;
    top: 10px;
    right: 10px;
    z-index: 2;
    width: 34px;
    height: 34px;
    display: grid;
    place-items: center;
    border: none;
    border-radius: 10px;
    background: color-mix(in srgb, var(--bg) 55%, transparent);
    -webkit-backdrop-filter: blur(6px);
    backdrop-filter: blur(6px);
    color: #fff;
  }
  .ann-x svg {
    width: 17px;
    height: 17px;
  }
  .ann-img {
    display: block;
    width: 100%;
    max-height: 260px;
    object-fit: cover;
    border-bottom: 1px solid var(--line-soft);
  }
  .ann-content {
    padding: 24px 26px;
  }
  .ann-title {
    margin: 0 0 8px;
    font-size: 19px;
    font-weight: 800;
    letter-spacing: -0.3px;
  }
  .ann-text {
    margin: 0;
    font-size: 14px;
    line-height: 1.6;
    color: var(--text-dim);
    white-space: pre-wrap;
  }
  .ann-actions {
    display: flex;
    gap: 10px;
    margin-top: 18px;
  }
  .ann-btn {
    flex: 1;
    text-align: center;
    padding: 11px 16px;
    border-radius: 11px;
    background: var(--brand);
    color: #04130a;
    font-size: 14px;
    font-weight: 800;
  }
  .ann-dismiss {
    padding: 11px 16px;
    border-radius: 11px;
    border: 1px solid var(--line);
    background: var(--bg-elev-2);
    color: var(--text-dim);
    font-size: 14px;
    font-weight: 700;
  }
  .ann-dismiss:hover {
    color: var(--text);
    background: var(--bg-hover);
  }
  @keyframes annFade {
    from {
      opacity: 0;
    }
  }
  @keyframes annPop {
    from {
      opacity: 0;
      transform: translateY(12px) scale(0.97);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .ann-overlay,
    .ann-card {
      animation: none;
    }
  }

  .ad-banner {
    display: flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 16px;
    min-height: 0;
    overflow: hidden;
    border-radius: var(--radius);
  }
  .ad-banner :global(img) {
    max-width: 100%;
    height: auto;
    display: block;
    border-radius: var(--radius);
  }
  @media (max-width: 560px) {
    .ad-banner {
      margin: 0 calc(var(--gutter) * -1) 10px;
      border-radius: 0;
    }
  }

  /* ---- Pre-roll ads plugin polish (overrides the plugin's plain default) ---- */
  :global(.artplayer-plugin-ads) {
    background:
      radial-gradient(120% 90% at 50% 0%, #14181f, #05070a 70%) !important;
    animation: adFade 0.35s ease both;
  }
  :global(.artplayer-plugin-ads-html) {
    animation: adZoom 0.5s cubic-bezier(0.2, 0.7, 0.3, 1) both;
  }
  /* "IKLAN" badge, top-left */
  :global(.artplayer-plugin-ads)::before {
    content: 'IKLAN';
    position: absolute;
    top: 12px;
    left: 12px;
    z-index: 6;
    font-size: 10px;
    font-weight: 800;
    letter-spacing: 1.2px;
    padding: 5px 10px;
    border-radius: 7px;
    color: #fff;
    background: rgba(8, 10, 14, 0.5);
    -webkit-backdrop-filter: blur(8px);
    backdrop-filter: blur(8px);
    border: 1px solid rgba(255, 255, 255, 0.16);
    animation: adSlideDown 0.5s ease both;
    pointer-events: none;
  }

  /* Timer cluster (skip + countdown), top-right */
  :global(.artplayer-plugin-ads-timer) {
    top: 12px !important;
    right: 12px !important;
    gap: 8px !important;
    animation: adSlideDown 0.5s ease both;
  }
  :global(.artplayer-plugin-ads-timer > div) {
    background: rgba(10, 12, 16, 0.55) !important;
    -webkit-backdrop-filter: blur(12px);
    backdrop-filter: blur(12px);
    border: 1px solid rgba(255, 255, 255, 0.14) !important;
    border-radius: 999px !important;
    padding: 9px 15px !important;
    margin-left: 0 !important;
    font-size: 12.5px !important;
    font-weight: 700 !important;
    color: #fff !important;
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.4) !important;
    transition:
      transform 0.16s ease,
      background 0.16s ease,
      border-color 0.16s ease,
      color 0.16s ease;
  }
  :global(.artplayer-plugin-ads-countdown) {
    color: rgba(255, 255, 255, 0.75) !important;
    font-variant-numeric: tabular-nums;
  }
  /* Skip button: prominent, brand-tinted, lifts + fills on hover */
  :global(.artplayer-plugin-ads-close) {
    color: #fff !important;
    border-color: color-mix(in srgb, var(--brand) 45%, transparent) !important;
    background: color-mix(in srgb, var(--brand) 16%, rgba(10, 12, 16, 0.55)) !important;
    animation: adPulse 1.8s ease-in-out infinite;
  }
  :global(.artplayer-plugin-ads-close:hover) {
    transform: translateY(-1px) scale(1.03);
    background: var(--brand) !important;
    border-color: transparent !important;
    color: #04130a !important;
    box-shadow: 0 8px 24px color-mix(in srgb, var(--brand) 40%, transparent) !important;
  }

  /* Bottom-right controls (detail / mute / fullscreen) */
  :global(.artplayer-plugin-ads-control) {
    bottom: 12px !important;
    right: 12px !important;
    gap: 8px !important;
    animation: adSlideUp 0.5s ease both;
  }
  :global(.artplayer-plugin-ads-control > div) {
    background: rgba(10, 12, 16, 0.55) !important;
    -webkit-backdrop-filter: blur(12px);
    backdrop-filter: blur(12px);
    border: 1px solid rgba(255, 255, 255, 0.14) !important;
    border-radius: 999px !important;
    padding: 8px 12px !important;
    margin-left: 0 !important;
    font-weight: 700 !important;
    color: #fff !important;
    transition:
      transform 0.16s ease,
      background 0.16s ease,
      color 0.16s ease;
  }
  :global(.artplayer-plugin-ads-control > div:hover) {
    transform: translateY(-1px);
    background: rgba(20, 24, 30, 0.8) !important;
  }
  :global(.artplayer-plugin-ads-detail:hover) {
    background: var(--brand) !important;
    color: #04130a !important;
  }

  @keyframes adFade {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }
  @keyframes adZoom {
    from {
      transform: scale(1.05);
      opacity: 0.3;
    }
    to {
      transform: scale(1);
      opacity: 1;
    }
  }
  @keyframes adSlideDown {
    from {
      transform: translateY(-10px);
      opacity: 0;
    }
    to {
      transform: translateY(0);
      opacity: 1;
    }
  }
  @keyframes adSlideUp {
    from {
      transform: translateY(10px);
      opacity: 0;
    }
    to {
      transform: translateY(0);
      opacity: 1;
    }
  }
  @keyframes adPulse {
    0%,
    100% {
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.4);
    }
    50% {
      box-shadow: 0 6px 24px color-mix(in srgb, var(--brand) 45%, transparent);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    :global(.artplayer-plugin-ads),
    :global(.artplayer-plugin-ads-html),
    :global(.artplayer-plugin-ads)::before,
    :global(.artplayer-plugin-ads-timer),
    :global(.artplayer-plugin-ads-control),
    :global(.artplayer-plugin-ads-close) {
      animation: none;
    }
  }

  .layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 360px;
    gap: 20px;
    align-items: stretch;
  }
  .main {
    min-width: 0;
    display: flex;
    flex-direction: column;
  }

  .player-wrap {
    position: relative;
    width: 100%;
    aspect-ratio: 16 / 9;
    background: #000;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    overflow: hidden;
    box-shadow: var(--shadow);
  }
  .player {
    width: 100%;
    height: 100%;
  }
  .embed-frame {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    border: 0;
    background: #000;
    z-index: 2;
  }
  .placeholder {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    text-align: center;
    padding: 20px;
    color: var(--text-dim);
    font-size: 14px;
  }

  /* ---------- Standby (no live channel) ---------- */
  .standby {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    padding: clamp(14px, 3.5vw, 28px);
    color: #fff;
    background:
      radial-gradient(120% 80% at 50% 0%, rgba(45, 211, 111, 0.16), transparent 60%),
      linear-gradient(180deg, #0a1410, #05080c 70%);
  }
  .sb-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--brand-2);
    animation: artblink 1.4s infinite;
  }
  @keyframes artblink {
    50% {
      opacity: 0.25;
    }
  }

  .sb-body {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: clamp(10px, 2vw, 18px);
    text-align: center;
  }
  .sb-label {
    font-size: clamp(10px, 1.6vw, 12px);
    font-weight: 800;
    letter-spacing: 1.6px;
    color: var(--brand-2);
  }
  .sb-match {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: clamp(14px, 5vw, 48px);
    width: 100%;
    max-width: 560px;
  }
  .sb-team {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
  }
  .sb-tname {
    font-size: clamp(13px, 2.4vw, 18px);
    font-weight: 700;
    line-height: 1.2;
  }
  .sb-center {
    flex: none;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
  }
  .sb-cd {
    font-size: clamp(15px, 3.4vw, 26px);
    font-weight: 800;
    font-variant-numeric: tabular-nums;
    color: #fff;
    line-height: 1;
  }
  .sb-vs {
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 1px;
    color: rgba(255, 255, 255, 0.45);
  }
  .sb-livebadge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: clamp(13px, 2.6vw, 18px);
    font-weight: 800;
    color: var(--live, #ff4d4f);
  }
  .sb-livebadge .sb-dot {
    background: var(--live, #ff4d4f);
    width: 8px;
    height: 8px;
  }
  .sb-meta {
    font-size: clamp(10.5px, 1.8vw, 13px);
    color: rgba(255, 255, 255, 0.6);
    max-width: 90%;
  }
  .sb-empty {
    margin: 0;
    max-width: 360px;
    font-size: 13px;
    line-height: 1.5;
    color: rgba(255, 255, 255, 0.65);
  }
  .sb-jadwal {
    margin-top: 4px;
    font-size: 12.5px;
    font-weight: 700;
    color: var(--brand-2);
    padding: 7px 14px;
    border-radius: 999px;
    background: rgba(45, 211, 111, 0.12);
    border: 1px solid rgba(45, 211, 111, 0.3);
  }

  @media (max-width: 560px) {
    .standby {
      padding: 12px;
    }
    .sb-body {
      gap: 8px;
    }
    .sb-match {
      gap: 12px;
    }
    .sb-team {
      gap: 7px;
    }
    .sb-team :global(.flag) {
      width: 42px !important;
      height: 31px !important;
    }
    .sb-tname {
      font-size: 12.5px;
    }
    .sb-label {
      font-size: 9.5px;
      letter-spacing: 1.2px;
    }
    .sb-cd {
      font-size: 16px;
    }
    .sb-vs {
      font-size: 9.5px;
    }
    .sb-livebadge {
      font-size: 14px;
    }
    .sb-meta {
      font-size: 10px;
    }
    .sb-jadwal {
      font-size: 11.5px;
      padding: 6px 12px;
    }
  }

  /* Right column wrapper: its content is absolutely positioned so the grid
     row height is driven by the player on the left -> equal heights. */
  .side-col {
    position: relative;
  }
  .side {
    position: absolute;
    inset: 0;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--bg-elev);
    overflow: hidden;
    box-shadow: var(--shadow);
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  .side-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 16px;
    border-bottom: 1px solid var(--line-soft);
  }
  .side-title {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    font-weight: 700;
    letter-spacing: 0.3px;
    text-transform: uppercase;
    color: var(--text-dim);
  }
  .side-ic {
    width: 16px;
    height: 16px;
    color: var(--brand-2);
    flex: none;
  }
  .side-meta {
    display: flex;
    align-items: center;
    gap: 7px;
  }
  .viewers {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 12px;
    font-weight: 700;
    color: var(--live);
    background: color-mix(in srgb, var(--live) 12%, transparent);
    border-radius: 999px;
    padding: 2px 9px;
    font-variant-numeric: tabular-nums;
  }
  .v-ic {
    width: 13px;
    height: 13px;
  }
  .badge {
    font-size: 12px;
    font-weight: 700;
    color: var(--brand-2);
    background: color-mix(in srgb, var(--brand) 14%, transparent);
    border-radius: 999px;
    padding: 2px 10px;
  }
  .side-body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 10px;
  }
  .hint {
    margin: 0;
    padding: 20px 6px;
    color: var(--text-dim);
    font-size: 13px;
    text-align: center;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
  }

  .group + .group {
    margin-top: 6px;
  }

  .ch {
    display: flex;
    align-items: center;
    gap: 11px;
    width: 100%;
    text-align: left;
    padding: 9px 11px;
    margin-bottom: 4px;
    border-radius: 12px;
    border: 1px solid transparent;
    background: transparent;
    color: var(--text-dim);
    transition:
      background 0.13s ease,
      color 0.13s ease,
      border-color 0.13s ease;
  }
  .ch:hover {
    background: var(--bg-hover);
    color: var(--text);
  }
  .ch.active {
    background: color-mix(in srgb, var(--brand) 14%, transparent);
    border-color: color-mix(in srgb, var(--brand) 40%, transparent);
    color: var(--text);
  }

  .mono {
    flex: none;
    width: 36px;
    height: 36px;
    display: grid;
    place-items: center;
    border-radius: 9px;
    background: var(--bg-elev-2);
    box-shadow: inset 0 0 0 1px var(--line);
    font-size: 12px;
    font-weight: 800;
    letter-spacing: 0.3px;
    color: var(--text-dim);
  }
  .ch.active .mono {
    background: linear-gradient(150deg, var(--brand-2), var(--brand-dim));
    box-shadow: none;
    color: #04130a;
  }
  .ch-name {
    flex: 1;
    min-width: 0;
    font-size: 14px;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .q {
    flex: none;
    font-size: 10px;
    font-weight: 800;
    letter-spacing: 0.4px;
    color: var(--brand-2);
    border: 1px solid color-mix(in srgb, var(--brand) 40%, transparent);
    border-radius: 5px;
    padding: 2px 5px;
  }
  .q.embed {
    color: #60a5fa;
    border-color: color-mix(in srgb, #60a5fa 45%, transparent);
  }

  .eq {
    flex: none;
    display: flex;
    align-items: flex-end;
    gap: 2px;
    height: 15px;
  }
  .eq span {
    width: 3px;
    height: 4px;
    border-radius: 2px;
    background: var(--brand-2);
    animation: eq 0.9s ease-in-out infinite;
  }
  .eq span:nth-child(2) {
    animation-delay: 0.18s;
  }
  .eq span:nth-child(3) {
    animation-delay: 0.36s;
  }
  @keyframes eq {
    0%,
    100% {
      height: 4px;
    }
    50% {
      height: 15px;
    }
  }

  .spinner {
    width: 26px;
    height: 26px;
    border-radius: 50%;
    border: 3px solid var(--bg-elev-2);
    border-top-color: var(--brand);
    animation: spin 0.8s linear infinite;
  }
  .spinner.sm {
    width: 16px;
    height: 16px;
    border-width: 2px;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  @media (max-width: 820px) {
    .layout {
      grid-template-columns: 1fr;
      gap: 16px;
    }
    .side-col {
      position: static;
      min-height: 0;
    }
    .side {
      position: static;
      max-height: none;
    }
    .side-body {
      overflow: visible;
    }
  }

  /* Phone: immersive edge-to-edge player + flush native channel list. */
  @media (max-width: 560px) {
    .layout {
      gap: 8px;
    }
    .player-wrap {
      margin: 0 calc(var(--gutter) * -1);
      width: auto;
      border-radius: 0;
      border-left: none;
      border-right: none;
    }
    .side {
      margin: 0 calc(var(--gutter) * -1);
      border: none;
      border-radius: 0;
      box-shadow: none;
      background: transparent;
    }
    .side-head {
      padding: 10px var(--gutter) 12px;
    }
    .side-body {
      padding: 0 var(--gutter) 4px;
    }
    .group + .group {
      margin-top: 10px;
    }
    .ch {
      padding: 11px 12px;
      margin-bottom: 2px;
      border-radius: 14px;
    }
    .ch:active {
      transform: scale(0.985);
      background: var(--bg-hover);
    }
    .mono {
      width: 40px;
      height: 40px;
    }
    .ch-name {
      font-size: 15px;
    }
  }

  /* ---------- Mobile app shell ---------- */
  .mnav {
    display: none;
  }
  .mscreen {
    display: none;
  }

  @media (max-width: 820px) {
    .sec.m-hide {
      display: none;
    }
    /* When schedule is its own screen, drop the desktop top divider. */
    .sched-sec :global(.sched) {
      margin-top: 0;
      border-top: none;
    }

    .mscreen.show {
      display: block;
      padding-top: 16px;
      animation: msfade 0.25s ease;
    }

    /* Floating Expo-style tab bar */
    .mnav {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 2px;
      position: fixed;
      left: 12px;
      right: 12px;
      bottom: calc(10px + var(--safe-bottom));
      z-index: 50;
      padding: 5px 6px;
      border-radius: 20px;
      background: color-mix(in srgb, var(--bg-elev) 82%, transparent);
      backdrop-filter: blur(20px) saturate(150%);
      border: 1px solid color-mix(in srgb, #fff 8%, transparent);
      box-shadow:
        0 12px 34px -10px rgba(0, 0, 0, 0.7),
        inset 0 1px 0 rgba(255, 255, 255, 0.06);
    }
    .mnav-btn {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 2px;
      padding: 6px 0 5px;
      border: none;
      background: none;
      border-radius: 14px;
      color: var(--text-faint);
      font-size: 10px;
      font-weight: 600;
      letter-spacing: 0.2px;
      transition:
        color 0.16s ease,
        background 0.16s ease,
        transform 0.1s ease;
    }
    .mnav-btn svg {
      width: 20px;
      height: 20px;
      transition: transform 0.16s ease;
    }
    .mnav-btn.active {
      color: var(--brand-2);
      background: color-mix(in srgb, var(--brand) 14%, transparent);
    }
    .mnav-btn.active svg {
      transform: translateY(-1px) scale(1.06);
    }
    .mnav-btn:active {
      transform: scale(0.9);
    }
  }

  /* Mobile sub-screens (Kontak / Tentang) */
  .ms-title {
    margin: 0;
    font-size: 22px;
    font-weight: 800;
    letter-spacing: -0.4px;
  }
  .ms-sub {
    margin: 6px 0 16px;
    font-size: 13px;
    line-height: 1.5;
    color: var(--text-dim);
  }
  .ms-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .ms-item {
    display: flex;
    align-items: center;
    gap: 13px;
    padding: 14px 15px;
    border-radius: 16px;
    border: 1px solid var(--line);
    background: var(--bg-elev);
    color: var(--text);
    transition:
      background 0.14s ease,
      transform 0.1s ease;
  }
  .ms-item:active:not(.static) {
    transform: scale(0.99);
    background: var(--bg-hover);
  }
  .ms-ic {
    flex: none;
    width: 42px;
    height: 42px;
    display: grid;
    place-items: center;
    border-radius: 12px;
    color: #fff;
  }
  .ms-ic svg {
    width: 22px;
    height: 22px;
  }
  .ms-ic.tg {
    background: linear-gradient(150deg, #2aabee, #1c8fd0);
  }
  .ms-ic.wa {
    background: linear-gradient(150deg, #2ecc71, #25a85b);
  }
  .ms-ic.mail {
    background: linear-gradient(150deg, var(--brand-2), var(--brand-dim));
  }
  .ms-tx {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .ms-tx b {
    font-size: 15px;
    font-weight: 700;
  }
  .ms-tx small {
    font-size: 12.5px;
    color: var(--text-dim);
  }
  .ms-arrow {
    flex: none;
    font-size: 22px;
    line-height: 1;
    color: var(--text-faint);
  }
  @keyframes msfade {
    from {
      opacity: 0;
      transform: translateY(6px);
    }
  }
</style>

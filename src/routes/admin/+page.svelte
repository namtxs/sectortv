<script>
  import { enhance } from '$app/forms';
  import { onMount, onDestroy } from 'svelte';

  let { data, form } = $props();

  let page = $state('beranda');
  /** @type {Set<string>} */ let openGroups = $state(new Set(['channel', 'settings']));
  let editingId = $state('');
  let addType = $state('direct');
  let prType = $state(data.config.ads.preroll.type);
  let prEnabled = $state(data.config.ads.preroll.enabled);
  let prMuted = $state(data.config.ads.preroll.muted);
  let bMode = $state(data.config.ads.banner.mode);
  let bEnabled = $state(data.config.ads.banner.enabled);
  let bModeBottom = $state(data.config.ads.bannerBottom.mode);
  let bBottomEnabled = $state(data.config.ads.bannerBottom.enabled);
  // Watermark controls: local state so changing the position doesn't reset the
  // on/off toggle (both fields submit together via the shared form).
  let wmOn = $state(data.config.watermark);
  let wmPos = $state(data.config.watermarkPos);
  // Announcement controls (local state, same reasoning as watermark).
  let annOn = $state(data.config.announcement.enabled);
  let annFreq = $state(data.config.announcement.frequency);

  // Auto channels are loaded client-side (the scrape is slow, ~20-40s).
  /** @type {any[] | null} */ let autoList = $state(null);
  let autoLoading = $state(false);
  let autoError = $state('');

  /** @type {any} */ let statsData = $state(null);
  let statsLoading = $state(false);
  let statsError = $state('');

  /** @type {number | null} */ let viewers = $state(null);

  const modes = [
    { id: 'auto', label: 'Otomatis', desc: 'Ambil channel dari sumber' },
    { id: 'manual', label: 'Manual', desc: 'Hanya channel buatan sendiri' },
    { id: 'both', label: 'Keduanya', desc: 'Gabungan manual + otomatis' }
  ];

  const modeLabel = $derived(
    { auto: 'Otomatis', manual: 'Manual', both: 'Keduanya' }[data.config.mode] || data.config.mode
  );
  const totalAdClicks = $derived(
    statsData
      ? (statsData.adclicks.top || 0) + (statsData.adclicks.bottom || 0) + (statsData.adclicks.preroll || 0)
      : 0
  );

  const manualDirect = $derived(data.config.channels.filter((c) => c.type !== 'embed'));
  const manualEmbed = $derived(data.config.channels.filter((c) => c.type === 'embed'));

  const autoGroups = $derived.by(() => {
    if (!autoList) return [];
    const m = {};
    for (const c of autoList) (m[c.server] ??= { server: c.server, items: [] }).items.push(c);
    return Object.values(m);
  });
  const autoActive = $derived(autoList ? autoList.filter((c) => c.enabled).length : 0);

  const nav = [
    { id: 'beranda', label: 'Beranda', icon: 'M3 10.5 12 3l9 7.5M5 9v11h14V9' },
    {
      id: 'channel',
      label: 'Channel',
      icon: 'M13 2 3 14h7l-1 8 10-12h-7l1-8z',
      children: [
        { id: 'channel.otomatis', label: 'Otomatis' },
        { id: 'channel.manual', label: 'Manual' }
      ]
    },
    {
      id: 'settings',
      label: 'Pengaturan',
      icon: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6',
      children: [
        { id: 'settings.source', label: 'Sumber' },
        { id: 'settings.mode', label: 'Mode' },
        { id: 'settings.watermark', label: 'Watermark' },
        { id: 'settings.announcement', label: 'Pengumuman' },
        { id: 'settings.security', label: 'Keamanan' }
      ]
    },
    {
      id: 'ads',
      label: 'Iklan',
      icon: 'm3 11 18-5v12L3 14v-3z M11.6 16.8a3 3 0 1 1-5.8-1.6',
      children: [
        { id: 'ads.preroll', label: 'Pre-roll' },
        { id: 'ads.banner-top', label: 'Banner Atas' },
        { id: 'ads.banner-bottom', label: 'Banner Bawah' }
      ]
    },
    {
      id: 'stats',
      label: 'Statistik',
      icon: 'M3 3v18h18 M8 16V10 M13 16V6 M18 16v-3',
      children: [
        { id: 'stats.ads', label: 'Klik Iklan' },
        { id: 'stats.channels', label: 'Channel Populer' }
      ]
    }
  ];

  const meta = {
    beranda: { t: 'Beranda', s: 'Ringkasan performa & status sistem' },
    'channel.otomatis': { t: 'Channel Otomatis', s: 'Aktif/nonaktifkan channel dari sumber' },
    'channel.manual': { t: 'Channel Manual', s: 'Tambah & atur channel buatan sendiri' },
    'settings.source': { t: 'Sumber Otomatis', s: 'Slug atau URL halaman yang di-scrape' },
    'settings.mode': { t: 'Mode Sumber', s: 'Otomatis, manual, atau gabungan keduanya' },
    'settings.watermark': { t: 'Watermark', s: 'Logo dan posisi di atas player' },
    'settings.announcement': { t: 'Pengumuman', s: 'Popup info untuk pengunjung homepage' },
    'settings.security': { t: 'Keamanan', s: 'Password admin dan penyimpanan data' },
    'ads.preroll': { t: 'Iklan Pre-roll', s: 'Tampil sebelum stream diputar' },
    'ads.banner-top': { t: 'Banner Atas', s: 'Slot iklan di atas player' },
    'ads.banner-bottom': { t: 'Banner Bawah', s: 'Slot iklan di bawah player' },
    'stats.ads': { t: 'Statistik Iklan', s: 'Jumlah klik pre-roll dan banner' },
    'stats.channels': { t: 'Channel Populer', s: 'Channel paling sering dibuka penonton' }
  };

  const mobileNav = [
    { id: 'beranda', label: 'Beranda', icon: 'M3 10.5 12 3l9 7.5M5 9v11h14V9' },
    { id: 'channel.otomatis', label: 'Channel', icon: 'M13 2 3 14h7l-1 8 10-12h-7l1-8z', group: 'channel' },
    { id: 'settings.source', label: 'Atur', icon: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6', group: 'settings' },
    { id: 'ads.preroll', label: 'Iklan', icon: 'm3 11 18-5v12L3 14v-3z M11.6 16.8a3 3 0 1 1-5.8-1.6', group: 'ads' },
    { id: 'stats.ads', label: 'Stat', icon: 'M3 3v18h18 M8 16V10 M13 16V6 M18 16v-3', group: 'stats' }
  ];

  const subnav = $derived.by(() => {
    const g = nav.find((n) => n.children?.some((c) => c.id === page));
    return g?.children ?? null;
  });

  function parentGroup(id) {
    const g = nav.find((n) => n.children?.some((c) => c.id === id));
    return g?.id ?? null;
  }

  function isGroupOpen(id) {
    return openGroups.has(id);
  }

  function toggleGroup(id) {
    const next = new Set(openGroups);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    openGroups = next;
  }

  function isPageActive(id) {
    return page === id;
  }

  function isGroupActive(id) {
    const g = nav.find((n) => n.id === id);
    return g?.children?.some((c) => c.id === page) ?? false;
  }

  function navBadge(id) {
    if (id === 'channel.manual') return data.config.channels.length;
    if (id === 'channel.otomatis' && autoList) return autoActive;
    return null;
  }

  function showPage(id) {
    page = id;
    const g = parentGroup(id);
    if (g) openGroups = new Set([...openGroups, g]);
    if ((id === 'beranda' || id === 'channel.otomatis') && autoList === null && !autoLoading) loadAuto();
    if ((id === 'beranda' || id.startsWith('stats.')) && statsData === null && !statsLoading) loadStats();
    if (id === 'beranda') loadViewers();
    if (typeof window !== 'undefined') window.scrollTo({ top: 0 });
  }

  async function loadAuto() {
    autoLoading = true;
    autoError = '';
    try {
      const r = await fetch('/api/admin/auto', { cache: 'no-store' });
      if (!r.ok) throw new Error();
      const d = await r.json();
      autoList = d.channels || [];
    } catch {
      autoError = 'Gagal memuat daftar otomatis. Coba muat ulang.';
      // Keep null so navigation / retry can call loadAuto() again.
    } finally {
      autoLoading = false;
    }
  }

  async function loadStats() {
    statsLoading = true;
    statsError = '';
    try {
      const r = await fetch('/api/admin/stats', { cache: 'no-store' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      statsData = await r.json();
    } catch {
      statsData = null;
      statsError = 'Gagal memuat statistik. Coba muat ulang.';
    } finally {
      statsLoading = false;
    }
  }

  async function loadViewers() {
    try {
      const r = await fetch('/api/presence', { cache: 'no-store' });
      viewers = r.ok ? (await r.json()).count || 0 : 0;
    } catch {
      viewers = 0;
    }
  }

  // Floating, auto-dismissing toast mirrored from the latest form result.
  /** @type {{ type: string; msg: string } | null} */ let toast = $state(null);
  /** @type {any} */ let toastTimer = null;
  $effect(() => {
    if (form?.ok || form?.error) {
      toast = form.ok ? { type: 'ok', msg: form.ok } : { type: 'err', msg: form.error };
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => (toast = null), 3500);
    }
  });

  /** @type {any} */ let viewersTimer = null;
  onMount(() => {
    loadStats();
    loadViewers();
    loadAuto();
    viewersTimer = setInterval(() => {
      if (!document.hidden) loadViewers();
    }, 15000);
  });
  onDestroy(() => {
    clearInterval(viewersTimer);
    clearTimeout(toastTimer);
  });
</script>

<svelte:head>
  <title>Admin · SectorTV</title>
</svelte:head>

<div class="admin">
  <!-- ===== Desktop sidebar ===== -->
  <aside class="sidebar">
    <div class="brand">
      <span class="logo" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="16" height="16"><path d="M8 5v14l11-7z" fill="currentColor" /></svg>
      </span>
      <div class="brand-tx">
        <h1>Admin Panel</h1>
        <p>SectorTV</p>
      </div>
    </div>

    <span class="nav-cap">Menu</span>
    <nav class="nav">
      {#each nav as item (item.id)}
        {#if item.children}
          <div class="nav-group" class:open={isGroupOpen(item.id)} class:active={isGroupActive(item.id)}>
            <button
              type="button"
              class="nav-item group-head"
              class:active={isGroupActive(item.id)}
              aria-expanded={isGroupOpen(item.id)}
              onclick={() => toggleGroup(item.id)}
            >
              <span class="ni-ic-wrap">
                <svg class="ni-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d={item.icon} />
                </svg>
              </span>
              <span class="ni-label">{item.label}</span>
              <svg class="ni-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="m6 9 6 6 6-6" />
              </svg>
            </button>
            <div class="nav-sub">
              {#each item.children as child (child.id)}
                <button
                  type="button"
                  class="nav-sub-item"
                  class:active={isPageActive(child.id)}
                  aria-current={isPageActive(child.id) ? 'page' : undefined}
                  onclick={() => showPage(child.id)}
                >
                  <span>{child.label}</span>
                  {#if navBadge(child.id) != null}<span class="tcount">{navBadge(child.id)}</span>{/if}
                </button>
              {/each}
            </div>
          </div>
        {:else}
          <button
            type="button"
            class="nav-item"
            class:active={isPageActive(item.id)}
            aria-current={isPageActive(item.id) ? 'page' : undefined}
            onclick={() => showPage(item.id)}
          >
            <span class="ni-ic-wrap">
              <svg class="ni-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d={item.icon} />
              </svg>
            </span>
            <span class="ni-label">{item.label}</span>
          </button>
        {/if}
      {/each}
    </nav>

    <div class="side-foot">
      <a class="ghost" href="/" target="_blank" rel="noreferrer">Lihat situs ↗</a>
      <form method="POST" action="?/logout" use:enhance>
        <button class="ghost wide">Keluar</button>
      </form>
    </div>
  </aside>

  <!-- ===== Mobile top bar ===== -->
  <header class="topbar">
    <div class="tb-brand">
      <span class="logo sm" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="14" height="14"><path d="M8 5v14l11-7z" fill="currentColor" /></svg>
      </span>
      <b>SectorTV</b>
      <span class="tb-tag">Admin</span>
    </div>
    <div class="tb-actions">
      <a class="iconbtn" href="/" target="_blank" rel="noreferrer" aria-label="Lihat situs">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6"/><path d="M10 14 21 3"/></svg>
      </a>
      <form method="POST" action="?/logout" use:enhance>
        <button class="iconbtn" aria-label="Keluar">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/></svg>
        </button>
      </form>
    </div>
  </header>

  <!-- ===== Content ===== -->
  <main class="content">
    <div class="chead">
      <h2>{meta[page].t}</h2>
      <p>{meta[page].s}</p>
    </div>

    {#if subnav}
      <nav class="subnav" aria-label="Sub menu">
        {#each subnav as sn (sn.id)}
          <button type="button" class="subnav-item" class:active={page === sn.id} onclick={() => showPage(sn.id)}>
            {sn.label}
          </button>
        {/each}
      </nav>
    {/if}

    <!-- ===================== BERANDA ===================== -->
    {#if page === 'beranda'}
      <section class="dash-grid">
        <div class="dcard live">
          <div class="dc-top">
            <span class="dc-ic">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg>
            </span>
            <span class="dc-dot"></span>
          </div>
          <span class="dc-num">{viewers ?? '—'}</span>
          <span class="dc-lbl">Penonton sekarang</span>
        </div>

        <div class="dcard">
          <div class="dc-top">
            <span class="dc-ic amber">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 3 14h7l-1 8 10-12h-7l1-8z"/></svg>
            </span>
          </div>
          <span class="dc-num">{autoList ? autoActive : '…'}<span class="dc-sub">{autoList ? `/${autoList.length}` : ''}</span></span>
          <span class="dc-lbl">Channel otomatis aktif</span>
        </div>

        <div class="dcard">
          <div class="dc-top">
            <span class="dc-ic blue">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>
            </span>
          </div>
          <span class="dc-num">{data.config.channels.length}</span>
          <span class="dc-lbl">Channel manual</span>
        </div>

        <div class="dcard">
          <div class="dc-top">
            <span class="dc-ic violet">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 11 18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/></svg>
            </span>
          </div>
          <span class="dc-num">{totalAdClicks}</span>
          <span class="dc-lbl">Total klik iklan</span>
        </div>
      </section>

      <section class="panel">
        <div class="phead">
          <h3>Performa Iklan</h3>
          <button class="ghost sm" type="button" onclick={loadStats} disabled={statsLoading}>
            {statsLoading ? 'Memuat…' : '↻ Muat ulang'}
          </button>
        </div>
        {#if statsError}
          <div class="note warn">{statsError}</div>
        {:else if statsData && !statsData.persistent}
          <div class="note warn">Statistik butuh penyimpanan KV/Redis agar terekam.</div>
        {/if}
        <div class="stat-cards three">
          <div class="stat-card">
            <span class="sc-num">{statsData?.adclicks.preroll ?? 0}</span>
            <span class="sc-lbl">Klik Pre-roll</span>
          </div>
          <div class="stat-card">
            <span class="sc-num">{statsData?.adclicks.top ?? 0}</span>
            <span class="sc-lbl">Klik Banner Atas</span>
          </div>
          <div class="stat-card">
            <span class="sc-num">{statsData?.adclicks.bottom ?? 0}</span>
            <span class="sc-lbl">Klik Banner Bawah</span>
          </div>
        </div>
      </section>

      <section class="panel">
        <div class="phead">
          <h3>Channel Terpopuler <span class="sub-note">(top 5)</span></h3>
          <button class="ghost sm" type="button" onclick={() => showPage('stats.channels')}>Lihat semua ›</button>
        </div>
        {#if statsLoading}
          <p class="empty"><span class="spin"></span> Memuat…</p>
        {:else if statsError}
          <p class="empty">{statsError}</p>
        {:else if !statsData || statsData.channels.length === 0}
          <p class="empty">Belum ada data tontonan.</p>
        {:else}
          <ul class="list">
            {#each statsData.channels.slice(0, 5) as c, i (c.name)}
              <li class="item">
                <div class="info">
                  <div class="line1"><span class="rank">#{i + 1}</span> <span class="cname">{c.name}</span></div>
                </div>
                <span class="count">{c.count}</span>
              </li>
            {/each}
          </ul>
        {/if}
      </section>

      <section class="panel">
        <h3>Status Sistem</h3>
        <ul class="status-list">
          <li><span class="st-k">Mode sumber</span><span class="st-v">{modeLabel}</span></li>
          <li>
            <span class="st-k">Watermark</span>
            <span class="st-v" class:good={data.config.watermark}>{data.config.watermark ? 'Aktif' : 'Nonaktif'}</span>
          </li>
          <li>
            <span class="st-k">Penyimpanan</span>
            <span class="st-v" class:good={data.persistent} class:bad={!data.persistent}>
              {data.persistent ? 'KV / permanen' : 'Lokal (sementara)'}
            </span>
          </li>
          <li>
            <span class="st-k">Password admin</span>
            <span class="st-v" class:good={!data.defaultPassword} class:bad={data.defaultPassword}>
              {data.defaultPassword ? 'Masih default' : 'Sudah diubah'}
            </span>
          </li>
        </ul>
      </section>
    {/if}

    <!-- ===================== OTOMATIS ===================== -->
    {#if page === 'channel.otomatis'}
      <section class="panel">
        <div class="phead">
          <h3>Daftar Channel {#if autoList}<span class="count">{autoActive}/{autoList.length} aktif</span>{/if}</h3>
          <button class="ghost sm" type="button" onclick={loadAuto} disabled={autoLoading}>
            {autoLoading ? 'Memuat…' : '↻ Muat ulang'}
          </button>
        </div>

        {#if data.config.mode === 'manual'}
          <div class="note warn">
            Mode saat ini <b>Manual</b> — channel otomatis tidak ditayangkan. Ubah ke
            <b>Otomatis</b> atau <b>Keduanya</b> di Pengaturan → Mode agar tampil.
          </div>
        {/if}

        {#if autoLoading}
          <p class="empty"><span class="spin"></span> Memindai sumber… ini bisa memakan waktu.</p>
        {:else if autoError}
          <p class="empty err-t">{autoError}</p>
        {:else if autoList && autoList.length === 0}
          <p class="empty">Tidak ada channel otomatis terdeteksi saat ini.</p>
        {:else if autoList}
          {#each autoGroups as g (g.server)}
            <div class="subgroup">
              <div class="subhead">{g.server}</div>
              <ul class="list">
                {#each g.items as c (c.id)}
                  <li class="item" class:off={!c.enabled}>
                    <div class="info">
                      <div class="line1">
                        <span class="cname">{c.name}</span>
                        <span class="tag {c.type}">{c.type === 'embed' ? 'EMBED' : 'DIRECT'}</span>
                        {#if !c.enabled}<span class="tag off">NONAKTIF</span>{/if}
                      </div>
                    </div>
                    <div class="acts">
                      <form
                        method="POST"
                        action="?/toggleAuto"
                        use:enhance={() => {
                          const prev = c.enabled;
                          c.enabled = !c.enabled;
                          return async ({ result, update }) => {
                            if (result.type === 'failure' || result.type === 'error') {
                              c.enabled = prev;
                            }
                            await update({ reset: false });
                          };
                        }}
                      >
                        <input type="hidden" name="id" value={c.disableId} />
                        <button class="tgl" class:on={c.enabled} type="submit">
                          {c.enabled ? 'Tayang' : 'Off'}
                        </button>
                      </form>
                    </div>
                  </li>
                {/each}
              </ul>
            </div>
          {/each}
        {/if}
      </section>
    {/if}

    <!-- ===================== MANUAL ===================== -->
    {#if page === 'channel.manual'}
      <section class="panel">
        <h3>Tambah Channel</h3>
        <form
          method="POST"
          action="?/addChannel"
          use:enhance={() => {
            return async ({ update }) => {
              await update();
              addType = 'direct';
            };
          }}
          class="addform"
        >
          <div class="row2">
            <label class="fld">
              <span>Nama channel</span>
              <input name="name" placeholder="mis. Fox Sports 1" required />
            </label>
            <label class="fld type">
              <span>Tipe</span>
              <select name="type" bind:value={addType}>
                <option value="direct">Direct (.m3u8 → player)</option>
                <option value="embed">Embed (iframe)</option>
              </select>
            </label>
          </div>
          <label class="fld">
            <span>{addType === 'embed' ? 'URL halaman embed' : 'URL stream (.m3u8)'}</span>
            <input
              name="url"
              type="url"
              placeholder={addType === 'embed' ? 'https://contoh.com/embed.html' : 'https://cdn.contoh.com/stream.m3u8'}
              required
            />
          </label>
          <button class="primary" type="submit">+ Tambah Channel</button>
        </form>
      </section>

      <section class="panel">
        <h3>Direct — Player <span class="count">{manualDirect.length}</span></h3>
        {#if manualDirect.length === 0}
          <p class="empty">Belum ada channel direct.</p>
        {:else}
          <ul class="list">
            {#each manualDirect as c (c.id)}
              {@render manualItem(c)}
            {/each}
          </ul>
        {/if}
      </section>

      <section class="panel">
        <h3>Embed — Iframe <span class="count">{manualEmbed.length}</span></h3>
        {#if manualEmbed.length === 0}
          <p class="empty">Belum ada channel embed.</p>
        {:else}
          <ul class="list">
            {#each manualEmbed as c (c.id)}
              {@render manualItem(c)}
            {/each}
          </ul>
        {/if}
      </section>
    {/if}

    <!-- ===================== IKLAN ===================== -->
    {#if page === 'ads.preroll'}
      <section class="panel">
        <div class="phead">
          <h3>Iklan Pre-roll</h3>
          <span class="count" class:on={prEnabled}>{prEnabled ? 'Aktif' : 'Off'}</span>
        </div>
        <p class="sub">Tampil sekali sebelum stream diputar (gambar atau video), penonton bisa melewati setelah beberapa detik.</p>
        <form method="POST" action="?/savePreroll" use:enhance class="addform">
          <label class="chk">
            <input type="checkbox" name="enabled" bind:checked={prEnabled} />
            <span>Aktifkan pre-roll</span>
          </label>
          <div class="row2">
            <label class="fld">
              <span>Tipe media</span>
              <select name="type" bind:value={prType}>
                <option value="image">Gambar</option>
                <option value="video">Video (mp4)</option>
              </select>
            </label>
            <label class="fld">
              <span>URL tujuan klik (opsional)</span>
              <input name="url" type="url" value={data.config.ads.preroll.url} placeholder="https://sponsor.com" />
            </label>
          </div>
          <label class="fld">
            <span>URL media ({prType === 'video' ? 'mp4' : 'gambar'})</span>
            <input name="src" type="url" value={data.config.ads.preroll.src} placeholder="https://cdn.contoh.com/iklan.{prType === 'video' ? 'mp4' : 'jpg'}" />
          </label>
          <div class="row2">
            <label class="fld">
              <span>Bisa dilewati setelah (detik)</span>
              <input name="playDuration" type="number" min="0" max="120" value={data.config.ads.preroll.playDuration} />
            </label>
            <label class="fld">
              <span>Durasi total maks (detik)</span>
              <input name="totalDuration" type="number" min="1" max="300" value={data.config.ads.preroll.totalDuration} />
            </label>
          </div>
          {#if prType === 'video'}
            <label class="chk">
              <input type="checkbox" name="muted" bind:checked={prMuted} />
              <span>Bisukan video iklan</span>
            </label>
          {/if}
          <button class="primary" type="submit">Simpan Pre-roll</button>
        </form>
      </section>
    {/if}

    {#if page === 'ads.banner-top'}
      <section class="panel">
        <div class="phead">
          <h3>Banner Atas</h3>
          <span class="count" class:on={bEnabled}>{bEnabled ? 'Aktif' : 'Off'}</span>
        </div>
        <p class="sub">Slot banner di atas player. Pakai gambar+link, atau tempel kode/script dari jaringan iklan.</p>
        <form method="POST" action="?/saveBanner" use:enhance class="addform">
          <input type="hidden" name="slot" value="top" />
          <label class="chk">
            <input type="checkbox" name="enabled" bind:checked={bEnabled} />
            <span>Aktifkan banner atas</span>
          </label>
          <label class="fld">
            <span>Mode</span>
            <select name="mode" bind:value={bMode}>
              <option value="image">Gambar + Link</option>
              <option value="code">Kode / Script</option>
            </select>
          </label>
          {#if bMode === 'code'}
            <label class="fld">
              <span>Kode banner (HTML/JS)</span>
              <textarea name="code" rows="5" placeholder="&lt;script&gt;…&lt;/script&gt; atau &lt;ins class='adsbygoogle'…&gt;">{data.config.ads.banner.code}</textarea>
            </label>
            <div class="note warn">Kode dijalankan apa adanya di halaman. Hanya tempel dari sumber tepercaya.</div>
          {:else}
            <label class="fld">
              <span>URL gambar</span>
              <input name="src" type="url" value={data.config.ads.banner.src} placeholder="https://cdn.contoh.com/banner.jpg" />
            </label>
            <label class="fld">
              <span>URL tujuan klik (opsional)</span>
              <input name="url" type="url" value={data.config.ads.banner.url} placeholder="https://sponsor.com" />
            </label>
          {/if}
          <button class="primary" type="submit">Simpan Banner Atas</button>
        </form>
      </section>
    {/if}

    {#if page === 'ads.banner-bottom'}
      <section class="panel">
        <div class="phead">
          <h3>Banner Bawah</h3>
          <span class="count" class:on={bBottomEnabled}>{bBottomEnabled ? 'Aktif' : 'Off'}</span>
        </div>
        <p class="sub">Slot banner di bawah player (di atas jadwal).</p>
        <form method="POST" action="?/saveBanner" use:enhance class="addform">
          <input type="hidden" name="slot" value="bottom" />
          <label class="chk">
            <input type="checkbox" name="enabled" bind:checked={bBottomEnabled} />
            <span>Aktifkan banner bawah</span>
          </label>
          <label class="fld">
            <span>Mode</span>
            <select name="mode" bind:value={bModeBottom}>
              <option value="image">Gambar + Link</option>
              <option value="code">Kode / Script</option>
            </select>
          </label>
          {#if bModeBottom === 'code'}
            <label class="fld">
              <span>Kode banner (HTML/JS)</span>
              <textarea name="code" rows="5" placeholder="&lt;script&gt;…&lt;/script&gt;">{data.config.ads.bannerBottom.code}</textarea>
            </label>
            <div class="note warn">Kode dijalankan apa adanya di halaman. Hanya tempel dari sumber tepercaya.</div>
          {:else}
            <label class="fld">
              <span>URL gambar</span>
              <input name="src" type="url" value={data.config.ads.bannerBottom.src} placeholder="https://cdn.contoh.com/banner.jpg" />
            </label>
            <label class="fld">
              <span>URL tujuan klik (opsional)</span>
              <input name="url" type="url" value={data.config.ads.bannerBottom.url} placeholder="https://sponsor.com" />
            </label>
          {/if}
          <button class="primary" type="submit">Simpan Banner Bawah</button>
        </form>
      </section>
    {/if}

    {#if page === 'stats.ads'}
      <section class="panel">
        <div class="phead">
          <h3>Klik Iklan</h3>
          <button class="ghost sm" type="button" onclick={loadStats} disabled={statsLoading}>
            {statsLoading ? 'Memuat…' : '↻ Muat ulang'}
          </button>
        </div>
        {#if statsError}
          <div class="note warn">{statsError}</div>
        {:else if statsData && !statsData.persistent}
          <div class="note warn">
            Statistik butuh penyimpanan KV/Redis. Tambahkan env <code>KV_REST_API_URL</code> &amp;
            <code>KV_REST_API_TOKEN</code> agar terekam.
          </div>
        {/if}
        <div class="stat-cards three">
          <div class="stat-card">
            <span class="sc-num">{statsData?.adclicks.preroll ?? 0}</span>
            <span class="sc-lbl">Pre-roll</span>
          </div>
          <div class="stat-card">
            <span class="sc-num">{statsData?.adclicks.top ?? 0}</span>
            <span class="sc-lbl">Banner Atas</span>
          </div>
          <div class="stat-card">
            <span class="sc-num">{statsData?.adclicks.bottom ?? 0}</span>
            <span class="sc-lbl">Banner Bawah</span>
          </div>
        </div>
      </section>
    {/if}

    {#if page === 'stats.channels'}
      <section class="panel">
        <div class="phead">
          <h3>Channel Terpopuler <span class="sub-note">(jumlah dibuka)</span></h3>
          <button class="ghost sm" type="button" onclick={loadStats} disabled={statsLoading}>
            {statsLoading ? 'Memuat…' : '↻ Muat ulang'}
          </button>
        </div>
        {#if statsLoading}
          <p class="empty"><span class="spin"></span> Memuat…</p>
        {:else if statsError}
          <p class="empty">{statsError}</p>
        {:else if !statsData || statsData.channels.length === 0}
          <p class="empty">Belum ada data.</p>
        {:else}
          <ul class="list">
            {#each statsData.channels as c, i (c.name)}
              <li class="item">
                <div class="info">
                  <div class="line1"><span class="rank">#{i + 1}</span> <span class="cname">{c.name}</span></div>
                </div>
                <span class="count">{c.count}</span>
              </li>
            {/each}
          </ul>
        {/if}
      </section>
    {/if}

    {#if page === 'settings.announcement'}
      <section class="panel">
        <div class="phead">
          <h3>Pengumuman</h3>
          <span class="count" class:on={annOn}>{annOn ? 'Aktif' : 'Off'}</span>
        </div>
        <p class="sub">Tampilkan popup pengumuman ke pengunjung homepage (mis. info jadwal, channel baru, atau grup Telegram).</p>
        <form
          method="POST"
          action="?/saveAnnouncement"
          use:enhance={() => async ({ update }) => update({ reset: false })}
          class="addform"
        >
          <label class="switch">
            <input
              type="checkbox"
              name="enabled"
              bind:checked={annOn}
              onchange={(e) => e.currentTarget.form.requestSubmit()}
            />
            <span class="track"><span class="knob"></span></span>
            <span class="switch-lbl">Aktifkan pengumuman</span>
          </label>
          <p class="hint">Toggle langsung tersimpan. Untuk teks/gambar, klik <b>Simpan Pengumuman</b>.</p>
          <label class="fld">
            <span>Judul</span>
            <input name="title" value={data.config.announcement.title} placeholder="mis. Selamat datang di SectorTV!" maxlength="120" />
          </label>
          <label class="fld">
            <span>Isi pesan</span>
            <textarea name="body" rows="4" placeholder="Tulis pengumuman di sini…" maxlength="2000">{data.config.announcement.body}</textarea>
          </label>
          <label class="fld">
            <span>URL gambar (opsional)</span>
            <input name="image" type="url" value={data.config.announcement.image} placeholder="https://cdn.contoh.com/banner.jpg" />
          </label>
          <div class="row2">
            <label class="fld">
              <span>Teks tombol (opsional)</span>
              <input name="buttonText" value={data.config.announcement.buttonText} placeholder="mis. Gabung Telegram" maxlength="40" />
            </label>
            <label class="fld">
              <span>URL tombol (opsional)</span>
              <input name="buttonUrl" type="url" value={data.config.announcement.buttonUrl} placeholder="https://t.me/..." />
            </label>
          </div>
          <label class="fld" style="max-width:280px">
            <span>Frekuensi tampil</span>
            <select name="frequency" bind:value={annFreq}>
              <option value="once">Sekali per pengunjung</option>
              <option value="daily">Sekali per hari</option>
              <option value="always">Setiap kali buka</option>
            </select>
          </label>
          <button class="primary" type="submit">Simpan Pengumuman</button>
        </form>
      </section>
    {/if}

    {#if page === 'settings.source'}
      <section class="panel">
        <h3>Sumber Otomatis</h3>
        <p class="sub">
          Slug halaman atau URL lengkap yang di-scrape untuk channel otomatis. Ganti saat sumber
          berpindah (mis. <code>worldcup26-2-0703</code>). Kosongkan untuk memakai default bawaan.
        </p>
        <form method="POST" action="?/saveSource" use:enhance class="addform">
          <label class="fld">
            <span>Slug / URL sumber</span>
            <input
              name="sourceSlug"
              value={data.config.sourceSlug}
              placeholder="worldcup26-2-0714  atau  https://xyzstreams.st/worldcup26-2-0714"
              autocomplete="off"
              spellcheck="false"
            />
          </label>
          <p class="hint">
            Aktif sekarang:
            <b>{data.config.sourceSlug || 'worldcup26-2-0714 (default)'}</b>
          </p>
          <button class="primary" type="submit">Simpan Sumber</button>
        </form>
      </section>
    {/if}

    {#if page === 'settings.mode'}
      <section class="panel">
        <h3>Mode Sumber</h3>
        <p class="sub">Tentukan channel mana yang ditayangkan di homepage.</p>
        <form method="POST" action="?/setMode" use:enhance class="modes">
          {#each modes as m (m.id)}
            <button class="mode" class:active={data.config.mode === m.id} name="mode" value={m.id}>
              <b>{m.label}</b>
              <small>{m.desc}</small>
            </button>
          {/each}
        </form>
      </section>
    {/if}

    {#if page === 'settings.watermark'}
      <section class="panel">
        <div class="phead">
          <h3>Watermark</h3>
          <span class="count" class:on={wmOn}>{wmOn ? 'Aktif' : 'Off'}</span>
        </div>
        <p class="sub">Logo watermark di atas player. Matikan untuk menyembunyikannya bagi penonton.</p>
        <form
          method="POST"
          action="?/saveWatermark"
          use:enhance={() => async ({ update }) => update({ reset: false })}
          class="addform"
        >
          <label class="switch">
            <input
              type="checkbox"
              name="watermark"
              bind:checked={wmOn}
              onchange={(e) => e.currentTarget.form.requestSubmit()}
            />
            <span class="track"><span class="knob"></span></span>
            <span class="switch-lbl">Tampilkan watermark di player</span>
          </label>
          <label class="fld" style="max-width:280px">
            <span>Posisi watermark</span>
            <select
              name="position"
              bind:value={wmPos}
              disabled={!wmOn}
              onchange={(e) => e.currentTarget.form.requestSubmit()}
            >
              <option value="center">Tengah</option>
              <option value="top-left">Kiri atas</option>
              <option value="top-center">Tengah atas</option>
              <option value="top-right">Kanan atas</option>
              <option value="bottom-left">Kiri bawah</option>
              <option value="bottom-center">Tengah bawah</option>
              <option value="bottom-right">Kanan bawah</option>
            </select>
          </label>
        </form>
      </section>
    {/if}

    {#if page === 'settings.security'}
      <section class="panel">
        <h3>Status &amp; Keamanan</h3>
        {#if data.defaultPassword}
          <div class="note warn">
            Password admin masih default. Set <code>ADMIN_PASSWORD</code> di environment untuk keamanan.
          </div>
        {/if}
        {#if !data.persistent}
          <div class="note">
            Penyimpanan lokal (file) sedang dipakai. Untuk produksi di Vercel, tambahkan Redis/KV
            (env <code>KV_REST_API_URL</code> &amp; <code>KV_REST_API_TOKEN</code>) agar tersimpan permanen.
          </div>
        {/if}
        {#if !data.defaultPassword && data.persistent}
          <p class="empty">Semua aman: password khusus aktif &amp; penyimpanan permanen (KV) terpasang.</p>
        {/if}
      </section>
    {/if}
  </main>

  <!-- ===== Mobile bottom nav ===== -->
  <nav class="botnav" aria-label="Navigasi admin">
    {#each mobileNav as t (t.id)}
      <button
        type="button"
        class="bn-item"
        class:active={page === t.id || (t.group && parentGroup(page) === t.group)}
        aria-current={page === t.id || (t.group && parentGroup(page) === t.group) ? 'page' : undefined}
        onclick={() => showPage(t.id)}
      >
        <svg class="bn-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d={t.icon} />
        </svg>
        <span>{t.label}</span>
      </button>
    {/each}
  </nav>
</div>

{#if toast}
  <div class="toast {toast.type}" role="status">{toast.msg}</div>
{/if}

{#snippet manualItem(c)}
  <li class="item" class:off={!c.enabled}>
    {#if editingId === c.id}
      <form
        method="POST"
        action="?/editChannel"
        use:enhance={() => async ({ update }) => {
          await update();
          editingId = '';
        }}
        class="editform"
      >
        <input type="hidden" name="id" value={c.id} />
        <div class="row2">
          <input name="name" value={c.name} placeholder="Nama" required />
          <select name="type" value={c.type}>
            <option value="direct">Direct</option>
            <option value="embed">Embed</option>
          </select>
        </div>
        <input name="url" type="url" value={c.url} placeholder="URL" required />
        <div class="editbtns">
          <button class="primary sm" type="submit">Simpan</button>
          <button class="ghost sm" type="button" onclick={() => (editingId = '')}>Batal</button>
        </div>
      </form>
    {:else}
      <div class="info">
        <div class="line1">
          <span class="cname">{c.name}</span>
          <span class="tag {c.type}">{c.type === 'embed' ? 'EMBED' : 'DIRECT'}</span>
          {#if !c.enabled}<span class="tag off">NONAKTIF</span>{/if}
        </div>
        <span class="curl">{c.url}</span>
      </div>
      <div class="acts">
        <form method="POST" action="?/toggleChannel" use:enhance>
          <input type="hidden" name="id" value={c.id} />
          <button class="tgl" class:on={c.enabled} title={c.enabled ? 'Nonaktifkan' : 'Aktifkan'}>
            {c.enabled ? 'Tayang' : 'Off'}
          </button>
        </form>
        <button class="ghost sm" type="button" onclick={() => (editingId = c.id)}>Edit</button>
        <form method="POST" action="?/deleteChannel" use:enhance>
          <input type="hidden" name="id" value={c.id} />
          <button class="danger sm">Hapus</button>
        </form>
      </div>
    {/if}
  </li>
{/snippet}

<style>
  .admin {
    min-height: 100dvh;
    max-width: 1180px;
    margin: 0 auto;
    display: grid;
    grid-template-columns: 252px 1fr;
    gap: 24px;
    align-items: start;
    padding: 20px 18px 40px;
  }

  /* ---------- Desktop sidebar ---------- */
  .sidebar {
    position: sticky;
    top: 20px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 16px 14px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background:
      radial-gradient(130% 60% at 0% 0%, color-mix(in srgb, var(--brand) 9%, transparent), transparent 60%),
      var(--bg-elev);
    box-shadow: var(--shadow, 0 1px 2px rgba(0, 0, 0, 0.05));
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 11px;
    padding: 2px 4px 14px;
    margin-bottom: 8px;
    border-bottom: 1px solid var(--line);
  }
  .logo {
    width: 38px;
    height: 38px;
    display: grid;
    place-items: center;
    border-radius: 11px;
    background: linear-gradient(150deg, var(--brand-2), var(--brand-dim));
    color: #04130a;
    flex: none;
    box-shadow: 0 4px 12px color-mix(in srgb, var(--brand) 30%, transparent);
  }
  .logo.sm {
    width: 30px;
    height: 30px;
    border-radius: 9px;
  }
  .brand-tx h1 {
    margin: 0;
    font-size: 15px;
    font-weight: 800;
    letter-spacing: -0.3px;
  }
  .brand-tx p {
    margin: 1px 0 0;
    font-size: 11px;
    color: var(--text-dim);
    letter-spacing: 0.3px;
  }

  .nav-cap {
    font-size: 10px;
    font-weight: 800;
    letter-spacing: 1px;
    text-transform: uppercase;
    color: var(--text-faint);
    padding: 0 6px 4px;
  }
  .nav {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .nav-group {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .nav-group .group-head {
    width: 100%;
  }
  .ni-chev {
    width: 14px;
    height: 14px;
    flex: none;
    opacity: 0.45;
    transition: transform 0.2s ease;
  }
  .nav-group.open .ni-chev {
    transform: rotate(180deg);
  }
  .nav-sub {
    display: none;
    flex-direction: column;
    gap: 1px;
    margin: 0 0 4px 12px;
    padding: 4px 0 4px 10px;
    border-left: 1px solid var(--line-soft, var(--line));
  }
  .nav-group.open .nav-sub,
  .nav-group.active .nav-sub {
    display: flex;
  }
  .nav-sub-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 7px 10px;
    border: none;
    border-radius: 9px;
    background: transparent;
    color: var(--text-dim);
    font-size: 12.5px;
    font-weight: 700;
    font-family: inherit;
    cursor: pointer;
    text-align: left;
    transition:
      background 0.15s ease,
      color 0.15s ease;
  }
  .nav-sub-item:hover {
    color: var(--text);
    background: var(--bg-hover);
  }
  .nav-sub-item.active {
    color: var(--brand-2);
    background: color-mix(in srgb, var(--brand) 12%, transparent);
  }
  .nav-sub-item .tcount {
    font-size: 10px;
    padding: 0 6px;
  }
  .nav-item {
    position: relative;
    display: flex;
    align-items: center;
    gap: 11px;
    padding: 8px 10px;
    border: none;
    border-radius: 11px;
    background: transparent;
    color: var(--text-dim);
    font-size: 13.5px;
    font-weight: 700;
    font-family: inherit;
    cursor: pointer;
    text-align: left;
    transition:
      background 0.15s ease,
      color 0.15s ease;
  }
  .nav-item:hover {
    color: var(--text);
    background: var(--bg-hover);
  }
  .nav-item.active {
    background: color-mix(in srgb, var(--brand) 13%, transparent);
    color: var(--brand-2);
  }
  .nav-item.active::before {
    content: '';
    position: absolute;
    left: -14px;
    top: 9px;
    bottom: 9px;
    width: 3px;
    border-radius: 0 3px 3px 0;
    background: var(--brand);
  }
  .ni-ic-wrap {
    width: 32px;
    height: 32px;
    flex: none;
    display: grid;
    place-items: center;
    border-radius: 9px;
    background: var(--bg);
    border: 1px solid var(--line);
    color: var(--text-dim);
    transition:
      background 0.15s ease,
      color 0.15s ease,
      border-color 0.15s ease;
  }
  .nav-item:hover .ni-ic-wrap {
    color: var(--text);
  }
  .nav-item.active .ni-ic-wrap {
    background: var(--brand);
    border-color: transparent;
    color: #04130a;
    box-shadow: 0 3px 10px color-mix(in srgb, var(--brand) 28%, transparent);
  }
  .ni-ic {
    width: 16px;
    height: 16px;
  }
  .ni-label {
    flex: 1;
  }
  .tcount {
    font-size: 11px;
    font-weight: 800;
    padding: 1px 8px;
    border-radius: 999px;
    background: color-mix(in srgb, currentColor 18%, transparent);
  }
  .side-foot {
    display: flex;
    flex-direction: column;
    gap: 7px;
    margin-top: 12px;
    padding-top: 12px;
    border-top: 1px solid var(--line);
  }
  .side-foot .ghost {
    text-align: center;
  }
  .wide {
    width: 100%;
  }

  /* ---------- Mobile top bar + bottom nav (hidden on desktop) ---------- */
  .topbar,
  .botnav {
    display: none;
  }

  /* ---------- Content ---------- */
  .content {
    display: flex;
    flex-direction: column;
    gap: 14px;
    min-width: 0;
  }
  .chead {
    padding: 2px 2px 2px;
  }
  .chead h2 {
    margin: 0;
    font-size: 22px;
    font-weight: 800;
    letter-spacing: -0.5px;
  }
  .chead p {
    margin: 3px 0 0;
    font-size: 13px;
    color: var(--text-dim);
  }

  .subnav {
    display: none;
    gap: 8px;
    overflow-x: auto;
    padding: 2px 0 4px;
    scrollbar-width: none;
  }
  .subnav::-webkit-scrollbar {
    display: none;
  }
  .subnav-item {
    flex: none;
    padding: 7px 14px;
    border: 1px solid var(--line);
    border-radius: 999px;
    background: var(--bg-elev);
    color: var(--text-dim);
    font-size: 12px;
    font-weight: 700;
    font-family: inherit;
    white-space: nowrap;
    cursor: pointer;
    transition:
      background 0.15s ease,
      color 0.15s ease,
      border-color 0.15s ease;
  }
  .subnav-item:hover {
    color: var(--text);
    background: var(--bg-hover);
  }
  .subnav-item.active {
    color: var(--brand-2);
    background: color-mix(in srgb, var(--brand) 14%, transparent);
    border-color: color-mix(in srgb, var(--brand) 35%, var(--line));
  }

  /* ---------- Toast ---------- */
  .toast {
    position: fixed;
    left: 50%;
    bottom: calc(20px + var(--safe-bottom));
    transform: translateX(-50%);
    z-index: 200;
    max-width: min(92vw, 460px);
    padding: 12px 18px;
    border-radius: 12px;
    font-size: 13.5px;
    font-weight: 700;
    box-shadow: var(--shadow, 0 10px 30px rgba(0, 0, 0, 0.4));
    animation: toastIn 0.25s ease;
  }
  .toast.ok {
    color: #04130a;
    background: var(--brand);
  }
  .toast.err {
    color: #fff;
    background: var(--live);
  }
  @keyframes toastIn {
    from {
      opacity: 0;
      transform: translate(-50%, 12px);
    }
    to {
      opacity: 1;
      transform: translate(-50%, 0);
    }
  }

  .note {
    padding: 11px 14px;
    border-radius: 12px;
    font-size: 12.5px;
    line-height: 1.5;
    color: var(--text-dim);
    background: var(--bg);
    border: 1px solid var(--line);
    margin-bottom: 14px;
  }
  .note.warn {
    color: #f59e0b;
    border-color: color-mix(in srgb, #f59e0b 35%, transparent);
    background: color-mix(in srgb, #f59e0b 10%, transparent);
  }
  code {
    font-family: ui-monospace, monospace;
    font-size: 12px;
    background: var(--bg);
    padding: 1px 5px;
    border-radius: 5px;
  }

  .panel {
    padding: 20px 22px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--bg-elev);
  }

  .sub {
    margin: -6px 0 16px;
    font-size: 13px;
    line-height: 1.55;
    color: var(--text-dim);
  }
  .panel h3 {
    margin: 0 0 14px;
    font-size: 15px;
    font-weight: 700;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .phead {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    margin-bottom: 14px;
  }
  .phead h3 {
    margin: 0;
  }
  .count {
    font-size: 12px;
    font-weight: 700;
    color: var(--text-faint);
    background: var(--bg);
    border: 1px solid var(--line);
    border-radius: 999px;
    padding: 1px 9px;
  }
  .count.on {
    color: var(--brand-2);
    background: color-mix(in srgb, var(--brand) 14%, transparent);
    border-color: transparent;
  }

  /* ---------- Dashboard cards ---------- */
  .dash-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 12px;
  }
  .dcard {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 16px;
    border: 1px solid var(--line);
    border-radius: 16px;
    background: var(--bg-elev);
    overflow: hidden;
  }
  .dcard.live {
    background:
      radial-gradient(120% 90% at 100% 0%, color-mix(in srgb, var(--brand) 16%, transparent), transparent 60%),
      var(--bg-elev);
    border-color: color-mix(in srgb, var(--brand) 30%, var(--line));
  }
  .dc-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 10px;
  }
  .dc-ic {
    width: 38px;
    height: 38px;
    display: grid;
    place-items: center;
    border-radius: 11px;
    background: color-mix(in srgb, var(--brand) 16%, transparent);
    color: var(--brand-2);
  }
  .dc-ic svg {
    width: 19px;
    height: 19px;
  }
  .dc-ic.amber {
    background: color-mix(in srgb, #f59e0b 16%, transparent);
    color: #f59e0b;
  }
  .dc-ic.blue {
    background: color-mix(in srgb, #60a5fa 16%, transparent);
    color: #60a5fa;
  }
  .dc-ic.violet {
    background: color-mix(in srgb, #a78bfa 16%, transparent);
    color: #a78bfa;
  }
  .dc-dot {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: var(--brand);
    animation: pulse-dot 1.8s ease-out infinite;
  }
  @keyframes pulse-dot {
    0% {
      box-shadow: 0 0 0 0 color-mix(in srgb, var(--brand) 55%, transparent);
    }
    70% {
      box-shadow: 0 0 0 8px transparent;
    }
    100% {
      box-shadow: 0 0 0 0 transparent;
    }
  }
  .dc-num {
    font-size: 30px;
    font-weight: 800;
    letter-spacing: -1px;
    line-height: 1.05;
    font-variant-numeric: tabular-nums;
  }
  .dc-sub {
    font-size: 15px;
    font-weight: 700;
    color: var(--text-faint);
    letter-spacing: 0;
  }
  .dc-lbl {
    font-size: 12px;
    color: var(--text-dim);
    margin-top: 3px;
  }

  .status-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
  }
  .status-list li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 11px 2px;
    border-bottom: 1px solid var(--line);
    font-size: 13.5px;
  }
  .status-list li:last-child {
    border-bottom: none;
  }
  .st-k {
    color: var(--text-dim);
  }
  .st-v {
    font-weight: 700;
    color: var(--text);
  }
  .st-v.good {
    color: var(--brand-2);
  }
  .st-v.bad {
    color: #f59e0b;
  }

  .stat-cards {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 10px;
  }
  .stat-cards.three {
    grid-template-columns: repeat(3, 1fr);
  }
  .stat-card {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 16px;
    border-radius: 13px;
    border: 1px solid var(--line);
    background: var(--bg);
  }
  .sc-num {
    font-size: 26px;
    font-weight: 800;
    letter-spacing: -0.5px;
    font-variant-numeric: tabular-nums;
  }
  .sc-lbl {
    font-size: 12px;
    color: var(--text-dim);
  }
  .sub-note {
    font-size: 11px;
    font-weight: 600;
    color: var(--text-faint);
  }
  .rank {
    font-size: 12px;
    font-weight: 800;
    color: var(--brand-2);
    font-variant-numeric: tabular-nums;
  }

  .subgroup {
    margin-top: 6px;
  }
  .subgroup + .subgroup {
    margin-top: 16px;
  }
  .subhead {
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.6px;
    text-transform: uppercase;
    color: var(--text-faint);
    margin: 0 0 8px;
  }

  .modes {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 10px;
  }
  .mode {
    display: flex;
    flex-direction: column;
    gap: 3px;
    text-align: left;
    padding: 13px 14px;
    border-radius: 13px;
    border: 1px solid var(--line);
    background: var(--bg);
    color: var(--text-dim);
    transition:
      border-color 0.14s ease,
      background 0.14s ease,
      color 0.14s ease;
  }
  .mode b {
    font-size: 14px;
    color: var(--text);
  }
  .mode small {
    font-size: 11.5px;
  }
  .mode.active {
    border-color: var(--brand);
    background: color-mix(in srgb, var(--brand) 12%, transparent);
  }
  .mode.active b {
    color: var(--brand-2);
  }

  .addform,
  .editform {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .row2 {
    display: grid;
    grid-template-columns: 1fr 220px;
    gap: 12px;
  }
  .fld {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .fld span {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-dim);
  }
  input,
  select,
  textarea {
    padding: 10px 12px;
    border-radius: 10px;
    border: 1px solid var(--line);
    background: var(--bg);
    color: var(--text);
    font-size: 14px;
    font-family: inherit;
    width: 100%;
  }
  textarea {
    resize: vertical;
    min-height: 90px;
    font-family: ui-monospace, monospace;
    font-size: 12.5px;
    line-height: 1.5;
  }
  input:focus,
  select:focus,
  textarea:focus {
    outline: none;
    border-color: var(--brand);
  }
  .sub {
    margin: -6px 0 14px;
    font-size: 12.5px;
    line-height: 1.5;
    color: var(--text-dim);
  }
  .hint {
    margin: -2px 0 0;
    font-size: 12.5px;
    color: var(--text-dim);
  }
  .hint b {
    color: var(--brand-2);
    font-weight: 700;
    word-break: break-all;
  }
  .chk {
    display: flex;
    align-items: center;
    gap: 9px;
    font-size: 13.5px;
    font-weight: 600;
    color: var(--text);
    cursor: pointer;
  }
  .chk input {
    width: 17px;
    height: 17px;
    flex: none;
    accent-color: var(--brand);
    cursor: pointer;
  }

  /* Toggle switch */
  .switch {
    display: flex;
    align-items: center;
    gap: 12px;
    cursor: pointer;
    user-select: none;
  }
  .switch input {
    position: absolute;
    opacity: 0;
    width: 0;
    height: 0;
  }
  .switch .track {
    position: relative;
    width: 46px;
    height: 26px;
    flex: none;
    border-radius: 999px;
    background: var(--bg-elev-2, var(--line));
    border: 1px solid var(--line);
    transition: background 0.18s ease;
  }
  .switch .knob {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: var(--text-faint);
    transition:
      transform 0.18s ease,
      background 0.18s ease;
  }
  .switch input:checked + .track {
    background: color-mix(in srgb, var(--brand) 55%, transparent);
    border-color: transparent;
  }
  .switch input:checked + .track .knob {
    transform: translateX(20px);
    background: #04130a;
  }
  .switch input:focus-visible + .track {
    outline: 2px solid var(--brand);
    outline-offset: 2px;
  }
  .switch-lbl {
    font-size: 13.5px;
    font-weight: 600;
    color: var(--text);
  }

  button {
    font-family: inherit;
    cursor: pointer;
  }
  .primary {
    padding: 11px 16px;
    border: none;
    border-radius: 11px;
    background: var(--brand);
    color: #04130a;
    font-size: 14px;
    font-weight: 800;
    align-self: flex-start;
  }
  .ghost {
    padding: 8px 13px;
    border-radius: 10px;
    border: 1px solid var(--line);
    background: var(--bg-elev);
    color: var(--text-dim);
    font-size: 13px;
    font-weight: 600;
  }
  .ghost:hover {
    color: var(--text);
    background: var(--bg-hover);
  }
  .ghost:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .danger {
    padding: 8px 13px;
    border-radius: 10px;
    border: 1px solid color-mix(in srgb, var(--live) 40%, transparent);
    background: color-mix(in srgb, var(--live) 12%, transparent);
    color: var(--live);
    font-size: 13px;
    font-weight: 700;
  }
  .tgl {
    padding: 7px 13px;
    border-radius: 10px;
    border: 1px solid var(--line);
    background: var(--bg-elev);
    color: var(--text-faint);
    font-size: 12.5px;
    font-weight: 700;
    min-width: 58px;
  }
  .tgl.on {
    border-color: color-mix(in srgb, var(--brand) 45%, transparent);
    background: color-mix(in srgb, var(--brand) 16%, transparent);
    color: var(--brand-2);
  }
  .sm {
    padding: 7px 11px;
    font-size: 12.5px;
  }

  .empty {
    margin: 0;
    color: var(--text-dim);
    font-size: 13px;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .empty.err-t {
    color: var(--live);
  }
  .spin {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    border: 2px solid var(--line);
    border-top-color: var(--brand);
    animation: aspin 0.7s linear infinite;
    flex: none;
  }
  @keyframes aspin {
    to {
      transform: rotate(360deg);
    }
  }

  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 11px 13px;
    border: 1px solid var(--line);
    border-radius: 13px;
    background: var(--bg);
  }
  .item.off {
    opacity: 0.6;
  }
  .info {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .line1 {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .cname {
    font-size: 14px;
    font-weight: 700;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .tag {
    font-size: 9.5px;
    font-weight: 800;
    letter-spacing: 0.4px;
    padding: 2px 6px;
    border-radius: 5px;
    flex: none;
  }
  .tag.direct {
    color: var(--brand-2);
    background: color-mix(in srgb, var(--brand) 16%, transparent);
  }
  .tag.embed {
    color: #60a5fa;
    background: color-mix(in srgb, #60a5fa 16%, transparent);
  }
  .tag.off {
    color: var(--text-faint);
    background: var(--bg-elev-2);
  }
  .curl {
    font-size: 12px;
    color: var(--text-faint);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .acts {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: none;
  }
  .editbtns {
    display: flex;
    gap: 8px;
  }

  /* ================= Mobile ================= */
  @media (max-width: 820px) {
    .admin {
      grid-template-columns: 1fr;
      gap: 0;
      padding: 0 0 calc(76px + var(--safe-bottom));
    }
    .sidebar {
      display: none;
    }

    .topbar {
      position: sticky;
      top: 0;
      z-index: 30;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 11px 14px calc(11px);
      background: color-mix(in srgb, var(--bg) 78%, transparent);
      -webkit-backdrop-filter: saturate(140%) blur(14px);
      backdrop-filter: saturate(140%) blur(14px);
      border-bottom: 1px solid var(--line-soft);
    }
    .tb-brand {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 15px;
      letter-spacing: -0.3px;
    }
    .tb-tag {
      font-size: 10px;
      font-weight: 800;
      letter-spacing: 0.5px;
      text-transform: uppercase;
      color: var(--brand-2);
      background: color-mix(in srgb, var(--brand) 14%, transparent);
      padding: 2px 7px;
      border-radius: 999px;
    }
    .tb-actions {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .iconbtn {
      width: 38px;
      height: 38px;
      display: grid;
      place-items: center;
      border-radius: 10px;
      border: 1px solid var(--line);
      background: var(--bg-elev);
      color: var(--text-dim);
    }
    .iconbtn svg {
      width: 18px;
      height: 18px;
    }

    .content {
      gap: 12px;
      padding: 14px 12px 4px;
    }
    .chead h2 {
      font-size: 19px;
    }
    .subnav {
      display: flex;
    }
    .panel {
      padding: 15px;
      border-radius: 14px;
    }
    .dash-grid {
      grid-template-columns: repeat(2, 1fr);
    }

    .botnav {
      position: fixed;
      left: 0;
      right: 0;
      bottom: 0;
      z-index: 40;
      display: flex;
      justify-content: space-around;
      gap: 2px;
      padding: 7px 4px calc(7px + var(--safe-bottom));
      background: color-mix(in srgb, var(--bg) 88%, transparent);
      -webkit-backdrop-filter: saturate(150%) blur(16px);
      backdrop-filter: saturate(150%) blur(16px);
      border-top: 1px solid var(--line);
    }
    .bn-item {
      flex: 1 1 0;
      min-width: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 3px;
      padding: 5px 2px;
      border: none;
      background: none;
      color: var(--text-faint);
      font-size: 9.5px;
      font-weight: 700;
      font-family: inherit;
      border-radius: 10px;
      transition: color 0.14s ease;
    }
    .bn-item span {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      max-width: 100%;
    }
    .bn-ic {
      width: 21px;
      height: 21px;
    }
    .bn-item.active {
      color: var(--brand-2);
    }
    .bn-item.active .bn-ic {
      filter: drop-shadow(0 2px 6px color-mix(in srgb, var(--brand) 45%, transparent));
    }
  }

  @media (max-width: 560px) {
    .modes {
      grid-template-columns: 1fr;
    }
    .row2 {
      grid-template-columns: 1fr;
    }
    .stat-cards,
    .stat-cards.three {
      grid-template-columns: 1fr;
    }
    .dc-num {
      font-size: 26px;
    }
    .item {
      flex-direction: column;
      align-items: stretch;
    }
    .acts {
      justify-content: flex-end;
      flex-wrap: wrap;
    }
    .acts form {
      flex: 1;
    }
    .acts .tgl,
    .acts .ghost,
    .acts .danger {
      width: 100%;
    }
    .primary {
      align-self: stretch;
      text-align: center;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .dc-dot,
    .toast,
    .spin {
      animation: none;
    }
  }
</style>

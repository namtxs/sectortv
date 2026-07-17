<script>
  import '../app.css';
  import { onMount } from 'svelte';
  import { page } from '$app/stores';

  let { children } = $props();
  const year = new Date().getFullYear();

  const isAdmin = $derived($page.url.pathname.startsWith('/admin'));

  let theme = $state('dark');

  onMount(() => {
    theme = document.documentElement.dataset.theme || 'dark';
  });

  function toggleTheme() {
    theme = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem('theme', theme);
    } catch (e) {
      /* ignore */
    }
  }
</script>

{#if isAdmin}
  {@render children()}
{:else}
  <div class="shell">
  <header class="bar">
    <a class="brand" href="/">
      <span class="logo" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="16" height="16"><path d="M8 5v14l11-7z" fill="currentColor" /></svg>
      </span>
      <span class="brand-text">
        <span class="name">Sector<b>TV</b></span>
        <span class="tag">Live Sports Streaming</span>
      </span>
    </a>

    <div class="hgroup">
      <button class="theme-btn" onclick={toggleTheme} aria-label="Ganti tema" title="Ganti tema">
        {#if theme === 'dark'}
          <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
        {:else}
          <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></svg>
        {/if}
      </button>

      <div class="season">
        <img class="wc" src="/world-cup-2026.png" alt="FIFA World Cup 2026" />
        <span class="season-cap">World Cup<br /><b>2026</b></span>
      </div>
    </div>
  </header>

  <main>{@render children()}</main>

  <footer class="foot">
    <div class="foot-inner">
      <div class="foot-main">
        <div class="foot-brand-row">
          <span class="logo sm" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="13" height="13"><path d="M8 5v14l11-7z" fill="currentColor" /></svg>
          </span>
          <span class="name">Sector<b>TV</b></span>
        </div>
        <p class="foot-desc">
          Siaran langsung, jadwal, dan hasil FIFA World Cup 2026™ dalam satu tempat.
        </p>
        <address class="foot-addr">
          <span class="foot-addr-ic" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z" /><circle cx="12" cy="10" r="3" /></svg>
          </span>
          <span class="foot-addr-tx">Ambarawa, Pringsewu, Lampung 35376, Indonesia</span>
        </address>
      </div>

      <nav class="foot-nav" aria-label="Tautan footer">
        <span class="foot-h">Jelajahi</span>
        <a href="/">Tonton Langsung</a>
        <a href="/#jadwal">Jadwal &amp; Hasil</a>
      </nav>
    </div>

    <div class="foot-bottom">
      <span>© {year} SectorTV</span>
      <span class="muted">Konten stream disediakan oleh pihak ketiga.</span>
    </div>
  </footer>
  </div>
{/if}

<style>
  .shell {
    min-height: 100dvh;
    display: flex;
    flex-direction: column;
  }

  /* ---------- Header ---------- */
  .bar {
    position: sticky;
    top: 0;
    z-index: 20;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 12px var(--gutter);
    background: color-mix(in srgb, var(--bg) 72%, transparent);
    backdrop-filter: saturate(140%) blur(14px);
    border-bottom: 1px solid var(--line-soft);
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 11px;
  }
  .logo {
    width: 34px;
    height: 34px;
    display: grid;
    place-items: center;
    border-radius: 10px;
    background: linear-gradient(150deg, var(--brand-2), var(--brand-dim));
    color: #04130a;
    flex: none;
    box-shadow:
      0 4px 14px -2px rgba(45, 211, 111, 0.5),
      inset 0 1px 0 rgba(255, 255, 255, 0.25);
  }
  .brand-text {
    display: flex;
    flex-direction: column;
    gap: 3px;
    line-height: 1.1;
  }
  .name {
    font-size: 19px;
    font-weight: 800;
    letter-spacing: -0.4px;
  }
  .name b {
    color: var(--brand-2);
    font-weight: 800;
  }
  .tag {
    font-size: 10.5px;
    font-weight: 600;
    letter-spacing: 0.3px;
    color: var(--text-faint);
    text-transform: uppercase;
  }

  .hgroup {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .theme-btn {
    display: grid;
    place-items: center;
    width: 38px;
    height: 38px;
    flex: none;
    border-radius: 11px;
    border: 1px solid var(--line);
    background: var(--bg-elev);
    color: var(--text-dim);
    transition:
      color 0.15s ease,
      background 0.15s ease,
      border-color 0.15s ease;
  }
  .theme-btn svg {
    width: 19px;
    height: 19px;
  }
  .theme-btn:hover {
    color: var(--text);
    background: var(--bg-hover);
    border-color: var(--line);
  }
  .season {
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 5px 12px 5px 8px;
    border: 1px solid var(--line);
    border-radius: 999px;
    background: var(--bg-elev);
  }
  .wc {
    height: 30px;
    width: auto;
    object-fit: contain;
    flex: none;
  }
  .season-cap {
    font-size: 10px;
    font-weight: 600;
    line-height: 1.15;
    letter-spacing: 0.3px;
    color: var(--text-dim);
    text-transform: uppercase;
  }
  .season-cap b {
    color: var(--text);
    font-weight: 800;
    font-size: 12px;
  }

  /* ---------- Main ---------- */
  main {
    flex: 1;
    width: 100%;
    max-width: var(--maxw);
    margin: 0 auto;
    padding: 18px var(--gutter) 40px;
  }

  /* ---------- Footer ---------- */
  .foot {
    border-top: 1px solid var(--line-soft);
    background:
      radial-gradient(700px 300px at 50% 120%, rgba(45, 211, 111, 0.06), transparent 70%),
      var(--bg-elev);
  }
  .foot-inner {
    max-width: var(--maxw);
    margin: 0 auto;
    padding: 30px var(--gutter) 22px;
    display: flex;
    justify-content: space-between;
    gap: 30px;
    flex-wrap: wrap;
  }
  .foot-main {
    max-width: 360px;
  }
  .foot-brand-row {
    display: flex;
    align-items: center;
    gap: 9px;
  }
  .logo.sm {
    width: 26px;
    height: 26px;
    border-radius: 8px;
  }
  .foot-brand-row .name {
    font-size: 16px;
  }
  .foot-desc {
    margin: 11px 0 0;
    font-size: 13px;
    line-height: 1.6;
    color: var(--text-dim);
  }
  .foot-addr {
    display: flex;
    align-items: center;
    gap: 9px;
    margin-top: 14px;
    font-style: normal;
    font-size: 12.5px;
    line-height: 1.55;
    color: var(--text-dim);
  }
  .foot-addr-ic {
    flex: none;
    width: 28px;
    height: 28px;
    display: grid;
    place-items: center;
    border-radius: 8px;
    background: color-mix(in srgb, var(--brand) 12%, transparent);
    color: var(--brand-2);
  }
  .foot-addr-ic svg {
    width: 15px;
    height: 15px;
  }
  .foot-nav {
    display: flex;
    flex-direction: column;
    gap: 9px;
  }
  .foot-h {
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    color: var(--text-faint);
    margin-bottom: 2px;
  }
  .foot-nav a {
    font-size: 13px;
    color: var(--text-dim);
    width: fit-content;
    transition: color 0.13s ease;
  }
  .foot-nav a:hover {
    color: var(--brand-2);
  }
  .foot-bottom {
    max-width: var(--maxw);
    margin: 0 auto;
    padding: 14px var(--gutter) calc(16px + var(--safe-bottom));
    border-top: 1px solid var(--line-soft);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    flex-wrap: wrap;
    font-size: 12px;
    color: var(--text-faint);
  }
  .foot-bottom .muted {
    color: var(--text-faint);
  }

  /* Mobile app shell: leave room for the floating bottom nav, hide footer. */
  @media (max-width: 820px) {
    main {
      padding-bottom: calc(90px + var(--safe-bottom));
    }
    .foot {
      display: none;
    }
  }

  @media (max-width: 560px) {
    :global(:root) {
      --gutter: 12px;
    }
    main {
      padding-top: 0;
    }
    .tag {
      display: none;
    }
    .hgroup {
      gap: 8px;
    }
    .theme-btn {
      width: 36px;
      height: 36px;
    }
    .season-cap {
      display: none;
    }
    .season {
      padding: 4px 8px;
      gap: 0;
    }
    .foot-inner {
      gap: 22px;
      padding: 24px 16px 18px;
    }
    .foot-bottom {
      padding: 13px 16px calc(15px + var(--safe-bottom));
    }
  }
</style>

<script>
  import Flag from './Flag.svelte';
  import { timeLabel, relDay } from '$lib/fifa.js';

  /** @type {{ matches?: any[], error?: boolean }} */
  let { matches = [], error = false } = $props();

  let view = $state('schedule'); // 'schedule' | 'results'

  const finished = $derived(matches.filter((m) => m.status === 'finished'));
  const live = $derived(matches.filter((m) => m.status === 'live'));
  const upcoming = $derived(matches.filter((m) => m.status === 'upcoming'));

  const sortAsc = (a, b) => new Date(a.date) - new Date(b.date);
  const sortDesc = (a, b) => new Date(b.date) - new Date(a.date);

  const shown = $derived(
    view === 'results'
      ? finished.slice().sort(sortDesc)
      : [...live, ...upcoming].sort(sortAsc)
  );

  const homeWins = (m) => m.status === 'finished' && (m.homeScore ?? 0) > (m.awayScore ?? 0);
  const awayWins = (m) => m.status === 'finished' && (m.awayScore ?? 0) > (m.homeScore ?? 0);
</script>

<section class="sched" id="jadwal">
  <header class="sched-head">
    <div class="sched-title">
      <img class="wc" src="/world-cup-2026.png" alt="FIFA World Cup 2026" />
      <div>
        <h2>Jadwal & Hasil</h2>
        <p>FIFA World Cup 2026™</p>
      </div>
    </div>

    {#if !error}
      <div class="tabs">
        <button class="tab" class:active={view === 'schedule'} onclick={() => (view = 'schedule')}>
          Jadwal <span class="n">{live.length + upcoming.length}</span>
        </button>
        <button class="tab" class:active={view === 'results'} onclick={() => (view = 'results')}>
          Hasil <span class="n">{finished.length}</span>
        </button>
      </div>
    {/if}
  </header>

  {#if error}
    <div class="state">Gagal memuat data dari FIFA. Coba lagi nanti.</div>
  {:else if shown.length === 0}
    <div class="state">
      {view === 'results' ? 'Belum ada hasil pertandingan.' : 'Belum ada jadwal pertandingan.'}
    </div>
  {:else}
    {#key view}
      <div class="table">
        {#each shown as m (m.id)}
          <div class="row" class:islive={m.status === 'live'}>
            <div class="mhead">
              <span class="mstage">{m.group || m.stage}</span>
              {#if m.status === 'live'}
                <span class="badge live"><span class="dot"></span>LIVE</span>
              {:else if m.status === 'finished'}
                <span class="mft">Selesai</span>
              {:else}
                <span class="mtime">{relDay(m.date)} · {timeLabel(m.date)}</span>
              {/if}
            </div>
            <div class="when">
              {#if m.status === 'live'}
                <span class="badge live"><span class="dot"></span>LIVE</span>
              {:else if m.status === 'finished'}
                <span class="badge ft">FT</span>
              {:else}
                <span class="day">{relDay(m.date)}</span>
                <span class="clock">{timeLabel(m.date)}</span>
              {/if}
            </div>

            <div class="teams">
              <div class="t" class:win={homeWins(m)}>
                <Flag src={m.home.flag} code={m.home.code} />
                <span class="nm">{m.home.name}</span>
                {#if m.status !== 'upcoming'}<span class="sc">{m.homeScore ?? 0}</span>{/if}
              </div>
              <div class="t" class:win={awayWins(m)}>
                <Flag src={m.away.flag} code={m.away.code} />
                <span class="nm">{m.away.name}</span>
                {#if m.status !== 'upcoming'}<span class="sc">{m.awayScore ?? 0}</span>{/if}
              </div>
              {#if m.homePen != null && m.awayPen != null}
                <div class="pen">Penalti {m.homePen}–{m.awayPen}</div>
              {/if}
            </div>

            <div class="meta">
              <span class="stage">{m.group || m.stage}</span>
              {#if m.city}<span class="city">{m.city}</span>{/if}
            </div>
          </div>
        {/each}
      </div>
    {/key}
  {/if}
</section>

<style>
  .sched {
    margin-top: 26px;
    padding-top: 24px;
    border-top: 1px solid var(--line-soft);
  }
  .sched-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 14px;
    flex-wrap: wrap;
    margin-bottom: 18px;
  }
  .sched-title {
    display: flex;
    align-items: center;
    gap: 14px;
  }
  .wc {
    width: 44px;
    height: 44px;
    object-fit: contain;
    flex: none;
  }
  .sched-head h2 {
    margin: 0;
    font-size: 18px;
    font-weight: 800;
    letter-spacing: -0.3px;
  }
  .sched-head p {
    margin: 2px 0 0;
    font-size: 12px;
    color: var(--text-dim);
  }

  .tabs {
    display: flex;
    gap: 8px;
  }
  .tab {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 8px 15px;
    border-radius: 999px;
    border: 1px solid var(--line);
    background: var(--bg-elev);
    color: var(--text-dim);
    font-size: 14px;
    font-weight: 600;
  }
  .tab .n {
    font-size: 12px;
    color: var(--text-faint);
  }
  .tab.active {
    background: var(--brand);
    border-color: var(--brand);
    color: #04130a;
  }
  .tab.active .n {
    color: #04130a;
    opacity: 0.7;
  }

  /* Full-width table of matches. */
  .table {
    width: 100%;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--bg-elev);
    box-shadow: var(--shadow);
    overflow: hidden;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 12px 16px;
    border-bottom: 1px solid var(--line-soft);
    transition: background 0.12s ease;
  }
  .row:last-child {
    border-bottom: none;
  }
  .row:hover {
    background: var(--bg-hover);
  }
  .row.islive {
    background: color-mix(in srgb, var(--live) 8%, transparent);
  }
  .row.islive:hover {
    background: color-mix(in srgb, var(--live) 13%, transparent);
  }

  .when {
    width: 96px;
    flex: none;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
  }
  .when .day {
    font-size: 11px;
    font-weight: 600;
    color: var(--text-faint);
  }
  .when .clock {
    font-size: 16px;
    font-weight: 800;
    color: var(--text);
    font-variant-numeric: tabular-nums;
  }
  .badge {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 12px;
    font-weight: 800;
    padding: 3px 9px;
    border-radius: 999px;
    letter-spacing: 0.3px;
  }
  .badge.live {
    color: var(--live);
    background: color-mix(in srgb, var(--live) 16%, transparent);
  }
  .badge.live .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--live);
    animation: artblink 1.4s infinite;
  }
  .badge.ft {
    color: var(--text-faint);
    background: var(--bg);
  }

  .teams {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 7px;
  }
  .t {
    display: flex;
    align-items: center;
    gap: 9px;
    min-width: 0;
  }
  .t .nm {
    flex: 1;
    min-width: 0;
    font-size: 14px;
    font-weight: 600;
    color: var(--text-dim);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .t .sc {
    font-size: 16px;
    font-weight: 800;
    color: var(--text-dim);
    font-variant-numeric: tabular-nums;
    flex: none;
  }
  .t.win .nm,
  .t.win .sc,
  .row.islive .nm,
  .row.islive .sc {
    color: var(--text);
  }
  .pen {
    font-size: 11px;
    color: var(--text-faint);
  }

  .meta {
    width: 160px;
    flex: none;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 2px;
    text-align: right;
  }
  .meta .stage {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-dim);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100%;
  }
  .meta .city {
    font-size: 11px;
    color: var(--text-faint);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100%;
  }

  .state {
    text-align: center;
    padding: 40px 20px;
    color: var(--text-dim);
    font-size: 14px;
  }

  /* Mobile-only per-card header (hidden on desktop). */
  .mhead {
    display: none;
  }

  @media (max-width: 640px) {
    .meta {
      display: none;
    }
    .when {
      width: 64px;
    }
    .row {
      gap: 10px;
      padding: 12px 13px;
    }
    .t .nm {
      font-size: 14px;
    }
  }

  /* Phone: segmented control + match cards. */
  @media (max-width: 560px) {
    .sched {
      margin-top: 0;
      padding-top: 14px;
      border-top: none;
    }
    .sched-head {
      gap: 12px;
    }
    .tabs {
      width: 100%;
      gap: 4px;
      padding: 4px;
      border-radius: 13px;
      background: var(--bg-elev);
      border: 1px solid var(--line);
    }
    .tab {
      flex: 1;
      justify-content: center;
      border: none;
      background: none;
      border-radius: 10px;
      padding: 9px 8px;
    }
    .tab.active {
      background: var(--brand);
    }

    /* Each match becomes its own card. */
    .table {
      margin: 0;
      background: transparent;
      border: none;
      border-radius: 0;
      box-shadow: none;
      display: flex;
      flex-direction: column;
      gap: 9px;
      overflow: visible;
    }
    .row {
      flex-direction: column;
      align-items: stretch;
      gap: 11px;
      padding: 13px 14px;
      border: 1px solid var(--line);
      border-radius: 16px;
      background: var(--bg-elev);
      box-shadow: var(--shadow);
    }
    .row:hover {
      background: var(--bg-elev);
    }
    .row.islive {
      border-color: color-mix(in srgb, var(--live) 35%, transparent);
      background: color-mix(in srgb, var(--live) 7%, var(--bg-elev));
    }
    .row.islive:hover {
      background: color-mix(in srgb, var(--live) 7%, var(--bg-elev));
    }

    .when,
    .meta {
      display: none;
    }
    .mhead {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding-bottom: 10px;
      border-bottom: 1px solid var(--line-soft);
    }
    .mstage {
      font-size: 12px;
      font-weight: 600;
      color: var(--text-faint);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .mtime {
      flex: none;
      font-size: 12px;
      font-weight: 700;
      color: var(--text);
    }
    .mft {
      flex: none;
      font-size: 11px;
      font-weight: 800;
      letter-spacing: 0.3px;
      color: var(--text-faint);
      text-transform: uppercase;
    }

    .teams {
      gap: 11px;
    }
    .t {
      gap: 11px;
    }
    .t .nm {
      font-size: 15px;
      font-weight: 700;
    }
    .t .sc {
      font-size: 20px;
    }
  }
</style>

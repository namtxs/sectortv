<script>
  let { form } = $props();
</script>

<svelte:head>
  <title>Admin — Masuk · SectorTV</title>
</svelte:head>

<div class="wrap">
  <form class="card" method="POST">
    <div class="logo" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="20" height="20"><path d="M8 5v14l11-7z" fill="currentColor" /></svg>
    </div>
    <h1>Admin SectorTV</h1>
    <p class="sub">Masuk untuk mengatur channel & mode sumber.</p>

    {#if form?.error}
      <div class="err">{form.error}</div>
    {/if}

    <label for="pw">Password</label>
    <input id="pw" name="password" type="password" autocomplete="current-password" placeholder="••••••••" required />

    <button type="submit">Masuk</button>
    <a class="back" href="/">← Kembali ke situs</a>
  </form>
</div>

<style>
  .wrap {
    min-height: 100dvh;
    display: grid;
    place-items: center;
    padding: 20px;
  }
  .card {
    width: 100%;
    max-width: 360px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 26px 24px 22px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--bg-elev);
    box-shadow: var(--shadow);
  }
  .logo {
    width: 44px;
    height: 44px;
    display: grid;
    place-items: center;
    border-radius: 12px;
    background: linear-gradient(150deg, var(--brand-2), var(--brand-dim));
    color: #04130a;
  }
  h1 {
    margin: 8px 0 0;
    font-size: 20px;
    font-weight: 800;
    letter-spacing: -0.4px;
  }
  .sub {
    margin: 0 0 6px;
    font-size: 13px;
    color: var(--text-dim);
  }
  label {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-dim);
  }
  input {
    padding: 11px 13px;
    border-radius: 11px;
    border: 1px solid var(--line);
    background: var(--bg);
    color: var(--text);
    font-size: 15px;
    font-family: inherit;
  }
  input:focus {
    outline: none;
    border-color: var(--brand);
  }
  button {
    margin-top: 6px;
    padding: 11px;
    border: none;
    border-radius: 11px;
    background: var(--brand);
    color: #04130a;
    font-size: 15px;
    font-weight: 800;
    font-family: inherit;
  }
  .err {
    padding: 9px 12px;
    border-radius: 10px;
    font-size: 13px;
    color: var(--live);
    background: color-mix(in srgb, var(--live) 14%, transparent);
  }
  .back {
    margin-top: 6px;
    text-align: center;
    font-size: 13px;
    color: var(--text-dim);
  }
</style>

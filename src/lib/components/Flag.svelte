<script>
  /** @type {{ src?: string|null, code?: string, size?: number }} */
  let { src = null, code = '', size = 22 } = $props();
  let failed = $state(false);
</script>

<span class="flag" style="--s:{size}px">
  {#if src && !failed}
    <img {src} alt={code} loading="lazy" onerror={() => (failed = true)} />
  {:else}
    <span class="code">{code}</span>
  {/if}
</span>

<style>
  .flag {
    width: calc(var(--s) * 1.34);
    height: var(--s);
    border-radius: 4px;
    overflow: hidden;
    flex: none;
    display: grid;
    place-items: center;
    background: var(--bg-elev-2);
    box-shadow:
      inset 0 0 0 1px var(--line),
      0 1px 2px rgba(0, 0, 0, 0.3);
  }
  .flag img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .code {
    font-size: 9px;
    font-weight: 700;
    color: var(--text-dim);
  }
</style>

<script lang="ts">
  export let open = false;
  export let title = "Popup Title";
  export let onClose: (() => void) | undefined;
</script>

{#if open}
  <div
    class="popup-backdrop"
    role="dialog"
    aria-modal="true"
    tabindex="0"
    on:click={() => { if (onClose) onClose(); }}
    on:keydown={(e) => {
      if ((e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') && onClose) {
        onClose();
      }
    }}
  >
    <div
      class="popup-window"
      role="document"
      on:click|stopPropagation
    >
      <h2 class="popup-header">{title}</h2>
      <button class="close-btn" on:click={() => { if (onClose) onClose(); }}>Close</button>
      <slot />
    </div>
  </div>
{/if}

<style>
.popup-backdrop {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  background: rgba(0,0,0,0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}
.popup-window {
  background: #222;
  color: #fff;
  padding: 1rem;
  border-radius: 1rem;
  width: 100%;
  min-width: 300px;
  min-height: 100px;
  box-shadow: 0 2px 16px rgba(0,0,0,0.4);
  position: relative;
  max-width: 90vw;
  z-index: 1001;
}
.popup-header {
  width: 100%;
  text-align: center;
  align-items: center;
  margin-top: 0;
}

.close-btn {
  position: absolute;
  top: 1rem;
  right: 1rem;
  background: #444;
  color: #fff;
  border: none;
  border-radius: 0.5rem;
  padding: 0.25rem 0.75rem;
  cursor: pointer;
  font-family: inherit;
}
.close-btn:hover {
  background: #666;
}
</style>

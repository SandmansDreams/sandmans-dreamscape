<script lang="ts">
	export let label = "Panel";
	export let side: 'left' | 'right' | 'top' | 'bottom' = 'bottom';
    let active = false;
    let hideTimeout: ReturnType<typeof setTimeout> | null = null;

    function showPanel() {
        if (hideTimeout) {
            clearTimeout(hideTimeout);
            hideTimeout = null;
        }
        active = true;
    }

    function hidePanel() {
        if (hideTimeout) clearTimeout(hideTimeout);
        hideTimeout = setTimeout(() => {
            active = false;
        }, 180); // 180ms delay, adjust as needed
    }

	// Compute classes for side
	$: labelClass = `slide-panel-label slide-panel-label--${side} ${active ? 'slide-panel-label--active' : ''}`;
	$: panelClass = `slide-panel slide-panel--${side} ${active ? 'active' : ''}`;
</script>

<div class={labelClass} role="button" tabindex="0"
    on:mouseenter={showPanel}
    on:mouseleave={hidePanel}
>
    {#if side !== 'top'}
        <span style="margin-right:0.5em;">▼</span>
    {:else}
        <span style="margin-right:0.5em;">▲</span>
    {/if}
    {label}
</div>
<div class={panelClass} role="menu" tabindex="-1"
    on:mouseenter={showPanel}
    on:mouseleave={hidePanel}
>
	<slot />
</div>

<style>
    .slide-panel-label {
        position: fixed;
        z-index: 100;
        background: rgba(5, 5, 5, 0.8);
        color: #ffffff;
        font-size: 1.1rem;
        font-family: inherit;
        letter-spacing: 0.08em;
        user-select: none;
        cursor: pointer;
        transition: background 0.2s, transform 0.35s cubic-bezier(.4,1.6,.4,1), opacity 0.25s;
        padding: 10px 18px;
        border-radius: 12px;
        box-shadow: 0 2px 8px rgba(0,0,0,0.18);
        pointer-events: auto;
        opacity: 1;
        height: 70px;
    }

    .slide-panel-label--bottom {
        left: 50%;
        bottom: 0;
        transform: translate(-50%, 35px) translateY(0);
        border-radius: 12px 12px 0 0;
        z-index: 200;
        box-shadow: 0 -2px 8px rgba(0,0,0,0.18);
        min-width: 120px;
        display: flex;
        justify-content: center;
    }
    .slide-panel-label--bottom.slide-panel-label--active {
        transform: translate(-50%, 0) translateY(80px);
        opacity: 0;
        pointer-events: none;
    }

    .slide-panel-label--right {
        top: 50%;
        right: -70px;
        transform: translateY(-50%) translateX(0) rotate(-90deg);
        border-radius: 12px 12px 0 0;
    }
    .slide-panel-label--right.slide-panel-label--active {
        transform: translateY(-50%) translateX(120px) rotate(-90deg);
        opacity: 0;
        pointer-events: none;
    }



    .slide-panel {
        position: fixed;
        z-index: 101;
        transition: transform 0.35s cubic-bezier(.4,1.6,.4,1);
        width: fit-content;
        height: fit-content;
        justify-items: center;
        align-items: center;
    }

    .slide-panel--bottom {
        left: 50%;
        bottom: 0;
        transform: translate(-50%, 100%);
        width: 100%;
        justify-content: center;
        align-content: center;
    }
    .slide-panel--bottom.active {
        transform: translate(-50%, 0px);
        pointer-events: auto;
    }

    .slide-panel--right {
        top: 50%;
        right: 0;
        transform: translateY(-50%) translateX(100%);
        justify-content: flex-start;
    }
    .slide-panel--right.active {
        transform: translateY(-50%) translateX(0px);
        pointer-events: auto;
    }
</style>

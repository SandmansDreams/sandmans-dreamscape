<script lang="ts">
    import { fly } from "svelte/transition"
    import { notifications, type NotificationKind } from "./notifications.svelte"

    /**
     * One accent per kind - the only thing that differs between two cards.
     *
     * Kept here rather than in the manager because it is presentation: a second
     * surface (a log panel, say) should be free to show the same four kinds
     * without inheriting these colours.
     */
    const ACCENT: Record<NotificationKind, string> = {
        info: "#87CEEB",    // the dev panel's blue, so info reads as the same voice
        success: "#7CE38B",
        warning: "#F0C674",
        error: "#FF6B6B",
    }
</script>

<div class="stack" role="log" aria-live="polite">
    {#each notifications.list as item (item.id)}
        <div class="card" class:dev={item.devOnly} style:--accent={ACCENT[item.kind]} transition:fly={{ x: 16, duration: 150 }}>
            <span class="kind">{item.devOnly ? `dev · ${item.kind}` : item.kind}</span>
            <span class="message">{item.message}</span>
            <button
                class="close"
                aria-label="Dismiss notification"
                onclick={() => notifications.dismiss(item.id)}
            >
                &times;
            </button>
        </div>
    {/each}
</div>

<style>
    .stack {
        position: fixed;
        top: 12px;
        /* Opposite corner from the dev panel, which is top-left */
        right: 12px;
        /* Above the dev panel's 4, so an error is never hidden behind a control */
        z-index: 10;

        display: flex;
        flex-direction: column;
        gap: 8px;
        width: min(320px, calc(100vw - 24px));

        /* The column is full height whether or not it holds anything, so only
           the cards themselves should take clicks - the canvas is underneath */
        pointer-events: none;
    }

    .card {
        pointer-events: auto;

        display: grid;
        grid-template-columns: auto 1fr auto;
        align-items: start;
        gap: 8px;
        padding: 8px 10px;

        /* Matches the dev panel: same face, same glass, same shadow. The accent
           is confined to the left edge and the label, so four kinds stay
           distinguishable without looking like four different widgets. */
        font: 12px/1.4 "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
        color: #fff;
        background: #070b0ee6;
        backdrop-filter: blur(6px);
        border: 1px solid var(--accent);
        border-left-width: 3px;
        border-radius: 4px;
        box-shadow: 0 6px 24px #000a;
    }

    .card.dev {
        border-style: dashed;
        border-left-style: solid;
    }

    .kind {
        color: var(--accent);
        text-transform: uppercase;
        letter-spacing: 0.06em;
        font-weight: 700;
    }

    /* A GPU error message is one long unbroken token, which would otherwise push
       the card past its own width instead of wrapping */
    .message {
        overflow-wrap: anywhere;
    }

    .close {
        background: none;
        border: none;
        padding: 0 2px;
        font: inherit;
        font-size: 14px;
        line-height: 1;
        color: #ffffff77;
        cursor: pointer;
    }
    .close:hover {
        color: #fff;
    }
</style>

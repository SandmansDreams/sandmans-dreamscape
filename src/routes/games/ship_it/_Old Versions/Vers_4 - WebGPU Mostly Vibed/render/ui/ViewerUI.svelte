<script lang="ts">
    /**
     * The viewer's one control, over the canvas rather than in the dev panel.
     *
     * Owns nothing. The scene decides whether there is a ship worth flying and
     * says so; this only offers the button, the same way the flight scene offers
     * its way back.
     */
    let { ready = false, onTest, onEdit }: {
        /** False until a ship is loaded, which is the only thing to test or edit. */
        ready?: boolean
        onTest: () => void
        onEdit: () => void
    } = $props()
</script>

<div id="viewer-ui">
    {#if ready}
        <div id="actions">
            <button class="panel" onclick={onTest}>Test</button>
            <button class="panel" onclick={onEdit}>Edit</button>
        </div>
    {/if}
</div>

<style>
    #viewer-ui {
        position: fixed;
        top: 0;
        left: 0;
        height: 100vh;
        width: 100vw;
        z-index: 1;
        font-family: "Jost", system-ui, sans-serif;
        /* The button takes the pointer back; everything else belongs to the canvas */
        pointer-events: none;

        --ui-background: rgba(0, 191, 255, 0.3);
        --ui-background-dark: rgba(0, 20, 34, 0.82);
        --ui-border: rgba(0, 191, 255, 0.55);
        --text-color: rgb(0, 221, 255);
    }

    .panel {
        pointer-events: auto;
        position: absolute;
        background: var(--ui-background-dark);
        border: 2px solid var(--ui-border);
        border-radius: 8px;
        box-shadow: 0 4px 18px rgba(0, 0, 0, 0.55);
        backdrop-filter: blur(4px);
    }

    /* Where the flight scene puts its way back, so the two swap places rather
       than the eye having to find a new corner on every hop */
    #actions {
        position: absolute;
        top: 14px;
        left: 14px;
        display: flex;
        gap: 6px;
    }
    #actions button {
        position: static;
        padding: 8px 12px;
        font-family: inherit;
        font-size: 12px;
        font-weight: bold;
        letter-spacing: .04em;
        color: var(--text-color);
        cursor: pointer;
    }
    #actions button:hover { background: var(--ui-background); }
</style>

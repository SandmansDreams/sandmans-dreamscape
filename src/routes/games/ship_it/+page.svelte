<script lang="ts">
    import { onMount, untrack } from "svelte"
    import { Assert } from "../ship_it/assert"

    const DEV_COLOR = "#87CEEB"

    let canvas = $state<HTMLCanvasElement | null>(null)
    let devMode = $state(true) // If want only in dev, swith to 'import.meta.env.DEV'
</script>

<div id="container">
    {#if devMode}
        <div id="dev-panel" style:--DEV_COLOR={`${DEV_COLOR}`}>
            <header>
                <span class="title">DEV MODE: ON</span>
            </header>

            <footer>` toggles this panel</footer>
        </div>
    {/if}

    <canvas bind:this={canvas}></canvas>
</div>

<style>
    /*
     * Both self-hosted, and both variable fonts - one file covers every weight,
     * so the panels can reach for 300 or 700 without another request.
     *
     * Declared here rather than in the site's layout.css: these are the game's
     * fonts, and a face declared in a page's style block is still global once
     * that page loads. The site keeps its own type unchanged.
     *
     * `font-display: swap` because a UI panel that is invisible until a font
     * arrives is worse than one that reflows.
     */
    @font-face {
        font-family: "Jost";
        src: url("/fonts/Jost-Variable.ttf") format("truetype");
        font-weight: 100 900;
        font-style: normal;
        font-display: swap;
    }

    @font-face {
        font-family: "JetBrains Mono";
        src: url("/fonts/JetBrainsMono-Variable.ttf") format("truetype");
        font-weight: 100 800;
        font-style: normal;
        font-display: swap;
    }

    canvas {
        background-color: black;
        position: relative;
        height: 100vh;
        width: 100vw;
        z-index: 0;
        image-rendering: pixelated;
        image-rendering: crisp-edges;
    }

    footer {
        text-align: center;
        color: var(--DEV_COLOR);
    }

    #container {
        background-color: black;
        position: absolute;
        padding: 0;
        margin: 0;
        top: 0;
        left: 0;
        height: 100vh;
        width: 100vw;
        overscroll-behavior: none;
        overflow: hidden;
        font-family: Jost, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
    }

    #dev-panel {
        --accent: var(--DEV_COLOR);
        --line: var(--DEV_COLOR);
        --track: #ffffff14;

        position: absolute;
        top: 12px;
        left: 12px;
        /* Above the builder's bars. They are fixed and full-width, so anything
           lower loses its clicks to them wherever the two overlap - the panel
           would still be visible, just inert, which reads as a broken control */
        z-index: 4;
        font: 12px/1.4 "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
        color: #fff;
        background: #070b0ee6;
        backdrop-filter: blur(6px);
        border: 1px solid var(--line);
        border-radius: 4px;
        box-shadow: 0 6px 24px #000a;
        padding: 15px;
        width: 25vw;
        max-height: calc(100vh - 48px);
        /* auto, not none: "none" is not a value overflow-y takes, so the panel
           spilled past its max-height and focusing a control down there scrolled
           #container instead, dragging the canvas up off the top of the window */
        overflow-y: auto;
        opacity: 25%;
        transition: .25s ease;
    }
    #dev-panel:hover {
        opacity: 100%;
    }
    /* Chrome and Safari. These are ignored the moment scrollbar-width or
       scrollbar-color is set on the same element, which is why the standard
       properties are quarantined in the @supports block below. */
    #dev-panel::-webkit-scrollbar {
        width: 10px;
    }
    #dev-panel::-webkit-scrollbar-track {
        background: transparent;
    }
    #dev-panel::-webkit-scrollbar-thumb {
        background: #0df3;
        border-radius: 5px;
        /* Transparent border plus content-box clipping insets the thumb without
           narrowing the track, so the hit area stays a comfortable 10px */
        border: 2px solid transparent;
        background-clip: content-box;
    }
    #dev-panel::-webkit-scrollbar-thumb:hover {
        background: #0dfa;
        background-clip: content-box;
    }

    /* Firefox, which has no pseudo-elements to style */
    @supports not selector(::-webkit-scrollbar) {
        #dev-panel {
            scrollbar-width: thin;
            scrollbar-color: #0df6 transparent;
        }
    }

    .stats {
        display: grid;
        grid-template-columns: 1fr auto;
        gap: 2px 12px;
        margin: 8px 0;
        padding: 8px 0;
        border-top: 1px solid var(--line);
        border-bottom: 1px solid var(--line);
    }
    .stats .label { color: #ffffff99; }
    .stats .value {
        color: var(--accent);
        font-variant-numeric: tabular-nums;
        text-align: right;
    }
    .stats .muted { color: #ffffff55; }

    .scene-select {
        width: 100%;
        background: #0b1116;
        color: #fff;
        border: 1px solid var(--line);
        border-radius: 3px;
        padding: 3px 5px;
        font: inherit;
    }

    .description {
        color: #ffffff77;
        margin: 8px 0 0;
    }
</style>

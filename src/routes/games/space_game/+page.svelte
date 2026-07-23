<script lang="ts">
    import { onMount } from "svelte";

    let canvas = $state<HTMLCanvasElement | null>(null)
    let context = $state<CanvasRenderingContext2D | null>(null)

    function resizeCanvas() {
        if (!canvas || !context) return;

        const rect = canvas.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;

        const width = Math.round(rect.width * dpr)
        const height = Math.round(rect.height * dpr)

        // Resize the backing buffer to match the displayed size
        canvas.width = width;
        canvas.height = height;

        // Reset any previous transforms and scale for HiDPI displays
        context.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    onMount(() => {
        if (!canvas) return
        context = canvas.getContext("2d")
        resizeCanvas()
    }) 
</script>

<svelte:window onresize={resizeCanvas} /* onscroll={} *//>

<div id="container">
    <div id="top-bar" class="ui">
        <h1>Space_Game</h1>
        <button /* onclick={toggleMode} */>{"Mode = building"}</button>
    </div>

    <div id="spacer"></div>

    <div id="bottom-bar" class="ui">
        <div id="bottom-bar-left">
            <h3 id="bottom-bar-title-bar">Block Picker</h3>
            <div id="bottom-bar-options">
                <button>1</button>
                <button>2</button>
                <button>3</button>
            </div>
        </div>
        <div id="bottom-bar-right">
            <div id="bottom-bar-selector">
                <button class="active">Blocks</button>
                <button>Ships</button>
                <button>Other</button>
            </div>
        </div>
    </div>
</div>

<canvas 
    bind:this={canvas}
    id="camera"  
    class="crt" 
></canvas>

<style>
    :root {
        background-color: black;
        overflow: hidden;
        overscroll-behavior: none;
        padding: 0;
        color: var(--text-color);
        font-family: 'Courier New', Courier, monospace;

        --background: rgb(18, 18, 18);
        --ui-background: rgba(0, 191, 255, 0.1);
        --ui-background-dark: rgba(0, 191, 255, 0.05);
        --text-color: rgb(0, 221, 255, 0.8);
        --blue: rgba(105, 208, 255, 0.1);
    }

    h1, h2, h3, h4, h5, h6 {
        line-height: normal;
        margin: 0;
        padding: 0;
    }

    button {
        background-color: var(--ui-background);
        border: solid 3px var(--ui-background);
        border-radius: 10px;
        padding: .5rem 1rem;
        font-family: 'Courier New', Courier, monospace;
        color: var(--text-color);
        font-weight: bold;
        font-size: 18px;
    }
    button:hover {
        background-color: rgba(0, 191, 255, 0.25);
    }
    button:active {
        background-color: rgba(0, 191, 255, 0.05);
    }

    button.disabled {
        background-color: rgba(123, 123, 123, 0.3);
        color: rgba(194, 194, 194, 0.8);
    }

    button.active {
        background-color: rgba(0, 255, 64, 0.3);
        color: rgba(0, 255, 64, 0.8)
    }
    button.active:hover {
        background-color: rgba(0, 255, 64, 0.25);
    }
    button.active:active {
        background-color: rgba(0, 255, 64, 0.05);
    }

    #camera {
        background-color: black;
        position: absolute;
        top: 0;
        left: 0;
        height: 100vh;
        width: 100vw;
        margin-inline: auto;
        padding: 0;
        z-index: 0;
    }

    .crt {
        background: linear-gradient(to top, rgba(0, 0, 0, 0), rgba(0, 0, 0, 0), rgba(255, 255, 255, 0.05), rgba(255, 255, 255, 0.05));
        background-size: cover;
        background-size: 100% 3px;
    }

    .ui {
        background-color: var(--ui-background);
    }

    #container {
        position: absolute;
        height: 100vh;
        width: 100vw;
        top: 0;
        left: 0;
        display: grid;
        grid-template-rows: auto 75vh auto;
        z-index: 1;
        margin: 0;
    }

    #spacer {
        height: 100%;
        width: 100%;
    }
    
    #top-bar {
        display: flex;
        padding: 1rem;
        align-items: center;
        justify-content: space-between;
        border-bottom: solid 3px var(--ui-background);
    }

    #bottom-bar {
        position: relative;
        display: grid;
        grid-template-columns: 9fr 2fr;
        align-items: center;
        border-top: solid 3px var(--ui-background);
        background: none;
        height: 100%;
    }
    #bottom-bar-left {
        position: relative;
        height: 100%;
        display: grid;
        grid-template-rows: 1fr 4fr;
        min-height: 0;
    }
    #bottom-bar-title-bar {
        border: 1px solid var(--ui-background);
        align-content: center;
        padding: .5rem;
        font-weight: bold;
        background-color: var(--ui-background);
    }
    #bottom-bar-options {
        border: 1px solid var(--ui-background);
        background-color: var(--ui-background-dark);
        display: flex;
        gap: .5rem;
        padding: .5rem;
    }
    #bottom-bar-options button {
        min-width: 100px;
        max-width: 200px;
    }
    #bottom-bar-right {
        border: 1px solid var(--ui-background);
        background-color: var(--ui-background);
        height: 100%;
    }
    #bottom-bar-selector {
        display: flex;
        flex-direction: column;
        padding: .5rem;
        gap: 10px;
    }
</style>
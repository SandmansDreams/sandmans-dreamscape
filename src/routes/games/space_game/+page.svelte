<script lang="ts">
    import { onMount } from "svelte";
    import { Assert } from "./diagnostics";

    let canvas = $state<HTMLCanvasElement | null>(null)
    let gl2 = $state<WebGL2RenderingContext | null | undefined>(null)

    function resizeCanvas(renderScale: number = 1) {
        if (!canvas || !gl2) {
            Assert.exists({canvas})
            Assert.exists({gl2})
            return
        }
    
        const rect = canvas!.getBoundingClientRect()
        //const cssHeight = rect.height
        //const cssWidth = rect.width

        const dpr = window.devicePixelRatio || 1

        const width = Math.max(1, Math.round(rect.width * dpr * renderScale))
        const height = Math.max(1, Math.round(rect.height * dpr * renderScale))

        // Don't change unless different
        if (canvas.width === width && canvas.height === height) return false

        canvas.width = width
        canvas.height = height
        gl2.viewport(0, 0, width, height)
        return true
    }

    onMount(() => {
        Assert.exists({canvas})

        gl2 = canvas?.getContext("webgl2")
        Assert.exists({gl2})

        resizeCanvas()

    })
</script>

<svelte:window /* onkeydown={onKeyDown} */ />

<div id="container">
    <div id="stats">

    </div>

    <canvas bind:this={canvas}></canvas>
</div>

<style>
    canvas {
        background-color: black;
        position: relative;
        height: 100vh;
        width: 100vw;
        z-index: 0;
        image-rendering: pixelated;
        image-rendering: crisp-edges;
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
    }

    #stats {
        position: absolute;
        top: 8px;
        left: 8px;
        z-index: 1;
        font: 12px/1.4 monospace;
        color: #0df;
        pointer-events: none;
        white-space: pre-wrap;
        max-width: calc(100vw - 16px);
    }
</style>

<script lang="ts">
    import { onMount } from "svelte";
    import { Assert } from "./diagnostics";
  import { MINIMAL_2D_FRAGMENT_SHADER, MINIMAL_2D_VERTEX_SHADER, Program, Shader } from "./render/shaders";
  import { Mesh } from "./render/mesh";

    let canvas = $state<HTMLCanvasElement | null>(null)
    let gl2 = $state<WebGL2RenderingContext | null | undefined>(null)

    function resizeCanvas(renderScale: number = 1) {
        if (!canvas || !gl2) {
            Assert.exists(canvas, "canvas")
            Assert.exists(gl2, "gl2")
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

    const vertices = [
        [ 0.0,  0.25,   1, 0, 0],   // top
        [ 0.5, -0.25,   0, 1, 0],   // bottom right
        [-0.5, -0.25,   0, 0, 1],   // bottom left
    ]

    const triangle1 = [vertices[0], vertices[1], vertices[2]].flat()

    onMount(() => {
        Assert.exists(canvas, "canvas")

        gl2 = canvas?.getContext("webgl2")
        Assert.exists(gl2, "gl2")

        const vertexShader = new Shader(gl2, gl2.VERTEX_SHADER, MINIMAL_2D_VERTEX_SHADER)
        const fragmentShader = new Shader(gl2, gl2.FRAGMENT_SHADER, MINIMAL_2D_FRAGMENT_SHADER)
        const program = new Program(gl2, [vertexShader, fragmentShader])

        const mesh = new Mesh(gl2, triangle1)

        resizeCanvas()

        program.use()
        mesh.draw()
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

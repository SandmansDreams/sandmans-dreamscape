<script lang="ts">
    import { onMount } from "svelte";
    import { Assert } from "./diagnostics";
    import {
        MINIMAL_2D_VERTEX_SHADER,
        MINIMAL_2D_FRAGMENT_SHADER,
        CHROMATIC_ABERRATION_2D_VERTEX_SHADER,
        CHROMATIC_ABERRATION_2D_FRAGMENT_SHADER,
        Program,
        Shader,
    } from "./render/shaders";
    import { Mesh } from "./render/mesh";
    import { RenderTarget } from "./render/targets";
    import { FullscreenPass } from "./render/passes";

    let canvas = $state<HTMLCanvasElement | null>(null)
    let gl2 = $state<WebGL2RenderingContext | null | undefined>(null)

    let intensity = $state(0.01) // The knob that replaced the mouse

    function resizeCanvas(renderScale: number = 1) {
        if (!canvas || !gl2) {
            Assert.exists(canvas, "canvas")
            Assert.exists(gl2, "gl2")
            return false
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
        [ 0.0,  0.25,   1, 1, 1],
        [ 0.5, -0.25,   1, 1, 1],
        [-0.5, -0.25,   1, 1, 1],
    ]
    const triangle1 = [vertices[0], vertices[1], vertices[2]].flat()

    onMount(() => {
        Assert.exists(canvas, "canvas")
        const cvs = canvas          // capture: narrowing doesn't survive into frame()

        gl2 = cvs.getContext("webgl2")
        Assert.exists(gl2, "gl2")
        const gl = gl2              // same reason

        // --- Scene ---
        const sceneProgram = new Program(gl, [
            new Shader(gl, gl.VERTEX_SHADER, MINIMAL_2D_VERTEX_SHADER),
            new Shader(gl, gl.FRAGMENT_SHADER, MINIMAL_2D_FRAGMENT_SHADER),
        ])
        const mesh = new Mesh(gl, triangle1)

        // --- Post ---
        resizeCanvas() // size the canvas before the target copies its dimensions
        const sceneTarget = new RenderTarget(gl, cvs.width, cvs.height)
        const chromatic = new FullscreenPass(
            gl,
            CHROMATIC_ABERRATION_2D_VERTEX_SHADER,
            CHROMATIC_ABERRATION_2D_FRAGMENT_SHADER,
        )

        let running = true
        const start = performance.now()

        function frame(now: number) {
            if (!running) return

            if (resizeCanvas()) {
                sceneTarget.resize(cvs.width, cvs.height)
            }

            // Pass 1: draw the game into the offscreen target
            sceneTarget.bind()
            gl.clearColor(0, 0, 0, 1)
            gl.clear(gl.COLOR_BUFFER_BIT)

            sceneProgram.use()
            mesh.draw()

            // Pass 2: draw that target through the effect onto the canvas
            RenderTarget.bindCanvas(gl, cvs.width, cvs.height)
            chromatic.draw(sceneTarget, (program) => {
                gl.uniform2f(program.uniform("u_Resolution"), cvs.width, cvs.height)
                gl.uniform1f(program.uniform("u_Time"), (now - start) / 1000)
                gl.uniform1f(program.uniform("u_Intensity"), intensity)
            })

            requestAnimationFrame(frame)
        }
        requestAnimationFrame(frame)

        return () => { running = false } // stop the loop on unmount
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

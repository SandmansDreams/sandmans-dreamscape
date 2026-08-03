<script lang="ts">
    import { onMount } from "svelte";

    import { Game } from "./engine/game"
    import { BASIC_VERTEX_SHADER, BASIC_FRAGMENT_SHADER, MESH_VERTEX_SHADER } from "./engine/shaders"
    import { Program } from "./engine/program";
    import { InstancedBatch, UNIT_QUAD } from "./engine/batch";
    import { buildShapeChart } from "./engine/shapeChart";

    /** "chart" proves the tessellator; "squares" is the instancing baseline. */
    const MODE: "chart" | "squares" = "chart"

    class FrameStats {
        fps = 0
        workMs = 0

        private frames = 0
        private workAccum = 0
        private windowStart = 0
        private frameStart = 0

        begin(now: number) {
            this.frameStart = now
            if (this.windowStart === 0) this.windowStart = now
        }

        /** Returns true when a new sample is ready and the display should update. */
        end(now: number, windowMs = 250): boolean {
            this.workAccum += now - this.frameStart
            this.frames++

            const elapsed = now - this.windowStart
            if (elapsed < windowMs) return false

            this.fps = (this.frames * 1000) / elapsed
            this.workMs = this.workAccum / this.frames

            this.frames = 0
            this.workAccum = 0
            this.windowStart = now
            return true
        }
    }

    const SIM_HZ = 60
    const STEP_MS = 1000 / SIM_HZ
    const MAX_CATCHUP = 5   // never simulate more than this many steps in one frame

    const stats = new FrameStats()
    let previousTime = 0
    let accumulator = 0

    let fps = $state(0)
    let workMs = $state(0)

    let canvas = $state<HTMLCanvasElement | null>(null)
    //let gl2 = $state<WebGL2RenderingContext | null>(null)
    let game = $state<Game | null>(null)
    let program = $state<Program | null>(null)
    let batch: InstancedBatch | null = null

    let frameId = 0

    // Chart mode: one static mesh holding every shape, drawn as a single
    // instance sitting at the world origin.
    const chart = buildShapeChart()
    let chartTriangles = $state(0)

    const COUNT = 10000
    const BOUND = 2000
    const SIZE = 5

    const posX = new Float64Array(COUNT), posY = new Float64Array(COUNT)
    const prevX = new Float64Array(COUNT), prevY = new Float64Array(COUNT)
    const velX = new Float64Array(COUNT), velY = new Float64Array(COUNT)
    const rot = new Float64Array(COUNT), prevRot = new Float64Array(COUNT)
    const rotVel = new Float64Array(COUNT)
    const color = new Float32Array(COUNT * 3)

    function simulate() {
        for (let i = 0; i < COUNT; i++) {
            prevX[i] = posX[i]
            prevY[i] = posY[i]
            prevRot[i] = rot[i]

            posX[i] += velX[i]
            posY[i] += velY[i]
            rot[i] += rotVel[i]

            // Wrap prev alongside pos, or interpolation draws a streak across
            // the whole world on the frame something wraps.
            if (posX[i] >  BOUND) { posX[i] -= BOUND * 2; prevX[i] -= BOUND * 2 }
            if (posX[i] < -BOUND) { posX[i] += BOUND * 2; prevX[i] += BOUND * 2 }
            if (posY[i] >  BOUND) { posY[i] -= BOUND * 2; prevY[i] -= BOUND * 2 }
            if (posY[i] < -BOUND) { posY[i] += BOUND * 2; prevY[i] += BOUND * 2 }
        }
    }

    /**
     * Frames the chart in the viewport.
     *
     * Recomputed every frame rather than once at mount: the canvas has no
     * layout yet when onMount runs, so measuring there yields 0 and a zoom of
     * 0. Doing it here also keeps the chart fitted through window resizes.
     */
    function frameChart() {
        if (!game) return

        game.camera.x = chart.width / 2
        game.camera.y = chart.height / 2
        game.camera.zoom = Math.min(
            Math.max(1, game.cssWidth) / chart.width,
            Math.max(1, game.cssHeight) / chart.height
        ) * 0.85
    }

    function render(alpha: number) {
        if (!game || !program || !batch) return

        if (MODE === "chart") frameChart()

        game.update()   // resize, camera, clear

        batch.begin()

        if (MODE === "chart") {
            // A single instance at the origin; the mesh carries its own colours.
            batch.addTransform(0, 0, 0, 1)
        } else {
            for (let i = 0; i < COUNT; i++) {
                batch.add(
                    prevX[i] + (posX[i] - prevX[i]) * alpha,
                    prevY[i] + (posY[i] - prevY[i]) * alpha,
                    prevRot[i] + (rot[i] - prevRot[i]) * alpha,
                    SIZE,
                    color[i * 3], color[i * 3 + 1], color[i * 3 + 2]
                )
            }
        }

        program.use()
        program.setMatrix4("uProjection", game.camera.projection)
        batch.draw()
    }

    function tick(now: number) { // Basic game loop
        stats.begin(now)

        if (previousTime === 0) previousTime = now
        // Clamped: without this, returning to a backgrounded tab tries to
        // simulate thousands of steps at once and locks the page.
        accumulator += Math.min(now - previousTime, STEP_MS * MAX_CATCHUP)
        previousTime = now

        while (accumulator >= STEP_MS) {
            if (MODE === "squares") simulate()
            accumulator -= STEP_MS
        }

        render(accumulator / STEP_MS)

        if (stats.end(performance.now())) {
            fps = stats.fps
            workMs = stats.workMs
        }

        frameId = requestAnimationFrame(tick)
    }

    function seedSquares() {
        for (let i = 0; i < COUNT; i++) {
            // prev must match pos, or the first frame interpolates from the
            // origin and every square streaks in from the middle.
            posX[i] = prevX[i] = (Math.random() * 2 - 1) * BOUND
            posY[i] = prevY[i] = (Math.random() * 2 - 1) * BOUND

            velX[i] = (Math.random() * 2 - 1) * 1.5
            velY[i] = (Math.random() * 2 - 1) * 1.5

            rot[i] = prevRot[i] = Math.random() * Math.PI * 2
            rotVel[i] = (Math.random() * 2 - 1) * 0.05

            // Floor at 0.3 so nothing comes out near-black against the backdrop.
            color[i * 3 + 0] = 0.3 + Math.random() * 0.7
            color[i * 3 + 1] = 0.3 + Math.random() * 0.7
            color[i * 3 + 2] = 0.3 + Math.random() * 0.7
        }
    }

    onMount (() => {
        if (!canvas) throw new Error("'canvas' not defined at onMount()")

        game = new Game(canvas, .1)

        if (MODE === "chart") {
            program = new Program(game.gl2, MESH_VERTEX_SHADER, BASIC_FRAGMENT_SHADER)

            batch = new InstancedBatch(
                game.gl2,
                chart.vertices,
                [{ location: 0, size: 2 }, { location: 1, size: 3 }],  // per vertex: pos, colour
                [{ location: 2, size: 4 }],                            // per instance: transform
                1
            )

            chartTriangles = chart.vertices.length / 5 / 3
        } else {
            program = new Program(game.gl2, BASIC_VERTEX_SHADER, BASIC_FRAGMENT_SHADER)

            batch = new InstancedBatch(
                game.gl2,
                UNIT_QUAD,
                [{ location: 0, size: 2 }],                            // per vertex
                [{ location: 1, size: 4 }, { location: 2, size: 3 }],  // per instance
                COUNT
            )

            seedSquares()
        }

        frameId = requestAnimationFrame(tick)

        // On dismount
        return () => {
            cancelAnimationFrame(frameId)
        }
    })
</script>

<div id="container">
    <div id="stats">
        {#if MODE === "chart"}
            {fps.toFixed(0)} fps · {workMs.toFixed(2)} ms · {chartTriangles} triangles · 1 draw call
            <br />rows: full / wedge / arc &nbsp;·&nbsp; columns: 0° 90° 180° 270°
        {:else}
            {fps.toFixed(0)} fps · {workMs.toFixed(2)} ms · {COUNT} instances · 1 draw call
        {/if}
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
    }
</style>
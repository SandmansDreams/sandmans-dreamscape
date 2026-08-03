<script lang="ts">
    import { onMount } from "svelte";

    import { Game } from "./engine/game"
    import { BASIC_VERTEX_SHADER, BASIC_FRAGMENT_SHADER } from "./engine/shaders"
    import { Program } from "./engine/program";
    import { mat4 } from "ts-gl-matrix";
  import { Mesh } from "./engine/mesh";

    let canvas = $state<HTMLCanvasElement | null>(null)
    //let gl2 = $state<WebGL2RenderingContext | null>(null)
    let game = $state<Game | null>(null)
    let program = $state<Program | null>(null)
    let mesh = $state<Mesh | null>(null)

    let frameId = 0

    const TRIANGLE = new Float32Array([
    //    x      y       r    g    b
        0.0,   100,    1,   0,   0,
        -100,  -100,    0,   1,   0,
        100,  -100,    0,   0,   1,
    ])

    function tick() { // Basic game loop
        if (!game || !program || !mesh) throw new Error("essential variable not found in tick()")
        game.update()

        program.use()
        program.setMatrix4("uProjection", game.camera.projection)

        mesh.draw()

        frameId = requestAnimationFrame(tick)
    }

    onMount (() => {
        if (!canvas) throw new Error("'canvas' not defined at onMount()")

        game = new Game(canvas, 0.15)
        program = new Program(game.gl2, BASIC_VERTEX_SHADER, BASIC_FRAGMENT_SHADER)

        mesh = new Mesh(game.gl2, TRIANGLE, [
            { location: 0, size: 2 },   // aPosition
            { location: 1, size: 3 },   // aColor
        ])

        frameId = requestAnimationFrame(tick)

        // On dismount
        return () => {
            cancelAnimationFrame(frameId)
        }
    })
</script>

<canvas bind:this={canvas}></canvas>

<style>
    canvas {
        background-color: black;
        position: absolute;
        top: 0;
        left: 0;
        height: 100vh;
        width: 100vw;
        margin-inline: auto;
        padding: 0;
        z-index: 0;
        image-rendering: pixelated;
        image-rendering: crisp-edges;
    }
</style>
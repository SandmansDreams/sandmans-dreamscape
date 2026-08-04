<script lang="ts">
    import { onMount } from "svelte"

    import { Game } from "./engine/game"
    import { GameLoop } from "./engine/loop"
    import { createScene, type Scene, type SceneName } from "./engine/dev/scenes"

    /**
     * Which demo to show while there is no game yet.
     * "ships" pages through the hulls, "chart" proves the tessellator,
     * "squares" is the instancing performance baseline.
     */
    const SCENE: SceneName = "ships"

    let canvas = $state<HTMLCanvasElement | null>(null)

    let fps = $state(0)
    let workMs = $state(0)
    let drawCalls = $state(0)
    let description = $state("")

    /**
     * A Scene is a class instance, which Svelte does not deep-proxy — reading
     * `scene.views.index` in the markup would render once and never update. So
     * the picker state is mirrored here and refreshed after every change.
     */
    let viewNames = $state<readonly string[]>([])
    let viewIndex = $state(0)
    let lightColor = $state("#ffffff")
    let hasLight = $state(false)

    let scene: Scene | null = null

    function setLightColor(hex: string) {
        lightColor = hex
        scene?.light?.setColor(hex)
    }

    function selectView(index: number) {
        if (!scene?.views) return

        scene.views.select(index)
        viewIndex = scene.views.index
        description = scene.description
    }

    function onKeyDown(event: KeyboardEvent) {
        if (event.key === "ArrowLeft") selectView(viewIndex - 1)
        else if (event.key === "ArrowRight") selectView(viewIndex + 1)
    }

    onMount(() => {
        if (!canvas) throw new Error("canvas not bound at onMount()")

        const game = new Game(canvas, 0.25)
        const active = createScene(SCENE, game.gl2)
        scene = active

        description = active.description
        viewNames = active.views?.names ?? []
        viewIndex = active.views?.index ?? 0

        hasLight = active.light !== undefined
        lightColor = active.light?.color ?? lightColor

        const loop = new GameLoop({
            simulate: () => active.simulate(),

            render: (alpha) => {
                game.update()   // resize, camera, clear
                return active.render(game.camera, alpha)
            },

            onStats: (stats) => {
                fps = stats.fps
                workMs = stats.workMs
                drawCalls = stats.drawCalls
            }
        })

        loop.start()

        return () => {
            loop.stop()
            active.dispose()
            scene = null
        }
    })
</script>

<svelte:window onkeydown={onKeyDown} />

<div id="container">
    <div id="stats">
        {fps.toFixed(0)} fps · {workMs.toFixed(2)} ms · {drawCalls.toFixed(0)} draw calls
        {#each description.split("\n") as line}
            <br />{line}
        {/each}
    </div>

    {#if hasLight}
        <!--
            Invisible by request: a hit target in the top-right corner that
            opens the native picker. Kept a real input rather than a custom
            control so the OS colour wheel and eyedropper come for free.
        -->
        <input
            id="light"
            type="color"
            title="light colour"
            aria-label="light colour"
            value={lightColor}
            oninput={(event) => setLightColor(event.currentTarget.value)}
        />
    {/if}

    {#if viewNames.length > 1}
        <div id="picker">
            <button onclick={() => selectView(viewIndex - 1)} aria-label="previous">‹</button>

            {#each viewNames as name, index}
                <button
                    class:active={index === viewIndex}
                    onclick={() => selectView(index)}
                >{name}</button>
            {/each}

            <button onclick={() => selectView(viewIndex + 1)} aria-label="next">›</button>
        </div>
    {/if}

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

    /* Invisible, but still a real, clickable input. */
    #light {
        position: absolute;
        top: 8px;
        right: 8px;
        z-index: 1;
        width: 32px;
        height: 32px;
        padding: 0;
        border: none;
        background: none;
        opacity: 0;
        cursor: pointer;
    }

    #picker {
        position: absolute;
        bottom: 12px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 1;
        display: flex;
        justify-content: flex-start;
        gap: 6px;
        /* One row at any width: wrapping piles rows up over the ships. */
        max-width: calc(100vw - 24px);
        overflow-x: auto;
        scrollbar-width: none;
    }

    #picker button {
        flex: 0 0 auto;
        font: 12px/1 monospace;
        color: #0df;
        background: rgba(0, 0, 0, 0.6);
        border: 1px solid #0df6;
        border-radius: 3px;
        padding: 6px 10px;
        cursor: pointer;
    }

    #picker button:hover {
        border-color: #0df;
    }

    #picker button.active {
        color: #000;
        background: #0df;
        border-color: #0df;
    }
</style>

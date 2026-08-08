<script lang="ts">
    import { onMount } from "svelte";
    import { Assert } from "./dev/assert";
    import { GPU } from "./render/gpu"
    import { Shader } from "./render/shader"
    import { Pipeline } from "./render/pipeline"
    import { FrameLoop } from "./render/loop"
    import { FLAT_TRIANGLE } from "./render/shaders/flat"

    let canvas = $state<HTMLCanvasElement | null>(null)

    // Dev mode
    let devMode = $state(true) // If want only in dev, swith to 'import.meta.env.DEV'
    //let scene = $state<Scene | null>(null)

    let fps = $state(-1)
    let fpsClass = $derived(fps >= 55 ? "good" : fps >= 30 ? "ok" : "bad")

    onMount(() => {
        Assert.exists(canvas, "canvas")
        const target = canvas

        let gpu: GPU | null = null
        const loop = new FrameLoop()

        void(async () => {
            const created = await GPU.create(target)
            gpu = created

            const shader = await Shader.create(created, FLAT_TRIANGLE, "flat triangle")
            const pipeline = Pipeline.create(created, {label: "flat triangle", shader})

            loop.start(() => {
                created.beginFrame([0.05, 0.05, 0.07, 1])
                    .setPipeline(pipeline)
                    .draw(3)
                    .end()

                fps = loop.fps
            })
        })() // These 2 parentheses are important

        return () => {
            loop.stop()
            gpu?.destroy()
        }
    })
</script>

<svelte:window onkeydown={(e) => { if (e.key === "`") devMode = !devMode }} />

<div id="container">
    {#if devMode}
        <div id="dev-panel">
            <header>
                <span class="title">DEV</span>
                <span class="fps {fpsClass}">{fps.toFixed(0)} fps</span>
            </header>

            <span class="select">
                <!--<select
                    value={scene?.id ?? ""}
                    onchange={(e) => {
                        const found = DEV_SCENES.find((s) => s.id === e.currentTarget.value)
                        if (found) selectScene(found)
                    }}
                >
                    {#each DEV_SCENES as definition (definition.id)}
                        <option value={definition.id}>{definition.name}</option>
                    {/each}
                </select>-->
            </span>

            <footer>` toggles this panel</footer>
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

    #dev-panel {
        --accent: #0df;
        --line: #0df3;
        --track: #ffffff14;

        position: absolute;
        top: 12px;
        left: 12px;
        z-index: 1;
        font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace;
        color: #fff;
        background: #070b0ee6;
        backdrop-filter: blur(6px);
        border: 1px solid var(--line);
        border-radius: 4px;
        box-shadow: 0 6px 24px #000a;
        padding: 10px;
        width: 320px;
        max-height: calc(100vh - 48px);
        overflow-y: auto;
        opacity: 25%;
        transition: .25s ease;
    }
    #dev-panel:hover {
        opacity: 100%;
    }

    .fps {
        font-variant-numeric: tabular-nums;
    }
    .fps.good { color: #6f6; }
    .fps.ok   { color: #fc4; }
    .fps.bad  { color: #f66; }
</style>

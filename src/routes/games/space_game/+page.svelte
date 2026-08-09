<script lang="ts">
    import { onMount } from "svelte";
    import { Assert } from "./dev/assert";
    import { GPU } from "./render/gpu"
    import { Shader } from "./render/shader"
    import { FrameLoop } from "./render/loop"
    import { FLAT_TRIANGLE } from "./render/shaders/flat"
    import { Camera, CameraBinding } from "./render/camera"
    import { MeshBuilder, VERTEX_LAYOUT } from "./render/mesh"
    import { MESH_2D } from "./render/shaders/mesh2d"
    import { InstanceBatch } from "./render/instance"
    import { Pipeline, emptyBindGroupLayout } from "./render/pipeline"
    import { INSTANCED_2D } from "./render/shaders/instanced2d"

    let canvas = $state<HTMLCanvasElement | null>(null)

    // Dev mode
    let devMode = $state(true) // If want only in dev, swith to 'import.meta.env.DEV'
    let rotation = $state(0)
    //let scene = $state<Scene | null>(null)

    let fps = $state(-1)
    let fpsClass = $derived(fps >= 55 ? "good" : fps >= 30 ? "ok" : "bad")

    onMount(() => {
        Assert.exists(canvas, "canvas")
        const target = canvas

        let gpu: GPU | null = null
        const loop = new FrameLoop()
        const camera = new Camera()

        void(async () => {
            const created = await GPU.create(target)
            gpu = created

            const shader = await Shader.create(created, INSTANCED_2D, "instanced 2d")
            const cameraBinding = CameraBinding.create(created)
            const instanceLayout = InstanceBatch.layout(created)

            const pipeline = Pipeline.create(created, {
                label: "instanced 2d",
                shader,
                // Group 1 is reserved for materials and is still empty
                layouts: [cameraBinding.layout, emptyBindGroupLayout(created), instanceLayout],
                vertexBuffers: [VERTEX_LAYOUT],
            })

            // A 1x1 white quad centred on the origin, so the instance transform
            // scales about its middle and the instance colour comes through as-is.
            const quad = new MeshBuilder()
                .quad(-0.5, -0.5, 1, 1, [1, 1, 1])
                .build(created, "unit quad")

            // Deliberately below COUNT so the first frame exercises grow()
            const batch = InstanceBatch.create(created, instanceLayout, 1024, "quads")

            const COUNT = 5000
            let elapsed = 0

            loop.start((dt) => {
                elapsed += dt
                camera.rotation = rotation
                cameraBinding.upload(camera, created.width, created.height)

                batch.begin()
                for (let i = 0; i < COUNT; i++) {
                    const angle = i * 0.1 + elapsed
                    const radius = 20 + i * 0.12
                    batch.add(
                        Math.cos(angle) * radius,
                        Math.sin(angle) * radius,
                        angle * 2,
                        14,
                        0.5 + 0.5 * Math.sin(i * 0.03),
                        0.5 + 0.5 * Math.sin(i * 0.03 + 2),
                        0.5 + 0.5 * Math.sin(i * 0.03 + 4),
                    )
                }

                const frame = created.beginFrame([0.05, 0.05, 0.07, 1])
                frame.setPipeline(pipeline).setBindGroup(0, cameraBinding.group)
                batch.draw(frame, quad)
                frame.end()

                fps = loop.fps
            })
        })() // These 2 parentheses are important

        return () => {
            loop.stop()
            gpu?.destroy()
        }
    })
</script>

<svelte:window onkeydown={(e) => {
    if (e.key === "`") devMode = !devMode
    if (e.key === "]") rotation += 0.1
    if (e.key === "[") rotation -= 0.1
}} />

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

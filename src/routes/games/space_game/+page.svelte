<script lang="ts">
    import { FLAT_TRIANGLE } from "./render/shaders/flat"
    import { MESH_2D } from "./render/shaders/mesh2d"
    import { INSTANCED_2D } from "./render/shaders/instanced2d"

    import { onMount } from "svelte";
    import { Assert } from "./dev/assert";
    import { GPU } from "./render/gpu"
    import { Shader } from "./render/shader"
    import { FrameLoop } from "./render/loop"
    import { Camera, CameraBinding } from "./render/camera"
    import { MeshBuilder, VERTEX_LAYOUT } from "./render/mesh"
    import { InstanceBatch } from "./render/instance"
    import { Pipeline, emptyBindGroupLayout } from "./render/pipeline"
    import { Stats, type StatEntry } from "./dev/performance"
    import { GpuTimer } from "./render/timing"

    let DEV_COLOR = "#87CEEB" // Blue //"#32CD32" // Green

    let canvas = $state<HTMLCanvasElement | null>(null)

    // Dev mode
    let devMode = $state(true) // If want only in dev, swith to 'import.meta.env.DEV'
    let rotation = $state(0)
    //let scene = $state<Scene | null>(null)

    let statLines = $state<StatEntry[]>([])
    let gpuTimingSupported = $state(true)
    let fps = $state(0)
    let budgetMs = $state(1000 / 60)
    let fpsColor = $derived(healthColor((60 - fps) / 30))

    // 0 = healthy, 1 = at or past the limit
    function healthColor(t: number): string {
        const clamped = Math.min(1, Math.max(0, t))

        // Hue 120 (green) -> 0 (red), through amber at the midpoint
        return `hsl(${(120 * (1 - clamped)).toFixed(0)} 90% 62%)`
    }

    function statColor(entry: StatEntry): string {
        // Counts are neither good nor bad - 5,000 instances is a workload, not a health signal
        if (entry.unit !== "ms") return ""

        // Full green below 40% of the budget, full red once it reaches the budget
        return healthColor((entry.average / budgetMs - 0.4) / 0.6)
    }

    function formatStat(entry: StatEntry): string {
        return entry.unit === "ms"
            ? `${entry.average.toFixed(2)} ms`
            : Math.round(entry.average).toLocaleString()
    }

    onMount(() => {
        Assert.exists(canvas, "canvas")
        const target = canvas

        let gpu: GPU | null = null
        const loop = new FrameLoop()
        const camera = new Camera()

        const stats = new Stats()
        let panelTicker: ReturnType<typeof setInterval> | undefined
        let timer: GpuTimer | null = null

        void(async () => {
            const created = await GPU.create(target)
            gpu = created

            const shader = await Shader.create(created, INSTANCED_2D, "instanced 2d")
            const cameraBinding = CameraBinding.create(created)
            const instanceLayout = InstanceBatch.layout(created)

            timer = new GpuTimer(created)
            gpuTimingSupported = timer.supported

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

            const COUNT = 15000
            let elapsed = 0

            loop.start((dt) => {
                stats.begin("cpu frame")
                elapsed += dt

                camera.rotation = rotation
                cameraBinding.upload(camera, created.width, created.height)

                stats.begin("build instances")
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
                stats.end("build instances")

                const frame = created.beginFrame([0.05, 0.05, 0.07, 1], timer)
                frame.setPipeline(pipeline).setBindGroup(0, cameraBinding.group)
                batch.draw(frame, quad)
                frame.end()

                stats.end("cpu frame")
                stats.set("instances", batch.size)
                stats.set("draw calls", frame.calls)
                if (timer?.lastMs !== null && timer !== null) stats.set("gpu pass", timer.lastMs!, "ms")

                fps = loop.fps
            })

            // Reading every frame would re-render the panel 60 times a second for digits nobody can follow that fast
            panelTicker = setInterval(() => {
                statLines = stats.entries()
                budgetMs = loop.budgetMs
            }, 200)
        })() // These 2 parentheses are important

        return () => {
            loop.stop()
            clearInterval(panelTicker)
            timer?.destroy()
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
        <div id="dev-panel" style:--DEV_COLOR={`${DEV_COLOR}`}>
            <header>
                <span class="title">DEV MODE: ON</span>
            </header>

            <div class="stats">
                <span class="label">fps</span>
                <span class="value" style:color={fpsColor}>{fps.toFixed(0)}</span>

                {#each statLines as line (line.name)}
                    <span class="label">{line.name}</span>
                    <span class="value" style:color={statColor(line)}>{formatStat(line)}</span>
                {/each}

                {#if !gpuTimingSupported}
                    <span class="label">gpu pass</span>
                    <span class="value muted">unsupported</span>
                {/if}
            </div>

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
        --accent: var(--DEV_COLOR);
        --line: var(--DEV_COLOR);
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
        width: 350px;
        max-height: calc(100vh - 48px);
        overflow-y: auto;
        opacity: 25%;
        transition: .25s ease;
    }
    #dev-panel:hover {
        opacity: 100%;
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
</style>

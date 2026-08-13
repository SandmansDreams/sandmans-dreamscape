<script lang="ts">
    import { onMount, untrack } from "svelte"
    import { Assert } from "./dev/assert"
    import { DEV_SCENES } from "./dev/DevScene"
    import type { StatEntry } from "./dev/performance"
    import SettingsPanel from "./dev/SettingsPanel.svelte"
    import { GPU } from "./render/webgpu/gpu"
    import { SceneRunner, type SceneDefinition } from "./render/scene"
    import {
        loadSceneId,
        loadSceneValues,
        saveSceneId,
        saveSceneValues,
        type SettingValues,
    } from "./settings/settings"
    import BuilderPanel from "./dev/BuilderPanel.svelte"
    import { loadBrush, saveBrush, type Brush } from "./dev/brush"

    const DEV_COLOR = "#87CEEB"

    let canvas = $state<HTMLCanvasElement | null>(null)
    let devMode = $state(true) // If want only in dev, swith to 'import.meta.env.DEV'

    // The scene list needs no GPU, so the last-used scene can be restored before the
    // device exists - the load effect below simply waits for the runner
    const initial = DEV_SCENES.find((s) => s.id === loadSceneId()) ?? DEV_SCENES[0] ?? null

    let runner = $state<SceneRunner | null>(null)
    let scene = $state<SceneDefinition | null>(initial)
    let values = $state<SettingValues>(initial ? loadSceneValues(initial.id, initial.settings ?? {}) : {})

    let palette = $state<string[]>([])
    let brush = $state<Brush>(loadBrush())

    let fps = $state(0)
    let budgetMs = $state(1000 / 60)
    let statLines = $state<StatEntry[]>([])
    let gpuTimingSupported = $state(true)

    function formatStat(entry: StatEntry): string {
        // Smoothing is right for milliseconds and wrong for counts: an averaged
        // draw-call count reports values that never actually happened, like 2
        // while it crawls between one scene's 1 and the next scene's 4
        return entry.unit === "ms"
            ? `${entry.average.toFixed(2)} ms`
            : Math.round(entry.latest).toLocaleString()
    }

    function healthColor(t: number): string {
        const clamped = Math.min(1, Math.max(0, t))
        return `hsl(${(120 * (1 - clamped)).toFixed(0)} 90% 62%)`
    }

    function statColor(entry: StatEntry): string {
        if (entry.unit !== "ms") return ""
        return healthColor((entry.average / budgetMs - 0.4) / 0.6)
    }

    let fpsColor = $derived(healthColor((60 - fps) / 30))

    function selectScene(definition: SceneDefinition) {
        scene = definition
        values = loadSceneValues(definition.id, definition.settings ?? {})
        saveSceneId(definition.id)
    }

    // The brush is not a setting, so it travels on its own channel. Declared
    // after the load effect so a scene swap sends to the new instance, not the
    // one being torn down
    $effect(() => {
        runner?.send("brush", brush)
    })

    let brushSaveTimer: ReturnType<typeof setTimeout> | undefined

    $effect(() => {
        const snapshot = brush
        // Debounced for the same reason settings are: dragging emission would
        // otherwise write localStorage on every pointer move
        clearTimeout(brushSaveTimer)
        brushSaveTimer = setTimeout(() => saveBrush(snapshot), 400)
    })

    // Selection changes rebuild every GPU resource the scene owns
    $effect(() => {
        const definition = scene
        if (!runner || !definition) return
        // untrack is what stops a slider drag from tearing down and recreating the
        // whole scene on every pointer event
        runner.load(definition, untrack(() => values))
    })

    // Value changes are pushed through without a rebuild
    $effect(() => {
        runner?.setValues(values)
    })

    let saveTimer: ReturnType<typeof setTimeout> | undefined
    $effect(() => {
        const definition = scene
        const snapshot = values
        if (!definition) return

        // Debounced: a slider drag would otherwise write localStorage 60 times a second
        clearTimeout(saveTimer)
        saveTimer = setTimeout(() => saveSceneValues(definition.id, snapshot), 400)
    })

    onMount(() => {
        const target = canvas
        Assert.exists(target, "canvas")

        let created: SceneRunner | null = null
        let ticker: ReturnType<typeof setInterval> | undefined

        void (async () => {
            const gpu = await GPU.create(target)
            created = new SceneRunner(gpu)
            gpuTimingSupported = created.gpuTimingSupported

            // Assigning this is what lets the load effect above build the first scene
            runner = created
            created.start()

            ticker = setInterval(() => {
                fps = created!.fps
                budgetMs = created!.budgetMs
                statLines = created!.stats.entries()
                palette = created!.published<string[]>("palette") ?? []
            }, 200)
        })() // These 2 parentheses are important

        return () => {
            clearInterval(ticker)
            clearTimeout(saveTimer)
            created?.dispose()
            runner = null
        }
    })
</script>

<svelte:window onkeydown={(e) => {
    if (e.key === "`") devMode = !devMode
}} />

<div id="container">
    {#if scene?.builder}
        <BuilderPanel bind:brush {palette} />
    {/if}

    {#if devMode}
        <div id="dev-panel" class:below-bar={scene?.builder} style:--DEV_COLOR={`${DEV_COLOR}`}>
            <header>
                <span class="title">DEV MODE: ON</span>
            </header>

            <select
                class="scene-select"
                value={scene?.id ?? ""}
                onchange={(e) => {
                    const found = DEV_SCENES.find((s) => s.id === e.currentTarget.value)
                    if (found) selectScene(found)
                }}
            >
                {#each DEV_SCENES as definition (definition.id)}
                    <option value={definition.id}>{definition.name}</option>
                {/each}
            </select>

            {#if scene}
                <p class="description">{scene.description}</p>
            {/if}

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

            {#if scene?.settings}
                <SettingsPanel schema={scene.settings} bind:values onAction={(name) => runner?.invoke(name)}/>
            {/if}

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

    footer {
        text-align: center;
        color: var(--DEV_COLOR);
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
        padding: 15px;
        width: 25vw;
        max-height: calc(100vh - 48px);
        /* auto, not none: "none" is not a value overflow-y takes, so the panel
           spilled past its max-height and focusing a control down there scrolled
           #container instead, dragging the canvas up off the top of the window */
        overflow-y: auto;
        opacity: 25%;
        transition: .25s ease;
    }
    #dev-panel:hover {
        opacity: 100%;
    }
    /* Chrome and Safari. These are ignored the moment scrollbar-width or
       scrollbar-color is set on the same element, which is why the standard
       properties are quarantined in the @supports block below. */
    #dev-panel::-webkit-scrollbar {
        width: 10px;
    }
    #dev-panel::-webkit-scrollbar-track {
        background: transparent;
    }
    #dev-panel::-webkit-scrollbar-thumb {
        background: #0df3;
        border-radius: 5px;
        /* Transparent border plus content-box clipping insets the thumb without
           narrowing the track, so the hit area stays a comfortable 10px */
        border: 2px solid transparent;
        background-clip: content-box;
    }
    #dev-panel::-webkit-scrollbar-thumb:hover {
        background: #0dfa;
        background-clip: content-box;
    }
    /* The builder's top bar owns the full width of the screen, so the dev panel
       drops below it rather than underneath it */
    #dev-panel.below-bar { top: 92px; max-height: calc(100vh - 128px); }

    /* Firefox, which has no pseudo-elements to style */
    @supports not selector(::-webkit-scrollbar) {
        #dev-panel {
            scrollbar-width: thin;
            scrollbar-color: #0df6 transparent;
        }
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

    .scene-select {
        width: 100%;
        background: #0b1116;
        color: #fff;
        border: 1px solid var(--line);
        border-radius: 3px;
        padding: 3px 5px;
        font: inherit;
    }

    .description {
        color: #ffffff77;
        margin: 8px 0 0;
    }
</style>

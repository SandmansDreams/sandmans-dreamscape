<script lang="ts">
    import { onMount, untrack } from "svelte";
    import { Assert } from "./assert";
    import { DEV_SCENES } from "./dev/DevScene";
    import { SceneRunner, type SceneDefinition } from "./render/scenes";
    import { defaultValues, loadLastSceneId, saveLastSceneId, type SettingValues } from "./settings/settings";
    import { FullscreenPass } from "./render/passes";
    import { PASSTHROUGH_FRAGMENT_SOURCE } from "./render/shaders";
    import { RenderTarget } from "./render/targets";
    import SettingsPanel from "./dev/SettingsPanel.svelte";

    let canvas = $state<HTMLCanvasElement | null>(null)
    let gl2 = $state<WebGL2RenderingContext | null | undefined>(null)

    // Dev mode
    let devMode = $state(true) // If want only in dev, swith to 'import.meta.env.DEV'
    let harness = $state<SceneRunner | null>(null) 
    let scene = $state<SceneDefinition | null>(DEV_SCENES[0] ?? null)
    let values = $state<SettingValues>(
        DEV_SCENES[0] ? defaultValues(DEV_SCENES[0].settings) : {}
    )
    let fps = $state(0)
    let fpsClass = $derived(fps >= 55 ? "good" : fps >= 30 ? "ok" : "bad")

    function selectScene(definition: SceneDefinition) {
        scene = definition
        // A game scene may declare no settings at all
        values = defaultValues(definition.settings ?? {}) // reset before the scene loads
        saveLastSceneId(definition.id)
    }

    // Rebuild the scene when the selection changes - untrack keeps a slider
    // drag from tearing down and recreating every GPU resource
    $effect(() => {
        const definition = scene
        if (!harness || !definition) return
        harness.load(definition, untrack(() => values))
    })

    // Push value changes through every frame without reloading
    $effect(() => {
        harness?.setValues(values)
    })

    onMount(() => {
        // Restore before the harness exists. The load effect bails out while
        // `harness` is null, so setting the scene first means it fires once with
        // the right one rather than building DEV_SCENES[0] and replacing it.
        // localStorage is only readable in the browser, so this cannot be done
        // in the $state initialiser above without an SSR/hydration mismatch.
        const lastId = loadLastSceneId()
        const restored = DEV_SCENES.find((definition) => definition.id === lastId)
        if (restored) selectScene(restored)

        Assert.exists(canvas, "canvas")

        gl2 = canvas.getContext("webgl2")
        Assert.exists(gl2, "gl2")

        // Default presentation for scenes that don't override present()
        const basicPresentation = new FullscreenPass(
            gl2, PASSTHROUGH_FRAGMENT_SOURCE
        )

        const created = new SceneRunner(canvas, gl2, (target) => {
            RenderTarget.bindCanvas(gl2!, canvas!.width, canvas!.height)
            basicPresentation.draw(target)
        })

        harness = created
        created.start()

        const stats = setInterval(() => {fps = created.fps}, 100)

        return () => {
            clearInterval(stats)
            created.dispose()
            harness = null
        }
    })
</script>

<svelte:window onkeydown={(e) => { if (e.key === "`") devMode = !devMode }} />

<div id="container">
    {#if devMode}
        <div id="dev">
            <header>
                <span class="title">DEV</span>
                <span class="fps {fpsClass}">{fps.toFixed(0)} fps</span>
            </header>

            <span class="select">
                <select
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
            </span>

            {#if scene}
                <p class="description">{scene.description}</p>
                <div class="divider"></div>
                <SettingsPanel schema={scene.settings ?? {}} bind:values />
            {:else}
                <p class="description">No dev scenes found.</p>
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

    #dev {
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
    }

    header {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        margin-bottom: 8px;
    }

    .title {
        color: var(--accent);
        letter-spacing: 0.18em;
        opacity: 0.8;
    }

    .fps {
        font-variant-numeric: tabular-nums;
        opacity: 0.9;
    }

    .fps.good { color: #6f6; }
    .fps.ok   { color: #fc4; }
    .fps.bad  { color: #f66; }

    .select {
        position: relative;
        display: block;
    }

    .select::after { /* the arrow - the native one can't be styled */
        content: "";
        position: absolute;
        top: 50%;
        right: 8px;
        margin-top: -2px;
        border: 4px solid transparent;
        border-top-color: var(--accent);
        pointer-events: none;
    }

    #dev select {
        appearance: none;
        -webkit-appearance: none;
        width: 100%;
        padding: 5px 22px 5px 7px;
        background: var(--track);
        color: #fff;
        border: 1px solid var(--line);
        border-radius: 3px;
        font: inherit;
        cursor: pointer;
    }

    #dev select:hover,
    #dev select:focus-visible {
        border-color: var(--accent);
        outline: none;
    }

    #dev option {
        background: #0b0f12;
        color: #fff;
    }

    .divider {
        height: 1px;
        background: var(--line);
        margin: 10px 0 8px;
    }

    .description {
        opacity: 0.55;
        margin: 8px 0 0;
    }

    footer {
        margin-top: 10px;
        padding-top: 8px;
        border-top: 1px solid var(--line);
        opacity: 0.35;
    }
</style>

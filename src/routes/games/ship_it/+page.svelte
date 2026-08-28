<script lang="ts">
    import { onMount } from "svelte"
    import { Assert } from "./utilities/assert"
    import Notification from "./ui/Notification.svelte"
    import { notifications } from "./ui/notifications.svelte"
    import { installConsoleNotifications } from "./dev/consoleNotifications"
    import { Game } from "./game/game"
    import SettingsPanel from "./ui/SettingsPanel.svelte"
    import { DEV_SCENES, initialScene, type DevSceneDefinition } from "./dev/scenes"
    import { loadSceneId, type SettingValues } from "./settings/settings"
    import type { StatEntry } from "./dev/performance"

    const DEV_COLOR = "#87CEEB"

    let canvas = $state<HTMLCanvasElement | null>(null)
    let devMode = $state(true) // For dev environment only, switch to 'import.meta.env.DEV'

    // Mirrored off the game by a ticker rather than written from the frame loop -
    // these are $state, and assigning them per frame re-renders the panel at 60fps
    let game = $state<Game | null>(null)
    let scene = $state<DevSceneDefinition | null>(null)
    let values = $state<SettingValues>({})

    let fps = $state(0)
    let budgetMs = $state(1000 / 60)
    let statLines = $state<StatEntry[]>([])
    let gpuTimingSupported = $state(true)

    function formatStat(entry: StatEntry): string {
        // Smoothing is right for milliseconds and wrong for counts: an averaged
        // draw-call count reports values that never actually happened
        if (entry.unit === "ms") return `${entry.average.toFixed(2)} ms`
        if (entry.unit === "value") return entry.latest.toFixed(2)
        return Math.round(entry.latest).toLocaleString()
    }

    function healthColor(t: number): string {
        const clamped = Math.min(1, Math.max(0, t))
        return `hsl(${(120 * (1 - clamped)).toFixed(0)} 90% 62%)`
    }

    /** Milliseconds go green to red against the display's own budget, not against 60. */
    function statColor(entry: StatEntry): string {
        if (entry.unit !== "ms") return ""
        return healthColor((entry.average / budgetMs - 0.4) / 0.6)
    }

    let fpsColor = $derived(healthColor((60 - fps) / 30))

    $effect(() => {
        notifications.devEnabled = devMode
    })

    /**
     * Loads a scene and reads back the values Game restored for it.
     *
     * A function rather than an effect on `scene`: loading rebuilds every GPU
     * resource the outgoing scene owned, and an effect would re-run it on any
     * dependency that happened to be read in the same block.
     */
    function selectScene(definition: DevSceneDefinition): void {
        const active = game
        if (!active) return

        active.load(definition)
        scene = definition

        // Game is the one that reads storage, so the panel takes its values from
        // there rather than computing defaults a second time
        values = { ...active.settings }
    }

    // The spread is what makes this fire: setValues only reads the object, so
    // without touching every key a slider drag would not register as a change
    $effect(() => {
        const snapshot = { ...values }
        if (Object.keys(snapshot).length > 0) game?.setValues(snapshot)
    })

    onMount(() => {
        Assert.exists(canvas, "Variable 'canvas' does not exist")

        // First, so anything logged while the device is coming up is mirrored too -
        // including the failure of Renderer.create itself
        const stopMirroring = installConsoleNotifications()

        let unmounted = false
        let ticker: ReturnType<typeof setInterval> | undefined
        let offDevPanel: (() => void) | null = null

        void Game.create(canvas)
            .then((created) => {
                // create() awaits twice, so it can resolve after the page is gone
                if (unmounted) return created.destroy()

                game = created
                created.onError = (error) => notifications.error(error.message)

                // Through the input service rather than a raw keydown, so the key
                // is rebindable and the typing guard is the same one every action gets
                offDevPanel = created.input.onGlobalPress((action) => {
                    if (action === "global.devPanel") devMode = !devMode
                })

                gpuTimingSupported = created.gpuTimingSupported

                // Restores whichever scene was open last, or the first registered one
                const first = initialScene(loadSceneId())
                if (first) selectScene(first)
                else notifications.dev.warn("No dev scenes registered")

                created.start()

                // Five times a second: enough to read, cheap to render
                ticker = setInterval(() => {
                    fps = created.fps
                    budgetMs = created.budgetMs
                    statLines = created.stats.entries()
                }, 200)
            })
            .catch((error: unknown) => {
                notifications.error(error instanceof Error ? error.message : String(error))
            })

        return () => {
            unmounted = true
            clearInterval(ticker)
            offDevPanel?.()

            // Before the console is put back, so anything logged while tearing
            // down still reaches the stack it is about to clear
            game?.destroy()
            game = null
            stopMirroring()
            notifications.clear()
        }
    })
</script>

<div id="container">
    {#if devMode}
        <div id="dev-panel" style:--DEV_COLOR={`${DEV_COLOR}`}>
            <header>
                <span class="title">DEV MODE: ON</span>
            </header>

            <select
                class="scene-select"
                value={scene?.id ?? ""}
                onchange={(event) => {
                    const found = DEV_SCENES.find((definition) => definition.id === event.currentTarget.value)
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

            {#if scene}
                <SettingsPanel
                    schema={scene.settings}
                    bind:values
                    onAction={(name) => game?.invoke(name)}
                />
            {/if}

            <footer>` toggles this panel</footer>
        </div>
    {/if}

    <canvas bind:this={canvas}></canvas>

    <Notification />
</div>

<style>
    /*
     * Both self-hosted, and both variable fonts - one file covers every weight,
     * so the panels can reach for 300 or 700 without another request.
     *
     * Declared here rather than in the site's layout.css: these are the game's
     * fonts, and a face declared in a page's style block is still global once
     * that page loads. The site keeps its own type unchanged.
     *
     * `font-display: swap` because a UI panel that is invisible until a font
     * arrives is worse than one that reflows.
     */
    @font-face {
        font-family: "Jost";
        src: url("/fonts/Jost-Variable.ttf") format("truetype");
        font-weight: 100 900;
        font-style: normal;
        font-display: swap;
    }

    @font-face {
        font-family: "JetBrains Mono";
        src: url("/fonts/JetBrainsMono-Variable.ttf") format("truetype");
        font-weight: 100 800;
        font-style: normal;
        font-display: swap;
    }

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
        font-family: Jost, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
    }

    #dev-panel {
        --accent: var(--DEV_COLOR);
        --line: var(--DEV_COLOR);
        --track: #ffffff14;

        position: absolute;
        top: 12px;
        left: 12px;
        /* Above the builder's bars. They are fixed and full-width, so anything
           lower loses its clicks to them wherever the two overlap - the panel
           would still be visible, just inert, which reads as a broken control */
        z-index: 4;
        font: 12px/1.4 "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
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

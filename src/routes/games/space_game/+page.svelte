<script lang="ts">
    import { onMount } from "svelte"
    import { browser } from "$app/environment"

    import SettingsPanel from "./SettingsPanel.svelte"
    import { Game } from "./engine/game"
    import { GameLoop } from "./engine/loop"
    import { createScene, type Scene, type SceneName } from "./engine/dev/scenes"
    import {
        DEFAULTS, SETTING_KEYS, STORAGE_KEY, toStorable, type Settings
    } from "./engine/settings"
    import { clearSettings, loadSettings } from "./engine/settings/storage"

    let canvas = $state<HTMLCanvasElement | null>(null)

    let fps = $state(0)
    let workMs = $state(0)
    let drawCalls = $state(0)
    let description = $state("")

    /**
     * A plain object, so Svelte deep-proxies it: the renderer reads through
     * this same reference every frame and the panel writes into it, with
     * nothing in between. Contrast `scene` below — a class instance, which is
     * *not* proxied, and so has to be mirrored into state by hand.
     */
    let settings = $state<Settings>(loadSettings())

    let viewNames = $state<readonly string[]>([])
    let viewIndex = $state(0)

    let game: Game | null = null
    let loop: GameLoop | null = null
    let scene: Scene | null = null

    function syncFromScene() {
        description = scene?.description ?? ""
        viewNames = scene?.views?.names ?? []
        viewIndex = scene?.views?.index ?? 0
    }

    function selectView(index: number) {
        if (!scene?.views) return

        scene.views.select(index)
        syncFromScene()

        // Remember which ship you were looking at.
        const id = (scene as { selectedId?: string }).selectedId
        if (id !== undefined) settings["scene.hullId"] = id
    }

    function onKeyDown(event: KeyboardEvent) {
        if (event.key === "ArrowLeft") selectView(viewIndex - 1)
        else if (event.key === "ArrowRight") selectView(viewIndex + 1)
    }

    /**
     * Rebuilds the scene from the current settings.
     *
     * The scene name, cell size and wireframe colour are all baked in at
     * construction, so changing any of them rebuilds the lot. That is about a
     * millisecond for the hulls we have — cheaper than the bookkeeping needed
     * to work out which mesh actually went stale.
     */
    function buildScene() {
        if (!game) return

        scene?.dispose()
        scene = createScene(settings["scene.name"] as SceneName, game.gl2, settings)
        syncFromScene()
    }

    /**
     * Puts every setting back to what defaults.json says.
     *
     * Assigns key by key rather than replacing the object: the scene captured
     * this proxy at construction, and handing it a fresh one would leave it
     * reading a bag nothing writes to any more. Only the settings that force a
     * rebuild would appear to reset.
     */
    function resetSettings() {
        clearSettings()
        for (const key of SETTING_KEYS) settings[key] = DEFAULTS[key]
    }

    onMount(() => {
        if (!canvas) throw new Error("canvas not bound at onMount()")

        game = new Game(canvas, Number(settings["render.scale"]))

        loop = new GameLoop({
            simulate: () => scene?.simulate(),

            render: (alpha) => {
                game?.update()   // resize, camera, clear
                return game && scene ? scene.render(game.camera, alpha) : 0
            },

            onStats: (stats) => {
                fps = stats.fps
                workMs = stats.workMs
                drawCalls = stats.drawCalls
            }
        }, { simHz: Number(settings["render.simHz"]) })

        loop.start()

        return () => {
            loop?.stop()
            scene?.dispose()
            scene = null
            loop = null
            game = null
        }
    })

    /*
     * Settings that cannot simply be read during render. Everything else — all
     * of light.* and shading.*, plus the layout gap — the scene picks up on the
     * next frame without any help from here.
     */

    $effect(() => {
        // Named rather than read inline so the dependencies are obvious. Each
        // of these is baked into the scene at construction: the shader decides
        // the vertex layout, the other two the geometry.
        const name = settings["scene.name"]
        const shader = settings["scene.shader"]
        const cellSize = settings["scene.cellSize"]
        const wireColor = settings["scene.wireColor"]

        void name; void shader; void cellSize; void wireColor

        buildScene()
    })

    // The blend is a uniform, so it needs no rebuild — but it is in the
    // description, which is only re-read when the scene changes.
    $effect(() => {
        void settings["shading.blend"]
        description = scene?.description ?? ""
    })

    $effect(() => {
        game?.setRenderScale(Number(settings["render.scale"]))
        game?.resizeCanvas()
    })

    $effect(() => {
        loop?.setSimHz(Number(settings["render.simHz"]))
    })

    let saveTimer: ReturnType<typeof setTimeout>

    $effect(() => {
        // Stringifying establishes the dependency on every key at once.
        const snapshot = JSON.stringify(toStorable(settings))
        if (!browser) return

        clearTimeout(saveTimer)
        saveTimer = setTimeout(() => {
            try {
                localStorage.setItem(STORAGE_KEY, snapshot)
            } catch (error) {
                console.warn("settings: could not be saved", error)
            }
        }, 300)
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

    <!--
        Invisible by request: a hit target in the top-right corner that opens
        the native picker. Kept a real input rather than a custom control so the
        OS colour wheel and eyedropper come for free. It writes the same setting
        the panel does, so the two stay in step on their own.
    -->
    <input
        id="light"
        type="color"
        title="light colour"
        aria-label="light colour"
        value={settings["light.color"] as string}
        oninput={(event) => settings["light.color"] = event.currentTarget.value}
    />

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

    <SettingsPanel {settings} onreset={resetSettings} />

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

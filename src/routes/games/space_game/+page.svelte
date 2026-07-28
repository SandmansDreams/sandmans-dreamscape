App · SVELTE
<script lang="ts">
    import { onMount } from "svelte";
    import { buildStarMap, drawLayerLocally } from "./background";
    import { Asteroid, spawnAsteroidField } from "./entities/asteroid";
    import { getPositionFromEvent, getRandomVector, isVisible, resizeCanvas } from "./helpers";
    import { Camera, Player, type DebugOptions } from "./types";
    import { EmptyController, FollowController, NEUTRAL_INPUT, PlayerController, type InputState } from "./controller";
    import { CollisionManager, Vector2 } from "./physics";
    import { Ship } from "./entities/ship";
    import { BLOCK_MENU, ShipGrid, type BlockShape } from "./builder";
    import { GridEditor } from "./grid-editor";
 
    let canvas = $state<HTMLCanvasElement | null>(null)
    let context = $state<CanvasRenderingContext2D | null>(null)
 
    let starMaps = $state<HTMLCanvasElement[]>([])
    let mode = $state<"building" | "flying">("flying")

    // Each debug overlay toggles independently.
    let debugOptions = $state<DebugOptions>({
        stats: false,
        vectors: false,
        hitboxes: false
    })

    function toggleDebugOption(key: keyof DebugOptions) {
        debugOptions[key] = !debugOptions[key]
    }

    let activePanel = $state<"blocks" | "ships" | "other">("ships")

    function selectPanel(panel: typeof activePanel) {
        activePanel = panel
    }

    let selectedBlockShape = $state<BlockShape | null>("empty")

    function chooseShape(shape: BlockShape | null) {
        selectedBlockShape = shape
        gridEditor?.selectShape(shape)
    }
 
    const input: InputState = NEUTRAL_INPUT
 
    let frame = 0
    let lastTimestamp = 0
    const motionBlur = $state(0.4)

    const collisionManger = new CollisionManager()

    const shipCount = 1
    let ships = $state<Ship[]>([])
    let shipThumbCanvases = $state<HTMLCanvasElement[] | null[]>([])
    const asteroidCount = 200
    let asteroids: Asteroid[] = []
 
    const controller = new PlayerController(input)
    let player: Player
    let gridEditor: GridEditor
 
    const camera = new Camera()
    camera.position = new Vector2(0, 0)

 
    function handleKeyDown(event: KeyboardEvent) {
        switch (event.key.toLowerCase()) {
            case "w":
            case "arrowup":
                input.forward = true
                break

            case "a":
            case "arrowleft":
                input.left = true
                break

            case "s":
            case "arrowdown":
                input.backward = true
                break

            case "d":
            case "arrowright":
                input.right = true
                break

            case " ":
                input.space = true
                break
        }
    }

    function handleKeyUp(event: KeyboardEvent) {
        switch (event.key.toLowerCase()) {
            case "w":
            case "arrowup":
                input.forward = false
                break

            case "a":
            case "arrowleft":
                input.left = false
                break

            case "s":
            case "arrowdown":
                input.backward = false
                break

            case "d":
            case "arrowright":
                input.right = false
                break

            case " ":
                input.space = false
                break
        }
    }
 
    function render() {
        if (!context || !canvas) return;
 
        context.fillStyle = `rgba(0,0,0,${motionBlur})`
        context.fillRect(0, 0, canvas.clientWidth, canvas.clientHeight)
        //context.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
 
        // Draw the world (parallax star layers)
        context.save();
        starMaps?.forEach((element, index) => {
            drawLayerLocally(element, (index + 1) * 0.1, context!, camera)
        });
        context.restore();

        if (mode === "flying") {
            renderFlyingView()
        } else {
            renderBuildView()
        }
    }

    function renderFlyingView() {
        if (!context || !canvas) return;

        // Draw asteroids, skipping ones that are off-screen
        asteroids.forEach((asteroid) => {
            if (isVisible(asteroid.position.x, asteroid.position.y, asteroid.radius, canvas!, camera)) {
                asteroid.draw(context!, camera, debugOptions)
            }
        })

        // Draw the player
        player.draw(context, camera, debugOptions)
    }

    function renderBuildView() {
        if (!context || !canvas) return;

        // Whatever the builder screen should show — grid, the selected ship's
        // block layout, a palette, etc. Placeholder for now:
        context.save()
        context.strokeStyle = "rgba(0, 221, 255, 0.15)"
        context.lineWidth = 1

        const gridSize = 40
        for (let x = 0; x < canvas.clientWidth; x += gridSize) {
            context.beginPath()
            context.moveTo(x, 0)
            context.lineTo(x, canvas.clientHeight)
            context.stroke()
        }
        for (let y = 0; y < canvas.clientHeight; y += gridSize) {
            context.beginPath()
            context.moveTo(0, y)
            context.lineTo(canvas.clientWidth, y)
            context.stroke()
        }
        context.restore()
    }

    function renderShipThumbnails() {
        ships.forEach((ship, index) => {
            const thumbCanvas = shipThumbCanvases[index]
            if (!thumbCanvas) return

            const thumbCtx = thumbCanvas.getContext("2d")
            if (!thumbCtx) return

            thumbCtx.clearRect(0, 0, thumbCanvas.clientWidth, thumbCanvas.clientHeight)

            const thumbCamera = new Camera()
            thumbCamera.position = ship.position.clone()

            ship.draw(thumbCtx, thumbCamera, debugOptions)
        })
    }
 
    function tick(timestamp: number) {
        if (!lastTimestamp) lastTimestamp = timestamp
 
        // Normalize delta so movement is speed-independent of frame rate
        // (delta === 1 at a steady 60fps)
        const deltaMs = timestamp - lastTimestamp
        const delta = deltaMs / (1000 / 60)
        lastTimestamp = timestamp
 
        if (mode === "flying") {
            player.update(delta)

            for (const asteroid of asteroids) {
                asteroid.update(delta)
            }

            collisionManger.update([...ships, ...asteroids])
            camera.follow(player.currentShip)
        }
        
        render()
        renderShipThumbnails()

        frame = requestAnimationFrame(tick)
    }

    function toggleMode() {
        if (mode === "flying") {
            mode = "building"
        } else {
            mode = "flying"
        }
    }

    function spawnShips() {
        for (let s = 0; s < shipCount; s++) {
            const controller = new PlayerController(input)
            const grid = new ShipGrid(50, 80, 1)
            const ship = new Ship(
                getRandomVector(1000, 1000),
                new Vector2(0, 0),
                0,
                controller,
                grid
            )

            ships.push(ship)
        }
    }

    function handleGameClick(event: MouseEvent) {
        const position = getPositionFromEvent(event, canvas!, camera)
        ships.forEach((ship) => {
            if (ship.controller instanceof FollowController && position) {
                ship.controller!.setTemporaryTarget(() => position)
            }
        })
    }

    function handleWheel(event: WheelEvent) {
        if (!canvas) return

        event.preventDefault()

        const rect = canvas.getBoundingClientRect()
        const screenX = event.clientX - rect.left
        const screenY = event.clientY - rect.top

        // Trackpad pinch arrives as a wheel event with ctrlKey set - Chrome,
        // Firefox, and Safari all synthesize it this way, so this also
        // distinguishes it from someone actually holding Ctrl and scrolling.
        // It needs its own sensitivity since browsers report much larger
        // deltas for a pinch than for one physical wheel notch.
        const isPinch = event.ctrlKey

        // deltaMode varies by device/browser: 0 = pixels (trackpads, precision
        // mice), 1 = lines (most mouse wheels in Firefox), 2 = pages.
        // Normalize to a pixel-ish scale so zoom speed feels consistent
        // regardless of which one fired.
        const deltaY =
            event.deltaMode === 1 ? event.deltaY * 16 :
            event.deltaMode === 2 ? event.deltaY * canvas.clientHeight :
            event.deltaY

        const sensitivity = isPinch ? 0.01 : 0.0015
        const factor = Math.exp(-deltaY * sensitivity)

        camera.zoomToward(screenX, screenY, canvas.clientWidth, canvas.clientHeight, factor)
    }
 
    onMount(() => {
        if (!canvas) return

        context = canvas.getContext("2d")
        if (!context) return

        resizeCanvas(canvas, context)
        window.addEventListener("wheel", handleWheel, { passive: false })
 
        starMaps?.push(buildStarMap(1000, 1000, 0.2, 4))
        starMaps?.push(buildStarMap(1000, 1000, .05, 7))
        starMaps?.push(buildStarMap(1000, 1000, .006, 12))

        spawnShips()
        asteroids = spawnAsteroidField(asteroidCount, 4000, 4000)

        player = new Player(
            ships,
            controller,
        )

        gridEditor = new GridEditor(player.currentShip.grid)
 
        frame = requestAnimationFrame(tick)
 
        return () => {
            cancelAnimationFrame(frame)
            window.removeEventListener("wheel", handleWheel)
        }
    })
</script>
 
<svelte:window onkeydown={handleKeyDown} onkeyup={handleKeyUp} onresize={() => resizeCanvas(canvas!, context!)}></svelte:window>
 
<div id="overlay" class="crt"></div>
 
<div id="container" >
    <div id="top-bar" class="ui">
        <h1>Space_Game</h1>
        <div id="debug-toggles">
            <button
                class={debugOptions.stats ? "active" : ""}
                onclick={() => toggleDebugOption("stats")}
            >Data</button>
            <button
                class={debugOptions.vectors ? "active" : ""}
                onclick={() => toggleDebugOption("vectors")}
            >Vectors</button>
            <button
                class={debugOptions.hitboxes ? "active" : ""}
                onclick={() => toggleDebugOption("hitboxes")}
            >Hitboxes</button>
        </div>
        <button onclick={toggleMode}>{`Mode = ${mode}`}</button>
    </div>
 
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div id="spacer" onclick={handleGameClick}></div>
 
    <div id="bottom-bar" class="ui">
        <div id="bottom-bar-left">
            {#if activePanel === "ships"}
                <h3 id="bottom-bar-title-bar">Ship Picker</h3>
                <div id="bottom-bar-options">
                    {#each ships as ship, index}
                        <!-- svelte-ignore a11y_consider_explicit_label -->
                        <button
                            class="ship-button"
                            onclick={() => player.setActiveShip(index)}
                        >
                            <canvas
                                bind:this={shipThumbCanvases[index]}
                                width="72"
                                height="72"
                            ></canvas>
                        </button>
                    {/each}
                </div>
            {:else if activePanel === "blocks"}
                <h3 id="bottom-bar-title-bar">Block Picker</h3>
                <div id="bottom-bar-options">
                    {#each BLOCK_MENU as option}
                        <button
                            class={selectedBlockShape === option.shape ? "active" : ""}
                            onclick={() => chooseShape(option.shape)}
                        >
                            {option.label}
                        </button>
                    {/each}
                    <!-- svelte-ignore a11y_consider_explicit_label -->
                    <button
                        class={selectedBlockShape === null ? "active" : ""}
                        onclick={() => chooseShape(null)}
                    >
                        Erase
                    </button>
                </div>
            {/if}
        </div>

        <div id="bottom-bar-right">
            <div id="bottom-bar-selector">
                <button
                    class={activePanel === "blocks" ? "active" : ""}
                    onclick={() => selectPanel("blocks")}
                >Blocks</button>
                <button
                    class={activePanel === "ships" ? "active" : ""}
                    onclick={() => selectPanel("ships")}
                >Ships</button>
                <button disabled>Other</button>
            </div>
        </div>
    </div>
</div>
 
<canvas
    bind:this={canvas}
    id="camera"
></canvas>
 
<style>
    :root {
        background-color: black;
        overflow: hidden;
        overscroll-behavior: none;
        padding: 0;
        color: var(--text-color);
        font-family: 'Courier New', Courier, monospace;
 
        --background: rgb(18, 18, 18);
        --ui-background: rgba(0, 191, 255, 0.3);
        --ui-background-dark: rgba(0, 191, 255, 0.1);
        --text-color: rgb(0, 221, 255, 1);
        --blue: rgba(105, 208, 255, 0.1);
    }
 
    h1, h3 {
        line-height: normal;
        margin: 0;
        padding: 0;
    }
 
    button {
        background-color: var(--ui-background);
        border: solid 3px var(--ui-background);
        border-radius: 10px;
        padding: .5rem 1rem;
        font-family: 'Courier New', Courier, monospace;
        color: var(--text-color);
        font-weight: bold;
        font-size: 18px;
    }
    button:hover {
        background-color: rgba(0, 191, 255, 0.25);
    }
    button:active {
        background-color: rgba(0, 191, 255, 0.05);
    }
 
    button:disabled {
        background-color: rgba(123, 123, 123, 0.3);
        color: rgba(121, 121, 121, 0.8);
        border-color: rgba(121, 121, 121, 0.5);
    }
 
    button.active {
        background-color: rgba(0, 255, 64, 0.3);
        color: rgba(0, 255, 64, 0.8);
        border-color: rgba(0, 255, 64, 0.5);
    }
    button.active:hover {
        background-color: rgba(0, 255, 64, 0.25);
    }
    button.active:active {
        background-color: rgba(0, 255, 64, 0.1);
    }
 
    #camera {
        background-color: black;
        position: absolute;
        top: 0;
        left: 0;
        height: 100vh;
        width: 100vw;
        margin-inline: auto;
        padding: 0;
        z-index: 0;
        pointer-events: none;
    }
 
    .crt {
        background: linear-gradient(to top, rgba(0, 0, 0, 0), rgba(0, 0, 0, 0), rgba(255, 255, 255, 0.05), rgba(255, 255, 255, 0.05));
        background-size: cover;
        background-size: 100% 3px;
        z-index: 1;
        width: 100vw;
        height: 100vh;
        top: 0;
        left: 0;
        position: absolute;
    }
 
    .ui {
        background-color: var(--ui-background);
    }
 
    #container {
        position: absolute;
        height: 100vh;
        width: 100vw;
        top: 0;
        left: 0;
        display: grid;
        grid-template-rows: auto 75vh auto;
        z-index: 1;
        margin: 0;
    }
 
    #spacer {
        height: 100%;
        width: 100%;
    }
 
    #top-bar {
        display: flex;
        padding: 1rem;
        align-items: center;
        justify-content: space-between;
        border-bottom: solid 3px var(--ui-background);
    }

    #debug-toggles {
        display: flex;
        gap: .5rem;
    }
 
    #bottom-bar {
        position: relative;
        display: grid;
        grid-template-columns: 9fr 2fr;
        align-items: center;
        border-top: solid 3px var(--ui-background);
        background: none;
        height: 100%;
    }
    #bottom-bar-left {
        position: relative;
        height: 100%;
        display: grid;
        grid-template-rows: 1fr 4fr;
        min-height: 0;
    }
    #bottom-bar-title-bar {
        border: 1px solid var(--ui-background);
        align-content: center;
        padding: .5rem;
        font-weight: bold;
        background-color: var(--ui-background);
    }
    #bottom-bar-options {
        border: 1px solid var(--ui-background);
        background-color: var(--ui-background-dark);
        display: flex;
        gap: .5rem;
        padding: .5rem;
    }
    #bottom-bar-options button {
        min-width: 100px;
        max-width: 200px;
    }
    #bottom-bar-options button.ship-button {
        display: flex;
        align-items: center;
        justify-content: center;
        padding: .25rem;
        min-width: 0;
        max-width: none;
    }
    #bottom-bar-options button.ship-button canvas {
        display: block;
        background-color: black;
        border-radius: 6px;
    }
    #bottom-bar-right {
        border: 1px solid var(--ui-background);
        background-color: var(--ui-background);
        height: 100%;
    }
    #bottom-bar-selector {
        display: flex;
        flex-direction: column;
        padding: .5rem;
        gap: 10px;
    }
</style>
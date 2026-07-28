App · SVELTE
<script lang="ts">
    import { onMount } from "svelte";
    import { buildStarMap } from "./render";
    import { Vector2, Player, Ship, Camera, type InputState, type DebugOptions, PlayerController, FollowController, CollisionManager } from "./types";
    import { Asteroid, spawnAsteroidField } from "./entities/asteroid";
    import { getRandomVector } from "./helpers";
  import { VERSION } from "svelte/compiler";
 
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
 
    const input: InputState = {
        forward: false,
        left: false,
        backward: false,
        right: false,
        space: false
    }
 
    let frame = 0
    let lastTimestamp = 0
    const motionBlur = $state(0.4)

    const collisionManger = new CollisionManager()

    const shipCount = 5
    let ships: Ship[] = $state([])
    let shipThumbCanvases: (HTMLCanvasElement | null)[] = []
    const asteroidCount = 200
    let asteroids: Asteroid[] = []
 
    const controller = new PlayerController(input)
    let player: Player
 
    const camera = new Camera()
    camera.position = new Vector2(0, 0)
 
    function resizeCanvas() {
        if (!canvas || !context) return;
 
        const rect = canvas.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
 
        const width = Math.round(rect.width * dpr)
        const height = Math.round(rect.height * dpr)
 
        // Resize the backing buffer to match the displayed size
        canvas.width = width;
        canvas.height = height;
 
        // Reset any previous transforms and scale for HiDPI displays
        context.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
 
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
            drawLayerLocally(element, (index + 1) * 0.1)
        });
        context.restore();

        // Draw asteroids, skipping ones that are off-screen
        asteroids.forEach((asteroid) => {
            if (isVisible(asteroid.position.x, asteroid.position.y, asteroid.radius)) {
                asteroid.draw(context!, camera, debugOptions)
            }
        })
 
        // Draw the player
        player.draw(context, camera, debugOptions)
    }
 
    function drawLayerLocally(image: HTMLCanvasElement, parallaxFactor: number) {
        const w = image.width;
        const h = image.height;
 
        const x =
            (-camera.position.x * parallaxFactor) % w;
 
        const y =
            (-camera.position.y * parallaxFactor) % h;
 
        for (let ix = -1; ix <= 1; ix++) {
            for (let iy = -1; iy <= 1; iy++) {
                context?.drawImage(
                    image,
                    x + ix * w,
                    y + iy * h
                );
            }
        }
    }
 
    function isVisible(
        x: number,
        y: number,
        radius: number
    ) {
        if (!canvas) return false
 
        const left = camera.position.x - canvas.clientWidth / 2;
        const right = camera.position.x + canvas.clientWidth / 2;
        const top = camera.position.y - canvas.clientHeight / 2;
        const bottom = camera.position.y + canvas.clientHeight / 2;
 
        return (
            x + radius > left &&
            x - radius < right &&
            y + radius > top &&
            y - radius < bottom
        );
    }

    // Renders a live thumbnail of each ship into its own small canvas in the
    // picker - same rotation, color, and debug overlays as the main view.
    // Reuses Ship.draw() itself rather than reimplementing the ship art: a
    // camera centered exactly on the ship makes Ship.draw() place it
    // dead-center in the thumbnail for free.
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
            const ship = new Ship(
                getRandomVector(1000, 1000),
                getRandomVector(2, 2),
                0
            )

            ships.push(ship)
        }
    }

    function handleGameClick(event: MouseEvent) {
        const position = getPositionFromEvent(event)
        ships.forEach((ship) => {
            if (ship.controller instanceof FollowController && position) {
                ship.controller!.setTemporaryTarget(() => position)
            }
        })
    }

    function getPositionFromEvent(event: MouseEvent) {
        if (!canvas) return

        const rect = canvas.getBoundingClientRect()

        const screenX = event.clientX - rect.left
        const screenY = event.clientY - rect.top

        const x = screenX - canvas.clientWidth / 2 + camera.position.x
        const y = screenY - canvas.clientHeight / 2 + camera.position.y

        return new Vector2(x, y)
    }
 
    onMount(() => {
        if (!canvas) return
        context = canvas.getContext("2d")
        resizeCanvas()
 
        starMaps?.push(buildStarMap(1000, 1000, 0.2, 4))
        starMaps?.push(buildStarMap(1000, 1000, .05, 7))
        starMaps?.push(buildStarMap(1000, 1000, .006, 12))

        spawnShips()
        asteroids = spawnAsteroidField(asteroidCount, 4000, 4000)

        player = new Player(
            ships,
            controller,
        )
 
        frame = requestAnimationFrame(tick)
 
        return () => cancelAnimationFrame(frame)
    })
</script>
 
<svelte:window onkeydown={handleKeyDown} onkeyup={handleKeyUp} onresize={resizeCanvas} /* onscroll={} */></svelte:window>
 
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
 
    <div id="spacer" onclick={handleGameClick}></div>
 
    <div id="bottom-bar" class="ui">
        <div id="bottom-bar-left">
            <h3 id="bottom-bar-title-bar">Ship Picker</h3>
            <div id="bottom-bar-options">
                {#each ships as ship, index}
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
        </div>
        <div id="bottom-bar-right">
            <div id="bottom-bar-selector">
                <button>Blocks</button>
                <button class="active">Ships</button>
                <button>Other</button>
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
 
    h1, h2, h3, h4, h5, h6 {
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
 
    button.disabled {
        background-color: rgba(123, 123, 123, 0.3);
        color: rgba(194, 194, 194, 0.8);
    }
 
    button.active {
        background-color: rgba(0, 255, 64, 0.3);
        color: rgba(0, 255, 64, 0.8)
    }
    button.active:hover {
        background-color: rgba(0, 255, 64, 0.25);
    }
    button.active:active {
        background-color: rgba(0, 255, 64, 0.05);
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
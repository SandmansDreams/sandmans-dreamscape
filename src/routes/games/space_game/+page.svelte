App · SVELTE
<script lang="ts">
    import { onMount } from "svelte";
    import { buildStarMap, drawLayerLocally } from "./background";
    import { Asteroid, spawnAsteroidField } from "./entities/asteroid";
    import { CELL_SIZE, getPositionFromEvent, getRandomVector, isVisible, resizeCanvas } from "./helpers";
    import { Camera, Player, type DebugOptions } from "./types";
    import { EmptyController, FollowController, NEUTRAL_INPUT, PlayerController, type InputState } from "./controller";
    import { CollisionManager, Vector2 } from "./physics";
    import { Ship } from "./entities/ship";
    import { Grid, type BlockShape } from "./grid";
    import { GridEditor } from "./grid-editor";
    import { LightSource, computeGridLight, type GridLightInfo } from "./lighting";
    import { Particle } from "./particle";
    import { Turret } from "./placements";
    import { spawnScouter } from "./entities/enemy";

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

    let activePanel = $state<"blocks" | "ships" | "placements">("ships")

    function selectPanel(panel: typeof activePanel) {
        activePanel = panel
        if (gridEditor) {
            gridEditor.editorMode = panel === "placements" ? "placements" : "blocks"
        }
    }

    let hslH = $state(0)
    let hslS = $state(0)
    let hslL = $state(50)
    let buildZoom = $state(6)
    let savedCameraState: { position: Vector2, zoom: number } | null = null

    type CameraTransition = {
        fromPos: Vector2
        toPos: Vector2
        fromZoom: number
        toZoom: number
        progress: number
        onComplete: () => void
    }
    let cameraTransition: CameraTransition | null = null
    const transitionSpeed = 0.04

    function hslColor(): string {
        return `hsl(${hslH}, ${hslS}%, ${hslL}%)`
    }

    function syncEditorColor() {
        gridEditor?.selectColor(hslColor())
    }

    let savedLayouts = $state<{ name: string, data: object }[]>([])
    let layoutName = $state("my-ship")
    let fileInput = $state<HTMLInputElement | null>(null)

    function saveLayout() {
        if (!player) return
        const data = player.currentShip.grid.serialize()
        const json = JSON.stringify(data, null, 2)
        const blob = new Blob([json], { type: "application/json" })
        const url = URL.createObjectURL(blob)
        const a = document.createElement("a")
        a.href = url
        a.download = `${layoutName || "ship"}.json`
        a.click()
        URL.revokeObjectURL(url)
    }

    function loadLayout() {
        fileInput?.click()
    }

    function handleFileLoad(event: Event) {
        const input = event.target as HTMLInputElement
        const file = input.files?.[0]
        if (!file) return

        const reader = new FileReader()
        reader.onload = () => {
            try {
                const data = JSON.parse(reader.result as string)
                player.currentShip.grid.loadFrom(data)
                player.currentShip.updateCollider()
            } catch (e) {
                console.error("Failed to load layout:", e)
            }
        }
        reader.readAsText(file)
        input.value = ""
    }

    function drawShapePreview(canvas: HTMLCanvasElement, shape: BlockShape) {
        const ctx = canvas.getContext("2d")
        if (!ctx) return
        const s = canvas.width
        const m = 2
        const sz = s - m * 2
        ctx.clearRect(0, 0, s, s)
        ctx.fillStyle = "rgba(105, 208, 255, 0.6)"

        if (shape === "full") {
            ctx.fillRect(m, m, sz, sz)
        } else if (shape.startsWith("arc")) {
            const arcs: Record<string, [number, number, number, number]> = {
                arcNW: [m, m, 0, Math.PI / 2],
                arcNE: [s - m, m, Math.PI / 2, Math.PI],
                arcSE: [s - m, s - m, Math.PI, Math.PI * 1.5],
                arcSW: [m, s - m, Math.PI * 1.5, Math.PI * 2],
            }
            const [cx, cy, start, end] = arcs[shape]
            ctx.beginPath()
            ctx.moveTo(cx, cy)
            ctx.arc(cx, cy, sz, start, end)
            ctx.closePath()
            ctx.fill()
        } else if (shape.startsWith("tri")) {
            const corners: Record<string, [number, number][]> = {
                triNW: [[m, m], [s - m, m], [m, s - m]],
                triNE: [[s - m, m], [m, m], [s - m, s - m]],
                triSW: [[m, s - m], [m, m], [s - m, s - m]],
                triSE: [[s - m, s - m], [s - m, m], [m, s - m]]
            }
            const pts = corners[shape]
            if (pts) {
                ctx.beginPath()
                ctx.moveTo(pts[0][0], pts[0][1])
                ctx.lineTo(pts[1][0], pts[1][1])
                ctx.lineTo(pts[2][0], pts[2][1])
                ctx.closePath()
                ctx.fill()
            }
        }

        ctx.strokeStyle = "rgba(105, 208, 255, 0.3)"
        ctx.strokeRect(m, m, sz, sz)
    }

    function drawTurretPreview(canvas: HTMLCanvasElement) {
        const ctx = canvas.getContext("2d")
        if (!ctx) return
        const s = canvas.width
        ctx.clearRect(0, 0, s, s)
        const cx = s / 2
        const cy = s / 2
        const radius = s * 0.3

        ctx.fillStyle = "#555"
        ctx.beginPath()
        ctx.arc(cx, cy, radius, 0, Math.PI * 2)
        ctx.fill()

        ctx.fillStyle = "#888"
        const barrelW = s * 0.1
        const barrelH = s * 0.35
        ctx.fillRect(cx - barrelW / 2, cy - radius - barrelH + radius * 0.3, barrelW, barrelH)
    }
 
    const input: InputState = { ...NEUTRAL_INPUT }
 
    let frame = 0
    let lastTimestamp = 0
    const motionBlur = $state(1)

    const collisionManger = new CollisionManager()

    const shipCount = 1
    const scouterCount = 20
    let ships = $state<Ship[]>([])
    let shipThumbCanvases = $state<HTMLCanvasElement[] | null[]>([])
    const asteroidCount = 200
    let asteroids: Asteroid[] = []
    let particles: Particle[] = []
    let enemies: Ship[] = []

    let lightingEnabled = $state(true)
    const sun = new LightSource(new Vector2(5000, -4000), "#fffbe6", 1.0, 120)
    const lights: LightSource[] = [sun]

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

            case "r":
                if (mode === "building" && gridEditor?.canRotate) {
                    gridEditor.rotate()
                }
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

        if (mode === "building") {
            context.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight)
        } else {
            context.fillStyle = `rgba(0,0,0,${motionBlur})`
            context.fillRect(0, 0, canvas.clientWidth, canvas.clientHeight)
        }

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

        if (lightingEnabled) {
            for (const light of lights) {
                light.draw(context, camera)
            }
        }

        asteroids.forEach((asteroid) => {
            if (isVisible(asteroid.position.x, asteroid.position.y, asteroid.radius, canvas!, camera)) {
                const asteroidLight = lightingEnabled
                    ? computeGridLight(asteroid.position, asteroid.rotation, lights[0])
                    : undefined
                asteroid.draw(context!, camera, debugOptions, asteroidLight)
            }
        })

        let shipLightInfos: Map<Ship, GridLightInfo> | undefined
        if (lightingEnabled) {
            shipLightInfos = new Map()
            for (const ship of ships) {
                shipLightInfos.set(ship, computeGridLight(ship.position, ship.rotation, lights[0], Math.PI / 2))
            }
            for (const enemy of enemies) {
                shipLightInfos.set(enemy, computeGridLight(enemy.position, enemy.rotation, lights[0], Math.PI / 2))
            }
        }
        player.draw(context, camera, debugOptions, shipLightInfos)

        // Draw enemies
        for (const enemy of enemies) {
            enemy.draw(context, camera, debugOptions, shipLightInfos?.get(enemy))
        }

        // Draw particles
        for (const p of particles) {
            p.draw(context, camera)
        }
    }

    function renderBuildView() {
        if (!context || !canvas) return;

        const grid = player.currentShip.grid
        const center = grid.getCenter()

        context.save()

        context.translate(canvas.clientWidth / 2, canvas.clientHeight / 2)
        context.scale(buildZoom, buildZoom)
        context.translate(-center.x, -center.y)

        grid.draw(context, 1, true)

        grid.forEachFilled((cell) => {
            if (!cell.placement) return
            const px = cell.position.column * CELL_SIZE
            const py = cell.position.row * CELL_SIZE
            cell.placement.draw(context!, px, py, CELL_SIZE)
        })

        if (gridEditor?.hoveredCell) {
            const col = gridEditor.hoveredCell.position.column
            const row = gridEditor.hoveredCell.position.row

            if (gridEditor.editorMode === "blocks") {
                const shape = gridEditor.resolvedShape
                if (shape) {
                    grid.drawGhostBlock(context, col, row, shape, gridEditor.selectedColor)
                } else {
                    const hx = col * CELL_SIZE
                    const hy = row * CELL_SIZE
                    context.save()
                    context.globalAlpha = 0.3
                    context.fillStyle = "#ff4444"
                    context.fillRect(hx, hy, CELL_SIZE, CELL_SIZE)
                    context.restore()
                }
            } else if (gridEditor.editorMode === "placements") {
                if (gridEditor.hoveredCell.shape !== "empty") {
                    const hx = col * CELL_SIZE
                    const hy = row * CELL_SIZE
                    context.save()
                    if (gridEditor.selectedPlacementType) {
                        context.globalAlpha = 0.35
                        const cx = hx + CELL_SIZE / 2
                        const cy = hy + CELL_SIZE / 2
                        context.fillStyle = "#555"
                        context.beginPath()
                        context.arc(cx, cy, CELL_SIZE * 0.4, 0, Math.PI * 2)
                        context.fill()
                        context.fillStyle = "#888"
                        context.fillRect(cx - CELL_SIZE * 0.06, cy - CELL_SIZE * 0.5, CELL_SIZE * 0.12, CELL_SIZE * 0.4)
                    } else if (gridEditor.hoveredCell.placement) {
                        context.globalAlpha = 0.4
                        context.fillStyle = "#ff4444"
                        context.fillRect(hx, hy, CELL_SIZE, CELL_SIZE)
                    }
                    context.restore()
                }
            }
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
 
        updateCameraTransition(delta)

        if (mode === "flying") {
            const newParticles = player.update(delta, enemies)
            particles.push(...newParticles)

            for (const enemy of enemies) {
                enemy.update(delta)
            }

            for (const asteroid of asteroids) {
                asteroid.update(delta)
            }

            // Update particles and check hits
            for (const p of particles) {
                p.update(delta)
                if (p.dead) continue

                for (const asteroid of asteroids) {
                    const dx = p.position.x - asteroid.position.x
                    const dy = p.position.y - asteroid.position.y
                    if (Math.hypot(dx, dy) < asteroid.radius) {
                        asteroid.takeDamage(p.damage)
                        p.dead = true
                        break
                    }
                }
                if (p.dead) continue

                for (const enemy of enemies) {
                    const radius = enemy.grid.getBoundingRadius()
                    const dx = p.position.x - enemy.position.x
                    const dy = p.position.y - enemy.position.y
                    if (Math.hypot(dx, dy) < radius) {
                        enemy.currentHealth -= p.damage
                        p.dead = true
                        break
                    }
                }
            }

            // Remove dead particles
            particles = particles.filter(p => !p.dead)

            // Remove dead enemies
            enemies = enemies.filter(e => e.currentHealth > 0)

            // Handle dead asteroids — split them
            const newAsteroids: Asteroid[] = []
            asteroids = asteroids.filter(a => {
                if (a.dead) {
                    newAsteroids.push(...a.split())
                    return false
                }
                return true
            })
            asteroids.push(...newAsteroids)

            collisionManger.update([...ships, ...enemies, ...asteroids])
            if (!cameraTransition) {
                camera.follow(player.currentShip)
            }
        }

        render()
        renderShipThumbnails()

        frame = requestAnimationFrame(tick)
    }

    function easeInOut(t: number): number {
        return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
    }

    function toggleMode() {
        if (cameraTransition) return

        if (mode === "flying") {
            savedCameraState = {
                position: camera.position.clone(),
                zoom: camera.zoom
            }
            mode = "building"
            activePanel = "blocks"
            gridEditor = new GridEditor(player.currentShip.grid)
            gridEditor.selectColor(hslColor())
        } else {
            const restorePos = savedCameraState?.position ?? camera.position.clone()
            const restoreZoom = savedCameraState?.zoom ?? camera.zoom
            player.currentShip.updateCollider()
            mode = "flying"
            activePanel = "ships"
            cameraTransition = {
                fromPos: player.currentShip.position.clone(),
                toPos: restorePos,
                fromZoom: camera.zoom,
                toZoom: restoreZoom,
                progress: 0,
                onComplete: () => { savedCameraState = null }
            }
        }
    }

    function updateCameraTransition(delta: number) {
        if (!cameraTransition) return

        cameraTransition.progress = Math.min(cameraTransition.progress + transitionSpeed * delta, 1)
        const t = easeInOut(cameraTransition.progress)

        camera.position.x = cameraTransition.fromPos.x + (cameraTransition.toPos.x - cameraTransition.fromPos.x) * t
        camera.position.y = cameraTransition.fromPos.y + (cameraTransition.toPos.y - cameraTransition.fromPos.y) * t
        camera.zoom = cameraTransition.fromZoom + (cameraTransition.toZoom - cameraTransition.fromZoom) * t

        if (cameraTransition.progress >= 1) {
            cameraTransition.onComplete()
            cameraTransition = null
        }
    }

    function spawnShips() {
        for (let s = 0; s < shipCount; s++) {
            const grid = new Grid()
            grid.paintTestShape()

            // Add turrets to the wing tips
            const turretCells = [
                grid.getCell(2, 5),
                grid.getCell(7, 5),
            ]
            for (const cell of turretCells) {
                const turret = new Turret()
                cell.placement = turret
                grid.setCell(cell, cell.shape, cell.color, turret)
            }

            const ship = new Ship(
                getRandomVector(1000, 1000),
                new Vector2(0, 0),
                0,
                new EmptyController(),
                grid
            )

            ships.push(ship)
        }
    }

    function spawnScouters() {
        for (let s = 0; s < scouterCount; s++) {
            const scouter = spawnScouter(
                getRandomVector(1000, 1000),
                player.currentShip
            )
            enemies.push(scouter)
        }
    }


    function screenToGrid(screenX: number, screenY: number): [number, number] {
        const grid = player.currentShip.grid
        const center = grid.getCenter()
        const gridX = (screenX - canvas!.clientWidth / 2) / buildZoom + center.x
        const gridY = (screenY - canvas!.clientHeight / 2) / buildZoom + center.y
        return [gridX, gridY]
    }

    function handleSpacerClick(event: MouseEvent) {
        if (mode === "building") {
            const [gridX, gridY] = screenToGrid(event.clientX, event.clientY)
            gridEditor.handleClick(gridX, gridY)
        } else {
            const position = getPositionFromEvent(event, canvas!, camera)
            ships.forEach((ship) => {
                if (ship.controller instanceof FollowController && position) {
                    ship.controller!.setTemporaryTarget(() => position)
                }
            })
        }
    }

    function handleSpacerMouseMove(event: MouseEvent) {
        if (mode !== "building" || !canvas) return
        const [gridX, gridY] = screenToGrid(event.clientX, event.clientY)
        gridEditor.handleMouseMove(gridX, gridY)
    }

    function handleSpacerMouseLeave() {
        if (mode === "building") {
            gridEditor.handleMouseLeave()
        }
    }

    function handleWheel(event: WheelEvent) {
        if (!canvas) return

        event.preventDefault()

        const rect = canvas.getBoundingClientRect()
        const screenX = event.clientX - rect.left
        const screenY = event.clientY - rect.top

        const isPinch = event.ctrlKey

        const deltaY =
            event.deltaMode === 1 ? event.deltaY * 16 :
            event.deltaMode === 2 ? event.deltaY * canvas.clientHeight :
            event.deltaY

        const sensitivity = isPinch ? 0.01 : 0.0015
        const factor = Math.exp(-deltaY * sensitivity)

        if (mode === "building") {
            buildZoom = Math.min(Math.max(buildZoom * factor, 5), 80)
        } else {
            camera.zoomToward(screenX, screenY, canvas.clientWidth, canvas.clientHeight, factor)
        }
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
        
        player = new Player(
            ships,
            controller,
        )
        
        gridEditor = new GridEditor(player.currentShip.grid)
        gridEditor.selectColor(hslColor())
        
        spawnScouters()
        asteroids = spawnAsteroidField(asteroidCount, 4000, 4000)
        
 
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
            <button
                class={lightingEnabled ? "active" : ""}
                onclick={() => lightingEnabled = !lightingEnabled}
            >Lighting</button>
        </div>
        <button onclick={toggleMode}>{`Mode = ${mode}`}</button>
    </div>
 
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div id="spacer"
        onclick={handleSpacerClick}
        onmousemove={handleSpacerMouseMove}
        onmouseleave={handleSpacerMouseLeave}
    >
        {#if mode === "building"}
            <div id="build-sidebar">
                <h3>Layouts</h3>
                <div class="sidebar-field">
                    <label for="layout-name">Name</label>
                    <input
                        id="layout-name"
                        type="text"
                        bind:value={layoutName}
                    />
                </div>
                <button onclick={saveLayout}>Save to File</button>
                <button onclick={loadLayout}>Load from File</button>
                <input
                    type="file"
                    accept=".json"
                    style="display:none"
                    bind:this={fileInput}
                    onchange={handleFileLoad}
                />
            </div>
        {/if}
    </div>
 
    <div id="bottom-bar" class="ui">
        <div id="bottom-bar-left">
            {#if activePanel === "ships"}
                <h3 id="bottom-bar-title-bar">Fleet</h3>
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
                <h3 id="bottom-bar-title-bar">Hull Editor</h3>
                <div id="bottom-bar-options">
                    <div class="hsl-picker">
                        <label>H <input type="range" min="0" max="360" bind:value={hslH} oninput={syncEditorColor} /><span>{hslH}</span></label>
                        <label>S <input type="range" min="0" max="100" bind:value={hslS} oninput={syncEditorColor} /><span>{hslS}%</span></label>
                        <label>L <input type="range" min="0" max="100" bind:value={hslL} oninput={syncEditorColor} /><span>{hslL}%</span></label>
                        <div class="hsl-swatch" style="background: {hslColor()}"></div>
                    </div>
                    {#each [
                        { base: "full", label: "Full", preview: "full" as BlockShape },
                        { base: "wedge", label: "Wedge", preview: (gridEditor?.baseShape === "wedge" ? gridEditor.resolvedShape : "triNW") as BlockShape },
                        { base: "arc", label: "Arc", preview: (gridEditor?.baseShape === "arc" ? gridEditor.resolvedShape : "arcNW") as BlockShape },
                        { base: "empty", label: "Erase", preview: null }
                    ] as option}
                        <button
                            class={gridEditor?.baseShape === option.base ? "active" : ""}
                            onclick={() => gridEditor?.selectBaseShape(option.base as "full" | "wedge" | "arc" | "empty")}
                        >
                            {#if option.preview}
                                <canvas
                                    width="24" height="24"
                                    class="block-preview"
                                    use:drawShapePreview={option.preview}
                                ></canvas>
                            {/if}
                            {option.label}
                            {#if (option.base === "wedge" || option.base === "arc") && gridEditor?.baseShape === option.base}
                                <span class="rotate-hint">[R]</span>
                            {/if}
                        </button>
                    {/each}
                </div>
            {:else if activePanel === "placements"}
                <h3 id="bottom-bar-title-bar">Modules</h3>
                <div id="bottom-bar-options">
                    <button
                        class={gridEditor?.selectedPlacementType === "turret" ? "active" : ""}
                        onclick={() => { if (gridEditor) gridEditor.selectedPlacementType = gridEditor.selectedPlacementType === "turret" ? null : "turret" }}
                    >
                        <canvas
                            width="32" height="32"
                            class="block-preview"
                            use:drawTurretPreview
                        ></canvas>
                        Turret
                    </button>
                </div>
            {/if}
        </div>

        <div id="bottom-bar-right">
            <div id="bottom-bar-selector">
                {#if mode === "building"}
                    <button
                        class={activePanel === "blocks" ? "active" : ""}
                        onclick={() => selectPanel("blocks")}
                    >Blocks</button>
                    <button
                        class={activePanel === "placements" ? "active" : ""}
                        onclick={() => selectPanel("placements")}
                    >Placements</button>
                {:else}
                    <button
                        class={activePanel === "ships" ? "active" : ""}
                        onclick={() => selectPanel("ships")}
                    >Ships</button>
                {/if}
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
        image-rendering: pixelated; 
        image-rendering: crisp-edges;
    }
 
    .crt {
        background: linear-gradient(to top, rgba(0, 0, 0, 0), rgba(0, 0, 0, 0), rgba(255, 255, 255, 0.05), rgba(255, 255, 255, 0.05));
        background-size: cover;
        background-size: 100% 4px;
        z-index: 2;
        width: 100vw;
        height: 100vh;
        top: 0;
        left: 0;
        position: absolute;
        pointer-events: none;
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
        grid-template-rows: auto 1fr auto;
        z-index: 1;
        margin: 0;
        overflow: hidden;
    }
 
    #spacer {
        height: 100%;
        width: 100%;
        position: relative;
    }

    #build-sidebar {
        position: absolute;
        top: 50%;
        right: 2%;
        width: 200px;
        height: 90%;
        background-color: rgba(0, 10, 20, 0.85);
        border: 2px solid var(--ui-background);
        padding: .75rem;
        display: flex;
        flex-direction: column;
        gap: .5rem;
        z-index: 3;
        pointer-events: auto;
        transform: translateY(-50%)
    }
    #build-sidebar h3 {
        margin-bottom: .25rem;
    }
    #build-sidebar button {
        width: 100%;
        font-size: 14px;
        padding: .4rem .5rem;
    }
    .sidebar-field {
        display: flex;
        flex-direction: column;
        gap: 4px;
    }
    .sidebar-field label {
        font-size: 12px;
        opacity: 0.7;
    }
    .sidebar-field input[type="text"] {
        background: rgba(0, 191, 255, 0.1);
        border: 1px solid var(--ui-background);
        border-radius: 6px;
        padding: .3rem .5rem;
        color: var(--text-color);
        font-family: 'Courier New', Courier, monospace;
        font-size: 14px;
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
        min-width: 0;
        overflow: hidden;
    }
    #bottom-bar-title-bar {
        border: 1px solid var(--ui-background);
        align-content: center;
        padding: .5rem;
        font-weight: bold;
        background-color: var(--ui-background);
        display: flex;
        align-items: center;
        gap: .75rem;
    }
    .hsl-picker {
        display: flex;
        flex-direction: column;
        gap: 4px;
        min-width: 160px;
        padding: 4px 0;
    }
    .hsl-picker label {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 12px;
        white-space: nowrap;
    }
    .hsl-picker input[type="range"] {
        flex: 1;
        accent-color: var(--text-color);
        height: 4px;
    }
    .hsl-picker span {
        min-width: 36px;
        text-align: right;
        font-size: 11px;
        opacity: 0.7;
    }
    .hsl-swatch {
        width: 100%;
        height: 16px;
        border-radius: 4px;
        border: 1px solid var(--ui-background);
        margin-top: 2px;
    }
    .rotate-hint {
        font-size: 10px;
        opacity: 0.6;
    }
    .block-preview {
        display: block;
        margin-bottom: 2px;
    }
    #bottom-bar-options {
        border: 1px solid var(--ui-background);
        background-color: var(--ui-background-dark);
        display: flex;
        gap: .5rem;
        padding: .5rem;
        overflow-x: auto;
    }
    #bottom-bar-options button {
        min-width: 100px;
        max-width: 200px;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 4px;
    }
    #bottom-bar-options button.ship-button {
        display: flex;
        align-items: center;
        justify-content: center;
        padding: .25rem;
        min-width: 80px;
        flex-shrink: 0;
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
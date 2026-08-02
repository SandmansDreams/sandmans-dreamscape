<script lang="ts">
    import { onMount } from "svelte";
    import { CELL_SIZE, getPositionFromEvent, resizeCanvas } from "./helpers";
    import { Camera, NO_DEBUG, type DebugOptions } from "./types";
    import { FollowController, NEUTRAL_INPUT, PlayerController, type InputState } from "./controller";
    import type { Ship } from "./entities/ship";
    import { fillBlockShape, type BlockShape } from "./shapes";
    import { GridEditor, type BaseShape, type PlacementTool } from "./grid-editor";
    import { Spike, Thruster, Turret, type Placement } from "./placements";
    import { World } from "./world";

    let canvas = $state<HTMLCanvasElement | null>(null)

    // Imperative-only; nothing in the template reads these, so keeping them out
    // of $state avoids pointless reactivity on hot objects.
    let context: CanvasRenderingContext2D | null = null
    let frame = 0
    let lastTimestamp = 0

    const world = new World()

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

    let lightingEnabled = $state(true)

    function toggleLighting() {
        lightingEnabled = !lightingEnabled
        world.lighting.enabled = lightingEnabled
    }

    let activePanel = $state<"blocks" | "ships" | "placements">("ships")

    let gridEditor: GridEditor | null = null

    /**
     * Editor state mirrored into the component.
     *
     * $state does not deep-proxy class instances, so mutating a field on
     * GridEditor never re-renders — only reassigning the variable would. The
     * template reads these copies instead, and every path that touches the
     * editor calls syncFromEditor().
     */
    let activeBaseShape = $state<BaseShape>("full")
    let activeShape = $state<BlockShape | null>("full")

    function selectPanel(panel: typeof activePanel) {
        activePanel = panel
        if (gridEditor) {
            gridEditor.editorMode = panel === "placements" ? "placements" : "blocks"
        }
    }

    /** Colour applied to new hull cells and new modules. */
    let buildColor = $state("#808080")
    let buildZoom = $state(6)

    let fleet = $state<Ship[]>([])
    let shipThumbCanvases = $state<(HTMLCanvasElement | null)[]>([])

    let selectedPlacementType = $state<PlacementTool | null>(null)
    let selectedPlacement = $state<Placement | null>(null)

    // Alpha of the per-frame clear. Below 1 the previous frame bleeds through,
    // leaving motion trails.
    const MOTION_BLUR = 1

    const input: InputState = { ...NEUTRAL_INPUT }
    const controller = new PlayerController(input)

    // Reused for every module button preview, so the template isn't
    // constructing throwaway placements on each render.
    const PREVIEW_MODULES = {
        turret: new Turret(),
        thruster: new Thruster(),
        spike: new Spike()
    }

    // --- Camera transition between build and fly ---------------------------

    let savedCameraState: { position: { x: number, y: number }, zoom: number } | null = null

    type CameraTarget = { x: number, y: number, rotation: number }

    type CameraTransition = {
        fromX: number, fromY: number
        toX: number, toY: number
        fromZoom: number, toZoom: number
        fromRotation: number, toRotation: number
        progress: number
        /**
         * Re-read every frame to chase a moving destination. The ship keeps
         * flying and turning while the camera closes on it, so a destination
         * snapshotted at click time would land where the ship used to be.
         */
        track: (() => CameraTarget) | null
        onComplete: () => void
    }
    let cameraTransition: CameraTransition | null = null
    const transitionSpeed = 0.04

    function syncEditorColor() {
        gridEditor?.selectColor(buildColor)
    }

    // --- Layout save / load -------------------------------------------------

    let layoutName = $state("my-ship")
    let fileInput = $state<HTMLInputElement | null>(null)

    function saveLayout() {
        const json = JSON.stringify(world.player.currentShip.grid.serialize(), null, 2)
        const url = URL.createObjectURL(new Blob([json], { type: "application/json" }))

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
                const ship = world.player.currentShip
                ship.grid.loadFrom(JSON.parse(reader.result as string))
                ship.updateCollider()
                // The editor caches nothing, but its hover target may point at
                // a cell that no longer exists.
                gridEditor?.handleMouseLeave()
            } catch (e) {
                console.error("Failed to load layout:", e)
            }
        }
        reader.readAsText(file)
        input.value = ""
    }

    // --- Canvas previews ----------------------------------------------------

    // Both previews return an update handler: without one the canvas is painted
    // once at mount and never again, so rotating a wedge or picking a new
    // colour left the button showing a stale image.

    function drawShapePreview(canvas: HTMLCanvasElement, shape: BlockShape) {
        const paint = (current: BlockShape) => {
            const ctx = canvas.getContext("2d")
            if (!ctx) return

            const size = canvas.width
            const margin = 2
            const inner = size - margin * 2

            ctx.clearRect(0, 0, size, size)
            ctx.fillStyle = "rgba(105, 208, 255, 0.6)"
            fillBlockShape(ctx, current, margin, margin, inner)

            ctx.strokeStyle = "rgba(105, 208, 255, 0.3)"
            ctx.strokeRect(margin, margin, inner, inner)
        }

        paint(shape)
        return { update: paint }
    }

    type PlacementPreview = { placement: Placement, color?: string }

    function drawPlacementPreview(canvas: HTMLCanvasElement, preview: PlacementPreview) {
        const paint = (current: PlacementPreview) => {
            const ctx = canvas.getContext("2d")
            if (!ctx) return

            // The module palette previews the colour you're about to build with;
            // the details panel shows the module's own colour instead.
            if (current.color) current.placement.color = current.color

            ctx.clearRect(0, 0, canvas.width, canvas.height)
            current.placement.draw(ctx, 0, 0, canvas.width)
        }

        paint(preview)
        return { update: paint }
    }

    // --- Input --------------------------------------------------------------

    const KEY_BINDINGS: Record<string, keyof InputState> = {
        "w": "forward", "arrowup": "forward",
        "a": "left", "arrowleft": "left",
        "s": "backward", "arrowdown": "backward",
        "d": "right", "arrowright": "right",
        " ": "space"
    }

    function handleKeyDown(event: KeyboardEvent) {
        const key = event.key.toLowerCase()

        const binding = KEY_BINDINGS[key]
        if (binding) {
            input[binding] = true
            return
        }

        if (key === "r" && mode === "building" && gridEditor?.canRotate) {
            rotateTool()
        }
    }

    function handleKeyUp(event: KeyboardEvent) {
        const binding = KEY_BINDINGS[event.key.toLowerCase()]
        if (binding) input[binding] = false
    }

    // --- Rendering ----------------------------------------------------------

    function render() {
        if (!context || !canvas) return;

        const width = canvas.clientWidth
        const height = canvas.clientHeight

        if (mode === "building") {
            context.clearRect(0, 0, width, height)
        } else {
            context.fillStyle = `rgba(0,0,0,${MOTION_BLUR})`
            context.fillRect(0, 0, width, height)
        }

        context.save()

        const rotation = world.camera.rotation
        if (rotation !== 0) {
            context.translate(width / 2, height / 2)
            context.rotate(-rotation)
            context.translate(-width / 2, -height / 2)
        }

        world.drawBackground(context)

        if (mode === "flying") {
            world.draw(context, canvas, debugOptions)
        } else {
            renderBuildView()
        }

        context.restore()
    }

    function renderBuildView() {
        if (!context || !canvas || !gridEditor) return;

        const grid = world.player.currentShip.grid
        const center = grid.getCenter()

        context.save()

        context.translate(canvas.clientWidth / 2, canvas.clientHeight / 2)
        context.scale(buildZoom, buildZoom)
        context.translate(-center.x, -center.y)

        grid.draw(context, 1, true)

        for (const cell of grid.placedCells) {
            cell.placement!.draw(
                context,
                cell.position.column * CELL_SIZE,
                cell.position.row * CELL_SIZE,
                CELL_SIZE
            )
        }

        drawEditorGhost(context, gridEditor)

        context.restore()
    }

    function drawEditorGhost(ctx: CanvasRenderingContext2D, editor: GridEditor) {
        const hovered = editor.hoveredCell
        if (!hovered) return

        const grid = world.player.currentShip.grid
        const col = hovered.position.column
        const row = hovered.position.row
        const x = col * CELL_SIZE
        const y = row * CELL_SIZE

        if (editor.editorMode === "blocks") {
            const shape = editor.resolvedShape
            if (shape) {
                grid.drawGhostBlock(ctx, col, row, shape, editor.selectedColor)
                return
            }

            // Erase tool: mark the cell for removal.
            ctx.save()
            ctx.globalAlpha = 0.3
            ctx.fillStyle = "#ff4444"
            ctx.fillRect(x, y, CELL_SIZE, CELL_SIZE)
            ctx.restore()
            return
        }

        // Spikes mount into empty cells beside the hull; everything else needs
        // hull under it.
        if (!editor.canApplyToolAt(hovered)) return

        ctx.save()

        const ghost = editor.ghostPlacement
        if (ghost) {
            ctx.globalAlpha = 0.35
            // Outline the cell for a free-standing mount, so it reads as
            // occupying that square rather than floating.
            if (hovered.shape === "empty") {
                ctx.strokeStyle = editor.selectedColor
                ctx.lineWidth = 0.3
                ctx.strokeRect(x + 0.15, y + 0.15, CELL_SIZE - 0.3, CELL_SIZE - 0.3)
            }
            ghost.draw(ctx, x, y, CELL_SIZE)
        } else if (editor.selectedPlacementType === "erase") {
            if (hovered.placement) {
                ctx.globalAlpha = 0.4
                ctx.fillStyle = "#ff4444"
                ctx.fillRect(x, y, CELL_SIZE, CELL_SIZE)
            }
        } else if (hovered.placement) {
            // No tool selected: outline the module that a click would inspect.
            ctx.globalAlpha = 0.3
            ctx.strokeStyle = "#44aaff"
            ctx.lineWidth = 0.3
            ctx.strokeRect(x + 0.15, y + 0.15, CELL_SIZE - 0.3, CELL_SIZE - 0.3)
        }

        ctx.restore()
    }

    // Thumbnails only change when a hull is edited, and they are only visible
    // on the fleet panel — rendering all of them every frame was pure waste.
    const THUMBNAIL_INTERVAL_MS = 200
    let lastThumbnailAt = 0
    const thumbCamera = new Camera()

    function renderShipThumbnails(timestamp: number) {
        if (mode !== "flying" || activePanel !== "ships") return
        if (timestamp - lastThumbnailAt < THUMBNAIL_INTERVAL_MS) return
        lastThumbnailAt = timestamp

        for (let i = 0; i < fleet.length; i++) {
            const thumbCanvas = shipThumbCanvases[i]
            if (!thumbCanvas) continue

            const thumbCtx = thumbCanvas.getContext("2d")
            if (!thumbCtx) continue

            const ship = fleet[i]
            thumbCtx.clearRect(0, 0, thumbCanvas.width, thumbCanvas.height)

            thumbCamera.position.x = ship.position.x
            thumbCamera.position.y = ship.position.y
            ship.draw(thumbCtx, thumbCamera, NO_DEBUG)
        }
    }

    // --- Main loop ----------------------------------------------------------

    /**
     * Longest frame the simulation will step in one go. Without this, a
     * backgrounded tab resumes with a multi-second delta and everything
     * tunnels through everything else.
     */
    const MAX_FRAME_MS = 100

    function tick(timestamp: number) {
        if (!lastTimestamp) lastTimestamp = timestamp

        // delta === 1 at a steady 60fps.
        const deltaMs = Math.min(timestamp - lastTimestamp, MAX_FRAME_MS)
        const delta = deltaMs / (1000 / 60)
        lastTimestamp = timestamp

        updateCameraTransition(delta)

        if (mode === "flying") {
            world.update(delta, cameraTransition === null)
        }

        render()
        renderShipThumbnails(timestamp)

        frame = requestAnimationFrame(tick)
    }

    function easeInOut(t: number): number {
        return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
    }

    function toggleMode() {
        if (cameraTransition) return

        const camera = world.camera
        const ship = world.player.currentShip

        // Build view looks down the ship's nose, so the camera rolls to match
        // the hull's heading on the way in and back to level on the way out.
        const shipRotation = ship.rotation + Math.PI / 2

        if (mode === "flying") {
            savedCameraState = {
                position: { x: camera.position.x, y: camera.position.y },
                zoom: camera.zoom
            }

            cameraTransition = {
                fromX: camera.position.x, fromY: camera.position.y,
                toX: ship.position.x, toY: ship.position.y,
                fromZoom: camera.zoom, toZoom: buildZoom,
                fromRotation: 0, toRotation: shipRotation,
                progress: 0,
                // The ship is still under way, so follow it in.
                track: () => ({
                    x: ship.position.x,
                    y: ship.position.y,
                    rotation: ship.rotation + Math.PI / 2
                }),
                onComplete: () => {
                    camera.rotation = 0
                    mode = "building"
                    activePanel = "blocks"
                    gridEditor = new GridEditor(ship.grid)
                    gridEditor.selectColor(buildColor)
                    syncFromEditor()
                }
            }
            return
        }

        ship.updateCollider()
        mode = "flying"
        activePanel = "ships"
        gridEditor = null
        syncFromEditor()

        cameraTransition = {
            fromX: ship.position.x, fromY: ship.position.y,
            toX: savedCameraState?.position.x ?? camera.position.x,
            toY: savedCameraState?.position.y ?? camera.position.y,
            fromZoom: buildZoom, toZoom: savedCameraState?.zoom ?? camera.zoom,
            fromRotation: shipRotation, toRotation: 0,
            progress: 0,
            // On the way out the destination is a fixed viewpoint, and
            // camera.follow takes over the moment the transition ends.
            track: null,
            onComplete: () => {
                camera.rotation = 0
                savedCameraState = null
            }
        }
    }

    function updateCameraTransition(delta: number) {
        if (!cameraTransition) return

        const camera = world.camera
        const transition = cameraTransition

        // Refresh the destination before easing toward it, so the last frame
        // lands exactly on wherever the ship has ended up.
        if (transition.track) {
            const target = transition.track()
            transition.toX = target.x
            transition.toY = target.y
            transition.toRotation = target.rotation
        }

        transition.progress = Math.min(transition.progress + transitionSpeed * delta, 1)
        const t = easeInOut(transition.progress)

        camera.position.x = transition.fromX + (transition.toX - transition.fromX) * t
        camera.position.y = transition.fromY + (transition.toY - transition.fromY) * t
        camera.zoom = transition.fromZoom + (transition.toZoom - transition.fromZoom) * t

        // Take the short way round, so a ship pointing at -179 degrees doesn't
        // spin the camera almost all the way about.
        let rotDiff = transition.toRotation - transition.fromRotation
        rotDiff = Math.atan2(Math.sin(rotDiff), Math.cos(rotDiff))
        camera.rotation = transition.fromRotation + rotDiff * t

        if (transition.progress >= 1) {
            cameraTransition = null
            transition.onComplete()
        }
    }

    // --- Pointer ------------------------------------------------------------

    let isDragging = false

    /** Client coordinates to the build editor's grid space. */
    function screenToGrid(clientX: number, clientY: number): [number, number] {
        const rect = canvas!.getBoundingClientRect()
        const center = world.player.currentShip.grid.getCenter()

        return [
            (clientX - rect.left - canvas!.clientWidth / 2) / buildZoom + center.x,
            (clientY - rect.top - canvas!.clientHeight / 2) / buildZoom + center.y
        ]
    }

    /** Pulls every piece of editor state the template renders. */
    function syncFromEditor() {
        if (!gridEditor) return

        selectedPlacement = gridEditor.selectedPlacement
        selectedPlacementType = gridEditor.selectedPlacementType
        activeBaseShape = gridEditor.baseShape
        activeShape = gridEditor.resolvedShape
    }

    function selectBlockShape(base: BaseShape) {
        gridEditor?.selectBaseShape(base)
        syncFromEditor()
    }

    function rotateTool() {
        gridEditor?.rotate()
        syncFromEditor()
    }

    function setPlacementType(type: PlacementTool | null) {
        if (!gridEditor) return
        gridEditor.selectedPlacementType = type
        selectedPlacementType = type
    }

    function handleSpacerMouseDown(event: MouseEvent) {
        if (mode !== "building" || !gridEditor || !canvas) return

        isDragging = true
        gridEditor.handleClick(...screenToGrid(event.clientX, event.clientY))
        syncFromEditor()
    }

    function handleSpacerMouseUp(event: MouseEvent) {
        isDragging = false
        if (mode === "building" || !canvas) return

        const position = getPositionFromEvent(event, canvas, world.camera)
        for (const ship of world.ships) {
            if (ship.controller instanceof FollowController) {
                ship.controller.setTemporaryTarget(() => position)
            }
        }
    }

    function handleSpacerMouseMove(event: MouseEvent) {
        if (mode !== "building" || !gridEditor || !canvas) return

        const [gridX, gridY] = screenToGrid(event.clientX, event.clientY)
        gridEditor.handleMouseMove(gridX, gridY)

        if (isDragging) {
            gridEditor.handleClick(gridX, gridY)
            syncFromEditor()
        }
    }

    function handleSpacerMouseLeave() {
        isDragging = false
        gridEditor?.handleMouseLeave()
    }

    function handleWheel(event: WheelEvent) {
        if (!canvas) return

        event.preventDefault()

        const rect = canvas.getBoundingClientRect()

        const deltaY =
            event.deltaMode === 1 ? event.deltaY * 16 :
            event.deltaMode === 2 ? event.deltaY * canvas.clientHeight :
            event.deltaY

        // ctrlKey on a wheel event means trackpad pinch, which sends much
        // smaller deltas than a mouse wheel notch.
        const sensitivity = event.ctrlKey ? 0.01 : 0.0015
        const factor = Math.exp(-deltaY * sensitivity)

        if (mode === "building") {
            buildZoom = Math.min(Math.max(buildZoom * factor, 5), 80)
        } else {
            world.camera.zoomToward(
                event.clientX - rect.left,
                event.clientY - rect.top,
                canvas.clientWidth,
                canvas.clientHeight,
                factor
            )
        }
    }

    function handleResize() {
        if (canvas && context) resizeCanvas(canvas, context)
    }

    onMount(() => {
        if (!canvas) return

        context = canvas.getContext("2d")
        if (!context) return

        resizeCanvas(canvas, context)
        window.addEventListener("wheel", handleWheel, { passive: false })

        world.init(controller)
        world.lighting.enabled = lightingEnabled
        fleet = world.ships

        frame = requestAnimationFrame(tick)

        return () => {
            cancelAnimationFrame(frame)
            window.removeEventListener("wheel", handleWheel)
        }
    })

    const BLOCK_TOOLS: { base: BaseShape, label: string, fallback: BlockShape | null }[] = [
        { base: "full", label: "Full", fallback: "full" },
        { base: "half", label: "Half", fallback: "halfN" },
        { base: "quarter", label: "Quarter", fallback: "quarterNW" },
        { base: "wedge", label: "Wedge", fallback: "triNW" },
        { base: "ramp", label: "Ramp", fallback: "rampSE" },
        { base: "arc", label: "Arc", fallback: "arcNW" },
        { base: "empty", label: "Erase", fallback: null }
    ]

    /** Preview shape for a block button: its live rotation when selected. */
    function previewShape(tool: typeof BLOCK_TOOLS[number]): BlockShape | null {
        return activeBaseShape === tool.base ? activeShape : tool.fallback
    }

    /** Whether a block tool has variants to cycle with [R]. */
    function isRotatable(tool: typeof BLOCK_TOOLS[number]): boolean {
        return tool.base !== "full" && tool.base !== "empty"
    }
</script>

<svelte:window onkeydown={handleKeyDown} onkeyup={handleKeyUp} onresize={handleResize}></svelte:window>

<!-- Shared by the hull and module panels: both paint with the same colour. -->
{#snippet colorPicker()}
    <div class="color-picker">
        <label for="build-color">Colour</label>
        <input
            id="build-color"
            type="color"
            bind:value={buildColor}
            oninput={syncEditorColor}
        />
        <span class="color-value">{buildColor}</span>
    </div>
{/snippet}

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
                onclick={toggleLighting}
            >Lighting</button>
        </div>
        <button onclick={toggleMode}>{`Mode = ${mode}`}</button>
    </div>

    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div id="spacer"
        onmousedown={handleSpacerMouseDown}
        onmouseup={handleSpacerMouseUp}
        onmousemove={handleSpacerMouseMove}
        onmouseleave={handleSpacerMouseLeave}
    >
        {#if mode === "building"}
            <div id="placement-details">
                {#if selectedPlacement}
                    <h3>{selectedPlacement.displayName}</h3>
                    <p class="detail-desc">{selectedPlacement.description}</p>
                    <p class="detail-stat">Level: {selectedPlacement.level}/5</p>
                    <p class="detail-stat">Weight: {selectedPlacement.weight}</p>
                    <canvas
                        width="64" height="64"
                        class="detail-preview"
                        use:drawPlacementPreview={{ placement: selectedPlacement }}
                    ></canvas>
                    {#if selectedPlacement.level < 5}
                        <button onclick={() => { gridEditor?.upgradeSelectedPlacement(); syncFromEditor() }}>Upgrade</button>
                    {:else}
                        <button disabled>Max Level</button>
                    {/if}
                    <button class="remove-btn" onclick={() => { gridEditor?.removeSelectedPlacement(); syncFromEditor() }}>Remove</button>
                {:else}
                    <h3>Details</h3>
                    <p class="detail-desc">Select a placement to inspect it.</p>
                {/if}
            </div>
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
                    {#each fleet as ship, index}
                        <!-- svelte-ignore a11y_consider_explicit_label -->
                        <button
                            class="ship-button"
                            onclick={() => world.player.setActiveShip(index)}
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
                    {@render colorPicker()}
                    {#each BLOCK_TOOLS as tool}
                        {@const preview = previewShape(tool)}
                        <button
                            class={activeBaseShape === tool.base ? "active" : ""}
                            onclick={() => selectBlockShape(tool.base)}
                        >
                            {#if preview}
                                <canvas
                                    width="24" height="24"
                                    class="block-preview"
                                    use:drawShapePreview={preview}
                                ></canvas>
                            {/if}
                            {tool.label}
                            {#if isRotatable(tool) && activeBaseShape === tool.base}
                                <span class="rotate-hint">[R]</span>
                            {/if}
                        </button>
                    {/each}
                </div>
            {:else if activePanel === "placements"}
                <h3 id="bottom-bar-title-bar">Modules</h3>
                <div id="bottom-bar-options">
                    {@render colorPicker()}
                    <button
                        class={selectedPlacementType === "turret" ? "active" : ""}
                        onclick={() => setPlacementType(selectedPlacementType === "turret" ? null : "turret")}
                    >
                        <canvas
                            width="32" height="32"
                            class="block-preview"
                            use:drawPlacementPreview={{ placement: PREVIEW_MODULES.turret, color: buildColor }}
                        ></canvas>
                        Turret
                    </button>
                    <button
                        class={selectedPlacementType === "thruster" ? "active" : ""}
                        onclick={() => setPlacementType(selectedPlacementType === "thruster" ? null : "thruster")}
                    >
                        <canvas
                            width="32" height="32"
                            class="block-preview"
                            use:drawPlacementPreview={{ placement: PREVIEW_MODULES.thruster, color: buildColor }}
                        ></canvas>
                        Thruster
                    </button>
                    <button
                        class={selectedPlacementType === "spike" ? "active" : ""}
                        onclick={() => setPlacementType(selectedPlacementType === "spike" ? null : "spike")}
                    >
                        <canvas
                            width="32" height="32"
                            class="block-preview"
                            use:drawPlacementPreview={{ placement: PREVIEW_MODULES.spike, color: buildColor }}
                        ></canvas>
                        Spike
                        {#if selectedPlacementType === "spike"}
                            <span class="rotate-hint">[R]</span>
                        {/if}
                    </button>
                    <button
                        class={selectedPlacementType === "erase" ? "active" : ""}
                        onclick={() => setPlacementType(selectedPlacementType === "erase" ? null : "erase")}
                    >
                        Erase
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

    #placement-details {
        position: absolute;
        top: 50%;
        left: 2%;
        width: 200px;
        background-color: rgba(0, 10, 20, 0.85);
        border: 2px solid var(--ui-background);
        padding: .75rem;
        display: flex;
        flex-direction: column;
        gap: .5rem;
        z-index: 3;
        pointer-events: auto;
        transform: translateY(-50%);
    }
    #placement-details h3 {
        margin-bottom: .25rem;
    }
    #placement-details button {
        width: 100%;
        font-size: 14px;
        padding: .4rem .5rem;
    }
    #placement-details .remove-btn {
        background-color: rgba(255, 60, 60, 0.3);
        border-color: rgba(255, 60, 60, 0.5);
        color: rgba(255, 100, 100, 0.9);
    }
    #placement-details .remove-btn:hover {
        background-color: rgba(255, 60, 60, 0.2);
    }
    .detail-desc {
        font-size: 12px;
        opacity: 0.8;
        margin: 0;
    }
    .detail-stat {
        font-size: 13px;
        margin: 0;
    }
    .detail-preview {
        display: block;
        margin: .25rem auto;
        background: rgba(0, 0, 0, 0.3);
        border-radius: 6px;
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
    .color-picker {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 6px;
        min-width: 90px;
        flex-shrink: 0;
        padding: 4px 8px;
        border-right: 1px solid var(--ui-background);
        margin-right: .25rem;
    }
    .color-picker label {
        font-size: 12px;
        opacity: 0.8;
        white-space: nowrap;
    }
    .color-picker input[type="color"] {
        width: 56px;
        height: 32px;
        padding: 0;
        border: 2px solid var(--ui-background);
        border-radius: 6px;
        background: none;
        cursor: pointer;
    }
    /* Strip the native chrome so the swatch fills the control. */
    .color-picker input[type="color"]::-webkit-color-swatch-wrapper {
        padding: 2px;
    }
    .color-picker input[type="color"]::-webkit-color-swatch {
        border: none;
        border-radius: 3px;
    }
    .color-value {
        font-size: 10px;
        opacity: 0.6;
        text-transform: uppercase;
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

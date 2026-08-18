import { buildShip, findShip, SHIPS } from "../../assets/ships"
import { Camera, CameraBinding, type Vec2 } from "../../render/camera"
import { DEFAULT_FONT } from "../../render/font"
import type { Frame } from "../../render/frame"
import { SHIP_LAYERS, type ShipLayer } from "../../render/grid/layers"
import type { Ship } from "../../game/ship"
import { InstanceBatch } from "../../render/webgpu/instance"
import { DynamicMesh, Mesh, MeshBuilder } from "../../render/mesh"
import type { Pipeline } from "../../render/webgpu/pipeline"
import type { PointerInput } from "../../input/keys"
import type { SceneContext, SceneInstance } from "../../render/scene"
import { type ActionsOf, type SearchColumn, type SettingsSchema, type ValuesOf } from "../../settings/settings"
import type { DevSceneDefinition } from "../DevScene"
import { downloadText } from "../../download"
import { shipToText } from "../../game/shipJson"
import { Color } from "../../render/color"
import { appendLayer, appendLayerOutline } from "../../render/grid/blockDraw"

const DEFAULT_WIREFRAME_COLOR = Color.from("#00fbff")
const LABEL_COLOR = Color.from("#797979")
const MASS_COLOR = Color.from("#00aaff")
const BOUNDS_COLOR = Color.from("#ff6a00")
const HOVER_COLOR = Color.from("#fff700")

const CELL = 24

/** Text height as a fraction of the framed area, so the name scales with the view. */
const LABEL_SCALE = 0.04

/** A ship's footprint as "columns x rows", or "-" for one with no blocks at all. */
function sizeLabel(ship: Ship | undefined): string {
    const bounds = ship?.bounds
    if (!bounds) return "-"

    return `${bounds.maxCol - bounds.minCol + 1}x${bounds.maxRow - bounds.minRow + 1}`
}

/**
 * What the ship picker shows per row. Options are ids, so each cell looks its
 * ship back up - the panel knows nothing about ships.
 */
const SHIP_COLUMNS: readonly SearchColumn[] = [
    { header: "Ship", cell: (id) => findShip(id)?.name ?? id },
    { header: "Size", cell: (id) => sizeLabel(findShip(id)) },
    { header: "Creator", cell: (id) => findShip(id)?.creator ?? "" },
]

const SETTINGS = {
    ship: {
        type: "search",
        label: "Ship",
        default: SHIPS[0]?.id ?? "",
        options: SHIPS.map((ship) => ship.id),
        placeholder: "Find a ship...",
        columns: SHIP_COLUMNS,
        // Past the default 8: the result box scrolls, so an unfiltered list
        // showing every ship beats one that silently stops at the eighth
        limit: 50,
    },
    getShip:    { type: "button", label: "Download Ship" },

    viewSeparator: { type: "separator", label: "Views"},

    flat:       { type: "checkbox", label: "Flat", default: true },
    lit:        { type: "checkbox", label: "Lit", default: true },
    wire:       { type: "checkbox", label: "Wireframe", default: true },

    pickerSeparator: { type: "separator", label: "Settings"},

    resolution: { type: "range", label: "Resolution", default: 1, min: 0.05, max: 1, step: 0.05 },
    spacing:    { type: "range", label: "Spacing", default: 1.0, min: 0, max: 3.0, step: 0.1 },
    origin:     { type: "selection", label: "Origin", default: "mass", options: ["mass", "bounds"], display: "segmented" },
    spin:       { type: "range", label: "Spin", default: 0.2, min: 0, max: 2, step: 0.05 },
    wireColor:  { type: "color", label: "Wireframe Color", default: DEFAULT_WIREFRAME_COLOR.hex},

    layersSeperator: { type: "separator", label: "Render Layers"},

    hull:       { type: "checkbox", label: "Hull", default: true },
    components: { type: "checkbox", label: "Components", default: true },
    cosmetic:   { type: "checkbox", label: "Cosmetic", default: true },
    markers:    { type: "checkbox", label: "Markers", default: true },
} as const satisfies SettingsSchema

type ViewerValues = ValuesOf<typeof SETTINGS>

/** The three ways one ship is drawn. Order here is the order around the circle. */
const VIEW_KINDS = ["flat", "lit", "wire"] as const
type ViewKind = (typeof VIEW_KINDS)[number]

interface Size {
    width: number
    height: number
}

/** Which view the cursor is over, and the cell under it in that view's ship. */
interface HoverTarget {
    view: number
    col: number
    row: number
}

/** What a DynamicMesh is written with to say it holds nothing this frame. */
const EMPTY_MESH = new Float32Array(0)

/**
 * The box around one cell, as line-list vertices in the ship's own space.
 *
 * Its own function rather than a method: it reads the hovered cell and the
 * origin and nothing else about the scene, and a mesh built from two arguments
 * is easier to trust than one built from the whole viewer.
 */
function hoverOutline(target: HoverTarget, origin: Vec2): Float32Array<ArrayBuffer> {
    const x = (target.col - origin.x) * CELL
    const y = (target.row - origin.y) * CELL
    const { r, g, b } = HOVER_COLOR

    const corners = [
        x, y, x + CELL, y,
        x + CELL, y, x + CELL, y + CELL,
        x + CELL, y + CELL, x, y + CELL,
        x, y + CELL, x, y,
    ]

    const out: number[] = []
    for (let i = 0; i < corners.length; i += 2) out.push(corners[i]!, corners[i + 1]!, r, g, b)

    return new Float32Array(out)
}

/*~~~ Pure helpers ~~~*/

/** A plus sign, so a center is visible against the hull behind it. */
function appendCross(builder: MeshBuilder, x: number, y: number, size: number, color: Color): void {
    const arm = size / 2
    const thick = Math.max(size / 8, 0.5)

    builder.quad(x - arm, y - thick / 2, size, thick, color)
    builder.quad(x - thick / 2, y - arm, thick, size, color)
}

/**
 * `splits` points spaced evenly around a circle.
 *
 * @param radius distance from the center, in WORLD units - not a multiplier
 * @param offset where the first point sits, in degrees. The world is y-down, so
 *        angles run clockwise on screen and -90 puts the first point at the top.
 */
function getPointsOnCircle(centerPos: Vec2, radius: number, splits: number, offset = 0): Vec2[] {
    const circleSplit = 360 / splits
    const out: Vec2[] = []

    for (let s = 0; s < splits; s++) {
        const radians = ((circleSplit * s) + offset) * Math.PI / 180
        out.push({
            x: centerPos.x + radius * Math.cos(radians),
            y: centerPos.y + radius * Math.sin(radians)
        })
    }

    return out
}

/** A ship's bounding box in world units, never smaller than one unit. */
function shipWorldSize(ship: Ship, cellSize: number): Size {
    const bounds = ship.bounds
    if (!bounds) return { width: 1, height: 1 }

    return {
        width: Math.max((bounds.maxCol - bounds.minCol + 1) * cellSize, 1),
        height: Math.max((bounds.maxRow - bounds.minRow + 1) * cellSize, 1),
    }
}

/**
 * How far a ship reaches from its own origin, in world units.
 *
 * The worse side of each axis, not half the bounding box: the origin is usually
 * the center of mass, which is nowhere near the middle of the box, so half the
 * box under-measures the long side and lets the hull run out under the label.
 */
function shipHalfReach(ship: Ship, origin: Vec2, cellSize: number): Size {
    const bounds = ship.bounds
    if (!bounds) return { width: 0.5, height: 0.5 }

    // Cell (col, row) covers [col, col + 1) x [row, row + 1), so the far edges
    // are one cell past the last filled index
    const left = (origin.x - bounds.minCol) * cellSize
    const right = (bounds.maxCol + 1 - origin.x) * cellSize
    const up = (origin.y - bounds.minRow) * cellSize
    const down = (bounds.maxRow + 1 - origin.y) * cellSize

    return {
        width: Math.max(left, right, 0.5),
        height: Math.max(up, down, 0.5),
    }
}

/** The point every layer is drawn around, and which the ships spin about. */
function originFor(ship: Ship, mode: ViewerValues["origin"]): Vec2 {
    return mode === "mass" ? ship.centerOfMass : ship.center
}

/** The views the settings have switched on, in circle order. */
function enabledViews(settings: ViewerValues): ViewKind[] {
    return VIEW_KINDS.filter((kind) => settings[kind])
}

class ShipViewer implements SceneInstance<ViewerValues> {
    private readonly context: SceneContext
    private readonly input: PointerInput
    private settings: ViewerValues | null = null
    private readonly camera = new Camera()
    /*
     * Borrowed from the renderer rather than built here, so the draw sites below
     * read the same as they always did. Getters and not fields because these are
     * not this scene's to hold - the renderer outlives it and hands the next
     * scene the same four.
     */
    private get cameraBinding(): CameraBinding { return this.context.renderer.camera }
    private get instanced(): Pipeline { return this.context.renderer.instanced }      // Filled geometry, instanced
    private get onTop(): Pipeline { return this.context.renderer.mesh }               // Filled geometry, one copy (the overlay)
    private get lines(): Pipeline { return this.context.renderer.instancedLines }     // Line geometry, instanced

    private readonly batch: InstanceBatch
    private readonly wireBatch: InstanceBatch
    private readonly hoverBatch: InstanceBatch

    private readonly meshes = new Map<ShipLayer, Mesh>()
    private readonly wireMesh: DynamicMesh
    private readonly overlay: DynamicMesh
    private readonly hover: DynamicMesh
    private hoverKey = ""

    private ship: Ship | null = null
    private shipSize: Size = { width: 1, height: 1 }
    /** Reach from the origin, which is what frames a view. See shipHalfReach. */
    private shipReach: Size = { width: 0.5, height: 0.5 }
    private origin: Vec2 = { x: 0, y: 0 }

    /** Which views are on, and where each one sits. Same length, same order. */
    private views: ViewKind[] = []
    private viewPoints: Vec2[] = []

    private builtKey = "" // The settings key, used to rebuild only on change
    private elapsed = 0
    private labelSpace = 0

    readonly actions: Record<ActionsOf<typeof SETTINGS>, () => void> = {
        getShip: () => this.download(),
    }

    constructor(context: SceneContext) {
        this.context = context
        const gpu = context.gpu

        this.input = context.input.pointer
        const instanceLayout = context.renderer.instanceLayout

        this.wireMesh = DynamicMesh.create(gpu, "ship wireframe")
        this.overlay = DynamicMesh.create(gpu, "ship overlay")
        this.hover = DynamicMesh.create(gpu, "hover")

        this.batch = InstanceBatch.create(gpu, instanceLayout, 1024, "ship-viewer")

        // Separate batches rather than refilling one: queue.writeBuffer is ordered
        // against submit, not against recorded draws, so writing one buffer twice
        // in a frame makes both draws read the second write
        this.wireBatch = InstanceBatch.create(gpu, instanceLayout, 8, "wireframe")
        this.hoverBatch = InstanceBatch.create(gpu, instanceLayout, 8, "hover")
    }

    update(dt: number, settings: ViewerValues): void {
        this.elapsed += dt
        this.settings = settings
        this.context.gpu.resolutionScale = settings.resolution

        // Before the rebuild guard: that returns early on an unchanged settings
        // key, which would skip every per-frame input read below it
        this.updateHover(settings)

        const key = `${DEFAULT_FONT.loaded}|${JSON.stringify(settings)}`
        if (key === this.builtKey) return

        this.rebuild(settings)
        this.builtKey = key
    }

    render(frame: Frame): void {
        const settings = this.settings
        if (!this.ship || !settings) return

        this.fitCamera()
        this.fillBatches(settings)

        this.drawShipLayers(frame, settings)
        this.drawWireframe(frame)
        this.drawHover(frame)
        this.drawOverlay(frame)

        this.context.stats.set("ships", this.views.length)
    }

    dispose(): void {
        this.context.gpu.resolutionScale = 1


        this.disposeMeshes()
        this.overlay.destroy()

        this.batch.destroy()
        this.wireBatch.destroy()
        this.hoverBatch.destroy()
    }

    /*~~~ Measuring ~~~*/

    /**
     * How far each view sits from the middle, in world units.
     *
     * `spacing` is a multiplier, not a distance - one ship's longest side times
     * that. Passing the multiplier straight through as a radius would stack every
     * view on the origin, since a ship is a couple of hundred world units across.
     */
    private orbitRadius(spacing: number): number {
        return Math.max(this.shipSize.width, this.shipSize.height) * spacing
    }

    /**
     * Half-extents of the views themselves, before the label above them.
     *
     * Measured from where the views actually are rather than from the orbit
     * radius, so a single centered view frames tightly instead of leaving a ring
     * of empty space around it.
     */
    private framedHalfSize(): Size {
        let width = this.shipReach.width
        let height = this.shipReach.height

        for (const point of this.viewPoints) {
            width = Math.max(width, Math.abs(point.x) + this.shipReach.width)
            height = Math.max(height, Math.abs(point.y) + this.shipReach.height)
        }

        return { width, height }
    }

    /**
     * Where the name and creator sit, and how much room they need above the views.
     *
     * One place computes the whole stack, so the camera fit reaches exactly as far
     * as the text does. Deriving the two separately is what let the name hang off
     * the top of the screen.
     */
    private labelLayout(): {
        namePixel: number
        creatorPixel: number
        nameY: number
        creatorY: number
        height: number
    } {
        const half = this.framedHalfSize()
        const halfHeight = half.height

        // Sized against the larger extent, not the height: two views side by side
        // make a wide, short frame, and keying off the height alone shrinks the
        // name to a few unreadable pixels
        const span = Math.max(half.width, half.height) * 2
        const namePixel = (span * LABEL_SCALE) / DEFAULT_FONT.glyphHeight
        const creatorPixel = namePixel / 2

        const nameHeight = DEFAULT_FONT.glyphHeight * namePixel
        const creatorHeight = DEFAULT_FONT.glyphHeight * creatorPixel
        const gap = nameHeight * 0.3

        // Stacked upward from the top of the views: creator just above them, name
        // above that. `height` is the whole block, which is what the fit needs.
        const height = gap + creatorHeight + gap + nameHeight

        return {
            namePixel,
            creatorPixel,
            nameY: -halfHeight - height,
            creatorY: -halfHeight - gap - creatorHeight,
            height,
        }
    }

    /** Only the lit view turns; the others hold still so they can be read. */
    private viewRotation(kind: ViewKind, settings: ViewerValues): number {
        return kind === "lit" ? this.elapsed * settings.spin : 0
    }

    /**
     * Recomputes which views are on and where they sit.
     *
     * The two arrays are built together and indexed together, so a disabled view
     * can never leave a hole that the fill loop walks off the end of.
     */
    private layOutViews(settings: ViewerValues): void {
        this.views = enabledViews(settings)

        if (this.views.length === 0) {
            this.viewPoints = []
            return
        }

        // One view has nothing to be arranged around, so it takes the middle
        // rather than sitting out on the orbit with empty space opposite it
        if (this.views.length === 1) {
            this.viewPoints = [{ x: 0, y: 0 }]
            return
        }

        // Two views read better opposite each other; three want a nudge so none
        // sits flat on top of the middle
        const offset = this.views.length > 2 ? -30 : 0
        this.viewPoints = getPointsOnCircle(
            { x: 0, y: 0 },
            this.orbitRadius(settings.spacing),
            this.views.length,
            offset,
        )
    }

    /*~~~ Hover ~~~*/

    /**
     * The cell under the cursor, in whichever view it is over.
     *
     * Each view is the same ship at a different transform, so this undoes that
     * transform - translation first, then the spin - and asks the ship's own grid.
     */
    private hoverTarget(settings: ViewerValues): HoverTarget | null {
        const ship = this.ship
        if (!ship || !this.input.over) return null

        const world = this.camera.screenToWorld(this.input.x, this.input.y)

        for (let index = 0; index < this.views.length; index++) {
            const at = this.viewPoints[index]!
            const angle = this.viewRotation(this.views[index]!, settings)

            // The shader does world = offset + R(angle) * local, so this is its
            // inverse: subtract the offset, then rotate back by -angle
            const dx = world.x - at.x
            const dy = world.y - at.y
            const cos = Math.cos(angle)
            const sin = Math.sin(angle)

            const localX = dx * cos + dy * sin
            const localY = -dx * sin + dy * cos

            const col = Math.floor(localX / CELL + this.origin.x)
            const row = Math.floor(localY / CELL + this.origin.y)

            // Occupancy rather than the bounding box: a concave hull has gaps
            // inside its bounds, and "empty" is a cell that draws nothing
            const filled = SHIP_LAYERS.some((layer) => {
                const cell = ship.layers[layer].get(col, row)
                return cell !== undefined && cell.shape !== "empty"
            })

            if (filled) return { view: index, col, row }
        }

        return null
    }

    private updateHover(settings: ViewerValues): void {
        const target = this.hoverTarget(settings)

        // The box lives in the ship's own space and is placed by an instance, so
        // it only needs rebuilding when the cell changes - not when a spinning
        // view moves it, which would be a new mesh every frame
        const key = target ? `${target.col},${target.row}` : ""
        if (key === this.hoverKey) {
            this.hoverView = target?.view ?? -1
            return
        }

        this.hoverKey = key
        this.hoverView = target?.view ?? -1

        this.hover.write(target ? hoverOutline(target, this.origin) : EMPTY_MESH)
    }

    private hoverView = -1

    /*~~~ Per-frame ~~~*/

    private fitCamera(): void {
        const gpu = this.context.gpu
        const half = this.framedHalfSize()

        // The label sits above the views, so the fitted rect reaches up for it
        this.camera.fit(
            -half.width, -half.height - this.labelSpace,
            half.width, half.height,
            gpu.width, gpu.height,
        )
        this.cameraBinding.upload(this.camera, gpu.width, gpu.height)
    }

    private fillBatches(settings: ViewerValues): void {
        this.batch.begin()
        this.wireBatch.begin()
        this.hoverBatch.begin()

        this.views.forEach((kind, index) => {
            const at = this.viewPoints[index]!
            const rotation = this.viewRotation(kind, settings)

            // White tint, so each hull's own per-cell colors pass through unchanged
            const target = kind === "wire" ? this.wireBatch : this.batch
            target.add(at.x, at.y, rotation, 1, 1, 1, 1)

            // The hover box rides the same transform as the view it belongs to,
            // so it stays glued to its cell even while that view spins
            if (index === this.hoverView) this.hoverBatch.add(at.x, at.y, rotation, 1, 1, 1, 1)
        })
    }

    private drawShipLayers(frame: Frame, settings: ViewerValues): void {
        frame.setPipeline(this.instanced).setBindGroup(0, this.cameraBinding.group)

        for (const layer of SHIP_LAYERS) {
            if (!settings[layer]) continue

            const mesh = this.meshes.get(layer)
            if (mesh) this.batch.draw(frame, mesh)
        }
    }

    private drawWireframe(frame: Frame): void {
        // `current` rather than draw(): a batch repeats one mesh and reads its
        // buffer itself, so it needs the mesh and not a draw call
        const mesh = this.wireMesh.current
        if (!mesh) return

        frame.setPipeline(this.lines).setBindGroup(0, this.cameraBinding.group)
        this.wireBatch.draw(frame, mesh)
    }

    private drawHover(frame: Frame): void {
        const mesh = this.hover.current
        if (!mesh) return

        frame.setPipeline(this.lines).setBindGroup(0, this.cameraBinding.group)
        this.hoverBatch.draw(frame, mesh)
    }

    private drawOverlay(frame: Frame): void {
        if (this.overlay.vertexCount === 0) return

        // Group 0 is re-bound because switching to a pipeline with a different
        // layout is allowed to invalidate what was bound
        frame.setPipeline(this.onTop).setBindGroup(0, this.cameraBinding.group)
        this.overlay.draw(frame)
    }

    /*~~~ Building ~~~*/

    /** Rebuild everything the settings describe. */
    private rebuild(settings: ViewerValues): void {
        const ship = buildShip(settings.ship)
        this.ship = ship
        this.shipSize = shipWorldSize(ship, CELL)
        this.origin = originFor(ship, settings.origin)
        this.shipReach = shipHalfReach(ship, this.origin, CELL)

        // After shipSize, since the radius is derived from it
        this.layOutViews(settings)

        this.labelSpace = this.labelLayout().height

        this.disposeMeshes()
        this.buildFlatMesh(ship, this.origin)
        this.wireMesh.write(this.buildWireMesh(ship, this.origin, Color.from(settings.wireColor)))
        this.overlay.write(this.buildOverlayMesh(settings, ship))

        // The cell it pointed at belongs to the ship that just went away
        this.hoverKey = ""
        this.hover.write(EMPTY_MESH)

        this.context.stats.set("ship mass", ship.mass)
    }

    private disposeMeshes(): void {
        for (const mesh of this.meshes.values()) mesh.destroy()
        this.meshes.clear()

        // The two dynamic meshes keep their buffers and simply hold nothing: the
        // next ship writes into them rather than allocating again
        this.wireMesh.write(EMPTY_MESH)
        this.hover.write(EMPTY_MESH)
    }

    private buildFlatMesh(ship: Ship, origin: Vec2): void {
        const gpu = this.context.gpu

        for (const layer of SHIP_LAYERS) {
            const builder = new MeshBuilder()

            // Every layer gets the SAME origin, or they drift apart
            appendLayer(builder, ship.layers[layer], CELL, origin)

            if (builder.vertexCount > 0) this.meshes.set(layer, builder.build(gpu, layer))
        }
    }

    private buildWireMesh(ship: Ship, origin: Vec2, color: Color): Float32Array<ArrayBuffer> {
        const outline: number[] = []

        // Outlined from the solid mesh's own triangles, so art outlines as the
        // turret it is rather than as the hexagon it used to stand in for.
        // Glyphs come along for free: appendBlock emits the letter and facing bar
        // for a component with no art, so they outline in the same pass
        for (const layer of SHIP_LAYERS) {
            appendLayerOutline(outline, ship.layers[layer], CELL, origin, color)
        }

        return new Float32Array(outline)
    }

    private appendHeaderLabel(builder: MeshBuilder, ship: Ship): void {
        const { namePixel, creatorPixel, nameY, creatorY } = this.labelLayout()

        DEFAULT_FONT.appendText(
            builder,
            ship.name,
            -DEFAULT_FONT.measureText(ship.name, namePixel) / 2,
            nameY,
            namePixel,
            LABEL_COLOR,
        )

        // Half size, on the line below the name
        DEFAULT_FONT.appendText(
            builder,
            `Made by: ${ship.creator}`,
            -DEFAULT_FONT.measureText(`Made by: ${ship.creator}`, creatorPixel) / 2,
            creatorY,
            creatorPixel,
            LABEL_COLOR,
        )
    }

    /**
     * The two center markers.
     *
     * The chosen origin sits at (0,0) by construction; the other center is offset
     * by however far the two disagree. Seeing that gap is the point - a ship with
     * heavy engines aft rotates well behind its geometric middle.
     */
    private appendCenterMarkers(
        builder: MeshBuilder,
        ship: Ship,
        mode: ViewerValues["origin"],
        at: Vec2,
    ): void {
        const size = CELL * 0.8
        const byMass = mode === "mass"

        const other = byMass ? ship.center : ship.centerOfMass
        const originColor = byMass ? MASS_COLOR : BOUNDS_COLOR
        const otherColor = byMass ? BOUNDS_COLOR : MASS_COLOR

        appendCross(builder, at.x, at.y, size, originColor)
        appendCross(
            builder,
            at.x + (other.x - this.origin.x) * CELL,
            at.y + (other.y - this.origin.y) * CELL,
            size,
            otherColor,
        )
    }

    /** Labels and markers, in one mesh drawn once rather than per instance. */
    private buildOverlayMesh(settings: ViewerValues, ship: Ship): Float32Array<ArrayBuffer> {
        const builder = new MeshBuilder()

        this.appendHeaderLabel(builder, ship)

        // On a view that holds still: the overlay is world-space, so markers on a
        // spinning view would sit where it started rather than following it
        const still = this.views.findIndex((kind) => kind !== "lit")
        if (settings.markers && still >= 0) {
            this.appendCenterMarkers(builder, ship, settings.origin, this.viewPoints[still]!)
        }

        return builder.toArray()
    }

    private download(): void {
        if (!this.ship) return
        downloadText(`${this.ship.id}.json`, shipToText(this.ship))
    }
}

const scene: DevSceneDefinition<ViewerValues> = {
    id: "ship-viewer",
    name: "Ship Viewer",
    description:
        "One ship drawn up to three ways - flat, spinning, and as a wireframe - arranged " +
        "on a circle. Orange marks the center of mass, blue the center of the bounding " +
        "box. Hover a ship to highlight the cell under the cursor.",
    settings: SETTINGS,
    create: (context) => new ShipViewer(context),
}

export default scene

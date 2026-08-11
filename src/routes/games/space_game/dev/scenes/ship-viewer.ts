import { buildShip, SHIPS } from "../../assets/ships"
import { Camera, CameraBinding, type Vec2 } from "../../render/camera"
import { DEFAULT_FONT } from "../../render/font"
import type { Frame } from "../../render/frame"
import { SHIP_LAYERS, type ShipLayer } from "../../render/grid/layers"
import type { Ship } from "../../game/ship"
import { InstanceBatch } from "../../render/webgpu/instance"
import { Mesh, MeshBuilder, VERTEX_LAYOUT, type RGB } from "../../render/mesh"
import { emptyBindGroupLayout, Pipeline } from "../../render/webgpu/pipeline"
import type { SceneContext, SceneInstance } from "../../render/scene"
import { Shader } from "../../render/webgpu/shader"
import { INSTANCED_2D } from "../../render/shaders/instanced2d"
import { MESH_2D } from "../../render/shaders/mesh2d"
import { type ActionsOf, type SettingsSchema, type ValuesOf } from "../../settings/settings"
import type { DevSceneDefinition } from "../DevScene"
import type { ComponentKind } from "../../render/grid/components"
import type { Grid } from "../../render/grid/grid"
import { appendShape } from "../../render/grid/shapes"
import { downloadText } from "../download"
import { shipToText } from "../../game/shipJson"

/** Placeholder marks until functional blocks have real art. */
const KIND_LETTER: Record<ComponentKind, string> = {
    hull: "",
    thruster: "T",
    battery: "B",
    storage: "S",
    generator: "G",
    projector: "P",
    weapon: "W",
}

const LETTER_COLOR: RGB = [0.05, 0.06, 0.08]

const SETTINGS = {
    ship:      { type: "selection", label: "Ship", default: SHIPS[0]?.id ?? "",
                 options: SHIPS.map((ship) => ship.id) },
    getShip:   { type: "button", label: "Download Ship" },
    zoom:      { type: "range", label: "Zoom", default: 1, min: 0.2, max: 4, step: 0.05 },
    count:     { type: "range", label: "Fleet", default: 1, min: 1, max: 4000, step: 1, scale: "log" },
    spacing:   { type: "range", label: "Spacing", default: 2.5, min: 1.1, max: 8, step: 0.1 },
    spin:      { type: "range", label: "Spin", default: 0, min: 0, max: 2, step: 0.05 },
    origin:    { type: "selection", label: "Origin", default: "mass",
                 options: ["mass", "bounds"], display: "segmented" },
    hull:      { type: "checkbox", label: "Hull", default: true },
    coverable: { type: "checkbox", label: "Coverable", default: true },
    cosmetic:  { type: "checkbox", label: "Cosmetic", default: true },
    placement: { type: "checkbox", label: "Placement", default: true },
    markers:   { type: "checkbox", label: "Markers", default: true },
} as const satisfies SettingsSchema

type ViewerValues = ValuesOf<typeof SETTINGS>

const LABEL_COLOR: RGB = [0.6, 0.66, 0.72]
const MASS_COLOR: RGB = [1.0, 0.45, 0.35]
const BOUNDS_COLOR: RGB = [0.35, 0.7, 1.0]

const CELL = 24 // World units per cell. Fixed here: the camera refits, so varying it is invisible.

/** A plus sign, so a center is visible against the hull behind it. */
function appendCross(builder: MeshBuilder, x: number, y: number, size: number, color: RGB): void {
    const arm = size / 2
    const thick = Math.max(size / 8, 0.5)

    builder.quad(x - arm, y - thick / 2, size, thick, color)
    builder.quad(x - thick / 2, y - arm, thick, size, color)
}

/**
 * Like appendGridMesh, but draws non-hull components as a hexagon with their
 * initial in it.
 *
 * Temporary: functional blocks have no art yet, and a hexagon reads as "this is
 * a machine, not structure" at any zoom.
 */
function appendLayer(
    builder: MeshBuilder,
    grid: Grid,
    cellSize: number,
    origin: Vec2,
): void {
    const originX = origin.x * cellSize
    const originY = origin.y * cellSize

    for (const cell of grid.list) {
        const x = cell.col * cellSize - originX
        const y = cell.row * cellSize - originY
        const letter = KIND_LETTER[cell.kind]

        if (!letter) {
            appendShape(builder, cell.shape, cell.turns, cell.mirrored, x, y, cellSize, cell.color)
            continue
        }

        appendShape(builder, "hexagon", 0, false, x, y, cellSize, cell.color)

        // edgeLine is a thin bar flush against the north edge with four
        // orientations, so rotating it by `facing` is exactly a direction marker
        appendShape(builder, "edgeLine", cell.facing, false, x, y, cellSize, LETTER_COLOR)

        const pixel = cellSize / 12
        DEFAULT_FONT.appendText(
            builder,
            letter,
            x + (cellSize - DEFAULT_FONT.measureText(letter, pixel)) / 2,
            y + (cellSize - DEFAULT_FONT.glyphHeight * pixel) / 2,
            pixel,
            LETTER_COLOR,
        )
    }
}

class ShipViewer implements SceneInstance<ViewerValues> {
    private readonly context: SceneContext
    private readonly camera = new Camera()
    private readonly cameraBinding: CameraBinding
    private readonly instanced: Pipeline
    private readonly flat: Pipeline
    private readonly batch: InstanceBatch

    private readonly meshes = new Map<ShipLayer, Mesh>()
    private overlay: Mesh | null = null

    private ship: Ship | null = null
    private shipSize = { width: 1, height: 1 }
    private builtKey = ""
    private elapsed = 0

    readonly actions: Record<ActionsOf<typeof SETTINGS>, () => void> = {
        getShip: () => this.download(),
    }

    constructor(context: SceneContext) {
        this.context = context
        const gpu = context.gpu

        this.cameraBinding = CameraBinding.create(gpu)
        const instanceLayout = InstanceBatch.layout(gpu)

        this.instanced = Pipeline.create(gpu, {
            label: "ship instanced",
            shader: Shader.createNow(gpu, INSTANCED_2D, "instanced 2d"),
            layouts: [this.cameraBinding.layout, emptyBindGroupLayout(gpu), instanceLayout],
            vertexBuffers: [VERTEX_LAYOUT],
        })

        this.flat = Pipeline.create(gpu, {
            label: "ship overlay",
            shader: Shader.createNow(gpu, MESH_2D, "mesh 2d"),
            layouts: [this.cameraBinding.layout],
            vertexBuffers: [VERTEX_LAYOUT],
        })

        this.batch = InstanceBatch.create(gpu, instanceLayout, 1024, "fleet")
    }

    update(dt: number, settings: ViewerValues): void {
        this.elapsed += dt

        const key = `${DEFAULT_FONT.loaded}|${JSON.stringify(settings)}`
        if (key === this.builtKey) return

        this.rebuild(settings)
        this.builtKey = key
    }

    render(frame: Frame): void {
        const gpu = this.context.gpu
        const settings = this.settings
        if (!this.ship || !settings) return

        const { columns, rows, stepX, stepY, halfW, halfH } = this.formation(settings)

        // The label sits above the formation, so the fitted rect has to reach up
        // far enough to include it or it is cropped off the top of the viewport
        this.camera.fit(-halfW, -halfH - this.labelSpace, halfW, halfH, gpu.width, gpu.height)
        this.camera.zoom *= settings.zoom
        this.cameraBinding.upload(this.camera, gpu.width, gpu.height)

        this.batch.begin().reserve(settings.count)
        for (let i = 0; i < settings.count; i++) {
            const column = i % columns
            const row = Math.floor(i / columns)

            this.batch.add(
                (column - (columns - 1) / 2) * stepX,
                (row - (rows - 1) / 2) * stepY,
                this.elapsed * settings.spin,
                1,
                // White, so the hull's own per-cell colors pass through unchanged
                1, 1, 1,
            )
        }

        frame.setPipeline(this.instanced).setBindGroup(0, this.cameraBinding.group)

        // One draw per layer, in render order, all sharing the same instances -
        // the batch uploads once and the layers reuse it
        for (const layer of SHIP_LAYERS) {
            if (!settings[layer]) continue
            const mesh = this.meshes.get(layer)
            if (mesh) this.batch.draw(frame, mesh)
        }

        if (this.overlay) {
            // Group 0 is re-bound because switching to a pipeline with a different
            // layout is allowed to invalidate what was bound
            frame.setPipeline(this.flat).setBindGroup(0, this.cameraBinding.group)
            this.overlay.draw(frame)
        }

        this.context.stats.set("ships", settings.count)
    }

    dispose(): void {
        for (const mesh of this.meshes.values()) mesh.destroy()
        this.meshes.clear()
        this.overlay?.destroy()
        this.batch.destroy()
        this.cameraBinding.destroy()
    }

    private settings: ViewerValues | null = null
    private labelSpace = 0

    /** Formation geometry, shared by the fit, the instances and the label. */
    private formation(settings: ViewerValues) {
        const columns = Math.ceil(Math.sqrt(settings.count))
        const rows = Math.ceil(settings.count / columns)
        const stepX = this.shipSize.width * settings.spacing
        const stepY = this.shipSize.height * settings.spacing

        return {
            columns,
            rows,
            stepX,
            stepY,
            // One ship of margin so nothing clips at the edges
            halfW: (columns * stepX + this.shipSize.width) / 2,
            halfH: (rows * stepY + this.shipSize.height) / 2,
        }
    }

    private rebuild(settings: ViewerValues): void {
        this.settings = settings

        const gpu = this.context.gpu
        const ship = buildShip(settings.ship)
        this.ship = ship

        const origin: Vec2 = settings.origin === "mass" ? ship.centerOfMass : ship.center

        for (const mesh of this.meshes.values()) mesh.destroy()
        this.meshes.clear()

        for (const layer of SHIP_LAYERS) {
            const builder = new MeshBuilder()
            // Every layer gets the SAME origin, or they drift apart
            appendLayer(builder, ship.layers[layer], CELL, origin)

            if (builder.vertexCount > 0) this.meshes.set(layer, builder.build(gpu, layer))
        }

        const extent = ship.bounds
        this.shipSize = {
            width: Math.max((extent ? extent.maxCol - extent.minCol + 1 : 1) * CELL, 1),
            height: Math.max((extent ? extent.maxRow - extent.minRow + 1 : 1) * CELL, 1),
        }

        this.buildOverlay(settings, ship, origin, CELL)
        this.context.stats.set("ship mass", ship.mass)
    }

    private buildOverlay(settings: ViewerValues, ship: Ship, origin: Vec2, cell: number): void {
        const builder = new MeshBuilder()
        const { halfH } = this.formation(settings)

        // Sized against the formation rather than the cell, so the name stays
        // legible whether there is one ship on screen or four thousand
        const pixel = (halfH * 2 * 0.04) / DEFAULT_FONT.glyphHeight
        const textHeight = DEFAULT_FONT.glyphHeight * pixel
        const gap = textHeight * 0.6

        // Above the whole formation, not above one ship - with a fleet the single
        // ship's top edge is buried somewhere in the middle of the block
        this.labelSpace = textHeight + gap

        const text = ship.name
        DEFAULT_FONT.appendText(
            builder,
            text,
            -DEFAULT_FONT.measureText(text, pixel) / 2,
            -halfH - this.labelSpace,
            pixel,
            LABEL_COLOR,
        )

        if (settings.markers) {
            const size = cell * 0.8

            // The chosen origin sits at (0,0) by construction; the other center is
            // offset by however far the two disagree. Seeing that gap is the point -
            // a ship with heavy engines aft rotates well behind its geometric middle.
            const other = settings.origin === "mass" ? ship.center : ship.centerOfMass
            const otherColor = settings.origin === "mass" ? BOUNDS_COLOR : MASS_COLOR
            const originColor = settings.origin === "mass" ? MASS_COLOR : BOUNDS_COLOR

            appendCross(builder, 0, 0, size, originColor)
            appendCross(builder, (other.x - origin.x) * cell, (other.y - origin.y) * cell, size, otherColor)
        }

        this.overlay?.destroy()
        this.overlay = builder.vertexCount === 0 ? null : builder.build(this.context.gpu, "ship overlay")
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
        "Every layer of a ship, drawn through one instance batch so a fleet costs four " +
        "draw calls whatever its size. Orange marks the center of mass, blue the center " +
        "of the bounding box - spin the ships to see which one they turn about.",
    settings: SETTINGS,
    create: (context) => new ShipViewer(context),
}

export default scene
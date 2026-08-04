import { InstancedBatch, UNIT_QUAD } from "../batch"
import type { Camera } from "../camera"
import type { Grid, RGB } from "../grid"
import { buildGridMesh } from "../gridMesh"
import { buildGridOutline } from "../gridOutline"
import { HULLS, buildHull } from "../hulls"
import { Program } from "../program"
import {
    BASIC_FRAGMENT_SHADER, BASIC_VERTEX_SHADER,
    LIT_FRAGMENT_SHADER, LIT_MESH_VERTEX_SHADER, MESH_VERTEX_SHADER
} from "../shaders"
import { hexToRgb } from "./legacyHull"
import { buildShapeChart } from "./shapeChart"
import { SquaresDemo } from "./squaresDemo"

/**
 * The three things worth looking at while there is no game yet.
 *
 * Each owns its own program and batch and exposes the same tiny interface, so
 * the page just holds one and does not care which it is. They live here rather
 * than in the component to keep demo wiring out of the app shell — and so they
 * can be deleted as a unit once entities arrive.
 */

export type SceneName = "ships" | "chart" | "squares"

/**
 * A set of things a scene can show, for a picker in the UI.
 *
 * Read through getters rather than events: the component that drives this is a
 * Svelte class instance, which is not deep-proxied, so it has to mirror the
 * state into its own `$state` after every call anyway.
 */
export interface SceneViews {
    readonly names: readonly string[]
    readonly index: number
    select(index: number): void
}

/**
 * A light the UI can recolour.
 *
 * Hex rather than a triple because that is what `<input type="color">` speaks,
 * and the scene has to convert somewhere regardless.
 */
export interface SceneLight {
    readonly color: string
    setColor(hex: string): void
}

export interface Scene {
    /** Advances one fixed simulation step. Most scenes are static. */
    simulate(): void
    /** Draws, returning the number of draw calls issued. */
    render(camera: Camera, alpha: number): number
    /** A line of context for the stats overlay. Changes with the selection. */
    readonly description: string
    /** Present only on scenes with more than one thing to show. */
    readonly views?: SceneViews
    /** Present only on scenes that light something. */
    readonly light?: SceneLight
    dispose(): void
}

/** Per-vertex position and colour; per-instance transform. */
const MESH_LAYOUT = {
    base: [{ location: 0, size: 2 }, { location: 1, size: 3 }],
    instance: [{ location: 2, size: 4 }]
}

/** Per-vertex position only; per-instance transform and colour. */
const QUAD_LAYOUT = {
    base: [{ location: 0, size: 2 }],
    instance: [{ location: 1, size: 4 }, { location: 2, size: 3 }]
}

/** As MESH_LAYOUT, plus the cell centre the lit shader shades by. */
const LIT_LAYOUT = {
    base: [{ location: 0, size: 2 }, { location: 1, size: 3 }, { location: 2, size: 2 }],
    instance: [{ location: 3, size: 4 }]
}

/** One hull, tessellated both ways. */
interface HullView {
    name: string
    grid: Grid
    mesh: Float32Array
    /** The same geometry with cell centres attached, for the lit copy. */
    litMesh: Float32Array
    outline: Float32Array
    /** Corner-to-corner size in world units — what the layout is spaced by. */
    diagonal: number
}

const SHIP_CELL_SIZE = 24

/** Gap between the three copies, as a fraction of the hull's diagonal. */
const SHIP_GAP = 0.15

/**
 * One colour for the whole wireframe, matching the stats overlay.
 *
 * Per-block colours made it read as a third ship rather than as a diagram of
 * the other two.
 */
const WIRE_COLOR = [0, 0.867, 1] as const

/** Where the light sits relative to the lit copy, as a fraction of its diagonal. */
const LIGHT_OFFSET = { x: -0.5, y: -0.5 }

/** Distance at which illumination has fallen by half, relative to the hull. */
const LIGHT_RANGE = 1.5

const LIGHT_INTENSITY = 1

/** A warm white, so the effect reads as light rather than as a colour wash. */
const DEFAULT_LIGHT_COLOR = "#fffbe6"

/**
 * The Canvas2D engine's DEFAULT_SHADE_SETTINGS, unchanged.
 *
 * Kept as the same four ratios plus a bounce colour rather than being retuned
 * for the new renderer: the shading model is identical, so the numbers that
 * looked right there look right here.
 */
const SHADING = {
    contrast: 0.55,
    shadowDepth: 0.45,
    tint: 0.22,
    ambientBleed: 0.16,
    /** Bounced into shadows so unlit faces are not dead grey. rgb(40, 70, 130). */
    ambientColor: [40 / 255, 70 / 255, 130 / 255] as const
}

/**
 * Every hull in engine/hulls, one at a time, shown three ways at one scale:
 * flat so the shapes can be read, spinning under a point light so the shading
 * can be, and as a wireframe of the blocks so the tessellation is visible.
 *
 * The lit copy is a separate batch on a separate program — the flat and lit
 * shaders take different varyings, so they cannot share one draw. Switching
 * hulls swaps the geometry in all three batches, so paging is free.
 */
class ShipScene implements Scene, SceneViews, SceneLight {
    private readonly flatProgram: Program
    private readonly litProgram: Program

    private readonly solid: InstancedBatch
    private readonly lit: InstancedBatch
    private readonly wire: InstancedBatch

    private readonly hulls: HullView[]
    private selected = 0

    private lightColor: RGB = hexToRgb(DEFAULT_LIGHT_COLOR)
    private lightHex = DEFAULT_LIGHT_COLOR

    constructor(gl2: WebGL2RenderingContext) {
        // Tessellating every hull up front is microseconds for a handful of
        // ships and makes paging instant.
        this.hulls = HULLS.map(entry => {
            const grid = buildHull(entry.id)
            const extent = grid.extent

            return {
                name: entry.name,
                grid,
                mesh: buildGridMesh(grid, SHIP_CELL_SIZE),
                litMesh: buildGridMesh(grid, SHIP_CELL_SIZE, true),
                outline: buildGridOutline(grid, SHIP_CELL_SIZE, WIRE_COLOR),
                diagonal: Math.hypot(extent.width, extent.height) * SHIP_CELL_SIZE
            }
        })

        if (this.hulls.length === 0) throw new Error("no hulls in engine/hulls")

        const first = this.hulls[0]

        this.flatProgram = new Program(gl2, MESH_VERTEX_SHADER, BASIC_FRAGMENT_SHADER)
        this.litProgram = new Program(gl2, LIT_MESH_VERTEX_SHADER, LIT_FRAGMENT_SHADER)

        this.solid = new InstancedBatch(
            gl2, first.mesh, MESH_LAYOUT.base, MESH_LAYOUT.instance, 1
        )
        // Its own layout and geometry: the lit shader shades by cell centre,
        // which the flat one has no use for and does not pay for.
        this.lit = new InstancedBatch(
            gl2, first.litMesh, LIT_LAYOUT.base, LIT_LAYOUT.instance, 1
        )
        this.wire = new InstancedBatch(
            gl2, first.outline, MESH_LAYOUT.base, MESH_LAYOUT.instance, 1, gl2.LINES
        )
    }

    // --- SceneLight ------------------------------------------------------

    get light(): SceneLight {
        return this
    }

    get color(): string {
        return this.lightHex
    }

    setColor(hex: string) {
        try {
            this.lightColor = hexToRgb(hex)
            this.lightHex = hex
        } catch {
            // A half-typed value from a text input is not worth breaking on.
        }
    }

    // --- SceneViews ------------------------------------------------------

    /** The scene is its own picker; there is nothing else for one to hold. */
    get views(): SceneViews {
        return this
    }

    get names(): readonly string[] {
        return this.hulls.map(hull => hull.name)
    }

    get index(): number {
        return this.selected
    }

    /** Wraps, so the caller can page with a bare index either way. */
    select(index: number) {
        const count = this.hulls.length
        this.selected = ((index % count) + count) % count

        const hull = this.hulls[this.selected]
        this.solid.setBaseGeometry(hull.mesh)
        this.lit.setBaseGeometry(hull.litMesh)
        this.wire.setBaseGeometry(hull.outline)
    }

    // --- Scene -----------------------------------------------------------

    get description(): string {
        const hull = this.hulls[this.selected]

        return `${hull.name} · ${hull.mesh.length / 5 / 3} triangles · ` +
            `${hull.grid.count} cells · ${hull.grid.extent.width}×${hull.grid.extent.height} · ` +
            `${hull.outline.length / 5 / 2} outline segments`
    }

    simulate() {}

    render(camera: Camera): number {
        const hull = this.hulls[this.selected]
        const step = hull.diagonal * (1 + SHIP_GAP)

        const width = Math.max(1, camera.viewportWidth)
        const height = Math.max(1, camera.viewportHeight)

        // Refit every frame: the canvas has no layout at construction time, and
        // this keeps all three framed through resizes and hull changes. Sized
        // from the diagonal so the spinning copy never clips its own corners.
        //
        // Both arrangements are measured and the roomier one wins, rather than
        // switching on an aspect-ratio threshold — a tall hull in a wide window
        // can still prefer a column, and this gets that right for free.
        const acrossZoom = Math.min(width / (step * 3), height / hull.diagonal)
        const downZoom = Math.min(width / hull.diagonal, height / (step * 3))

        const across = acrossZoom >= downZoom
        camera.x = 0
        camera.y = 0
        camera.zoom = Math.max(acrossZoom, downZoom) * 0.9

        /** Places a copy along whichever axis the layout runs down. */
        const place = (batch: InstancedBatch, offset: number, rotation: number) =>
            batch.addTransform(across ? offset : 0, across ? 0 : offset, rotation, 1)

        this.solid.begin()
        place(this.solid, -step, 0)

        this.lit.begin()
        place(this.lit, 0, performance.now() / 3000)

        this.wire.begin()
        place(this.wire, step, 0)

        this.flatProgram.use()
        this.flatProgram.setMatrix4("uProjection", camera.projection)

        const flatCalls = this.solid.draw() + this.wire.draw()

        // The light sits beside the lit copy, which is at the layout's centre,
        // so a fixed light plus a turning hull sweeps the bright side around.
        this.litProgram.use()
        this.litProgram.setMatrix4("uProjection", camera.projection)

        this.litProgram.setVec2(
            "uLightPos",
            hull.diagonal * LIGHT_OFFSET.x,
            hull.diagonal * LIGHT_OFFSET.y
        )
        this.litProgram.setVec3("uLightColor", ...this.lightColor)
        this.litProgram.setFloat("uLightIntensity", LIGHT_INTENSITY)
        this.litProgram.setFloat("uLightRange", hull.diagonal * LIGHT_RANGE)

        // Cells at the hull's bounding radius take full contrast.
        this.litProgram.setFloat("uShadingRadius", hull.diagonal / 2)

        this.litProgram.setFloat("uContrast", SHADING.contrast)
        this.litProgram.setFloat("uShadowDepth", SHADING.shadowDepth)
        this.litProgram.setFloat("uTint", SHADING.tint)
        this.litProgram.setFloat("uAmbientBleed", SHADING.ambientBleed)
        this.litProgram.setVec3("uAmbientColor", ...SHADING.ambientColor)

        return flatCalls + this.lit.draw()
    }

    dispose() {
        this.solid.dispose()
        this.lit.dispose()
        this.wire.dispose()
        this.flatProgram.dispose()
        this.litProgram.dispose()
    }
}

/** Every shape at every orientation — the tessellator's proof sheet. */
class ChartScene implements Scene {
    readonly description: string

    private readonly program: Program
    private readonly batch: InstancedBatch
    private readonly chart = buildShapeChart()

    constructor(gl2: WebGL2RenderingContext) {
        this.program = new Program(gl2, MESH_VERTEX_SHADER, BASIC_FRAGMENT_SHADER)
        this.batch = new InstancedBatch(
            gl2, this.chart.vertices, MESH_LAYOUT.base, MESH_LAYOUT.instance, 1
        )

        this.description =
            `rows: ${this.chart.shapes.join(" / ")}\n` +
            `columns: 0° 90° 180° 270°  |  mirrored 0° 90° 180° 270°`
    }

    simulate() {}

    render(camera: Camera): number {
        // Refit every frame: the canvas has no layout at construction time, and
        // this keeps the chart framed through window resizes.
        camera.x = this.chart.width / 2
        camera.y = this.chart.height / 2
        camera.zoom = Math.min(
            Math.max(1, camera.viewportWidth) / this.chart.width,
            Math.max(1, camera.viewportHeight) / this.chart.height
        ) * 0.85

        this.batch.begin()
        this.batch.addTransform(0, 0, 0, 1)

        this.program.use()
        this.program.setMatrix4("uProjection", camera.projection)
        return this.batch.draw()
    }

    dispose() {
        this.batch.dispose()
        this.program.dispose()
    }
}

/** The instancing performance baseline. */
class SquaresScene implements Scene {
    readonly description: string

    private readonly program: Program
    private readonly batch: InstancedBatch
    private readonly demo = new SquaresDemo()

    constructor(gl2: WebGL2RenderingContext) {
        this.program = new Program(gl2, BASIC_VERTEX_SHADER, BASIC_FRAGMENT_SHADER)
        this.batch = new InstancedBatch(
            gl2, UNIT_QUAD, QUAD_LAYOUT.base, QUAD_LAYOUT.instance, this.demo.count
        )

        this.description = `${this.demo.count} instances`
    }

    simulate() {
        this.demo.simulate()
    }

    render(camera: Camera, alpha: number): number {
        this.batch.begin()
        this.demo.submit(this.batch, alpha)

        this.program.use()
        this.program.setMatrix4("uProjection", camera.projection)
        return this.batch.draw()
    }

    dispose() {
        this.batch.dispose()
        this.program.dispose()
    }
}

export function createScene(name: SceneName, gl2: WebGL2RenderingContext): Scene {
    switch (name) {
        case "ships": return new ShipScene(gl2)
        case "chart": return new ChartScene(gl2)
        case "squares": return new SquaresScene(gl2)
    }
}

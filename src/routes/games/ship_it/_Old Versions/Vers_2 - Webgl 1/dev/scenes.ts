import { InstancedBatch, UNIT_QUAD } from "../batch"
import type { Camera } from "../camera"
import type { Grid, RGB } from "../grid"
import { buildGridMesh } from "../gridMesh"
import { buildGridOutline } from "../gridOutline"
import { HULLS, buildHull } from "../hulls"
import { Program } from "../program"
import {
    BASIC_FRAGMENT_SHADER, BASIC_VERTEX_SHADER, MESH_VERTEX_SHADER,
    meshShader, type MeshShaderDef
} from "../shaders"
import { hexToRgb } from "../color"
import { DEFAULTS, type Settings } from "../settings"
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

export interface Scene {
    /** Advances one fixed simulation step. Most scenes are static. */
    simulate(): void
    /** Draws, returning the number of draw calls issued. */
    render(camera: Camera, alpha: number): number
    /** A line of context for the stats overlay. Changes with the selection. */
    readonly description: string
    /** Present only on scenes with more than one thing to show. */
    readonly views?: SceneViews
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

/** One hull, tessellated both ways. */
interface HullView {
    name: string
    id: string
    grid: Grid
    mesh: Float32Array
    /** The same geometry with cell centres attached, for the lit copy. */
    litMesh: Float32Array
    outline: Float32Array
    /** Corner-to-corner size in world units — what the layout is spaced by. */
    diagonal: number
}

/**
 * Caches one hex → RGB conversion.
 *
 * Colours arrive as hex because that is what the settings file and the colour
 * inputs speak, and they are read every frame to fill uniforms. Parsing six
 * characters is cheap, but doing it three times a frame forever to get the same
 * answer is silly.
 */
class ColorMemo {
    private hex = ""
    private rgb: RGB = [1, 1, 1]

    of(hex: string): RGB {
        if (hex === this.hex) return this.rgb

        try {
            this.rgb = hexToRgb(hex)
            this.hex = hex
        } catch {
            // A half-typed value from a text input is not worth breaking on;
            // keep showing the last good colour.
        }

        return this.rgb
    }
}

/**
 * Every hull in engine/hulls, one at a time, shown three ways at one scale:
 * flat so the shapes can be read, spinning under a point light so the shading
 * can be, and as a wireframe of the blocks so the tessellation is visible.
 *
 * The lit copy is a separate batch on a separate program — the flat and lit
 * shaders take different varyings, so they cannot share one draw. Switching
 * hulls swaps the geometry in all three batches, so paging is free.
 *
 * Settings are read live: light and shading values reach the uniforms on the
 * next frame. The two that are baked into geometry — cell size and the
 * wireframe colour — are read once here, and the page rebuilds the scene when
 * they change rather than this tracking which mesh went stale.
 */
class ShipScene implements Scene, SceneViews {
    private readonly flatProgram: Program
    private readonly litProgram: Program

    private readonly solid: InstancedBatch
    private readonly lit: InstancedBatch
    private readonly wire: InstancedBatch

    private readonly hulls: HullView[]
    private selected = 0

    /** Which shader draws the middle copy. Fixed for this scene's lifetime. */
    private readonly shader: MeshShaderDef

    private readonly lightColor = new ColorMemo()
    private readonly ambientColor = new ColorMemo()

    constructor(
        gl2: WebGL2RenderingContext,
        private readonly settings: Settings
    ) {
        const cellSize = this.number("scene.cellSize")
        const wireColor = hexToRgb(String(settings["scene.wireColor"] ?? "#00ddff"))

        // Falls back rather than throwing: a settings file naming a shader that
        // has since been removed should cost the effect, not the page.
        try {
            this.shader = meshShader(String(settings["scene.shader"]))
        } catch {
            this.shader = meshShader(String(DEFAULTS["scene.shader"]))
        }

        // Tessellating every hull up front is microseconds for a handful of
        // ships and makes paging instant.
        this.hulls = HULLS.map(entry => {
            const grid = buildHull(entry.id)
            const extent = grid.extent

            return {
                name: entry.name,
                id: entry.id,
                grid,
                mesh: buildGridMesh(grid, cellSize),
                litMesh: buildGridMesh(grid, cellSize, true),
                outline: buildGridOutline(grid, cellSize, wireColor),
                diagonal: Math.hypot(extent.width, extent.height) * cellSize
            }
        })

        if (this.hulls.length === 0) throw new Error("no hulls in engine/hulls")

        const startAt = this.hulls.findIndex(hull => hull.id === settings["scene.hullId"])
        if (startAt >= 0) this.selected = startAt

        const first = this.hulls[this.selected]

        this.flatProgram = new Program(gl2, MESH_VERTEX_SHADER, BASIC_FRAGMENT_SHADER)
        this.litProgram = new Program(gl2, this.shader.vertex, this.shader.fragment)

        this.solid = new InstancedBatch(
            gl2, first.mesh, MESH_LAYOUT.base, MESH_LAYOUT.instance, 1
        )
        // Layout and geometry both come from the chosen shader: the lit one
        // shades by cell centre, which the flat one has no use for and does not
        // pay to carry.
        this.lit = new InstancedBatch(
            gl2,
            this.shader.needsCellCentres ? first.litMesh : first.mesh,
            this.shader.base, this.shader.instance,
            1
        )
        this.wire = new InstancedBatch(
            gl2, first.outline, MESH_LAYOUT.base, MESH_LAYOUT.instance, 1, gl2.LINES
        )
    }

    /** A setting as a number, falling back to the shipped default. */
    private number(key: string): number {
        const value = this.settings[key]
        return typeof value === "number" ? value : Number(DEFAULTS[key])
    }

    /** A setting as a hex colour string. */
    private color(key: string): string {
        const value = this.settings[key]
        return typeof value === "string" ? value : String(DEFAULTS[key])
    }

    /** The hull the picker is on, for the page to persist. */
    get selectedId(): string {
        return this.hulls[this.selected].id
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
        this.lit.setBaseGeometry(this.shader.needsCellCentres ? hull.litMesh : hull.mesh)
        this.wire.setBaseGeometry(hull.outline)
    }

    // --- Scene -----------------------------------------------------------

    get description(): string {
        const hull = this.hulls[this.selected]

        const blend = this.shader.lit ? ` (${this.settings["shading.blend"]})` : ""

        return `${hull.name} · ${hull.mesh.length / 5 / 3} triangles · ` +
            `${hull.grid.count} cells · ${hull.grid.extent.width}×${hull.grid.extent.height} · ` +
            `${hull.outline.length / 5 / 2} outline segments · ` +
            `${this.shader.label}${blend}`
    }

    simulate() {}

    render(camera: Camera): number {
        const hull = this.hulls[this.selected]
        const step = hull.diagonal * (1 + this.number("scene.gap"))

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

        this.litProgram.use()
        this.litProgram.setMatrix4("uProjection", camera.projection)

        // Only the lit shader has these, and asking an unlit program for a
        // uniform it does not declare is a console warning per frame.
        if (this.shader.lit) {
            // The light sits beside this copy, which is at the layout's centre,
            // so a fixed light plus a turning hull sweeps the bright side round.
            this.litProgram.setVec2(
                "uLightPos",
                hull.diagonal * this.number("light.offsetX"),
                hull.diagonal * this.number("light.offsetY")
            )
            this.litProgram.setVec3("uLightColor", ...this.lightColor.of(this.color("light.color")))
            this.litProgram.setFloat("uLightIntensity", this.number("light.intensity"))
            this.litProgram.setFloat("uLightRange", hull.diagonal * this.number("light.range"))

            // Cells at the hull's bounding radius take full contrast.
            this.litProgram.setFloat("uShadingRadius", hull.diagonal / 2)

            this.litProgram.setFloat("uContrast", this.number("shading.contrast"))
            this.litProgram.setFloat("uShadowDepth", this.number("shading.shadowDepth"))
            this.litProgram.setFloat("uTint", this.number("shading.tint"))
            this.litProgram.setFloat("uAmbientBleed", this.number("shading.ambientBleed"))
            this.litProgram.setVec3(
                "uAmbientColor",
                ...this.ambientColor.of(this.color("shading.ambientColor"))
            )

            this.litProgram.setFloat(
                "uMultiply",
                this.settings["shading.blend"] === "multiply" ? 1 : 0
            )
        }

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

export function createScene(
    name: SceneName,
    gl2: WebGL2RenderingContext,
    settings: Settings = DEFAULTS
): Scene {
    switch (name) {
        case "ships": return new ShipScene(gl2, settings)
        case "chart": return new ChartScene(gl2)
        case "squares": return new SquaresScene(gl2)
    }
}

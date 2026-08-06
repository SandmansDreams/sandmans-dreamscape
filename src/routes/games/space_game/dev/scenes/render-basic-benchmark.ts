import type { DevSceneDefinition, DevSceneInstance, SceneContext } from "../DevScene"
import type { Settings } from "../../settings"
import {
    INSTANCED_2D_VERTEX_SOURCE,
    MINIMAL_2D_FRAGMENT_SOURCE,
    MINIMAL_2D_VERTEX_SOURCE,
    Program,
    Shader,
} from "../../render/shaders"
import { Mesh, MeshBuilder } from "../../render/mesh"
import { quad } from "../../render/shapes"
import { orthographic2D, spriteTransform2D } from "../../render/transform"
import {
    INST_COLOR,
    INST_OFFSET,
    INST_ROTATION,
    INST_VERTEX,
    InstancedBatch,
    UNIT_QUAD,
} from "../../render/batch"

const STEP = 1 / 60             // fixed simulation step, seconds
const MAX_STEPS = 5             // spiral-of-death guard
const FLOATS_PER_SQUARE = 30    // 6 vertices x [x, y, r, g, b]
const BASE_VIEW_HEIGHT = 800    // world units visible vertically at zoom 1

type Mode = "instanced" | "batched" | "per-mesh"

class SquaresScene implements DevSceneInstance {
    private readonly simple: Program    // per-vertex colour, one transform per draw
    private readonly instanced: Program // per-instance transform and colour
    private readonly gl2: WebGL2RenderingContext

    // Only the resources for the active mode are alive at any moment.
    private meshes: Mesh[] = []         // per-mesh
    private batchedMesh: Mesh | null = null
    private batchedData: Float32Array | null = null
    private batch: InstancedBatch | null = null

    private mode: Mode = "instanced"
    private builtMode: Mode | null = null
    private count = 0
    private builtCount = -1

    private posX = new Float64Array(0)
    private posY = new Float64Array(0)
    private prevX = new Float64Array(0)
    private prevY = new Float64Array(0)
    private velX = new Float64Array(0)
    private velY = new Float64Array(0)
    private rot = new Float64Array(0)
    private prevRot = new Float64Array(0)
    private rotVel = new Float64Array(0)
    private color = new Float32Array(0)

    private readonly scratch = new Float32Array(9) // reused every square
    private accumulator = 0
    private alpha = 0

    private readonly bound = 2000 // half-extent of the wrapping field, world units
    private size = 5
    private zoom = 1

    /** Fewer world units on screen means a closer view, so zoom divides. */
    private get viewHeight() {
        return BASE_VIEW_HEIGHT / this.zoom
    }

    constructor(
        private readonly context: SceneContext
        
    ) {
        this.gl2 = context.gl2

        this.simple = new Program(this.gl2, [
            new Shader(this.gl2, this.gl2.VERTEX_SHADER, MINIMAL_2D_VERTEX_SOURCE),
            new Shader(this.gl2, this.gl2.FRAGMENT_SHADER, MINIMAL_2D_FRAGMENT_SOURCE),
        ])

        this.instanced = new Program(this.gl2, [
            new Shader(this.gl2, this.gl2.VERTEX_SHADER, INSTANCED_2D_VERTEX_SOURCE),
            new Shader(this.gl2, this.gl2.FRAGMENT_SHADER, MINIMAL_2D_FRAGMENT_SOURCE),
        ])
    }

    update(dt: number, settings: Settings) {
        const count = settings.number("count")
        const mode = settings.string("mode") as Mode

        const countChanged = count !== this.builtCount
        if (count !== this.builtCount) {
            this.reseed(count)   // must run first - buildFor() reads this.color
            this.builtCount = count
        }

        if (countChanged || mode !== this.builtMode) {
            this.buildFor(mode, count)
        }

        this.mode = mode
        this.size = settings.number("size")
        this.zoom = settings.number("zoom")

        // Fixed-step integration, interpolated at render time
        this.accumulator += dt

        let steps = 0
        while (this.accumulator >= STEP && steps < MAX_STEPS) {
            this.simulate()
            this.accumulator -= STEP
            steps++
        }

        this.alpha = this.accumulator / STEP
    }

    render() {
        switch (this.mode) {
            case "per-mesh": return this.renderPerMesh()
            case "batched":  return this.renderBatched()
            default:         return this.renderInstanced()
        }
    }

    dispose() {
        this.releaseModeResources()
        this.simple.dispose()
        this.instanced.dispose()
    }

    /*~~~ Simulation ~~~*/

    private reseed(count: number) {
        this.count = count

        this.posX = new Float64Array(count)
        this.posY = new Float64Array(count)
        this.prevX = new Float64Array(count)
        this.prevY = new Float64Array(count)
        this.velX = new Float64Array(count)
        this.velY = new Float64Array(count)
        this.rot = new Float64Array(count)
        this.prevRot = new Float64Array(count)
        this.rotVel = new Float64Array(count)
        this.color = new Float32Array(count * 3)

        for (let i = 0; i < count; i++) {
            // prev must match pos, or the first frame interpolates from the
            // origin and every square streaks in from the middle.
            this.posX[i] = this.prevX[i] = (Math.random() * 2 - 1) * this.bound
            this.posY[i] = this.prevY[i] = (Math.random() * 2 - 1) * this.bound

            this.velX[i] = (Math.random() * 2 - 1) * 1.5
            this.velY[i] = (Math.random() * 2 - 1) * 1.5

            this.rot[i] = this.prevRot[i] = Math.random() * Math.PI * 2
            this.rotVel[i] = (Math.random() * 2 - 1) * 0.05

            // Floored at 0.3 so nothing comes out near-black against the backdrop.
            this.color[i * 3 + 0] = 0.3 + Math.random() * 0.7
            this.color[i * 3 + 1] = 0.3 + Math.random() * 0.7
            this.color[i * 3 + 2] = 0.3 + Math.random() * 0.7
        }
    }

    private simulate() {
        const bound = this.bound
        const span = bound * 2

        for (let i = 0; i < this.count; i++) {
            this.prevX[i] = this.posX[i]
            this.prevY[i] = this.posY[i]
            this.prevRot[i] = this.rot[i]

            this.posX[i] += this.velX[i]
            this.posY[i] += this.velY[i]
            this.rot[i] += this.rotVel[i]

            // Wrap prev alongside pos, or interpolation draws a streak across
            // the whole world on the frame something wraps.
            if (this.posX[i] > bound) { this.posX[i] -= span; this.prevX[i] -= span }
            if (this.posX[i] < -bound) { this.posX[i] += span; this.prevX[i] += span }
            if (this.posY[i] > bound) { this.posY[i] -= span; this.prevY[i] -= span }
            if (this.posY[i] < -bound) { this.posY[i] += span; this.prevY[i] += span }
        }
    }

    /*~~~ Mode resources ~~~*/

    private releaseModeResources() {
        for (const mesh of this.meshes) mesh.dispose()
        this.meshes = []

        this.batchedMesh?.dispose()
        this.batchedMesh = null
        this.batchedData = null

        this.batch?.dispose()
        this.batch = null
    }

    private buildFor(mode: Mode, count: number) {
        this.releaseModeResources()
        const gl2 = this.context.gl2

        if (mode === "per-mesh") {
            // One mesh each: a unit quad at the origin carrying only its colour.
            // Position, rotation and size all arrive later via u_Transform.
            for (let i = 0; i < count; i++) {
                this.meshes.push(
                    new MeshBuilder()
                        .add(quad(0, 0, 1), [
                            this.color[i * 3],
                            this.color[i * 3 + 1],
                            this.color[i * 3 + 2],
                        ])
                        .build(gl2)
                )
            }
        } else if (mode === "batched") {
            // One buffer holding every square's world-space vertices, rewritten
            // each frame. DYNAMIC_DRAW because that is exactly the access pattern.
            this.batchedData = new Float32Array(count * FLOATS_PER_SQUARE)
            this.batchedMesh = new Mesh(gl2, this.batchedData, gl2.DYNAMIC_DRAW)
        } else {
            this.batch = new InstancedBatch(
                gl2,
                UNIT_QUAD,
                [{ location: INST_VERTEX, size: 2 }],
                [
                    { location: INST_OFFSET, size: 2 },
                    { location: INST_ROTATION, size: 2 },
                    { location: INST_COLOR, size: 3 },
                ],
                count,
            )
        }

        this.builtMode = mode
    }

    /*~~~ Render paths ~~~*/

    private renderPerMesh() {
        const { gl2, canvas } = this.context
        const aspect = canvas.width / canvas.height

        this.simple.use()

        // Hoisted: uniform() is a Map lookup, and this runs N times a frame
        const location = this.simple.uniform("u_Transform")
        const a = this.alpha

        for (let i = 0; i < this.meshes.length; i++) {
            const x = this.prevX[i] + (this.posX[i] - this.prevX[i]) * a
            const y = this.prevY[i] + (this.posY[i] - this.prevY[i]) * a
            const r = this.prevRot[i] + (this.rot[i] - this.prevRot[i]) * a

            gl2.uniformMatrix3fv(
                location,
                false,
                spriteTransform2D(x, y, r, this.size, this.viewHeight, aspect, this.scratch),
            )
            this.meshes[i].draw()
        }
    }

    private renderBatched() {
        const { gl2, canvas } = this.context
        const data = this.batchedData
        const mesh = this.batchedMesh
        if (!data || !mesh) return

        const a = this.alpha
        const h = this.size / 2
        let o = 0

        for (let i = 0; i < this.count; i++) {
            const x = this.prevX[i] + (this.posX[i] - this.prevX[i]) * a
            const y = this.prevY[i] + (this.posY[i] - this.prevY[i]) * a
            const r = this.prevRot[i] + (this.rot[i] - this.prevRot[i]) * a

            // Rotating a corner (lx, ly) by r and scaling by h:
            //   wx = x + lx*c - ly*s,  wy = y + lx*s + ly*c
            const c = Math.cos(r) * h
            const s = Math.sin(r) * h

            const ax = x - c + s, ay = y - s - c // (-1, -1)
            const bx = x + c + s, by = y + s - c // ( 1, -1)
            const cx = x + c - s, cy = y + s + c // ( 1,  1)
            const dx = x - c - s, dy = y - s + c // (-1,  1)

            const cr = this.color[i * 3]
            const cg = this.color[i * 3 + 1]
            const cb = this.color[i * 3 + 2]

            data[o++] = ax; data[o++] = ay; data[o++] = cr; data[o++] = cg; data[o++] = cb
            data[o++] = bx; data[o++] = by; data[o++] = cr; data[o++] = cg; data[o++] = cb
            data[o++] = cx; data[o++] = cy; data[o++] = cr; data[o++] = cg; data[o++] = cb

            data[o++] = ax; data[o++] = ay; data[o++] = cr; data[o++] = cg; data[o++] = cb
            data[o++] = cx; data[o++] = cy; data[o++] = cr; data[o++] = cg; data[o++] = cb
            data[o++] = dx; data[o++] = dy; data[o++] = cr; data[o++] = cg; data[o++] = cb
        }

        mesh.update(data)

        this.simple.use()
        gl2.uniformMatrix3fv(
            this.simple.uniform("u_Transform"),
            false,
            orthographic2D(this.viewHeight, canvas.width / canvas.height),
        )
        mesh.draw()
    }

    private renderInstanced() {
        const { gl2, canvas } = this.context
        const batch = this.batch
        if (!batch) return

        this.instanced.use()
        gl2.uniformMatrix3fv(
            this.instanced.uniform("u_Transform"),
            false,
            orthographic2D(this.viewHeight, canvas.width / canvas.height),
        )

        batch.begin()

        const a = this.alpha
        for (let i = 0; i < this.count; i++) {
            batch.add(
                this.prevX[i] + (this.posX[i] - this.prevX[i]) * a,
                this.prevY[i] + (this.posY[i] - this.prevY[i]) * a,
                this.prevRot[i] + (this.rot[i] - this.prevRot[i]) * a,
                this.size,
                this.color[i * 3], this.color[i * 3 + 1], this.color[i * 3 + 2],
            )
        }

        batch.draw()
    }
}

const scene: DevSceneDefinition = {
    id: "render-basic-benchmark",
    name: "Basic Squares Benchmark",
    description: "The same field of squares drawn three ways. Instanced is one draw call; batched rebuilds one buffer per frame; per-mesh issues three GL calls per square and will stall hard at high counts.",
    settings: [
        { type: "selection", key: "mode",   label: "Draw mode", default: "instanced",
          options: ["instanced", "batched", "per-mesh"] },
        { type: "range", key: "count",      label: "Squares", default: 1000,   min: 100,   max: 500000,   step: 10},
        { type: "range", key: "size", label: "Size", default: 5, min: 1,   max: 40, step: 1 },
        { type: "range", key: "zoom", label: "Zoom", default: 1, min: 0.2, max: 4,  step: 0.05 },
    ],
    create: (context: SceneContext) => new SquaresScene(context),
}

export default scene

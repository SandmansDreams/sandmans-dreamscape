import type { SceneContext, SceneDefinition, SceneInstance } from "../../game/scene"
import { Camera } from "../../render/camera"
import { Color } from "../../render/color"
import { MeshBuilder, type Mesh } from "../../render/mesh"
import { InstanceBatch } from "../../render/webGPU/instancedbatch"
import type { Frame } from "../../render/webGPU/render"
import { type SettingsSchema, type ValuesOf, defaultValues } from "../../settings/settings"

const SETTINGS = {
    count:  { type: "range", label: "Quads",  default: 5000, min: 100, max: 200000, step: 100 },
    size:   { type: "range", label: "Size",   default: 14,   min: 1,   max: 60,     step: 1 },
    spread: { type: "range", label: "Spread", default: 0.12, min: 0.02, max: 0.6,   step: 0.01 },
    spin:   { type: "range", label: "Spin",   default: 1,    min: 0,   max: 4,      step: 0.05 },
    zoom:   { type: "range", label: "Zoom",   default: 1,    min: 0.1, max: 3,      step: 0.05 },
} as const satisfies SettingsSchema

type QuadValues = ValuesOf<typeof SETTINGS>

class InstancedQuads implements SceneInstance<QuadValues> {
    private readonly context: SceneContext
    private readonly camera = new Camera()
    private readonly quad: Mesh
    private readonly batch: InstanceBatch

    private elapsed = 0
    private settings = defaultValues(SETTINGS) as QuadValues

    constructor(context: SceneContext) {
        this.context = context
        const renderer = context.renderer

        // 1x1 white, centered, so the instance transform scales about its middle and
        // the instance color comes through unchanged
        this.quad = new MeshBuilder().quad(-0.5, -0.5, 1, 1, Color.grey(1)).build(renderer, "unit quad")

        this.batch = InstanceBatch.create(renderer, context.pipelines.instanceLayout, 1024, "quads")
    }

    update(dt: number, settings: QuadValues): void {
        this.settings = settings
        this.elapsed += dt

        const stats = this.context.stats
        stats.begin("build instances")

        // reserve() up front so a raised count grows once rather than mid-loop
        this.batch.begin().reserve(settings.count)

        for (let i = 0; i < settings.count; i++) {
            const angle = i * 0.1 + this.elapsed * settings.spin
            const radius = 20 + i * settings.spread

            this.batch.add(
                Math.cos(angle) * radius,
                Math.sin(angle) * radius,
                angle * 2,
                settings.size,
                0.5 + 0.5 * Math.sin(i * 0.03),
                0.5 + 0.5 * Math.sin(i * 0.03 + 2),
                0.5 + 0.5 * Math.sin(i * 0.03 + 4),
            )
        }

        stats.end("build instances")
        stats.set("instances", this.batch.size)
    }

    render(frame: Frame): void {
        const renderer = this.context.renderer
        this.camera.zoom = this.settings.zoom

        const { camera, instanced } = this.context.pipelines
        camera.upload(this.camera, renderer.width, renderer.height)

        frame.setPipeline(instanced).setBindGroup(0, camera.group)
        this.batch.draw(frame, this.quad)
    }

    dispose(): void {
        this.batch.destroy()
        this.quad.destroy()
    }
}

const scene: SceneDefinition<QuadValues> = {
    id: "instanced-quads-spiral",
    name: "Instanced Quad Spiral",
    description:
        "One unit quad drawn N times from a storage buffer. Raise the count until " +
        "'build instances' goes amber - the GPU pass will barely move.",
    settings: SETTINGS,
    create: (context) => new InstancedQuads(context),
}

export default scene
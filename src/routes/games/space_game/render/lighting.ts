// Group 1: the shading settings, and one aggregate light per instance

import { Buffer } from "./webgpu/buffer"
import type { GPU } from "./webgpu/gpu"
import type { ShadingSettings, SurfaceLight } from "../game/lighting"

/** direction.xy, intensity, reach, tint.rgba */
export const FLOATS_PER_SURFACE = 8

/** knobs.xyzw, ambient.rgb + multiply */
const SHADING_FLOATS = 8

/** How much spare room a reallocation buys, matching InstanceBatch. */
const GROWTH_FACTOR = 1.5

/**
 * What the lit pipeline binds at group 1.
 *
 * Per instance rather than one light condition per draw, because a uniform
 * rewritten between two draws is read by both: `queue.writeBuffer` is ordered
 * against submit, not against the draws recorded between the writes. Two ships
 * lit differently in one frame is the ordinary case, not the exotic one, so the
 * per-hull data has to be indexed rather than swapped.
 *
 * Filled in the same order as the InstanceBatch it accompanies - entry `i` is
 * the light on instance `i` - which is why both are filled in one loop.
 */
export class LightBinding {
    readonly layout: GPUBindGroupLayout

    private readonly gpu: GPU
    private readonly label: string
    private readonly shadingBuffer: Buffer
    private readonly shading = new Float32Array(SHADING_FLOATS)

    private surfaces: Float32Array<ArrayBuffer>
    private surfaceBuffer: Buffer
    private bindGroup: GPUBindGroup
    private count = 0

    private constructor(gpu: GPU, layout: GPUBindGroupLayout, label: string, capacity: number) {
        this.gpu = gpu
        this.layout = layout
        this.label = label

        this.shadingBuffer = Buffer.makeUniformBuffer(gpu, SHADING_FLOATS * 4, `${label} shading`)
        this.surfaces = new Float32Array(capacity * FLOATS_PER_SURFACE)
        this.surfaceBuffer = Buffer.makeStorageBuffer(gpu, this.surfaces.byteLength, `${label} surfaces`)
        this.bindGroup = this.makeGroup()
    }

    static layoutFor(gpu: GPU, label = "lighting"): GPUBindGroupLayout {
        return gpu.device.createBindGroupLayout({
            label: `${label} layout`,
            entries: [
                {
                    binding: 0,
                    visibility: GPUShaderStage.VERTEX,
                    buffer: { type: "uniform" },
                },
                {
                    binding: 1,
                    visibility: GPUShaderStage.VERTEX,
                    buffer: { type: "read-only-storage" },
                },
            ],
        })
    }

    static create(gpu: GPU, capacity = 64, label = "lighting"): LightBinding {
        return new LightBinding(gpu, LightBinding.layoutFor(gpu, label), label, Math.max(1, capacity))
    }

    get group(): GPUBindGroup {
        return this.bindGroup
    }

    /** Rewrites the settings every hull is shaded by. Cheap; call when they change. */
    setShading(settings: ShadingSettings): void {
        const data = this.shading

        data[0] = settings.contrast
        data[1] = settings.shadowDepth
        data[2] = settings.tint
        data[3] = settings.ambientBleed
        data[4] = settings.ambientColor.r
        data[5] = settings.ambientColor.g
        data[6] = settings.ambientColor.b
        // The flag rides in the ambient colour's spare channel rather than
        // costing a whole 16-byte slot of its own
        data[7] = settings.multiply ? 1 : 0

        this.shadingBuffer.write(data)
    }

    /** Drops last frame's surfaces. Call once per frame, before adding. */
    begin(): this {
        this.count = 0
        return this
    }

    /**
     * Records the light on one hull.
     *
     * @param reach the hull's bounding radius: cells that far from its centre
     *        take full contrast, and the interior fades toward its base colour
     */
    add(light: SurfaceLight, reach: number): this {
        if (this.count >= this.capacity) this.grow(this.count + 1)

        const at = this.count * FLOATS_PER_SURFACE
        const data = this.surfaces

        data[at + 0] = light.direction.x
        data[at + 1] = light.direction.y
        data[at + 2] = light.intensity
        data[at + 3] = reach
        data[at + 4] = light.tint.r
        data[at + 5] = light.tint.g
        data[at + 6] = light.tint.b
        data[at + 7] = 1

        this.count++
        return this
    }

    /** Writes the filled prefix. Call once after adding, before drawing. */
    upload(): void {
        if (this.count === 0) return
        this.surfaceBuffer.write(this.surfaces.subarray(0, this.count * FLOATS_PER_SURFACE))
    }

    get capacity(): number {
        return this.surfaces.length / FLOATS_PER_SURFACE
    }

    get size(): number {
        return this.count
    }

    destroy(): void {
        this.shadingBuffer.destroy()
        this.surfaceBuffer.destroy()
    }

    private grow(needed: number): void {
        const capacity = Math.max(needed, Math.ceil(this.capacity * GROWTH_FACTOR))
        const data = new Float32Array(capacity * FLOATS_PER_SURFACE)
        data.set(this.surfaces) // keep whatever was already added this frame

        this.surfaceBuffer.destroy()
        this.surfaces = data
        this.surfaceBuffer = Buffer.makeStorageBuffer(this.gpu, data.byteLength, `${this.label} surfaces`)
        this.bindGroup = this.makeGroup()
    }

    private makeGroup(): GPUBindGroup {
        return this.gpu.device.createBindGroup({
            label: `${this.label} group`,
            layout: this.layout,
            entries: [
                { binding: 0, resource: { buffer: this.shadingBuffer.handle } },
                { binding: 1, resource: { buffer: this.surfaceBuffer.handle } },
            ],
        })
    }
}

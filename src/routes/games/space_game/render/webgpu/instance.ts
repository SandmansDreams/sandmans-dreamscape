// Draws one mesh many times from a storage buffer of per-instance transforms

import { Buffer } from "./buffer"
import type { Frame } from "../frame"
import type { GPU } from "./gpu"
import type { Mesh } from "../mesh"

// offset.xy, rotation.xy (cos, sin scaled), color.rgba
export const FLOATS_PER_INSTANCE = 8
export const INSTANCE_BYTES = FLOATS_PER_INSTANCE * 4

// How much spare room a reallocation buys. Tune here:
export const GROWTH_FACTOR = 1.5 // x times the space it had before

export class InstanceBatch {
    private readonly gpu: GPU
    private readonly bindLayout: GPUBindGroupLayout
    private readonly label: string

    private data: Float32Array<ArrayBuffer>
    private buffer: Buffer
    private group: GPUBindGroup
    private count = 0
    private dirty = true // Identical data flag, true means something is different

    get capacity(): number {
        return this.data.length / FLOATS_PER_INSTANCE
    }

    get size(): number {
        return this.count
    }

    private constructor(gpu: GPU, bindLayout: GPUBindGroupLayout, label: string, capacity: number) {
        this.gpu = gpu
        this.bindLayout = bindLayout
        this.label = label

        this.data = new Float32Array(capacity * FLOATS_PER_INSTANCE)
        this.buffer = Buffer.makeStorageBuffer(gpu, this.data.byteLength, `${label} buffer`)
        this.group = this.makeGroup()
    }

    static layout(gpu: GPU, label = "instances"): GPUBindGroupLayout {
        return gpu.device.createBindGroupLayout({
            label: `${label} layout`,
            entries: [{
                binding: 0,
                visibility: GPUShaderStage.VERTEX,
                buffer: { type: "read-only-storage" },
            }],
        })
    }

    static create(
        gpu: GPU,
        bindLayout: GPUBindGroupLayout,
        capacity = 1024,
        label = "instances",
    ): InstanceBatch {
        return new InstanceBatch(gpu, bindLayout, label, Math.max(1, capacity))
    }

    // Discards last frame's instances, call once per frame before adding
    begin(): this {
        this.count = 0
        this.dirty = true
        return this
    }

    add( // Add a single point of data
        x: number, 
        y: number, 
        rotation: number, 
        scale: number, 
        r: number, g: number, b: number,
        a = 1
    ): this {
        if (this.count >= this.capacity) this.grow(this.count + 1) // Increase capacity if needed

        // Fold scale and rotation into rotation matrix
        const cos = Math.cos(rotation) * scale
        const sin = Math.sin(rotation) * scale


        const lastIndex = this.count * FLOATS_PER_INSTANCE // The last index of the data array
        const data = this.data
        
        data[lastIndex + 0] = x
        data[lastIndex + 1] = y
        data[lastIndex + 2] = cos
        data[lastIndex + 3] = sin
        data[lastIndex + 4] = r
        data[lastIndex + 5] = g
        data[lastIndex + 6] = b
        data[lastIndex + 7] = a

        this.count++
        this.dirty = true
        return this
    }

    // Grow up front when the count is known so no reallocation happens mid-fill
    reserve(instances: number): this {
        if (instances > this.capacity) this.grow(instances)
        return this
    }

    /** Writes the filled prefix to the GPU. Called by draw(); a no-op if nothing changed. */
    upload(): void {
        if (!this.dirty || this.count === 0) return
        this.buffer.write(this.data.subarray(0, this.count * FLOATS_PER_INSTANCE))
        this.dirty = false
    }

    /** @returns draw calls issued - 0 when there was nothing to draw. */
    draw(frame: Frame, mesh: Mesh, group = 2): number {
        if (this.count === 0) return 0
        this.upload()

        frame.setBindGroup(group, this.group)
        frame.setVertex(0, mesh.buffer)

        // Bound whenever the mesh has one, because only the lit pipeline declares
        // slot 1 and binding a slot a pipeline does not use is allowed. The
        // alternative is a second draw method that differs by one line.
        if (mesh.cells) frame.setVertex(1, mesh.cells)

        frame.draw(mesh.vertexCount, this.count)
        return 1
    }

    private grow(needed: number): void {
        this.dirty = true
        const capacity = Math.max(needed, Math.ceil(this.capacity * GROWTH_FACTOR))

        const data = new Float32Array(capacity * FLOATS_PER_INSTANCE)
        data.set(this.data) // keep whatever was already added this frame

        // Remake the buffer and new group to draw from
        this.buffer.destroy()
        this.data = data
        this.buffer = Buffer.makeStorageBuffer(this.gpu, data.byteLength, `${this.label} buffer`)
        this.group = this.makeGroup()
    }
    
    private makeGroup(): GPUBindGroup {
        return this.gpu.device.createBindGroup({
            label: `${this.label} group`,
            layout: this.bindLayout,
            entries: [{ binding: 0, resource: { buffer: this.buffer.handle } }],
        })
    }

    destroy(): void {
        this.buffer.destroy()
    }
}
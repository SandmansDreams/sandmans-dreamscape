import type { Mesh } from "../mesh"
import { Buffer } from "./buffer"
import type { Frame, Renderer } from "./render"

export class InstanceBatch {
    private readonly renderer: Renderer
    private readonly bindLayout: GPUBindGroupLayout
    private readonly label: string

    private readonly floatsPerInstance = 8 // offset.xy, rotation.xy (cos, sin scaled), color.rgba
    private readonly instanceBytes = this.floatsPerInstance * 4

    private data: Float32Array<ArrayBuffer>
    private buffer: Buffer
    private group: GPUBindGroup
    private count = 0
    private dirty = true // Identical data flag, true means something is different


    get capacity(): number {
        return this.data.length / 8
    }

    get size(): number {
        return this.count
    }

    private constructor(renderer: Renderer, bindLayout: GPUBindGroupLayout, label: string, capacity: number) {
        this.renderer = renderer
        this.bindLayout = bindLayout
        this.label = label

        this.data = new Float32Array(capacity * this.floatsPerInstance)
        this.buffer = Buffer.makeStorageBuffer(renderer, this.data.byteLength, `${label} buffer`)
        this.group = this.makeGroup()
    }

    static create(
        renderer: Renderer,
        bindLayout: GPUBindGroupLayout,
        capacity = 1024,
        label = "instances",
    ): InstanceBatch {
        return new InstanceBatch(renderer, bindLayout, label, Math.max(1, capacity))
    }

    static layout(renderer: Renderer, label = "instances"): GPUBindGroupLayout {
        return renderer.gpu.createBindGroupLayout({
            label: `${label} layout`,
            entries: [{
                binding: 0,
                visibility: GPUShaderStage.VERTEX,
                buffer: { type: "read-only-storage" },
            }],
        })
    }

    /** Discards last frame's instances, call once per frame before adding */
    begin(): this {
        this.count = 0
        this.dirty = true
        return this
    }

    /** Add a single point of data */
    add(
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


        const lastIndex = this.count * this.floatsPerInstance // The last index of the data array
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

    /** Grow up front when the count is known so no reallocation happens mid-fill */
    reserve(instances: number): this {
        if (instances > this.capacity) this.grow(instances)
        return this
    }

    /** Writes the filled prefix to the GPU. Called by draw(), a no-op if nothing changed. */
    upload(): void {
        if (!this.dirty || this.count === 0) return
        this.buffer.write(this.data.subarray(0, this.count * this.floatsPerInstance))
        this.dirty = false
    }

    /** @returns draw calls issued - 0 when there was nothing to draw. */
    draw(frame: Frame, mesh: Mesh, group = 2): number {
        if (this.count === 0) return 0
        this.upload()

        frame.setBindGroup(group, this.group)
        frame.setVertex(0, mesh.vertexBuffer)

        // If mesh has cells, put in the first slot
        if (mesh.cellBuffer) frame.setVertex(1, mesh.cellBuffer)

        frame.draw(mesh.vertexCount, this.count)
        return 1
    }

    private grow(needed: number): void {
        this.dirty = true
        const capacity = Math.max(needed, Math.ceil(this.capacity * 1.5)) // Increase capacity by a multiplier

        const data = new Float32Array(capacity * this.floatsPerInstance)
        data.set(this.data) // keep whatever was already added this frame

        // Remake the buffer and new group to draw from
        this.buffer.destroy()
        this.data = data
        this.buffer = Buffer.makeStorageBuffer(this.renderer, data.byteLength, `${this.label} buffer`)
        this.group = this.makeGroup()
    }
    
    private makeGroup(): GPUBindGroup {
        return this.renderer.gpu.createBindGroup({
            label: `${this.label} group`,
            layout: this.bindLayout,
            entries: [{ binding: 0, resource: { buffer: this.buffer.handle } }],
        })
    }

    destroy(): void {
        this.buffer.destroy()
    }
}
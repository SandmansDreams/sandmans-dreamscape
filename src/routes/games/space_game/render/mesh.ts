// World-space geometry: a CPU-side triangle accumulator and the GPU buffer it uploads to

import { Assert } from "../assert"
import { Buffer } from "./webgpu/buffer"
import type { Frame } from "./frame"
import type { GPU } from "./webgpu/gpu"
import type { Color } from "./color"

export const FLOATS_PER_VERTEX = 5 // x, y, r, g, b
const STRIDE = FLOATS_PER_VERTEX * 4 // Bytes from one vertex to the next

// Single source of truth for vertex layout for the game
export const VERTEX_LAYOUT: GPUVertexBufferLayout = {
    arrayStride: STRIDE,
    stepMode: "vertex",
    attributes: [
        { shaderLocation: 0, offset: 0, format: "float32x2" }, // position
        { shaderLocation: 1, offset: 8, format: "float32x3" }, // color
    ],
}

export class Mesh {
    readonly buffer: Buffer
    vertexCount: number

    private constructor(buffer: Buffer, vertexCount: number) {
        this.buffer = buffer
        this.vertexCount = vertexCount
    }

    static create(
        gpu: GPU, 
        data: Float32Array<ArrayBuffer>, 
        label = "mesh", 
        capacityFloats = data.length
    ): Mesh {
        // Ensure data fits evenly into buffer and there is enough capacity
        Assert.that(
            data.length % FLOATS_PER_VERTEX === 0,
            `mesh data length ${data.length} is not a multiple of ${FLOATS_PER_VERTEX}`
        )
        Assert.that(capacityFloats >= data.length, "mesh capacity is smaller than its initial data")

        // Make a vertex buffer to hold vertex data and write data to it, then return mesh
        const buffer = Buffer.makeVertexBuffer(gpu, capacityFloats * 4, label)
        buffer.write(data)

        const vertexCount = data.length / FLOATS_PER_VERTEX

        return new Mesh(buffer, vertexCount)
    }

    update(data: Float32Array<ArrayBuffer>) { // Reupload new data, cant exceed inital capacity
        Assert.that(
            data.length % FLOATS_PER_VERTEX === 0,
            `mesh data length ${data.length} for update is not a multiple of ${FLOATS_PER_VERTEX}`,
        )

        // Capacity assertion not needed here, is written into buffer.write()  
        this.buffer.write(data)
        this.vertexCount = data.length / FLOATS_PER_VERTEX
    }

    draw(frame: Frame): void {
        frame
            .setVertex(0, this.buffer)
            .draw(this.vertexCount)
    }

    destroy(): void {
        this.buffer.destroy()
    }
}

// Accumulates tris on the CPU and uploads them once instead of individually (for speed)
export class MeshBuilder {
    private readonly data: number[] = [] // Flat and interleaved: x, y, r, g, b per vertex

    get vertexCount(): number {
        return this.data.length / FLOATS_PER_VERTEX
    }

    add(verts: readonly number[], color: Color): this { // Add vertices to mesh, interleaving position and color
        Assert.that(verts.length % 6 === 0, "verts must be whole triangles — 6 numbers each, 3 positions")

        for (let i = 0; i < verts.length; i += 2) {
            this.data.push(verts[i]!, verts[i + 1]!, ...color.rgb)
        }

        return this
    }

    quad(x: number, y: number, width: number, height: number, color: Color): this { // Add a quad to the buffer
        const x2 = x + width
        const y2 = y + height
        return this.add([x, y, x2, y, x2, y2, x, y, x2, y2, x, y2], color)
    }

    clear(): this {
        this.data.length = 0
        return this
    }

    toArray(): Float32Array<ArrayBuffer> {
        return new Float32Array(this.data)
    }

    build(gpu: GPU, label = "mesh", capacityFloats?: number): Mesh { // Pushes array data to Mesh
        return Mesh.create(gpu, this.toArray(), label, capacityFloats)
    }

    /** Appends already-interleaved vertices, for geometry that arrives pre-coloured. */
    raw(data: readonly number[]): this {
        Assert.that(data.length % (FLOATS_PER_VERTEX * 3) === 0, "raw data must be whole triangles")

        for (const value of data) this.data.push(value)
        return this
    }
}
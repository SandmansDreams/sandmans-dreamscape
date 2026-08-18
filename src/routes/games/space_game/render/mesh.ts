// World-space geometry: a CPU-side triangle accumulator and the GPU buffer it uploads to

import { Assert } from "../assert"
import { Buffer } from "./webgpu/buffer"
import type { Frame } from "./frame"
import type { GPU } from "./webgpu/gpu"
import type { Color } from "./color"

export const FLOATS_PER_VERTEX = 5 // x, y, r, g, b
const STRIDE = FLOATS_PER_VERTEX * 4 // Bytes from one vertex to the next

/**
 * The second, optional channel: cell centre x, cell centre y, emission.
 *
 * Its own buffer rather than three more floats on every vertex. Only the lit
 * pipeline reads it, and the things that would have to invent an answer - glyph
 * runs, wireframe lines, the arena walls - simply never fill it.
 *
 * The centre is in the same space as the positions beside it, so for a ship it
 * is measured from the hull's centre and is exactly the outward direction the
 * shading treats as a cell's normal.
 */
export const FLOATS_PER_CELL_VERTEX = 3
const CELL_STRIDE = FLOATS_PER_CELL_VERTEX * 4

// Single source of truth for vertex layout for the game
export const VERTEX_LAYOUT: GPUVertexBufferLayout = {
    arrayStride: STRIDE,
    stepMode: "vertex",
    attributes: [
        { shaderLocation: 0, offset: 0, format: "float32x2" }, // position
        { shaderLocation: 1, offset: 8, format: "float32x3" }, // color
    ],
}

/** Buffer 1, bound only by the lit pipeline. See FLOATS_PER_CELL_VERTEX. */
export const CELL_VERTEX_LAYOUT: GPUVertexBufferLayout = {
    arrayStride: CELL_STRIDE,
    stepMode: "vertex",
    attributes: [
        { shaderLocation: 2, offset: 0, format: "float32x3" }, // cell centre xy, emission
    ],
}

export class Mesh {
    readonly buffer: Buffer
    /**
     * The cell channel, or null on a mesh nobody will light.
     *
     * Present exactly when the builder was given cell centres. The lit pipeline
     * requires it; every other pipeline never looks.
     */
    readonly cells: Buffer | null
    vertexCount: number

    private constructor(buffer: Buffer, cells: Buffer | null, vertexCount: number) {
        this.buffer = buffer
        this.cells = cells
        this.vertexCount = vertexCount
    }

    static create(
        gpu: GPU, 
        data: Float32Array<ArrayBuffer>, 
        label = "mesh", 
        capacityFloats = data.length,
        cellData?: Float32Array<ArrayBuffer>,
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

        let cells: Buffer | null = null
        if (cellData && cellData.length > 0) {
            Assert.that(
                cellData.length === vertexCount * FLOATS_PER_CELL_VERTEX,
                `cell data holds ${cellData.length / FLOATS_PER_CELL_VERTEX} vertices, not ${vertexCount}`,
            )

            // Scaled from the same capacity, so a mesh that can grow its positions
            // can grow its cells by exactly as much
            const capacityCells = (capacityFloats / FLOATS_PER_VERTEX) * FLOATS_PER_CELL_VERTEX
            cells = Buffer.makeVertexBuffer(gpu, capacityCells * 4, `${label} cells`)
            cells.write(cellData)
        }

        return new Mesh(buffer, cells, vertexCount)
    }

    update(data: Float32Array<ArrayBuffer>, cellData?: Float32Array<ArrayBuffer>) { // Reupload new data, cant exceed inital capacity
        Assert.that(
            data.length % FLOATS_PER_VERTEX === 0,
            `mesh data length ${data.length} for update is not a multiple of ${FLOATS_PER_VERTEX}`,
        )

        // Capacity assertion not needed here, is written into buffer.write()  
        this.buffer.write(data)
        this.vertexCount = data.length / FLOATS_PER_VERTEX

        // Silently ignored when this mesh has no cell buffer: a caller that wants
        // one has to say so at create(), where the buffer can actually be made
        if (this.cells && cellData) this.cells.write(cellData)
    }

    draw(frame: Frame): void {
        frame
            .setVertex(0, this.buffer)
            .draw(this.vertexCount)
    }

    destroy(): void {
        this.buffer.destroy()
        this.cells?.destroy()
    }
}

/**
 * The capacity a buffer should grow to in order to hold `needed` floats.
 *
 * Doubling rather than fitting exactly: a mesh that creeps upward by a triangle
 * a frame would otherwise reallocate every frame. Pure and exported so the
 * policy can be tested without a GPU, which is the only part of DynamicMesh that
 * can be.
 */
export function grownCapacity(current: number, needed: number): number {
    return Math.max(needed, current * 2)
}

/**
 * A mesh whose contents change but whose buffer should not.
 *
 * `Mesh.update` refuses data past the capacity the mesh was created with, which
 * is why callers that rebuild have been destroying and recreating instead - a
 * fresh GPU buffer every frame for a hover box that follows the cursor. This
 * keeps its buffer and reallocates only when the data genuinely outgrows it.
 *
 * Empty is a real state rather than a null mesh: writing nothing draws nothing,
 * so callers need no nullable field, no `?.destroy()` before each rebuild and no
 * `?.` at the draw site.
 */
export class DynamicMesh {
    private readonly gpu: GPU
    private readonly label: string

    // Null until the first non-empty write: a zero-byte buffer is not a thing
    // WebGPU will make, and a mesh that is never written should cost nothing
    private mesh: Mesh | null = null
    private capacityFloats = 0

    private constructor(gpu: GPU, label: string) {
        this.gpu = gpu
        this.label = label
    }

    static create(gpu: GPU, label = "dynamic mesh"): DynamicMesh {
        return new DynamicMesh(gpu, label)
    }

    get vertexCount(): number {
        return this.mesh?.vertexCount ?? 0
    }

    /** Replaces the contents. Reallocates only when the data does not fit. */
    write(data: Float32Array<ArrayBuffer>): void {
        if (data.length === 0) {
            // Nothing to draw, but the buffer is kept - the next write is usually
            // the same size as the last non-empty one
            this.mesh?.update(data)
            return
        }

        if (this.mesh && data.length <= this.capacityFloats) {
            this.mesh.update(data)
            return
        }

        this.mesh?.destroy()
        this.capacityFloats = grownCapacity(this.capacityFloats, data.length)
        this.mesh = Mesh.create(this.gpu, data, this.label, this.capacityFloats)
    }

    draw(frame: Frame): void {
        if (this.vertexCount === 0) return
        this.mesh?.draw(frame)
    }

    /**
     * The mesh behind this one, or null while it is empty.
     *
     * For callers that draw it through something else - an InstanceBatch repeats
     * one mesh and reads its buffer directly. Prefer `draw` when drawing plainly.
     */
    get current(): Mesh | null {
        return this.vertexCount === 0 ? null : this.mesh
    }

    destroy(): void {
        this.mesh?.destroy()
        this.mesh = null
        this.capacityFloats = 0
    }
}

// Accumulates tris on the CPU and uploads them once instead of individually (for speed)
export class MeshBuilder {
    private readonly data: number[] = [] // Flat and interleaved: x, y, r, g, b per vertex

    /**
     * The cell channel, filled only while a caller has said which cell it is in.
     *
     * Kept in lockstep with `data` by every push below rather than by the caller,
     * because the two buffers disagreeing is a class of bug that would show up as
     * a hull lit from the wrong direction and nothing else.
     */
    private readonly cellData: number[] = []
    private cellX = 0
    private cellY = 0
    private emission = 0
    private cellsUsed = false
    private furthestCellSq = 0

    get vertexCount(): number {
        return this.data.length / FLOATS_PER_VERTEX
    }

    /**
     * Marks every vertex added from now on as belonging to this cell.
     *
     * Stateful on purpose. The alternative is threading a centre and an emission
     * through appendShape, the font and every other producer, none of which knows
     * what a cell is or wants to.
     *
     * @param x centre of the cell, in the same space as the positions being added
     * @param emission 0 for a surface the light shades, 1 for one that lights itself
     */
    inCell(x: number, y: number, emission = 0): this {
        this.cellX = x
        this.cellY = y
        this.emission = emission
        this.cellsUsed = true
        this.furthestCellSq = Math.max(this.furthestCellSq, x * x + y * y)
        return this
    }

    /**
     * How far the outermost cell sits from the origin these were built about.
     *
     * What the shading wants for "cells this far out take full contrast", and
     * measurably better than the bounding box's corner: no cell ever sits at the
     * corner of a hull, so a box measure leaves even the outermost plates short
     * of full contrast and the whole ship reads flat.
     */
    get cellReach(): number {
        return Math.sqrt(this.furthestCellSq)
    }

    /** Back to geometry that belongs to no cell - overlays, labels, markers. */
    outsideCell(): this {
        return this.inCell(0, 0, 0)
    }

    /** One cell record per vertex just pushed. */
    private markVertices(count: number): void {
        for (let i = 0; i < count; i++) {
            this.cellData.push(this.cellX, this.cellY, this.emission)
        }
    }

    add(verts: readonly number[], color: Color): this { // Add vertices to mesh, interleaving position and color
        Assert.that(verts.length % 6 === 0, "verts must be whole triangles — 6 numbers each, 3 positions")

        for (let i = 0; i < verts.length; i += 2) {
            this.data.push(verts[i]!, verts[i + 1]!, ...color.rgb)
        }

        this.markVertices(verts.length / 2)
        return this
    }

    quad(x: number, y: number, width: number, height: number, color: Color): this { // Add a quad to the buffer
        const x2 = x + width
        const y2 = y + height
        return this.add([x, y, x2, y, x2, y2, x, y, x2, y2, x, y2], color)
    }

    clear(): this {
        this.data.length = 0
        this.cellData.length = 0
        this.cellsUsed = false
        this.furthestCellSq = 0
        return this.outsideCell()
    }

    toArray(): Float32Array<ArrayBuffer> {
        return new Float32Array(this.data)
    }

    /** The cell channel, or an empty array when nothing ever named a cell. */
    toCellArray(): Float32Array<ArrayBuffer> {
        return new Float32Array(this.cellsUsed ? this.cellData : [])
    }

    build(gpu: GPU, label = "mesh", capacityFloats?: number): Mesh { // Pushes array data to Mesh
        return Mesh.create(gpu, this.toArray(), label, capacityFloats, this.toCellArray())
    }

    /** Appends already-interleaved vertices, for geometry that arrives pre-coloured. */
    raw(data: readonly number[]): this {
        Assert.that(data.length % (FLOATS_PER_VERTEX * 3) === 0, "raw data must be whole triangles")

        for (const value of data) this.data.push(value)

        this.markVertices(data.length / FLOATS_PER_VERTEX)
        return this
    }
}
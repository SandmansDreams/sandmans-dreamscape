import { Assert } from "../Assert"
import type { Frame, Renderer } from "./webGPU/render"
import { Buffer } from "./webGPU/Buffer"
import type { Color } from "./Color"

export const FLOATS_PER_VERTEX = 5 // x, y, r, g, b
const STRIDE = FLOATS_PER_VERTEX * 4 // Bytes from one vertex to the next

/** The second, optional channel: cell centre x, cell centre y, emission, and the glow spilled onto this cell by the emissive cells around it. */
export const FLOATS_PER_CELL_VERTEX = 7
const CELL_STRIDE = FLOATS_PER_CELL_VERTEX * 4

/** Single source of truth for vertex layout for the game */
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
        { shaderLocation: 2, offset: 0, format: "float32x4" },  // cell centre xy, emission, index
        { shaderLocation: 3, offset: 16, format: "float32x3" }, // spill rgb
    ],
}

/** The capacity a buffer should grow to in order to hold `needed` floats. */
export function grownCapacity(current: number, needed: number): number {
    return Math.max(needed, current * 2)
}

/** A shape made up of vetexes or cells */
export class Mesh {
    readonly vertexBuffer: Buffer
    readonly cellBuffer: Buffer | null
    vertexCount: number

    private constructor(vertexBuffer: Buffer, cellBuffer: Buffer | null, vertexCount: number) {
        this.vertexBuffer = vertexBuffer
        this.cellBuffer = cellBuffer
        this.vertexCount = vertexCount
    }

    static create(
        renderer: Renderer, 
        data: Float32Array<ArrayBuffer>, 
        label = "mesh", 
        capacityFloats = data.length,
        cellData?: Float32Array<ArrayBuffer>,
    ): Mesh { 
        Assert.that( // Ensure data fits evenly into buffer and there is enough capacity
            data.length % FLOATS_PER_VERTEX === 0,
            `mesh data length ${data.length} is not a multiple of ${FLOATS_PER_VERTEX}`
        )
        Assert.that(capacityFloats >= data.length, "mesh capacity is smaller than its initial data")

        // Make a vertex buffer to hold vertex data and write data to it, then return mesh
        const buffer = Buffer.makeVertexBuffer(renderer, capacityFloats * 4, label)
        buffer.write(data)

        const vertexCount = data.length / FLOATS_PER_VERTEX

        let cells: Buffer | null = null
        if (cellData && cellData.length > 0) {
            Assert.that(
                cellData.length === vertexCount * FLOATS_PER_CELL_VERTEX,
                `cell data holds ${cellData.length / FLOATS_PER_CELL_VERTEX} vertices, not ${vertexCount}`,
            )

            // Scaled from the same capacity, so a mesh that can grow its positions
            const capacityCells = (capacityFloats / FLOATS_PER_VERTEX) * FLOATS_PER_CELL_VERTEX
            cells = Buffer.makeVertexBuffer(renderer, capacityCells * 4, `${label} cells`)
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
        this.vertexBuffer.write(data)
        this.vertexCount = data.length / FLOATS_PER_VERTEX

        // Silently ignored when this mesh has no cell buffer: a caller that wants
        // one has to say so at create(), where the buffer can actually be made
        if (this.cellBuffer && cellData) this.cellBuffer.write(cellData)
    }

    draw(frame: Frame): void {
        frame
            .setVertex(0, this.vertexBuffer)
            .draw(this.vertexCount)
    }

    destroy(): void {
        this.vertexBuffer.destroy()
        this.cellBuffer?.destroy()
    }
}

/** A mesh whose content changes but whose buffer should not */
export class DynamicMesh {
    private readonly renderer: Renderer
    private readonly label: string

    // Null until the first non-empty write: a zero-byte buffer is not a thing
    // WebGPU will make, and a mesh that is never written should cost nothing
    private mesh: Mesh | null = null
    private capacityFloats = 0

    private constructor(renderer: Renderer, label: string) {
        this.renderer = renderer
        this.label = label
    }

    static create(renderer: Renderer, label = "dynamic mesh"): DynamicMesh {
        return new DynamicMesh(renderer, label)
    }

    get vertexCount(): number {
        return this.mesh?.vertexCount ?? 0
    }

    /** Replaces the contents. Reallocates only when the data does not fit. */
    write(data: Float32Array<ArrayBuffer>): void {
        if (data.length === 0) {
            // Nothing to draw, but the buffer is kept - the next write is usually the same size as the last non-empty one
            this.mesh?.update(data)
            return
        }

        if (this.mesh && data.length <= this.capacityFloats) {
            this.mesh.update(data)
            return
        }

        this.mesh?.destroy()
        this.capacityFloats = grownCapacity(this.capacityFloats, data.length)
        this.mesh = Mesh.create(this.renderer, data, this.label, this.capacityFloats)
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

/** Accumulates tris on the CPU and uploads them once instead of individually (for speed) */
export class MeshBuilder {
    private readonly data: number[] = [] // Flat and interleaved: x, y, r, g, b per vertex

    private readonly cellData: number[] = []
    private cellX = 0
    private cellY = 0
    private emission = 0

    private cellIndex = 0
    private cellsSeen = 0
    private spillR = 0
    private spillG = 0
    private spillB = 0
    private cellsUsed = false
    private furthestCellSq = 0

    get vertexCount(): number {
        return this.data.length / FLOATS_PER_VERTEX
    }

    get cellReach(): number {
        return Math.sqrt(this.furthestCellSq)
    }

    get cellCount(): number {
        return this.cellsSeen
    }

    /** Marks every vertex added from now on as belonging to this cell. */
    inCell(x: number, y: number, emission = 0, spill?: Color): this {
        this.cellIndex = this.cellsSeen++
        this.cellX = x
        this.cellY = y
        this.emission = emission
        this.spillR = spill?.r ?? 0
        this.spillG = spill?.g ?? 0
        this.spillB = spill?.b ?? 0
        this.cellsUsed = true
        this.furthestCellSq = Math.max(this.furthestCellSq, x * x + y * y)
        return this
    }

    /** Geometry that belongs to no cell - overlays, labels, markers. */
    outsideCell(): this {
        this.cellX = 0
        this.cellY = 0
        this.emission = 0
        this.spillR = 0
        this.spillG = 0
        this.spillB = 0
        this.cellIndex = 0
        this.cellsUsed = true
        return this
    }

    /** One cell record per vertex just pushed. */
    private markVertices(count: number): void {
        for (let i = 0; i < count; i++) {
            this.cellData.push(
                this.cellX, this.cellY, this.emission, this.cellIndex,
                this.spillR, this.spillG, this.spillB,
            )
        }
    }

    /** Add vertices to mesh, interleaving position and color */
    add(verts: readonly number[], color: Color): this {
        Assert.that(verts.length % 6 === 0, "verts must be whole triangles — 6 numbers each, 3 positions")

        for (let i = 0; i < verts.length; i += 2) {
            this.data.push(verts[i]!, verts[i + 1]!, color.r, color.g, color.b)
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
        this.cellsSeen = 0
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

    build(renderer: Renderer, label = "mesh", capacityFloats?: number): Mesh {
        return Mesh.create(renderer, this.toArray(), label, capacityFloats, this.toCellArray())
    }

    /** Appends already-interleaved vertices, for geometry that arrives pre-coloured. */
    raw(data: readonly number[]): this {
        Assert.that(data.length % (FLOATS_PER_VERTEX * 3) === 0, "raw data must be whole triangles")

        for (const value of data) this.data.push(value)

        this.markVertices(data.length / FLOATS_PER_VERTEX)
        return this
    }
}
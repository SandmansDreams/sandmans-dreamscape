import { Assert } from "../../Assert"
import { roundBytesToNearest4x } from "../../utils"
import type { Renderer } from "./render"

/** A representation of a GPUBuffer that takes data in 1D array or matrix form */
export class Buffer {
    readonly handle: GPUBuffer
    readonly size: number
    private readonly gpu: GPUDevice

    private constructor(gpu: GPUDevice, handle: GPUBuffer, size: number) {
        this.gpu = gpu
        this.handle = handle
        this.size = size
    }

    private static create (
        renderer: Renderer, 
        usage: GPUBufferUsageFlags,
        dataSource: number | ArrayBufferView<ArrayBuffer>,
        label: string
    ) {
        const size = roundBytesToNearest4x(typeof dataSource === "number" ? dataSource : dataSource.byteLength)
        Assert.that(size > 0, `buffer '${label}' would be zero bytes`)

        const buffer = new Buffer(
            renderer.gpu,
            renderer.gpu.createBuffer({
                label,
                size,
                usage
            }),
            size
        )

        if (typeof dataSource !== "number") buffer.write(dataSource)
        return buffer
    }

    /** Copies data into a buffer on the GPU */
    write(data: ArrayBufferView<ArrayBuffer>, offsetBytes = 0): void {
        Assert.that(
            offsetBytes + data.byteLength <= this.size,
            `write of ${data.byteLength}b at ${offsetBytes} overflows a ${this.size}b buffer`,
        )
        
        this.gpu.queue.writeBuffer(this.handle, offsetBytes, data)
    }

    static makeVertexBuffer(renderer: Renderer, source: number | ArrayBufferView<ArrayBuffer>, label = "vertex buffer"): Buffer {
        return Buffer.create(renderer, GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST, source, label)
    }

    static makeIndexBuffer(renderer: Renderer, source: number | ArrayBufferView<ArrayBuffer>, label = "index buffer"): Buffer {
        return Buffer.create(renderer, GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST, source, label)
    }

    static makeUniformBuffer(renderer: Renderer, source: number | ArrayBufferView<ArrayBuffer>, label = "uniform buffer"): Buffer {
        return Buffer.create(renderer, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, source, label)
    }

    static makeStorageBuffer(renderer: Renderer, source: number | ArrayBufferView<ArrayBuffer>, label = "storage buffer"): Buffer {
        return Buffer.create(renderer, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST, source, label)
    }

    static makeQueryResolveBuffer(renderer: Renderer, source: number | ArrayBufferView<ArrayBuffer>, label = "query resolve buffer"): Buffer {
        return Buffer.create(renderer, GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC, source, label)
    }

    // MAP_READ may only pair with COPY_DST - it is a destination for copies and is never written directly, so this one deliberately has no COPY_SRC or write path.
    static makeReadbackBuffer(renderer: Renderer, source: number | ArrayBufferView<ArrayBuffer>, label = "readback buffer"): Buffer {
        return Buffer.create(renderer, GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST, source, label)
    }

    destroy(): void {
        this.handle.destroy()
    }
}
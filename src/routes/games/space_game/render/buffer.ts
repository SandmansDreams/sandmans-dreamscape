// Buffer handler for creating and writing to GPU buffers

import { Assert } from "../dev/assert"
import type { GPU } from "./gpu"

// WebGPU requires buffer sizes and write offsets to be multiples of 4 bytes
export function align4(bytes: number): number { // Rounds bytes up to nearest multiple of 4
    return (bytes + 3) & ~3
}

export class Buffer {
    readonly handle: GPUBuffer
    readonly size: number
    private readonly device: GPUDevice

    private constructor(device: GPUDevice, handle: GPUBuffer, size: number) {
        this.device = device
        this.handle = handle
        this.size = size
    }

    private static make(
        gpu: GPU, 
        usage: GPUBufferUsageFlags,
        dataSource: number | ArrayBufferView,
        label: string
    ) {
        // Get the size requirement of the buffer
        const size = align4(typeof dataSource === "number" ? dataSource : dataSource.byteLength)
        Assert.that(size > 0, `buffer '${label}' would be zero bytes`)

        const buffer = new Buffer(
            gpu.device,
            gpu.device.createBuffer({
                label,
                size,
                usage
            }),
            size
        )


        if (typeof dataSource !== "number") buffer.write(dataSource)
        return buffer
    }

    static makeVertexBuffer(gpu: GPU, source: number | ArrayBufferView, label = "vertex buffer"): Buffer {
        return Buffer.make(gpu, GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST, source, label)
    }

    static makeIndexBuffer(gpu: GPU, source: number | ArrayBufferView, label = "index buffer"): Buffer {
        return Buffer.make(gpu, GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST, source, label)
    }

    static makeUniformBuffer(gpu: GPU, source: number | ArrayBufferView, label = "uniform buffer"): Buffer {
        return Buffer.make(gpu, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, source, label)
    }

    static makeStorageBuffer(gpu: GPU, source: number | ArrayBufferView, label = "storage buffer"): Buffer {
        return Buffer.make(gpu, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST, source, label)
    }

    write(data: ArrayBufferView, offsetBytes = 0): void { // Copies data into a buffer on the GPU
        Assert.that(
            offsetBytes + data.byteLength <= this.size,
            `write of ${data.byteLength}b at ${offsetBytes} overflows a ${this.size}b buffer`,
        )
        this.device.queue.writeBuffer(this.handle, offsetBytes, data)
    }

    destroy(): void {
        this.handle.destroy()
    }
}
// GPU-side pass timing using timestamp queries

import { Buffer } from "./webgpu/buffer"
import type { GPU } from "./webgpu/gpu"

const TIMESTAMPS = 2          // one at the start of the pass, one at the end
const BYTES = TIMESTAMPS * 8  // each is a uint64 nanosecond counter

// Measures actual GPU time taken to render
// Lags by 2-3 frames because of how reading the buffer works, but negligible for our purposes
export class GpuTimer {
    private readonly querySet: GPUQuerySet | null = null
    private readonly resolveBuffer: Buffer | null = null

    // A pool, because a buffer cannot be mapped again while a previous mapAsync is still outstanding. One buffer would mean timing every third frame at best.
    private readonly free: Buffer[] = []
    private inFlight: Buffer | null = null

    lastMs: number | null = null

    get supported(): boolean { // Does this version of WebGPU support this feature
        return this.querySet !== null
    }

    constructor(gpu: GPU, readbackCount = 3, label = "pass timer") {
        if (!gpu.device.features.has("timestamp-query")) return

        this.querySet = gpu.device.createQuerySet({ label, type: "timestamp", count: TIMESTAMPS })
        this.resolveBuffer = Buffer.makeQueryResolveBuffer(gpu, BYTES, `${label} resolve`)

        for (let i = 0; i < readbackCount; i++) {
            this.free.push(Buffer.makeReadbackBuffer(gpu, BYTES, `${label} readback ${i}`))
        }
    }

    writes(): GPURenderPassTimestampWrites | undefined {
        if (!this.querySet) return undefined
        return { querySet: this.querySet, beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1 }
    }

    resolve(encoder: GPUCommandEncoder): void {
        if (!this.querySet || !this.resolveBuffer) return

        // Every readback buffer still mapped means the GPU is behind. Drop the sample rather than stall waiting for one - a gap in the average costs nothing.
        const readback = this.free.pop()
        if (!readback) return

        // DestinationOffset must be a multiple of 256, which is why this is always 0
        encoder.resolveQuerySet(this.querySet, 0, TIMESTAMPS, this.resolveBuffer.handle, 0)
        encoder.copyBufferToBuffer(this.resolveBuffer.handle, 0, readback.handle, 0, BYTES)
        this.inFlight = readback
    }

    read(): void {
        const readback = this.inFlight
        if (!readback) return
        this.inFlight = null

        void readback.handle
            .mapAsync(GPUMapMode.READ)
            .then(() => {
                const times = new BigUint64Array(readback.handle.getMappedRange())
                const delta = times[1]! - times[0]! // nanoseconds

                // Counters can reset or be zeroed by the driver, which would show up as a nonsense spike or a negative. Only accept forward progress.
                if (delta > 0n) this.lastMs = Number(delta) / 1e6

                readback.handle.unmap()
                this.free.push(readback)
            })
            .catch(() => {
                // Device lost or destroyed mid-flight - recycle and carry on
                this.free.push(readback)
            })
    }

    destroy(): void {
        this.querySet?.destroy()
        this.resolveBuffer?.destroy()
        this.inFlight?.destroy()
        for (const buffer of this.free) buffer.destroy()
    }
}
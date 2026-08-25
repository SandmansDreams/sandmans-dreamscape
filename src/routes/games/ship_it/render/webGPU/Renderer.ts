import { devicePixelRatio } from "svelte/reactivity/window" // Svelte reactive version of the built-in dpr
import { Assert } from "../../Assert"
import { clamp } from "../../utils"
import { Buffer } from "./Buffer"


/** Communicates between the code and the computer's GPU to render things */
export class Renderer {
    readonly canvas: HTMLCanvasElement
    readonly gpu: GPUDevice
    readonly context: GPUCanvasContext
    readonly format: GPUTextureFormat

    private readonly maxSize: number
    private readonly observer: ResizeObserver

    private nativeWidth = 1
    private nativeHeight = 1
    private scale = 1

    private constructor(
        canvas: HTMLCanvasElement,
        gpu: GPUDevice,
        context: GPUCanvasContext,
        format: GPUTextureFormat,
    ) {
        this.canvas = canvas
        this.gpu = gpu
        this.context = context
        this.format = format
        this.maxSize = gpu.limits.maxTextureDimension2D

        this.resize(
            canvas.clientWidth * (devicePixelRatio.current ?? 1), 
            canvas.clientHeight * (devicePixelRatio.current ?? 1)
        )

        this.observer = this.createObserver()
    }

    static async create(canvas: HTMLCanvasElement): Promise<Renderer> {
        Assert.exists(navigator.gpu, "navigator.gpu — this browser has no WebGPU") // Make sure the browser supports WebGPU

        const adapter = await navigator.gpu.requestAdapter()
        Assert.exists(adapter, "GPU adapter — WebGPU exists but no adapter was available")

        const device = await adapter.requestDevice({
            label: "Ship_It device",
            requiredFeatures: adapter.features.has("timestamp-query") ? ["timestamp-query"] : [], // Check for feature rather than failing
        })

        const context = canvas.getContext("webgpu")
        Assert.exists(context, "Could not get WebGPU canvas context")

        const format = navigator.gpu.getPreferredCanvasFormat()
        context.configure({ device, format, alphaMode: "opaque" })

        void device.lost.then((info) => {
            console.error(`WebGPU device lost (${info.reason}): ${info.message}`)
        })

        device.onuncapturederror = (event) => {
            console.error("WebGPU device error:", event.error.message)
        }

        return new Renderer(canvas, device, context, format)
    }

    /** Resize the renderer to match specified dimensions */
    private resize(width: number, height: number): void {
        this.nativeWidth = width
        this.nativeHeight = height
        this.applyScale()
    }

    /** Apply scale to the canvas dimensions */
    private applyScale(): void {
        this.canvas.width = Math.round(clamp(this.maxSize, this.nativeWidth * this.scale))
        this.canvas.height = Math.round(clamp(this.maxSize, this.nativeHeight * this.scale))
    }

    /** Establish a resizeObserver to change the canvas size when the window / canvas changes */
    createObserver() {
        const observer = new ResizeObserver((observerEntries) => {
            for (const observerEntry of observerEntries) {
                const exact = observerEntry.devicePixelContentBoxSize?.[0]

                if (exact) {
                    // If and exact pixel size exists, resize using exact pixels
                    this.resize(exact.inlineSize, exact.blockSize)
                } else {
                    // Otherwise, get it from the box size
                    const box = observerEntry.contentBoxSize[0]!
                    this.resize(
                        box.inlineSize * (devicePixelRatio.current ?? 1), 
                        box.blockSize * (devicePixelRatio.current ?? 1))
                }
            }
        })

        observer.observe(this.canvas)
        return observer
    }

    /*beginFrame(clearColor: GPUColor = Color.grey(0), timer: GpuTimer | null = null): Frame {
        return new Frame(this, clear, timer)
    }*/
   
   destroy(): void {
       this.observer.disconnect()
       this.gpu.destroy()
    }

    get width(): number {
        return this.canvas.width
    }
    
    get height(): number {
        return this.canvas.height
    }
 
    get aspect(): number {
        return this.canvas.width / this.canvas.height
    }
 
    get resolutionScale(): number {
        return this.scale
    }

    set resolutionScale(value: number) {
        const clamped = clamp(4, value, 0.05)
        if (clamped === this.scale) return
        
        this.scale = clamped
        this.applyScale()
    }
}   

/** Gets query data from the gpu for rendering and profiling purposes */
export class GPUTimer {
    private readonly querySet: GPUQuerySet | null = null
    private readonly resolveBuffer: Buffer | null = null

    // A pool, because a buffer cannot be mapped again while a previous mapAsync is still outstanding. One buffer would mean timing every third frame at best.
    private readonly readbackBuffers: Buffer[] = []
    private currentBuffer: Buffer | null = null

    private readonly timestamps = 2
    private readonly bytes = this.timestamps * 2

    lastMs: number | null = null

    constructor (
        renderer: Renderer, 
        readbackCount = 3, 
        label = "pass timer"
    ) {
        if (!renderer.gpu.features.has("timestamp-query")) return // May not be supported

        this.querySet = renderer.gpu.createQuerySet({ label, type: "timestamp", count: this.timestamps })

        // Create buffers
        this.resolveBuffer = Buffer.makeQueryResolveBuffer(renderer, this.bytes, `${label} resolve`)

        for (let i = 0; i < readbackCount; i++) {
            this.readbackBuffers.push(Buffer.makeReadbackBuffer(renderer, this.bytes, `${label} readback ${i}`))
        }
    }

    writes(): GPURenderPassTimestampWrites | undefined {
        if (!this.querySet) return undefined
        return { querySet: this.querySet, beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1 }
    }

    resolve(encoder: GPUCommandEncoder): void {
        if (!this.querySet || !this.resolveBuffer) return

        // Every readback buffer still mapped means the GPU is behind
        const readback = this.readbackBuffers.pop()
        if (!readback) return

        // DestinationOffset must be a multiple of 256, which is why this is always 0
        encoder.resolveQuerySet(this.querySet, 0, this.timestamps, this.resolveBuffer.handle, 0)
        encoder.copyBufferToBuffer(this.resolveBuffer.handle, 0, readback.handle, 0, this.bytes)
        this.currentBuffer = readback
    }

    read(): void {
        const readback = this.currentBuffer
        if (!readback) return
        this.currentBuffer = null

        void readback.handle
            .mapAsync(GPUMapMode.READ)
            .then(() => {
                const times = new BigUint64Array(readback.handle.getMappedRange())
                const delta = times[1]! - times[0]! // nanoseconds

                if (delta > 0n) this.lastMs = Number(delta) / 1e6 // Only accept forward progress

                readback.handle.unmap()
                this.readbackBuffers.push(readback)
            })
            .catch(() => {
                // Device lost or destroyed mid-flight - recycle and carry on
                this.readbackBuffers.push(readback)
            })
    }

    destroy(): void {
        this.querySet?.destroy()
        this.resolveBuffer?.destroy()
        this.currentBuffer?.destroy()
        for (const buffer of this.readbackBuffers) buffer.destroy()
    }
}
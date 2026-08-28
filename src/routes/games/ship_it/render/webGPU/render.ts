import { devicePixelRatio } from "svelte/reactivity/window" // Svelte reactive version of the built-in dpr
import { Assert } from "../../utilities/assert"
import { clamp } from "../../utilities/utils"
import { Buffer } from "./buffer"
import type { Pipeline } from "./pipeline"
import { Color } from "../color"


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

    beginFrame(clearColor: GPUColor = Color.grey(0), timer: GPUTimer | null = null): Frame {
        return new Frame(this, clearColor, timer)
    }
   
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
    private readonly bytes = this.timestamps * 8 // Each timestamp is a uint64 nanosecond counter

    lastMs: number | null = null

    get supported(): boolean { // Does this version of WebGPU support this feature
        return this.querySet !== null
    }

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
                try {
                    const times = new BigUint64Array(readback.handle.getMappedRange())
                    const delta = times[1]! - times[0]! // nanoseconds

                    if (delta > 0n) this.lastMs = Number(delta) / 1e6 // Only accept forward progress
                } finally {
                    // In a finally, or a throw while reading leaves the buffer
                    // mapped and the pool hands it straight to the next mapAsync
                    readback.handle.unmap()
                }
            })
            .catch(() => {
                // Device lost or destroyed mid-flight - carry on
            })
            // Recycled on both paths: a rejected mapAsync never mapped it, and the
            // resolved path has unmapped it above
            .finally(() => this.readbackBuffers.push(readback))
    }

    destroy(): void {
        this.querySet?.destroy()
        this.resolveBuffer?.destroy()
        this.currentBuffer?.destroy()
        for (const buffer of this.readbackBuffers) buffer.destroy()
    }
}

/** An individual frame that handles determines how it should render and yields profiling information */
export class Frame {
    private readonly gpu: GPUDevice
    private readonly encoder: GPUCommandEncoder
    private readonly renderPass: GPURenderPassEncoder
    private readonly timer: GPUTimer | null
    private drawCalls = 0
    private ended = false

    constructor(renderer: Renderer, clearValue: GPUColor, timer: GPUTimer | null = null, label = "frame") {
        this.gpu = renderer.gpu
        this.timer = timer

        // Fetch the current texture
        const view = renderer.context.getCurrentTexture().createView({ label: `${label} view`})

        // Create a command encoder and begin passing rendering information
        this.encoder = renderer.gpu.createCommandEncoder({ label: `${label} encoder` })
        this.renderPass = this.encoder.beginRenderPass({
            label: `${label} pass`,
            colorAttachments: [{ view, clearValue, loadOp: "clear", storeOp: "store" }],
            timestampWrites: timer?.writes(),
        })
    }

    get calls(): number {
        return this.drawCalls
    }

    setPipeline(pipeline: Pipeline): this {
        this.renderPass.setPipeline(pipeline.handle)
        return this
    }

    setBindGroup(index: number, group: GPUBindGroup): this {
        this.renderPass.setBindGroup(index, group)
        return this
    }

    setVertex(slot: number, buffer: Buffer): this {
        this.renderPass.setVertexBuffer(slot, buffer.handle)
        return this
    }

    draw(vertexCount: number, instanceCount = 1): this {
        this.renderPass.draw(vertexCount, instanceCount)
        this.drawCalls++
        return this
    }

    end(): void {
        Assert.that(!this.ended, "frame ended twice")
        this.ended = true
        this.renderPass.end()

        // Must be encoded on this encoder, after the pass, before finish()
        this.timer?.resolve(this.encoder)
        this.gpu.queue.submit([this.encoder.finish()])
        this.timer?.read()
    }

}

/** Creates the animation loop and handles fps diagnostics */
export class FrameLoop {
    private handle = 0
    private last = 0
    private smoothed = 0
    private running = false

    private readonly recent: number[] = [] // Recent frame times in seconds

    get fps(): number {
        return this.smoothed
    }

    // Estimated display frame budget in ms
    get budgetMs(): number {
        // Too few samples to judge - assume 60Hz rather than report something wild
        if (this.recent.length < 20) return 1000 / 60

        /* The 10th percentile, not the minimum. rAF occasionally fires two callbacks
        almost back to back, and a running minimum would latch onto that gap and go on
        claiming the display runs at 300Hz for the rest of the session. */
        const sorted = [...this.recent].sort((a, b) => a - b)
        return sorted[Math.floor(sorted.length * 0.1)]! * 1000
    }

    start(step: (dt: number) => void): void {
        if (this.running) return
        this.running = true

        this.last = performance.now()

        const tick = (now: number) => {
            if (!this.running) return

            // Clamped: a backgrounded tab resumes with a dt of several seconds which would teleport everything the moment physics exists
            const dt = Math.min((now - this.last) / 1000, 0.1)
            this.last = now

            if (dt > 0) {
                const instant = 1 / dt
                this.smoothed = this.smoothed === 0 ? instant : this.smoothed + (instant - this.smoothed) * 0.1
            }

            // Roughly two seconds of history, which is what budgetMs reads
            this.recent.push(dt)
            if (this.recent.length > 120) this.recent.shift()

            step(dt)

            // step() may have called stop(). Re-check before rescheduling, or a scene that halts the loop from inside a frame gets restarted anyway.
            if (this.running) this.handle = requestAnimationFrame(tick)
        }

        this.handle = requestAnimationFrame(tick)
    }

    stop(): void {
        this.running = false
        if (this.handle !== 0) cancelAnimationFrame(this.handle)
        this.handle = 0
    }
}
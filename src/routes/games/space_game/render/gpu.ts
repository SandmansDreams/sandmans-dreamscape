// Provides information for rendering including device information and canvas context

import { devicePixelRatio } from "svelte/reactivity/window" // Svelte reactive version of the built-in dpr
import { Assert } from "../dev/assert"
import { COLOR_BLACK, Frame } from "./frame"
import type { GpuTimer } from "./timing"

export class GPU {
    readonly canvas: HTMLCanvasElement
    readonly device: GPUDevice
    readonly context: GPUCanvasContext
    readonly format: GPUTextureFormat

    private readonly maxSize: number
    private readonly observer: ResizeObserver

    private constructor(
        canvas: HTMLCanvasElement,
        device: GPUDevice,
        context: GPUCanvasContext,
        format: GPUTextureFormat,
    ) {
        this.canvas = canvas
        this.device = device
        this.context = context
        this.format = format
        this.maxSize = device.limits.maxTextureDimension2D

        this.resize(
            canvas.clientWidth * (devicePixelRatio.current ?? 1), 
            canvas.clientHeight * (devicePixelRatio.current ?? 1)
        )

        // Establish a resizeObserver to change the canvas size when the window / canvas changes
        this.observer = new ResizeObserver((entries) => {
            for (const entry of entries) {
                const exact = entry.devicePixelContentBoxSize?.[0]

                if (exact) {
                    // If pixel size exists, resize using exact pixels
                    this.resize(exact.inlineSize, exact.blockSize)
                } else {
                    const box = entry.contentBoxSize[0]!
                    this.resize(
                        // Otherwise, get it from the box size
                        box.inlineSize * (devicePixelRatio.current ?? 1), 
                        box.blockSize * (devicePixelRatio.current ?? 1))
                }
            }
        })
        this.observer.observe(canvas)
    }

    static async create(canvas: HTMLCanvasElement): Promise<GPU> {
        // Make sure the browser supports WebGPU
        Assert.exists(navigator.gpu, "navigator.gpu — this browser has no WebGPU")

        const adapter = await navigator.gpu.requestAdapter()
        Assert.exists(adapter, "GPU adapter — WebGPU exists but no adapter was available")

        const device = await adapter.requestDevice({
            label: "space game device",
            // Optional feature: asking for one the adapter lacks rejects the request,
            // so check first and degrade to no GPU timing rather than failing to start
            requiredFeatures: adapter.features.has("timestamp-query") ? ["timestamp-query"] : [],
        })

        const context = canvas.getContext("webgpu")
        Assert.exists(context, "webgpu canvas context")

        const format = navigator.gpu.getPreferredCanvasFormat()
        context.configure({ device, format, alphaMode: "opaque" })

        void device.lost.then((info) => {
            console.error(`WebGPU device lost (${info.reason}): ${info.message}`)
        })
        device.onuncapturederror = (event) => {
            console.error("WebGPU device error:", event.error.message)
        }

        return new GPU(canvas, device, context, format)
    }

    beginFrame(clear: GPUColor = COLOR_BLACK, timer: GpuTimer | null = null): Frame {
        return new Frame(this, clear, timer)
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

    private resize(width: number, height: number): void {
        // 0 is an invalid texture size, anything over the device limit throws on the next frame
        this.canvas.width = Math.max(1, Math.min(Math.round(width), this.maxSize))
        this.canvas.height = Math.max(1, Math.min(Math.round(height), this.maxSize))
    }

    destroy(): void {
        this.observer.disconnect()
        this.device.destroy()
    }
}
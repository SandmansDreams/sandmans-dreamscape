import { devicePixelRatio } from "svelte/reactivity/window" // Svelte reactive version of the built-in dpr
import { Assert } from "../../Assert"
import { clamp } from "../../utils"
import { Color } from "../Color"


/** Communicates between the code and the computer's GPU to render things */
export class WebGPURenderer {
    readonly canvas: HTMLCanvasElement
    readonly device: GPUDevice
    readonly context: GPUCanvasContext
    readonly format: GPUTextureFormat

    private readonly maxSize: number
    private readonly observer: ResizeObserver

    private nativeWidth = 1
    private nativeHeight = 1
    private scale = 1

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

        this.observer = this.createObserver()
    }

    static async create(canvas: HTMLCanvasElement): Promise<WebGPURenderer> {
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

        return new WebGPURenderer(canvas, device, context, format)
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
       this.device.destroy()
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
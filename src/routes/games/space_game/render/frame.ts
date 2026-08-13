// Create command encoder and bring it all together per-frame?

import { Assert } from "../assert"
import type { Buffer } from "./webgpu/buffer"
import type { GPU } from "./webgpu/gpu"
import type { Pipeline } from "./webgpu/pipeline"
import type { GpuTimer } from "./timing"

export const COLOR_BLACK: GPUColor = [0, 0, 0, 1]
export const COLOR_WHITE: GPUColor = [1, 1, 1, 1]
export const COLOR_GRAY: GPUColor = [0.5, 0.5, 0.5, 1]

export class Frame {
    private readonly device: GPUDevice
    private readonly encoder: GPUCommandEncoder
    private readonly renderPass: GPURenderPassEncoder
    private readonly timer: GpuTimer | null
    private drawCalls = 0
    private ended = false

    constructor(gpu: GPU, clear: GPUColor, timer: GpuTimer | null = null, label = "frame") {
        this.device = gpu.device
        this.timer = timer

        // Fetch the current texture every frame
        const view = gpu.context.getCurrentTexture().createView({ label: `${label} view`})

        // Create a command encoder and begin passing rendering information
        this.encoder = this.device.createCommandEncoder({ label: `${label} encoder` })
        this.renderPass = this.encoder.beginRenderPass({
            label: `${label} pass`,
            colorAttachments: [{ view, clearValue: clear, loadOp: "clear", storeOp: "store" }],
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
        this.device.queue.submit([this.encoder.finish()])
        this.timer?.read()
    }
}
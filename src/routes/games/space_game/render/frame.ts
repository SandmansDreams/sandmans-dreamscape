// Create command encoder and bring it all together per-frame?

import { Assert } from "../dev/assert"
import type { Buffer } from "./buffer"
import type { GPU } from "./gpu"
import type { Pipeline } from "./pipeline"

export const COLOR_BLACK: GPUColor = [0, 0, 0, 1]
export const COLOR_WHITE: GPUColor = [1, 1, 1, 1]
export const COLOR_GREY: GPUColor = [0.5, 0.5, 0.5, 1]

export class Frame {
    private readonly device: GPUDevice
    private readonly encoder: GPUCommandEncoder
    private readonly renderPass: GPURenderPassEncoder
    private ended = false

    constructor(gpu: GPU, clear: GPUColor, label = "frame") {
        this.device = gpu.device

        // Fetch the current texture every frame
        const view = gpu.context.getCurrentTexture().createView({ label: `${label} view`})

        // Create a command encoder and begin passing rendering information
        this.encoder = this.device.createCommandEncoder({ label: `${label} encoder` })
        this.renderPass = this.encoder.beginRenderPass({
            label: `${label} pass`,
            colorAttachments: [{ view, clearValue: clear, loadOp: "clear", storeOp: "store" }],
        })
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
        return this
    }

    end(): void {
        Assert.that(!this.ended, "frame ended twice")
        this.ended = true
        this.renderPass.end()
        this.device.queue.submit([this.encoder.finish()])
    }
}
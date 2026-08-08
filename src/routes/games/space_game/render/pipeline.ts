import { Assert } from "../dev/assert"
import type { GPU } from "./gpu"
import type { Shader } from "./shader"

export type BlendMode = "none" | "alpha" | "additive"

export interface PipelineOptions {
    label?: string
    shader: Shader
    vertexEntry?: string
    fragmentEntry?: string
    /** By group index. 0 = per frame, 1 = per material, 2 = per draw. */
    layouts?: GPUBindGroupLayout[]
    vertexBuffers?: GPUVertexBufferLayout[]
    blend?: BlendMode
    topology?: GPUPrimitiveTopology
}

function blendState(mode: BlendMode): GPUBlendState | undefined { // Turns blend mode into blend state 
    switch (mode) {
        case "none":
            return undefined
        case "alpha":
            return {
                color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha", operation: "add" },
                alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
            }
        case "additive":
            return {
                color: { srcFactor: "src-alpha", dstFactor: "one", operation: "add" },
                alpha: { srcFactor: "zero", dstFactor: "one", operation: "add" },
            }
    }
}

export class Pipeline {
    readonly handle: GPURenderPipeline
    private readonly device: GPUDevice
    private readonly layouts: readonly GPUBindGroupLayout[]

    private constructor(device: GPUDevice, handle: GPURenderPipeline, layouts: readonly GPUBindGroupLayout[]) {
        this.device = device
        this.handle = handle
        this.layouts = layouts
    }

    static create(gpu: GPU, options: PipelineOptions): Pipeline {
        const label = options.label ?? "pipeline"
        const layouts = options.layouts ?? []

        /* Pass in a bunch of stuff that WebGPU requires in order to render including: 
            - layout (if provided)
            - vertex shader
            - fragment shader
            - topology options
        */
        const handle = gpu.device.createRenderPipeline({
            label,
            layout: layouts.length > 0 // Layout options if any
                ? gpu.device.createPipelineLayout({ 
                    label: `${label} layout`, 
                    bindGroupLayouts: layouts
                })
                : 'auto',
            vertex: { // Vertex shader
                module: options.shader.module,
                entryPoint: options.vertexEntry ?? 'vs',
                buffers: options.vertexBuffers ?? [],
            },
            fragment: { // Fragment shader
                module: options.shader.module,
                entryPoint: options.fragmentEntry ?? 'fs',
                targets: [{ format: gpu.format, blend: blendState(options.blend ?? "none")}]
            },
            primitive: { topology: options.topology ?? "triangle-list"} // The style of primitive algorithm used for filling shapes
        })

        return new Pipeline(gpu.device, handle, layouts)
    }

    bindGroup(index: number, entries: GPUBindGroupEntry[], label = "bind group"): GPUBindGroup { // Bind a group layout to the GPU device
        const layout = this.layouts[index] ?? this.handle.getBindGroupLayout(index)
        Assert.exists(layout, `bind group layout ${index}`)
        return this.device.createBindGroup({ label, layout, entries })
    }
}
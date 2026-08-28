import { Assert } from "../../utilities/assert"
import type { Renderer } from "./render"
import type { Shader } from "./shader"

export type BlendMode = "none" | "alpha" | "additive" | "invert"

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

/** Turns blend mode string into WebGPUBlendState */
function blendState(mode: BlendMode): GPUBlendState | undefined { 
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
        case "invert":
            return {
                color: { srcFactor: "one-minus-dst", dstFactor: "zero", operation: "add" },
                alpha: { srcFactor: "zero", dstFactor: "one", operation: "add" },
            }
    }
}

/** Create an empty layout for reserving a group index nothing uses yet */
export function emptyBindGroupLayout(renderer: Renderer, label = "empty"): GPUBindGroupLayout {
    return renderer.gpu.createBindGroupLayout({ label: `${label} layout`, entries: [] })
}

/** Handles the rendering pipeline and sets up shaders */
export class Pipeline {
    readonly handle: GPURenderPipeline
    private readonly device: GPUDevice
    private readonly layouts: readonly GPUBindGroupLayout[]

    private constructor(device: GPUDevice, handle: GPURenderPipeline, layouts: readonly GPUBindGroupLayout[]) {
        this.device = device
        this.handle = handle
        this.layouts = layouts
    }

    static create(renderer: Renderer, options: PipelineOptions): Pipeline {
        const label = options.label ?? "pipeline"
        const layouts = options.layouts ?? []

        /* Pass in a bunch of stuff that WebGPU requires in order to render including: 
            - layout (if provided)
            - vertex shader
            - fragment shader
            - topology options
        */
        const layout = layouts.length > 0 // Layout options if any
            ? renderer.gpu.createPipelineLayout({ 
                label: `${label} layout`, 
                bindGroupLayouts: layouts
            })
            : 'auto'

        const vertex = { // Vertex shader
            module: options.shader.module,
            entryPoint: options.vertexEntry ?? 'vs',
            buffers: options.vertexBuffers ?? [],
        }

        const fragment = { // Fragment shader
            module: options.shader.module,
            entryPoint: options.fragmentEntry ?? 'fs',
            targets: [{ format: renderer.format, blend: blendState(options.blend ?? "none")}]
        }

        const primitive = { topology: options.topology ?? "triangle-list"} // The style of primitive algorithm used for filling shapes

        const handle = renderer.gpu.createRenderPipeline({
            label,
            layout,
            vertex,
            fragment,
            primitive
        })

        return new Pipeline(renderer.gpu, handle, layouts)
    }

    bindGroup(index: number, entries: GPUBindGroupEntry[], label = "bind group"): GPUBindGroup { // Bind a group layout to the GPU device
        const layout = this.layouts[index] ?? this.handle.getBindGroupLayout(index)
        Assert.exists(layout, `bind group layout ${index}`)
        return this.device.createBindGroup({ label, layout, entries })
    }
}


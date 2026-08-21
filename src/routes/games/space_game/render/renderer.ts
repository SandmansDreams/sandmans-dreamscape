// The GPU objects every scene shares, owned above them rather than by each one

import { CameraBinding } from "./camera"
import { INSTANCED_2D } from "./shaders/instanced2d"
import { MESH_2D } from "./shaders/mesh2d"
import { VERTEX_LAYOUT } from "./mesh"
import { emptyBindGroupLayout, Pipeline } from "./webgpu/pipeline"
import { LightBinding } from "./lighting"
import { CELL_VERTEX_LAYOUT } from "./mesh"
import { LIT_2D } from "./shaders/lit2d"
import { InstanceBatch } from "./webgpu/instance"
import type { GPU } from "./webgpu/gpu"
import { Shader } from "./webgpu/shader"

/**
 * Shaders, pipelines and the camera binding, built once for the device.
 *
 * Owned by whoever owns the device - the runner today, `Game` later - because
 * every object in here lives as long as the device does and a scene does not.
 * Six scenes each compiling MESH_2D and building the same solid/line pair is six
 * copies of one pipeline, thrown away and rebuilt on every scene swap.
 *
 * Named pipelines rather than a keyed cache: a general `pipeline(options)` would
 * need a stable key over the shader, the bind group layouts and the vertex
 * layouts, and those are opaque GPU objects with no structural identity - the
 * key would have to be invented and then kept in step with the real options by
 * hand. Named accessors are the honest description of what this project draws
 * with, and the next pipeline is one more accessor.
 *
 * Everything is built on first ask. A scene that only draws lines has no reason
 * to compile the instanced shader.
 */
export class Renderer {
    readonly gpu: GPU

    /**
     * The camera's bind group, shared because only one scene is alive at a time.
     *
     * One uniform buffer, so a scene that uploads two different cameras within a
     * single frame gets the second one in both passes - `queue.writeBuffer` is
     * ordered against submit, not against the draws recorded between the writes.
     * A scene that genuinely needs two viewpoints at once needs a second binding
     * of its own; it cannot get there by uploading twice.
     */
    readonly camera: CameraBinding

    /** The layout every InstanceBatch in the project must be created against. */
    readonly instanceLayout: GPUBindGroupLayout

    /**
     * Group 1 for anything drawn unlit.
     *
     * Reserved for materials from the start and empty ever since. The lit
     * pipeline puts the lighting binding here instead, which is what that
     * reservation was for.
     */
    private readonly materialLayout: GPUBindGroupLayout

    /** The layout the lit pipeline expects at group 1. See LightBinding. */
    readonly lightLayout: GPUBindGroupLayout

    private meshShader: Shader | null = null
    private instancedShader: Shader | null = null

    private meshPipeline: Pipeline | null = null
    private meshLinesPipeline: Pipeline | null = null
    private meshInvertPipeline: Pipeline | null = null
    private instancedPipeline: Pipeline | null = null
    private instancedLinesPipeline: Pipeline | null = null
    private instancedGlowPipeline: Pipeline | null = null
    private litPipeline: Pipeline | null = null
    private litAlphaPipeline: Pipeline | null = null
    private instancedAlphaPipeline: Pipeline | null = null
    private litShader: Shader | null = null

    private constructor(
        gpu: GPU,
        camera: CameraBinding,
        instanceLayout: GPUBindGroupLayout,
        materialLayout: GPUBindGroupLayout,
        lightLayout: GPUBindGroupLayout,
    ) {
        this.gpu = gpu
        this.camera = camera
        this.instanceLayout = instanceLayout
        this.materialLayout = materialLayout
        this.lightLayout = lightLayout
    }

    static create(gpu: GPU): Renderer {
        return new Renderer(
            gpu,
            CameraBinding.create(gpu),
            InstanceBatch.layout(gpu),
            emptyBindGroupLayout(gpu),
            LightBinding.layoutFor(gpu),
        )
    }

    /**
     * Instanced hulls, shaded per cell. The default way to draw a ship.
     *
     * Takes a second vertex buffer of cell centres, so only meshes built through
     * appendBlock can be drawn with it - which is the same thing as saying only
     * meshes made of cells can be lit.
     */
    get lit(): Pipeline {
        this.litPipeline ??= Pipeline.create(this.gpu, {
            label: "lit 2d",
            shader: this.lit2d(),
            layouts: [this.camera.layout, this.lightLayout, this.instanceLayout],
            vertexBuffers: [VERTEX_LAYOUT, CELL_VERTEX_LAYOUT],
        })

        return this.litPipeline
    }

    /**
     * The same lit hull, blended by the instance's alpha.
     *
     * For a layer you want to see *through* rather than past. The alternative the
     * builder used before this - washing colours toward the background - only
     * looks translucent over the background itself; over another layer it just
     * fades, which is the opposite of showing what is underneath.
     *
     * There is no depth buffer, so what lands on top is whatever was drawn last:
     * SHIP_LAYERS is bottom to top for exactly this reason.
     */
    get litAlpha(): Pipeline {
        this.litAlphaPipeline ??= Pipeline.create(this.gpu, {
            label: "lit 2d alpha",
            shader: this.lit2d(),
            layouts: [this.camera.layout, this.lightLayout, this.instanceLayout],
            vertexBuffers: [VERTEX_LAYOUT, CELL_VERTEX_LAYOUT],
            blend: "alpha",
        })

        return this.litAlphaPipeline
    }

    /** Instanced triangles blended by the instance's alpha. The unlit twin of litAlpha. */
    get instancedAlpha(): Pipeline {
        this.instancedAlphaPipeline ??= Pipeline.create(this.gpu, {
            label: "instanced 2d alpha",
            shader: this.instanced2d(),
            layouts: [this.camera.layout, this.materialLayout, this.instanceLayout],
            vertexBuffers: [VERTEX_LAYOUT],
            blend: "alpha",
        })

        return this.instancedAlphaPipeline
    }

    /** Triangles in the shared 2D mesh format. What almost every scene draws. */
    get mesh(): Pipeline {
        this.meshPipeline ??= Pipeline.create(this.gpu, {
            label: "mesh 2d",
            shader: this.mesh2d(),
            layouts: [this.camera.layout],
            vertexBuffers: [VERTEX_LAYOUT],
        })

        return this.meshPipeline
    }

    /**
     * Triangles that come out as the negative of whatever they cover.
     *
     * For a marker that has to stay visible over anything: draw it white and it
     * lands as the exact opposite of the pixels beneath, so it can never be lost
     * against a hull that happens to be the same colour.
     */
    get meshInvert(): Pipeline {
        this.meshInvertPipeline ??= Pipeline.create(this.gpu, {
            label: "mesh 2d invert",
            shader: this.mesh2d(),
            layouts: [this.camera.layout],
            vertexBuffers: [VERTEX_LAYOUT],
            blend: "invert",
        })

        return this.meshInvertPipeline
    }

    /** The same vertices as a line list, for outlines and wireframes. */
    get meshLines(): Pipeline {
        this.meshLinesPipeline ??= Pipeline.create(this.gpu, {
            label: "mesh 2d lines",
            shader: this.mesh2d(),
            layouts: [this.camera.layout],
            vertexBuffers: [VERTEX_LAYOUT],
            topology: "line-list",
        })

        return this.meshLinesPipeline
    }

    get instanced(): Pipeline {
        this.instancedPipeline ??= Pipeline.create(this.gpu, {
            label: "instanced 2d",
            shader: this.instanced2d(),
            layouts: [this.camera.layout, this.materialLayout, this.instanceLayout],
            vertexBuffers: [VERTEX_LAYOUT],
        })

        return this.instancedPipeline
    }

    /**
     * Instanced quads that add their colour to whatever is behind them.
     *
     * For anything that glows rather than covers: exhaust, sparks, muzzle flash.
     * Additive rather than alpha because these overlap heavily and additive needs
     * no sorting to look right - two sparks on top of each other are simply
     * brighter, which is what two sparks actually are.
     */
    get instancedGlow(): Pipeline {
        this.instancedGlowPipeline ??= Pipeline.create(this.gpu, {
            label: "instanced 2d glow",
            shader: this.instanced2d(),
            layouts: [this.camera.layout, this.materialLayout, this.instanceLayout],
            vertexBuffers: [VERTEX_LAYOUT],
            blend: "additive",
        })

        return this.instancedGlowPipeline
    }

    get instancedLines(): Pipeline {
        this.instancedLinesPipeline ??= Pipeline.create(this.gpu, {
            label: "instanced 2d lines",
            shader: this.instanced2d(),
            layouts: [this.camera.layout, this.materialLayout, this.instanceLayout],
            vertexBuffers: [VERTEX_LAYOUT],
            topology: "line-list",
        })

        return this.instancedLinesPipeline
    }

    /**
     * Only the camera buffer needs freeing.
     *
     * Shader modules, pipelines and bind group layouts have no destroy() in
     * WebGPU - they are released when nothing references them - so dropping the
     * renderer is the whole of cleaning them up.
     */
    destroy(): void {
        this.camera.destroy()
    }

    private mesh2d(): Shader {
        this.meshShader ??= Shader.createNow(this.gpu, MESH_2D, "mesh 2d")
        return this.meshShader
    }

    private instanced2d(): Shader {
        this.instancedShader ??= Shader.createNow(this.gpu, INSTANCED_2D, "instanced 2d")
        return this.instancedShader
    }

    private lit2d(): Shader {
        this.litShader ??= Shader.createNow(this.gpu, LIT_2D, "lit 2d")
        return this.litShader
    }
}

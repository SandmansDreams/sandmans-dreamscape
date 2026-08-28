// The GPU objects every scene shares, owned above them rather than by each one.
//
// Named `Pipelines` rather than `Renderer` because that name is taken by the
// device wrapper. It owns the camera binding and the instance layout too: those
// are groups 0 and 2 of every pipeline in here, so they are the layouts these
// pipelines are built against rather than a separate concern.
//
// Owned by Game, because every object in here lives as long as the device does
// and a scene does not. Six scenes each compiling MESH_2D and building the same
// solid/line pair is six copies of one pipeline, thrown away on every swap.
//
// Named accessors rather than a keyed cache: a general `pipeline(options)` would
// need a stable key over the shader, the bind group layouts and the vertex
// layouts, and those are opaque GPU objects with no structural identity - the
// key would have to be invented and then kept in step by hand. Everything is
// built on first ask, so a scene that only draws lines never compiles the
// instanced shader.

import { CameraBinding } from "./camera"
import { VERTEX_LAYOUT } from "./mesh"
import { InstanceBatch } from "./webGPU/instancedbatch"
import { emptyBindGroupLayout, Pipeline } from "./webGPU/pipeline"
import type { Renderer } from "./webGPU/render"
import { Shader } from "./webGPU/shader"
import { INSTANCED_2D } from "./webGPU/shaders/instanced2d"
import { MESH_2D } from "./webGPU/shaders/mesh2d"

export class Pipelines {
    readonly renderer: Renderer

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
     * Reserved for materials and empty ever since. The lit pipeline puts the
     * lighting binding here instead, which is what that reservation was for.
     */
    private readonly materialLayout: GPUBindGroupLayout

    private meshShader: Shader | null = null
    private instancedShader: Shader | null = null

    private meshPipeline: Pipeline | null = null
    private meshLinesPipeline: Pipeline | null = null
    private meshGlowPipeline: Pipeline | null = null
    private meshInvertPipeline: Pipeline | null = null
    private instancedPipeline: Pipeline | null = null
    private instancedLinesPipeline: Pipeline | null = null
    private instancedGlowPipeline: Pipeline | null = null
    private instancedAlphaPipeline: Pipeline | null = null

    private constructor(
        renderer: Renderer,
        camera: CameraBinding,
        instanceLayout: GPUBindGroupLayout,
        materialLayout: GPUBindGroupLayout,
    ) {
        this.renderer = renderer
        this.camera = camera
        this.instanceLayout = instanceLayout
        this.materialLayout = materialLayout
    }

    static create(renderer: Renderer): Pipelines {
        return new Pipelines(
            renderer,
            CameraBinding.create(renderer),
            InstanceBatch.layout(renderer),
            emptyBindGroupLayout(renderer),
        )
    }

    /** Triangles in the shared 2D mesh format. What almost every scene draws. */
    get mesh(): Pipeline {
        this.meshPipeline ??= Pipeline.create(this.renderer, {
            label: "mesh 2d",
            shader: this.mesh2d(),
            layouts: [this.camera.layout],
            vertexBuffers: [VERTEX_LAYOUT],
        })

        return this.meshPipeline
    }

    /** The same vertices as a line list, for outlines and wireframes. */
    get meshLines(): Pipeline {
        this.meshLinesPipeline ??= Pipeline.create(this.renderer, {
            label: "mesh 2d lines",
            shader: this.mesh2d(),
            layouts: [this.camera.layout],
            vertexBuffers: [VERTEX_LAYOUT],
            topology: "line-list",
        })

        return this.meshLinesPipeline
    }

    /**
     * Plain triangles that add their colour to whatever is behind them.
     *
     * For geometry there is exactly one of and which is built rather than
     * repeated - a run of wire between two named cells is not something you
     * place a hundred copies of.
     */
    get meshGlow(): Pipeline {
        this.meshGlowPipeline ??= Pipeline.create(this.renderer, {
            label: "mesh 2d glow",
            shader: this.mesh2d(),
            layouts: [this.camera.layout],
            vertexBuffers: [VERTEX_LAYOUT],
            blend: "additive",
        })

        return this.meshGlowPipeline
    }

    /**
     * Triangles that come out as the negative of whatever they cover.
     *
     * Draw white through this and it lands as the exact opposite of the pixels
     * beneath, so a marker can never be lost against a hull that happens to be
     * the same colour.
     */
    get meshInvert(): Pipeline {
        this.meshInvertPipeline ??= Pipeline.create(this.renderer, {
            label: "mesh 2d invert",
            shader: this.mesh2d(),
            layouts: [this.camera.layout],
            vertexBuffers: [VERTEX_LAYOUT],
            blend: "invert",
        })

        return this.meshInvertPipeline
    }

    /** One mesh repeated from a storage buffer of transforms. The workhorse. */
    get instanced(): Pipeline {
        this.instancedPipeline ??= Pipeline.create(this.renderer, {
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
        this.instancedGlowPipeline ??= Pipeline.create(this.renderer, {
            label: "instanced 2d glow",
            shader: this.instanced2d(),
            layouts: [this.camera.layout, this.materialLayout, this.instanceLayout],
            vertexBuffers: [VERTEX_LAYOUT],
            blend: "additive",
        })

        return this.instancedGlowPipeline
    }

    /** Instanced triangles blended by the instance's alpha. */
    get instancedAlpha(): Pipeline {
        this.instancedAlphaPipeline ??= Pipeline.create(this.renderer, {
            label: "instanced 2d alpha",
            shader: this.instanced2d(),
            layouts: [this.camera.layout, this.materialLayout, this.instanceLayout],
            vertexBuffers: [VERTEX_LAYOUT],
            blend: "alpha",
        })

        return this.instancedAlphaPipeline
    }

    get instancedLines(): Pipeline {
        this.instancedLinesPipeline ??= Pipeline.create(this.renderer, {
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
     * WebGPU - they are released when nothing references them - so dropping this
     * object is the whole of cleaning them up.
     */
    destroy(): void {
        this.camera.destroy()
    }

    private mesh2d(): Shader {
        this.meshShader ??= Shader.createNow(this.renderer, MESH_2D, "mesh 2d")
        return this.meshShader
    }

    private instanced2d(): Shader {
        this.instancedShader ??= Shader.createNow(this.renderer, INSTANCED_2D, "instanced 2d")
        return this.instancedShader
    }
}

/*
 * No `lit` accessor yet, deliberately.
 *
 * LIT_2D is ported, but the lit pipeline binds LightBinding at group 1 and takes
 * CELL_VERTEX_LAYOUT as a second vertex buffer. Neither exists here yet, so an
 * accessor would have no layout to build against. Add it alongside LightBinding,
 * not before.
 */

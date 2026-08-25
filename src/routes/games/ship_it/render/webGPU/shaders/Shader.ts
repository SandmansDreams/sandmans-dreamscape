import type { Renderer } from "../render"

/** A WebGPU shader management class */
export class Shader {
    readonly module: GPUShaderModule // The actual WebGPU shader module reference
    readonly label: string

    private constructor(module: GPUShaderModule, label: string) {
        this.module = module
        this.label = label
    }

    static async create(renderer: Renderer, code: string, label = "shader"): Promise<Shader> {
        const shader = new Shader(
            renderer.gpu.createShaderModule({label, code}),
            label
        )
        await shader.check()
        return shader
    }

    /**
     * For call sites that cannot await, such as SceneDefinition.create. Compilation
     * problems still surface, but as a console error a moment later rather than a
     * thrown exception at the call site.
     */
    static createNow(renderer: Renderer, code: string, label = "shader"): Shader {
        const shader = new Shader(renderer.gpu.createShaderModule({ label, code }), label)
        void shader.check().catch((error) => console.error(error))
        return shader
    }

    /** Ensure the shader compiled properly */
    async check(): Promise<void> {
        const info = await this.module.getCompilationInfo()
        
        // If no issues, return
        if (info.messages.length === 0) return

        // If there are just warnings, create a report and warn
        const report = [
            `Shader '${this.label}':`,
            ...info.messages.map((m) => `  ${m.type} at ${m.lineNum}:${m.linePos} — ${m.message}`),
        ].join("\n")

        // If there are actual errors, throw
        if (info.messages.some((m) => m.type === "error")) throw new Error(report)

        console.warn(report)
    }

}
// Creates shader modules and provides diagnostics

import type { GPU } from "./gpu"

export class Shader {
    readonly module: GPUShaderModule // The actual WebGPU shader module reference
    readonly label: string // The label of the shader

    private constructor(module: GPUShaderModule, label: string) {
        this.module = module
        this.label = label
    }

    static async create(gpu: GPU, code: string, label = "shader"): Promise<Shader> {
        const shader = new Shader(
            gpu.device.createShaderModule({label, code}),
            label
        )
        await shader.check()
        return shader
    }

    async check(): Promise<void> { // Check to make sure the shader compiled correctly
        const info = await this.module.getCompilationInfo()
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
/*import { Color } from "../../render/color"
import { Camera } from "../../render/camera"
import { DEFAULT_FONT, FONT_NAMES, fontByName, type BitmapFont } from "../../render/font"
import type { Frame } from "../../render/frame"
import { Mesh, MeshBuilder } from "../../render/mesh"
import type { SceneContext, SceneInstance } from "../../render/scene"
import { defaultValues, type SettingsSchema, type ValuesOf } from "../../_Old Versions/Vers_4 - WebGPU Mostly Vibed/settings/settings"
import type { DevSceneDefinition } from "../DevScene"

const DEFAULT_TEXT = [
    "Sphinx of black quartz, judge my vow.",
    "THE QUICK BROWN FOX JUMPS OVER THE LAZY DOG.",
    "0123456789 !\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~",
    "supercalifragilisticexpialidocious",
    "SpaceGame^tm"
].join("\n")

const SETTINGS = {
    font:        { type: "selection", label: "Font", default: DEFAULT_FONT.name, options: FONT_NAMES },
    text:        { type: "text", label: "Text", default: DEFAULT_TEXT, placeholder: "Type to draw...", rows: 4 },
    wrap:        { type: "range", label: "Wrap", default: 240, min: 20, max: 4000, step: 1, scale: "log", unit: "u" },
    pixel:       { type: "range", label: "Pixel", default: 4, min: 1, max: 16, step: 1 },
    color:       { type: "color", label: "Color", default: "#88ddff" },
    letter:      { type: "range", label: "Letter sp", default: 1, min: 0, max: 6, step: 1 },
    line:        { type: "range", label: "Line sp", default: 3, min: 0, max: 12, step: 1 },
    align:       { type: "selection", label: "Align", default: "left", options: ["left", "center", "right", "justify"], display: "segmented" },
    justifyLast: { type: "checkbox", label: "Justify last", default: false },
} as const satisfies SettingsSchema

type FontValues = ValuesOf<typeof SETTINGS>

class FontTest implements SceneInstance<FontValues> {
    private readonly context: SceneContext
    private readonly camera = new Camera()

    private mesh: Mesh | null = null
    private bounds = { left: 0, top: 0, right: 1, bottom: 1 }
    private builtKey = ""

    constructor(context: SceneContext) {
        this.context = context
    }

    update(_dt: number, settings: FontValues): void {
        const font = fontByName(settings.font)

        // These mutate the shared FONTS entry, which is the point - it is how you
        // tune a sheet by eye before writing the result into OVERRIDES
        font.letterSpacing = settings.letter
        font.lineSpacing = settings.line

        // `loaded` is part of the key because sheets arrive asynchronously: the first
        // build runs before the fetch returns and produces nothing, and the flag
        // flipping is what makes it happen again once the glyphs exist.
        const key = `${font.loaded}|${JSON.stringify(settings)}`

        if (key === this.builtKey) return

        this.rebuild(font, settings)
        this.builtKey = key
    }

    render(frame: Frame): void {
        if (!this.mesh) return
        const gpu = this.context.gpu

        // Refit every frame so a window resize reframes the text for free
        const { left, top, right, bottom } = this.bounds
        this.camera.fit(left, top, right, bottom, gpu.width, gpu.height)
        const { camera, mesh: pipeline } = this.context.renderer
        camera.upload(this.camera, gpu.width, gpu.height)

        frame.setPipeline(pipeline).setBindGroup(0, camera.group)
        this.mesh.draw(frame)
    }

    dispose(): void {
        this.mesh?.destroy()
    }

    private rebuild(font: BitmapFont, settings: FontValues): void {
        const pixel = settings.pixel
        const wrapped = font.wrap(settings.text, settings.wrap, pixel)

        const builder = new MeshBuilder()
        const width = font.appendText(builder, wrapped, 0, 0, pixel, Color.from(settings.color), {
            align: settings.align,
            // The same width the text was wrapped to, so justify fills exactly the
            // measure the line breaks were chosen for
            width: settings.wrap,
            justifyLastLine: settings.justifyLast,
        })

        this.mesh?.destroy()

        // Nothing to draw while the sheet is still loading, or for empty text
        if (builder.vertexCount === 0) {
            this.mesh = null
            return
        }

        this.mesh = builder.build(this.context.gpu, "text")
        this.context.stats.set("text quads", builder.vertexCount / 6)

        this.bounds = {
            left: 0,
            top: 0,
            right: Math.max(width, 1),
            bottom: Math.max(font.measureTextHeight(wrapped, pixel) + font.descent * pixel, 1),
        }
    }
}

const scene: DevSceneDefinition<FontValues> = {
    id: "font-test",
    name: "Font Test",
    description:
        "Each sheet in assets/fonts, cut into glyphs at load time and drawn as run-merged " +
        "quads. Compare iiii against MMMM to see mono versus spaced advances.",
    settings: SETTINGS,
    create: (context) => new FontTest(context),
}

export default scene*/
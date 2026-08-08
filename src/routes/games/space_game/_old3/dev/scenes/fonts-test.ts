import { Camera } from "../../../render/camera";
import { type BitmapFont, DEFAULT_FONT, FONT_NAMES, fontByName } from "../../../render/font";
import { Mesh } from "../../../render/mesh";
import { MINIMAL_2D_FRAGMENT_SOURCE, MINIMAL_2D_VERTEX_SOURCE, Program, Shader } from "../../../render/shaders";
import type { SettingsSchema, ValuesOf } from "../../../settings/settings";
import type { SceneContext, SceneInstance } from "../../../render/scenes";
import type { DevSceneDefinition } from "../DevScene";

/** Every non-letter cell of the sheet's formatting table, in table order. */
const SYMBOLS = "!\"#$%&'()*+,-./0123456789:;<=>?@[\\]^_`{|}~"

/** A pangram covers both cases; the symbols cover everything it misses. */
const DEFAULT_TEXT = `The quick brown fox jumps over the lazy dog. ${SYMBOLS}`

const SETTINGS = {
    font: { type: "selection", label: "Font", default: DEFAULT_FONT.name, options: FONT_NAMES },
    wrap: { type: "range", label: "Wrap", default: 40, min: 4, max: 80, step: 1 },
    text: { type: "text", label: "Text", default: DEFAULT_TEXT, placeholder: "Type to draw...", rows: 4 },
} as const satisfies SettingsSchema

type FontValues = ValuesOf<typeof SETTINGS>

type Color = readonly [number, number, number]

const TEXT_COLOR: Color = [0.90, 0.93, 0.96]

/** World units per font pixel. The camera fits the result, so only ratios matter. */
const PIXEL = 1

/**
 * Breaks `text` at the newlines it already contains, then hard-breaks anything
 * still longer than `columns` characters - on the count rather than on word
 * boundaries.
 *
 * Counted the same way appendText walks the string - by code point rather than
 * by UTF-16 unit - so a wrapped line is always `columns` glyphs wide, whatever
 * ends up in the field.
 */
function breakLines(text: string, columns: number): string {
    // A zero or negative step would never terminate, and the slider's own
    // minimum is not worth trusting on its own.
    const step = Math.max(1, Math.floor(columns))
    const lines: string[] = []

    for (const paragraph of text.split("\n")) {
        const characters = [...paragraph]

        // A deliberate blank line. Slicing an empty string produces nothing,
        // so without this the line would silently disappear.
        if (characters.length === 0) {
            lines.push("")
            continue
        }

        for (let i = 0; i < characters.length; i += step) {
            lines.push(characters.slice(i, i + step).join(""))
        }
    }

    return lines.join("\n")
}

class FontTest implements SceneInstance<FontValues> {
    private readonly gl2: WebGL2RenderingContext
    private readonly canvas: HTMLCanvasElement
    private readonly program: Program
    private readonly camera = new Camera()

    private mesh: Mesh | null = null
    private bounds = { left: 0, top: 0, right: 1, bottom: 1 }
    private builtKey = ""

    constructor(
        private readonly context: SceneContext
    ) {
        this.gl2 = context.gl2
        this.canvas = context.canvas

        this.program = new Program(this.gl2, [
            new Shader(this.gl2, this.gl2.VERTEX_SHADER, MINIMAL_2D_VERTEX_SOURCE),
            new Shader(this.gl2, this.gl2.FRAGMENT_SHADER, MINIMAL_2D_FRAGMENT_SOURCE),
        ])
    }

    update(dt: number, settings: FontValues): void {
        // The render scale belongs to the runner and survives a scene swap, so
        // a scene that was left at a low resolution would blur this one. Text
        // is the entire point here, so pin it back to native.
        this.context.setRenderScale(1)

        const font = fontByName(settings.font)

        // `loaded` is part of the key because the sheets arrive asynchronously:
        // the first build runs before the fetch returns and produces nothing,
        // and this is what makes it happen again once the glyphs exist.
        const key = `${font.name}/${font.loaded}/${settings.wrap}/${settings.text}`
        if (key === this.builtKey) return

        this.rebuild(font, settings.text, settings.wrap)
        this.builtKey = key
    }

    render(): void {
        if (!this.mesh) return

        // Refit every frame so a window resize reframes the text for free.
        const { left, top, right, bottom } = this.bounds
        this.camera.fit(left, top, right, bottom, this.canvas.width, this.canvas.height)

        this.program.use()
        this.gl2.uniformMatrix3fv(
            this.program.uniform("u_Transform"),
            false,
            this.camera.matrix(this.canvas.width, this.canvas.height)
        )

        this.mesh.draw()
    }

    dispose(): void {
        this.mesh?.dispose()
        this.program.dispose()
    }

    private rebuild(font: BitmapFont, text: string, columns: number) {
        const wrapped = breakLines(text, columns)

        const out: number[] = [] // interleaved [x, y, r, g, b]
        font.appendText(out, wrapped, 0, 0, PIXEL, ...TEXT_COLOR)

        this.mesh?.dispose()

        // Nothing to draw while the sheet is still loading, or for empty text.
        if (out.length === 0) {
            this.mesh = null
            return
        }

        this.mesh = new Mesh(this.gl2, new Float32Array(out))
        this.bounds = {
            left: 0,
            top: 0,
            right: Math.max(font.measureText(wrapped, PIXEL), 1),
            // measureTextHeight counts whole cells, so descenders hang past it.
            bottom: Math.max(font.measureTextHeight(wrapped, PIXEL) + font.descent * PIXEL, 1),
        }
    }
}

const scene: DevSceneDefinition<FontValues> = {
    id: "font-test",
    name: "Font Test",
    description: "Draws text with each sheet in assets/fonts, cut into glyphs at load time. The text field redraws on every keystroke; wrap sets how many characters go on a line before it breaks.",
    settings: SETTINGS,
    create: (context: SceneContext) => new FontTest(context),
}

export default scene

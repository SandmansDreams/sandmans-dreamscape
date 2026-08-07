/* FONT FORMAT:
- Width is divisible by glyph width, height is divisible by glyph height
- All glyphs fit within assigned dimensions, should be 16 X 6
- All glyphs are left-aligned (or center aligned for monospace)
- All glyphs are vertically aligned as intended
- All glyphs composed of white or transparent pixels only
- Naming Convention: "name_type_WxH" for auto assigning (type is mono or spaced)
- Standard offsets:
    y offset:
        -1: , j
        -2: g p q y
    x width:
        -1:
        -4: 

- File formatting (seems to be standard):
      ! " # $ % & ' ( ) * + , - . /
    0 1 2 3 4 5 6 7 8 9 : ; < = > ?
    @ A B C D E F G H I J K L M N O
    P Q R S T U V W X Y Z [ \ ] ^ _
    ` a b c d e f g h i j k l m n o
    p q r s t u v w x y z { | } ~
*/

import { Vector2 } from "../../_old/physics"
import { Assert } from "../../assert"

// Reads a font image and turns it into a usable font
interface Bitmap {
    width: number,
    height: number,
    pixels: boolean[] 
}

class BitmapFont {
    //glyphMap: Map<string, Glyph>

    imageSRC: string
    glyphSize = new Vector2(5, 7)
    lineSpacing = this.glyphSize.y + 2
    letterSpacing = 1 // Kerning

    constructor(imageSRC: string, glyphSize?: Vector2) {
        this.imageSRC = imageSRC
        if (glyphSize) this.glyphSize = glyphSize
        this.lineSpacing = this.glyphSize.y + 1

        /*this.glyphMap = */this.makeGlyphMap()
    }

    async makeGlyphMap()/*: Map<string, Glyph>*/ {
        const data = await getFontData(this.imageSRC)
        const bitmap = buildBitmap(data)

        console.log(bitmap)
    }
}

export class Glyph {
    size: Vector2 // the pixel width and height
    offset: Vector2 // x and y pixel offset

    readonly pixels: boolean[]

    constructor(width: number, height: number, pixels: boolean[]) {
        this.size = new Vector2(width, height)
        this.pixels = pixels
    }

    get(x: number, y: number): boolean {
        return this.pixels[y * this.size.y + x]
    }
}

async function getFontData(imageSRC: string) {
    const image = new Image()
    image.src = imageSRC

    await image.decode()

    // Assert equal width / height? Maybe ignore
    Assert.that(image.width === image.height, `Font image was not of equal dimensions at ${imageSRC}`)

    const canvas = document.createElement("canvas")
    canvas.width = image.width
    canvas.height = image.height

    const ctx = canvas.getContext("2d")!
    ctx.drawImage(image, 0, 0)

    return ctx.getImageData(0, 0, image.width, image.height)
}

function buildBitmap(imageData: ImageData): Bitmap {
    const pixels: boolean[] = []

    for (let y = 0; y < imageData.height; y++) {
        for (let x = 0; x < imageData.width; x++) {
            const index = (y * imageData.width + x) * 4

            pixels.push(imageData.data[index + 3] > 0)
        }
    }

    return {
        width: imageData.width,
        height: imageData.height,
        pixels
    }
}

export const StandardGalacticFont = new BitmapFont("src/routes/games/space_game/assets/fonts/standard-galactic.png")
export const StandardFont = new BitmapFont("src/routes/games/space_game/assets/fonts/standard.png")
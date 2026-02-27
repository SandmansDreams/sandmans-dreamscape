import fs from "fs";
import path from "path";
import { json } from "@sveltejs/kit";

export async function GET() {
    const dir = path.resolve("static/audio/music");
    const files = fs.readdirSync(dir);

    const tracks = files
        .filter(file => file.endsWith(".mp3") || file.endsWith(".wav"))
        .map(file => ({
            name: file
                .replace(/\.[^/.]+$/, "")
                .replace(/[-_]/g, " "),
            src: `/audio/music/${file}`
        }));

    return json(tracks);
}
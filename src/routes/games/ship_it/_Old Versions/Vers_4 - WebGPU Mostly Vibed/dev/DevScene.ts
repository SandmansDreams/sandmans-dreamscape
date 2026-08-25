import type { SceneDefinition } from "../render/scene"
import type { SettingsSchema } from "../_Old Versions/Vers_4 - WebGPU Mostly Vibed/settings/settings"

/**
 * An ordinary scene that always has settings to tweak.
 *
 * Its own type so the registry below can only hold dev scenes, and so the panel can
 * rely on the schema being there. Everything else is shared with render/scene.ts.
 */
export interface DevSceneDefinition<V = any> extends SceneDefinition<V> {
    readonly settings: SettingsSchema
}

/*~~~ Every scene in ./scenes with a default export, no registration needed ~~~*/
const modules = import.meta.glob<{ default?: DevSceneDefinition }>("./scenes/*.ts", { eager: true })

export const DEV_SCENES: DevSceneDefinition[] = Object.values(modules)
    .map((module) => module.default)
    // Lets an empty placeholder file sit in the folder without breaking the list
    .filter((scene): scene is DevSceneDefinition => scene != null)
    .sort((a, b) => a.name.localeCompare(b.name))
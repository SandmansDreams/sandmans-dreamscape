import type { SettingsSchema } from "../settings/settings"
import type { SceneDefinition } from "../render/scenes"

/**
 * A dev scene is an ordinary scene that always has settings to tweak.
 *
 * Kept as its own type so the registry below can only ever hold dev scenes,
 * and so the settings panel can rely on the schema being there. Everything
 * else - the context, the instance contract, the loop - is shared with normal
 * scenes in render/scenes.ts.
 */
export interface DevSceneDefinition<V = any> extends SceneDefinition<V> {
    readonly settings: SettingsSchema
}

/*~~~ Get and import all dev scenes from the folder ~~~*/
const modules = import.meta.glob<{ default?: DevSceneDefinition }>(
    "./scenes/*.ts",
    { eager: true }
)

export const DEV_SCENES: DevSceneDefinition[] = Object.values(modules)
    .map((module) => module.default)
    .filter((scene): scene is DevSceneDefinition => scene != null)
    .sort((a, b) => a.name.localeCompare(b.name))

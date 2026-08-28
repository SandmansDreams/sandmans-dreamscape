// Every scene in ./scenes with a default export. No registration list to forget.

import type { SceneDefinition } from "../game/scene"
import type { SettingsSchema } from "../settings/settings"

/**
 * An ordinary scene that always has settings to tweak.
 *
 * Its own type so the registry below can only hold dev scenes, and so the panel
 * can rely on the schema being there rather than guarding every read.
 */
export interface DevSceneDefinition<V = any> extends SceneDefinition<V> {
    readonly settings: SettingsSchema
}

const modules = import.meta.glob<{ default?: DevSceneDefinition }>("./scenes/*.ts", { eager: true })

export const DEV_SCENES: DevSceneDefinition[] = Object.values(modules)
    .map((module) => module.default)
    // Lets a parked or half-written file sit in the folder without breaking the list
    .filter((scene): scene is DevSceneDefinition => scene != null)
    .sort((a, b) => a.name.localeCompare(b.name))

/** The scene to open with: the one last used, or the first in the list. */
export function initialScene(storedId: string | null): DevSceneDefinition | null {
    return DEV_SCENES.find((scene) => scene.id === storedId) ?? DEV_SCENES[0] ?? null
}

/** Which surface an action belongs to. */
export const INPUT_CONTEXTS = ["global", "flight", "builder", "sprite", "viewer"] as const
export type InputContext = (typeof INPUT_CONTEXTS)[number]

/** A held key that changes what another key means. */
export type Modifier = "ctrl"

export interface ActionSpec {
    /** Shown in a rebinding panel, so write it for a player and not for a log. */
    label: string
    context: InputContext
    /** Physical key codes - `event.code`, never `event.key`. */
    keys: readonly string[]
    /** Suppress the browser default while this action's context is active. */
    capture?: boolean
    /** Modifiers that must be held for this to fire. */
    mods?: readonly Modifier[]
}

export type ActionId = keyof typeof ACTIONS

/** A key code as a player would write it: "KeyR" reads "R", "ArrowUp" reads "Up". */
export function keyLabel(code: string): string {
    if (code.startsWith("Key")) return code.slice(3)
    if (code.startsWith("Digit")) return code.slice(5)
    if (code.startsWith("Arrow")) return code.slice(5)

    const named: Record<string, string> = {
        Backquote: "`",
        ControlLeft: "Ctrl",
        ControlRight: "Ctrl",
        MetaLeft: "Cmd",
        MetaRight: "Cmd",
        Space: "Space",
    }

    return named[code] ?? code
}

/** What to press for an action, modifiers included: "Ctrl+Z", "Left / Right". */
export function keysFor(action: ActionId, codes: readonly string[]): string {
    const prefix = specOf(action).mods?.includes("ctrl") ? "Ctrl+" : ""
    return codes.map((code) => prefix + keyLabel(code)).join(" / ")
}

export function specOf(action: ActionId): ActionSpec {
    return ACTIONS[action]
}

/** True when this id names a real action. The guard a stored binding needs. */
export function isActionId(value: unknown): value is ActionId {
    return typeof value === "string" && value in ACTIONS
}

/** The actions of one context, for a rebinding panel and for conflict checks. */
export function actionsIn(context: InputContext): ActionId[] {
    return ACTION_IDS.filter((id) => ACTIONS[id].context === context)
}

/** The catalogue. One entry per thing a player can ask for. */
export const ACTIONS = {
    /*~~~ Always live ~~~*/
    "global.devPanel": {
        label: "Toggle dev panel",
        context: "global",
        keys: ["Backquote"],
    },

    /*~~~ Flying ~~~*/
    "flight.thrustForward": { label: "Thrust forward", context: "flight", keys: ["KeyW"] },
    "flight.thrustBack":    { label: "Thrust back", context: "flight", keys: ["KeyS"] },
    "flight.strafeLeft":    { label: "Thrust left", context: "flight", keys: ["KeyA"] },
    "flight.strafeRight":   { label: "Thrust right", context: "flight", keys: ["KeyD"] },
    "flight.turnLeft":      { label: "Turn left", context: "flight", keys: ["KeyQ"] },
    "flight.turnRight":     { label: "Turn right", context: "flight", keys: ["KeyE"] },
    "flight.toggleAssist":  { label: "Toggle flight assist", context: "flight", keys: ["KeyZ"], capture: true },

    /*~~~ Building a ship ~~~*/
    // Declaration order is what the builder's key guide lists, so the ones someone
    // reaches for first are declared first: pick a tool, pick a part, then the
    // adjustments, then undo
    "builder.toolBuild":   { label: "Build tool", context: "builder", keys: ["KeyB"] },
    "builder.toolDestroy": { label: "Destroy tool", context: "builder", keys: ["KeyD"] },
    "builder.toolSelect":  { label: "Select tool", context: "builder", keys: ["KeyS"] },

    // One per category, on its own first letter. They happen not to collide -
    // hull, thruster, cargo, generator, projector, weapon - which is luck worth
    // spending rather than inventing a scheme nobody would remember
    "builder.pickHull":      { label: "Pick hull", context: "builder", keys: ["KeyH"] },
    "builder.pickThruster":  { label: "Pick thruster", context: "builder", keys: ["KeyT"] },
    "builder.pickCargo":     { label: "Pick cargo", context: "builder", keys: ["KeyC"] },
    "builder.pickGenerator": { label: "Pick generator", context: "builder", keys: ["KeyG"] },
    "builder.pickProjector": { label: "Pick projector", context: "builder", keys: ["KeyP"] },
    "builder.pickWeapon":    { label: "Pick weapon", context: "builder", keys: ["KeyW"] },
    // Rotate is one action even though it means two things: a component turns its
    // facing and structure turns its art, and which one is a property of the brush
    // rather than of the key
    "builder.rotate":     { label: "Rotate block", context: "builder", keys: ["KeyR"] },
    "builder.mirror":     { label: "Mirror block", context: "builder", keys: ["KeyM"] },
    "builder.cycleLevel": { label: "Next level", context: "builder", keys: ["KeyL"] },
    "builder.prevShape":  { label: "Previous shape", context: "builder", keys: ["ArrowLeft"], capture: true },
    "builder.nextShape":  { label: "Next shape", context: "builder", keys: ["ArrowRight"], capture: true },
    "builder.layerUp":    { label: "Layer up", context: "builder", keys: ["ArrowUp"], capture: true },
    "builder.layerDown":  { label: "Layer down", context: "builder", keys: ["ArrowDown"], capture: true },

    "builder.undo": {
        label: "Undo", context: "builder", keys: ["KeyZ"], mods: ["ctrl"], capture: true,
    },
    "builder.redo": {
        label: "Redo", context: "builder", keys: ["KeyY"], mods: ["ctrl"], capture: true,
    },

    /*~~~ Drawing component art ~~~*/
    "sprite.toolBuild":   { label: "Build tool", context: "sprite", keys: ["KeyB"] },
    "sprite.toolDestroy": { label: "Destroy tool", context: "sprite", keys: ["KeyD"] },

    "sprite.rotate":     { label: "Rotate shape", context: "sprite", keys: ["KeyR"] },
    "sprite.mirror":     { label: "Mirror shape", context: "sprite", keys: ["KeyM"] },
    "sprite.cycleLayer": { label: "Next art layer", context: "sprite", keys: ["KeyL"] },
    "sprite.prevShape":  { label: "Previous shape", context: "sprite", keys: ["ArrowLeft"], capture: true },
    "sprite.nextShape":  { label: "Next shape", context: "sprite", keys: ["ArrowRight"], capture: true },
    "sprite.prevRole":   { label: "Previous role", context: "sprite", keys: ["ArrowUp"], capture: true },
    "sprite.nextRole":   { label: "Next role", context: "sprite", keys: ["ArrowDown"], capture: true },

    "sprite.undo": {
        label: "Undo", context: "sprite", keys: ["KeyZ"], mods: ["ctrl"], capture: true,
    },
    "sprite.redo": {
        label: "Redo", context: "sprite", keys: ["KeyY"], mods: ["ctrl"], capture: true,
    },
} as const satisfies Record<string, ActionSpec>

/** Every id in the catalogue. Declaration order, which is the order a panel lists. */
export const ACTION_IDS = Object.keys(ACTIONS) as ActionId[]
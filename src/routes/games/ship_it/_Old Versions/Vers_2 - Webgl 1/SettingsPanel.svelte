<script lang="ts">
    import {
        DEFAULTS, SETTINGS_SCHEMA, SETTING_KEYS,
        isModified, settingGroup, type Settings
    } from "./settings"

    /**
     * Settings, built from the schema rather than written out by hand.
     *
     * Adding a setting is one line in defaults.json and one in SETTINGS_SCHEMA;
     * the control appears here on its own, the same way a JSON file dropped in
     * engine/hulls shows up in the ship picker.
     *
     * `values` is the page's `$state` object, passed by reference. Svelte 5
     * deep-proxies plain objects, so assigning into it here is seen by the page
     * and by the renderer without any events or mirroring.
     */

    interface Props {
        settings: Settings
        onreset: () => void
    }

    let { settings: values, onreset }: Props = $props()

    let open = $state(false)

    /** Keys in file order, split into their dotted-prefix groups. */
    const groups = SETTING_KEYS.reduce((acc, key) => {
        const group = settingGroup(key)
        const existing = acc.find(entry => entry.name === group)

        if (existing) existing.keys.push(key)
        else acc.push({ name: group, keys: [key] })

        return acc
    }, [] as { name: string, keys: string[] }[])

    const changed = $derived(SETTING_KEYS.filter(key => isModified(values, key)).length)

    function format(value: unknown): string {
        return typeof value === "number"
            ? String(Math.round(value * 1000) / 1000)
            : String(value)
    }
</script>

<div id="settings" class:open>
    {#if open}
        <div class="body">
            {#each groups as group}
                <h3>{group.name}</h3>

                {#each group.keys as key}
                    {@const spec = SETTINGS_SCHEMA[key]}

                    <label class:modified={isModified(values, key)}>
                        <span class="name" title={key}>{spec.label}</span>

                        {#if spec.kind === "number"}
                            <input
                                type="range"
                                min={spec.min}
                                max={spec.max}
                                step={spec.step}
                                value={values[key] as number}
                                oninput={(e) => values[key] = e.currentTarget.valueAsNumber}
                            />
                            <span class="value">{format(values[key])}</span>

                        {:else if spec.kind === "color"}
                            <input
                                type="color"
                                value={values[key] as string}
                                oninput={(e) => values[key] = e.currentTarget.value}
                            />
                            <span class="value">{values[key]}</span>

                        {:else if spec.kind === "enum"}
                            <select
                                value={values[key] as string}
                                onchange={(e) => values[key] = e.currentTarget.value}
                            >
                                {#each spec.options as option}
                                    <option value={option}>{option}</option>
                                {/each}
                            </select>
                            <span class="value"></span>

                        {:else if spec.kind === "toggle"}
                            <input
                                type="checkbox"
                                checked={values[key] as boolean}
                                onchange={(e) => values[key] = e.currentTarget.checked}
                            />
                            <span class="value"></span>
                        {/if}
                    </label>
                {/each}
            {/each}

            <button class="reset" onclick={onreset} disabled={changed === 0}>
                reset {changed > 0 ? `(${changed} changed)` : ""}
            </button>

            <p class="note">
                stored locally · only what differs from defaults.json is saved
            </p>
        </div>
    {/if}

    <button class="toggle" onclick={() => open = !open}>
        settings{changed > 0 ? ` · ${changed}` : ""} {open ? "▾" : "▴"}
    </button>
</div>

<style>
    #settings {
        position: absolute;
        right: 12px;
        bottom: 12px;
        z-index: 2;
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 6px;
        font: 12px/1.4 monospace;
        color: #0df;
        pointer-events: auto;
    }

    .body {
        width: min(330px, calc(100vw - 24px));
        max-height: min(70vh, 640px);
        overflow-y: auto;
        padding: 10px 12px;
        background: rgba(0, 0, 0, 0.82);
        border: 1px solid #0df6;
        border-radius: 4px;
    }

    h3 {
        margin: 10px 0 4px;
        font: inherit;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        opacity: 0.55;
    }

    h3:first-child {
        margin-top: 0;
    }

    label {
        display: grid;
        grid-template-columns: 8.5em 1fr 4.2em;
        align-items: center;
        gap: 6px;
        padding: 2px 0;
    }

    .name {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        opacity: 0.8;
    }

    /* Otherwise "what have I actually changed?" is unanswerable. */
    label.modified .name {
        opacity: 1;
        font-weight: 700;
    }

    label.modified .name::before {
        content: "• ";
        margin-left: -0.7em;
    }

    .value {
        text-align: right;
        opacity: 0.7;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    input[type="range"] {
        width: 100%;
        accent-color: #0df;
    }

    input[type="color"] {
        width: 100%;
        height: 20px;
        padding: 0;
        background: none;
        border: 1px solid #0df6;
        border-radius: 3px;
        cursor: pointer;
    }

    select {
        width: 100%;
        font: inherit;
        color: #0df;
        background: rgba(0, 0, 0, 0.6);
        border: 1px solid #0df6;
        border-radius: 3px;
        padding: 2px 4px;
    }

    button {
        font: inherit;
        color: #0df;
        background: rgba(0, 0, 0, 0.6);
        border: 1px solid #0df6;
        border-radius: 3px;
        padding: 6px 10px;
        cursor: pointer;
    }

    button:hover:not(:disabled) {
        border-color: #0df;
    }

    .reset {
        width: 100%;
        margin-top: 12px;
    }

    .reset:disabled {
        opacity: 0.4;
        cursor: default;
    }

    .note {
        margin: 8px 0 0;
        opacity: 0.45;
    }
</style>

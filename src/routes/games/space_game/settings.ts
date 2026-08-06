import { Assert } from "./assert";

// All possible types a setting could be
export type SettingSchema =
    | { type: "range";     key: string; label: string; default: number;  min: number; max: number; step?: number }
    | { type: "checkbox";  key: string; label: string; default: boolean }
    | { type: "selection"; key: string; label: string; default: string;  options: readonly string[] }

export type SettingValue = number | boolean | string
export type SettingValues = Record<string, SettingValue>

// Default values for a given setting schema
export function defaultValues(schema: readonly SettingSchema[]): SettingValues {
    const values: SettingValues = {}
    for (const setting of schema) values[setting.key] = setting.default
    return values
}

export class Settings {
    constructor(private readonly values: SettingValues) {}

    number(key: string): number {
        const value = this.values[key]
        Assert.that(typeof value === "number", `Setting '${key}' is not a number`)
        return value
    }

    boolean(key: string): boolean {
        const value = this.values[key]
        Assert.that(typeof value === "boolean", `Setting '${key}' is not a boolean`)
        return value
    }

    string(key: string): string {
        const value = this.values[key]
        Assert.that(typeof value === "string", `Setting '${key}' is not a string`)
        return value
    }
}
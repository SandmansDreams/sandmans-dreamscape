import { browser } from "$app/environment"

export function loadStore(storageKey: string): any  { // Load a given store from the local storage
    if (!browser) return null

    try {
        const rawData = localStorage.getItem(storageKey) // Get data from browser's local storage
        return rawData ? JSON.parse(rawData) : null // Return the parsed form of that data
    } catch (error) {
        console.warn("Local store could not be read", error)
    }
}

export function clearStore(storageKey: string): boolean { // Clear a store completely
    if (!browser) return false

    try {
        localStorage.removeItem(storageKey)
        return true
    } catch (error) {
        console.warn("settings: could not be cleared", error)
        return false
    }
}

export function saveStore(storageKey: string, data: any): boolean {
    if (!browser) return false

    try {
        localStorage.setItem(storageKey, JSON.stringify(data))
        return true
    } catch (error) {
        console.warn("settings: could not be saved", error)
        return false
    }
}

export function clearAllStores(): boolean {
    if (!browser) return false
    localStorage.clear()
    return true
}
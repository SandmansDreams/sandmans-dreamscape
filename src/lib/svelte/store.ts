import { writable } from "svelte/store";
import { browser } from "$app/environment";

export function persisted(key: string, initial: any) {
    if (!browser) return
    const stored = localStorage.getItem(key);
    const store = writable(stored ? JSON.parse(stored) : initial);

    store.subscribe(value => {
        localStorage.setItem(key, JSON.stringify(value));
    });

    return store;
}
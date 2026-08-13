// Browser-only file transfer, kept out of shipJson.ts so serialization stays testable

/**
 * Offers `text` to the user as a file download.
 *
 * Only ever called from a click handler, so there is no SSR path to guard - but
 * the object URL must be revoked or the blob is held for the life of the page.
 */
export function downloadText(filename: string, text: string, type = "application/json"): void {
    const url = URL.createObjectURL(new Blob([text], { type }))

    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = filename
    anchor.click()

    URL.revokeObjectURL(url)
}

/**
 * Asks the user for a file and hands back its text.
 *
 * The mirror of downloadText, and here for the same reason: a scene owns the
 * action, and routing a file picker through the settings schema would put a
 * whole ship's JSON in the values bag that gets written to localStorage.
 *
 * `onText` is not called when the dialog is dismissed - there is no cancel event
 * to listen for, so a caller that needs to know cannot learn it this way.
 */
export function uploadText(onText: (text: string) => void, accept = ".json,application/json"): void {
    const input = document.createElement("input")
    input.type = "file"
    input.accept = accept

    input.onchange = () => {
        const file = input.files?.[0]
        if (!file) return

        void file.text().then(onText)
    }

    input.click()
}
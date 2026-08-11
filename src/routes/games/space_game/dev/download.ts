// Browser-only file saving, kept out of shipJson.ts so serialization stays testable

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
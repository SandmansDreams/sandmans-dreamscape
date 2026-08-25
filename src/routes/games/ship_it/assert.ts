import { notifications } from "./notifications.svelte";

export class Assert {
    private static fail(reason: string, stack: string | undefined): never { // Creates log and stops anything after from running
        notifications.error(`Assertion Failed: ${reason}`)
        throw new Error(
            [
                "Assertion Failed",
                reason,
                this.location(stack),
            ].join("\n")
        )
    }

    private static location(stack: string | undefined): string { // Gets the call stack for the error
        return stack?.split("\n")[3].trim() ?? "Unknown location";
    }

    static exists<T>( // Checks that a variable is non-null
        variable: T,
        name: string
    ): asserts variable is NonNullable<T> {
        if (variable == null) {
            this.fail(`'${name}' was null or undefined `, new Error().stack)
        }
    }

    static that(condition: boolean, reason: string): asserts condition { // Checks that a condition is true
        if (!condition) this.fail(reason, new Error().stack)
    }
}
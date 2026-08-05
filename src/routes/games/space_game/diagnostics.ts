export class Assert {
    private static fail(reason: string, stack: string | undefined): never { // Creates log and stops anything after from running
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

    private static unpack<T>(
        variable: T
    ): [string, T] {
        const name = Object.keys({variable})[0]
        return [name, variable]
    }

    static exists<T>( // Checks that a variable is non-null
        variable: T,
        name: string
    ): asserts variable is NonNullable<T> {
        if (variable == null) {
            this.fail(`'${name}' was null or undefined `, new Error().stack)
        }
    }
}
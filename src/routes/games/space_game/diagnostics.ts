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
        variables: Record<string, T>
    ): [string, T] {
        return Object.entries(variables)[0] as [string, T]
    }

    static exists<T>( // Checks that a variable works and is non-null
        variables: Record<string, T>
    ): asserts variables is Record<string, NonNullable<T>> {
        const [name, value] = this.unpack(variables)

        if (value == null) {
            this.fail(`'${name}' was null or undefined at:`, new Error().stack)
        }
    }
}
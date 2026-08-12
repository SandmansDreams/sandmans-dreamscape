## Code style
- Small functions with one goal and a name that says what they return.
- Prefer returning values over mutating fields; if a function must mutate
  state, say so in the name.
- No side effects a caller can't predict from the signature.
- If an expression appears twice, extract and name it.
- Comments explain *why* and what.
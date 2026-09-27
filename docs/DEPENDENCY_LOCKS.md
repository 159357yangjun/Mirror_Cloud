# Dependency lock policy

The repository commits the exact dependency graphs used by CI and release builds:

- `Cargo.lock`
- `apps/desktop/package-lock.json`
- `website/package-lock.json`

Normal CI and release jobs **must not regenerate these files**. They consume them directly with:

```text
cargo check --workspace --locked
cargo test --workspace --locked
npm ci
```

This makes a given source revision resolve to the same dependency graph across developer machines, CI and release builds.

When dependencies intentionally change, update the relevant manifest and lockfile together in the same reviewed commit. A missing or stale Cargo lock causes `--locked` to fail; a stale npm lock causes `npm ci` to fail.

The one-time workflows used to bootstrap these lockfiles are removed after this transition.

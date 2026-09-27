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

This makes a given source revision resolve to the same dependency graph across developer machines, CI and release builds. Release bundling also checks that the committed lockfiles are unchanged after `tauri build`; a build is rejected if dependency resolution mutates them.

## Compiler toolchain

`rust-toolchain.toml` pins the Rust compiler used for development, CI and release builds. The current release line is pinned to Rust `1.98.1`, the compiler used by the verified Windows v1.4.0 Preview bundle. CI and Release explicitly install the same toolchain instead of following the moving `stable` channel.

Compiler upgrades are intentional dependency changes: update `rust-toolchain.toml` and CI/Release toolchain inputs together, then rerun the complete validation and a real Windows bundle before accepting the new compiler.

## Tauri cross-language compatibility

Tauri is a cross-language dependency family: the Rust crates in `apps/desktop/src-tauri/Cargo.toml` and the `@tauri-apps/*` JavaScript packages in `apps/desktop/package.json` must stay on compatible release lines.

Direct Rust Tauri dependencies use exact `=x.y.z` constraints instead of broad caret ranges. This prevents a later lock refresh from silently mixing, for example, a Tauri 2.11 JavaScript API with Tauri 2.12 Rust runtime crates.

`scripts/check_tauri_dependency_family.py` is run by CI, the release workflow and the local release script. It verifies:

- direct Rust Tauri dependencies are exact and match `Cargo.lock`;
- the tested Rust core/runtime/plugin family remains on its compatible minor lines;
- `@tauri-apps/api` and `@tauri-apps/cli` share the Rust Tauri major/minor line;
- JS plugin packages match their Rust plugin crate versions exactly.

When intentionally upgrading Tauri, update the Rust manifest, JavaScript manifest and both relevant lockfiles together. Then run the normal CI checks **and a real Windows `tauri build`** before treating the new dependency family as release-ready. If the tested minor lines change, update the compatibility guard in the same reviewed change.

## Intentional dependency updates

When any dependency intentionally changes, update the relevant manifest and lockfile together in the same reviewed commit. A missing or stale Cargo lock causes `--locked` to fail; a stale npm lock causes `npm ci` to fail.

The one-time workflows used to bootstrap or repair lockfiles are removed after use; normal CI and release workflows only consume committed locks.

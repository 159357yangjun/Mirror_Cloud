# v1.2.4 Actual Validation — 2026-09-23

This report records checks actually executed in the packaging environment.

## Passed

- ZIP source tree JSON/TOML parse: passed.
- SQLite migrations: `0001` through `0010` executed successfully in SQLite; 11 business tables remain valid.
- Cargo workspace member path validation: passed.
- Tauri command contract: frontend invoke 45 / Rust command 45 / generate_handler registration 45.
- Base user-flow contract: 22/22.
- Reliability + explicit permission-gate contract: 18/18; total 40 checks.
- Python validation/check scripts compile successfully.
- TypeScript/TSX syntax is checked separately with the locally available TypeScript compiler API.

## Reliability and permission changes verified statically

- `primary_with_backups`: Mirror always publishes; Backup is failover-only.
- GitHub connection test checks effective repository write access.
- AI Caption payload contains real OpenAI-compatible multimodal `image_url` input.
- Plugin Runtime requires both Manifest declaration and a persisted user grant.
- SQLite stores grants separately from Manifest declarations.
- Existing sensitive plugins are disabled by migration until re-authorized.
- Desktop upload, direct plugin execution and Typora CLI pass the persisted grant list into Runtime.
- Plugin UI requests approval before enabling missing permissions and can revoke sensitive grants.
- CI/release resolves dependency locks before `cargo --locked` / `npm ci`.

## Not executable in this environment

The packaging container does not include Rust/Cargo and DNS cannot resolve npm/crates registries. Therefore this report does **not** claim the following as passed:

- `cargo fmt --all -- --check`
- `cargo check --workspace --locked`
- `cargo test --workspace --locked`
- successful `npm ci` / production Vite build
- `npm run tauri build`
- Windows installer launch
- real Typora → Publisher → GitHub/R2/Gitee end-to-end network upload
- committed final `Cargo.lock` / `package-lock.json` generated from registries

GitHub Actions remains responsible for the network/toolchain-dependent build and for publishing the resolved lock files used by that build.

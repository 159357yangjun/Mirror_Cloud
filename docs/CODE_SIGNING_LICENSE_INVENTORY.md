# Code-signing eligibility: license inventory (preliminary)

Date checked: 2026-11-13
Latest dependency-bearing revision revalidated: `eabeb32cfb3bad3a7714e7901f4d2dec1e4d368a` (the Cargo/npm manifests and lockfiles are unchanged since inventory source `f2f84bc8011c72f5065be669b3ef90ae1c6b3e22`)

## Declared project license

The repository declares MIT for the Rust workspace. This is a manifest-level check; it does not establish that every shipped or bundled file is covered by that license.

## npm lockfile declarations

The committed npm lockfiles contain a `license` value for every package entry inspected:

| Lockfile | Package entries | Missing license metadata |
| --- | ---: | ---: |
| `apps/desktop/package-lock.json` | 112 | 0 |
| `website/package-lock.json` | 376 | 0 |

Desktop dependency declarations:

| Declared SPDX identifier/expression | Entries |
| --- | ---: |
| MIT | 65 |
| MPL-2.0 | 24 |
| Apache-2.0 OR MIT | 13 |
| MIT OR Apache-2.0 | 3 |
| ISC | 3 |
| Apache-2.0 | 2 |
| 0BSD | 1 |
| BSD-3-Clause | 1 |

Website dependency declarations:

| Declared SPDX identifier/expression | Entries |
| --- | ---: |
| MIT | 308 |
| Apache-2.0 | 16 |
| MPL-2.0 | 12 |
| LGPL-3.0-or-later | 10 |
| ISC | 8 |
| BSD-2-Clause | 8 |
| Apache-2.0 AND LGPL-3.0-or-later | 3 |
| BlueOak-1.0.0 | 3 |
| BSD-3-Clause | 3 |
| CC0-1.0 | 2 |
| Apache-2.0 AND LGPL-3.0-or-later AND MIT | 1 |
| Python-2.0 | 1 |
| 0BSD | 1 |

The observed identifiers were compared with the [OSI approved-license list](https://opensource.org/licenses). OSI lists the relevant base licenses including MIT, Apache-2.0, MPL-2.0, LGPL-3.0, BSD-2-Clause, BSD-3-Clause, BlueOak-1.0.0, 0BSD, ISC, and Python-2.0. Compound expressions still require their normal SPDX interpretation; a declaration is not a legal compatibility opinion.

**Website dependency concern:** `CC0-1.0` appears on two `mdn-data` entries in the website lockfile. The lockfile reverse-dependency paths are `astro -> svgo -> css-tree -> mdn-data@2.27.1` and `astro -> svgo -> csso -> css-tree -> mdn-data@2.0.28`. These are website build-tool dependencies, not declared desktop runtime dependencies. The Rust lockfile below reveals an additional CC0 declaration reachable from the desktop dependency graph, so the website entries are not the only licensing question. CC0 does not appear in OSI's approved-license list, and [OSI's FAQ](https://opensource.org/faq) says its review application was withdrawn without approval and does not recommend releasing software under CC0. Because [SignPath's terms](https://signpath.org/terms.html) require an OSI-approved license for all components, confirm scope with SignPath or remediate before claiming the project fully meets that condition.

## Revalidation against current main

On 2026-11-13, `git diff --name-only f2f84bc8011c72f5065be669b3ef90ae1c6b3e22..eabeb32cfb3bad3a7714e7901f4d2dec1e4d368a` was checked for Cargo/npm manifests and lockfiles; none changed. The inventory inputs were revalidated through `main` at `eabeb32cfb3bad3a7714e7901f4d2dec1e4d368a`. The preceding dependency-identical commit `b7347f52be163cfd8a8ac6cc39c57f9545cf2dbe` passed GitHub CI run `43411563344`, including Rust check/tests and desktop/docs builds; `eabeb32` also passed docs-only CI run `43412928678`. This does not establish SignPath eligibility or replace an exact candidate SBOM/package-content review.

## Remaining review required

- `Cargo.lock` license metadata was inventoried against the crates.io API for the exact versions in the lockfile (582 unique crate names, 650 locked registry package entries; 0 missing version records and 0 missing license declarations). The 13 workspace crates inherit the repository's MIT declaration. This checks published metadata only; it does not inspect source license files or establish which optional/target-specific dependencies are compiled into a specific release.
- The public v1.4.16 Windows x64 MSI was downloaded and inspected read-only through the Windows Installer database API. Its `File` table contains one installed file, `image-hosting-platform-desktop.exe` (file version `1.4.16.0`, 43,947,008 bytes); the package properties identify `Mirror Cloud` version `1.4.16`. The downloaded MSI is 21,057,536 bytes with SHA256 `be757d7cfdd6a08220b4a618ee53f0ca73365c2c94df85d9e6de7ee986305dbc`. This is a concrete inventory of that release MSI only; it does not inventory the NSIS installer, Windows prerequisites, source archive, or a future build.
- The installed executable at `D:\Mirror Cloud\image-hosting-platform-desktop.exe` was reported `NotSigned` by Windows Authenticode inspection at the time of this review. This confirms that the v1.4.16 installation currently inspected is not Authenticode-signed; it does not characterize other releases or a future candidate.
- The MSI is not yet configured in SignPath. A sample deep-signing configuration based on the inspected MSI file table is in `docs/SIGNPATH_MSI_ARTIFACT_CONFIGURATION.xml`; it must be uploaded to the SignPath project and reviewed against SignPath's generated visualization before assigning its slug to GitHub Actions. It verifies the already-signed app EXE embedded in the MSI before signing the outer MSI. The current release workflow signs the app EXE before building the installers, so the signing order is consistent with this configuration.
- npm lockfile license fields are package metadata, not a review of the license text, attribution obligations, distribution mode, or whether a package is actually included in the desktop binary.
- Rust lockfile license declarations are summarized below. Counts are locked package entries, so multiple versions of the same crate count separately. Expressions are reproduced from crates.io metadata and have not been normalized or legally reviewed.

| Locked registry entries | Published license expression |
| ---: | --- |
| 298 | `MIT OR Apache-2.0` |
| 142 | `MIT` |
| 61 | `Apache-2.0 OR MIT` |
| 25 | `MIT/Apache-2.0` |
| 18 | `Apache-2.0` |
| 18 | `Unicode-3.0` |
| 17 | `Zlib OR Apache-2.0 OR MIT` |
| 10 | `Unlicense OR MIT` |
| 5 | `Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT` |
| 5 | `MIT OR Apache-2.0 OR Zlib` |
| 5 | `MPL-2.0` |
| 4 | `Apache-2.0/MIT` |
| 3 | `Apache-2.0 OR ISC OR MIT` |
| 3 | `BSD-3-Clause` |
| 3 | `ISC` |
| 3 | `Zlib` |
| 2 | `BSD-2-Clause OR Apache-2.0 OR MIT` |
| 2 | `BSD-3-Clause OR Apache-2.0` |
| 2 | `BSD-3-Clause OR MIT OR Apache-2.0` |
| 2 | `BSL-1.0` |
| 2 | `MIT OR Apache-2.0 OR LGPL-2.1-or-later` |
| 2 | `MIT OR Zlib OR Apache-2.0` |
| 2 | `Unlicense/MIT` |
| 1 each | `(Apache-2.0 OR MIT) AND BSD-3-Clause`; `(MIT OR Apache-2.0) AND Unicode-3.0`; `0BSD OR MIT OR Apache-2.0`; `Apache-2.0 / MIT`; `Apache-2.0 AND ISC`; `Apache-2.0 AND MIT`; `Apache-2.0 OR BSL-1.0`; `Apache-2.0 OR BSL-1.0 OR MIT`; `Apache-2.0 WITH LLVM-exception`; `BSD-3-Clause AND MIT`; `BSD-3-Clause/MIT`; `CC0-1.0`; `CC0-1.0 OR MIT-0 OR Apache-2.0`; `CDLA-Permissive-2.0`; `ISC AND (Apache-2.0 OR ISC)`; `ISC AND (Apache-2.0 OR ISC) AND Apache-2.0 AND MIT AND BSD-3-Clause AND (Apache-2.0 OR ISC OR MIT) AND (Apache-2.0 OR ISC OR MIT-0)` |

**Potential eligibility blockers requiring a written SignPath determination or remediation:**

- `tiny-keccak 2.0.2` declares `CC0-1.0` with no alternate license in crates.io metadata. The lockfile dependency path is `storage-opendal -> opendal (services-oss) -> opendal-service-oss -> reqsign-aliyun-oss -> rust-ini -> ordered-multimap -> dlv-list -> const-random -> const-random-macro -> tiny-keccak`; `crates/storage-opendal/Cargo.toml` explicitly enables OpenDAL's `services-oss` feature. Exact published Cargo manifests were inspected: `reqsign-aliyun-oss 3.2.0` and `reqsign-aws-core 3.2.0` depend on `rust-ini 0.21`; `rust-ini 0.21.3` depends on `ordered-multimap 0.7`; `ordered-multimap 0.7.3` depends on `dlv-list 0.5`; and `dlv-list 0.5.2` declares `const-random 0.1.15` as a non-optional dependency. That crate in turn depends on `const-random-macro 0.1.16`, which declares `tiny-keccak 2.0.2`. This is not merely a package appearing in Cargo.lock because of an optional feature. The `tiny-keccak` edge is in a compile-time proc-macro chain; this confirms source/build dependency reachability, not that its code is linked into the final executable. Ask SignPath whether build-time source dependencies are in scope, or replace the dependency chain if they require every build component to use an OSI-approved license.
- `mdn-data` appears twice with `CC0-1.0` in the website lockfile, through the `css-tree` website build chain.

**Target and license-expression notes:**

- `webpki-root-certs 1.0.9` declares `CDLA-Permissive-2.0`, but [`rustls-platform-verifier 0.7.1`](https://docs.rs/crate/rustls-platform-verifier/0.7.1) declares it only for `wasm32` plus as a dev-dependency. Its documented Windows implementation uses the Windows platform certificate store/API. It appears in the shared lockfile, but current evidence does not put it in the Windows x64 runtime dependency graph. Verify the actual Windows build graph/artifact before treating it as a shipped component; ask SignPath whether repository-wide target-only/dev dependencies count under its policy.
- `dunce 1.0.5` declares `CC0-1.0 OR MIT-0 OR Apache-2.0`, which offers MIT-0 and Apache-2.0 alternatives. It is not an unequivocal CC0-only dependency, but the selected license and distributed source notices still need review.

OSI's current approved-license list includes `MIT-0`, `Unicode-3.0`, and `Zlib`, but not `CC0-1.0`; CC0 was not approved through OSI's license review. `CDLA-Permissive-2.0` is also absent from OSI's current list. Check every license expression and selected alternative against the current official list before making an eligibility claim. See the [OSI approved-license list](https://opensource.org/licenses), [OSI FAQ](https://opensource.org/faq), and [SignPath Foundation terms](https://signpath.org/terms.html).

### Primary metadata/source references

- [tiny-keccak 2.0.2 manifest on docs.rs](https://docs.rs/crate/tiny-keccak/2.0.2/source/Cargo.toml) declares CC0-1.0.
- [OpenDAL OSS service 0.58.2](https://docs.rs/crate/opendal-service-oss/0.58.2) is the selected `services-oss` implementation.
- [rustls-platform-verifier 0.7.1](https://docs.rs/crate/rustls-platform-verifier/0.7.1) documents platform behavior; its source manifest specifies the target-specific root-certificate dependency.
- [webpki-root-certs 1.0.9 manifest on docs.rs](https://docs.rs/crate/webpki-root-certs/1.0.9/source/Cargo.toml) declares CDLA-Permissive-2.0.

- No complete SBOM/license report is attached to the published v1.4.16 artifacts.

This evidence supports continuing the SignPath application preparation, but it is not sufficient to claim that the entire release is confirmed eligible. Re-run the inventory for the exact candidate source and installer before applying or enabling signing.

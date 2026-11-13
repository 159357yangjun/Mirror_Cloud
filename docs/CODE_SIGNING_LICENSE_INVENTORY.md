# Code-signing eligibility: license inventory (preliminary)

Date checked: 2026-11-13

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

**Potential eligibility issue:** `CC0-1.0` appears on two `mdn-data` entries in the website lockfile. Those entries are transitive build-time metadata reached through `css-tree` (the `csso`/`svgo` toolchain); they are not declared as desktop runtime dependencies. CC0 does not appear in OSI's approved-license list, and [OSI's FAQ](https://opensource.org/faq) says its review application was withdrawn without approval and does not recommend releasing software under CC0. Because [SignPath's terms](https://signpath.org/terms.html) require an OSI-approved license for all components, confirm with SignPath whether these website-only build-tool data packages are in scope. Do not describe the entire lockfile inventory as fully OSI-approved until this is resolved.

## Remaining review required

- `Cargo.lock` has not yet been scanned against package license metadata. The current workstation does not provide Cargo, and no equivalent Rust license report has been produced.
- The built installer contents, Windows system/runtime components, and packaged binaries have not been inventoried. Lockfile entries alone cannot prove the installer contains only the declared dependencies.
- npm lockfile license fields are package metadata, not a review of the license text, attribution obligations, distribution mode, or whether a package is actually included in the desktop binary.
- The CC0-1.0 `mdn-data` entries need a written scope determination from SignPath, or removal/replacement of the dependency before claiming every repository component meets its OSI-license rule.
- No complete SBOM/license report is attached to the published v1.4.16 artifacts.

This evidence supports continuing the SignPath application preparation, but it is not sufficient to claim that the entire release is confirmed eligible. Re-run the inventory for the exact candidate source and installer before applying or enabling signing.

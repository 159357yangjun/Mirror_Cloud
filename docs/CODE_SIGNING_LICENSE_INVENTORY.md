# Code-signing eligibility: license inventory (preliminary)

Date checked: 2026-11-13
Source revision: `f2f84bc8011c72f5065be669b3ef90ae1c6b3e22`

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

**Website dependency concern:** `CC0-1.0` appears on two `mdn-data` entries in the website lockfile. Those entries are transitive build-time metadata reached through `css-tree` (the `csso`/`svgo` toolchain); they are not declared as desktop runtime dependencies. The Rust lockfile below reveals an additional CC0 declaration reachable from the desktop dependency graph, so the website entries are not the only licensing question. CC0 does not appear in OSI's approved-license list, and [OSI's FAQ](https://opensource.org/faq) says its review application was withdrawn without approval and does not recommend releasing software under CC0. Because [SignPath's terms](https://signpath.org/terms.html) require an OSI-approved license for all components, confirm scope with SignPath or remediate before claiming the project fully meets that condition.

## Remaining review required

- `Cargo.lock` license metadata was inventoried against the crates.io API for the exact versions in the lockfile (582 unique crate names, 650 locked registry package entries; 0 missing version records and 0 missing license declarations). The 13 workspace crates inherit the repository's MIT declaration. This checks published metadata only; it does not inspect source license files or establish which optional/target-specific dependencies are compiled into a specific release.
- The built installer contents, Windows system/runtime components, and packaged binaries have not been inventoried. Lockfile entries alone cannot prove the installer contains only the declared dependencies.
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

- `tiny-keccak 2.0.2` declares `CC0-1.0` with no alternate license in crates.io metadata. The lockfile dependency path is `storage-opendal -> opendal (services-oss) -> opendal-service-oss -> reqsign-aliyun-oss -> rust-ini -> ordered-multimap -> dlv-list -> const-random -> const-random-macro -> tiny-keccak`; `crates/storage-opendal/Cargo.toml` explicitly enables OpenDAL's `services-oss` feature. This is part of the desktop dependency graph, not just the website toolchain.
- `mdn-data` appears twice with `CC0-1.0` in the website lockfile, through the `css-tree` website build chain.
- `dunce 1.0.5` declares `CC0-1.0 OR MIT-0 OR Apache-2.0`; the published declaration offers alternate license choices, but its exact source/license files and selection should be confirmed.
- `webpki-root-certs 1.0.9` declares `CDLA-Permissive-2.0` and is reachable through `reqwest` from the desktop and multiple storage crates. This is a data license and does not appear in OSI's current approved-license list. SignPath should confirm whether this certificate-data component is in scope under its “OSI-approved license for all components” rule.

OSI's current approved-license list includes `MIT-0`, `Unicode-3.0`, and `Zlib`, but not `CC0-1.0`; CC0 was not approved through OSI's license review. Check every non-OSI-looking license and all OR/AND combinations against the current official list before making an eligibility claim. See the [OSI approved-license list](https://opensource.org/licenses), [OSI FAQ](https://opensource.org/faq), and [SignPath Foundation terms](https://signpath.org/terms.html).

- No complete SBOM/license report is attached to the published v1.4.16 artifacts.

This evidence supports continuing the SignPath application preparation, but it is not sufficient to claim that the entire release is confirmed eligible. Re-run the inventory for the exact candidate source and installer before applying or enabling signing.

# Third-party notices

Status: `LOCKFILE METADATA INVENTORY PASS / FAMILY OBLIGATION REVIEW PASS / FULL NOTICE-TEXT CLOSURE BLOCKED`

This public-candidate inventory is derived from the candidate's
`package.json` and `package-lock.json` on 2026-10-13. It is not legal advice
and does not by itself authorize publication of the product or its
dependencies.

## Project license

The project license is MIT. The candidate `LICENSE` contains the standard MIT
text and the attribution recorded by the existing project license evidence:
`Copyright (c) 2026 GARY LU`. Product Owner confirmation of the public
attribution and publication decision remains separate from this file.

## Direct dependencies

The following ranges are declared in `package.json`; the locked versions and
license identifiers are taken from the lockfile.

| Package | Declared range | Locked version | License |
| --- | --- | ---: | --- |
| `@modelcontextprotocol/sdk` | `^1.29.0` | `1.29.0` | MIT |
| `zod` | `^4.2.0` | `4.4.3` | MIT |
| `@types/express` | `^5.0.6` | `5.0.6` | MIT |
| `@types/node` | `^22.12.0` | `22.19.21` | MIT |
| `tsx` | `^4.21.0` | `4.22.4` | MIT |
| `typescript` | `^5.9.3` | `5.9.3` | Apache-2.0 |
| `vitest` | `^4.0.15` | `4.1.9` | MIT |

## Lockfile inventory

The lockfile contains 208 package records. Every record has a license
identifier in the current lockfile inspection. The exact package names,
locked versions, dependency placement, integrity values, and license fields
remain in `package-lock.json`, which is the authoritative machine-readable
inventory for this candidate.

License metadata counts across the 208 records are:

| License identifier | Records |
| --- | ---: |
| MIT | 179 |
| MPL-2.0 | 12 |
| ISC | 9 |
| Apache-2.0 | 3 |
| BSD-3-Clause | 3 |
| BSD-2-Clause | 1 |
| 0BSD | 1 |

The non-MIT records requiring explicit notice review are listed below using
the exact locked name and version from the lockfile.

### Apache-2.0

- `detect-libc@2.1.2`
- `expect-type@1.3.0`
- `typescript@5.9.3`

### BSD-3-Clause

- `fast-uri@3.1.2`
- `qs@6.15.2`
- `source-map-js@1.2.1`

### BSD-2-Clause

- `json-schema-typed@8.0.2`

### ISC

- `inherits@2.0.4`
- `isexe@2.0.0`
- `once@1.4.0`
- `picocolors@1.1.1`
- `setprototypeof@1.2.0`
- `siginfo@2.0.0`
- `which@2.0.2`
- `wrappy@1.0.2`
- `zod-to-json-schema@3.25.2`

### MPL-2.0

- `lightningcss@1.32.0`
- `lightningcss-android-arm64@1.32.0`
- `lightningcss-darwin-arm64@1.32.0`
- `lightningcss-darwin-x64@1.32.0`
- `lightningcss-freebsd-x64@1.32.0`
- `lightningcss-linux-arm-gnueabihf@1.32.0`
- `lightningcss-linux-arm64-gnu@1.32.0`
- `lightningcss-linux-arm64-musl@1.32.0`
- `lightningcss-linux-x64-gnu@1.32.0`
- `lightningcss-linux-x64-musl@1.32.0`
- `lightningcss-win32-arm64-msvc@1.32.0`
- `lightningcss-win32-x64@1.32.0`

### 0BSD

- `tslib@2.8.1`

## Notice-text status and publication boundary

The metadata inventory is complete for the current lockfile: 208/208 records
have a license identifier. The final acquisition pass verified 62/62 targeted
lockfile-pinned tarballs against their SHA-512 integrity values. It recovered
exact package text for 15 records and exact upstream family text for 42
platform-package records. Two MIT records remain unresolved because neither
their exact published tarball nor their exact upstream source tree contains an
original license/NOTICE/copyright file: `@tybys/wasm-util@0.10.2` and
`stackback@0.0.2`.

The lockfile inventory and the family-obligation review above are the public
source-only notice record. Detailed pre-publication evidence is intentionally
kept outside this source tree and is not part of the GitHub export.

The two unresolved package-text records remain a release gate. Do not treat
this inventory as full third-party NOTICE closure or as approval to redistribute
a dependency bundle until the original package-specific text has been obtained
and reviewed.

An SPDX identifier is sufficient for the lockfile's machine-readable inventory,
but it is not by itself sufficient to close a distributable notice bundle when
the package's original copyright, attribution, or NOTICE text has not been
verified. Repeated license families may be centralized only after every package
record is mapped back to the centralized text and its package-specific notices
are retained.

The family obligations used for this review are:

- MIT: retain the applicable copyright notice, permission notice, and warranty
  disclaimer for each redistributed work. The project `LICENSE` covers POLYSUB;
  it does not replace dependency copyright notices.
- Apache-2.0: include the license, retain copyright/patent/trademark/attribution
  notices, and reproduce any package-provided `NOTICE` content; modified files
  also require the license's modification notice condition.
- MPL-2.0: include the MPL text and applicable source/file notices; distributing
  MPL-covered code requires preserving the MPL notices and satisfying its
  source-code obligations for covered files.
- BSD-2-Clause and BSD-3-Clause: retain the copyright, conditions, and disclaimer;
  BSD-3-Clause also retains its non-endorsement condition.
- ISC: retain the package copyright, permission, and disclaimer text.
- 0BSD: the standard text is permissive and has no copyright-retention condition,
  but the exact package text and any package-specific notice still must be
  verified before claiming closure.

The installed tree provides exact license/notice-file evidence for 131 MIT
records, all 3 Apache-2.0 records, the BSD-2-Clause record, all 3 BSD-3-Clause
records, all 9 ISC records, and 2 of 12 MPL-2.0 records. The exact tarball
pass additionally provided 3 `@emnapi` MIT files, 10 `lightningcss` MPL files,
the `fsevents` MIT file, and both `tslib` 0BSD text files. TypeScript also
provides `ThirdPartyNoticeText.txt`; that notice is preserved as a
package-specific requirement and is not generalized to the rest of the graph.
The 26 esbuild platform packages, 15 Rolldown binding packages, and
`@napi-rs/wasm-runtime` are mapped to exact upstream source license text;
their individual package attributions remain in the evidence record. The two
unresolved records are listed in the closure matrix.

For the source-only candidate, the MPL-2.0 records do not represent
redistributed lightningcss source or executables, so this candidate does not
claim a future binary/bundled source-offer obligation is satisfied. Any future
dependency redistribution must provide the covered source or valid offer and
preserve covered-file notices separately.

Do not describe this file as legal clearance or as proof that all required
attributions have been reproduced. Before public release, an owner-approved
release task must obtain, review, and include the full applicable license and
notice text for the exact lockfile graph, then recheck that the published tree
matches this inventory. No private paths, local state, credentials, or
provider/Tunnel records are part of this candidate notice file.

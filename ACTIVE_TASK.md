# ACTIVE_TASK

Status: NONE
Date: 2026-10-13

Completion: Step 1 second-round bounded analysis and the one confirmed low-risk cleanup are complete. Core proposals remain unimplemented pending Product Owner review; full build/test remains blocked by missing local dependencies.

## Goal

Complete the second Step 1 source-slimming pass for the public source candidate by tracing the actual call and lifecycle boundaries around Blue-Wake A/B, `CodexJobRegistry`/`DurableCompletionOutbox`, historical test fixtures, and `tools/build.mjs`.

## Baseline and starting checkpoint

- Repository: `C:\Users\test\Documents\Codex\polysub-public-source-candidate-20261012`
- Branch: `candidate-baseline-20261013`
- Starting checkpoint: `d4c460a274d21399afb331dce8ff34f152fcefc0`
- Private comparison tree: `C:\Users\test\Documents\Codex\polysub-bridge-project`, read-only and not a work target.

## Expected output

- A durable line-level work journal distinguishing analysis, implementation, and verification.
- Only confirmed low-risk public-candidate cleanup implemented.
- Core merge/deletion proposals recorded with dependencies, risks, and tests, without implementing them.

## Pass / Fail criteria

- PASS when each requested area has concrete line-level findings and a disposition.
- PASS when the implemented cleanup has a clean diff and the available validation passes.
- FAIL if private-tree files, services, deployment, allowed roots, or Step 2–10 work are changed or invoked.

## Allowed scope

- Read and compare the public candidate source and tests.
- Add this bounded task record and its work journal.
- Make and verify low-risk cleanup in the public candidate only.

## Prohibited scope

- Do not modify the private Bridge tree.
- Do not start, stop, restart, deploy, or otherwise operate Live Bridge services.
- Do not modify `allowedRoots`, tunnel configuration, packaging/release state, or public licensing claims.
- Do not merge or delete Blue-Wake, JobRegistry, Outbox, or other core logic without Product Owner review.
- Do not continue into Step 2–10.

## Stop condition

Stop after the line-level audit, the confirmed low-risk cleanup, minimum available validation, and durable record are complete.

## Escalation condition

Ask the Product Owner to review any core merge/deletion proposal or any missing dependency/fixture evidence before changing it.

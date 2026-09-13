# Dependency and software supply-chain patterns

## Contents

- Dependency ownership
- Upgrade strategy
- Lockfiles and reproducibility
- Vulnerability scanning
- Reachability and remediation judgment
- Build provenance and SBOM
- CI trust boundaries
- Runtime-delivered code/config
- Mature references

## Dependency ownership

For each important dependency know:

- direct or transitive;
- runtime/build/dev-only;
- privileged boundary reached;
- current pinned/locked version;
- upstream maintenance status;
- upgrade cadence;
- compatibility surface;
- replacement/removal cost.

A dependency warning is not enough context to decide a production change.

## Upgrade strategy

Before a major or runtime-sensitive upgrade:

1. read upstream release/breaking/security notes across skipped versions;
2. search recent issues for your exact platform/integration;
3. identify APIs/private internals you rely on;
4. isolate the upgrade from unrelated behavior changes;
5. run the capability/contract matrix;
6. build the real packaged/deployed form;
7. preserve rollback if persisted schema/protocol allows it.

Do not mass-upgrade because an audit command suggests `--force`.

## Lockfiles and reproducibility

Use the ecosystem's supported lock mechanism and deterministic install mode in CI.

Record the actual source/build identity for release artifacts. "package.json says version X" does not prove which transitive bytes entered the artifact.

## Vulnerability scanning

Use current vulnerability databases/tools as evidence, not an auto-patch oracle.

Evaluate:

- affected version;
- runtime versus dev/build path;
- reachable vulnerable function/feature when known;
- exposure/trust boundary;
- exploit prerequisites;
- fixed version and compatibility risk;
- compensating controls;
- advisory confidence/withdrawal.

OSV-Scanner is a mature multi-ecosystem example that can scan lockfiles/SBOMs and, for some ecosystems, use call analysis to reduce false positives:
https://github.com/google/osv-scanner

Scanner regressions also exist, so pin/validate security tooling like other build dependencies rather than treating every new scanner result as infallible.

## Reachability and remediation judgment

A high severity does not mean "run a breaking update immediately"; a low severity does not mean "ignore forever".

Prioritize with:

`severity + exploitability + reachability + exposed trust boundary + user/data impact + fix availability + upgrade regression risk`

Document intentional temporary exceptions with owner, reason, and revisit condition.

## Build provenance and SBOM

For important artifacts, consider:

- cryptographic hashes;
- provenance/attestation tying artifact to source/workflow;
- SBOM describing included components;
- signed release metadata/artifacts where platform supports it;
- immutable artifact storage.

Provenance proves origin/process evidence, not that the code is correct or secure.

SLSA is a useful current supply-chain framework:
https://slsa.dev/

## CI trust boundaries

Treat CI as privileged production-adjacent code.

Review:

- fork/untrusted PR behavior;
- secret exposure;
- workflow token permissions;
- reusable workflow inputs;
- third-party actions and pinning strategy;
- artifact poisoning between jobs;
- deployment environment approvals;
- OIDC/cloud role scope;
- shell/workflow-command injection from untrusted filenames/output.

Do not echo untrusted strings into control channels or shell scripts without correct quoting/sanitization.

## Runtime-delivered code/config

If a remote adapter, plugin, feature bundle, ruleset, or config can change executable behavior independently of the binary, treat it as a software supply chain.

Prefer:

`immutable version -> digest/signature -> authenticated manifest -> compatibility bounds -> staged activation -> last-known-good rollback`

Never execute an unauthenticated mutable `latest.js` in a privileged runtime.

Use `references/adapter-distribution-patterns.md` for this specialized case.

## Mature references

- SLSA: https://slsa.dev/
- OSV-Scanner: https://github.com/google/osv-scanner
- OWASP Dependency-Check project: https://owasp.org/www-project-dependency-check/
- GitHub artifact attestations: https://docs.github.com/en/actions/security-for-github-actions/using-artifact-attestations
- npm lockfile/install docs when using npm: https://docs.npmjs.com/cli/commands/npm-ci

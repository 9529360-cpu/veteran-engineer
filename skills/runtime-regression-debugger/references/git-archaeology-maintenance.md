# Git archaeology and maintenance hotspot analysis

## Contents

- Use history to explain risk, not assign blame
- Establish the correct history scope
- Find hotspots and ownership concentration
- Read reverts and fixes as mechanism evidence
- Recover intent from change sequences
- Distinguish stable-old from abandoned-old
- Use archaeology before risky refactors
- Avoid misleading history metrics

## Use history to explain risk, not assign blame

Git history can reveal where the system repeatedly changes, where knowledge is concentrated, and where prior fixes failed. Use it to guide investigation and test depth, never to rank or blame individuals.

Prefer team/role language in reports. Do not expose author identities unless the user needs them for an authorized ownership task.

## Establish the correct history scope

Before drawing conclusions, confirm:

- repository is the real source of the deployed component;
- history is not shallow/truncated;
- generated/vendor files are excluded where appropriate;
- file moves/renames may hide older history;
- the analysis window covers the relevant product era;
- monorepo paths are scoped to the affected component when needed.

Use `scripts/repo_archaeology.py <repo>` for a fast metadata-only hotspot pass.

## Find hotspots and ownership concentration

Useful signals include:

- high touch count;
- high added/deleted churn;
- repeated fix/revert/hotfix commits;
- frequent changes near migrations/auth/release/runtime boundaries;
- many callers changing with one file;
- one or very few historical contributors for a critical component;
- sudden recent churn in historically stable code.

A hotspot is a place to inspect more carefully, not proof that the file is badly designed.

## Read reverts and fixes as mechanism evidence

When a regression is near a historically unstable area:

1. inspect recent fix/revert commits touching the same owner;
2. identify the exact mechanism each attempted to change;
3. compare the environment/version assumptions;
4. check whether later code reintroduced the old failure mode;
5. avoid repeating a previously rejected workaround without understanding why it failed.

Commit messages may be wrong. Verify against diffs, tests, issue/PR discussion, and runtime evidence.

## Recover intent from change sequences

One commit rarely contains the whole design. Read the sequence around a boundary:

`initial feature -> compatibility patch -> migration -> incident fix -> cleanup`

This often reveals why apparently redundant code exists.

For long-lived migrations, inspect when dual paths were introduced and whether the promised removal ever occurred.

## Distinguish stable-old from abandoned-old

Code untouched for years can mean either:

- stable, well-understood behavior; or
- abandoned, risky code nobody has exercised or upgraded.

Discriminate using runtime traffic, tests, ownership, dependency versions, incident history, and observability. Age alone is not a refactor priority.

## Use archaeology before risky refactors

Perform history review before deleting or restructuring code that:

- owns auth/tenancy/security;
- handles money or external side effects;
- participates in migrations or compatibility;
- has repeated production fixes;
- has surprising branches with no obvious test;
- has one-source-of-truth implications;
- is a cross-repository/public contract.

Characterize behavior first when historical intent remains uncertain.

## Avoid misleading history metrics

Do not overinterpret:

- line count as complexity;
- churn as low quality;
- author count as ownership quality;
- commit-message keywords as root cause;
- old age as obsolescence;
- recent activity as importance.

History is one evidence source. Combine it with active callers, runtime traffic, incidents, tests, and product criticality.

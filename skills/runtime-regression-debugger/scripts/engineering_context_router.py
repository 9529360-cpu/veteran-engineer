#!/usr/bin/env python3
"""Suggest a small set of skill references from explicit engineering signals.

This is a deterministic routing aid, not a classifier or correctness proof.
Example:
  engineering_context_router.py --signals bug,async,frontend,lifecycle --max 4 --max-bytes 65536

`--max-bytes` uses packaged reference file bytes as a cheap deterministic proxy
for context cost. It never removes capability; over-budget owners remain deferred.
"""
from __future__ import annotations
import argparse, json
from pathlib import Path

# Deliberately empty. Cross-project process invariants live in SKILL.md; deep
# coordination/control references are routed only when the current mechanism
# explicitly needs them. This preserves progressive disclosure and route budget.
CORE = []
SKILL_ROOT = Path(__file__).resolve().parents[1]

ROUTES = {
    "bug": ["references/decision-compression-learning-loop.md", "references/causal-debugging-experiment-design.md"],
    "fullstack": ["references/full-stack-product-engineering.md"],
    "cross-layer": ["references/full-stack-product-engineering.md"],
    "takeover": ["references/project-takeover-engineering.md"],
    "repo-autopilot": ["references/project-takeover-engineering.md", "references/proactive-product-stewardship.md"],
    "foreground-agent": ["references/project-takeover-engineering.md", "references/proactive-product-stewardship.md", "references/chatgpt-web-host-execution.md"],
    "chatgpt-web-host": ["references/chatgpt-web-host-execution.md"],
    "monorepo": ["references/project-takeover-engineering.md", "references/staff-engineering-execution.md"],
    "workspace": ["references/project-takeover-engineering.md"],
    "frontend": ["references/frontend-implementation-patterns.md"],
    "frontend-style": ["references/frontend-styling-implementation-patterns.md"],
    "website": ["references/website-experience-patterns.md", "references/frontend-product-patterns.md"],
    "ui": ["references/frontend-product-patterns.md"],
    "ux": ["references/frontend-product-patterns.md"],
    "product-design": ["references/frontend-product-patterns.md"],
    "design-synthesis": ["references/design-synthesis-prototyping.md"],
    "visual-concept": ["references/design-synthesis-prototyping.md", "references/frontend-visual-system-patterns.md"],
    "code-native-design": ["references/design-synthesis-prototyping.md"],
    "experience-design": ["references/frontend-product-patterns.md"],
    "visual-design": ["references/frontend-visual-system-patterns.md"],
    "ui-redesign": ["references/frontend-product-patterns.md", "references/frontend-design-governance.md"],
    "design-polish": ["references/frontend-visual-system-patterns.md"],
    "design-review": ["references/visual-ui-quality-assurance-product-engineering.md"],
    "desktop-ui": ["references/frontend-product-patterns.md", "references/desktop-product-experience.md"],
    "desktop-ui-redesign": ["references/frontend-product-patterns.md", "references/desktop-product-experience.md", "references/frontend-design-governance.md"],
    "desktop-shell-ui": ["references/desktop-product-experience.md", "references/host-shell-platform-patterns.md", "references/frontend-product-patterns.md"],
    "desktop-shell-redesign": ["references/desktop-product-experience.md", "references/host-shell-platform-patterns.md", "references/frontend-product-patterns.md", "references/frontend-design-governance.md"],
    "agentic-desktop": ["references/desktop-product-experience.md", "references/ai-llm-product-engineering.md", "references/frontend-product-patterns.md"],
    "agentic-desktop-redesign": ["references/desktop-product-experience.md", "references/ai-llm-product-engineering.md", "references/frontend-product-patterns.md", "references/frontend-design-governance.md"],
    "interaction-design": ["references/frontend-product-patterns.md"],
    "wireframe": ["references/frontend-product-patterns.md"],
    "design-system": ["references/frontend-visual-system-patterns.md"],
    "responsive-design": ["references/frontend-visual-system-patterns.md"],
    "visual-system": ["references/frontend-visual-system-patterns.md"],
    "design-governance": ["references/frontend-design-governance.md"],
    "design-versioning": ["references/frontend-design-governance.md"],
    "design-authority": ["references/frontend-design-governance.md"],
    "mobile": ["references/mobile-product-engineering.md"],
    "ios": ["references/mobile-product-engineering.md"],
    "android": ["references/mobile-product-engineering.md"],
    "react-native": ["references/mobile-product-engineering.md", "references/frontend-product-patterns.md"],
    "expo": ["references/mobile-product-engineering.md", "references/frontend-product-patterns.md"],
    "flutter": ["references/mobile-product-engineering.md"],
    "mobile-design": ["references/mobile-product-engineering.md", "references/frontend-product-patterns.md"],
    "deep-link": ["references/mobile-product-engineering.md"],
    "push-notification": ["references/notification-delivery-product-engineering.md", "references/mobile-product-engineering.md", "references/async-edge-job-patterns.md"],
    "mobile-offline": ["references/mobile-product-engineering.md", "references/distributed-systems-consistency.md"],
    "desktop": ["references/runtime-lifecycle-patterns.md", "references/host-shell-platform-patterns.md"],
    "electron": ["references/runtime-lifecycle-patterns.md", "references/host-shell-platform-patterns.md"],
    "desktop-runtime": ["references/runtime-failure-patterns.md", "references/runtime-lifecycle-patterns.md"],
    "desktop-shell": ["references/host-shell-platform-patterns.md", "references/auth-navigation-platform-patterns.md"],
    "desktop-packaging": ["references/host-shell-platform-patterns.md", "references/release-promotion-patterns.md"],
    "electron-ipc": ["references/runtime-lifecycle-patterns.md", "references/auth-navigation-platform-patterns.md"],
    "browser-extension": ["references/browser-extension-product-engineering.md", "references/frontend-product-patterns.md"],
    "chrome-extension": ["references/browser-extension-product-engineering.md"],
    "firefox-extension": ["references/browser-extension-product-engineering.md"],
    "webextension": ["references/browser-extension-product-engineering.md"],
    "extension-manifest": ["references/browser-extension-product-engineering.md"],
    "content-script": ["references/browser-extension-product-engineering.md", "references/frontend-implementation-patterns.md"],
    "extension-background": ["references/browser-extension-product-engineering.md", "references/async-edge-job-patterns.md"],
    "extension-permissions": ["references/browser-extension-product-engineering.md", "references/security-multitenancy-patterns.md"],
    "extension-store": ["references/browser-extension-product-engineering.md", "references/release-promotion-patterns.md"],
    "cli": ["references/cli-tui-product-engineering.md"],
    "command-line": ["references/cli-tui-product-engineering.md"],
    "tui": ["references/cli-tui-product-engineering.md"],
    "terminal-app": ["references/cli-tui-product-engineering.md"],
    "cli-arguments": ["references/cli-tui-product-engineering.md"],
    "cli-config": ["references/cli-tui-product-engineering.md"],
    "cli-output": ["references/cli-tui-product-engineering.md"],
    "cli-signals": ["references/cli-tui-product-engineering.md", "references/runtime-lifecycle-patterns.md"],
    "shell-completion": ["references/cli-tui-product-engineering.md"],
    "cli-release": ["references/cli-tui-product-engineering.md", "references/release-promotion-patterns.md"],
    "developer-experience": ["references/developer-experience-product-engineering.md"],
    "developer-onboarding": ["references/developer-experience-product-engineering.md"],
    "api-design-review": ["references/developer-experience-product-engineering.md", "references/api-backend-patterns.md"],
    "sdk": ["references/sdk-library-product-engineering.md", "references/cross-repo-contract-mesh.md"],
    "library": ["references/sdk-library-product-engineering.md"],
    "client-library": ["references/sdk-library-product-engineering.md", "references/api-backend-patterns.md"],
    "public-library-api": ["references/sdk-library-product-engineering.md", "references/semantic-diff-behavior-change.md"],
    "semver": ["references/sdk-library-product-engineering.md", "references/semantic-diff-behavior-change.md"],
    "package-exports": ["references/sdk-library-product-engineering.md", "references/dependency-supply-chain-patterns.md"],
    "generated-sdk": ["references/sdk-library-product-engineering.md", "references/cross-repo-contract-mesh.md"],
    "library-dependencies": ["references/sdk-library-product-engineering.md", "references/dependency-supply-chain-patterns.md"],
    "package-publishing": ["references/sdk-library-product-engineering.md", "references/release-promotion-patterns.md", "references/dependency-supply-chain-patterns.md"],
    "library-deprecation": ["references/sdk-library-product-engineering.md", "references/lifecycle-closure-design-to-deletion.md"],
    "technical-research": ["references/dependency-supply-chain-patterns.md"],
    "upstream-behavior": ["references/dependency-supply-chain-patterns.md"],
    "globalization": ["references/globalization-product-engineering.md"],
    "internationalization": ["references/globalization-product-engineering.md"],
    "localization": ["references/globalization-product-engineering.md"],
    "rtl": ["references/globalization-product-engineering.md", "references/frontend-implementation-patterns.md"],
    "bidi": ["references/globalization-product-engineering.md", "references/frontend-implementation-patterns.md"],
    "ime": ["references/globalization-product-engineering.md", "references/frontend-implementation-patterns.md"],
    "timezone": ["references/globalization-product-engineering.md", "references/temporal-debugging-state-transitions.md"],
    "locale-formatting": ["references/globalization-product-engineering.md"],
    "unicode-input": ["references/globalization-product-engineering.md", "references/frontend-implementation-patterns.md"],
    "accessibility": ["references/accessibility-product-engineering.md"],
    "screen-reader": ["references/accessibility-product-engineering.md", "references/frontend-implementation-patterns.md"],
    "keyboard-navigation": ["references/accessibility-product-engineering.md", "references/frontend-implementation-patterns.md"],
    "focus-management": ["references/accessibility-product-engineering.md", "references/frontend-implementation-patterns.md"],
    "reduced-motion": ["references/accessibility-product-engineering.md", "references/frontend-implementation-patterns.md"],
    "high-contrast": ["references/accessibility-product-engineering.md", "references/frontend-implementation-patterns.md"],
    "assistive-technology": ["references/accessibility-product-engineering.md"],
    "accessible-form": ["references/accessibility-product-engineering.md", "references/frontend-implementation-patterns.md"],
    "aria": ["references/accessibility-product-engineering.md", "references/frontend-implementation-patterns.md"],
    "mobile-accessibility": ["references/accessibility-product-engineering.md", "references/mobile-product-engineering.md"],
    "desktop-accessibility": ["references/accessibility-product-engineering.md", "references/host-shell-platform-patterns.md"],
    "privacy": ["references/privacy-data-lifecycle-engineering.md", "references/security-multitenancy-patterns.md"],
    "data-privacy": ["references/privacy-data-lifecycle-engineering.md", "references/security-multitenancy-patterns.md"],
    "data-minimization": ["references/privacy-data-lifecycle-engineering.md", "references/product-analytics-experimentation.md"],
    "consent-management": ["references/privacy-data-lifecycle-engineering.md"],
    "privacy-preference": ["references/privacy-data-lifecycle-engineering.md"],
    "data-retention": ["references/privacy-data-lifecycle-engineering.md", "references/lifecycle-closure-design-to-deletion.md"],
    "data-deletion": ["references/privacy-data-lifecycle-engineering.md", "references/data-consistency-migration-patterns.md", "references/lifecycle-closure-design-to-deletion.md"],
    "data-export": ["references/privacy-data-lifecycle-engineering.md", "references/security-multitenancy-patterns.md"],
    "provider-data-egress": ["references/privacy-data-lifecycle-engineering.md", "references/dependency-outcome-degradation.md"],
    "sensitive-logging": ["references/privacy-data-lifecycle-engineering.md", "references/operations-reliability-patterns.md"],
    "collaboration": ["references/collaboration-realtime-product-engineering.md"],
    "realtime-collaboration": ["references/collaboration-realtime-product-engineering.md", "references/distributed-systems-consistency.md", "references/async-edge-job-patterns.md"],
    "presence": ["references/collaboration-realtime-product-engineering.md", "references/temporal-debugging-state-transitions.md"],
    "shared-state": ["references/collaboration-realtime-product-engineering.md", "references/distributed-systems-consistency.md"],
    "collaborative-editing": ["references/collaboration-realtime-product-engineering.md", "references/data-consistency-migration-patterns.md"],
    "optimistic-reconciliation": ["references/collaboration-realtime-product-engineering.md", "references/frontend-implementation-patterns.md", "references/data-consistency-migration-patterns.md"],
    "offline-collaboration": ["references/collaboration-realtime-product-engineering.md", "references/distributed-systems-consistency.md"],
    "realtime-permissions": ["references/collaboration-realtime-product-engineering.md", "references/security-multitenancy-patterns.md"],
    "reconnect-recovery": ["references/collaboration-realtime-product-engineering.md", "references/temporal-debugging-state-transitions.md"],
    "event-ordering": ["references/collaboration-realtime-product-engineering.md", "references/distributed-systems-consistency.md"],
    "collaboration-backpressure": ["references/collaboration-realtime-product-engineering.md", "references/performance-scale-patterns.md"],
    "file-upload": ["references/file-upload-media-product-engineering.md", "references/security-multitenancy-patterns.md"],
    "resumable-upload": ["references/file-upload-media-product-engineering.md", "references/data-movement-cdc-search-storage.md"],
    "multipart-upload": ["references/file-upload-media-product-engineering.md", "references/data-movement-cdc-search-storage.md"],
    "attachment-flow": ["references/file-upload-media-product-engineering.md"],
    "object-delivery": ["references/file-upload-media-product-engineering.md", "references/security-multitenancy-patterns.md"],
    "media-processing": ["references/file-upload-media-product-engineering.md", "references/async-edge-job-patterns.md"],
    "signed-object-url": ["references/file-upload-media-product-engineering.md", "references/security-multitenancy-patterns.md"],
    "upload-quarantine": ["references/file-upload-media-product-engineering.md", "references/security-multitenancy-patterns.md"],
    "upload-lifecycle": ["references/file-upload-media-product-engineering.md", "references/lifecycle-closure-design-to-deletion.md"],
    "remote-file-import": ["references/file-upload-media-product-engineering.md", "references/security-multitenancy-patterns.md", "references/dependency-outcome-degradation.md"],
    "notification-delivery": ["references/notification-delivery-product-engineering.md", "references/async-edge-job-patterns.md"],
    "email-notification": ["references/notification-delivery-product-engineering.md", "references/async-edge-job-patterns.md"],
    "sms-notification": ["references/notification-delivery-product-engineering.md", "references/async-edge-job-patterns.md"],
    "in-app-notification": ["references/notification-delivery-product-engineering.md", "references/frontend-product-patterns.md"],
    "notification-preferences": ["references/notification-delivery-product-engineering.md", "references/privacy-data-lifecycle-engineering.md"],
    "notification-scheduling": ["references/notification-delivery-product-engineering.md", "references/temporal-debugging-state-transitions.md"],
    "notification-template": ["references/notification-delivery-product-engineering.md", "references/globalization-product-engineering.md"],
    "notification-dedupe": ["references/notification-delivery-product-engineering.md", "references/async-edge-job-patterns.md"],
    "delivery-receipts": ["references/notification-delivery-product-engineering.md", "references/dependency-outcome-degradation.md"],
    "webhook-delivery": ["references/notification-delivery-product-engineering.md", "references/api-backend-patterns.md", "references/security-multitenancy-patterns.md"],
    "notification-fanout": ["references/notification-delivery-product-engineering.md", "references/performance-scale-patterns.md", "references/async-edge-job-patterns.md"],
    "product-analysis": ["references/product-analysis-engineering.md"],
    "product-research": ["references/product-analysis-engineering.md"],
    "competitor-analysis": ["references/product-analysis-engineering.md"],
    "product-teardown": ["references/product-analysis-engineering.md"],
    "behavior-analysis": ["references/product-analysis-engineering.md"],
    "black-box-analysis": ["references/product-analysis-engineering.md"],
    "product-diff": ["references/product-analysis-engineering.md"],
    "capability-map": ["references/product-analysis-engineering.md"],
    "product-network-analysis": ["references/product-analysis-engineering.md", "references/api-backend-patterns.md"],
    "technical-fingerprint": ["references/product-analysis-engineering.md"],
    "product-improvement": ["references/proactive-product-stewardship.md"],
    "product-stewardship": ["references/proactive-product-stewardship.md"],
    "product-analytics": ["references/product-analytics-experimentation.md"],
    "instrumentation": ["references/product-analytics-experimentation.md"],
    "funnel-analysis": ["references/product-analytics-experimentation.md"],
    "retention-analysis": ["references/product-analytics-experimentation.md"],
    "experimentation": ["references/product-analytics-experimentation.md"],
    "ab-test": ["references/product-analytics-experimentation.md"],
    "feature-rollout": ["references/feature-flag-progressive-delivery-product-engineering.md", "references/product-analytics-experimentation.md", "references/operability-control-plane-contract.md"],
    "feature-flag": ["references/feature-flag-progressive-delivery-product-engineering.md", "references/operability-control-plane-contract.md", "references/release-promotion-patterns.md"],
    "user-onboarding": ["references/user-onboarding-activation-product-engineering.md", "references/frontend-product-patterns.md"],
    "account-identity": ["references/account-identity-lifecycle-product-engineering.md", "references/security-multitenancy-patterns.md"],
    "organization-membership": ["references/organization-membership-product-engineering.md", "references/security-multitenancy-patterns.md"],
    "privileged-support": ["references/privileged-operator-support-product-engineering.md", "references/security-multitenancy-patterns.md", "references/privacy-data-lifecycle-engineering.md"],
    "product-requirements": ["references/product-requirements-engineering.md"],
    "prd": ["references/product-requirements-engineering.md"],
    "user-story": ["references/product-requirements-engineering.md"],
    "acceptance-criteria": ["references/product-requirements-engineering.md", "references/engineering-evidence-gates.md"],
    "requirement-discovery": ["references/product-requirements-engineering.md", "references/product-analysis-engineering.md"],
    "scope-definition": ["references/product-requirements-engineering.md"],
    "ai-product": ["references/ai-llm-product-engineering.md"],
    "llm": ["references/ai-llm-product-engineering.md"],
    "prompt-engineering": ["references/ai-llm-product-engineering.md"],
    "rag": ["references/ai-llm-product-engineering.md", "references/search-relevance-serving.md"],
    "tool-calling": ["references/ai-llm-product-engineering.md", "references/api-backend-patterns.md"],
    "agent-loop": ["references/ai-llm-product-engineering.md", "references/async-edge-job-patterns.md"],
    "python-agent": ["references/python-agent-system-engineering.md", "references/ai-llm-product-engineering.md", "references/async-edge-job-patterns.md"],
    "model-eval": ["references/ai-llm-product-engineering.md", "references/engineering-evidence-gates.md"],
    "structured-output": ["references/ai-llm-product-engineering.md"],
    "lifecycle": ["references/temporal-debugging-state-transitions.md", "references/runtime-lifecycle-patterns.md"],
    "async": ["references/temporal-debugging-state-transitions.md", "references/async-edge-job-patterns.md"],
    "concurrency": ["references/temporal-debugging-state-transitions.md", "references/causal-debugging-experiment-design.md", "references/distributed-systems-consistency.md"],
    "api": ["references/api-backend-patterns.md"],
    "async-job": ["references/async-edge-job-patterns.md"],
    "cache": ["references/data-consistency-migration-patterns.md", "references/performance-scale-patterns.md", "references/cache-rate-limit-admission.md"],
    "rate-limit": ["references/api-backend-patterns.md", "references/performance-scale-patterns.md", "references/cache-rate-limit-admission.md"],
    "auth": ["references/security-multitenancy-patterns.md"],
    "security": ["references/security-multitenancy-patterns.md"],
    "security-review": ["references/security-multitenancy-patterns.md", "references/code-review-patterns.md"],
    "tenant": ["references/security-multitenancy-patterns.md"],
    "database": ["references/database-internals-query-engineering.md"],
    "migration": ["references/data-consistency-migration-patterns.md", "references/change-entropy-rollback-paradox.md"],
    "data-movement": ["references/data-movement-cdc-search-storage.md"],
    "cdc": ["references/data-movement-cdc-search-storage.md"],
    "backfill": ["references/data-movement-cdc-search-storage.md", "references/data-consistency-migration-patterns.md"],
    "data-pipeline": ["references/data-movement-cdc-search-storage.md", "references/async-edge-job-patterns.md"],
    "search-index": ["references/data-movement-cdc-search-storage.md", "references/search-relevance-serving.md"],
    "object-storage": ["references/data-movement-cdc-search-storage.md", "references/file-upload-media-product-engineering.md"],
    "queue": ["references/stack-messaging-workflows.md"],
    "payment": ["references/payments-ledger-integrity.md", "references/change-entropy-rollback-paradox.md"],
    "performance": ["references/performance-scale-patterns.md"],
    "incident": ["references/incident-command-uncertainty.md"],
    "release": ["references/release-promotion-patterns.md", "references/change-entropy-rollback-paradox.md", "references/operations-reliability-patterns.md"],
    "deployment": ["references/release-promotion-patterns.md", "references/infrastructure-deployment-patterns.md", "references/operations-reliability-patterns.md", "references/change-entropy-rollback-paradox.md"],
    "iac": ["references/infrastructure-deployment-patterns.md", "references/change-entropy-rollback-paradox.md"],
    "terraform": ["references/infrastructure-deployment-patterns.md"],
    "cloud-infra": ["references/infrastructure-deployment-patterns.md", "references/operability-control-plane-contract.md"],
    "review": ["references/code-review-patterns.md", "references/semantic-diff-behavior-change.md", "references/negative-space-patch-compression.md", "references/veteran-engineering-judgment.md"],
    "refactor": ["references/architecture-refactoring-patterns.md", "references/negative-space-patch-compression.md"],
    "codemod": ["references/architecture-refactoring-patterns.md", "references/project-takeover-engineering.md"],
    "large-refactor": ["references/architecture-refactoring-patterns.md", "references/staff-engineering-execution.md"],
    "rollback": ["references/change-entropy-rollback-paradox.md"],
    "compatibility": ["references/change-entropy-rollback-paradox.md"],
    "causality": ["references/causal-debugging-experiment-design.md"],
    "semantic-diff": ["references/semantic-diff-behavior-change.md"],
    "validation": ["references/testing-quality-patterns.md", "references/engineering-evidence-gates.md"],
    "mutation": ["references/mutation-metamorphic-regression-testing.md"],
    "metamorphic": ["references/mutation-metamorphic-regression-testing.md"],
    "state-machine": ["references/temporal-debugging-state-transitions.md"],
    "workflow": ["references/temporal-debugging-state-transitions.md", "references/async-edge-job-patterns.md"],
    "assumption": ["references/decision-compression-learning-loop.md"],
    "evidence": ["references/proof-carrying-change-evidence.md"],
    "freshness": ["references/proof-carrying-change-evidence.md"],
    "operability": ["references/operability-control-plane-contract.md"],
    "observability": ["references/operations-reliability-patterns.md", "references/operability-control-plane-contract.md"],
    "kill-switch": ["references/operability-control-plane-contract.md"],
    "dependency": ["references/dependency-supply-chain-patterns.md"],
    "package-dependency": ["references/dependency-supply-chain-patterns.md"],
    "external": ["references/dependency-outcome-degradation.md"],
    "service-dependency": ["references/dependency-outcome-degradation.md"],
    "architecture": ["references/architecture-refactoring-patterns.md", "references/architecture-fitness-assumption-decay.md", "references/veteran-engineering-judgment.md"],
    "architecture-fitness": ["references/architecture-fitness-assumption-decay.md"],
    "fitness": ["references/architecture-fitness-assumption-decay.md"],
    "delivery": ["references/full-stack-product-engineering.md"],
    "feature": ["references/full-stack-product-engineering.md"],
    "closure": ["references/lifecycle-closure-design-to-deletion.md"],
    "deletion": ["references/lifecycle-closure-design-to-deletion.md"],
    "multi-repo": ["references/cross-repo-contract-mesh.md", "references/staff-engineering-execution.md"],
    "cross-repo": ["references/cross-repo-contract-mesh.md", "references/staff-engineering-execution.md"],
    "cross-host": ["references/cross-host-plugin-distribution.md"],
    "cross-surface-runtime": ["references/cross-host-plugin-distribution.md"],
    "remote-adapter": ["references/adapter-distribution-patterns.md", "references/dependency-supply-chain-patterns.md", "references/security-multitenancy-patterns.md"],
    "requirements": ["references/product-requirements-engineering.md"],
    "scope": ["references/product-requirements-engineering.md"],
    "navigation": ["references/frontend-product-patterns.md"],
    "product-navigation": ["references/frontend-product-patterns.md"],
    "repo-navigation": ["references/project-takeover-engineering.md"],
    "search": ["references/search-relevance-serving.md"],
    "product-search": ["references/search-relevance-serving.md"],
    "search-relevance": ["references/search-relevance-serving.md"],
    "generated": ["references/project-takeover-engineering.md", "references/semantic-diff-behavior-change.md"],
    "codegen": ["references/project-takeover-engineering.md", "references/cross-repo-contract-mesh.md"],
    "final-review": ["references/code-review-patterns.md"],
    "audit": ["references/code-review-patterns.md"],
    "broker": ["references/stack-messaging-workflows.md"],
    "distributed-transaction": ["references/distributed-systems-consistency.md"],
    "storage-engine": ["references/database-internals-query-engineering.md"],
    "profiling": ["references/performance-scale-patterns.md", "references/kernel-io-numa-runtime.md"],
    "chaos": ["references/operations-reliability-patterns.md"],
    "error-budget": ["references/operations-reliability-patterns.md"],
    "modernization": ["references/architecture-fitness-assumption-decay.md", "references/architecture-refactoring-patterns.md"],
    "simplification": ["references/lifecycle-closure-design-to-deletion.md"],
    "system-rescue": ["references/project-takeover-engineering.md"],
}
ALIASES = {
    "publish": "release", "publishing": "release", "github-release": "release", "release-tag": "release", "multi-host": "cross-host", "cross-host-runtime": "cross-surface-runtime", "remote-adapter-update": "remote-adapter", "autopublish": "release", "auto-publish": "release", "deploy": "deployment", "monorepository": "monorepo", "workspaces": "workspace", "ast-refactor": "codemod", "mass-refactor": "large-refactor", "infrastructure-as-code": "iac", "infrastructure": "iac", "infra": "iac", "opentofu": "terraform", "pulumi": "iac", "devops": "release", "full-stack": "fullstack", "full_stack": "fullstack", "crosslayer": "cross-layer", "vertical-slice": "delivery", "end-to-end": "delivery", "requirement": "requirements", "repo-search": "repo-navigation", "code-search": "repo-navigation", "repository-navigation": "repo-navigation", "generated-code": "generated", "code-generation": "codegen", "change-data-capture": "cdc", "etl": "data-pipeline", "data-backfill": "backfill", "reindex": "search-index", "search-indexing": "search-index", "blob-storage": "object-storage", "final-audit": "final-review", "db": "database", "backend": "api", "server": "api", "payments": "payment", "jobs": "queue", "job": "async-job", "background-job": "async-job", "background-worker": "async-job", "worker": "async-job", "cron": "async-job", "scheduled-job": "async-job", "race": "concurrency", "cause": "causality", "fsm": "state-machine", "state": "state-machine", "test": "validation", "tests": "validation", "testing": "validation", "code-audit": "review", "security-audit": "security-review", "proof": "evidence", "monitoring": "observability", "logs": "observability", "logging": "observability", "provider": "external", "vendor": "external", "remote-service": "service-dependency", "third-party-service": "service-dependency", "package-update": "package-dependency", "retire": "deletion", "multirepo": "multi-repo", "kafka": "broker", "rabbitmq": "broker", "2pc": "distributed-transaction", "saga": "distributed-transaction", "ebpf": "profiling", "bpftrace": "profiling", "slo": "error-budget", "decommission": "simplification", "rescue": "system-rescue", "interface-design": "ui", "ui-design": "ui", "screen-design": "ui", "design": "product-design", "frontend-design": "product-design", "web-design": "product-design", "website-design": "website", "marketing-site": "website", "marketing-website": "website", "landing-page": "website", "public-site": "website", "public-website": "website", "content-site": "website", "ux-audit": "design-review", "ux-design": "ux", "product-designer": "product-design", "design-tokens": "design-system", "responsive-ui": "responsive-design", "css": "frontend-style", "styling": "frontend-style", "styles": "frontend-style", "frontend-css": "frontend-style", "style-implementation": "frontend-style", "visual-implementation": "frontend-style", "design-to-code": "frontend-style", "tailwind": "frontend-style", "tailwindcss": "frontend-style", "css-modules": "frontend-style", "css-module": "frontend-style", "css-in-js": "frontend-style", "styled-components": "frontend-style", "emotion": "frontend-style", "sass": "frontend-style", "scss": "frontend-style", "less-css": "frontend-style", "interface-redesign": "ui-redesign", "visual-redesign": "ui-redesign", "product-redesign": "ui-redesign", "frontend-redesign": "ui-redesign", "dashboard-redesign": "ui-redesign", "navigation-redesign": "ui-redesign", "workspace-redesign": "ui-redesign", "new-screen-design": "product-design", "new-ui": "product-design", "visual-polish": "design-polish", "aesthetic-polish": "design-polish", "design-audit": "design-review", "visual-qa": "design-review", "mobile-app": "mobile", "app-development": "mobile", "native-app": "mobile", "reactnative": "react-native", "rn": "react-native", "expo-app": "expo", "dart-flutter": "flutter", "swift": "ios", "swiftui": "ios", "iphone": "ios", "ipad": "ios", "kotlin-android": "android", "jetpack-compose": "android", "deeplink": "deep-link", "deep-linking": "deep-link", "universal-link": "deep-link", "app-link": "deep-link", "push-notifications": "push-notification", "offline-mobile": "mobile-offline", "product-intelligence": "product-analysis", "competitive-analysis": "competitor-analysis", "competitor-research": "competitor-analysis", "blackbox-analysis": "black-box-analysis", "black-box-research": "black-box-analysis", "product-comparison": "competitor-analysis", "product-version-diff": "product-diff", "feature-map": "capability-map", "api-observation": "product-network-analysis", "technology-fingerprint": "technical-fingerprint",
    "desktop-app": "desktop", "desktop-application": "desktop", "desktop-redesign": "desktop-ui-redesign", "electron-ui": "desktop-ui", "electron-redesign": "desktop-ui-redesign", "electron-ui-redesign": "desktop-ui-redesign", "ai-desktop-redesign": "agentic-desktop-redesign", "agent-workspace-redesign": "agentic-desktop-redesign", "electronjs": "electron", "electron-app": "electron", "electron-main": "desktop-runtime", "electron-preload": "desktop-runtime", "electron-renderer": "electron", "electron-builder": "desktop-packaging", "electron-forge": "desktop-packaging", "electron-ipc-main": "electron-ipc",
    "browser-addon": "browser-extension", "chrome-addon": "chrome-extension", "firefox-addon": "firefox-extension", "web-extension": "webextension", "manifest-v3": "extension-manifest", "mv3": "extension-manifest", "extension-service-worker": "extension-background", "host-permissions": "extension-permissions", "chrome-web-store": "extension-store", "addons-mozilla-org": "extension-store",
    "command-line-interface": "cli", "command-line-tool": "cli", "developer-cli": "cli", "terminal-ui": "tui", "terminal-user-interface": "tui", "cli-args": "cli-arguments", "cli-flags": "cli-arguments", "cli-configuration": "cli-config", "cli-json-output": "cli-output", "cli-packaging": "cli-release", "command-completion": "shell-completion",
    "devex": "developer-experience", "dx": "developer-experience", "developer-journey": "developer-experience", "developer-experience-review": "developer-experience", "developer-onboarding-review": "developer-onboarding",
    "software-development-kit": "sdk", "client-sdk": "sdk", "developer-sdk": "sdk", "reusable-library": "library", "api-client-library": "client-library", "public-api-surface": "public-library-api", "semantic-versioning": "semver", "package-entrypoints": "package-exports", "package-exports-map": "package-exports", "sdk-generation": "generated-sdk", "generated-client-sdk": "generated-sdk", "peer-dependencies": "library-dependencies", "library-publishing": "package-publishing", "package-registry-release": "package-publishing", "library-deprecation-policy": "library-deprecation", "version-aware-docs": "technical-research", "library-behavior": "upstream-behavior", "framework-behavior": "upstream-behavior",
    "i18n": "internationalization", "internationalisation": "internationalization", "l10n": "localization", "localisation": "localization", "right-to-left": "rtl", "bidirectional-text": "bidi", "bidi-text": "bidi", "input-method-editor": "ime", "ime-composition": "ime", "time-zone": "timezone", "timezone-handling": "timezone", "locale-aware-formatting": "locale-formatting", "number-formatting": "locale-formatting", "currency-formatting": "locale-formatting", "unicode-text-input": "unicode-input",
    "a11y": "accessibility", "screenreader": "screen-reader", "keyboard-accessibility": "keyboard-navigation", "focus-trap": "focus-management", "prefers-reduced-motion": "reduced-motion", "forced-colors": "high-contrast", "assistive-tech": "assistive-technology", "form-accessibility": "accessible-form", "wai-aria": "aria", "ios-accessibility": "mobile-accessibility", "android-accessibility": "mobile-accessibility", "electron-accessibility": "desktop-accessibility",
    "privacy-engineering": "privacy", "personal-data": "data-privacy", "pii-handling": "data-privacy", "purpose-limitation": "data-minimization", "consent-preference": "privacy-preference", "cookie-consent": "privacy-preference", "retention-policy": "data-retention", "account-deletion": "data-deletion", "data-erasure": "data-deletion", "privacy-export": "data-export", "subject-data-export": "data-export", "third-party-data-sharing": "provider-data-egress", "pii-logging": "sensitive-logging",
    "collaborative-app": "collaboration", "multi-user-collaboration": "collaboration", "real-time-collaboration": "realtime-collaboration", "presence-state": "presence", "shared-document": "collaborative-editing", "co-editing": "collaborative-editing", "optimistic-ui-reconciliation": "optimistic-reconciliation", "offline-editing": "offline-collaboration", "live-permissions": "realtime-permissions", "reconnect-resume": "reconnect-recovery", "message-ordering": "event-ordering", "slow-consumer": "collaboration-backpressure",
    "direct-upload": "file-upload", "presigned-upload": "file-upload", "resume-upload": "resumable-upload", "chunked-upload": "multipart-upload", "file-attachment": "attachment-flow", "download-delivery": "object-delivery", "media-transcoding": "media-processing", "thumbnail-processing": "media-processing", "presigned-download": "signed-object-url", "virus-scan-upload": "upload-quarantine", "orphan-upload-cleanup": "upload-lifecycle", "import-from-url": "remote-file-import",
    "notification": "notification-delivery", "notifications": "notification-delivery", "transactional-email": "email-notification", "email-delivery": "email-notification", "text-message-notification": "sms-notification", "sms-delivery": "sms-notification", "mobile-push": "push-notification", "push-message": "push-notification", "inapp-notification": "in-app-notification", "notification-settings": "notification-preferences", "notification-schedule": "notification-scheduling", "notification-templates": "notification-template", "notification-deduplication": "notification-dedupe", "delivery-status": "delivery-receipts", "outbound-webhook": "webhook-delivery", "webhook": "webhook-delivery", "notification-broadcast": "notification-fanout",
    "analytics": "product-analytics", "product-metrics": "product-analytics", "event-tracking": "instrumentation", "telemetry-plan": "instrumentation", "funnel": "funnel-analysis", "retention": "retention-analysis", "experiment": "experimentation", "a-b-test": "ab-test", "a/b-test": "ab-test", "ab-testing": "ab-test", "feature-flag-rollout": "feature-rollout", "measured-rollout": "feature-rollout", "progressive-delivery": "feature-rollout", "feature-toggle": "feature-flag",
    "onboarding": "user-onboarding", "activation": "user-onboarding", "account-lifecycle": "account-identity", "account-recovery": "account-identity", "workspace-membership": "organization-membership", "team-membership": "organization-membership", "scim": "organization-membership", "support-impersonation": "privileged-support", "break-glass-support": "privileged-support", "proactive-improvement": "product-stewardship",
    "autonomous-product": "repo-autopilot", "repository-autopilot": "repo-autopilot", "product-autopilot": "repo-autopilot", "own-repository": "repo-autopilot", "project-intelligence": "takeover", "repository-intelligence": "takeover", "project-map": "takeover", "project-brain": "takeover", "product-health": "product-stewardship", "health-scan": "product-stewardship", "product-health-scan": "product-stewardship", "repository-health": "product-stewardship",
    "chatgpt-web": "chatgpt-web-host", "web-chat-host": "chatgpt-web-host", "streamed-web-host": "chatgpt-web-host", "interactive-web-host": "chatgpt-web-host", "long-web-session": "chatgpt-web-host", "web-session-stability": "chatgpt-web-host", "tool-heavy-web-session": "chatgpt-web-host",
    "cloud-agent": "foreground-agent", "web-agent": "foreground-agent", "continuous-agent": "foreground-agent", "continuous-web-agent": "foreground-agent", "foreground-autopilot": "foreground-agent", "keep-working-web": "foreground-agent",
    "design-direction": "design-synthesis", "design-concept": "design-synthesis", "ui-concept": "design-synthesis", "mockup": "design-synthesis", "prototype-design": "design-synthesis",
    "product-spec": "product-requirements", "product-specification": "product-requirements", "requirements-engineering": "product-requirements", "requirements-discovery": "requirement-discovery", "story": "user-story", "user-stories": "user-story", "acceptance": "acceptance-criteria", "acceptance-test": "acceptance-criteria", "scoping": "scope-definition",
    "ai": "ai-product", "ai-feature": "ai-product", "genai": "ai-product", "generative-ai": "ai-product", "large-language-model": "llm", "prompt": "prompt-engineering", "retrieval-augmented-generation": "rag", "retrieval-augmented": "rag", "function-calling": "tool-calling", "agentic": "agent-loop", "agent": "agent-loop", "python-agent-system": "python-agent", "python-agentic": "python-agent", "python-multi-agent": "python-agent", "langchain": "python-agent", "langgraph": "python-agent", "autogen": "python-agent", "react-agent": "python-agent", "react-loop": "python-agent", "llm-eval": "model-eval", "ai-eval": "model-eval", "json-output": "structured-output", "schema-output": "structured-output",
}

ROUTES.update({
    "repository-autonomy": ["references/autonomous-repository-engineering.md"],
    "specialist-composition": ["references/cognitive-routing-invariant-compiler.md", "references/autonomous-repository-engineering.md"],
    "batch-mission": ["references/batch-mission-orchestration.md", "references/autonomous-repository-engineering.md", "references/cognitive-routing-invariant-compiler.md"],
    "worker-orchestration": ["references/worker-execution-runtime.md", "references/batch-mission-orchestration.md", "references/autonomous-repository-engineering.md"],
    "plugin-runtime": ["references/plugin-control-plane.md"],
    "hosted-state-backend": ["references/hosted-state-backend-engineering.md"],
    "skill-evolution": ["references/skill-architecture-map.md", "references/dogfood-skill-evolution.md"],
    "skill-source-research": ["references/skill-evolution-sourcebook.md", "references/dogfood-skill-evolution.md"],
})
ALIASES.update({
    "repo-autonomy": "repository-autonomy", "autonomous-repository": "repository-autonomy", "autonomous-engineering": "repository-autonomy",
    "multi-specialist": "specialist-composition", "specialist-routing": "specialist-composition", "handoff-conflict": "specialist-composition",
    "mission-orchestration": "batch-mission", "parallel-agents": "batch-mission", "parallel-workers": "batch-mission",
    "worker-runtime": "worker-orchestration", "worker-supervision": "worker-orchestration",
    "mcp-runtime": "plugin-runtime", "plugin-control-plane": "plugin-runtime",
    "state-backend": "hosted-state-backend", "durable-state-backend": "hosted-state-backend", "postgres-state-backend": "hosted-state-backend", "plugin-state": "hosted-state-backend",
    "skill-maintenance": "skill-evolution", "skill-training": "skill-evolution", "skill-update": "skill-evolution",
})

ROUTES.update({
    "billing-entitlements": ["references/subscription-billing-entitlements-product-engineering.md", "references/payments-ledger-integrity.md", "references/security-multitenancy-patterns.md"],
    "subscription-billing": ["references/subscription-billing-entitlements-product-engineering.md", "references/payments-ledger-integrity.md"],
    "subscription-lifecycle": ["references/subscription-billing-entitlements-product-engineering.md", "references/temporal-debugging-state-transitions.md"],
    "plan-change": ["references/subscription-billing-entitlements-product-engineering.md", "references/payments-ledger-integrity.md"],
    "trial-lifecycle": ["references/subscription-billing-entitlements-product-engineering.md", "references/temporal-debugging-state-transitions.md"],
    "seat-entitlements": ["references/subscription-billing-entitlements-product-engineering.md", "references/security-multitenancy-patterns.md"],
    "usage-metering": ["references/subscription-billing-entitlements-product-engineering.md", "references/async-edge-job-patterns.md", "references/data-consistency-migration-patterns.md"],
    "billing-webhook": ["references/subscription-billing-entitlements-product-engineering.md", "references/payments-ledger-integrity.md", "references/api-backend-patterns.md"],
    "entitlement-projection": ["references/subscription-billing-entitlements-product-engineering.md", "references/data-consistency-migration-patterns.md", "references/security-multitenancy-patterns.md"],
    "subscription-grace-period": ["references/subscription-billing-entitlements-product-engineering.md", "references/temporal-debugging-state-transitions.md"],
    "billing-reconciliation": ["references/subscription-billing-entitlements-product-engineering.md", "references/payments-ledger-integrity.md", "references/data-consistency-migration-patterns.md"],
    "subscription-cancellation": ["references/subscription-billing-entitlements-product-engineering.md", "references/lifecycle-closure-design-to-deletion.md"],
    "subscription-proration": ["references/subscription-billing-entitlements-product-engineering.md", "references/payments-ledger-integrity.md"],
})
ALIASES.update({
    "saas-billing": "subscription-billing", "recurring-billing": "subscription-billing",
    "subscription-plan-change": "plan-change", "upgrade-downgrade": "plan-change",
    "subscription-trial": "trial-lifecycle", "trial-conversion": "trial-lifecycle",
    "seat-management": "seat-entitlements", "seat-billing": "seat-entitlements",
    "metered-billing": "usage-metering", "usage-billing": "usage-metering",
    "subscription-webhook": "billing-webhook", "stripe-subscription-webhook": "billing-webhook",
    "entitlement-read-model": "entitlement-projection",
    "subscription-grace": "subscription-grace-period",
    "subscription-reconciliation": "billing-reconciliation", "invoice-entitlement-reconciliation": "billing-reconciliation",
    "subscription-cancel": "subscription-cancellation", "subscription-prorate": "subscription-proration",
})

# Debugging/regression language is normalized to the diagnostic owner. Review may
# discover the problem, but once a live failure is being causally investigated the
# next decision belongs to debugging rather than remaining in review.
ALIASES.update({
    "debug": "bug",
    "debugging": "bug",
    "regression": "bug",
    "regression-debug": "bug",
    "regression-debugging": "bug",
})

# The 22 entries below close a reachability gap found by an audit equivalent to
# reference_owner_audit.py: these reference files existed on disk but were never
# named by SKILL.md, ROUTES/ALIASES, stack_fingerprint.py, or any other reference
# file's own links, so no selector could ever surface them regardless of signals.
# Wiring them in does not change their content, only whether they are reachable.
ROUTES.update({
    # Embedded browser-container / multi-service remote integration (Electron-style products embedding third-party web services, e.g. a multi-account chat client)
    "embedded-browser-service": ["references/integration-onboarding-patterns.md", "references/embedded-remote-service-patterns.md"],
    "multi-account-client": ["references/integration-onboarding-patterns.md", "references/embedded-remote-service-patterns.md"],
    "webcontents-lifecycle": ["references/embedded-remote-service-patterns.md", "references/resource-lifecycle-patterns.md"],
    "remote-service-compat": ["references/remote-service-compatibility-patterns.md"],
    "vendor-bootstrap-drift": ["references/remote-service-compatibility-patterns.md", "references/embedded-remote-service-patterns.md"],
    "multi-service-resource-policy": ["references/resource-lifecycle-patterns.md"],
    "multi-service-observability": ["references/observability-support-patterns.md"],
    "embedded-web-research": ["references/upstream-research-playbook.md"],

    # Git/history and recurring-failure pattern recognition
    "git-history": ["references/git-archaeology-maintenance.md"],
    "failure-pattern": ["references/failure-memory-antipatterns.md"],

    # Judgment/restraint is universal, not a single mechanism, so it is routed rather than CORE-loaded (CORE stays empty per the router's own integrity gate)
    "judgment": ["references/veteran-engineering-judgment.md"],
    "restraint": ["references/veteran-engineering-judgment.md"],
    "complexity-budget": ["references/veteran-engineering-judgment.md"],

    # Deep systems / infrastructure verticals
    "consensus": ["references/consensus-coordination-engineering.md"],
    "capacity-planning": ["references/capacity-overload-engineering.md"],
    "data-platform": ["references/data-platform-olap-scheduling.md"],
    "database-recovery": ["references/database-recovery-durability.md"],
    "global-traffic": ["references/global-traffic-cell-architecture.md"],
    "linux-networking": ["references/linux-network-runtime-engineering.md"],
    "gc-tuning": ["references/managed-runtime-gc-engineering.md"],
    "mega-migration": ["references/mega-migration-zero-downtime.md"],
    "disaster-recovery": ["references/resilience-dr-multiregion.md"],
    "noisy-neighbor": ["references/saas-isolation-noisy-neighbor.md"],
    "stream-processing": ["references/stream-processing-event-sourcing.md"],
    "connection-storm": ["references/transport-connection-engineering.md"],
})
ALIASES.update({
    # Embedded browser-container / multi-service remote integration
    "electron-embedded-service": "embedded-browser-service",
    "webview-container": "embedded-browser-service",
    "multi-account-app": "multi-account-client",
    "guest-webcontents": "webcontents-lifecycle",
    "browser-compat": "remote-service-compat",
    "vendor-drift": "vendor-bootstrap-drift",
    "service-throttling": "multi-service-resource-policy",
    "background-throttling": "multi-service-resource-policy",
    "support-bundle": "multi-service-observability",
    "diagnostic-bundle": "multi-service-observability",

    # Git/history and recurring-failure pattern recognition
    "hotspot-analysis": "git-history",
    "code-ownership-history": "git-history",
    "known-antipattern": "failure-pattern",
    "recurring-bug": "failure-pattern",
    "antipattern": "failure-pattern",

    # Judgment/restraint
    "over-engineering": "restraint",
    "gold-plating": "restraint",
    "unnecessary-abstraction": "restraint",
    "scope-creep": "complexity-budget",
    "second-order-effects": "judgment",
    "engineering-judgment": "judgment",

    # Deep systems / infrastructure verticals
    "leader-election": "consensus",
    "distributed-lock": "consensus",
    "split-brain": "consensus",
    "quorum": "consensus",
    "raft": "consensus",
    "paxos": "consensus",
    "overload": "capacity-planning",
    "load-shedding": "capacity-planning",
    "queueing-theory": "capacity-planning",
    "saturation": "capacity-planning",
    "backlog": "capacity-planning",
    "olap": "data-platform",
    "data-warehouse": "data-platform",
    "data-lake": "data-platform",
    "batch-scheduling": "data-platform",
    "airflow": "data-platform",
    "wal": "database-recovery",
    "backup-restore": "database-recovery",
    "point-in-time-recovery": "database-recovery",
    "crash-recovery": "database-recovery",
    "replica-promotion": "database-recovery",
    "cell-architecture": "global-traffic",
    "multi-region-routing": "global-traffic",
    "anycast": "global-traffic",
    "active-active": "global-traffic",
    "dns-tls": "linux-networking",
    "works-locally": "linux-networking",
    "iptables": "linux-networking",
    "conntrack": "linux-networking",
    "jit-warmup": "gc-tuning",
    "memory-pressure": "gc-tuning",
    "jvm-gc": "gc-tuning",
    "v8-gc": "gc-tuning",
    "heap-growth": "gc-tuning",
    "event-loop-lag": "gc-tuning",
    "large-scale-migration": "mega-migration",
    "live-migration": "mega-migration",
    "zero-downtime-migration": "mega-migration",
    "multi-region": "disaster-recovery",
    "high-availability": "disaster-recovery",
    "failover": "disaster-recovery",
    "dr-failover": "disaster-recovery",
    "region-failover": "disaster-recovery",
    "saas-isolation": "noisy-neighbor",
    "tenant-isolation-infra": "noisy-neighbor",
    "shared-cluster-isolation": "noisy-neighbor",
    "event-sourcing": "stream-processing",
    "cqrs": "stream-processing",
    "kafka-streams": "stream-processing",
    "flink": "stream-processing",
    "event-sourced": "stream-processing",
    "tcp-tls": "connection-storm",
    "retry-storm": "connection-storm",
    "tls-handshake": "connection-storm",
    "connection-reset": "connection-storm",
    "retry-amplification": "connection-storm",
})


# Multi-signal arbitration is intentionally separate from ROUTES. ROUTES says
# which knowledge owns a signal; these sets say which process stage owns the
# *next decision* when several valid signals coexist. Domain/risk signals that
# are not listed here remain active companions to the selected stage owner.
INCIDENT_SIGNALS = {"incident"}
REVIEW_SIGNALS = {"review", "final-review", "audit", "design-review", "security-review", "validation"}
DIAGNOSTIC_SIGNALS = {"bug", "causality", "assumption"}
ANALYSIS_SIGNALS = {
    "product-analysis", "product-research", "competitor-analysis", "product-teardown",
    "behavior-analysis", "black-box-analysis", "product-diff", "capability-map",
    "product-network-analysis", "technical-fingerprint",
}
REQUIREMENTS_SIGNALS = {
    "requirements", "product-requirements", "prd", "user-story", "acceptance-criteria",
    "requirement-discovery", "scope-definition", "scope",
}
DESIGN_SIGNALS = {
    "ui", "ux", "product-design", "experience-design", "visual-design", "ui-redesign",
    "design-polish", "interaction-design", "wireframe", "design-system", "responsive-design",
    "visual-system", "design-governance", "design-versioning", "design-authority",
    "desktop-ui", "desktop-ui-redesign", "desktop-shell-ui", "desktop-shell-redesign",
    "agentic-desktop", "agentic-desktop-redesign", "mobile-design", "website",
    "design-synthesis", "visual-concept", "code-native-design",
}
TECHNICAL_SIGNALS = {
    "architecture", "architecture-fitness", "refactor", "codemod", "large-refactor",
    "migration", "modernization", "takeover", "repo-autopilot", "foreground-agent", "monorepo", "multi-repo", "cross-repo",
}
# These are explicit stage-advance signals. In particular, fullstack/cross-layer/
# delivery/feature can advance an already-defined design into implementation.
IMPLEMENTATION_GATE_SIGNALS = {"fullstack", "cross-layer", "delivery", "feature"}
IMPLEMENTATION_CONTEXT_SIGNALS = {
    "frontend", "frontend-style", "api", "mobile", "ios", "android", "react-native", "expo", "flutter",
    "desktop", "electron", "desktop-runtime", "desktop-shell", "electron-ipc",
    "browser-extension", "chrome-extension", "firefox-extension", "webextension",
    "cli", "tui", "sdk", "library", "client-library", "python-agent", "database", "async-job", "queue",
}
IMPLEMENTATION_SIGNALS = IMPLEMENTATION_GATE_SIGNALS | IMPLEMENTATION_CONTEXT_SIGNALS
RELEASE_SIGNALS = {
    "release", "deployment", "iac", "terraform", "cloud-infra", "desktop-packaging", "extension-store",
    "cli-release", "package-publishing", "feature-rollout",
}
STAGE_SIGNALS = (
    INCIDENT_SIGNALS | REVIEW_SIGNALS | DIAGNOSTIC_SIGNALS | ANALYSIS_SIGNALS |
    REQUIREMENTS_SIGNALS | DESIGN_SIGNALS | TECHNICAL_SIGNALS | IMPLEMENTATION_SIGNALS |
    RELEASE_SIGNALS
)


def signal_stage(signal: str) -> str | None:
    if signal in INCIDENT_SIGNALS:
        return "incident"
    if signal in REVIEW_SIGNALS:
        return "review"
    if signal in DIAGNOSTIC_SIGNALS:
        return "diagnostic"
    if signal in ANALYSIS_SIGNALS:
        return "analysis"
    if signal in REQUIREMENTS_SIGNALS:
        return "requirements"
    if signal in DESIGN_SIGNALS:
        return "design"
    if signal in TECHNICAL_SIGNALS:
        return "technical"
    if signal in IMPLEMENTATION_SIGNALS:
        return "implementation"
    if signal in RELEASE_SIGNALS:
        return "release"
    return None


def _first_matching(signals: list[str], members: set[str]) -> str | None:
    return next((signal for signal in signals if signal in members), None)


def choose_primary_signal(signals: list[str]) -> tuple[str | None, str | None]:
    """Choose the owner of the next decision, not every relevant domain.

    Incident/diagnostic/review lanes are hard current-work gates. Requirements and
    analysis block downstream mutation. Design remains primary unless an explicit
    implementation-gate signal says the accepted design is now being implemented.
    Technical contract work blocks implementation/release. Release wins over a
    generic implementation context once no earlier contract stage remains open.
    """
    if not signals:
        return None, None

    for members, stage in (
        (INCIDENT_SIGNALS, "incident"),
        (DIAGNOSTIC_SIGNALS, "diagnostic"),
        (REVIEW_SIGNALS, "review"),
    ):
        match = _first_matching(signals, members)
        if match:
            return match, stage

    analysis = _first_matching(signals, ANALYSIS_SIGNALS)
    requirements = _first_matching(signals, REQUIREMENTS_SIGNALS)
    if analysis or requirements:
        candidates = [s for s in signals if s in ANALYSIS_SIGNALS or s in REQUIREMENTS_SIGNALS]
        primary = candidates[0]
        return primary, signal_stage(primary)

    design = _first_matching(signals, DESIGN_SIGNALS)
    implementation_gate = _first_matching(signals, IMPLEMENTATION_GATE_SIGNALS)
    technical = _first_matching(signals, TECHNICAL_SIGNALS)
    if design:
        # Preserve the established stage-advance contract: an explicit generic
        # implementation signal means the design is accepted context for coding.
        if implementation_gate and not technical:
            return implementation_gate, "implementation"
        return design, "design"

    if technical:
        return technical, "technical"

    if implementation_gate:
        return implementation_gate, "implementation"

    release = _first_matching(signals, RELEASE_SIGNALS)
    if release:
        return release, "release"

    implementation_context = _first_matching(signals, IMPLEMENTATION_CONTEXT_SIGNALS)
    if implementation_context:
        return implementation_context, "implementation"

    return signals[0], signal_stage(signals[0])


def should_defer_signal(signal: str, primary_signal: str | None, primary_stage: str | None) -> bool:
    if not primary_signal or signal == primary_signal:
        return False
    stage = signal_stage(signal)
    if stage is None:
        return False
    # Diagnostics/incident response need the failing mechanism in the same working
    # set, even when that mechanism is normally an implementation/release stage.
    if primary_stage in {"incident", "diagnostic"}:
        return False
    if primary_stage in {"analysis", "requirements"}:
        return stage in {"design", "technical", "implementation", "review", "release"}
    if primary_stage == "design":
        return stage in {"technical", "implementation", "review", "release"}
    if primary_stage == "technical":
        return stage in {"implementation", "review", "release"}
    if primary_stage == "implementation":
        return stage in {"review", "release"}
    if primary_stage == "review":
        return stage in {"analysis", "requirements", "design", "technical", "implementation", "release"}
    if primary_stage == "release":
        return stage in {"analysis", "requirements", "design", "technical", "implementation", "review"}
    return False

def split_csv(value: str) -> list[str]:
    out, seen = [], set()
    for item in value.split(","):
        item = item.strip().lower()
        if not item:
            continue
        canonical = ALIASES.get(item, item)
        if canonical in seen:
            continue
        seen.add(canonical)
        out.append(canonical)
    return out

def reference_size_bytes(ref: str) -> int:
    try:
        return (SKILL_ROOT / ref).stat().st_size
    except OSError:
        return 0


WEB_HOST_DEFAULT_MAX_REFS = 4
WEB_HOST_DEFAULT_MAX_BYTES = 49152
STANDARD_DEFAULT_MAX_REFS = 7


def route_signals(value: str, max_refs: int | None = None, max_bytes: int | None = None) -> dict:
    signals = split_csv(value)
    primary_signal, primary_stage = choose_primary_signal(signals)
    active_signals = [signal for signal in signals if not should_defer_signal(signal, primary_signal, primary_stage)]
    stage_deferred_signals = [signal for signal in signals if signal not in active_signals]

    # Put the selected owner first without mutating the normalized input signal list.
    if primary_signal in active_signals:
        active_signals = [primary_signal] + [signal for signal in active_signals if signal != primary_signal]

    active_refs, active_reasons = [], {}
    future_refs, future_reasons = [], {}

    def add(target: list[str], reasons: dict[str, list[str]], ref: str, why: str) -> None:
        if ref not in target:
            target.append(ref)
            reasons.setdefault(ref, []).append(why)
        elif why not in reasons[ref]:
            reasons[ref].append(why)

    for ref in CORE:
        add(active_refs, active_reasons, ref, "core")

    unmatched = []
    for signal in signals:
        if signal not in ROUTES:
            unmatched.append(signal)

    for signal in active_signals:
        routed = ROUTES.get(signal)
        if not routed:
            continue
        for ref in routed:
            add(active_refs, active_reasons, ref, signal)

    for signal in stage_deferred_signals:
        routed = ROUTES.get(signal)
        if not routed:
            continue
        for ref in routed:
            if ref in active_refs:
                continue
            add(future_refs, future_reasons, ref, signal)

    # Compose process + platform specialists without letting a generic host noun
    # displace the user-facing design outcome. If generic desktop/electron context
    # is deferred while design is current, expose only the desktop experience owner;
    # native shell/runtime stays queued until its stage becomes current.
    generic_desktop_signals = {"desktop", "electron"}
    if DESIGN_SIGNALS.intersection(signals) and generic_desktop_signals.intersection(signals):
        for ref in (
            "references/frontend-product-patterns.md",
            "references/desktop-product-experience.md",
        ):
            add(active_refs, active_reasons, ref, "composed-desktop-design")
        explicit_platform = {"desktop-runtime", "desktop-shell", "desktop-shell-ui", "desktop-shell-redesign", "electron-ipc", "desktop-packaging"}
        if not explicit_platform.intersection(signals):
            drop = {"references/runtime-lifecycle-patterns.md", "references/host-shell-platform-patterns.md"}
            active_refs[:] = [r for r in active_refs if r not in drop]
            for r in drop:
                active_reasons.pop(r, None)

    web_lean = bool({"chatgpt-web-host", "foreground-agent"}.intersection(signals))
    explicit_budget = (max_refs is not None and max_refs > 0) or (max_bytes is not None and max_bytes > 0)
    if web_lean and not explicit_budget:
        limit = WEB_HOST_DEFAULT_MAX_REFS
        byte_limit = WEB_HOST_DEFAULT_MAX_BYTES
    else:
        limit = max(1, max_refs) if max_refs is not None and max_refs > 0 else STANDARD_DEFAULT_MAX_REFS
        byte_limit = max_bytes if max_bytes is not None and max_bytes > 0 else None
    selected, budget_deferred = [], []
    selected_bytes = 0
    deferred_reason = {}
    for ref in active_refs:
        size = reference_size_bytes(ref)
        if len(selected) >= limit:
            budget_deferred.append(ref)
            deferred_reason[ref] = "budget"
            continue
        # Always retain the first/current owner even when that single reference is
        # larger than the byte budget. Additional references are progressively
        # disclosed only while the active working set remains inside the budget.
        if byte_limit is not None and selected and selected_bytes + size > byte_limit:
            budget_deferred.append(ref)
            deferred_reason[ref] = "bytes"
            continue
        selected.append(ref)
        selected_bytes += size

    deferred_refs, deferred_meta = [], {}
    for ref in budget_deferred:
        if ref in selected:
            continue
        deferred_refs.append(ref)
        deferred_meta[ref] = {"reasons": active_reasons[ref], "deferred_by": deferred_reason[ref]}
    for ref in future_refs:
        if ref in selected or ref in deferred_meta:
            continue
        deferred_refs.append(ref)
        deferred_meta[ref] = {"reasons": future_reasons[ref], "deferred_by": "stage"}

    primary_route_references = list(ROUTES.get(primary_signal, [])) if primary_signal else []

    return {
        "signals": signals,
        "primary_signal": primary_signal,
        "primary_stage": primary_stage,
        "primary_reference": primary_route_references[0] if primary_route_references else None,
        "primary_route_references": primary_route_references,
        "active_signals": active_signals,
        "deferred_signals": [
            {"signal": signal, "stage": signal_stage(signal), "reason": f"current owner is {primary_stage or 'domain'}"}
            for signal in stage_deferred_signals
        ],
        "references": [{"path": r, "reasons": active_reasons[r], "bytes": reference_size_bytes(r)} for r in selected],
        "deferred_references": [
            {"path": r, "reasons": deferred_meta[r]["reasons"], "deferred_by": deferred_meta[r]["deferred_by"], "bytes": reference_size_bytes(r)}
            for r in deferred_refs
        ],
        "context_profile": "web-lean" if web_lean and not explicit_budget else "explicit" if explicit_budget else "standard",
        "route_budget": limit,
        "route_byte_budget": byte_limit,
        "selected_reference_bytes": selected_bytes,
        "active_candidate_bytes": sum(reference_size_bytes(r) for r in active_refs),
        "active_candidate_count": len(active_refs),
        "candidate_count": len(set(active_refs + future_refs)),
        "unmatched_signals": unmatched,
        "truncated": bool(budget_deferred),
        "has_deferred": bool(deferred_refs),
        "note": "Routing aid only. The primary signal owns the next decision. Keep only decision-relevant current-stage companions active; references deferred by stage, count, or bytes remain available and should be loaded only when their mechanism becomes current. Diagnostics keep failing mechanisms logically active even when byte pressure requires sequential disclosure.",
    }


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--signals", required=True, help="Comma-separated explicit task/mechanism/risk signals")
    p.add_argument("--max", type=int, default=0, dest="max_refs", help="Active-reference count budget; 0 uses the host-aware default")
    p.add_argument("--max-bytes", type=int, default=0, dest="max_bytes", help="Active-reference byte budget; 0 uses the host-aware default (standard=unbounded, ChatGPT web=48 KiB)")
    p.add_argument("--json", action="store_true")
    a = p.parse_args()
    payload = route_signals(
        a.signals,
        None if a.max_refs <= 0 else a.max_refs,
        None if a.max_bytes <= 0 else a.max_bytes,
    )
    if a.json:
        print(json.dumps(payload, indent=2, sort_keys=True))
    else:
        print("# Engineering context route")
        print("signals:", ", ".join(payload["signals"]) or "none")
        print("primary:", payload["primary_signal"] or "none", f"[{payload['primary_stage'] or 'domain'}]")
        for item in payload["references"]:
            print(f"- {item['path']} [{','.join(item['reasons'])}]")
        if payload["unmatched_signals"]:
            print("unmatched:", ", ".join(payload["unmatched_signals"]))
        if payload["deferred_references"]:
            print("deferred:", ", ".join(item["path"] for item in payload["deferred_references"]))
            print("note: deferred owners remain unloaded until their stage/budget boundary becomes current")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())

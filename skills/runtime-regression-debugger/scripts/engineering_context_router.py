#!/usr/bin/env python3
"""Suggest a small set of skill references from explicit engineering signals.

This is a deterministic routing aid, not a classifier or correctness proof.
Example:
  engineering_context_router.py --signals bug,async,frontend,lifecycle
"""
from __future__ import annotations
import argparse, json

CORE = [
    "references/autonomous-repository-engineering.md",
    "references/cognitive-routing-invariant-compiler.md",
]
ROUTES = {
    "bug": ["references/decision-compression-learning-loop.md", "references/causal-debugging-experiment-design.md"],
    "fullstack": ["references/full-stack-product-engineering.md"],
    "cross-layer": ["references/full-stack-product-engineering.md"],
    "takeover": ["references/project-takeover-engineering.md"],
    "monorepo": ["references/project-takeover-engineering.md", "references/staff-engineering-execution.md"],
    "workspace": ["references/project-takeover-engineering.md"],
    "frontend": ["references/frontend-product-patterns.md"],
    "ui": ["references/frontend-product-patterns.md"],
    "ux": ["references/frontend-product-patterns.md"],
    "product-design": ["references/frontend-product-patterns.md", "references/full-stack-product-engineering.md"],
    "visual-design": ["references/frontend-product-patterns.md"],
    "interaction-design": ["references/frontend-product-patterns.md"],
    "wireframe": ["references/frontend-product-patterns.md"],
    "design-system": ["references/frontend-product-patterns.md"],
    "responsive-design": ["references/frontend-product-patterns.md"],
    "mobile": ["references/mobile-product-engineering.md", "references/full-stack-product-engineering.md"],
    "ios": ["references/mobile-product-engineering.md"],
    "android": ["references/mobile-product-engineering.md"],
    "react-native": ["references/mobile-product-engineering.md", "references/frontend-product-patterns.md"],
    "expo": ["references/mobile-product-engineering.md", "references/frontend-product-patterns.md"],
    "flutter": ["references/mobile-product-engineering.md"],
    "mobile-design": ["references/mobile-product-engineering.md", "references/frontend-product-patterns.md"],
    "deep-link": ["references/mobile-product-engineering.md"],
    "push-notification": ["references/mobile-product-engineering.md", "references/async-edge-job-patterns.md"],
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
    "content-script": ["references/browser-extension-product-engineering.md", "references/frontend-product-patterns.md"],
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
    "globalization": ["references/globalization-product-engineering.md", "references/full-stack-product-engineering.md"],
    "internationalization": ["references/globalization-product-engineering.md"],
    "localization": ["references/globalization-product-engineering.md"],
    "rtl": ["references/globalization-product-engineering.md", "references/frontend-product-patterns.md"],
    "bidi": ["references/globalization-product-engineering.md", "references/frontend-product-patterns.md"],
    "ime": ["references/globalization-product-engineering.md", "references/frontend-product-patterns.md"],
    "timezone": ["references/globalization-product-engineering.md", "references/temporal-debugging-state-transitions.md"],
    "locale-formatting": ["references/globalization-product-engineering.md"],
    "unicode-input": ["references/globalization-product-engineering.md", "references/frontend-product-patterns.md"],
    "accessibility": ["references/accessibility-product-engineering.md", "references/full-stack-product-engineering.md"],
    "screen-reader": ["references/accessibility-product-engineering.md", "references/frontend-product-patterns.md"],
    "keyboard-navigation": ["references/accessibility-product-engineering.md", "references/frontend-product-patterns.md"],
    "focus-management": ["references/accessibility-product-engineering.md", "references/frontend-product-patterns.md"],
    "reduced-motion": ["references/accessibility-product-engineering.md", "references/frontend-product-patterns.md"],
    "high-contrast": ["references/accessibility-product-engineering.md", "references/frontend-product-patterns.md"],
    "assistive-technology": ["references/accessibility-product-engineering.md"],
    "accessible-form": ["references/accessibility-product-engineering.md", "references/frontend-product-patterns.md"],
    "aria": ["references/accessibility-product-engineering.md", "references/frontend-product-patterns.md"],
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
    "collaboration": ["references/collaboration-realtime-product-engineering.md", "references/full-stack-product-engineering.md"],
    "realtime-collaboration": ["references/collaboration-realtime-product-engineering.md", "references/distributed-systems-consistency.md", "references/async-edge-job-patterns.md"],
    "presence": ["references/collaboration-realtime-product-engineering.md", "references/temporal-debugging-state-transitions.md"],
    "shared-state": ["references/collaboration-realtime-product-engineering.md", "references/distributed-systems-consistency.md"],
    "collaborative-editing": ["references/collaboration-realtime-product-engineering.md", "references/data-consistency-migration-patterns.md"],
    "optimistic-reconciliation": ["references/collaboration-realtime-product-engineering.md", "references/frontend-product-patterns.md", "references/data-consistency-migration-patterns.md"],
    "offline-collaboration": ["references/collaboration-realtime-product-engineering.md", "references/distributed-systems-consistency.md"],
    "realtime-permissions": ["references/collaboration-realtime-product-engineering.md", "references/security-multitenancy-patterns.md"],
    "reconnect-recovery": ["references/collaboration-realtime-product-engineering.md", "references/temporal-debugging-state-transitions.md"],
    "event-ordering": ["references/collaboration-realtime-product-engineering.md", "references/distributed-systems-consistency.md"],
    "collaboration-backpressure": ["references/collaboration-realtime-product-engineering.md", "references/performance-scale-patterns.md"],
    "file-upload": ["references/file-upload-media-product-engineering.md", "references/security-multitenancy-patterns.md"],
    "resumable-upload": ["references/file-upload-media-product-engineering.md", "references/data-movement-cdc-search-storage.md"],
    "multipart-upload": ["references/file-upload-media-product-engineering.md", "references/data-movement-cdc-search-storage.md"],
    "attachment-flow": ["references/file-upload-media-product-engineering.md", "references/full-stack-product-engineering.md"],
    "object-delivery": ["references/file-upload-media-product-engineering.md", "references/security-multitenancy-patterns.md"],
    "media-processing": ["references/file-upload-media-product-engineering.md", "references/async-edge-job-patterns.md"],
    "signed-object-url": ["references/file-upload-media-product-engineering.md", "references/security-multitenancy-patterns.md"],
    "upload-quarantine": ["references/file-upload-media-product-engineering.md", "references/security-multitenancy-patterns.md"],
    "upload-lifecycle": ["references/file-upload-media-product-engineering.md", "references/lifecycle-closure-design-to-deletion.md"],
    "remote-file-import": ["references/file-upload-media-product-engineering.md", "references/security-multitenancy-patterns.md", "references/dependency-outcome-degradation.md"],
    "product-analysis": ["references/product-analysis-engineering.md", "references/full-stack-product-engineering.md"],
    "product-research": ["references/product-analysis-engineering.md"],
    "competitor-analysis": ["references/product-analysis-engineering.md", "references/full-stack-product-engineering.md"],
    "product-teardown": ["references/product-analysis-engineering.md"],
    "behavior-analysis": ["references/product-analysis-engineering.md"],
    "black-box-analysis": ["references/product-analysis-engineering.md"],
    "product-diff": ["references/product-analysis-engineering.md"],
    "capability-map": ["references/product-analysis-engineering.md"],
    "product-network-analysis": ["references/product-analysis-engineering.md", "references/api-backend-patterns.md"],
    "technical-fingerprint": ["references/product-analysis-engineering.md"],
    "product-improvement": ["references/product-analytics-experimentation.md", "references/full-stack-product-engineering.md"],
    "product-analytics": ["references/product-analytics-experimentation.md"],
    "instrumentation": ["references/product-analytics-experimentation.md", "references/full-stack-product-engineering.md"],
    "funnel-analysis": ["references/product-analytics-experimentation.md"],
    "retention-analysis": ["references/product-analytics-experimentation.md"],
    "experimentation": ["references/product-analytics-experimentation.md", "references/full-stack-product-engineering.md"],
    "ab-test": ["references/product-analytics-experimentation.md"],
    "feature-rollout": ["references/product-analytics-experimentation.md", "references/operability-control-plane-contract.md"],
    "product-requirements": ["references/product-requirements-engineering.md", "references/full-stack-product-engineering.md"],
    "prd": ["references/product-requirements-engineering.md", "references/full-stack-product-engineering.md"],
    "user-story": ["references/product-requirements-engineering.md"],
    "acceptance-criteria": ["references/product-requirements-engineering.md", "references/engineering-evidence-gates.md"],
    "requirement-discovery": ["references/product-requirements-engineering.md", "references/product-analysis-engineering.md"],
    "scope-definition": ["references/product-requirements-engineering.md"],
    "ai-product": ["references/ai-llm-product-engineering.md", "references/full-stack-product-engineering.md"],
    "llm": ["references/ai-llm-product-engineering.md"],
    "prompt-engineering": ["references/ai-llm-product-engineering.md"],
    "rag": ["references/ai-llm-product-engineering.md", "references/search-relevance-serving.md"],
    "tool-calling": ["references/ai-llm-product-engineering.md", "references/api-backend-patterns.md"],
    "agent-loop": ["references/ai-llm-product-engineering.md", "references/async-edge-job-patterns.md"],
    "model-eval": ["references/ai-llm-product-engineering.md", "references/engineering-evidence-gates.md"],
    "structured-output": ["references/ai-llm-product-engineering.md"],
    "lifecycle": ["references/temporal-debugging-state-transitions.md", "references/runtime-lifecycle-patterns.md"],
    "async": ["references/temporal-debugging-state-transitions.md", "references/async-edge-job-patterns.md"],
    "concurrency": ["references/temporal-debugging-state-transitions.md", "references/causal-debugging-experiment-design.md", "references/distributed-systems-consistency.md"],
    "api": ["references/api-backend-patterns.md"],
    "auth": ["references/security-multitenancy-patterns.md"],
    "tenant": ["references/security-multitenancy-patterns.md"],
    "database": ["references/database-internals-query-engineering.md"],
    "migration": ["references/data-consistency-migration-patterns.md", "references/change-entropy-rollback-paradox.md"],
    "queue": ["references/stack-messaging-workflows.md"],
    "payment": ["references/payments-ledger-integrity.md", "references/change-entropy-rollback-paradox.md"],
    "performance": ["references/performance-scale-patterns.md"],
    "incident": ["references/incident-command-uncertainty.md"],
    "release": ["references/release-promotion-patterns.md", "references/infrastructure-deployment-patterns.md", "references/change-entropy-rollback-paradox.md", "references/operations-reliability-patterns.md"],
    "iac": ["references/infrastructure-deployment-patterns.md", "references/change-entropy-rollback-paradox.md"],
    "terraform": ["references/infrastructure-deployment-patterns.md"],
    "cloud-infra": ["references/infrastructure-deployment-patterns.md", "references/operability-control-plane-contract.md"],
    "review": ["references/code-review-patterns.md", "references/semantic-diff-behavior-change.md", "references/negative-space-patch-compression.md"],
    "refactor": ["references/architecture-refactoring-patterns.md", "references/negative-space-patch-compression.md"],
    "codemod": ["references/architecture-refactoring-patterns.md", "references/project-takeover-engineering.md"],
    "large-refactor": ["references/architecture-refactoring-patterns.md", "references/staff-engineering-execution.md"],
    "rollback": ["references/change-entropy-rollback-paradox.md"],
    "compatibility": ["references/change-entropy-rollback-paradox.md"],
    "causality": ["references/causal-debugging-experiment-design.md"],
    "semantic-diff": ["references/semantic-diff-behavior-change.md"],
    "validation": ["references/engineering-evidence-gates.md", "references/mutation-metamorphic-regression-testing.md"],
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
    "dependency": ["references/dependency-outcome-degradation.md"],
    "external": ["references/dependency-outcome-degradation.md"],
    "architecture": ["references/architecture-refactoring-patterns.md", "references/architecture-fitness-assumption-decay.md"],
    "architecture-fitness": ["references/architecture-fitness-assumption-decay.md"],
    "fitness": ["references/architecture-fitness-assumption-decay.md"],
    "delivery": ["references/full-stack-product-engineering.md"],
    "feature": ["references/full-stack-product-engineering.md"],
    "closure": ["references/full-stack-product-engineering.md", "references/lifecycle-closure-design-to-deletion.md"],
    "deletion": ["references/lifecycle-closure-design-to-deletion.md"],
    "multi-repo": ["references/cross-repo-contract-mesh.md", "references/staff-engineering-execution.md"],
    "cross-repo": ["references/cross-repo-contract-mesh.md", "references/staff-engineering-execution.md"],
    "requirements": ["references/product-requirements-engineering.md", "references/full-stack-product-engineering.md"],
    "scope": ["references/product-requirements-engineering.md", "references/full-stack-product-engineering.md"],
    "navigation": ["references/project-takeover-engineering.md"],
    "search": ["references/project-takeover-engineering.md"],
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
    "publish": "release", "publishing": "release", "github-release": "release", "release-tag": "release", "autopublish": "release", "auto-publish": "release", "deployment": "release", "deploy": "release", "monorepository": "monorepo", "workspaces": "workspace", "ast-refactor": "codemod", "mass-refactor": "large-refactor", "infrastructure-as-code": "iac", "opentofu": "terraform", "pulumi": "iac", "full-stack": "fullstack", "full_stack": "fullstack", "crosslayer": "cross-layer", "vertical-slice": "delivery", "end-to-end": "delivery", "requirement": "requirements", "repo-search": "navigation", "code-search": "navigation", "generated-code": "generated", "code-generation": "codegen", "final-audit": "final-review", "db": "database", "payments": "payment", "jobs": "queue", "race": "concurrency", "cause": "causality", "fsm": "state-machine", "state": "state-machine", "test": "validation", "tests": "validation", "proof": "evidence", "provider": "dependency", "vendor": "dependency", "retire": "deletion", "multirepo": "multi-repo", "kafka": "broker", "rabbitmq": "broker", "2pc": "distributed-transaction", "saga": "distributed-transaction", "ebpf": "profiling", "bpftrace": "profiling", "slo": "error-budget", "decommission": "simplification", "rescue": "system-rescue", "interface-design": "ui", "ui-design": "ui", "screen-design": "ui", "ux-design": "ux", "product-designer": "product-design", "design-tokens": "design-system", "responsive-ui": "responsive-design", "mobile-app": "mobile", "app-development": "mobile", "native-app": "mobile", "reactnative": "react-native", "rn": "react-native", "expo-app": "expo", "dart-flutter": "flutter", "swift": "ios", "swiftui": "ios", "iphone": "ios", "ipad": "ios", "kotlin-android": "android", "jetpack-compose": "android", "deeplink": "deep-link", "deep-linking": "deep-link", "universal-link": "deep-link", "app-link": "deep-link", "push-notifications": "push-notification", "offline-mobile": "mobile-offline", "product-intelligence": "product-analysis", "competitive-analysis": "competitor-analysis", "competitor-research": "competitor-analysis", "blackbox-analysis": "black-box-analysis", "black-box-research": "black-box-analysis", "product-comparison": "competitor-analysis", "product-version-diff": "product-diff", "feature-map": "capability-map", "api-observation": "product-network-analysis", "technology-fingerprint": "technical-fingerprint",
    "desktop-app": "desktop", "desktop-application": "desktop", "electronjs": "electron", "electron-app": "electron", "electron-main": "desktop-runtime", "electron-preload": "desktop-runtime", "electron-renderer": "electron", "electron-builder": "desktop-packaging", "electron-forge": "desktop-packaging", "electron-ipc-main": "electron-ipc",
    "browser-addon": "browser-extension", "chrome-addon": "chrome-extension", "firefox-addon": "firefox-extension", "web-extension": "webextension", "manifest-v3": "extension-manifest", "mv3": "extension-manifest", "extension-service-worker": "extension-background", "host-permissions": "extension-permissions", "chrome-web-store": "extension-store", "addons-mozilla-org": "extension-store",
    "command-line-interface": "cli", "command-line-tool": "cli", "developer-cli": "cli", "terminal-ui": "tui", "terminal-user-interface": "tui", "cli-args": "cli-arguments", "cli-flags": "cli-arguments", "cli-configuration": "cli-config", "cli-json-output": "cli-output", "cli-packaging": "cli-release", "command-completion": "shell-completion",
    "software-development-kit": "sdk", "client-sdk": "sdk", "developer-sdk": "sdk", "reusable-library": "library", "api-client-library": "client-library", "public-api-surface": "public-library-api", "semantic-versioning": "semver", "package-entrypoints": "package-exports", "package-exports-map": "package-exports", "sdk-generation": "generated-sdk", "generated-client-sdk": "generated-sdk", "peer-dependencies": "library-dependencies", "library-publishing": "package-publishing", "package-registry-release": "package-publishing", "library-deprecation-policy": "library-deprecation",
    "i18n": "internationalization", "internationalisation": "internationalization", "l10n": "localization", "localisation": "localization", "right-to-left": "rtl", "bidirectional-text": "bidi", "bidi-text": "bidi", "input-method-editor": "ime", "ime-composition": "ime", "time-zone": "timezone", "timezone-handling": "timezone", "locale-aware-formatting": "locale-formatting", "number-formatting": "locale-formatting", "currency-formatting": "locale-formatting", "unicode-text-input": "unicode-input",
    "a11y": "accessibility", "screenreader": "screen-reader", "keyboard-accessibility": "keyboard-navigation", "focus-trap": "focus-management", "prefers-reduced-motion": "reduced-motion", "forced-colors": "high-contrast", "assistive-tech": "assistive-technology", "form-accessibility": "accessible-form", "wai-aria": "aria", "ios-accessibility": "mobile-accessibility", "android-accessibility": "mobile-accessibility", "electron-accessibility": "desktop-accessibility",
    "privacy-engineering": "privacy", "personal-data": "data-privacy", "pii-handling": "data-privacy", "purpose-limitation": "data-minimization", "consent-preference": "privacy-preference", "cookie-consent": "privacy-preference", "retention-policy": "data-retention", "account-deletion": "data-deletion", "data-erasure": "data-deletion", "privacy-export": "data-export", "subject-data-export": "data-export", "third-party-data-sharing": "provider-data-egress", "pii-logging": "sensitive-logging",
    "collaborative-app": "collaboration", "multi-user-collaboration": "collaboration", "real-time-collaboration": "realtime-collaboration", "presence-state": "presence", "shared-document": "collaborative-editing", "co-editing": "collaborative-editing", "optimistic-ui-reconciliation": "optimistic-reconciliation", "offline-editing": "offline-collaboration", "live-permissions": "realtime-permissions", "reconnect-resume": "reconnect-recovery", "message-ordering": "event-ordering", "slow-consumer": "collaboration-backpressure",
    "direct-upload": "file-upload", "presigned-upload": "file-upload", "resume-upload": "resumable-upload", "chunked-upload": "multipart-upload", "file-attachment": "attachment-flow", "download-delivery": "object-delivery", "media-transcoding": "media-processing", "thumbnail-processing": "media-processing", "presigned-download": "signed-object-url", "virus-scan-upload": "upload-quarantine", "orphan-upload-cleanup": "upload-lifecycle", "import-from-url": "remote-file-import",
    "analytics": "product-analytics", "product-metrics": "product-analytics", "event-tracking": "instrumentation", "telemetry-plan": "instrumentation", "funnel": "funnel-analysis", "retention": "retention-analysis", "experiment": "experimentation", "a-b-test": "ab-test", "a/b-test": "ab-test", "ab-testing": "ab-test", "feature-flag-rollout": "feature-rollout", "measured-rollout": "feature-rollout",
    "product-spec": "product-requirements", "product-specification": "product-requirements", "requirements-engineering": "product-requirements", "requirements-discovery": "requirement-discovery", "story": "user-story", "user-stories": "user-story", "acceptance": "acceptance-criteria", "acceptance-test": "acceptance-criteria", "scope-definition": "scope-definition", "scoping": "scope-definition",
    "ai": "ai-product", "ai-feature": "ai-product", "genai": "ai-product", "generative-ai": "ai-product", "large-language-model": "llm", "prompt": "prompt-engineering", "retrieval-augmented-generation": "rag", "retrieval-augmented": "rag", "function-calling": "tool-calling", "agentic": "agent-loop", "agent": "agent-loop", "llm-eval": "model-eval", "ai-eval": "model-eval", "json-output": "structured-output", "schema-output": "structured-output",
}

def split_csv(value: str) -> list[str]:
    out = []
    for item in value.split(","):
        item = item.strip().lower()
        if item:
            out.append(ALIASES.get(item, item))
    return out

def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--signals", required=True, help="Comma-separated explicit task/mechanism/risk signals")
    p.add_argument("--max", type=int, default=7, dest="max_refs")
    p.add_argument("--json", action="store_true")
    a = p.parse_args()
    signals = split_csv(a.signals)
    refs, reasons = [], {}
    def add(ref: str, why: str) -> None:
        if ref not in refs:
            refs.append(ref)
            reasons.setdefault(ref, []).append(why)
        elif why not in reasons[ref]:
            reasons[ref].append(why)
    for ref in CORE:
        add(ref, "core")
    unmatched = []
    for signal in signals:
        routed = ROUTES.get(signal)
        if not routed:
            unmatched.append(signal)
            continue
        for ref in routed:
            add(ref, signal)
    limit = max(1, a.max_refs)
    selected = refs[:limit]
    payload = {
        "signals": signals,
        "references": [{"path": r, "reasons": reasons[r]} for r in selected],
        "unmatched_signals": unmatched,
        "truncated": len(refs) > limit,
        "note": "Routing aid only. Add or replace references when repository evidence crosses a different mechanism boundary.",
    }
    if a.json:
        print(json.dumps(payload, indent=2, sort_keys=True))
    else:
        print("# Engineering context route")
        print("signals:", ", ".join(signals) or "none")
        for item in payload["references"]:
            print(f"- {item['path']} [{','.join(item['reasons'])}]")
        if unmatched:
            print("unmatched:", ", ".join(unmatched))
        if payload["truncated"]:
            print("note: recommendations truncated; re-route after new evidence")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
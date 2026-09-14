#!/usr/bin/env python3
import argparse
import json
import sys
from pathlib import Path

SCHEMA = 'veteran-privileged-operator-support-v1'
REQUIRED_SCENARIOS = {
    'missing-purpose',
    'step-up-required',
    'expired-grant-reuse',
    'cross-tenant-scope',
    'readonly-mutation-denied',
    'impersonation-attribution',
    'requester-approver-separation',
    'break-glass-audited',
    'queued-work-after-revocation',
    'duplicate-high-risk-retry',
    'sensitive-export-scope',
    'operator-revoked-active-session',
}

REQUIRED = {
    'product': ['operator_outcome', 'visible_states'],
    'authority': ['operator_identity_owner', 'subject_identity_owner', 'policy_owner', 'grant_owner', 'approval_owner', 'audit_owner'],
    'entry': ['purpose_binding', 'case_or_incident', 'step_up_authentication'],
    'scope': ['tenant_object_action', 'read_write_separation', 'cross_tenant_boundary', 'deny_by_default'],
    'approval': ['normal_path', 'high_risk_path', 'requester_approver_separation', 'break_glass'],
    'session': ['grant_identity', 'expiry', 'impersonation_identity', 'revocation'],
    'actions': ['authoritative_transition', 'irreversible_effects', 'async_effects', 'retry_unknown_outcome'],
    'privacy': ['redaction', 'secret_handling', 'export_download_policy'],
    'audit': ['lifecycle_events', 'attribution', 'customer_visibility', 'anomaly_detection'],
    'recovery': ['revocation_convergence', 'queued_work_policy', 'legacy_bypass_removal'],
    'observability': ['grant_metrics', 'high_risk_activity', 'stale_access_detection', 'redaction_policy'],
    'compatibility': ['legacy_admin_path', 'mixed_version_behavior', 'rollback_security_effects'],
}


def text(value):
    return isinstance(value, str) and bool(value.strip())


def block(blockers, code, path, message):
    blockers.append({'code': code, 'path': path, 'message': message})


def validate(payload):
    blockers = []
    if not isinstance(payload, dict):
        return [{'code': 'MANIFEST_OBJECT_REQUIRED', 'path': '$', 'message': 'manifest must be a JSON object'}]

    if payload.get('schema') != SCHEMA:
        block(blockers, 'SCHEMA_REQUIRED', 'schema', f'schema must equal {SCHEMA}')

    for section, fields in REQUIRED.items():
        value = payload.get(section)
        if not isinstance(value, dict):
            block(blockers, f'{section.upper()}_SECTION_REQUIRED', section, f'{section} must be an object')
            continue
        for field in fields:
            if not text(value.get(field)):
                block(blockers, f'{section.upper()}_FIELD_REQUIRED', f'{section}.{field}', 'non-empty string required')

    product = payload.get('product') if isinstance(payload.get('product'), dict) else {}
    modes = product.get('privileged_modes')
    if not isinstance(modes, list) or not modes or any(not text(item) for item in modes):
        block(blockers, 'PRIVILEGED_MODES_REQUIRED', 'product.privileged_modes', 'one or more non-empty privileged modes required')

    tests = payload.get('tests')
    if not isinstance(tests, dict):
        block(blockers, 'TESTS_SECTION_REQUIRED', 'tests', 'tests must be an object')
    else:
        scenarios = tests.get('scenarios')
        if not isinstance(scenarios, list) or any(not text(item) for item in scenarios):
            block(blockers, 'TEST_SCENARIOS_REQUIRED', 'tests.scenarios', 'scenarios must be a list of non-empty strings')
            scenario_set = set()
        else:
            scenario_set = set(scenarios)
        missing = sorted(REQUIRED_SCENARIOS - scenario_set)
        if missing:
            block(blockers, 'TEST_SCENARIOS_INCOMPLETE', 'tests.scenarios', f'missing required scenarios: {", ".join(missing)}')
        if not text(tests.get('oracle')):
            block(blockers, 'TESTS_FIELD_REQUIRED', 'tests.oracle', 'non-empty oracle string required')

    return blockers


def main():
    parser = argparse.ArgumentParser(description='Fail-closed privileged operator/support contract gate')
    parser.add_argument('manifest')
    parser.add_argument('--json', action='store_true')
    args = parser.parse_args()

    try:
        payload = json.loads(Path(args.manifest).read_text(encoding='utf-8'))
    except Exception as exc:
        result = {'schema': SCHEMA, 'gate_passed': False, 'blockers': [{'code': 'MANIFEST_UNREADABLE', 'path': '$', 'message': str(exc)}]}
        print(json.dumps(result, indent=2, sort_keys=True))
        return 1

    blockers = validate(payload)
    result = {'schema': SCHEMA, 'gate_passed': not blockers, 'blockers': blockers}
    if args.json:
        print(json.dumps(result, indent=2, sort_keys=True))
    else:
        print('PASS' if not blockers else 'FAIL')
        for item in blockers:
            print(f"- {item['code']} {item['path']}: {item['message']}")
    return 0 if not blockers else 1


if __name__ == '__main__':
    sys.exit(main())

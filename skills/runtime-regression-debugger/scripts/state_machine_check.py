#!/usr/bin/env python3
"""Validate a small extracted state-machine model for structural hazards."""
from __future__ import annotations
import argparse, collections, json, pathlib, sys


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("path")
    p.add_argument("--json", action="store_true")
    a = p.parse_args()
    try:
        data = json.loads(pathlib.Path(a.path).read_text(encoding="utf-8"))
        states = data.get("states")
        initial = str(data.get("initial", "")).strip()
        terminals = set(map(str, data.get("terminal_states", [])))
        transitions = data.get("transitions")
        if not isinstance(states, list) or not states or not isinstance(transitions, list):
            raise ValueError("states and transitions must be non-empty lists")
        states = {str(x) for x in states}
        if initial not in states: raise ValueError("initial must name a declared state")
        if not terminals <= states: raise ValueError("terminal_states must be declared states")
    except (OSError, json.JSONDecodeError, ValueError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    findings, graph = [], collections.defaultdict(set)
    by_event = collections.defaultdict(list)
    for i, t in enumerate(transitions, 1):
        if not isinstance(t, dict): findings.append({"kind":"invalid_transition","index":i}); continue
        src, dst, event = map(lambda x: str(x).strip(), (t.get("from",""), t.get("to",""), t.get("event","")))
        if src not in states or dst not in states:
            findings.append({"kind":"unknown_state","index":i,"from":src,"to":dst}); continue
        if not event: findings.append({"kind":"missing_event","index":i})
        if src in terminals: findings.append({"kind":"terminal_has_outgoing","index":i,"state":src})
        graph[src].add(dst)
        by_event[(src,event)].append((dst, str(t.get("guard", "")).strip()))
    for (src,event), items in by_event.items():
        targets = {d for d,_ in items}
        if len(targets) > 1 and any(not guard for _,guard in items):
            findings.append({"kind":"ambiguous_event","state":src,"event":event,"targets":sorted(targets)})
    seen, queue = {initial}, collections.deque([initial])
    while queue:
        cur = queue.popleft()
        for nxt in graph[cur]:
            if nxt not in seen: seen.add(nxt); queue.append(nxt)
    for state in sorted(states - seen):
        findings.append({"kind":"unreachable_state","state":state})
    payload = {"findings": findings, "valid": not findings, "note": "Structural check only; transition guards, side effects, and business legality still require repository evidence."}
    if a.json:
        print(json.dumps(payload, indent=2, sort_keys=True))
    else:
        print("# State machine check")
        for f in findings: print("-", json.dumps(f, sort_keys=True))
        print("status:", "PASS" if not findings else "REVIEW")
    return 0 if not findings else 1


if __name__ == "__main__":
    raise SystemExit(main())

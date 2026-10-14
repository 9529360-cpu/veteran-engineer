/**
 * Veteran Agent Council: independent candidate discovery, adversarial review
 * and evidence-first selection. The lead decides; votes are suggestions,
 * never permissions or objective correctness proofs.
 */
import { randomUUID } from 'node:crypto';

export const NATIVE_COUNCIL_CONTRACT = 'veteran-native-agent-council-v1';
const MAX_COUNCIL_MEMBERS = 64; // per deliberation payload, not a global team/worker cap
const MAX_COUNCIL_ARCHIVE = 8;

function error(code, message) { return Object.assign(new Error(message), { code }); }
function brief(value, max = 1400) { return String(value || '').slice(0, max); }

function validate({ question, perspectives, crossExamine, maxTurns }) {
  if (typeof question !== 'string' || !question.trim() || question.length > 12_000) {
    throw error('NATIVE_COUNCIL_QUESTION_INVALID', 'Council needs a bounded substantive question');
  }
  if (!Array.isArray(perspectives) || perspectives.length < 2 || perspectives.length > MAX_COUNCIL_MEMBERS
      || perspectives.some((p) => typeof p !== 'string' || p.trim().length < 4 || p.length > 500)) {
    throw error('NATIVE_COUNCIL_PERSPECTIVES_INVALID', 'Provide 2-64 different, substantive perspectives chosen for this problem');
  }
  if (new Set(perspectives.map((p) => p.trim().toLowerCase())).size !== perspectives.length) {
    throw error('NATIVE_COUNCIL_PERSPECTIVES_DUPLICATE', 'Council perspectives must be different');
  }
  if (crossExamine !== undefined && typeof crossExamine !== 'boolean') {
    throw error('NATIVE_COUNCIL_REVIEW_INVALID', 'crossExamine must be boolean');
  }
  if (!Number.isInteger(maxTurns) || maxTurns < 1 || maxTurns > 24) {
    throw error('NATIVE_COUNCIL_TURNS_INVALID', 'Council adviser maxTurns must be 1-24');
  }
}

function ballotFromText(text, candidateIds) {
  const value = String(text || '');
  const first = value.indexOf('{');
  const last = value.lastIndexOf('}');
  if (first === -1 || last <= first) return null;
  let parsed;
  try { parsed = JSON.parse(value.slice(first, last + 1)); } catch { return null; }
  if (!parsed || typeof parsed !== 'object' || !candidateIds.has(parsed.strongest)
      || !candidateIds.has(parsed.weakest) || parsed.strongest === parsed.weakest
      || typeof parsed.reason !== 'string' || parsed.reason.trim().length < 5) return null;
  return {
    strongest: parsed.strongest,
    weakest: parsed.weakest,
    reason: brief(parsed.reason, 1000),
    unresolvedRisks: Array.isArray(parsed.unresolvedRisks)
      ? parsed.unresolvedRisks.filter((x) => typeof x === 'string').slice(0, 5).map((s) => brief(s, 250)) : []
  };
}

async function waveExecute(count, capacity, run, checkAborted) {
  const outcomes = new Array(count);
  for (let start = 0; start < count; start += capacity) {
    checkAborted();
    const batch = Array.from({ length: Math.min(capacity, count - start) }, (_, k) => start + k);
    const settled = await Promise.allSettled(batch.map(run));
    checkAborted();
    for (let i = 0; i < batch.length; i++) {
      const outcome = settled[i];
      outcomes[batch[i]] = outcome.status === 'fulfilled'
        ? { ok: true, value: outcome.value }
        : { ok: false, code: outcome.reason?.code || 'NATIVE_COUNCIL_MEMBER_FAILED' };
    }
  }
  return outcomes;
}

/**
 * The lead owns the lifetime and authority. Adviser loops share a provider
 * but never share conversation history, writable tools or delegation power.
 */
export async function conveneNativeCouncil(lead, args = {}) {
  const { question, perspectives, crossExamine = true, maxTurns = 8 } = args;
  validate({ question, perspectives, crossExamine, maxTurns });
  if (!lead.allowAdvisors) throw error('NATIVE_AGENT_DELEGATION_FORBIDDEN', 'This Agent cannot convene an adviser team');
  const available = lead.advisorSlots();
  if (available < 1) throw error('NATIVE_AGENT_HOST_CAPACITY', 'No host capacity available for Agent council');
  const councilId = 'council:' + randomUUID();
  lead.emit('council_started', { councilId, requested: perspectives.length, concurrentSlots: available });
  const candidates = perspectives.map((perspective, index) => ({
    candidateId: `option_${index + 1}`,
    perspective: perspective.trim(),
    proposerAgentId: null,
    proposal: null,
    turns: 0,
    usage: null,
    status: 'unavailable',
    endorsements: 0,
    challenges: 0
  }));
  const proposed = await waveExecute(candidates.length, available, async (i) => {
    const option = candidates[i];
    return lead.spawnAdvisor({
      perspective: option.perspective,
      maxTurns,
      question: [
        `Original problem: ${question}`,
        'Develop an independent, practical proposal that can be compared with alternative approaches.',
        'Read relevant repository evidence when useful. Cite concrete trade-offs and realistic failure modes.',
        'Do not assume any other adviser agrees. Do not invent tests, files, validation or privileges.',
        `Your candidate identifier: ${option.candidateId}`
      ].join('\n')
    });
  }, () => lead.checkAborted());
  for (let i = 0; i < candidates.length; i++) {
    const result = proposed[i];
    if (!result.ok) {
      candidates[i].failureCode = result.code;
      continue;
    }
    Object.assign(candidates[i], {
      proposerAgentId: result.value.agentId,
      proposal: brief(result.value.text, 3600),
      turns: result.value.turns,
      usage: result.value.usage || null,
      status: 'proposed'
    });
  }
  const valid = candidates.filter((x) => x.status === 'proposed' && x.proposal);
  const candidateIds = new Set(valid.map((c) => c.candidateId));
  const reviews = [];
  if (crossExamine && valid.length >= 2) {
    // All candidates are proposed before anyone receives competing proposals.
    // A fresh independent critic reviews them, rather than letting one
    // proposer's system prompt quietly redefine another proposer's authority.
    const perCandidate = Math.max(110, Math.floor(8000 / valid.length));
    const shared = valid.map((candidate) => ({
      id: candidate.candidateId,
      perspective: brief(candidate.perspective, Math.min(150, Math.floor(perCandidate / 4))),
      proposal: brief(candidate.proposal, Math.min(2600, Math.floor(perCandidate / 2)))
    }));
    const reviewed = await waveExecute(valid.length, available, async (i) => {
      return lead.spawnAdvisor({
        perspective: `Independent adversarial reviewer: ${valid[i].perspective}`,
        maxTurns,
        question: [
          `Problem: ${question}`,
          `Competing independent proposals: ${JSON.stringify(shared).slice(0, 10_000)}`,
          'Cross-examine each proposal against feasibility, risks and verifiable project evidence.',
          'Make an independent provisional recommendation. An opinion is not verification or final acceptance.',
          'Return ONLY valid JSON with fields: strongest (candidate ID), weakest (different candidate ID),',
          'reason (specific supporting evidence/trade-offs), unresolvedRisks (string array).'
        ].join('\n')
      });
    }, () => lead.checkAborted());
    for (let i = 0; i < valid.length; i++) {
      const outcome = reviewed[i];
      const vote = outcome.ok ? ballotFromText(outcome.value.text, candidateIds) : null;
      reviews.push({
        reviewerAgentId: outcome.ok ? outcome.value.agentId : null,
        perspective: valid[i].perspective,
        status: vote ? 'ballot' : outcome.ok ? 'unstructured-review' : 'failed',
        ...(vote || {}),
        ...(outcome.ok ? { review: brief(outcome.value.text, 1800), turns: outcome.value.turns, usage: outcome.value.usage || null }
          : { failureCode: outcome.code })
      });
      if (vote) {
        candidates.find((c) => c.candidateId === vote.strongest).endorsements++;
        candidates.find((c) => c.candidateId === vote.weakest).challenges++;
      }
    }
  }
  const ranking = valid.slice().sort((a, b) =>
    (b.endorsements - b.challenges) - (a.endorsements - a.challenges)
      || b.endorsements - a.endorsements
      || a.candidateId.localeCompare(b.candidateId)
  ).map((c) => ({ candidateId: c.candidateId, endorsements: c.endorsements, challenges: c.challenges,
    netEndorsements: c.endorsements - c.challenges }));
  const record = {
    contract: NATIVE_COUNCIL_CONTRACT,
    councilId, question: brief(question, 12_000), createdAt: new Date().toISOString(),
    members: candidates, reviews, ranking,
    reviewedBallots: reviews.filter((r) => r.status === 'ballot').length,
    selection: null,
    authority: 'advisory-only-primary-agent-retains-final-decision'
  };
  lead.councils.set(councilId, record);
  while (lead.councils.size > MAX_COUNCIL_ARCHIVE) lead.councils.delete(lead.councils.keys().next().value);
  lead.emit('council_completed', { councilId, proposed: valid.length, reviews: reviews.length, ballots: record.reviewedBallots });
  return {
    contract: NATIVE_COUNCIL_CONTRACT,
    councilId,
    proposed: valid.length,
    failed: candidates.length - valid.length,
    ballots: record.reviewedBallots,
    ranking,
    leadingProposals: ranking.slice(0, 3).map((r) => ({
      candidateId: r.candidateId,
      perspective: candidates.find((c) => c.candidateId === r.candidateId).perspective,
      proposal: brief(candidates.find((c) => c.candidateId === r.candidateId).proposal, 800)
    })),
    next: 'Use read_council for any other member/critique; use select_council_option with specific evidence and rationale. Rankings are opinions, not proof.'
  };
}

export function readNativeCouncil(lead, { councilId, offset = 0, limit = 5 } = {}) {
  const council = lead.councils.get(councilId);
  if (!council) throw error('NATIVE_COUNCIL_NOT_FOUND', 'Council record not available in this Agent session');
  if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 5) {
    throw error('NATIVE_COUNCIL_PAGE_INVALID', 'Use offset >= 0 and limit 1-5');
  }
  return {
    contract: council.contract, councilId, total: council.members.length, offset, limit,
    members: council.members.slice(offset, offset + limit).map((member) => ({
      ...member, proposal: brief(member.proposal, 1500),
      perspective: brief(member.perspective, 150)
    })),
    reviews: council.reviews.slice(offset, offset + limit).map((review) => ({
      ...review, review: brief(review.review, 600)
    })),
    ranking: council.ranking,
    selection: council.selection,
    nextOffset: offset + limit < council.members.length ? offset + limit : null,
    authority: council.authority
  };
}

export function selectNativeCouncilOption(lead, { councilId, candidateId, rationale, evidence = [] } = {}) {
  const council = lead.councils.get(councilId);
  if (!council) throw error('NATIVE_COUNCIL_NOT_FOUND', 'Council record not available in this Agent session');
  const option = council.members.find((c) => c.candidateId === candidateId && c.status === 'proposed');
  if (!option) throw error('NATIVE_COUNCIL_OPTION_INVALID', 'Select an actual completed independent proposal');
  if (council.selection) throw error('NATIVE_COUNCIL_ALREADY_SELECTED', 'Council selection has already been recorded');
  if (typeof rationale !== 'string' || rationale.trim().length < 12 || rationale.length > 3000 ||
      !Array.isArray(evidence) || evidence.length > 20 || evidence.some((x) => typeof x !== 'string' || x.length > 400)) {
    throw error('NATIVE_COUNCIL_SELECTION_INVALID', 'Selection requires meaningful rationale and optional short evidence references');
  }
  council.selection = {
    candidateId,
    rationale: rationale.trim(),
    evidence,
    selectedAt: new Date().toISOString(),
    authority: 'planning-advice-only-not-task-or-execution-authorization'
  };
  lead.emit('council_option_selected', { councilId, candidateId, evidenceCount: evidence.length });
  return { councilId, selection: council.selection, note: 'Selection does not bypass MissionService planning validation, review, or authorization.' };
}

export function nativeCouncilSummaries(lead) {
  return [...lead.councils.values()].map((council) => ({
    councilId: council.councilId, proposed: council.members.filter((x) => x.status === 'proposed').length,
    reviewedBallots: council.reviewedBallots,
    ranking: council.ranking.slice(0, 8),
    proposalEvidence: council.members.filter((x) => x.status === 'proposed').slice(0, 16).map((member) => ({
      candidateId: member.candidateId, perspective: brief(member.perspective, 120),
      proposal: brief(member.proposal, 450)
    })),
    critiques: council.reviews.filter((x) => x.status === 'ballot').slice(0, 16).map((review) => ({
      strongest: review.strongest, weakest: review.weakest,
      reason: brief(review.reason, 450), unresolvedRisks: review.unresolvedRisks
    })),
    selection: council.selection
  }));
}

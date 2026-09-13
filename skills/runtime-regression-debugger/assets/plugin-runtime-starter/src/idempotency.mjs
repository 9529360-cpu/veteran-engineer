import { nowIso } from './util.mjs';

export async function beginRequest(store, requestId, operation, fingerprint) {
  if (!requestId || typeof requestId !== 'string') {
    const error = new Error('requestId is required for mutating operations');
    error.code = 'REQUEST_ID_REQUIRED';
    throw error;
  }
  return store.transaction('request_started', (state) => {
    const existing = state.requests[requestId];
    if (existing) {
      if (existing.operation !== operation || existing.fingerprint !== fingerprint) {
        const error = new Error('requestId was already used for a different operation');
        error.code = 'REQUEST_ID_CONFLICT';
        throw error;
      }
      return { replay: true, record: existing };
    }
    const record = {
      requestId,
      operation,
      fingerprint,
      status: 'started',
      startedAt: nowIso(),
      completedAt: null,
      result: null,
      error: null
    };
    state.requests[requestId] = record;
    return { replay: false, record };
  }, { requestId, operation });
}

export async function completeRequest(store, requestId, result) {
  return store.transaction('request_completed', (state) => {
    const request = state.requests[requestId];
    if (!request) throw new Error(`Unknown requestId: ${requestId}`);
    request.status = 'completed';
    request.completedAt = nowIso();
    request.result = result;
    request.error = null;
    return result;
  }, { requestId });
}

export async function failRequest(store, requestId, error) {
  return store.transaction('request_failed', (state) => {
    const request = state.requests[requestId];
    if (!request) throw new Error(`Unknown requestId: ${requestId}`);
    request.status = 'failed';
    request.completedAt = nowIso();
    request.error = { code: error?.code || 'ERROR', message: error?.message || String(error) };
    return request.error;
  }, { requestId, code: error?.code || 'ERROR' });
}

export function replayOrThrow(record) {
  if (record.status === 'completed') return record.result;
  if (record.status === 'failed') {
    const error = new Error(record.error?.message || 'Prior request failed');
    error.code = record.error?.code || 'PRIOR_REQUEST_FAILED';
    throw error;
  }
  if (record.status === 'unknown') {
    const error = new Error('Prior request outcome is unknown and requires reconciliation; it will not be replayed blindly.');
    error.code = 'REQUEST_OUTCOME_UNKNOWN';
    throw error;
  }
  const error = new Error('Equivalent request is already in progress');
  error.code = 'REQUEST_IN_PROGRESS';
  throw error;
}

const MAX_INLINE_EVIDENCE_IDS = 4;
const MAX_INLINE_IMAGES = 4;
const MAX_INLINE_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_INLINE_IMAGE_TOTAL_BYTES = 4 * 1024 * 1024;

export function jsonSafe(value) {
  return JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? String(item) : item);
}

function projectionError(code, message, details = null) {
  const error = new Error(message);
  error.code = code;
  if (details) error.details = details;
  return error;
}

function exactImageEvidenceRecords(args, result) {
  if (!Array.isArray(args?.ids) || args.ids.length === 0) {
    throw projectionError('EVIDENCE_IMAGE_IDS_REQUIRED', 'includeImageAttachments requires one or more exact evidence ids');
  }
  if (args.ids.length > MAX_INLINE_EVIDENCE_IDS) {
    throw projectionError('EVIDENCE_IMAGE_DELIVERY_LIMIT', `includeImageAttachments accepts at most ${MAX_INLINE_EVIDENCE_IDS} evidence ids`);
  }
  const ids = args.ids.map(String);
  if (new Set(ids).size !== ids.length) {
    throw projectionError('EVIDENCE_IMAGE_IDS_DUPLICATE', 'includeImageAttachments requires unique evidence ids');
  }
  if (!Array.isArray(result)) {
    throw projectionError('EVIDENCE_IMAGE_RESULT_INVALID', 'evidence_query must return an array before image projection');
  }
  const byId = new Map(result.map((record) => [record?.id, record]));
  const records = [];
  for (const id of ids) {
    const record = byId.get(id);
    if (!record) throw projectionError('EVIDENCE_IMAGE_EVIDENCE_NOT_FOUND', `Evidence id was not returned by the query: ${id}`);
    records.push(record);
  }
  return records;
}

export async function toolResultContent({ name, args = {}, result, app }) {
  const content = [{ type: 'text', text: jsonSafe(result) }];
  if (name !== 'evidence_query' || args?.includeImageAttachments !== true) return content;
  const evidenceService = app?.services?.evidenceService;
  if (!evidenceService?.readImageAttachments) {
    throw projectionError('EVIDENCE_IMAGE_DELIVERY_UNAVAILABLE', 'Evidence image delivery is unavailable in this runtime');
  }
  const records = exactImageEvidenceRecords(args, result);
  const images = await evidenceService.readImageAttachments(records, {
    maxImages: MAX_INLINE_IMAGES,
    maxImageBytes: MAX_INLINE_IMAGE_BYTES,
    maxTotalBytes: MAX_INLINE_IMAGE_TOTAL_BYTES
  });
  return [...content, ...images];
}

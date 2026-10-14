/** Model binding for Veteran's forked Agent loop. No Claude subscription, CLI or API key is implied. */
function fail(code, message) { return Object.assign(new Error(message), { code }); }

export function normalizeModelEndpoint(endpoint) {
  if (typeof endpoint !== 'string' || !endpoint.trim()) throw fail('NATIVE_MODEL_ENDPOINT_REQUIRED', 'Configure a model endpoint');
  let url;
  try { url = new URL(endpoint); } catch { throw fail('NATIVE_MODEL_ENDPOINT_INVALID', 'Invalid model endpoint URL'); }
  if (url.username || url.password || url.search || url.hash) throw fail('NATIVE_MODEL_ENDPOINT_INVALID', 'Credentials and query strings are forbidden in model endpoint');
  const loopback = ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw fail('NATIVE_MODEL_ENDPOINT_UNSAFE', 'HTTP model endpoints are permitted only on loopback; remote endpoints must use HTTPS');
  }
  const pathname = url.pathname.replace(/\/+$/, '');
  if (!pathname.endsWith('/chat/completions')) url.pathname = pathname + '/chat/completions';
  return url.toString();
}

/**
 * Stateless provider: model calls are authorized by caller-owned endpoints.
 * Works with local Ollama/vLLM/OpenAI-compatible servers without an API key.
 * Credentials, when needed, live only in the explicitly allowlisted process env.
 */
export function createOpenAICompatibleModel({ baseURL, model, apiKey = null, fetchImpl = globalThis.fetch,
  timeoutMs = 120_000, maxOutputTokens = 4096 } = {}) {
  const url = normalizeModelEndpoint(baseURL);
  if (typeof model !== 'string' || !model.trim()) throw fail('NATIVE_MODEL_ID_REQUIRED', 'Configure a model ID');
  if (typeof fetchImpl !== 'function') throw fail('NATIVE_MODEL_FETCH_MISSING', 'Model transport is unavailable');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 600_000) throw fail('NATIVE_MODEL_TIMEOUT_INVALID', 'Invalid model timeout');
  return {
    async complete({ messages, tools = [], signal = null }) {
      const controller = new AbortController();
      const cancel = () => controller.abort();
      if (signal?.aborted) throw fail('NATIVE_AGENT_CANCELLED', 'Model request cancelled');
      signal?.addEventListener('abort', cancel, { once: true });
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
          },
          body: JSON.stringify({
            model,
            messages,
            stream: false,
            max_tokens: maxOutputTokens,
            ...(tools.length ? { tools: tools.map((tool) => ({ type: 'function', function: {
              name: tool.name, description: tool.description, parameters: tool.parameters
            } })) } : {})
          }),
          signal: controller.signal,
          redirect: 'error'
        });
        if (!response.ok) {
          // Do not forward response bodies: they can reflect API credentials.
          throw fail('NATIVE_MODEL_HTTP_ERROR', `Model provider returned HTTP ${response.status}`);
        }
        const payload = await response.json();
        const message = payload?.choices?.[0]?.message;
        if (!message || (typeof message.content !== 'string' && !Array.isArray(message.tool_calls))) {
          throw fail('NATIVE_MODEL_RESPONSE_INVALID', 'Model provider did not return a usable assistant message');
        }
        return {
          content: typeof message.content === 'string' ? message.content : '',
          toolCalls: (message.tool_calls || []).map((call) => ({
            id: call.id, name: call.function?.name, arguments: call.function?.arguments
          })),
          usage: payload.usage || null
        };
      } catch (error) {
        if (signal?.aborted) throw fail('NATIVE_AGENT_CANCELLED', 'Model request cancelled');
        if (error?.code) throw error;
        throw fail('NATIVE_MODEL_TRANSPORT_FAILED', 'Model provider request failed or timed out');
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', cancel);
      }
    }
  };
}

# Search Relevance and Serving Engineering

Use this reference when the product contract depends on ranking quality, lexical/vector/hybrid retrieval, recommendation-like search, query latency, index freshness, or search authorization.

## Separate retrieval, ranking, and business policy

Model the serving path explicitly:

`query understanding -> candidate retrieval -> filtering/auth -> ranking/reranking -> pagination/diversity/business rules -> result rendering`

Do not mix relevance signals with authorization. A high-ranked document must still be authorized at the correct boundary.

## Retrieval choices

- Lexical/BM25-style retrieval is strong for exact terms, identifiers, rare names, and transparent matching.
- Vector/ANN retrieval can improve semantic recall but introduces embedding/model/version/index choices and approximate search behavior.
- Hybrid retrieval needs an explicit fusion/reranking strategy rather than simply concatenating two result lists.
- Query expansion, spelling, synonyms, facets, and filters can change both relevance and computational cost.

Use product evidence to choose mechanisms; do not add vectors because they are fashionable.

## Relevance evaluation

Define a representative query set and judgments/behavioral metrics appropriate to the product. Consider precision/recall, MRR/NDCG-like ranking metrics, zero-result rate, successful reformulation, task completion, and guardrails for critical queries.

Offline metrics are not sufficient by themselves; online experiments can be confounded by presentation, latency, novelty, or feedback loops. Compare both when material.

## Index and model lifecycle

- Version mappings/analyzers/embeddings/ranking features.
- Preserve a rebuild path from authoritative data.
- Use parallel indexes/aliases or cohorts for incompatible changes.
- Track index freshness and delete/tombstone propagation.
- Keep embedding model/version with vectors; mixed incompatible embeddings can silently damage recall.
- Reindex with capacity budgets so merge/build traffic does not exhaust production resources.

## Serving performance

Budget candidate count, shard fanout, ANN parameters, reranker cost, filter selectivity, aggregation cardinality, pagination strategy, cache behavior, and tail latency.

Deep offset pagination and broad scatter/gather can become increasingly expensive. Prefer stable cursor/search-after semantics where supported and compatible with product ordering.

## Security and privacy

Do not leak existence, snippets, facets, counts, embeddings, or cached results across tenant/user authorization boundaries. Treat query logs and clicked-result history as potentially sensitive telemetry and minimize retention/content capture.

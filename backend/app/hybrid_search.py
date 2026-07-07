from rank_bm25 import BM25Okapi
import numpy as np

def tokenize(text: str) -> list:
    """Simple tokenizer — lowercase, split on whitespace and punctuation."""
    import re
    text = text.lower()
    tokens = re.findall(r'\b[a-z0-9]+\b', text)
    return tokens

def bm25_search(query: str, chunks: list, sources: list, top_k: int = 8) -> list:
    """
    BM25 sparse search over chunks.
    Returns (chunk, source, score) sorted by score descending.
    """
    if not chunks:
        return []

    tokenized_corpus = [tokenize(chunk) for chunk in chunks]
    bm25 = BM25Okapi(tokenized_corpus)

    tokenized_query = tokenize(query)
    scores = bm25.get_scores(tokenized_query)

    results = list(zip(chunks, sources, scores))
    results.sort(key=lambda x: x[2], reverse=True)
    return results[:top_k]


def hybrid_fusion(
    dense_results: list,
    sparse_results: list,
    dense_weight: float = 0.7,
    sparse_weight: float = 0.3
) -> list:
    """
    Combines dense (semantic) and sparse (BM25) results using
    Reciprocal Rank Fusion (RRF) with weighted scores.
    
    dense_results: list of (chunk, source, score)
    sparse_results: list of (chunk, source, score)
    Returns: merged list of (chunk, source, combined_score)
    """
    scores = {}
    chunk_map = {}

    # Score dense results
    for rank, (chunk, source, score) in enumerate(dense_results):
        key = chunk[:100]  # use first 100 chars as key
        rrf_score = dense_weight * (1 / (rank + 60))
        scores[key] = scores.get(key, 0) + rrf_score
        chunk_map[key] = (chunk, source)

    # Score sparse results
    for rank, (chunk, source, score) in enumerate(sparse_results):
        key = chunk[:100]
        rrf_score = sparse_weight * (1 / (rank + 60))
        scores[key] = scores.get(key, 0) + rrf_score
        if key not in chunk_map:
            chunk_map[key] = (chunk, source)

    # Sort by combined score
    sorted_keys = sorted(scores.keys(), key=lambda k: scores[k], reverse=True)

    results = []
    for key in sorted_keys[:8]:
        chunk, source = chunk_map[key]
        results.append((chunk, source, scores[key]))

    return results
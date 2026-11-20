from app.kb import default_index
from app.rag import HybridIndex, embed, stem, tokenize

QUESTIONS = {
    "What is the default TTL of the response cache?": ("gateway-config", "c1"),
    "How many requests per minute does the default rate limit allow?": ("gateway-config", "c2"),
    "What does the daily spend circuit breaker default to?": ("gateway-config", "c3"),
    "How many models does the gateway try at most per request?": ("reliability", "c3"),
    "Which routing policy never leaves the gateway?": ("routing", "c3"),
    "How long is the cooldown after an HTTP 429?": ("reliability", "c1"),
    "How do retries work?": ("reliability", "c2"),
}


def test_each_question_retrieves_the_right_chunk_first():
    idx = default_index()
    for q, (doc, cid) in QUESTIONS.items():
        grounded, hits = idx.search(q)
        assert grounded, q
        assert (hits[0].chunk.doc, hits[0].chunk.id) == (doc, cid), q


def test_out_of_scope_questions_are_not_grounded():
    idx = default_index()
    for q in (
        "What is the capital of France?",
        "Who won the cricket world cup in 2011?",
        "What colour is the logo of the company?",
    ):
        assert idx.search(q)[0] is False, q


def test_light_stemming_lets_retry_match_retries():
    idx = default_index()
    grounded, hits = idx.search("retry policy")
    assert grounded and hits[0].bm25 > 0 and hits[0].chunk.cite == "[reliability:c2]"
    assert stem("retries") == "retry" and stem("models") == "model" and stem("class") == "class"


def test_rrf_scores_combine_both_rankings():
    _g, hits = default_index().search("cache TTL seconds", k=3)
    assert hits[0].rrf >= hits[1].rrf >= hits[2].rrf
    assert hits[0].rrf <= 2 / 61 + 1e-9


def test_ingest_chunks_and_search():
    idx = HybridIndex()
    n = idx.add_text(
        "handbook", "Paragraph one is about onboarding.\n\nParagraph two covers the expense policy for travel."
    )
    assert n >= 1
    grounded, hits = idx.search("expense policy travel")
    assert grounded and hits[0].chunk.doc == "handbook"


def test_embeddings_are_unit_length_and_tokenizer_drops_stopwords():
    v = embed("gateway cache")
    assert abs(sum(x * x for x in v) - 1) < 1e-9
    assert tokenize("What is the cache?") == ["cache"]

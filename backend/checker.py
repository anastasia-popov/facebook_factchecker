import httpx
from typing import Optional
from models import FactCheckResponse, ClaimResult, SourceLink
from config import settings

CLAIMBUSTER_URL = "https://idir.uta.edu/claimbuster/api/v2/score/text"
GOOGLE_FC_URL = "https://factchecktools.googleapis.com/v1alpha1/claims:search"

CLAIM_SCORE_THRESHOLD = 0.5
MAX_CLAIMS = 5


async def run_fact_check(text: str) -> FactCheckResponse:
    async with httpx.AsyncClient(timeout=15.0) as client:
        # Step 1: Score sentences with ClaimBuster
        try:
            cb_resp = await client.post(
                CLAIMBUSTER_URL,
                json={"input_text": text},
                headers={"x-api-key": settings.claimbuster_api_key}
            )
            cb_resp.raise_for_status()
            cb_data = cb_resp.json()
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 429:
                raise Exception("ClaimBuster rate limit reached, try again later")
            raise Exception(f"ClaimBuster error: {e.response.status_code}")
        except httpx.TimeoutException:
            raise Exception("ClaimBuster request timed out")

        # Parse ClaimBuster response: {"results": [{"text": "...", "score": 0.82}, ...]}
        results = cb_data.get("results", [])
        if not isinstance(results, list):
            results = []

        top_claims = sorted(
            [s for s in results if isinstance(s, dict) and s.get("score", 0) >= CLAIM_SCORE_THRESHOLD],
            key=lambda s: s.get("score", 0),
            reverse=True
        )[:MAX_CLAIMS]

        if not top_claims:
            return FactCheckResponse(claims=[], post_text_preview=text[:100])

        # Step 2: For each top claim, query Google Fact Check Tools
        claim_results = []
        for sentence in top_claims:
            result = await query_google_fc(client, sentence.get("text", ""), sentence.get("score", 0))
            claim_results.append(result)

        return FactCheckResponse(claims=claim_results, post_text_preview=text[:100])


async def query_google_fc(client: httpx.AsyncClient, claim_text: str, score: float) -> ClaimResult:
    if not claim_text:
        return ClaimResult(text=claim_text, score=score, verdict=None, review_url=None, sources=[])

    params = {
        "query": claim_text,
        "key": settings.google_api_key,
        "languageCode": "en"
    }

    try:
        resp = await client.get(GOOGLE_FC_URL, params=params)
        resp.raise_for_status()
        data = resp.json()
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 429:
            raise Exception("Google Fact Check API rate limit reached, try again later")
        # For other errors, return the claim as unverified instead of raising
        return ClaimResult(text=claim_text, score=score, verdict=None, review_url=None, sources=[])
    except httpx.TimeoutException:
        raise Exception("Google Fact Check request timed out")
    except Exception:
        return ClaimResult(text=claim_text, score=score, verdict=None, review_url=None, sources=[])

    claims = data.get("claims", [])
    if not claims:
        return ClaimResult(text=claim_text, score=score, verdict=None, review_url=None, sources=[])

    # Take the first (most relevant) match
    top = claims[0]
    reviews = top.get("claimReview", [])

    verdict: Optional[str] = None
    review_url: Optional[str] = None
    sources: list[SourceLink] = []

    for review in reviews:
        rating = review.get("textualRating")
        if rating and verdict is None:
            verdict = rating
        url = review.get("url", "")
        publisher_data = review.get("publisher", {})
        publisher_name = publisher_data.get("name", "Unknown") if isinstance(publisher_data, dict) else "Unknown"
        if url:
            sources.append(SourceLink(publisher=publisher_name, url=url))
            if review_url is None:
                review_url = url

    return ClaimResult(
        text=claim_text,
        score=score,
        verdict=verdict,
        review_url=review_url,
        sources=sources
    )

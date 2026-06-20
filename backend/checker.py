import httpx
import re
import logging
from typing import Optional
from models import FactCheckResponse, ClaimResult, SourceLink
from config import settings

logger = logging.getLogger(__name__)

GOOGLE_FC_URL = "https://factchecktools.googleapis.com/v1alpha1/claims:search"

MAX_CLAIMS = 5


def split_into_sentences(text: str) -> list[str]:
    """Split text into sentences using simple regex."""
    # Split on periods, exclamation marks, question marks
    sentences = re.split(r'(?<=[.!?])\s+', text)
    # Filter out very short sentences and clean up
    sentences = [s.strip() for s in sentences if len(s.strip()) > 10]
    return sentences[:MAX_CLAIMS]


async def run_fact_check(text: str) -> FactCheckResponse:
    async with httpx.AsyncClient(timeout=15.0) as client:
        logger.debug("Using Google-only mode")
        return await run_fact_check_google_only(client, text)


async def run_fact_check_google_only(client: httpx.AsyncClient, text: str) -> FactCheckResponse:
    """Without ClaimBuster, split text into sentences and check each with Google."""
    try:
        logger.debug("Running Google-only fact check")
        sentences = split_into_sentences(text)
        logger.debug(f"Split into {len(sentences)} sentences")

        if not sentences:
            logger.debug("No sentences found")
            return FactCheckResponse(claims=[], post_text_preview=text[:100])

        # Query Google Fact Check Tools for each sentence
        claim_results = []
        for i, sentence in enumerate(sentences):
            logger.debug(f"Checking sentence {i+1}: {sentence[:50]}...")
            # Assign a score based on position (first sentences are typically more important)
            score = 1.0 - (i * 0.1)
            result = await query_google_fc(client, sentence, score)
            # Only include results that have fact-checks (verdict is not None)
            if result.verdict is not None or result.sources:
                claim_results.append(result)
                logger.debug(f"Found fact-check result for sentence {i+1}")

        logger.debug(f"Total results: {len(claim_results)}")
        return FactCheckResponse(claims=claim_results, post_text_preview=text[:100])
    except Exception as e:
        logger.error(f"Error in run_fact_check_google_only: {e}", exc_info=True)
        raise


async def query_google_fc(client: httpx.AsyncClient, claim_text: str, score: float) -> ClaimResult:
    if not claim_text:
        return ClaimResult(text=claim_text, score=score, verdict=None, review_url=None, sources=[])

    params = {
        "query": claim_text,
        "key": settings.google_api_key,
        "languageCode": "en"
    }

    try:
        logger.debug(f"Querying Google Fact Check API for: {claim_text[:50]}...")
        resp = await client.get(GOOGLE_FC_URL, params=params)
        logger.debug(f"Google API response status: {resp.status_code}")
        resp.raise_for_status()
        data = resp.json()
        logger.debug(f"Google API returned {len(data.get('claims', []))} claims")
    except httpx.HTTPStatusError as e:
        logger.error(f"Google API HTTP error {e.response.status_code}")
        if e.response.status_code == 429:
            raise Exception("Google Fact Check API rate limit reached, try again later")
        # For other errors, return the claim as unverified instead of raising
        logger.warning(f"Google API error, returning unverified")
        return ClaimResult(text=claim_text, score=score, verdict=None, review_url=None, sources=[])
    except httpx.TimeoutException:
        logger.error("Google API request timed out")
        raise Exception("Google Fact Check request timed out")
    except Exception as e:
        logger.error(f"Unexpected error querying Google API: {e}", exc_info=True)
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

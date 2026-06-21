import httpx
import json
import logging
from typing import Optional
from config import settings

logger = logging.getLogger(__name__)

SERPER_API_URL = "https://google.serper.dev/search"
CLAUDE_API_URL = "https://api.anthropic.com/v1/messages"
CLAUDE_MODEL = "claude-opus-4-8"


async def search_web(query: str) -> list[dict]:
    """Search the web using Serper API and return top results."""
    if not settings.serper_api_key:
        logger.warning("Serper API key not configured, skipping web search")
        return []

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.post(
                SERPER_API_URL,
                headers={
                    "X-API-KEY": settings.serper_api_key,
                    "Content-Type": "application/json"
                },
                json={"q": query, "num": 5}
            )
            response.raise_for_status()
            data = response.json()

            results = []
            for item in data.get("organic", [])[:3]:
                results.append({
                    "title": item.get("title", ""),
                    "snippet": item.get("snippet", ""),
                    "url": item.get("link", "")
                })
            logger.debug(f"Web search returned {len(results)} results for: {query[:50]}...")
            return results
    except Exception as e:
        logger.error(f"Web search error: {e}")
        return []


async def fetch_and_summarize_url(url: str) -> str:
    """Fetch a web page and return its content (first 2000 chars)."""
    try:
        async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
            response = await client.get(url)
            response.raise_for_status()
            # Simple text extraction - take first 2000 chars of response text
            content = response.text[:2000]
            logger.debug(f"Fetched content from {url}, length: {len(content)}")
            return content
    except Exception as e:
        logger.error(f"Error fetching {url}: {e}")
        return ""


async def fact_check_with_claude(text: str) -> str:
    """Send text to Claude for comprehensive fact-checking with web search context."""
    if not settings.claude_api_key:
        raise Exception("CLAUDE_API_KEY not configured")

    # Extract key claims from text (simple split by sentences)
    sentences = [s.strip() for s in text.split('.') if len(s.strip()) > 10][:5]

    # Search the web for each claim
    search_context = []
    for sentence in sentences[:3]:  # Limit to top 3 claims
        logger.debug(f"Searching web for: {sentence[:50]}...")
        results = await search_web(sentence)
        if results:
            search_context.append({
                "claim": sentence,
                "search_results": results
            })

    # Build the prompt for Claude
    prompt = f"""Please fact-check the following social media post and provide a comprehensive analysis.

POST TEXT:
{text}

"""

    if search_context:
        prompt += "WEB SEARCH CONTEXT:\n"
        for item in search_context:
            prompt += f"\nClaim: {item['claim']}\n"
            prompt += "Web search results:\n"
            for i, result in enumerate(item['search_results'], 1):
                prompt += f"{i}. {result['title']}\n   {result['snippet']}\n   URL: {result['url']}\n"

    prompt += """
INSTRUCTIONS:
1. Identify key claims in the post
2. For each claim, determine if it's True, False, Misleading, or Unverified based on the search results
3. Provide sources where found
4. Give an overall assessment of the post's accuracy
5. Recommend further fact-checking if needed

Format your response as a structured analysis."""

    try:
        logger.debug(f"Sending fact-check request to Claude (text length: {len(text)})")
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                CLAUDE_API_URL,
                headers={
                    "x-api-key": settings.claude_api_key,
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json",
                    "anthropic-dangerous-direct-browser-access": "true"
                },
                json={
                    "model": CLAUDE_MODEL,
                    "max_tokens": 2000,
                    "messages": [
                        {
                            "role": "user",
                            "content": prompt
                        }
                    ]
                }
            )

            if not response.is_success:
                error_data = response.json()
                logger.error(f"Claude API error: {error_data}")
                raise Exception(f"Claude API error: {error_data.get('error', {}).get('message', 'Unknown error')}")

            data = response.json()
            result = data["content"][0]["text"]
            logger.debug(f"Claude analysis complete (length: {len(result)})")
            return result

    except Exception as e:
        logger.error(f"Claude API request failed: {e}", exc_info=True)
        raise

import httpx
import json
import logging
import re
from typing import Optional, Any
from config import settings

logger = logging.getLogger(__name__)

SERPER_API_URL = "https://google.serper.dev/search"
CLAUDE_API_URL = "https://api.anthropic.com/v1/messages"
CLAUDE_MODEL = "claude-opus-4-8"

# Tool definitions for Claude
TOOLS = [
    {
        "name": "web_search",
        "description": "Search the web for information about a claim or topic",
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "The search query to perform"
                }
            },
            "required": ["query"]
        }
    }
]


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
    """Send text to Claude for comprehensive fact-checking with web search tools."""
    if not settings.claude_api_key:
        raise Exception("CLAUDE_API_KEY not configured")

    # Extract key claims from text (simple split by sentences)
    sentences = [s.strip() for s in text.split('.') if len(s.strip()) > 10][:5]

    # Initial search context
    search_context = []
    for sentence in sentences[:3]:  # Limit to top 3 claims
        logger.debug(f"Searching web for: {sentence[:50]}...")
        results = await search_web(sentence)
        if results:
            search_context.append({
                "claim": sentence,
                "search_results": results
            })

    # Build the initial prompt for Claude
    prompt = f"""Please fact-check the following social media post and provide a comprehensive analysis.

POST TEXT:
{text}

"""

    if search_context:
        prompt += "INITIAL WEB SEARCH CONTEXT:\n"
        for item in search_context:
            prompt += f"\nClaim: {item['claim']}\n"
            prompt += "Web search results:\n"
            for i, result in enumerate(item['search_results'], 1):
                prompt += f"{i}. {result['title']}\n   {result['snippet']}\n   URL: {result['url']}\n"

    prompt += """
INSTRUCTIONS:
1. Identify the key claims in the post
2. For each claim, use the web_search tool to find PRIMARY SOURCES that support or refute it
3. Provide a fact-check analysis with:
   - **Claim**: [brief statement]
   - **Verdict**: True/False/Misleading/Unverified
   - **Sources**: List primary sources with direct URLs (e.g., official websites, academic papers, government reports)
   - **Evidence**: Brief explanation of what the sources say
4. BE CONCISE - use short paragraphs, bullet points where possible
5. PRIORITIZE PRIMARY SOURCES - link to original reports, official statements, peer-reviewed research
6. INCLUDE DIRECT URLS for all sources in clickable format

Do NOT include introductions, preamble, or explanations of what you'll do - start with the verdict immediately."""

    try:
        logger.debug(f"Starting fact-check with Claude (text length: {len(text)})")

        # Message history for multi-turn interaction
        messages = [{"role": "user", "content": prompt}]

        # Tool use loop
        max_iterations = 3
        for iteration in range(max_iterations):
            logger.debug(f"Claude iteration {iteration + 1}/{max_iterations}")

            async with httpx.AsyncClient(timeout=60.0) as client:
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
                        "max_tokens": 4000,
                        "tools": TOOLS,
                        "messages": messages
                    }
                )

                if not response.is_success:
                    error_data = response.json()
                    logger.error(f"Claude API error: {error_data}")
                    raise Exception(f"Claude API error: {error_data.get('error', {}).get('message', 'Unknown error')}")

                data = response.json()
                assistant_message = {"role": "assistant", "content": data["content"]}
                messages.append(assistant_message)

                # Check if Claude wants to use tools
                has_tool_use = False
                has_text = False
                tool_results = []

                for content_block in data["content"]:
                    if content_block.get("type") == "text":
                        has_text = True
                    elif content_block.get("type") == "tool_use":
                        has_tool_use = True
                        tool_name = content_block.get("name")
                        tool_input = content_block.get("input")
                        tool_use_id = content_block.get("id")

                        logger.debug(f"Claude requested tool: {tool_name}")

                        if tool_name == "web_search":
                            query = tool_input.get("query")
                            logger.debug(f"Performing web search: {query}")
                            results = await search_web(query)

                            # Format results for Claude
                            result_text = f"Search results for '{query}':\n"
                            for i, result in enumerate(results, 1):
                                result_text += f"{i}. {result['title']}\n   {result['snippet']}\n   URL: {result['url']}\n"

                            tool_results.append({
                                "type": "tool_result",
                                "tool_use_id": tool_use_id,
                                "content": result_text
                            })

                # If Claude used tools, send results back and continue
                if has_tool_use and tool_results:
                    logger.debug(f"Claude requested {len(tool_results)} tool(s), continuing iteration")
                    messages.append({"role": "user", "content": tool_results})
                    # Continue the loop to get Claude's next response
                elif has_text:
                    # Claude provided text without requesting tools - we have the analysis
                    logger.debug("Claude provided final analysis without more tools, stopping iteration")
                    break
                else:
                    # Claude finished without providing text or tools - ask for analysis
                    logger.debug("Claude finished without text or tools, requesting final analysis")
                    messages.append({
                        "role": "user",
                        "content": "Based on all the information gathered, please provide your complete fact-checking analysis now."
                    })

            # If we're at the last iteration, break
            if iteration == max_iterations - 1:
                logger.debug(f"Reached max iterations ({max_iterations}), exiting loop")
                break

        # Extract final text response - search backwards through messages for latest assistant text
        logger.debug(f"Messages length: {len(messages)}")

        final_response = ""
        # Search from the end of messages backwards to find the last text response
        for i in range(len(messages) - 1, -1, -1):
            msg = messages[i]
            logger.debug(f"Checking message {i}, role: {msg.get('role')}")
            if msg.get("role") == "assistant":
                content = msg.get("content", [])
                for content_block in content:
                    logger.debug(f"Content block type: {content_block.get('type')}")
                    if content_block.get("type") == "text":
                        final_response = content_block.get("text", "")
                        logger.debug(f"Found text block: {final_response[:100]}...")
                        break
                if final_response:
                    break

        if not final_response:
            logger.error("No text response found in Claude messages")
            for i, msg in enumerate(messages):
                logger.error(f"Message {i}: {msg}")
            raise Exception("Claude did not return text analysis")

        # Truncate response if too long to keep UI responsive
        max_response_length = 3000
        if len(final_response) > max_response_length:
            final_response = final_response[:max_response_length].rstrip() + "\n\n[Analysis truncated for display. Full analysis available on backend.]"
            logger.debug(f"Truncated response from {len(final_response)} to {max_response_length} chars")

        logger.debug(f"Claude analysis complete (length: {len(final_response)})")
        return final_response

    except httpx.TimeoutException as e:
        logger.error(f"Claude API request timed out: {e}")
        # Return partial results if we have them
        if len(messages) > 1:
            for content_block in messages[-1].get("content", []):
                if content_block.get("type") == "text":
                    return content_block.get("text", "Analysis timed out. Partial results above.")
        raise Exception("Fact-checking request timed out. Please try again.")
    except Exception as e:
        logger.error(f"Claude fact-check request failed: {e}", exc_info=True)
        raise

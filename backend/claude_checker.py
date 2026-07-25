import httpx
import json
import logging
import os
import re
from datetime import datetime
from typing import Optional, Any
from config import settings

logger = logging.getLogger(__name__)

SERPER_API_URL = "https://google.serper.dev/search"
CLAUDE_API_URL = "https://api.anthropic.com/v1/messages"

# Where full Claude conversations get dumped, one entry per fact-check request.
CONVERSATION_LOG_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "logs")
CONVERSATION_LOG_PATH = os.path.join(CONVERSATION_LOG_DIR, "claude_conversations.log")

# Current model - can be changed via settings endpoint
CURRENT_MODEL = "claude-sonnet-4-6"

# Available models
AVAILABLE_MODELS = {
    "sonnet": "claude-sonnet-4-6",
    "opus": "claude-opus-4-8"
}

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
    },
    {
        "name": "submit_fact_check",
        "description": (
            "Submit the completed fact-check analysis. This is the ONLY way to return "
            "your final results - plain text responses are never shown to the user. "
            "Call this exactly once, after you have used web_search to verify each claim. "
            "Do not call it to describe what you're about to do; call it only when the "
            "analysis argument already contains the finished, complete write-up."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "analysis": {
                    "type": "string",
                    "description": (
                        "The complete fact-check analysis in markdown, following the required "
                        "format: Claim / Verdict / Sources / Evidence for each claim. This exact "
                        "text is shown to the user verbatim."
                    )
                }
            },
            "required": ["analysis"]
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


def _format_message_for_log(msg: dict) -> str:
    """Render a single Claude API message (string or content-block-list) as readable text."""
    role = msg.get("role", "unknown").upper()
    content = msg.get("content", "")

    if isinstance(content, str):
        return f"[{role}]\n{content}"

    parts = []
    for block in content:
        block_type = block.get("type")
        if block_type == "text":
            parts.append(block.get("text", ""))
        elif block_type == "tool_use":
            parts.append(f"[TOOL CALL: {block.get('name')}({json.dumps(block.get('input', {}))})]")
        elif block_type == "tool_result":
            parts.append(f"[TOOL RESULT]\n{block.get('content', '')}")
        else:
            parts.append(json.dumps(block))
    return f"[{role}]\n" + "\n".join(parts)


def dump_conversation(messages: list, final_response: str = None, error: str = None) -> None:
    """Append the full Claude conversation to a log file.

    Each call's transcript is appended as one entry, separated from the
    previous entry by a double '----------' separator line.
    """
    try:
        os.makedirs(CONVERSATION_LOG_DIR, exist_ok=True)

        lines = [f"Timestamp: {datetime.utcnow().isoformat()}Z", f"Model: {CURRENT_MODEL}", ""]
        for msg in messages:
            lines.append(_format_message_for_log(msg))
            lines.append("")

        if final_response:
            lines.append("[FINAL RESPONSE RETURNED TO USER]")
            lines.append(final_response)
            lines.append("")

        if error:
            lines.append(f"[ERROR] {error}")
            lines.append("")

        with open(CONVERSATION_LOG_PATH, "a", encoding="utf-8") as f:
            f.write("\n".join(lines))
            f.write("\n----------\n----------\n\n")
    except Exception as log_error:
        # A logging failure must never break the fact-check flow
        logger.error(f"Failed to write conversation log: {log_error}")


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
3. Once research is complete, call the submit_fact_check tool with the analysis argument containing:
   - **Claim**: [brief statement]
   - **Verdict**: True/False/Misleading/Unverified
   - **Sources**: List primary sources with direct URLs (e.g., official websites, academic papers, government reports)
   - **Evidence**: Brief explanation of what the sources say
4. BE CONCISE - use short paragraphs, bullet points where possible
5. PRIORITIZE PRIMARY SOURCES - link to original reports, official statements, peer-reviewed research
6. INCLUDE DIRECT URLS for all sources in clickable format

Do not write the final analysis as a plain text message - it will not be shown to the user. The
submit_fact_check tool call is the only way to deliver your results. Do not include introductions,
preamble, or explanations of what you're about to do in plain text; use web_search silently and then
call submit_fact_check once, directly, with the complete analysis."""

    try:
        logger.debug(f"Starting fact-check with Claude (text length: {len(text)})")

        # Message history for multi-turn interaction
        messages = [{"role": "user", "content": prompt}]

        # Tool use loop - continue until submit_fact_check is called
        max_iterations = 8
        final_response = ""
        for iteration in range(max_iterations):
            logger.debug(f"Claude iteration {iteration + 1}/{max_iterations}")

            is_last_iteration = iteration == max_iterations - 1
            request_json = {
                "model": CURRENT_MODEL,
                "max_tokens": 4000,
                "tools": TOOLS,
                "messages": messages
            }
            if is_last_iteration:
                # Out of research turns - force Claude to wrap up with whatever it has
                # gathered so far instead of risking another round of web_search calls
                # that would silently run out the clock with nothing ever submitted.
                request_json["tool_choice"] = {"type": "tool", "name": "submit_fact_check"}

            async with httpx.AsyncClient(timeout=60.0) as client:
                response = await client.post(
                    CLAUDE_API_URL,
                    headers={
                        "x-api-key": settings.claude_api_key,
                        "anthropic-version": "2023-06-01",
                        "content-type": "application/json",
                        "anthropic-dangerous-direct-browser-access": "true"
                    },
                    json=request_json
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
                tool_results = []
                submitted_analysis = None

                for content_block in data["content"]:
                    if content_block.get("type") == "tool_use":
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
                        elif tool_name == "submit_fact_check":
                            # Explicit, structural end-of-analysis signal - Claude calling this
                            # tool is the ONLY way final_response gets set. No more guessing
                            # intent from free-text keywords (planning language vs. real
                            # analysis is ambiguous and impossible to regex-match reliably).
                            submitted_analysis = tool_input.get("analysis", "")
                            logger.debug(f"Claude submitted final analysis ({len(submitted_analysis)} chars)")

                # A submit_fact_check call always ends the loop immediately, even if other
                # tool_use blocks (e.g. a stray web_search) appeared in the same turn.
                if submitted_analysis is not None:
                    final_response = submitted_analysis
                    break
                elif has_tool_use and tool_results:
                    logger.debug(f"Claude requested {len(tool_results)} tool(s), continuing iteration")
                    messages.append({"role": "user", "content": tool_results})
                    # Continue the loop to get Claude's next response
                else:
                    # Claude wrote plain text (or nothing) without calling submit_fact_check -
                    # plain text is never shown to the user, so just ask again.
                    logger.debug("No submit_fact_check call yet, prompting Claude to submit results")
                    messages.append({
                        "role": "user",
                        "content": (
                            "Please call the submit_fact_check tool now with your complete "
                            "analysis. Plain text responses are not shown to the user - only "
                            "the submit_fact_check tool call is."
                        )
                    })

            # If we're at the last iteration, break
            if iteration == max_iterations - 1:
                logger.debug(f"Reached max iterations ({max_iterations}), exiting loop")
                break

        if not final_response:
            # Safety net: Claude never called submit_fact_check within max_iterations.
            # Fall back to the last plain-text block rather than failing outright.
            logger.warning("Claude never called submit_fact_check, falling back to last text block")
            for i in range(len(messages) - 1, -1, -1):
                msg = messages[i]
                if msg.get("role") == "assistant":
                    for content_block in msg.get("content", []):
                        if content_block.get("type") == "text" and content_block.get("text"):
                            final_response = content_block["text"]
                            break
                if final_response:
                    break

        if not final_response or not final_response.strip():
            logger.error("No final analysis available after processing conversation")
            raise Exception("Claude did not return a fact-check analysis")

        logger.debug(f"Claude analysis complete (length: {len(final_response)})")
        dump_conversation(messages, final_response=final_response)
        return final_response

    except httpx.TimeoutException as e:
        logger.error(f"Claude API request timed out: {e}")
        # Return partial results if we have them
        if len(messages) > 1:
            for content_block in messages[-1].get("content", []):
                if content_block.get("type") == "text":
                    partial_text = content_block.get("text", "Analysis timed out. Partial results above.")
                    dump_conversation(messages, final_response=partial_text, error="TIMEOUT (partial result returned)")
                    return partial_text
        dump_conversation(messages, error="TIMEOUT (no partial result available)")
        raise Exception("Fact-checking request timed out. Please try again.")
    except Exception as e:
        logger.error(f"Claude fact-check request failed: {e}", exc_info=True)
        dump_conversation(messages, error=str(e))
        raise

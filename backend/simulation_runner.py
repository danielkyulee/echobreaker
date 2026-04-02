import asyncio
import json
import logging
from typing import AsyncGenerator, List

import anthropic

from config import settings
from persona_generator import Persona

logger = logging.getLogger(__name__)

_client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)

SYSTEM_PROMPT = """You are simulating how real Americans with diverse backgrounds respond to opinion surveys.
For each persona described, provide the response they would most plausibly give based on their
demographics, values, community, and lived experiences. Be accurate and realistic — people with
different backgrounds hold genuinely different views. Do not assume all personas agree."""

# Poll scale definitions
SCALES = {
    "opinion": {
        1: "Strongly Agree",
        2: "Somewhat Agree",
        3: "Neutral",
        4: "Somewhat Disagree",
        5: "Strongly Disagree",
        6: "No Opinion",
        "question": "Do you agree or disagree with this statement?",
    },
    "general": {
        1: "Very Positive",
        2: "Somewhat Positive",
        3: "Neutral",
        4: "Somewhat Negative",
        5: "Very Negative",
        6: "No Opinion",
        "question": "How do you feel about this post/statement?",
    },
}


def build_context_block(tweet_data: dict) -> str:
    """Build a context string from the full tweet data."""
    lines = []

    author_name = tweet_data.get("author_name", "")
    author_handle = tweet_data.get("author_handle", "")
    if author_name or author_handle:
        author_str = author_name
        if author_handle:
            author_str += f" ({author_handle})" if author_name else author_handle
        lines.append(f"Tweet author: {author_str}")

    parent = tweet_data.get("parent_tweet")
    replying_to = tweet_data.get("replying_to")

    if parent and parent.get("text"):
        parent_author = parent.get("author_handle") or parent.get("author_name") or replying_to or "unknown"
        lines.append(f"\nIn reply to {parent_author}:")
        lines.append(f'"{parent["text"]}"')
    elif replying_to:
        lines.append(f"In reply to: {replying_to}")

    quote = tweet_data.get("quote_tweet")
    if quote and quote.get("text"):
        quote_author = quote.get("author_handle") or quote.get("author_name") or "unknown"
        lines.append(f"\nQuoting {quote_author}:")
        lines.append(f'"{quote["text"]}"')

    return "\n".join(lines)


def _build_batch_prompt(
    personas: List[Persona],
    tweet_data: dict,
    tweet_type: str,
    characterizations: dict | None = None,
) -> str:
    scale = SCALES[tweet_type]
    context = build_context_block(tweet_data)
    tweet_text = tweet_data.get("text", "")
    question = scale["question"]

    context_section = f"{context}\n\n" if context else ""

    # Inject political pre-characterizations to ground LLM responses
    char_section = ""
    if characterizations:
        char_lines = "\n".join(
            f"- {group}: {char}" for group, char in characterizations.items()
        )
        char_section = (
            f"Political perspective context for this specific statement:\n"
            f"{char_lines}\n\n"
            f"Use these characterizations to inform your simulation. "
            f"They reflect realistic diversity within each group.\n\n"
        )

    scale_lines = "\n".join(
        f"{k} = {v}" for k, v in scale.items() if isinstance(k, int)
    )

    persona_lines = "\n".join(
        f"{p.id}. {p.to_description()}" for p in personas
    )

    return f"""{context_section}{char_section}Post/statement: "{tweet_text}"

Survey question: {question}

Response options (respond with the number only):
{scale_lines}

Personas:
{persona_lines}

Respond ONLY with a JSON array. No explanation, no code fences:
[{{"id": 1, "response": 3}}, {{"id": 2, "response": 5}}, ...]"""


def _strip_fence(text: str) -> str:
    text = text.strip()
    if text.startswith("```"):
        lines = text.split("\n")
        inner = lines[1:]
        if inner and inner[-1].strip() == "```":
            inner = inner[:-1]
        text = "\n".join(inner).strip()
    return text


async def _process_batch(
    personas: List[Persona],
    tweet_data: dict,
    tweet_type: str,
    semaphore: asyncio.Semaphore,
    characterizations: dict | None = None,
    retries: int = 2,
) -> List[dict]:
    async with semaphore:
        for attempt in range(retries + 1):
            try:
                response = await _client.messages.create(
                    model=settings.model,
                    max_tokens=settings.batch_max_tokens,
                    temperature=settings.temperature,
                    system=SYSTEM_PROMPT,
                    messages=[
                        {
                            "role": "user",
                            "content": _build_batch_prompt(
                                personas, tweet_data, tweet_type, characterizations
                            ),
                        }
                    ],
                )
                raw = _strip_fence(response.content[0].text)
                results = json.loads(raw)
                return [
                    {"persona_id": r["id"], "response": int(r["response"])}
                    for r in results
                    if 1 <= int(r.get("response", 0)) <= 6
                ]
            except (json.JSONDecodeError, anthropic.APIError) as e:
                if attempt == retries:
                    logger.warning(
                        "Batch failed after %d retries: %s. Skipping %d personas.",
                        retries, e, len(personas),
                    )
                    return []
                await asyncio.sleep(1.5 ** attempt)
    return []


async def run_simulation(
    personas: List[Persona],
    tweet_data: dict,
    tweet_type: str,
    characterizations: dict | None = None,
    batch_size: int | None = None,
    max_concurrent: int | None = None,
) -> AsyncGenerator[dict, None]:
    """
    Async generator yielding {"responses": [...]} as each batch completes.
    tweet_type: "opinion" or "general"
    characterizations: optional political pre-characterizations to inject
    """
    batch_size = batch_size or settings.batch_size
    max_concurrent = max_concurrent or settings.max_concurrent_batches
    semaphore = asyncio.Semaphore(max_concurrent)

    batches = [
        personas[i : i + batch_size]
        for i in range(0, len(personas), batch_size)
    ]

    tasks = [
        asyncio.create_task(
            _process_batch(batch, tweet_data, tweet_type, semaphore, characterizations)
        )
        for batch in batches
    ]

    for future in asyncio.as_completed(tasks):
        batch_responses = await future
        yield {"responses": batch_responses}

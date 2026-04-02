"""
Pre-characterizes how each political sub-type likely views a specific statement.
Runs 11 small parallel API calls before the main simulation, grounding the LLM
in topic-specific political context rather than generic stereotypes.

Cost: ~$0.01 per survey (11 calls × ~200 tokens each).
"""

import asyncio
import logging

import anthropic

from config import settings

logger = logging.getLogger(__name__)

_client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)

# Must stay in sync with persona_generator.py DISTRIBUTIONS["politics"]
POLITICAL_GROUPS = [
    "Trump loyalist Republican",
    "Traditional conservative Republican",
    "Libertarian-leaning Republican",
    "Moderate conservative Republican",
    "Lean Republican",
    "Independent",
    "Lean Democrat",
    "Progressive Democrat",
    "Mainstream liberal Democrat",
    "Moderate/centrist Democrat",
    "Other/No affiliation",
]


async def _characterize_one(group: str, statement: str, tweet_type: str) -> str:
    verb = "agree or disagree with" if tweet_type == "opinion" else "feel about"
    try:
        response = await _client.messages.create(
            model=settings.model,
            max_tokens=100,
            temperature=0.1,
            messages=[
                {
                    "role": "user",
                    "content": (
                        f'In 1-2 sentences, how would a typical "{group}" American '
                        f"{verb} this statement? Be realistic — acknowledge genuine "
                        f"disagreement within the group where it exists. Do not moralize.\n\n"
                        f'Statement: "{statement}"\n\n'
                        f"Reply with just the characterization, no preamble."
                    ),
                }
            ],
        )
        return response.content[0].text.strip()
    except Exception as e:
        logger.warning("Characterization failed for %s: %s", group, e)
        return ""


async def characterize_political_groups(
    statement: str, tweet_type: str
) -> dict[str, str]:
    """
    Returns {political_group: characterization} for all groups in parallel.
    Empty string for any group that fails (simulation proceeds without it).
    """
    results = await asyncio.gather(
        *[_characterize_one(g, statement, tweet_type) for g in POLITICAL_GROUPS]
    )
    chars = {g: r for g, r in zip(POLITICAL_GROUPS, results) if r}
    logger.info("Characterized %d / %d political groups.", len(chars), len(POLITICAL_GROUPS))
    return chars

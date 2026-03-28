"""
Classifies a tweet as 'opinion' or 'general' to determine poll format.
Does NOT modify or normalize the tweet text — it is used as-is.

opinion → Agree/Disagree Likert scale
general → Positive/Negative sentiment scale
skip    → Tweet has no surveyable content (e.g. "just had pizza")
"""

import json
import anthropic
from config import settings

_client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)


def _strip_fence(text: str) -> str:
    text = text.strip()
    if text.startswith("```"):
        lines = text.split("\n")
        inner = lines[1:]
        if inner and inner[-1].strip() == "```":
            inner = inner[:-1]
        text = "\n".join(inner).strip()
    return text


async def classify_tweet(tweet_text: str) -> dict:
    """
    Returns:
        {
            "type": "opinion" | "general" | "skip",
            "disclaimer": null | "short warning string"
        }

    type definitions:
        opinion — tweet expresses a clear opinion, belief, or claim that
                  people can meaningfully agree or disagree with
        general — tweet is news, an observation, a reaction, or a question
                  where sentiment (positive/negative) is the right measure
        skip    — no surveyable content (personal anecdote, spam, etc.)
    """
    response = await _client.messages.create(
        model=settings.model,
        max_tokens=150,
        temperature=0.1,
        messages=[
            {
                "role": "user",
                "content": f"""Classify this tweet for survey purposes.

Tweet: {tweet_text}

Rules:
- "opinion": tweet makes a claim, argument, or expresses a belief people
  can meaningfully agree or disagree with
- "general": tweet is news, an observation, a video/photo share, a question,
  or a reaction — where asking "how do you feel about this?" makes more sense
- "skip": no surveyable content at all (e.g. personal diary entry, spam)
- Set disclaimer to a short string if the topic is very recent breaking news;
  otherwise null

Respond ONLY with valid JSON, no explanation:
{{"type": "opinion", "disclaimer": null}}""",
            }
        ],
    )

    raw = _strip_fence(response.content[0].text)
    return json.loads(raw)

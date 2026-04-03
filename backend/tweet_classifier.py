"""
Classifies a tweet for survey purposes. Does NOT modify tweet text.

Returns:
  type        — "opinion" | "general" | "skip"
  thread      — "standalone" | "thread_start" | "thread_continuation"
  disclaimer  — null | short warning string
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
            "thread": "standalone" | "thread_start" | "thread_continuation",
            "disclaimer": null | "short warning string"
        }

    type:
        opinion   — expresses a belief people can agree/disagree with
        general   — news, observation, reaction, question (sentiment poll)
        skip      — no surveyable content

    thread:
        standalone          — complete self-contained tweet
        thread_start        — starts a thread (e.g. "1/", "🧵", "Thread:")
        thread_continuation — middle/end of a thread (e.g. "2/5", "cont.")
    """
    response = await _client.messages.create(
        model=settings.model,
        max_tokens=200,
        temperature=0.1,
        messages=[
            {
                "role": "user",
                "content": f"""Classify this tweet for survey purposes.

Tweet: {tweet_text}

Classify "type":
- "opinion": makes a DEBATABLE claim, argument, or policy position that reasonable people could agree OR disagree with (e.g. "Taxes should be higher", "AI will replace jobs")
- "general": personal declarations, emotional statements, news, observations, announcements, questions, or reactions where agree/disagree doesn't fit (e.g. "I'm proud of my faith", "This video is going viral", "RIP to a legend")
- "skip": no surveyable content (personal diary, spam, gibberish)

Classify "thread":
- "standalone": complete, self-contained tweet
- "thread_start": clearly starts a thread (signals: "1/", "1/n", "🧵", "Thread:", opening that implies more follows)
- "thread_continuation": clearly a later part of a thread (signals: "2/", "3/5", "(cont.)", starts mid-sentence, references "above" or "previous")

Set "disclaimer" to a short string if the topic is very recent breaking news the AI may lack data on; otherwise null.

Respond ONLY with valid JSON, no explanation:
{{"type": "opinion", "thread": "standalone", "disclaimer": null}}""",
            }
        ],
    )

    raw = _strip_fence(response.content[0].text)
    result = json.loads(raw)

    # Ensure thread field exists with a safe default
    if "thread" not in result:
        result["thread"] = "standalone"

    return result

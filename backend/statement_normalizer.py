import json
import anthropic
from config import settings

_client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)


def _strip_code_fence(text: str) -> str:
    text = text.strip()
    if text.startswith("```"):
        lines = text.split("\n")
        # Drop opening fence line and closing fence line
        inner = lines[1:]
        if inner and inner[-1].strip() == "```":
            inner = inner[:-1]
        text = "\n".join(inner).strip()
    return text


async def normalize_statement(tweet_text: str) -> dict:
    """
    Convert raw tweet text into a clean, survey-ready opinion statement.
    Returns:
        {
            "statement": str,
            "is_opinion": bool,
            "disclaimer": str | null
        }
    """
    response = await _client.messages.create(
        model=settings.model,
        max_tokens=300,
        temperature=0.2,
        messages=[
            {
                "role": "user",
                "content": f"""Convert the following tweet into a clear, neutral opinion statement
suitable for a public opinion survey.

Tweet: {tweet_text}

Rules:
- Extract the core opinion or claim as a single declarative sentence
- Remove hashtags, @mentions, URLs, and filler words
- If the tweet is sarcastic, convert it to the literal opinion being mocked
- Set is_opinion to false only if the tweet is purely factual with no opinion content
- Set disclaimer to a short warning string if the topic is very recent breaking news
  that an AI may not have data on; otherwise set to null

Respond ONLY with valid JSON, no explanation, no code fences:
{{
    "statement": "the normalized statement",
    "is_opinion": true,
    "disclaimer": null
}}""",
            }
        ],
    )

    raw = _strip_code_fence(response.content[0].text)
    return json.loads(raw)

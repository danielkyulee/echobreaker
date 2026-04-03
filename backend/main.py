import asyncio
import json
import logging
import uuid
from typing import Dict, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from aggregator import aggregate_results
from config import settings
from persona_generator import generate_personas
from simulation_runner import run_simulation
from political_characterizer import characterize_political_groups
from tweet_classifier import classify_tweet
from research_store import save_research_session, log_survey_usage

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="EchoBreaker API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory survey store: survey_id -> asyncio.Queue
# Note: single-instance only. Migrate to Redis for multi-instance Cloud Run.
_surveys: Dict[str, asyncio.Queue] = {}


class ParentTweet(BaseModel):
    text: str
    author_name: str = ""
    author_handle: str = ""


class SurveyRequest(BaseModel):
    # Core tweet content — used as-is, never modified
    text: str
    url: str = ""
    author_name: str = ""
    author_handle: str = ""
    replying_to: Optional[str] = None
    parent_tweet: Optional[ParentTweet] = None
    quote_tweet: Optional[ParentTweet] = None
    persona_count: int = 500


class ClassifyRequest(BaseModel):
    text: str


@app.post("/api/classify")
async def classify_only(request: ClassifyRequest):
    """Lightweight pre-survey classification — used by the extension before confirming."""
    result = await classify_tweet(request.text)
    if result.get("type") not in ("opinion", "general", "skip"):
        result["type"] = "general"
    return result


class ResearchSessionRequest(BaseModel):
    preSurvey: Optional[dict] = None
    postSurvey: Optional[dict] = None
    participantName: str = ""
    record: Optional[dict] = None


@app.post("/api/research/session")
async def save_research(request: ResearchSessionRequest):
    """Save a research study session (pre-survey + debrief + results)."""
    try:
        doc_id = save_research_session(request.model_dump())
        return {"session_id": doc_id}
    except Exception as e:
        logger.exception("Failed to save research session: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/health")
async def health():
    return {"status": "ok", "model": settings.model}


@app.post("/api/survey")
async def create_survey(request: SurveyRequest):
    survey_id = str(uuid.uuid4())
    queue: asyncio.Queue = asyncio.Queue()
    _surveys[survey_id] = queue

    asyncio.create_task(_process_survey(survey_id, request, queue))

    return {"survey_id": survey_id}


@app.get("/api/survey/{survey_id}/stream")
async def stream_survey(survey_id: str):
    if survey_id not in _surveys:
        raise HTTPException(status_code=404, detail="Survey not found")

    queue = _surveys[survey_id]

    async def event_generator():
        try:
            while True:
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=180.0)
                except asyncio.TimeoutError:
                    yield _sse("error", {"message": "Survey timed out"})
                    break

                yield _sse(event["type"], event["data"])

                if event["type"] in ("complete", "error", "skip"):
                    break
        finally:
            _surveys.pop(survey_id, None)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


async def _process_survey(
    survey_id: str, request: SurveyRequest, queue: asyncio.Queue
):
    try:
        # Step 0: Classify tweet type (opinion vs general vs skip)
        logger.info("[%s] Classifying tweet...", survey_id)
        classification = await classify_tweet(request.text)
        tweet_type = classification.get("type", "general")
        if tweet_type not in ("opinion", "general", "skip"):
            tweet_type = "general"
        thread = classification.get("thread", "standalone")
        disclaimer = classification.get("disclaimer")

        await queue.put({
            "type": "classified",
            "data": {
                "tweet_type": tweet_type,
                "thread": thread,
                "disclaimer": disclaimer,
            }
        })

        if tweet_type == "skip":
            await queue.put({
                "type": "skip",
                "data": {"message": "This tweet doesn't contain a surveyable opinion or topic."}
            })
            return

        # Step 1: Generate personas + pre-characterize political groups (in parallel)
        persona_count = min(request.persona_count, 1000)
        logger.info("[%s] Generating personas + characterizing political groups...", survey_id)

        tweet_data = {
            "text": request.text,
            "url": request.url,
            "author_name": request.author_name,
            "author_handle": request.author_handle,
            "replying_to": request.replying_to,
            "parent_tweet": request.parent_tweet.model_dump() if request.parent_tweet else None,
            "quote_tweet": request.quote_tweet.model_dump() if request.quote_tweet else None,
        }

        if settings.enable_characterizer:
            personas, characterizations = await asyncio.gather(
                asyncio.to_thread(generate_personas, persona_count),
                characterize_political_groups(request.text, tweet_type),
            )
        else:
            personas = generate_personas(persona_count)
            characterizations = None

        await queue.put(
            {"type": "progress", "data": {"completed": 0, "total": persona_count}}
        )

        # Step 2: Run batched simulation with characterizations injected
        all_responses: list = []
        async for batch_result in run_simulation(
            personas, tweet_data, tweet_type, characterizations
        ):
            all_responses.extend(batch_result["responses"])
            await queue.put({
                "type": "progress",
                "data": {
                    "completed": len(all_responses),
                    "total": persona_count,
                },
            })

        # Step 3: Aggregate and return
        logger.info("[%s] Aggregating %d responses...", survey_id, len(all_responses))
        results = aggregate_results(personas, all_responses, tweet_type)
        await queue.put({"type": "complete", "data": results})
        logger.info("[%s] Survey complete.", survey_id)

        # Log every survey to Firestore for analytics
        try:
            log_survey_usage({**tweet_data, "tweet_type": tweet_type})
        except Exception as e:
            logger.warning("[%s] Failed to log survey usage: %s", survey_id, e)

    except Exception as e:
        logger.exception("[%s] Survey failed: %s", survey_id, e)
        await queue.put({"type": "error", "data": {"message": str(e)}})


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=settings.port, reload=True)

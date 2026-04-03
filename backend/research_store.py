"""
Firestore integration for research study data.
Stores pre-survey estimates, post-survey debrief, and survey results.
"""

import logging
from datetime import datetime, timezone

from google.cloud import firestore

logger = logging.getLogger(__name__)

_db = None


def _get_db():
    global _db
    if _db is None:
        _db = firestore.Client()
    return _db


def save_research_session(data: dict) -> str:
    """Save a complete research session (pre-survey + results + debrief)."""
    db = _get_db()

    participant_name = data.get("participantName", "anonymous")
    pre_survey = data.get("preSurvey", {})
    post_survey = data.get("postSurvey", {})
    record = data.get("record") or {}

    doc = {
        "participant_name": participant_name,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "tweet_text": record.get("tweetText", ""),
        "tweet_url": record.get("tweetUrl", ""),
        "author_name": record.get("authorName", ""),
        "author_handle": record.get("authorHandle", ""),
        "tweet_type": record.get("results", {}).get("tweet_type", ""),
        "pre_survey": {
            "estimates": pre_survey.get("estimates", {}),
            "cues": pre_survey.get("cues", ""),
        },
        "survey_results": record.get("results", {}),
        "post_survey": {
            "surprise": post_survey.get("surprise"),
            "trust": post_survey.get("trust", ""),
            "changed_belief": post_survey.get("changed_belief", ""),
            "open_response": post_survey.get("open_response", ""),
        },
    }

    ref = db.collection("research_sessions").add(doc)
    doc_id = ref[1].id
    logger.info("Saved research session %s for %s", doc_id, participant_name)

    # Also track the participant
    _upsert_participant(db, participant_name)

    return doc_id


def _upsert_participant(db, name: str):
    """Track participant and increment their survey count."""
    if not name:
        return
    ref = db.collection("participants").document(name)
    doc = ref.get()
    if doc.exists:
        ref.update({
            "surveys_completed": firestore.Increment(1),
            "last_active": datetime.now(timezone.utc).isoformat(),
        })
    else:
        ref.set({
            "name": name,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "surveys_completed": 1,
            "last_active": datetime.now(timezone.utc).isoformat(),
        })


def log_survey_usage(data: dict):
    """Log every survey run (research mode or not) for analytics."""
    db = _get_db()
    doc = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "tweet_text": data.get("text", ""),
        "tweet_url": data.get("url", ""),
        "author_handle": data.get("author_handle", ""),
        "tweet_type": data.get("tweet_type", ""),
    }
    db.collection("survey_log").add(doc)

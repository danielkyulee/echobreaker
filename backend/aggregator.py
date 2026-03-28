from typing import List

from persona_generator import Persona

RESPONSE_LABELS = {
    1: "strongly_agree",
    2: "somewhat_agree",
    3: "neutral",
    4: "somewhat_disagree",
    5: "strongly_disagree",
}

DIMENSION_MAP = {
    "by_age": "age_group",
    "by_gender": "gender",
    "by_region": "region",
    "by_urbanicity": "urbanicity",
    "by_education": "education",
    "by_income": "income",
    "by_race": "race",
    "by_politics": "politics",
}


def _distribution(responses: List[int]) -> dict:
    """Compute percentage distribution over 5-point Likert scale."""
    counts = {label: 0 for label in RESPONSE_LABELS.values()}
    for r in responses:
        label = RESPONSE_LABELS.get(r)
        if label:
            counts[label] += 1
    total = len(responses) or 1
    return {label: round(count / total, 4) for label, count in counts.items()}


def _breakdown_by(
    personas: List[Persona],
    response_map: dict,
    attribute: str,
) -> dict:
    groups: dict[str, List[int]] = {}
    for persona in personas:
        value = getattr(persona, attribute)
        response = response_map.get(persona.id)
        if response is None:
            continue
        groups.setdefault(value, []).append(response)
    return {value: _distribution(responses) for value, responses in groups.items()}


def _top_segments(breakdowns: dict) -> tuple[list, list]:
    segments = []
    for key, groups in breakdowns.items():
        dimension = key.replace("by_", "")
        for group_name, dist in groups.items():
            agree = dist.get("strongly_agree", 0) + dist.get("somewhat_agree", 0)
            disagree = dist.get("strongly_disagree", 0) + dist.get("somewhat_disagree", 0)
            segments.append(
                {
                    "dimension": dimension,
                    "group": group_name,
                    "agree_pct": round(agree, 4),
                    "disagree_pct": round(disagree, 4),
                }
            )

    top_agreeing = sorted(segments, key=lambda x: x["agree_pct"], reverse=True)[:3]
    top_disagreeing = sorted(segments, key=lambda x: x["disagree_pct"], reverse=True)[:3]
    return top_agreeing, top_disagreeing


def aggregate_results(personas: List[Persona], responses: List[dict], tweet_type: str = "opinion") -> dict:
    """
    Aggregate raw persona responses into overall + demographic breakdowns.
    """
    response_map = {r["persona_id"]: r["response"] for r in responses}

    overall_responses = [
        response_map[p.id] for p in personas if p.id in response_map
    ]
    overall = _distribution(overall_responses)

    breakdowns = {
        key: _breakdown_by(personas, response_map, attr)
        for key, attr in DIMENSION_MAP.items()
    }

    top_agreeing, top_disagreeing = _top_segments(breakdowns)

    # Label keys depend on poll type so the front end knows what to display
    if tweet_type == "general":
        label_map = {
            "strongly_agree": "very_positive",
            "somewhat_agree": "somewhat_positive",
            "neutral": "neutral",
            "somewhat_disagree": "somewhat_negative",
            "strongly_disagree": "very_negative",
        }
        def relabel(dist: dict) -> dict:
            return {label_map[k]: v for k, v in dist.items()}

        overall = relabel(overall)
        breakdowns = {k: {g: relabel(d) for g, d in v.items()} for k, v in breakdowns.items()}
        top_agreeing = [
            {**s, "dimension": s["dimension"]} for s in top_agreeing
        ]
        top_disagreeing = [
            {**s, "dimension": s["dimension"]} for s in top_disagreeing
        ]

    return {
        "tweet_type": tweet_type,
        "overall": overall,
        **breakdowns,
        "top_agreeing": top_agreeing,
        "top_disagreeing": top_disagreeing,
        "total_respondents": len(overall_responses),
    }

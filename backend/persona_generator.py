from dataclasses import dataclass
from typing import List
import numpy as np

# All distributions based on US Census Bureau 2023 + Pew Research 2023
DISTRIBUTIONS: dict[str, dict[str, float]] = {
    "age_group": {
        "18-24": 0.12,
        "25-34": 0.17,
        "35-44": 0.16,
        "45-54": 0.16,
        "55-64": 0.16,
        "65+": 0.23,
    },
    "gender": {
        "Male": 0.49,
        "Female": 0.49,
        "Non-binary": 0.02,
    },
    "region": {
        "Northeast": 0.18,
        "South": 0.38,
        "Midwest": 0.21,
        "West": 0.23,
    },
    "urbanicity": {
        "Urban": 0.31,
        "Suburban": 0.55,
        "Rural": 0.14,
    },
    "education": {
        "No college": 0.27,
        "Some college": 0.29,
        "Bachelor's degree": 0.24,
        "Graduate degree": 0.20,
    },
    "income": {
        "Under $30K": 0.27,
        "$30K-$60K": 0.28,
        "$60K-$100K": 0.24,
        "Over $100K": 0.21,
    },
    "race": {
        "White": 0.60,
        "Hispanic": 0.19,
        "Black": 0.13,
        "Asian": 0.06,
        "Other": 0.02,
    },
    # Political affiliation — Strong partisans split into sub-types to capture
    # genuine intra-party diversity (Pew Research 2023 + PRRI 2023)
    "politics": {
        # Strong Republican sub-types (~17% total)
        "Trump loyalist Republican":        0.080,  # MAGA base
        "Traditional conservative Republican": 0.050,  # establishment/Reagan conservative
        "Libertarian-leaning Republican":   0.025,  # small-govt, anti-interventionist
        "Moderate conservative Republican": 0.015,  # fiscal conservative, socially moderate
        # Other partisan / non-partisan
        "Lean Republican":                  0.170,
        "Independent":                      0.270,
        "Lean Democrat":                    0.170,
        # Strong Democrat sub-types (~16% total)
        "Progressive Democrat":             0.060,  # Bernie/AOC wing
        "Mainstream liberal Democrat":      0.070,  # Obama/Biden Democrat
        "Moderate/centrist Democrat":       0.030,  # blue-dog / swing-state Democrat
        # Non-aligned
        "Other/No affiliation":             0.060,
    },
}


@dataclass
class Persona:
    id: int
    age_group: str
    gender: str
    region: str
    urbanicity: str
    education: str
    income: str
    race: str
    politics: str

    def to_description(self) -> str:
        return (
            f"Age group: {self.age_group}, Gender: {self.gender}, "
            f"Region: {self.region} ({self.urbanicity}), "
            f"Education: {self.education}, Income: {self.income}, "
            f"Race/Ethnicity: {self.race}, Political leaning: {self.politics}"
        )


def generate_personas(count: int = 500) -> List[Persona]:
    """
    Dynamically sample personas from Census-weighted distributions.
    Each dimension is sampled independently to capture intersectional diversity.
    """
    rng = np.random.default_rng()
    personas = []

    for i in range(count):
        sampled = {
            dim: str(
                rng.choice(
                    list(probs.keys()),
                    p=list(probs.values()),
                )
            )
            for dim, probs in DISTRIBUTIONS.items()
        }
        personas.append(Persona(id=i + 1, **sampled))

    return personas

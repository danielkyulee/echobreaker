import os
from dotenv import load_dotenv

load_dotenv()


class Settings:
    anthropic_api_key: str = os.getenv("ANTHROPIC_API_KEY", "")
    # Swap model here to upgrade/downgrade (e.g. "claude-opus-4-6" for higher accuracy)
    model: str = os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4-6")
    temperature: float = float(os.getenv("TEMPERATURE", "0.7"))
    batch_max_tokens: int = int(os.getenv("BATCH_MAX_TOKENS", "1000"))
    persona_count: int = int(os.getenv("PERSONA_COUNT", "500"))
    batch_size: int = int(os.getenv("BATCH_SIZE", "25"))
    max_concurrent_batches: int = int(os.getenv("MAX_CONCURRENT_BATCHES", "5"))
    port: int = int(os.getenv("PORT", "8080"))
    cors_origins: list = ["*"]  # Tighten in production


settings = Settings()

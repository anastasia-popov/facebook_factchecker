from pydantic_settings import BaseSettings
from pydantic import field_validator


class Settings(BaseSettings):
    # Existing API Keys
    claimbuster_api_key: str = ""
    google_api_key: str = ""
    claude_api_key: str = ""
    serper_api_key: str = ""

    # OAuth Settings - Google
    google_oauth_client_id: str = ""
    google_oauth_client_secret: str = ""

    # JWT Settings
    jwt_secret_key: str = ""
    jwt_algorithm: str = "HS256"
    jwt_expiration_minutes: int = 60
    refresh_token_expiration_days: int = 30

    # Database
    database_url: str = "sqlite:///./factchecker.db"

    # Backend URL (for OAuth redirects)
    backend_url: str = "http://localhost:8000"

    # Per-request cost estimation for fact-checks. Neither Claude nor Serper
    # return a dollar amount in their API responses - these rates (USD) are
    # what we multiply usage by. They must match your actual Anthropic/Serper
    # billing plan; verify against your account's pricing page and update via
    # env vars if your plan differs from these defaults.
    claude_sonnet_input_price_per_mtok: float = 3.0
    claude_sonnet_output_price_per_mtok: float = 15.0
    claude_opus_input_price_per_mtok: float = 15.0
    claude_opus_output_price_per_mtok: float = 75.0
    serper_price_per_query: float = 0.001

    @field_validator('jwt_secret_key')
    @classmethod
    def jwt_secret_must_be_strong(cls, v):
        """Fail startup if JWT secret is missing or weak.

        An empty/short secret would allow anyone to forge valid tokens for any user.
        """
        if not v or len(v) < 32:
            raise ValueError(
                "JWT_SECRET_KEY must be set and at least 32 characters long. "
                "Generate one with: python -c \"import secrets; print(secrets.token_urlsafe(48))\""
            )
        return v

    class Config:
        env_file = ".env"


settings = Settings()

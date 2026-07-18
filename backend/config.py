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

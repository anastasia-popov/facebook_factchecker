from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # Existing API Keys
    claimbuster_api_key: str = ""
    google_api_key: str = ""
    claude_api_key: str = ""
    serper_api_key: str = ""

    # OAuth Settings - GitHub
    github_oauth_client_id: str = ""
    github_oauth_client_secret: str = ""

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

    class Config:
        env_file = ".env"


settings = Settings()

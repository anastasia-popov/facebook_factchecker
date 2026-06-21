from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    claimbuster_api_key: str = ""
    google_api_key: str = ""
    claude_api_key: str = ""
    serper_api_key: str = ""

    class Config:
        env_file = ".env"


settings = Settings()

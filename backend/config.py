import os
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    azure_openai_endpoint: str = os.getenv("AZURE_OPENAI_ENDPOINT", "")
    azure_openai_key: str = os.getenv("AZURE_OPENAI_KEY", "")
    azure_openai_deployment: str = os.getenv("AZURE_OPENAI_DEPLOYMENT", "gpt-4o")
    azure_openai_api_version: str = os.getenv("AZURE_OPENAI_API_VERSION", "2024-12-01-preview")

    azure_vision_endpoint: str = os.getenv("AZURE_VISION_ENDPOINT", "")
    azure_vision_key: str = os.getenv("AZURE_VISION_KEY", "")

    azure_blob_connection_string: str = os.getenv("AZURE_BLOB_CONNECTION_STRING", "")
    azure_blob_container: str = os.getenv("AZURE_BLOB_CONTAINER", "compliance-uploads")

    postgres_url: str = os.getenv("DATABASE_URL", "")

    upstash_redis_url: str = os.getenv("UPSTASH_REDIS_URL", "")
    upstash_redis_token: str = os.getenv("UPSTASH_REDIS_TOKEN", "")

    rules_file_path: str = "backend/data/rules.json"

    class Config:
        env_file = ".env"
        extra = "ignore"


settings = Settings()

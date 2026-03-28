from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    azure_openai_endpoint: str = ""
    azure_openai_key: str = ""
    azure_openai_deployment: str = "gpt-4o"
    azure_openai_api_version: str = "2024-12-01-preview"

    azure_vision_endpoint: str = ""
    azure_vision_key: str = ""

    azure_blob_connection_string: str = ""
    azure_blob_container: str = "compliance-uploads"

    database_url: str = ""

    upstash_redis_url: str = ""
    upstash_redis_token: str = ""

    cors_allowed_origins: str = ""
    rules_file_path: str = "backend/data/rules.json"

    model_config = {
        "env_file": ".env",
        "env_file_encoding": "utf-8",
        "extra": "ignore",
    }


settings = Settings()

import logging
import sys


def setup_logging():
    fmt = (
        "\033[90m%(asctime)s\033[0m "
        "%(levelname_colored)s "
        "\033[36m%(name_short)-18s\033[0m "
        "%(message)s"
    )
    datefmt = "%H:%M:%S"

    class ColorFormatter(logging.Formatter):
        COLORS = {
            "DEBUG": "\033[90mDEBUG  \033[0m",
            "INFO": "\033[32mINFO   \033[0m",
            "WARNING": "\033[33mWARN   \033[0m",
            "ERROR": "\033[31mERROR  \033[0m",
            "CRITICAL": "\033[1;31mCRIT   \033[0m",
        }

        def format(self, record):
            record.levelname_colored = self.COLORS.get(record.levelname, record.levelname)
            name = record.name
            if name.startswith("backend."):
                name = name[8:]
            if len(name) > 18:
                name = name[:17] + "…"
            record.name_short = name
            return super().format(record)

    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(ColorFormatter(fmt, datefmt=datefmt))

    root = logging.getLogger()
    root.setLevel(logging.INFO)
    root.handlers.clear()
    root.addHandler(handler)

    for noisy in [
        "uvicorn",
        "uvicorn.access",
        "uvicorn.error",
        "watchfiles",
        "httpcore",
        "httpx",
        "asyncpg",
        "azure",
        "azure.core",
        "azure.core.pipeline",
        "azure.core.pipeline.policies",
        "azure.core.pipeline.policies.http_logging_policy",
        "azure.identity",
        "azure.storage",
        "azure.ai",
        "openai",
        "openai._base_client",
    ]:
        logging.getLogger(noisy).setLevel(logging.WARNING)

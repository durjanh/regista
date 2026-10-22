"""OpenTelemetry to Azure Monitor / Application Insights (requests, dependencies, model calls, custom spans)."""

from __future__ import annotations

import logging

from ..config import settings

log = logging.getLogger("regista.telemetry")


def configure() -> bool:
    if not settings.appinsights:
        return False
    # Azure SDK request/response header dumps (Live Metrics posts every second) would flood the 1 GB/day log cap.
    logging.getLogger("azure.core.pipeline.policies.http_logging_policy").setLevel(logging.WARNING)
    try:
        from azure.monitor.opentelemetry import configure_azure_monitor
        configure_azure_monitor(connection_string=settings.appinsights, logger_name="regista")
        try:  # Agent Framework agent / chat / tool spans on the same providers; prompts and outputs stay out of telemetry
            from agent_framework.observability import enable_instrumentation
            enable_instrumentation(enable_sensitive_data=False)
        except Exception as exc:
            log.info("Agent Framework instrumentation unavailable: %s", exc)
        log.info("Azure Monitor OpenTelemetry configured")
        return True
    except Exception as exc:
        log.warning("Telemetry setup failed: %s", exc)
        return False

"""Integration fixtures: a REAL uvicorn server in a subprocess, reached over real sockets.

The unit suite (tests/*.py) runs the app in-process. These suites don't: `server` starts `uvicorn app.main:app` on a
free port, offline (no Azure), with CORS limited to a fake Static Web App origin, and tests talk to it with httpx,
SSE and the MCP client SDK exactly as a browser or an MCP client would.

    pytest -m integration --no-cov          # live server, no Azure
    REGISTA_IT_API_URL=https://... pytest -m deployed --no-cov
"""

from __future__ import annotations

import os
import socket
import subprocess
import sys
import tempfile
import time
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path

import httpx
import pytest

from .helpers import ALLOWED_ORIGIN

API_DIR = Path(__file__).resolve().parents[2]

# Never let a developer's Azure settings leak into the offline server.
AZURE_VARS = ("AZURE_OPENAI_ENDPOINT", "FOUNDRY_PROJECT_ENDPOINT", "AZURE_AI_SERVICES_ENDPOINT", "AZURE_AI_SERVICES_RESOURCE_ID",
              "COSMOS_ENDPOINT", "STORAGE_ACCOUNT_URL", "EVENTHUB_FQDN", "ONELAKE_WORKSPACE", "WEBPUBSUB_ENDPOINT",
              "APPLICATIONINSIGHTS_CONNECTION_STRING", "LIVE_SOURCE")


@dataclass
class Server:
    base: str
    log: Path

    def client(self, **kw) -> httpx.Client:
        return httpx.Client(base_url=self.base, timeout=kw.pop("timeout", 30), **kw)

    def tail(self, n: int = 40) -> str:
        return "\n".join(self.log.read_text(errors="replace").splitlines()[-n:])


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _start(extra_env: dict[str, str]) -> Iterator[Server]:
    port = _free_port()
    env = {k: v for k, v in os.environ.items() if k not in AZURE_VARS}
    env.update(REGISTA_OFFLINE="1", CORS_ORIGINS=ALLOWED_ORIGIN, PYTHONUNBUFFERED="1", **extra_env)
    log = Path(tempfile.mkstemp(prefix="regista-it-", suffix=".log")[1])
    with open(log, "w") as out:
        proc = subprocess.Popen([sys.executable, "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", str(port)],
                                cwd=API_DIR, env=env, stdout=out, stderr=subprocess.STDOUT)
    server = Server(f"http://127.0.0.1:{port}", log)
    deadline = time.time() + 120
    try:
        while True:
            if proc.poll() is not None:
                raise RuntimeError(f"uvicorn exited with {proc.returncode}:\n{server.tail()}")
            try:
                if httpx.get(f"{server.base}/api/health", timeout=2).status_code == 200:
                    break
            except httpx.HTTPError:
                pass
            if time.time() > deadline:
                raise RuntimeError(f"uvicorn not healthy after 120 s:\n{server.tail()}")
            time.sleep(0.5)
        yield server
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=15)
        except subprocess.TimeoutExpired:
            proc.kill()


@pytest.fixture(scope="session")
def server() -> Iterator[Server]:
    yield from _start({})


@pytest.fixture(scope="session")
def safe_server() -> Iterator[Server]:
    """A second server with video-safe mode on (trademarked competition names scrubbed)."""
    yield from _start({"REGISTA_VIDEO_SAFE": "1"})

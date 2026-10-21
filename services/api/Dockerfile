# Regista API. Build from the repository root so the image can bundle data/ (CC0 reference results and the
# pre-built real-result rebuilds):  docker build -f services/api/Dockerfile -t regista-api .
FROM python:3.12-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 PORT=8000
WORKDIR /srv/services/api

COPY services/api/requirements.txt .
RUN pip install --upgrade pip && pip install -r requirements.txt

COPY services/api/app ./app
COPY data /srv/data

RUN useradd --create-home --uid 10001 regista && chown -R regista /srv
USER regista

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/api/health').status==200 else 1)"
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT} --proxy-headers --forwarded-allow-ips='*'"]

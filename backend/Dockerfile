# Backend: FastAPI + OpenCV
FROM python:3.11-slim

# OpenCV needs these system libraries even with opencv-python-headless
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000

# Cloud Run injects the actual port via the PORT env var (usually 8080) —
# hardcoding a port here will cause "container failed to start" on deploy.
# Shell form (not the bracketed exec form) is required so $PORT gets substituted.
CMD exec uvicorn main:app --host 0.0.0.0 --port ${PORT:-8080}

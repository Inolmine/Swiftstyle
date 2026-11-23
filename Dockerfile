# Image de l'API photo : Python, MediaPipe et le modèle de pose, prête à lancer sur un serveur.
# Construire : docker build -t swiftstyle-api .
# Lancer :     docker run -p 8000:8000 -e ALLOWED_ORIGINS=https://mon-site.example swiftstyle-api
FROM python:3.14-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# Bibliothèques système d'OpenCV, que mediapipe installe avec lui.
RUN apt-get update \
 && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /srv/api

COPY requirements.txt .
RUN pip install -r requirements.txt

# Le modèle est téléchargé à la construction (environ 9 Mo, empreinte vérifiée) : l'image démarre sans réseau.
COPY scripts/ scripts/
RUN python scripts/download_model.py

COPY app/ app/

RUN useradd --system --uid 10001 --no-create-home api
USER api

# PORT : port d'écoute. WEB_CONCURRENCY : nombre de processus (chacun garde MediaPipe en mémoire).
# FORWARDED_ALLOW_IPS : proxys dont uvicorn croit l'en-tête X-Forwarded-For (adresse du client, pour la limite
# de requêtes). « * » suppose que l'API n'est joignable que par son proxy (Caddy, plateforme d'hébergement).
ENV PORT=8000 \
    WEB_CONCURRENCY=1 \
    FORWARDED_ALLOW_IPS=* \
    ALLOWED_ORIGINS=http://localhost:3000

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD ["python", "-c", "import os, urllib.request; urllib.request.urlopen('http://127.0.0.1:' + os.environ.get('PORT', '8000') + '/health', timeout=4)"]

CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port \"$PORT\" --workers \"$WEB_CONCURRENCY\" --proxy-headers"]

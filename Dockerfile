# Image Python stable et légère
FROM python:3.11-slim

# Dépendances système requises par OpenCV et MediaPipe sous Linux
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0 \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Installation des dépendances Python depuis backend
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copie du code backend
COPY backend/ ./

# Téléchargement automatique du modèle MediaPipe Pose Landmarker lors du build
RUN python scripts/download_model.py

# Port dynamique injecté par Railway (par défaut 8000 en local)
ENV PORT=8000
EXPOSE 8000

# Lancement de FastAPI
CMD ["python", "start.py"]

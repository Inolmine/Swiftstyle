# Image Node.js 22 officielle
FROM node:22-slim

WORKDIR /app

# Certificats pour les téléchargements HTTPS sécurisés
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Installation des dépendances
COPY package.json package-lock.json ./
RUN npm ci

# Copie de l'ensemble du code source
COPY . .

# Téléchargement du moteur MediaPipe, compilation du widget et build Next.js
RUN npm run build

# Variables d'environnement pour l'exécution
ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

# Démarrage de Next.js sur 0.0.0.0 et sur le port dynamique injecté par Railway
CMD ["sh", "-c", "npx next start -H 0.0.0.0 -p ${PORT:-3000}"]

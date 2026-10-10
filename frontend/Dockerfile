# Build-Kontext ist das Projektverzeichnis (wegen rechenkern/).
FROM node:22.14.0-bookworm-slim AS build
WORKDIR /bau/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY rechenkern/src /bau/rechenkern/src
COPY frontend/ ./
# Tests der Offline-Logik müssen grün sein, sonst kein Image
RUN npm test && npm run build

FROM nginx:1.27.4-alpine
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /bau/frontend/dist /usr/share/nginx/html

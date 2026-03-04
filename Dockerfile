FROM mcr.microsoft.com/playwright:v1.58.2-jammy AS base

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

FROM base AS web-build
RUN npm run build:web

FROM mcr.microsoft.com/playwright:v1.58.2-jammy AS runtime

WORKDIR /app

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
  && apt-get install -y --no-install-recommends nginx \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY docker/nginx/default.conf /etc/nginx/sites-available/default
COPY docker/start.sh /start.sh
COPY --from=web-build /app/web/dist /usr/share/nginx/html

RUN mkdir -p /app/data/site/images /var/lib/nginx /var/log/nginx \
  && chmod +x /start.sh

ENV API_PORT=6065
EXPOSE 80

CMD ["/start.sh"]

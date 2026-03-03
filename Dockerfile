FROM mcr.microsoft.com/playwright:v1.58.2-jammy AS base

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

FROM base AS web-build
RUN npm run build:web

FROM base AS api
ENV API_PORT=6065
EXPOSE 6065
CMD ["npm", "run", "dev:api"]

FROM nginx:1.27-alpine AS web
COPY docker/nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --from=web-build /app/web/dist /usr/share/nginx/html
EXPOSE 80

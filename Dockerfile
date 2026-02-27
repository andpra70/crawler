FROM mcr.microsoft.com/playwright:v1.52.0-jammy

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

ENV API_PORT=6065
EXPOSE 6064

CMD ["npm", "run", "dev"]

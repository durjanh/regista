# syntax=docker/dockerfile:1

# ---- build ----
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

# ---- serve ----
FROM nginxinc/nginx-unprivileged:alpine
# API_UPSTREAM: full URL of the API container, e.g. https://regista-api.<env>.azurecontainerapps.io
ENV API_UPSTREAM=http://127.0.0.1:8000
COPY nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080

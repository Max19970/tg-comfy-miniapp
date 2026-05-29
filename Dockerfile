FROM node:20-alpine AS build
WORKDIR /app

COPY package.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
RUN npm install

COPY . .
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/backend ./backend
COPY --from=build /app/frontend/dist ./frontend/dist
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/workflows ./workflows
COPY --from=build /app/config.example.yaml ./config.yaml

EXPOSE 8080
CMD ["node", "backend/src/server.js"]

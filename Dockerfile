FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json tsconfig.test.json jest.config.js ./
COPY src ./src
COPY test ./test
COPY scripts ./scripts
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY db ./db
EXPOSE 3000
CMD ["node", "dist/server.js"]

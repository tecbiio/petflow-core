FROM node:20-bookworm-slim AS base
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci
COPY prisma ./prisma
RUN npx prisma generate --schema=prisma/schema.prisma && npx prisma generate --schema=prisma/master.prisma

FROM deps AS build
COPY . .
RUN npm run build

FROM base AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/package-lock.json ./package-lock.json
COPY --from=build /app/tsconfig.json ./tsconfig.json
COPY --from=build /app/tsconfig.build.json ./tsconfig.build.json
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/prisma ./prisma
EXPOSE 3000
CMD ["sh", "-c", "node dist/main.js || node dist/src/main.js"]

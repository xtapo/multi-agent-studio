# ---------------------------------------------------------------------------
# One image, two roles.
#
# The web tier and the run worker share the entire codebase, so building two
# images would mean building the same thing twice and keeping them in lockstep.
# Instead the command decides the role:
#
#   web:     npm run start
#   worker:  npm run worker:start
#
# Trade-off: the image carries devDependencies because the worker is executed
# with tsx. Compiling the worker separately would shave off ~150MB; not worth
# the extra build step at this size.
# ---------------------------------------------------------------------------
FROM node:20-slim AS base

# Prisma needs OpenSSL on slim images.
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# ---------------------------------------------------------------------------
FROM base AS deps
COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund

# ---------------------------------------------------------------------------
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# next build imports env.ts, which validates the environment. These values are
# never used at runtime — the real ones are injected by the container.
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build?schema=public" \
    AUTH_SECRET="build-time-placeholder-secret" \
    ENCRYPTION_KEY="MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDE="

RUN npx prisma generate && npx next build

# ---------------------------------------------------------------------------
FROM base AS runtime
ENV NODE_ENV=production

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/src ./src
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/tsconfig.json ./tsconfig.json
COPY --from=build /app/next.config.mjs ./next.config.mjs

EXPOSE 3000
CMD ["npm", "run", "start"]

FROM node:20-bookworm-slim

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@10.28.2 --activate

WORKDIR /workspace

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY packages/shared-types/package.json packages/shared-types/package.json
COPY packages/ai-ready/package.json packages/ai-ready/package.json

RUN pnpm install --frozen-lockfile

COPY . .

RUN pnpm --filter @vpos/api prisma:generate \
  && pnpm --filter @vpos/api build

EXPOSE 3001

CMD ["pnpm", "--filter", "@vpos/api", "start"]

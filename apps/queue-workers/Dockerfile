# BullMQ worker runtime (plan 2b-15).
# Scanner binaries are PINNED and baked in at build time — never npx/fetched
# at runtime (plan §9).
FROM node:22-bookworm-slim

ARG GITLEAKS_VERSION=8.18.2
ARG SEMGREP_VERSION=1.72.0

RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates curl python3 python3-pip \
  && rm -rf /var/lib/apt/lists/*

# gitleaks — pinned release binary
RUN curl -fsSL "https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/gitleaks_${GITLEAKS_VERSION}_linux_x64.tar.gz" \
    | tar -xz -C /usr/local/bin gitleaks \
  && gitleaks version

# semgrep — pinned pip install
RUN pip3 install --no-cache-dir --break-system-packages "semgrep==${SEMGREP_VERSION}" \
  && semgrep --version

RUN corepack enable && corepack prepare pnpm@10.15.0 --activate

WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages ./packages
COPY apps/queue-workers ./apps/queue-workers
RUN pnpm install --frozen-lockfile --filter @repo/queue...

# Clone + lock volumes (plan §6). Lock dir pre-created at container start.
RUN mkdir -p /data/git-clones /data/git-locks
VOLUME ["/data/git-clones", "/data/git-locks"]
ENV GIT_CLONES_DIR=/data/git-clones \
    GIT_LOCKS_DIR=/data/git-locks

CMD ["pnpm", "--filter", "@repo/queue", "worker"]

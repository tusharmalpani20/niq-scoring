FROM oven/bun:1.4.0-alpine AS build
WORKDIR /workspace
COPY package.json bun.lock turbo.json tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
RUN bun install --frozen-lockfile
RUN bun run --cwd apps/api build

FROM build AS migrations
CMD ["bun", "run", "--cwd", "apps/api", "db:migrate"]

FROM oven/bun:1.4.0-alpine
RUN addgroup -S niq && adduser -S niq -G niq
WORKDIR /app
COPY --from=build /workspace/apps/api/dist ./dist
USER niq
EXPOSE 4100
CMD ["bun", "run", "dist/index.js"]

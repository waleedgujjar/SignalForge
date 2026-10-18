# Docker infrastructure notes

Local development uses the root `docker-compose.yml` for PostgreSQL and Redis.

Application processes (`apps/web`, `apps/api`, workers) run on the host via `pnpm dev`.

Optional Mailpit profile:

```bash
docker compose --profile mailpit up -d
```

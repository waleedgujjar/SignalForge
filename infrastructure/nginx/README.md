# Nginx Reverse Proxy

Production reverse proxy for SignalForge on Hostinger VPS.

## Files

- `nginx.conf` — Main config: worker processes, gzip, rate limit zones, body size limits
- `conf.d/default.conf` — Server block with routing, security headers, TLS placeholder

## Routing

| Path | Upstream | Notes |
|------|----------|-------|
| `/health` | `api:4000` | Unauthenticated, for external monitoring |
| `/api/auth/*` | `api:4000` | Strict rate limit (5 req/min) |
| `/api/*` | `api:4000` | `/api` prefix stripped before proxying |
| `/_next/static/*` | `web:3000` | Immutable cache (1 year) |
| `/*` | `web:3000` | Next.js frontend (default) |

## Security Headers

Applied to all responses: `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` (camera/mic/geo denied), `X-XSS-Protection`.

## TLS Setup

The HTTPS server block in `conf.d/default.conf` is commented out. To enable:

1. Install certbot on the VPS
2. Run: `certbot certonly --webroot -w /var/www/certbot -d yourdomain.com`
3. Uncomment the HTTPS server block and HTTP-to-HTTPS redirect in `conf.d/default.conf`
4. Replace `yourdomain.com` with the actual domain
5. Reload nginx: `docker compose -f docker-compose.prod.yml exec nginx nginx -s reload`

## Testing

Validate config syntax:

```bash
docker run --rm -v ./infrastructure/nginx:/etc/nginx:ro nginx:1.27-alpine nginx -t
```

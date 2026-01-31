# Docker Compose Deployment Analysis Report

## Intent Analysis

The Docker Compose deployment implementation in Claude Code Hub is designed to provide a production-ready, containerized deployment solution that encapsulates the entire application stack including PostgreSQL database, Redis cache, and the Next.js application. The primary intent is to offer users a "one-command" deployment experience while ensuring data persistence, service health monitoring, and proper service orchestration.

Key design goals include:
- **Simplicity**: Single `docker compose up -d` command to start all services
- **Data Persistence**: Volumes ensure data survives container restarts
- **Health Monitoring**: All services include health checks for dependency management
- **Security**: Database not exposed externally; credentials via environment variables
- **Flexibility**: Support for both manual deployment and automated script-based deployment

## Behavior Summary

### Service Orchestration Flow

1. **Startup Sequence**: Services start in dependency order:
   - `postgres` and `redis` start first (no dependencies)
   - `app` waits for both database and cache to be healthy (`condition: service_healthy`)

2. **Health Check Strategy**:
   - PostgreSQL: Uses `pg_isready` command to verify database accepts connections
   - Redis: Uses `redis-cli ping` to verify cache is responsive
   - App: HTTP GET to `/api/actions/health` endpoint

3. **Restart Policy**: All services use `unless-stopped` - containers restart automatically unless explicitly stopped by user

4. **Network Isolation**: Services communicate via internal Docker network; only app port is exposed externally

## Configuration Reference

### Services Overview

| Service | Image | Purpose | Internal Port |
|---------|-------|---------|---------------|
| postgres | postgres:18 | Primary database | 5432 |
| redis | redis:7-alpine | Session cache & rate limiting | 6379 |
| app | ghcr.io/ding113/claude-code-hub:latest | Main application | 3000 |

### Port Mappings

| Service | External | Internal | Notes |
|---------|----------|----------|-------|
| app | `${APP_PORT:-23000}` | 3000 | Only exposed port |
| postgres | (commented out) | 5432 | Internal access only |
| redis | (none) | 6379 | Internal access only |

**Security Note**: PostgreSQL port is intentionally not exposed externally. For debugging, uncomment lines 9-10 in `/Users/ding/Github/claude-code-hub/docker-compose.yaml`:
```yaml
ports:
  - "127.0.0.1:35432:5432"
```

### Volume Mounts

| Service | Host Path | Container Path | Purpose |
|---------|-----------|----------------|---------|
| postgres | `./data/postgres` | `/data` | Database persistence |
| redis | `./data/redis` | `/data` | AOF persistence |

**Important**: PostgreSQL uses custom `PGDATA: /data/pgdata` to avoid permission conflicts with volume mounts.

### Environment Variables

#### Database Configuration (from `.env`)
| Variable | Default | Description |
|----------|---------|-------------|
| `DB_USER` | postgres | PostgreSQL username |
| `DB_PASSWORD` | postgres | PostgreSQL password |
| `DB_NAME` | claude_code_hub | Database name |

#### Application Configuration
| Variable | Default | Description |
|----------|---------|-------------|
| `APP_PORT` | 23000 | External access port |
| `AUTO_MIGRATE` | true | Run migrations on startup |
| `ENABLE_RATE_LIMIT` | true | Enable Redis-based rate limiting |
| `SESSION_TTL` | 300 | Session cache TTL in seconds |
| `ADMIN_TOKEN` | (required) | Admin authentication token |

#### Internal Connection Strings (auto-configured)
```
DSN: postgresql://${DB_USER}:${DB_PASSWORD}@postgres:5432/${DB_NAME}
REDIS_URL: redis://redis:6379
```

### Health Check Configuration

**PostgreSQL**:
```yaml
test: ["CMD-SHELL", "pg_isready -U ${DB_USER} -d ${DB_NAME}"]
interval: 5s
timeout: 5s
retries: 10
start_period: 10s
```

**Redis**:
```yaml
test: ["CMD", "redis-cli", "ping"]
interval: 5s
timeout: 3s
retries: 5
start_period: 5s
```

**App**:
```yaml
test: ["CMD-SHELL", "curl -f http://localhost:3000/api/actions/health || exit 1"]
interval: 30s
timeout: 5s
retries: 3
start_period: 30s
```

## Edge Cases & Considerations

### 1. Data Persistence
- **Scenario**: Container is removed and recreated
- **Behavior**: Data persists in `./data/` directory on host
- **Risk**: If host directory is deleted, data is lost
- **Mitigation**: Regular backups of `./data/postgres`

### 2. Port Conflicts
- **Scenario**: Port 23000 is already in use
- **Error**: `bind: address already in use`
- **Solution**: Set `APP_PORT` environment variable to different port

### 3. Database Migration Failures
- **Scenario**: `AUTO_MIGRATE=true` but migration fails
- **Behavior**: App container may restart loop
- **Solution**: Check logs with `docker compose logs -f app`, manually run migrations

### 4. Redis Failover
- **Scenario**: Redis becomes unavailable
- **Behavior**: Rate limiting and session features degrade (Fail-Open)
- **Recovery**: Redis container auto-restarts; app reconnects automatically

### 5. Timezone Consistency
- All services configured with `TZ: Asia/Shanghai`
- Ensures consistent timestamp handling across logs and database records

## Upgrade Commands

### Standard Upgrade
```bash
cd /path/to/claude-code-hub
docker compose pull
docker compose up -d
```

### With Data Migration
```bash
# Backup first
cp -r data data.backup.$(date +%Y%m%d)

# Upgrade
docker compose pull
docker compose up -d

# Verify
docker compose ps
docker compose logs -f app
```

### Complete Reset (DATA LOSS)
```bash
docker compose down -v  # Remove volumes
rm -rf data/            # Delete persistent data
docker compose up -d    # Fresh start
```

## Required Environment Variables

### Minimum Required (from `.env.example`)

| Variable | Required | Purpose |
|----------|----------|---------|
| `ADMIN_TOKEN` | **YES** | Admin login authentication |
| `DB_PASSWORD` | Recommended | Database security |

### Docker Compose Specific

The following are auto-configured via `docker-compose.yaml` and typically don't need manual setting:
- `DSN` - Constructed from DB_* variables
- `REDIS_URL` - Hardcoded to `redis://redis:6379`
- `NODE_ENV` - Set to `production`

### Optional but Recommended

| Variable | Default | When to Override |
|----------|---------|------------------|
| `APP_PORT` | 23000 | Port conflicts |
| `SESSION_TTL` | 300 | Session caching needs |
| `ENABLE_RATE_LIMIT` | true | Disable for debugging |
| `AUTO_MIGRATE` | true | Disable for manual migration control |

## File References

- **Main Compose**: `/Users/ding/Github/claude-code-hub/docker-compose.yaml`
- **Development Compose**: `/Users/ding/Github/claude-code-hub/dev/docker-compose.yaml`
- **Dockerfile**: `/Users/ding/Github/claude-code-hub/deploy/Dockerfile`
- **Environment Template**: `/Users/ding/Github/claude-code-hub/.env.example`
- **Deploy Script (Linux/macOS)**: `/Users/ding/Github/claude-code-hub/scripts/deploy.sh`
- **Deploy Script (Windows)**: `/Users/ding/Github/claude-code-hub/scripts/deploy.ps1`

## Comparison: Production vs Development

| Aspect | Production (`docker-compose.yaml`) | Development (`dev/docker-compose.yaml`) |
|--------|-----------------------------------|----------------------------------------|
| App Image | Pre-built from GHCR | Local build from source |
| Postgres Port | Not exposed | Exposed on `${POSTGRES_PORT:-5432}` |
| Redis Port | Not exposed | Exposed on `${REDIS_PORT:-6379}` |
| Data Directory | `./data/postgres` | `../data/postgres-dev` |
| App Profile | Always starts | Requires `--profile app` |
| Health Check Interval | 30s | 15s |
| Admin Token | From `.env` | Default `cch-dev-admin` |

## Security Considerations

1. **Database Access**: PostgreSQL is only accessible within the Docker network
2. **Admin Token**: Must be changed from default; stored in `.env` with 600 permissions
3. **Image Source**: Uses GitHub Container Registry (ghcr.io) with signed images
4. **No Root**: App container runs as `node` user (UID/GID from base image)

---

*Report generated from source analysis of `/Users/ding/Github/claude-code-hub` repository*

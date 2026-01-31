# 脚本部署 - Code Exploration Report

## Intent Analysis

The script deployment system for Claude Code Hub is designed to provide a **one-click, fully automated deployment experience** across Linux, macOS, and Windows platforms. The primary intent is to eliminate manual configuration complexity and reduce deployment time from hours to minutes.

### Core Design Goals

1. **Zero-Configuration Deployment**: Users should be able to deploy the entire stack (PostgreSQL, Redis, Application) with a single command
2. **Cross-Platform Compatibility**: Support for Linux (server deployments), macOS (development), and Windows (enterprise environments)
3. **Security-First Approach**: Auto-generation of secure tokens and passwords, with proper file permission management
4. **Production-Ready Defaults**: Sensible defaults that work out-of-the-box while allowing customization
5. **HTTPS Support**: Built-in Caddy integration for automatic HTTPS via Let's Encrypt

### Target Users

- **DevOps Engineers**: Need quick, repeatable deployments
- **Developers**: Want local development environment setup
- **System Administrators**: Require secure, maintainable production deployments
- **Non-Technical Users**: Need simple deployment without deep Docker knowledge

---

## Behavior Summary

### Deployment Flow

The deployment scripts follow a consistent 10-step process:

```
1. Parse CLI Arguments → 2. Detect OS → 3. Validate Inputs → 4. Check/Install Docker
5. Select Branch → 6. Generate Secrets → 7. Create Directories → 8. Write Config Files
9. Start Services → 10. Health Check & Display Results
```

### OS-Specific Behaviors

#### Linux (`/Users/ding/Github/claude-code-hub/scripts/deploy.sh`)
- **Deployment Directory**: `/www/compose/claude-code-hub`
- **Docker Installation**: Automatic via `get.docker.com` script
- **Permissions**: Creates `/www` with proper ownership, sets `.env` to `chmod 600`
- **Service Management**: Uses `systemctl` for Docker service control
- **Requirements**: Root privileges required for Docker installation and `/www` creation

#### macOS (`/Users/ding/Github/claude-code-hub/scripts/deploy.sh`)
- **Deployment Directory**: `~/Applications/claude-code-hub`
- **Docker Installation**: Manual (user directed to Docker Desktop)
- **Permissions**: Standard user permissions
- **Network Detection**: Uses `ifconfig` for IP address discovery

#### Windows (`/Users/ding/Github/claude-code-hub/scripts/deploy.ps1`)
- **Deployment Directory**: `C:\ProgramData\claude-code-hub`
- **Docker Installation**: Opens Docker Desktop download page if not installed
- **Permissions**: ACL restrictions on `.env` file (owner-only access)
- **PowerShell Requirements**: Version 5.1 or higher

### Service Architecture

The deployment creates a multi-container setup:

```yaml
Services:
  - postgres: PostgreSQL 18 with health checks
  - redis: Redis 7 Alpine with AOF persistence
  - app: Claude Code Hub application (ghcr.io/ding113/claude-code-hub)
  - caddy: (Optional) Reverse proxy with automatic HTTPS
```

### Health Check Mechanism

All services implement Docker health checks:
- **Postgres**: `pg_isready` command, 5s interval, 10 retries
- **Redis**: `redis-cli ping`, 5s interval, 5 retries
- **App**: HTTP GET `/api/actions/health`, 30s interval, 3 retries

The deployment script waits up to 60 seconds (12 attempts × 5 seconds) for all services to become healthy.

---

## Config/Commands

### CLI Options

Both scripts support identical command-line interfaces:

| Option | Short | Description | Default | Validation |
|--------|-------|-------------|---------|------------|
| `--branch` | `-b` | Branch to deploy | `main` | Must be `main` or `dev` |
| `--port` | `-p` | External application port | `23000` | Range 1-65535 |
| `--admin-token` | `-t` | Custom admin token | Auto-generated | Minimum 16 characters |
| `--deploy-dir` | `-d` | Custom deployment directory | OS-specific | Must be writable |
| `--domain` | - | Domain for HTTPS | - | Valid domain format |
| `--enable-caddy` | - | Enable Caddy proxy | `false` | Implied by `--domain` |
| `--yes` | `-y` | Non-interactive mode | `false` | Skip all prompts |
| `--help` | `-h` | Show help message | - | - |

### Usage Examples

```bash
# Interactive deployment (Linux/macOS)
./deploy.sh

# Non-interactive with defaults
./deploy.sh -y

# Deploy dev branch on custom port
./deploy.sh -b dev -p 8080 -y

# Production deployment with HTTPS
./deploy.sh --domain hub.example.com -y

# HTTP-only reverse proxy
./deploy.sh --enable-caddy -y

# Custom admin token
./deploy.sh -t "my-secure-token-min-16-chars" -y
```

```powershell
# Windows PowerShell examples
.\deploy.ps1 -Yes
.\deploy.ps1 -Branch dev -Port 8080 -Yes
.\deploy.ps1 -Domain "hub.example.com" -Yes
```

### Generated Configuration Files

#### 1. docker-compose.yaml

Location: `${DEPLOY_DIR}/docker-compose.yaml`

Key configurations:
- **Container Naming**: Uses 4-character random suffix (e.g., `claude-code-hub-db-a1b2`)
- **Network Isolation**: Dedicated bridge network per deployment
- **Volume Mounts**: 
  - `./data/postgres:/data` (PostgreSQL data)
  - `./data/redis:/data` (Redis AOF data)
- **Port Exposure**:
  - Postgres: `127.0.0.1:35432:5432` (localhost only)
  - App: `${APP_PORT}:${APP_PORT}` (or no external port if Caddy enabled)
  - Caddy: `80:80` and `443:443` (when enabled)

#### 2. .env File

Location: `${DEPLOY_DIR}/.env` (permissions: 600/rw-------)

Generated variables:
```bash
ADMIN_TOKEN=<auto-generated-32-char-token>
DB_USER=postgres
DB_PASSWORD=<auto-generated-24-char-password>
DB_NAME=claude_code_hub
APP_PORT=23000
APP_URL=https://<domain> (if domain specified)
AUTO_MIGRATE=true
ENABLE_RATE_LIMIT=true
SESSION_TTL=300
STORE_SESSION_MESSAGES=false
ENABLE_SECURE_COOKIES=true/false (false if HTTP-only Caddy)
ENABLE_CIRCUIT_BREAKER_ON_NETWORK_ERRORS=false
NODE_ENV=production
TZ=Asia/Shanghai
LOG_LEVEL=info
```

#### 3. Caddyfile (Optional)

Location: `${DEPLOY_DIR}/Caddyfile`

**HTTPS Mode** (with domain):
```caddyfile
hub.example.com {
    reverse_proxy app:23000
    encode gzip
}
```

**HTTP Mode** (without domain):
```caddyfile
:80 {
    reverse_proxy app:23000
    encode gzip
}
```

### Environment Variable Defaults

| Variable | Default | Description |
|----------|---------|-------------|
| `ADMIN_TOKEN` | Auto-generated | 32-character secure random token |
| `DB_USER` | `postgres` | PostgreSQL username |
| `DB_PASSWORD` | Auto-generated | 24-character secure random password |
| `DB_NAME` | `claude_code_hub` | Database name |
| `APP_PORT` | `23000` | External application port |
| `APP_URL` | Empty | Application base URL |
| `AUTO_MIGRATE` | `true` | Run migrations on startup |
| `ENABLE_RATE_LIMIT` | `true` | Enable Redis-based rate limiting |
| `SESSION_TTL` | `300` | Session cache TTL in seconds |
| `STORE_SESSION_MESSAGES` | `false` | Store full message content |
| `ENABLE_SECURE_COOKIES` | `true` | HTTPS-only cookies |
| `ENABLE_CIRCUIT_BREAKER_ON_NETWORK_ERRORS` | `false` | Network error handling |
| `NODE_ENV` | `production` | Runtime environment |
| `TZ` | `Asia/Shanghai` | Timezone |
| `LOG_LEVEL` | `info` | Logging verbosity |

### Post-Deployment Commands

```bash
# View logs
cd ${DEPLOY_DIR} && docker compose logs -f

# Stop services
cd ${DEPLOY_DIR} && docker compose down

# Restart services
cd ${DEPLOY_DIR} && docker compose restart

# Pull latest images and restart
cd ${DEPLOY_DIR} && docker compose pull && docker compose up -d

# Check service status
cd ${DEPLOY_DIR} && docker compose ps

# Access database
cd ${DEPLOY_DIR} && docker compose exec postgres psql -U postgres -d claude_code_hub

# Access Redis
cd ${DEPLOY_DIR} && docker compose exec redis redis-cli
```

---

## Edge Cases

### 1. Docker Not Installed

**Linux**: Script automatically downloads and installs Docker via `get.docker.com`. Requires root privileges.

**macOS/Windows**: Script displays installation instructions and exits. Windows script offers to open Docker Desktop download page.

### 2. Port Conflicts

If the specified port is already in use:
- Docker Compose will fail to start the app container
- Health checks will fail
- Script displays warning but continues with partial deployment
- User must manually resolve conflict and restart

### 3. Invalid Admin Token

If provided token is less than 16 characters:
- Script validates length during input parsing
- Exits with error: "Admin token too short: minimum 16 characters required"

### 4. Invalid Domain Format

Domain validation uses regex pattern:
```regex
^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$
```

Invalid domains cause immediate exit with error message.

### 5. Health Check Timeout

If services don't become healthy within 60 seconds:
- Script displays warning: "Services did not become healthy within 60 seconds"
- Provides log inspection command
- Still displays success message with access URLs (services may still be starting)

### 6. Caddy with HTTP Only (No Domain)

When `--enable-caddy` is used without `--domain`:
- Caddy operates in HTTP-only mode on port 80
- `ENABLE_SECURE_COOKIES` is automatically set to `false`
- App port is not exposed externally (only accessible through Caddy)

### 7. Branch Selection

| Branch | Image Tag | Use Case |
|--------|-----------|----------|
| `main` | `latest` | Production/stable |
| `dev` | `dev` | Testing/latest features |

Invalid branch names cause immediate exit with error.

### 8. Permission Denied (Linux)

If running without sudo on Linux when required:
- `/www` directory creation fails
- Script detects EUID != 0 and exits with instructions to use sudo

### 9. Windows Execution Policy

PowerShell scripts may be blocked by execution policy:
- User must run: `Set-ExecutionPolicy -ExecutionPolicy Bypass -Scope Process -Force`
- Script provides this guidance if execution fails

### 10. Network Address Detection

Script attempts to detect network addresses for display:
- **Linux**: Uses `ip addr` or `ifconfig`, filters loopback and Docker networks
- **macOS**: Uses `ifconfig`, filters link-local addresses
- **Windows**: Uses `Get-NetIPAddress`, excludes loopback and Docker adapters

Always includes `localhost` as fallback.

### 11. Existing Deployment

If deployment directory already exists:
- Script continues and overwrites configuration files
- Data volumes (./data/postgres, ./data/redis) are preserved
- Allows idempotent re-deployment

### 12. Container Name Collisions

Random 4-character suffix (a-z0-9) ensures:
- Multiple deployments on same Docker host don't conflict
- Probability of collision: 1/1,679,616

---

## References

### Source Files

- `/Users/ding/Github/claude-code-hub/scripts/deploy.sh` — Main deployment script for Linux/macOS (788 lines, version 1.1.0)
- `/Users/ding/Github/claude-code-hub/scripts/deploy.ps1` — PowerShell deployment script for Windows (752 lines, version 1.1.0)
- `/Users/ding/Github/claude-code-hub/docker-compose.yaml` — Base Docker Compose configuration (76 lines)
- `/Users/ding/Github/claude-code-hub/.env.example` — Environment variable template (145 lines)

### Docker Images

- `ghcr.io/ding113/claude-code-hub:latest` — Production image (main branch)
- `ghcr.io/ding113/claude-code-hub:dev` — Development image (dev branch)
- `postgres:18` — Database service
- `redis:7-alpine` — Cache service
- `caddy:2-alpine` — Reverse proxy (optional)

### Deployment Directories

| OS | Default Path | Notes |
|----|--------------|-------|
| Linux | `/www/compose/claude-code-hub` | Requires root for initial creation |
| macOS | `~/Applications/claude-code-hub` | User-owned directory |
| Windows | `C:\ProgramData\claude-code-hub` | System-wide data directory |

### Health Check Endpoints

- **Application**: `GET /api/actions/health` — Returns 200 when healthy
- **Postgres**: `pg_isready` command
- **Redis**: `PING` command

### Security Considerations

1. **Admin Token**: 32-character cryptographically secure random string
2. **Database Password**: 24-character cryptographically secure random string
3. **File Permissions**: `.env` file set to 600 (owner read/write only)
4. **Network Exposure**: PostgreSQL only binds to localhost (127.0.0.1:35432)
5. **HTTPS**: Automatic Let's Encrypt certificates when domain specified

### Upgrade Procedure

```bash
# Navigate to deployment directory
cd ${DEPLOY_DIR}

# Pull latest images
docker compose pull

# Restart with new images
docker compose up -d

# Verify health
docker compose ps
```

### Troubleshooting Resources

- **Logs**: `docker compose logs -f [service]`
- **Container Shell**: `docker compose exec [service] sh`
- **Health Status**: `docker inspect --format='{{.State.Health.Status}}' [container]`
- **Network**: `docker compose exec app ping postgres`

### Related Documentation

- Project README: `/Users/ding/Github/claude-code-hub/README.md`
- English README: `/Users/ding/Github/claude-code-hub/README.en.md`
- API Authentication Guide: `/Users/ding/Github/claude-code-hub/docs/api-authentication-guide.md`
- Contributing Guide: `/Users/ding/Github/claude-code-hub/CONTRIBUTING.md`

---

*Report generated from code exploration of Claude Code Hub deployment scripts. All paths reference the source repository at `/Users/ding/Github/claude-code-hub`.*

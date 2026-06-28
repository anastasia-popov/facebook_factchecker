# Fact Checker Backend Deployment Guide

## Docker Deployment to Gold Server (Port 3003)

### Prerequisites
- Docker and Docker Compose installed on the gold server
- All required API keys (Claude, Google, Serper, ClaimBuster)
- Google OAuth credentials

### Step 1: Prepare Environment Variables

Create a `.env.prod` file on the gold server with the following variables:

```bash
# API Keys
GOOGLE_API_KEY=your_google_api_key
CLAUDE_API_KEY=your_claude_api_key
SERPER_API_KEY=your_serper_api_key
CLAIMBUSTER_API_KEY=your_claimbuster_api_key

# OAuth Configuration
GOOGLE_OAUTH_CLIENT_ID=your_google_client_id
GOOGLE_OAUTH_CLIENT_SECRET=your_google_client_secret

# JWT Configuration (generate with: python -c "import secrets; print(secrets.token_urlsafe(32))")
JWT_SECRET_KEY=your_random_secret_key_here
JWT_ALGORITHM=HS256
JWT_EXPIRATION_MINUTES=60
REFRESH_TOKEN_EXPIRATION_DAYS=30

# Database
DATABASE_URL=sqlite:///./factchecker.db

# Backend URL (update to your domain)
BACKEND_URL=https://your-domain.com
```

### Step 2: Build and Run with Docker Compose

On the gold server:

```bash
# Clone or upload the project
cd /path/to/factchecker

# Load environment variables
export $(cat .env.prod | xargs)

# Build and start the container
docker-compose up -d

# View logs
docker-compose logs -f backend

# Check health
curl http://localhost:3003/health
```

### Step 3: Verify Deployment

```bash
# Check if container is running
docker ps

# View backend logs
docker-compose logs backend

# Test the API
curl http://localhost:3003/health

# Check rate limit status
curl http://localhost:3003/settings/model
```

### Step 4: Configure Reverse Proxy (Optional but Recommended)

For production, use Nginx as a reverse proxy:

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:3003;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Then enable HTTPS with Let's Encrypt:
```bash
sudo certbot --nginx -d your-domain.com
```

### Database Persistence

The SQLite database is persisted in a volume:
- Local path: `./backend/factchecker.db`
- Container path: `/app/factchecker.db`

Data will persist across container restarts.

### Updating the Backend

To update to a newer version:

```bash
# Pull latest code
git pull

# Rebuild the image
docker-compose build --no-cache backend

# Restart the service
docker-compose up -d
```

### Troubleshooting

**Container won't start:**
```bash
docker-compose logs backend
```

**Port already in use:**
```bash
# Change port in docker-compose.yml or stop other services
sudo lsof -i :3003
```

**Database errors:**
```bash
# Check database permissions
ls -la ./backend/factchecker.db

# Reset database (warning: deletes all data)
rm ./backend/factchecker.db
docker-compose restart backend
```

### Security Considerations

1. Use strong JWT_SECRET_KEY (minimum 32 characters)
2. Keep API keys secure in environment variables only
3. Use HTTPS in production
4. Run container with non-root user (can be added to Dockerfile if needed)
5. Keep Docker images updated
6. Monitor container logs for suspicious activity

### Health Check Endpoint

The backend has a built-in health check that runs every 30 seconds:
```bash
curl http://localhost:3003/health
```

Expected response:
```json
{
  "status": "healthy",
  "message": "Fact Checker API is running"
}
```

### Performance Tuning

For better performance, you can adjust in docker-compose.yml:

```yaml
services:
  backend:
    # ... other config ...
    environment:
      # Add these for better performance
      WORKERS: "4"  # Number of worker processes
    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 2G
        reservations:
          cpus: '1'
          memory: 1G
```

### Backup Database

```bash
# Backup
docker cp factchecker-backend:/app/factchecker.db ./factchecker.db.backup

# Restore
docker cp ./factchecker.db.backup factchecker-backend:/app/factchecker.db
docker-compose restart backend
```

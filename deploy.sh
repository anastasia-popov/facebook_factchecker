#!/bin/bash

# Fact Checker Backend Deployment Script
# Deploys changes to gold server on port 3003

set -e

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
GOLD_SERVER="${GOLD_SERVER:-gold}"
GOLD_USER="${GOLD_USER:-stacy}"
GOLD_PATH="${GOLD_PATH:-~/factchecker}"
GIT_REMOTE="${GIT_REMOTE:-origin}"
GIT_BRANCH="${GIT_BRANCH:-master}"

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Fact Checker Backend Deployment Script${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""
echo "Target: $GOLD_USER@$GOLD_SERVER:$GOLD_PATH"
echo "Branch: $GIT_BRANCH"
echo ""

# Step 1: Check for uncommitted changes (ignore submodules in .gitignore)
echo -e "${YELLOW}Step 1: Checking for uncommitted changes...${NC}"
UNCOMITTED=$(git status --porcelain | grep -v '^ M .claude/worktrees' || true)
if [ -n "$UNCOMITTED" ]; then
    echo -e "${RED}❌ Uncommitted changes detected!${NC}"
    echo "Please commit or stash your changes first:"
    echo "  git add ."
    echo "  git commit -m 'Your message'"
    echo ""
    echo "Uncommitted files:"
    echo "$UNCOMITTED"
    exit 1
fi
echo -e "${GREEN}✓ No uncommitted changes${NC}"
echo ""

# Step 2: Check git status
echo -e "${YELLOW}Step 2: Checking git status...${NC}"
git fetch $GIT_REMOTE $GIT_BRANCH 2>/dev/null || true
LOCAL=$(git rev-parse $GIT_BRANCH 2>/dev/null || echo "unknown")
REMOTE=$(git rev-parse $GIT_REMOTE/$GIT_BRANCH 2>/dev/null || echo "unknown")

if [ "$LOCAL" != "$REMOTE" ] && [ "$REMOTE" != "unknown" ]; then
    echo -e "${YELLOW}⚠ Local branch differs from remote${NC}"
    echo "Push local changes to $GIT_REMOTE? (y/n)"
    read -r PUSH_CHOICE
    if [ "$PUSH_CHOICE" != "y" ]; then
        echo -e "${RED}Deployment cancelled${NC}"
        exit 1
    fi
    git push $GIT_REMOTE $GIT_BRANCH
fi
echo -e "${GREEN}✓ Git status OK${NC}"
echo ""

# Step 3: Push to remote
echo -e "${YELLOW}Step 3: Pushing to remote repository...${NC}"
git push $GIT_REMOTE $GIT_BRANCH
echo -e "${GREEN}✓ Code pushed to $GIT_REMOTE/$GIT_BRANCH${NC}"
echo ""

# Step 4: Deploy to gold server
echo -e "${YELLOW}Step 4: Deploying to gold server ($GOLD_SERVER)...${NC}"
echo "Connecting to $GOLD_USER@$GOLD_SERVER..."
echo ""

# Expand path for SSH
if [[ "$GOLD_PATH" == "~"* ]]; then
    GOLD_PATH_EXPANDED=$(ssh "$GOLD_USER@$GOLD_SERVER" "echo $GOLD_PATH" 2>/dev/null)
else
    GOLD_PATH_EXPANDED="$GOLD_PATH"
fi

# Execute deployment on gold server via SSH
ssh -t "$GOLD_USER@$GOLD_SERVER" << EOFREMOTE
#!/bin/bash
set -e
cd "$GOLD_PATH_EXPANDED"

echo ''
echo -e '${BLUE}========== Remote Deployment ===========${NC}'
echo ''

echo -e '${YELLOW}📥 Pulling latest code...${NC}'
git fetch origin
git reset --hard origin/$GIT_BRANCH

echo -e '${YELLOW}🔨 Building Docker image...${NC}'
docker-compose build --no-cache backend

echo -e '${YELLOW}🚀 Restarting containers...${NC}'
docker-compose down || true
docker-compose up -d

echo -e '${YELLOW}⏳ Waiting for service to start...${NC}'
sleep 3

echo -e '${YELLOW}✅ Checking health endpoint...${NC}'
for i in {1..10}; do
    if curl -sf http://localhost:3003/health > /dev/null 2>&1; then
        echo -e '${GREEN}✓ Health check passed${NC}'
        break
    fi
    if [ $i -eq 10 ]; then
        echo -e '${RED}❌ Health check failed after 10 attempts!${NC}'
        echo 'Recent logs:'
        docker-compose logs backend | tail -20
        exit 1
    fi
    echo "  Attempt \$i/10..."
    sleep 2
done

echo ''
echo -e '${BLUE}📊 Deployment Status:${NC}'
docker-compose ps

echo ''
echo -e '${GREEN}✅ Remote deployment successful!${NC}'
EOFREMOTE

DEPLOY_STATUS=$?

if [ $DEPLOY_STATUS -eq 0 ]; then
    echo ""
    echo -e "${GREEN}========================================${NC}"
    echo -e "${GREEN}✅ Deployment Successful!${NC}"
    echo -e "${GREEN}========================================${NC}"
    echo ""
    echo -e "${BLUE}Backend is running at:${NC}"
    echo "  http://$GOLD_SERVER:3003"
    echo ""
    echo -e "${BLUE}Quick commands:${NC}"
    echo "  Check logs:"
    echo "    ssh $GOLD_USER@$GOLD_SERVER 'cd $GOLD_PATH && docker-compose logs -f backend'"
    echo ""
    echo "  View status:"
    echo "    ssh $GOLD_USER@$GOLD_SERVER 'cd $GOLD_PATH && docker-compose ps'"
    echo ""
    echo "  Rollback to previous version:"
    echo "    ssh $GOLD_USER@$GOLD_SERVER 'cd $GOLD_PATH && git reset --hard HEAD~1 && docker-compose up -d'"
    echo ""
else
    echo ""
    echo -e "${RED}========================================${NC}"
    echo -e "${RED}❌ Deployment Failed!${NC}"
    echo -e "${RED}========================================${NC}"
    echo ""
    echo -e "${YELLOW}Check the logs above for details${NC}"
    exit 1
fi

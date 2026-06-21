#!/bin/bash
# Setup script to configure the Chrome extension with API keys from .env

if [ ! -f .env ]; then
    echo "Error: .env file not found. Please create it by copying .env.example"
    echo "  cp .env.example .env"
    exit 1
fi

# Read API key from .env
CLAUDE_API_KEY=$(grep "CLAUDE_API_KEY=" .env | cut -d '=' -f 2)

if [ -z "$CLAUDE_API_KEY" ]; then
    echo "Error: CLAUDE_API_KEY not found in .env"
    exit 1
fi

# Create config.json in the extension directory
cat > extension/config.json << EOF
{
  "claudeApiKey": "$CLAUDE_API_KEY"
}
EOF

echo "✓ Configuration written to extension/config.json"
echo "✓ Claude API key configured"
echo ""
echo "Next steps:"
echo "1. Reload the extension in Chrome (chrome://extensions)"
echo "2. Visit Facebook and click 'Fact Check' on posts"

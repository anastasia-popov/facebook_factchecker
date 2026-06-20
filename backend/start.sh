#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_DIR="$SCRIPT_DIR/.venv"

echo "🔧 Facebook Fact Checker Backend Startup"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Check if Python is available
if ! command -v python3 &> /dev/null; then
    echo "❌ Error: Python 3 is not installed. Please install Python 3.8 or higher."
    exit 1
fi

echo "✓ Python 3 found: $(python3 --version)"

# Create virtual environment if it doesn't exist
if [ ! -d "$VENV_DIR" ]; then
    echo ""
    echo "📦 Creating virtual environment..."
    python3 -m venv "$VENV_DIR"
    echo "✓ Virtual environment created at $VENV_DIR"
fi

# Activate virtual environment
echo ""
echo "🔌 Activating virtual environment..."
source "$VENV_DIR/bin/activate"

# Install/upgrade pip
echo ""
echo "⬆️  Upgrading pip..."
python -m pip install --quiet --upgrade pip

# Install requirements
echo ""
echo "📚 Installing dependencies from requirements.txt..."
pip install --quiet -r "$SCRIPT_DIR/requirements.txt"
echo "✓ Dependencies installed"

# Check for .env file
echo ""
if [ ! -f "$SCRIPT_DIR/.env" ]; then
    echo "⚠️  Warning: .env file not found!"
    echo "📋 Please create .env file with your API keys:"
    echo "   cp $SCRIPT_DIR/.env.example $SCRIPT_DIR/.env"
    echo "   Edit .env and add:"
    echo "   - CLAIMBUSTER_API_KEY=your_key_here"
    echo "   - GOOGLE_API_KEY=your_key_here"
    echo ""
    read -p "Continue anyway? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
else
    echo "✓ .env file found"
fi

# Start the server
echo ""
echo "🚀 Starting FastAPI server on http://localhost:8000"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Press Ctrl+C to stop the server"
echo ""

cd "$SCRIPT_DIR"
uvicorn main:app --reload --port 8000

# Facebook Fact Checker Extension

A Chrome extension that adds fact-checking capabilities to Facebook. Click a "Fact Check" button on any post to extract claims and verify them against existing fact-checks.

## How It Works

1. **Claim Extraction**: Uses ClaimBuster API to identify check-worthy claims from post text
2. **Verification**: Queries Google Fact Check Tools API to find existing fact-checks for those claims
3. **Results Display**: Shows verdict badges and source links inline on the post

## Setup

### Prerequisites

- Python 3.8+
- Chrome browser
- API keys (free tier available):
  - **Google Fact Check Tools API** (required): Get free key at https://console.developers.google.com/
  - **ClaimBuster API** (optional): Get free key at https://idir.uta.edu/claimbuster/
    - If not provided, the backend uses simple sentence splitting instead

### Backend Setup

1. **Install dependencies**:
   ```bash
   cd backend
   pip install -r requirements.txt
   ```

2. **Set up environment variables**:
   ```bash
   cp .env.example .env
   # Edit .env and add your API keys
   ```

3. **Start the server**:
   ```bash
   uvicorn main:app --reload --port 8000
   ```
   The backend will run at `http://localhost:8000`

### Extension Setup

1. **Load into Chrome**:
   - Open `chrome://extensions`
   - Enable "Developer mode" (top right)
   - Click "Load unpacked"
   - Select the `extension/` folder from this project

2. **Verify installation**:
   - Click the extension icon in the Chrome toolbar
   - A popup should show "Backend is running ✓"
   - If not running, start the backend server

## Usage

1. Visit `facebook.com` and scroll through your feed
2. Locate a post with factual claims
3. Click the **🔍 Fact Check** button at the bottom of the post
4. Wait for results (usually 2-5 seconds)
5. Results appear as an overlay with:
   - Each extracted claim
   - Verdict (True, False, Mixture, or Unverified)
   - Source links to fact-check articles

## Architecture

### Backend (`/backend`)

- **main.py**: FastAPI server with CORS middleware for cross-origin requests from the extension
- **checker.py**: Orchestrates API calls to ClaimBuster and Google Fact Check Tools
- **models.py**: Pydantic data models for requests/responses
- **config.py**: Environment variable loading

### Extension (`/extension`)

- **manifest.json**: Chrome extension configuration
- **content.js**: Injects buttons into Facebook posts, handles extraction and overlay rendering
- **popup.html/js**: Configuration panel showing backend status
- **background.js**: Service worker for extension initialization
- **styles.css**: Styling for buttons and result overlays

## API Limits

Both APIs have rate limits on the free tier:

- **ClaimBuster**: ~100-200 requests/day
- **Google Fact Check Tools**: ~100 requests/day

Results are typically cached by Google's service, so repeated checks of the same claim are fast.

## Troubleshooting

### "Cannot reach backend — is it running on port 8000?"
- Ensure the backend server is running: `uvicorn main:app --reload --port 8000`
- Check that no firewall is blocking localhost:8000

### "CLAIMBUSTER_API_KEY not configured"
- Copy `.env.example` to `.env`
- Add your ClaimBuster API key to the `.env` file
- Restart the backend server

### "GOOGLE_API_KEY not configured"
- Add your Google Fact Check Tools API key to `.env`
- Restart the backend server

### "No fact-checkable claims found in this post"
- The post may contain too little text or mostly non-factual content
- Try with a post about politics, health, or current events

### Fact Check button not appearing
- Hard refresh Facebook (Ctrl+Shift+R or Cmd+Shift+R)
- Check that the extension is enabled: `chrome://extensions`
- Ensure you're on `facebook.com` (not m.facebook.com)

## Data Privacy

This extension:
- **Does NOT** store posts on your device
- **Does NOT** send your posts to any service except the APIs listed above
- All processing happens between your computer and the backend
- The backend does not log or retain post text

## Future Improvements

- Caching of fact-check results
- Support for other social media platforms (Twitter, LinkedIn, Reddit)
- Custom fact-checker backends
- Browser history of fact-checked posts
- Batch fact-check multiple posts

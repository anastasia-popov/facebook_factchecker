# Fact Checker - Firefox Extension

This is the Firefox version of the Fact Checker extension. It provides the same functionality as the Chrome version, with Firefox-specific adjustments.

## Setup

### 1. Load the Extension in Firefox

1. Open Firefox and go to `about:debugging#/runtime/this-firefox`
2. Click "Load Temporary Add-on"
3. Navigate to this `firefox-extension/` folder and select `manifest.json`

### 2. Configuration

The extension requires a backend server running on `http://localhost:8000`. See the main README for backend setup instructions.

### 3. Backend Connection

Make sure your backend is running before using the extension:

```bash
cd backend
python -m uvicorn main:app --reload --port 8000
```

## Features

- Right-click selected text to fact-check with Claude AI
- Right-click images to extract and fact-check text
- Paste screenshots or image URLs in the popup for instant fact-checking
- Web search integration for comprehensive analysis
- Colorful, professional analysis overlays with clickable sources

## Compatibility

- Firefox 109+ (MV3 support)
- Requires local backend service running on port 8000

## Differences from Chrome Version

- Uses Firefox's MV3 manifest format with `browser_specific_settings`
- Background script configuration differs slightly (uses `scripts` array in Firefox)
- All API calls work through the `chrome` namespace (Firefox's compatibility layer)

## Troubleshooting

If the extension doesn't work:

1. **Ensure backend is running**: Check http://localhost:8000 in your browser
2. **Check extension logs**: Open DevTools for the extension (about:debugging → Inspect)
3. **Verify permissions**: The extension needs contextMenus and host_permissions
4. **Clear cache**: Reload the extension from about:debugging

## Development

To make changes:

1. Edit files in the `firefox-extension/` folder
2. Go to `about:debugging#/runtime/this-firefox`
3. Click the reload button next to the extension
4. Test your changes

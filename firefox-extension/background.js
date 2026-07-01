
// Function to create context menus
function setupContextMenus() {

  // Remove existing menus to avoid duplicates
  chrome.contextMenus.removeAll(() => {
    // Create context menu for text fact-checking
    chrome.contextMenus.create({
      id: 'factcheck-selection',
      title: '🔍 Fact Check Selection',
      contexts: ['selection']
    }, () => {
      if (chrome.runtime.lastError) {
      } else {
      }
    });

    // Create context menu for image OCR fact-checking (only shows when right-clicking images)
    chrome.contextMenus.create({
      id: 'factcheck-image',
      title: '🔍 Fact Check Image Text',
      contexts: ['image']
    }, () => {
      if (chrome.runtime.lastError) {
      } else {
      }
    });
  });
}

// Setup menus on install
chrome.runtime.onInstalled.addListener(() => {
  setupContextMenus();
});

// Also setup menus on startup (in case they were removed)
setupContextMenus();

// Handle context menu click
chrome.contextMenus.onClicked.addListener((info, tab) => {

  if (info.menuItemId === 'factcheck-selection' && info.selectionText) {
    // Send selected text to content script
    chrome.tabs.sendMessage(tab.id, {
      action: 'factCheckText',
      text: info.selectionText
    });
  } else if (info.menuItemId === 'factcheck-image') {
    if (!info.srcUrl) {
      // Try to get image from the page if context menu doesn't provide URL
      chrome.tabs.sendMessage(tab.id, {
        action: 'findImageForOCR'
      });
    } else {
      // Send image URL to content script for OCR
      chrome.tabs.sendMessage(tab.id, {
        action: 'factCheckImage',
        imageUrl: info.srcUrl,
        frameId: info.frameId
      });
    }
  }
});

const BACKEND_URL = 'http://localhost:8000';

// ==================== Auth Token Management ====================

async function getAuthToken() {
  const auth = await chrome.storage.local.get('auth');
  if (!auth.auth?.isAuthenticated) {
    throw new Error('Not authenticated. Please log in via the extension popup.');
  }
  return auth.auth;
}

async function ensureValidToken() {
  const auth = await getAuthToken();

  // Check if token is expired
  if (Date.now() >= auth.accessTokenExpiry) {
    return await refreshAccessToken();
  }

  return auth.accessToken;
}

async function refreshAccessToken() {
  try {
    const auth = await chrome.storage.local.get('auth');

    if (!auth.auth?.refreshToken) {
      throw new Error('No refresh token available');
    }

    const response = await fetch(`${BACKEND_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        refresh_token: auth.auth.refreshToken
      })
    });

    if (!response.ok) {
      // Token refresh failed - let the request fail naturally with 401
      // User stays logged in and can retry. Only explicit logout clears auth.
      throw new Error('Session expired. Please try again or log in via the extension popup.');
    }

    const { access_token } = await response.json();

    // Update stored token
    auth.auth.accessToken = access_token;
    auth.auth.accessTokenExpiry = Date.now() + (60 * 60 * 1000); // 1 hour
    await chrome.storage.local.set({ auth });

    return access_token;
  } catch (error) {
    // Don't automatically remove auth - let user decide to logout via popup
    throw error;
  }
}

// ==================== Message Handling ====================

// Handle messages from content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'factCheckWithClaude') {
    handleFactCheck(request.text)
      .then(result => {
        sendResponse({ result });
      })
      .catch(error => {
        sendResponse({ error: error.message });
      });
    return true; // Keep channel open for async response
  }
});

// ==================== Fact Check API ====================

async function handleFactCheck(text) {
  try {
    // Ensure we have a valid token
    const accessToken = await ensureValidToken();

    const response = await fetch(`${BACKEND_URL}/claude-fact-check`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`
      },
      body: JSON.stringify({
        text: text
      })
    });

    // Handle authentication errors
    if (response.status === 401) {
      // Try refreshing token and retry once
      const newToken = await refreshAccessToken();

      const retryResponse = await fetch(`${BACKEND_URL}/claude-fact-check`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${newToken}`
        },
        body: JSON.stringify({
          text: text
        })
      });

      if (!retryResponse.ok) {
        const error = await retryResponse.json();
        throw new Error(`Authentication failed: ${error.detail || 'Unknown error'}`);
      }

      const data = await retryResponse.json();
      return data.analysis;
    }

    // Handle rate limit errors
    if (response.status === 429) {
      const error = await response.json();
      throw new Error(`Rate limit exceeded: ${error.detail || 'Please try again later'}`);
    }

    // Handle other errors
    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Backend error: ${error.detail || 'Unknown error'}`);
    }

    const data = await response.json();
    const analysis = data.analysis;

    if (!analysis) {
      throw new Error('Backend returned empty analysis');
    }

    return analysis;
  } catch (error) {
    throw error;
  }
}

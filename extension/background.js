
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

let BACKEND_URL = 'http://localhost:8000';

// Load backend URL from storage on startup
chrome.runtime.onInstalled.addListener(async () => {
  const settings = await chrome.storage.local.get('backendUrl');
  if (settings.backendUrl) {
    BACKEND_URL = settings.backendUrl;
  }
});

// Also load on every script load
(async () => {
  const settings = await chrome.storage.local.get('backendUrl');
  if (settings.backendUrl) {
    BACKEND_URL = settings.backendUrl;
  }
})();

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

    const { access_token, refresh_token, refresh_token_expires_in } = await response.json();

    // Update stored tokens with sliding window refresh
    auth.auth.accessToken = access_token;
    auth.auth.refreshToken = refresh_token;
    auth.auth.accessTokenExpiry = Date.now() + (60 * 60 * 1000); // 1 hour
    auth.auth.refreshTokenExpiry = Date.now() + (refresh_token_expires_in * 1000); // Extends by 365 days
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
        console.log('[FC] Sending result:', result);
        sendResponse({ result });
      })
      .catch(error => {
        console.log('[FC] Error caught:', error.message);
        // Check if it's an authentication error
        if (error.message.includes('Not authenticated') || error.message.includes('not authenticated')) {
          console.log('[FC] Detected AUTH_REQUIRED');
          const response = { error: error.message, errorType: 'AUTH_REQUIRED' };
          console.log('[FC] Sending response:', response);
          sendResponse(response);
        } else {
          console.log('[FC] Regular error:', error.message);
          sendResponse({ error: error.message });
        }
      });
    return true; // Keep channel open for async response
  } else if (request.action === 'performOCR') {
    handleOCR(request.imageData, request.isUrl)
      .then(result => {
        console.log('[FC] OCR result:', result);
        sendResponse({ result });
      })
      .catch(error => {
        console.log('[FC] OCR Error object:', error);
        console.log('[FC] OCR Error message:', error?.message || String(error));
        sendResponse({ error: error?.message || String(error) });
      });
    return true;
  } else if (request.action === 'openPopup') {
    // Open the extension popup
    chrome.action.openPopup(() => {
      sendResponse({ success: true });
    });
    return true;
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

// ==================== OCR API ====================

async function handleOCR(imageData, isUrl) {
  try {
    const accessToken = await ensureValidToken();

    if (isUrl) {
      // Handle URL-based image
      const response = await fetch(`${BACKEND_URL}/ocr`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`
        },
        body: JSON.stringify({
          image_url: imageData
        })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'OCR failed');
      }

      return await response.json();
    } else {
      // Convert array back to Blob
      const blob = new Blob([new Uint8Array(imageData)], { type: 'image/png' });
      const formData = new FormData();
      formData.append('file', blob, 'image.png');

      console.log('[FC] Making OCR POST to:', `${BACKEND_URL}/ocr`);
      const response = await fetch(`${BACKEND_URL}/ocr`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`
        },
        body: formData
      });

      console.log('[FC] OCR response status:', response.status);

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || `OCR failed with status ${response.status}`);
      }

      return await response.json();
    }
  } catch (error) {
    console.log('[FC] handleOCR error:', error);
    throw error;
  }
}

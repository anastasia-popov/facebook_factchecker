const BACKEND_URL = 'http://localhost:8000';
let clipboardImage = null;

// Initialize popup on load
document.addEventListener('DOMContentLoaded', async () => {
  await initializePopup();
  setupEventListeners();
});

async function initializePopup() {
  const auth = await chrome.storage.local.get('auth');

  if (auth.auth?.isAuthenticated) {
    // Show profile panel
    showProfilePanel();
    await loadUserProfile();
  } else {
    // Show login panel
    showLoginPanel();
  }
}

function showLoginPanel() {
  document.getElementById('loginPanel').classList.add('active');
  document.getElementById('profilePanel').classList.remove('active');
}

function showProfilePanel() {
  document.getElementById('loginPanel').classList.remove('active');
  document.getElementById('profilePanel').classList.add('active');
}

function setupEventListeners() {
  // Login button
  document.getElementById('googleLoginBtn').addEventListener('click', handleLogin);

  // Logout button
  document.getElementById('logoutBtn').addEventListener('click', handleLogout);

  // OCR button
  document.getElementById('ocrBtn').addEventListener('click', handleOCR);

  // Clipboard paste
  document.getElementById('imageUrl').addEventListener('paste', handleImagePaste);
}

// ==================== OAuth Login ====================

async function handleLogin() {
  const googleBtn = document.getElementById('googleLoginBtn');
  const errorDiv = document.getElementById('loginError');

  googleBtn.disabled = true;
  errorDiv.style.display = 'none';

  try {
    // Get OAuth URL from backend
    const response = await fetch(`${BACKEND_URL}/auth/google/start-oauth`, {
      method: 'POST'
    });

    if (!response.ok) {
      throw new Error('Failed to start OAuth flow');
    }

    const { oauth_url, state, code_challenge } = await response.json();

    // Store state and code_verifier for callback validation
    await chrome.storage.local.set({
      oauth_state: state,
      code_verifier: code_challenge
    });

    // Open OAuth popup window
    chrome.windows.create({
      url: oauth_url,
      type: 'popup',
      width: 500,
      height: 600
    });

    // Poll for tokens every 500ms for up to 60 seconds
    let attempts = 0;
    const pollInterval = setInterval(async () => {
      attempts++;

      try {
        const tokens = await fetch(`${BACKEND_URL}/auth/google/get-tokens?state=${encodeURIComponent(state)}`);

        if (tokens.ok) {
          clearInterval(pollInterval);
          const { access_token, refresh_token } = await tokens.json();
          handleOAuthSuccess(access_token, refresh_token);
        } else if (attempts > 120) {
          // 120 attempts * 500ms = 60 seconds timeout
          clearInterval(pollInterval);
          throw new Error('Authentication timeout. Please try again.');
        }
      } catch (error) {
        if (attempts > 120) {
          clearInterval(pollInterval);
          handleOAuthError(error.message);
        }
      }
    }, 500);
  } catch (error) {
    showLoginError('Failed to start login: ' + error.message);
    googleBtn.disabled = false;
  }
}


async function handleOAuthSuccess(accessToken, refreshToken) {
  const googleBtn = document.getElementById('googleLoginBtn');
  const errorDiv = document.getElementById('loginError');

  try {
    // Store tokens securely
    await chrome.storage.local.set({
      auth: {
        accessToken: accessToken,
        refreshToken: refreshToken,
        accessTokenExpiry: Date.now() + (60 * 60 * 1000), // 1 hour
        isAuthenticated: true,
        lastRefresh: Date.now()
      }
    });

    errorDiv.style.display = 'none';
    showProfilePanel();
    await loadUserProfile();
  } catch (error) {
    showLoginError('Authentication failed: ' + error.message);
    googleBtn.disabled = false;
  }
}

function handleOAuthError(errorMessage) {
  const googleBtn = document.getElementById('googleLoginBtn');
  showLoginError('Authentication failed: ' + errorMessage);
  googleBtn.disabled = false;
}

function showLoginError(message) {
  const errorDiv = document.getElementById('loginError');
  errorDiv.textContent = message;
  errorDiv.style.display = 'block';
}

// ==================== Profile & Logout ====================

async function loadUserProfile() {
  const auth = await chrome.storage.local.get('auth');

  if (!auth.auth?.isAuthenticated) {
    showLoginPanel();
    return;
  }

  try {
    // Check token expiry and refresh if needed
    if (Date.now() >= auth.auth.accessTokenExpiry) {
      await refreshAccessToken();
      auth = await chrome.storage.local.get('auth');
    }

    const response = await fetch(`${BACKEND_URL}/auth/profile`, {
      headers: {
        'Authorization': `Bearer ${auth.auth.accessToken}`
      }
    });

    if (response.status === 401) {
      // Try refresh
      await refreshAccessToken();
      return loadUserProfile(); // Retry
    }

    if (!response.ok) {
      throw new Error('Failed to fetch profile');
    }

    const profile = await response.json();
    displayProfile(profile);
  } catch (error) {
    console.error('Failed to load profile:', error);
    showLoginPanel();
  }
}

function displayProfile(profile) {
  // Email and member since
  document.getElementById('username').textContent = profile.google_email;
  const memberDate = new Date(profile.created_at).toLocaleDateString();
  document.getElementById('memberSince').textContent = memberDate;

  // Monthly quota
  const monthlyPercent = (profile.quotas.monthly_used / profile.quotas.monthly_limit) * 100;
  document.getElementById('monthlyUsed').textContent = profile.quotas.monthly_used;
  document.getElementById('monthlyLimit').textContent = profile.quotas.monthly_limit;
  document.getElementById('monthlyBar').style.width = monthlyPercent + '%';
}

async function refreshAccessToken() {
  const auth = await chrome.storage.local.get('auth');

  try {
    const response = await fetch(`${BACKEND_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        refresh_token: auth.auth.refreshToken
      })
    });

    if (!response.ok) {
      throw new Error('Token refresh failed');
    }

    const { access_token } = await response.json();

    // Update stored token
    auth.auth.accessToken = access_token;
    auth.auth.accessTokenExpiry = Date.now() + (60 * 60 * 1000);
    await chrome.storage.local.set({ auth });

    return access_token;
  } catch (error) {
    // Clear auth and show login screen
    await chrome.storage.local.remove('auth');
    showLoginPanel();
    throw error;
  }
}

async function handleLogout() {
  const auth = await chrome.storage.local.get('auth');

  try {
    await fetch(`${BACKEND_URL}/auth/logout`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${auth.auth.accessToken}`
      }
    });
  } catch (error) {
    console.error('Logout error (continuing):', error);
  }

  // Clear local storage
  await chrome.storage.local.remove('auth');
  clipboardImage = null;
  document.getElementById('imageUrl').value = '';
  showLoginPanel();
}

// ==================== Image Extraction & Fact-Checking ====================

function handleImagePaste(e) {
  const items = e.clipboardData.items;
  for (let item of items) {
    if (item.type.indexOf('image') !== -1) {
      e.preventDefault();
      clipboardImage = item.getAsFile();
      document.getElementById('imageUrl').value = '📷 Screenshot pasted';
      break;
    }
  }
}

async function handleOCR() {
  const imageUrl = document.getElementById('imageUrl').value.trim();
  const ocrBtn = document.getElementById('ocrBtn');
  const auth = await chrome.storage.local.get('auth');

  if (!auth.auth?.isAuthenticated) {
    showLoginPanel();
    return;
  }

  if (!imageUrl && !clipboardImage) {
    alert('Please paste an image URL or paste a screenshot (Ctrl+V)');
    return;
  }

  ocrBtn.disabled = true;
  document.getElementById('loadingContainer').style.display = 'block';

  try {
    // Check token expiry
    if (Date.now() >= auth.auth.accessTokenExpiry) {
      await refreshAccessToken();
      auth = await chrome.storage.local.get('auth');
    }

    // Get the active tab
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs[0];

    if (clipboardImage) {
      // Handle clipboard image
      const formData = new FormData();
      formData.append('file', clipboardImage, 'screenshot.png');

      const response = await fetch(`${BACKEND_URL}/ocr`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${auth.auth.accessToken}`
        },
        body: formData
      });

      if (response.status === 429) {
        throw new Error('Rate limit exceeded. Please try again later.');
      }

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'OCR failed');
      }

      const result = await response.json();
      const extractedText = result.text;

      if (extractedText && extractedText.trim().length > 0) {
        chrome.tabs.sendMessage(tab.id, {
          action: 'factCheckText',
          text: extractedText
        }, () => {
          clipboardImage = null;
          document.getElementById('imageUrl').value = '';
          document.getElementById('loadingContainer').style.display = 'none';
          ocrBtn.disabled = false;
          setTimeout(() => window.close(), 500);
        });
      } else {
        throw new Error('No text found in the image');
      }
    } else {
      // Handle URL
      if (!imageUrl.startsWith('http')) {
        throw new Error('Please enter a valid image URL (starting with http or https)');
      }

      chrome.tabs.sendMessage(tab.id, {
        action: 'factCheckImage',
        imageUrl: imageUrl
      }, (response) => {
        if (chrome.runtime.lastError) {
          console.error('Error:', chrome.runtime.lastError.message);
        }
        document.getElementById('imageUrl').value = '';
        document.getElementById('loadingContainer').style.display = 'none';
        ocrBtn.disabled = false;
        setTimeout(() => window.close(), 500);
      });
    }
  } catch (error) {
    document.getElementById('loadingContainer').style.display = 'none';
    ocrBtn.disabled = false;
    alert('Error: ' + error.message);
  }
}

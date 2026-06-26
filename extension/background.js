
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

async function handleFactCheck(text) {

  try {
    const response = await fetch('http://localhost:8000/claude-fact-check', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ text: text })
    });

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

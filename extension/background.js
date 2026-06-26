console.log('Background script loaded');

// Function to create context menus
function setupContextMenus() {
  console.log('Setting up context menus');

  // Remove existing menus to avoid duplicates
  chrome.contextMenus.removeAll(() => {
    // Create context menu for text fact-checking
    chrome.contextMenus.create({
      id: 'factcheck-selection',
      title: '🔍 Fact Check Selection',
      contexts: ['selection']
    }, () => {
      if (chrome.runtime.lastError) {
        console.error('Error creating text menu:', chrome.runtime.lastError);
      } else {
        console.log('✓ Text context menu created');
      }
    });

    // Create context menu for image OCR fact-checking (only shows when right-clicking images)
    chrome.contextMenus.create({
      id: 'factcheck-image',
      title: '🔍 Fact Check Image Text',
      contexts: ['image']
    }, () => {
      if (chrome.runtime.lastError) {
        console.error('Error creating image menu:', chrome.runtime.lastError);
      } else {
        console.log('✓ Image context menu created');
      }
    });
  });
}

// Setup menus on install
chrome.runtime.onInstalled.addListener(() => {
  console.log('Extension installed/updated');
  setupContextMenus();
});

// Also setup menus on startup (in case they were removed)
setupContextMenus();

// Handle context menu click
chrome.contextMenus.onClicked.addListener((info, tab) => {
  console.log('Context menu clicked:', info.menuItemId, 'srcUrl:', info.srcUrl);

  if (info.menuItemId === 'factcheck-selection' && info.selectionText) {
    // Send selected text to content script
    console.log('User selected text for fact-checking');
    chrome.tabs.sendMessage(tab.id, {
      action: 'factCheckText',
      text: info.selectionText
    });
  } else if (info.menuItemId === 'factcheck-image') {
    if (!info.srcUrl) {
      console.warn('No srcUrl found, trying to capture from page');
      // Try to get image from the page if context menu doesn't provide URL
      chrome.tabs.sendMessage(tab.id, {
        action: 'findImageForOCR'
      });
    } else {
      // Send image URL to content script for OCR
      console.log('User selected image for OCR fact-checking, URL:', info.srcUrl);
      chrome.tabs.sendMessage(tab.id, {
        action: 'factCheckImage',
        imageUrl: info.srcUrl,
        frameId: info.frameId
      });
    }
  }
});

// Handle messages from content script
console.log('Setting up message listener');
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('Message received from', sender.url, 'action:', request?.action);
  if (request.action === 'factCheckWithClaude') {
    console.log('Starting fact check with text length:', request.text?.length);
    handleFactCheck(request.text)
      .then(result => {
        console.log('Fact check complete, sending response');
        sendResponse({ result });
      })
      .catch(error => {
        console.error('Fact check error:', error);
        sendResponse({ error: error.message });
      });
    return true; // Keep channel open for async response
  }
});

async function handleFactCheck(text) {
  console.log('Calling backend with Claude fact-checker');

  try {
    const response = await fetch('http://localhost:8000/claude-fact-check', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ text: text })
    });

    console.log('Backend response status:', response.status);

    if (!response.ok) {
      const error = await response.json();
      console.error('Backend error response:', error);
      throw new Error(`Backend error: ${error.detail || 'Unknown error'}`);
    }

    const data = await response.json();
    const analysis = data.analysis;

    if (!analysis) {
      throw new Error('Backend returned empty analysis');
    }

    console.log('Fact-check complete, length:', analysis.length);
    return analysis;
  } catch (error) {
    console.error('Backend request error:', error);
    throw error;
  }
}

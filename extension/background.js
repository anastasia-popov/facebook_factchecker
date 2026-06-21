console.log('Background script loaded');

chrome.runtime.onInstalled.addListener(() => {
  console.log('Extension installed/updated');
  chrome.storage.local.set({ claudeApiKey: '' });

  // Create context menu for fact-checking
  chrome.contextMenus.create({
    id: 'factcheck-selection',
    title: '🔍 Fact Check Selection',
    contexts: ['selection'],
    documentUrlPatterns: ['https://www.facebook.com/*', 'https://facebook.com/*']
  });
});

// Handle context menu click
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'factcheck-selection' && info.selectionText) {
    // Send selected text to content script
    chrome.tabs.sendMessage(tab.id, {
      action: 'factCheckText',
      text: info.selectionText
    });
  }
});

// Handle messages from content script
console.log('Setting up message listener');
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('Message received from', sender.url, 'action:', request?.action);
  if (request.action === 'factCheckWithClaude') {
    console.log('Starting fact check with text length:', request.text?.length);
    handleFactCheckWithBackend(request.text)
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

async function handleFactCheckWithBackend(text) {
  console.log('Calling backend /claude-fact-check endpoint');

  try {
    const response = await fetch('http://localhost:8000/claude-fact-check', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        text: text
      })
    });

    console.log('Backend response status:', response.status);

    if (!response.ok) {
      const error = await response.json();
      console.error('Backend error response:', error);
      throw new Error(`Backend error: ${error.detail || 'Unknown error'}`);
    }

    const data = await response.json();
    console.log('Backend analysis complete, length:', data.analysis.length);
    return data.analysis;
  } catch (error) {
    console.error('Backend request error:', error);
    throw error;
  }
}

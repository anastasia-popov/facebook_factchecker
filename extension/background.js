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
  // Get the selected fact-checker method
  const { factChecker } = await chrome.storage.local.get(['factChecker']);
  const method = factChecker || 'claude';

  console.log(`Calling backend with ${method} fact-checker`);

  try {
    // Choose endpoint based on selected method
    const endpoint = method === 'claude' ? '/claude-fact-check' : '/fact-check';
    const url = `http://localhost:8000${endpoint}`;

    const response = await fetch(url, {
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

    // Handle different response formats
    let analysis;
    if (method === 'claude') {
      analysis = data.analysis;
      console.log('Claude analysis complete, length:', analysis?.length);
    } else {
      // Google API returns claims array, format it for display
      analysis = formatGoogleFactCheckResults(data.claims);
      console.log('Google fact-check complete, formatted length:', analysis.length);
    }

    if (!analysis) {
      throw new Error('Backend returned empty analysis');
    }

    return analysis;
  } catch (error) {
    console.error('Backend request error:', error);
    throw error;
  }
}

function formatGoogleFactCheckResults(claims) {
  if (!claims || claims.length === 0) {
    return 'No fact-checkable claims found in this post.';
  }

  let result = '## Fact-Check Results (Google Fact Check API)\n\n';

  for (const claim of claims) {
    result += `**Claim:** ${claim.text}\n`;
    result += `**Score:** ${(claim.score * 100).toFixed(0)}% check-worthiness\n`;

    if (claim.verdict) {
      result += `**Verdict:** ${claim.verdict}\n`;
    }

    if (claim.sources && claim.sources.length > 0) {
      result += '**Sources:**\n';
      for (const source of claim.sources) {
        result += `- ${source.publisher}: ${source.url}\n`;
      }
    }

    result += '\n';
  }

  return result;
}

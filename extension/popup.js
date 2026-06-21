async function checkSettings() {
  const indicator = document.getElementById('statusIndicator');
  const statusText = document.getElementById('statusText');
  const data = await chrome.storage.local.get(['factChecker', 'claudeApiKey']);
  const factChecker = data.factChecker || 'claude';
  const apiKey = data.claudeApiKey || '';

  if (factChecker === 'claude') {
    if (apiKey && apiKey.startsWith('sk-ant-')) {
      indicator.className = 'status-indicator ok';
      statusText.textContent = 'Claude API key configured ✓';
    } else if (apiKey) {
      indicator.className = 'status-indicator error';
      statusText.textContent = 'Invalid Claude API key format';
    } else {
      indicator.className = 'status-indicator error';
      statusText.textContent = 'Claude API key not set';
    }
  } else {
    indicator.className = 'status-indicator ok';
    statusText.textContent = 'Using Google Fact Check API ✓';
  }
}

document.getElementById('saveBtn').addEventListener('click', async () => {
  const apiKey = document.getElementById('claudeApiKey').value;
  const factChecker = document.querySelector('input[name="factChecker"]:checked').value;

  await chrome.storage.local.set({
    claudeApiKey: apiKey,
    factChecker: factChecker
  });

  await checkSettings();
  const btn = document.getElementById('saveBtn');
  btn.textContent = 'Saved!';
  setTimeout(() => {
    btn.textContent = 'Save Settings';
  }, 1500);
});

async function loadSettings() {
  const data = await chrome.storage.local.get(['factChecker', 'claudeApiKey']);
  const factChecker = data.factChecker || 'claude';
  const apiKey = data.claudeApiKey || '';

  // Set the selected fact-checker
  document.getElementById(factChecker === 'claude' ? 'claudeRadio' : 'googleRadio').checked = true;

  // Show masked API key
  if (apiKey) {
    document.getElementById('claudeApiKey').value = apiKey.substring(0, 10) + '...' + apiKey.substring(apiKey.length - 4);
  }

  await checkSettings();
}

// Handle screenshot OCR button
document.getElementById('screenshotBtn').addEventListener('click', async () => {
  console.log('Screenshot button clicked');

  try {
    // Get the active tab
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs[0];

    if (!tab || !tab.id) {
      alert('Error: Could not find active tab');
      return;
    }

    console.log('Sending screenshot activation message to tab:', tab.id);

    // Send message to content script to activate screenshot mode
    chrome.tabs.sendMessage(tab.id, {
      action: 'activateScreenshot'
    }, (response) => {
      if (chrome.runtime.lastError) {
        console.error('Message error:', chrome.runtime.lastError);
        alert('Error: ' + chrome.runtime.lastError.message + '\n\nTry refreshing the page first.');
      } else {
        console.log('Screenshot mode activated successfully');
        // Close popup after sending
        setTimeout(() => window.close(), 500);
      }
    });
  } catch (error) {
    console.error('Error:', error);
    alert('Error: ' + error.message);
  }
});

// Handle clipboard paste for images
let clipboardImage = null;
document.getElementById('imageUrl').addEventListener('paste', async (e) => {
  const items = e.clipboardData.items;
  for (let item of items) {
    if (item.type.indexOf('image') !== -1) {
      e.preventDefault();
      clipboardImage = item.getAsFile();
      document.getElementById('imageUrl').value = '📷 Screenshot pasted (' + clipboardImage.name + ')';
      console.log('Image pasted from clipboard:', clipboardImage.name);
      break;
    }
  }
});

// Handle manual OCR from popup
document.getElementById('ocrBtn').addEventListener('click', async () => {
  const imageUrl = document.getElementById('imageUrl').value.trim();

  if (!imageUrl && !clipboardImage) {
    alert('Please paste an image URL or paste a screenshot (Ctrl+V)');
    return;
  }

  const btn = document.getElementById('ocrBtn');
  const originalText = btn.textContent;
  btn.textContent = 'Processing...';
  btn.disabled = true;

  try {
    // Get the active tab
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs[0];

    if (clipboardImage) {
      // Handle clipboard image
      try {
        const formData = new FormData();
        formData.append('file', clipboardImage, 'screenshot.png');

        const response = await fetch('http://localhost:8000/ocr', {
          method: 'POST',
          body: formData
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.detail || 'OCR failed');
        }

        const result = await response.json();
        const extractedText = result.text;

        if (extractedText && extractedText.trim().length > 0) {
          // Send to content script for fact-checking
          chrome.tabs.sendMessage(tab.id, {
            action: 'factCheckText',
            text: extractedText
          });
          clipboardImage = null;
          window.close();
        } else {
          alert('No text found in the image');
          btn.textContent = originalText;
          btn.disabled = false;
        }
      } catch (error) {
        alert('Error: ' + error.message);
        btn.textContent = originalText;
        btn.disabled = false;
      }
    } else {
      // Handle URL
      if (!imageUrl.startsWith('http')) {
        alert('Please enter a valid image URL (starting with http or https)');
        btn.textContent = originalText;
        btn.disabled = false;
        return;
      }

      // Send OCR request to content script
      chrome.tabs.sendMessage(tab.id, {
        action: 'factCheckImage',
        imageUrl: imageUrl
      }, (response) => {
        if (chrome.runtime.lastError) {
          alert('Error: ' + chrome.runtime.lastError.message);
        } else {
          window.close();
        }
      });
    }
  } catch (error) {
    alert('Error: ' + error.message);
    btn.textContent = originalText;
    btn.disabled = false;
  }
});

loadSettings();

async function checkApiKey() {
  const indicator = document.getElementById('statusIndicator');
  const statusText = document.getElementById('statusText');
  const apiKey = document.getElementById('claudeApiKey').value;

  if (apiKey && apiKey.startsWith('sk-ant-')) {
    indicator.className = 'status-indicator ok';
    statusText.textContent = 'Claude API key configured ✓';
  } else if (apiKey) {
    indicator.className = 'status-indicator error';
    statusText.textContent = 'Invalid API key format';
  } else {
    indicator.className = 'status-indicator error';
    statusText.textContent = 'API key not set';
  }
}

document.getElementById('saveBtn').addEventListener('click', async () => {
  const apiKey = document.getElementById('claudeApiKey').value;
  await chrome.storage.local.set({ claudeApiKey: apiKey });
  await checkApiKey();
  const btn = document.getElementById('saveBtn');
  btn.textContent = 'Saved!';
  setTimeout(() => {
    btn.textContent = 'Save Settings';
  }, 1500);
});

async function loadSettings() {
  const data = await chrome.storage.local.get(['claudeApiKey']);
  const apiKey = data.claudeApiKey || '';
  // Show masked version
  if (apiKey) {
    document.getElementById('claudeApiKey').value = apiKey.substring(0, 10) + '...' + apiKey.substring(apiKey.length - 4);
  }
  await checkApiKey();
}

loadSettings();

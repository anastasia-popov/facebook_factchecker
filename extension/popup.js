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

loadSettings();

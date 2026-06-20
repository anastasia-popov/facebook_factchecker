async function checkBackendHealth() {
  const indicator = document.getElementById('statusIndicator');
  const statusText = document.getElementById('statusText');

  try {
    const backendUrl = document.getElementById('backendUrl').value || 'http://localhost:8000';
    const response = await fetch(`${backendUrl}/health`);
    if (response.ok) {
      indicator.className = 'status-indicator ok';
      statusText.textContent = 'Backend is running ✓';
    } else {
      indicator.className = 'status-indicator error';
      statusText.textContent = 'Backend returned an error';
    }
  } catch (e) {
    indicator.className = 'status-indicator error';
    statusText.textContent = 'Backend is not running';
  }
}

document.getElementById('saveBtn').addEventListener('click', async () => {
  const url = document.getElementById('backendUrl').value || 'http://localhost:8000';
  await chrome.storage.local.set({ backendUrl: url });
  const btn = document.getElementById('saveBtn');
  btn.textContent = 'Saved!';
  setTimeout(() => {
    btn.textContent = 'Save';
  }, 1500);
});

async function loadSettings() {
  const data = await chrome.storage.local.get(['backendUrl']);
  document.getElementById('backendUrl').value = data.backendUrl || 'http://localhost:8000';
  checkBackendHealth();
}

loadSettings();


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

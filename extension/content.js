(function () {
  const BACKEND_URL = 'http://localhost:8000';
  console.log('🔍 Fact Checker: Content script loaded');


  async function performOCR(imageUrl) {
    console.log('Starting OCR on image:', imageUrl);

    let statusDiv;

    try {
      // Show status
      statusDiv = document.createElement('div');
      statusDiv.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: white;
        padding: 20px;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        z-index: 999999;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      `;
      statusDiv.textContent = 'Downloading image...';
      document.body.appendChild(statusDiv);

      // Fetch the image
      let imageBlob;
      try {
        const response = await fetch(imageUrl);
        imageBlob = await response.blob();
        console.log('Image downloaded, size:', imageBlob.size);
      } catch (e) {
        console.log('Direct fetch failed, trying with no-cors...');
        const response = await fetch(imageUrl, { mode: 'no-cors' });
        imageBlob = await response.blob();
      }

      // Upload to backend for OCR
      statusDiv.textContent = 'Extracting text from image (backend OCR)...';
      const formData = new FormData();
      formData.append('file', imageBlob, 'image.png');

      const ocrResponse = await fetch(`${BACKEND_URL}/ocr`, {
        method: 'POST',
        body: formData
      });

      if (!ocrResponse.ok) {
        const error = await ocrResponse.json();
        throw new Error(`OCR Error: ${error.detail || 'Unknown error'}`);
      }

      const ocrResult = await ocrResponse.json();
      const extractedText = ocrResult.text;

      if (statusDiv && statusDiv.parentNode) {
        statusDiv.remove();
      }

      console.log('OCR complete, extracted text length:', extractedText.length);
      console.log('Extracted text preview:', extractedText.substring(0, 100));

      if (!extractedText || extractedText.trim().length === 0) {
        throw new Error('No text found in the image');
      }

      return extractedText;
    } catch (error) {
      console.error('OCR error:', error);
      if (statusDiv && statusDiv.parentNode) {
        statusDiv.remove();
      }
      throw error;
    }
  }

  async function extractPostText(article) {
    console.log('extractPostText called');

    if (!article) {
      console.log('No article provided');
      return '';
    }

    try {
      // Wait for loading to complete (max 5 seconds)
      console.log('Waiting for post to load...');
      let attempts = 0;
      while (attempts < 50) {
        const loadingElement = article.querySelector('[aria-label="Loading..."]');
        if (!loadingElement) {
          console.log('Post loaded after', attempts * 100, 'ms');
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
        attempts++;
      }

      // Debug: check article properties
      const articleStyles = getComputedStyle(article);
      console.log('Article display:', articleStyles.display);
      console.log('Article visibility:', articleStyles.visibility);
      console.log('Article opacity:', articleStyles.opacity);
      console.log('Article children count:', article.children.length);
      console.log('Article HTML length:', article.innerHTML.length);
      console.log('Article HTML (first 500):', article.innerHTML.substring(0, 500));

      // Find all post text paragraphs within the modal
      let text = '';
      const modal = document.querySelector('div[aria-modal="true"]');

      if (modal) {
        console.log('✓ Found modal');

        // Extract text
        const postTextElements = modal.querySelectorAll('div[dir="auto"][style*="text-align: start"]');
        console.log('Found', postTextElements.length, 'text elements');

        if (postTextElements.length > 0) {
          // Combine all text elements
          const textParts = Array.from(postTextElements).map(el =>
            el.innerText || el.textContent || ''
          );
          text = textParts.filter(t => t.trim().length > 0).join('\n');

          console.log('✓ Found post text elements in modal');
          console.log('Post text length:', text.length);
          console.log('Text preview:', text.substring(0, 300));
        } else {
          console.log('✗ Post text elements not found in modal');
        }

      } else {
        console.log('✗ Modal not found');
      }

      // Clean up the text - remove common FB UI elements
      const lines = text.split('\n').filter(line => {
        const cleaned = line.trim().toLowerCase();
        // Filter out common Facebook UI text
        return !cleaned.match(/^(like|comment|share|react|emoji|love|haha|wow|sad|angry|care|see more|show more|hide|report|edit|delete|loading|likes? comment|reactions|you|and \d+ others)/i);
      });

      text = lines.join('\n').trim();
      console.log('Cleaned text length:', text.length);
      console.log('Cleaned text preview:', text.substring(0, 300));

      return text.slice(0, 2000);
    } catch (e) {
      console.error('Error extracting text:', e);
      return '';
    }
  }

  function escapeHtml(text) {
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
    return text.replace(/[&<>"']/g, m => map[m]);
  }

  function parseTextWithLinks(text) {
    if (!text || typeof text !== 'string') {
      console.error('parseTextWithLinks received invalid text:', text);
      return escapeHtml(String(text));
    }

    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const parts = text.split(urlRegex);

    return parts.map((part, idx) => {
      if (part && part.match(urlRegex)) {
        // Remove trailing punctuation if present
        const cleanUrl = part.replace(/[.,;:!?)]$/, '');
        return `<a href="${escapeHtml(cleanUrl)}" target="_blank" rel="noopener noreferrer" style="color: #1877f2 !important; text-decoration: none !important; font-weight: 500 !important;" onmouseover="this.style.textDecoration='underline !important'" onmouseout="this.style.textDecoration='none !important'">${escapeHtml(cleanUrl)}</a>`;
      }
      return part ? escapeHtml(part) : '';
    }).join('');
  }

  function showClaudeResults(container, responseText, originalText) {
    console.log('showClaudeResults called with text length:', responseText?.length);
    console.log('Response text preview:', responseText?.substring(0, 100));

    if (!responseText || responseText.trim() === '') {
      console.error('Empty response text received');
      showError(container, 'Received empty analysis from backend');
      return;
    }

    // Create overlay as fixed position on body so it doesn't disappear with modal
    const overlay = document.createElement('div');
    overlay.className = 'fc-overlay';
    overlay.setAttribute('data-fc-overlay', 'true');
    overlay.style.cssText = `
      position: fixed !important;
      top: 20px !important;
      left: 50% !important;
      transform: translateX(-50%) !important;
      background: white !important;
      border: 1px solid #e4e6eb !important;
      border-radius: 8px !important;
      padding: 0 !important;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
      font-size: 13px !important;
      color: #050505 !important;
      z-index: 999999 !important;
      line-height: 1.5 !important;
      width: 90% !important;
      max-width: 700px !important;
      max-height: calc(100vh - 40px) !important;
      display: flex !important;
      flex-direction: column !important;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3) !important;
    `;

    const responseHtml = parseTextWithLinks(responseText)
      .replace(/\n/g, '<br>')
      .replace(/^##\s+(.+)$/gm, '<h3 style="margin: 12px 0 6px 0 !important; font-size: 15px !important; font-weight: 600 !important;">$1</h3>')
      .replace(/^\*\*(.+?)\*\*:/gm, '<strong style="color: #1877f2 !important;">$1:</strong>');

    console.log('Formatted HTML length:', responseHtml.length);

    const originalTextHtml = originalText ? `
      <div style="background: #f0f2f5 !important; padding: 12px !important; margin-bottom: 12px !important; border-left: 4px solid #1877f2 !important; border-radius: 4px !important;">
        <div style="font-weight: 600 !important; font-size: 12px !important; color: #1877f2 !important; margin-bottom: 6px !important;">📝 Original Text:</div>
        <div style="font-size: 12px !important; color: #65676b !important; word-wrap: break-word !important; white-space: pre-wrap !important; max-height: 120px !important; overflow-y: auto !important;">
          ${escapeHtml(originalText.substring(0, 500))}${originalText.length > 500 ? '...' : ''}
        </div>
      </div>
    ` : '';

    overlay.innerHTML = `
      <div class="fc-header" style="display: flex !important; justify-content: space-between !important; align-items: center !important; padding: 12px 16px !important; border-bottom: 1px solid #e4e6eb !important; flex-shrink: 0 !important; background: #fafbfc !important;">
        <span class="fc-title" style="font-weight: 600 !important; font-size: 14px !important;">Fact-Check Analysis</span>
        <button class="fc-close" aria-label="Close" style="background: none !important; border: none !important; cursor: pointer !important; font-size: 20px !important; color: #65676b !important; padding: 0 !important; width: 24px !important; height: 24px !important; display: flex !important; align-items: center !important; justify-content: center !important;">✕</button>
      </div>
      <div class="fc-claude-response" style="flex: 1 !important; overflow-y: auto !important; padding: 16px !important; white-space: normal !important; word-wrap: break-word !important;">
        ${originalTextHtml}
        ${responseHtml}
      </div>
    `;

    const closeBtn = overlay.querySelector('.fc-close');
    closeBtn.addEventListener('click', () => {
      console.log('Closing overlay');
      overlay.remove();
    });

    document.body.appendChild(overlay);
    console.log('Overlay appended to body with fixed positioning');
  }

  function showError(container, message) {
    const overlay = document.createElement('div');
    overlay.className = 'fc-overlay fc-overlay-error';
    overlay.setAttribute('data-fc-overlay', 'true');
    overlay.style.cssText = `
      position: fixed !important;
      top: 50% !important;
      left: 50% !important;
      transform: translate(-50%, -50%) !important;
      background: #fff3cd !important;
      border: 1px solid #ffc107 !important;
      border-radius: 8px !important;
      padding: 16px !important;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
      font-size: 13px !important;
      color: #856404 !important;
      z-index: 999999 !important;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3) !important;
      max-width: 400px !important;
      display: flex !important;
      gap: 8px !important;
      align-items: flex-start !important;
    `;
    overlay.innerHTML = `
      <span class="fc-error-icon" style="font-size: 20px !important; flex-shrink: 0 !important;">⚠️</span>
      <span style="flex: 1 !important;">${escapeHtml(message)}</span>
      <button class="fc-close" aria-label="Close" style="background: none !important; border: none !important; cursor: pointer !important; font-size: 18px !important; color: #856404 !important; padding: 0 !important;">✕</button>
    `;
    overlay.querySelector('.fc-close').addEventListener('click', () => overlay.remove());
    document.body.appendChild(overlay);
  }

  async function handleFactCheck(article, btn) {
    console.log('handleFactCheck called');
    btn.disabled = true;
    btn.textContent = 'Checking…';

    const text = await extractPostText(article);
    console.log('Post text:', text.length, 'chars');

    if (!text.trim()) {
      showError(article, 'Could not extract text from post.');
      btn.disabled = false;
      btn.textContent = '🔍 Fact Check';
      return;
    }

    try {
      // Extract image URLs if present
      const modal = document.querySelector('div[aria-modal="true"]');
      const images = modal ? modal.querySelectorAll('img[data-imgperflogname="feedImage"]') : [];
      const imageUrls = Array.from(images)
        .map(img => img.src || img.getAttribute('data-src'))
        .filter(url => url && url.length > 10);

      console.log('Sending fact-check request to background service worker');

      // Send message to background service worker to handle Claude API call
      chrome.runtime.sendMessage(
        {
          action: 'factCheckWithClaude',
          text: text,
          imageUrls: imageUrls
        },
        (response) => {
          console.log('Response from background:', response);

          if (!response) {
            console.error('No response from background');
            showError(article, 'No response from service worker');
          } else if (response.error) {
            console.error('Backend error:', response.error);
            showError(article, response.error);
          } else if (response.result) {
            console.log('Showing Claude results, length:', response.result.length);
            showClaudeResults(article, response.result, text);
          } else {
            console.error('Unexpected response structure:', response);
            showError(article, 'Unexpected response from backend');
          }

          btn.disabled = false;
          btn.textContent = '🔍 Fact Check';
        }
      );
    } catch (e) {
      console.error('Error:', e);
      showError(article, `Error: ${e.message}`);
      btn.disabled = false;
      btn.textContent = '🔍 Fact Check';
    }
  }

  // Store last clicked element for OCR fallback
  let lastClickedElement = null;
  document.addEventListener('contextmenu', (e) => {
    lastClickedElement = e.target;
  }, true);

  // Extract image URL from element (handles img tags, divs with background images, etc)
  function extractImageUrl(element) {
    if (!element) return null;

    // If it's an img tag, use src or data-src
    if (element.tagName === 'IMG') {
      return element.src || element.getAttribute('data-src');
    }

    // If it's a div or other element with background-image
    const style = window.getComputedStyle(element);
    const backgroundImage = style.backgroundImage;
    if (backgroundImage && backgroundImage.startsWith('url')) {
      const match = backgroundImage.match(/url\(['"]?([^'"()]+)['"]?\)/);
      if (match && match[1]) {
        return match[1];
      }
    }

    // Try data-src attribute (lazy loading)
    const dataSrc = element.getAttribute('data-src');
    if (dataSrc) {
      return dataSrc;
    }

    // Look for nested img tag
    const nestedImg = element.querySelector('img');
    if (nestedImg) {
      return nestedImg.src || nestedImg.getAttribute('data-src');
    }

    // Look for picture element
    const picture = element.querySelector('picture');
    if (picture) {
      const source = picture.querySelector('source');
      if (source) {
        return source.srcset || source.getAttribute('data-srcset');
      }
      const img = picture.querySelector('img');
      if (img) {
        return img.src || img.getAttribute('data-src');
      }
    }

    return null;
  }

  // Listen for messages from background script and popup
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    try {
      if (request.action === 'factCheckText') {
      const selectedText = request.text;
      console.log('Fact-checking selected text:', selectedText.substring(0, 100));
      performFactCheck(selectedText, document.body);
    } else if (request.action === 'factCheckImage') {
      const imageUrl = request.imageUrl;
      console.log('Extracting text from image:', imageUrl);

      performOCR(imageUrl)
        .then(extractedText => {
          if (extractedText && extractedText.trim().length > 0) {
            console.log('OCR successful, performing fact-check on extracted text');
            performFactCheck(extractedText, document.body);
          } else {
            showError(document.body, 'No text found in the image. Please try another image.');
          }
        })
        .catch(error => {
          console.error('OCR failed:', error);
          showError(document.body, `OCR Error: ${error.message}`);
        });
    } else if (request.action === 'findImageForOCR') {
      // Try to get image from the last clicked element (handles divs with background images too)
      console.log('Finding image for OCR from page...');
      const imageUrl = extractImageUrl(lastClickedElement);
      console.log('Extracted image URL:', imageUrl);

      if (imageUrl) {
        performOCR(imageUrl)
          .then(extractedText => {
            if (extractedText && extractedText.trim().length > 0) {
              console.log('OCR successful from fallback');
              performFactCheck(extractedText, document.body);
            } else {
              showError(document.body, 'No text found in the image. Please try another image.');
            }
          })
          .catch(error => {
            console.error('OCR failed:', error);
            showError(document.body, `OCR Error: ${error.message}`);
          });
      } else {
        showError(document.body, 'Could not find image. Instagram images can be tricky - try using the popup to paste the image URL manually (right-click image → Copy image address).');
      }
    }
    } catch (error) {
      console.error('Message handler error:', error);
      sendResponse({ error: error.message });
    }
  });

  async function performFactCheck(text, container) {
    // Create a status message
    const statusDiv = document.createElement('div');
    statusDiv.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: white;
      padding: 20px;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      z-index: 999999;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    `;
    statusDiv.textContent = 'Fact-checking...';
    document.body.appendChild(statusDiv);

    try {
      // Send to background service worker
      console.log('Sending message to background service worker');
      chrome.runtime.sendMessage(
        {
          action: 'factCheckWithClaude',
          text: text,
          imageUrls: []
        },
        (response) => {
          console.log('Got response from background:', response);
          statusDiv.remove();

          if (!response) {
            showError(container, 'No response from background service worker');
            return;
          }

          if (response.error) {
            showError(container, response.error);
          } else if (response.result) {
            showClaudeResults(container, response.result, text);
          }
        }
      );
    } catch (e) {
      console.error('Error sending message:', e);
      statusDiv.remove();
      showError(container, `Error: ${e.message}`);
    }
  }
})();

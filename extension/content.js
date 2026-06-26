(function () {
  const BACKEND_URL = 'http://localhost:8000';
  console.log('🔍 Fact Checker: Content script loaded');

  // Screenshot/rectangle selection mode
  let screenshotMode = false;
  let startX, startY;
  let selectionBox = null;

  function enterScreenshotMode() {
    screenshotMode = true;
    console.log('Screenshot mode activated - drag to select area');

    // Create overlay for screenshot mode
    const overlay = document.createElement('div');
    overlay.id = 'fc-screenshot-overlay';
    overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.3);
      cursor: crosshair;
      z-index: 99998;
    `;

    // Create instruction text
    const instruction = document.createElement('div');
    instruction.style.cssText = `
      position: fixed;
      top: 20px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(0, 0, 0, 0.8);
      color: white;
      padding: 12px 20px;
      border-radius: 6px;
      z-index: 99999;
      font-size: 14px;
      font-weight: 600;
    `;
    instruction.textContent = 'Drag to select area for OCR • Press Esc to cancel';

    document.body.appendChild(overlay);
    document.body.appendChild(instruction);

    overlay.addEventListener('mousedown', (e) => {
      startX = e.clientX;
      startY = e.clientY;

      selectionBox = document.createElement('div');
      selectionBox.style.cssText = `
        position: fixed;
        border: 2px solid #1877f2;
        background: rgba(24, 119, 242, 0.1);
        z-index: 99999;
        pointer-events: none;
      `;
      document.body.appendChild(selectionBox);

      const handleMouseMove = (e) => {
        const currentX = e.clientX;
        const currentY = e.clientY;
        const width = Math.abs(currentX - startX);
        const height = Math.abs(currentY - startY);
        const left = Math.min(startX, currentX);
        const top = Math.min(startY, currentY);

        selectionBox.style.left = left + 'px';
        selectionBox.style.top = top + 'px';
        selectionBox.style.width = width + 'px';
        selectionBox.style.height = height + 'px';
      };

      const handleMouseUp = async (e) => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);

        overlay.remove();
        instruction.remove();

        if (selectionBox) {
          selectionBox.remove();
        }

        // Capture the selected area
        const width = Math.abs(e.clientX - startX);
        const height = Math.abs(e.clientY - startY);

        if (width < 50 || height < 50) {
          showError(document.body, 'Selection area too small. Please select a larger area.');
          screenshotMode = false;
          return;
        }

        const left = Math.min(startX, e.clientX);
        const top = Math.min(startY, e.clientY);

        console.log(`Capturing area: ${width}x${height} at (${left}, ${top})`);
        captureArea(left, top, width, height);
        screenshotMode = false;
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    });

    // Cancel on Escape
    const handleEscape = (e) => {
      if (e.key === 'Escape') {
        screenshotMode = false;
        overlay.remove();
        instruction.remove();
        if (selectionBox) selectionBox.remove();
        document.removeEventListener('keydown', handleEscape);
        console.log('Screenshot mode cancelled');
      }
    };
    document.addEventListener('keydown', handleEscape);
  }

  async function captureArea(x, y, width, height) {
    console.log('Screenshot area selected:', width, 'x', height, 'at', x, ',', y);

    // Use browser's native screenshot API if available
    if (navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia) {
      showError(document.body, `Screenshot area selected! Now:\n\n1. Press Print Screen or use your OS screenshot tool\n2. Crop to the area you selected\n3. Paste the screenshot in the extension popup's "Manual OCR" field\n4. Click "Extract Text & Fact-Check"\n\nAlternatively, right-click the image and copy its address, then paste in the popup.`);
      return;
    }

    // Fallback: guide user to manual process
    const message = `You selected an area with text!\n\nTo OCR it:\n1. Take a screenshot of this area (Print Screen)\n2. In the extension popup, paste the image URL or screenshot\n3. Click "Extract Text & Fact-Check"\n\nOr copy an image link and paste it directly.`;

    showError(document.body, message);
  }

  // Keyboard shortcut to activate screenshot mode
  document.addEventListener('keydown', (e) => {
    // Ctrl+Shift+X to activate OCR screenshot
    if (e.ctrlKey && e.shiftKey && e.code === 'KeyX') {
      e.preventDefault();
      enterScreenshotMode();
    }
  });


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

  function isDetailPage() {
    const url = window.location.href;
    return url.includes('/permalink/') || url.includes('/posts/');
  }

  function reverseImageSearch(imageUrl, service = 'tineye') {
    let searchUrl;
    const encodedUrl = encodeURIComponent(imageUrl);

    if (service === 'tineye') {
      searchUrl = `https://tineye.com/search?url=${encodedUrl}`;
    } else if (service === 'google') {
      // Google Images reverse search using the upload form method
      searchUrl = `https://www.google.com/searchbyimage?image_url=${encodedUrl}`;
    }

    console.log(`Opening ${service} reverse image search...`);
    console.log(`URL: ${searchUrl}`);
    window.open(searchUrl, '_blank');
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

        // Extract post images only (not avatars)
        const postImages = modal.querySelectorAll('img[data-imgperflogname="feedImage"]');
        if (postImages.length > 0) {
          console.log('Found', postImages.length, 'post image(s) in modal');

          // Create reverse search panel
          const imageLinksDiv = document.createElement('div');
          imageLinksDiv.id = 'fc-image-search-links';
          imageLinksDiv.style.cssText = `
            position: fixed !important;
            bottom: 20px !important;
            right: 20px !important;
            background: white !important;
            border: 2px solid #1877f2 !important;
            border-radius: 8px !important;
            padding: 12px !important;
            z-index: 999998 !important;
            box-shadow: 0 4px 12px rgba(0,0,0,0.2) !important;
            max-width: 200px !important;
          `;

          const title = document.createElement('div');
          title.textContent = 'Reverse Image Search';
          title.style.cssText = `
            font-weight: bold !important;
            margin-bottom: 8px !important;
            color: #1877f2 !important;
            font-size: 12px !important;
          `;
          imageLinksDiv.appendChild(title);

          postImages.forEach((img, idx) => {
            // Try to get the original image URL from various sources
            let imgSrc = img.src || img.getAttribute('data-src') || img.getAttribute('data-image-url');

            // Try to get full resolution by checking parent elements
            const picture = img.closest('picture');
            if (picture) {
              const sources = picture.querySelectorAll('source');
              for (const source of sources) {
                const srcset = source.getAttribute('srcset');
                if (srcset) {
                  imgSrc = srcset.split(' ')[0];
                  break;
                }
              }
            }

            console.log(`🖼️ Image ${idx}: ${imgSrc}`);

            if (imgSrc && imgSrc.length > 10) {
              const btnTineye = document.createElement('button');
              btnTineye.textContent = `Image ${idx} - TinEye`;
              btnTineye.style.cssText = `
                display: block !important;
                width: 100% !important;
                margin: 4px 0 !important;
                padding: 8px !important;
                background: #1877f2 !important;
                color: white !important;
                border: none !important;
                border-radius: 4px !important;
                cursor: pointer !important;
                font-size: 11px !important;
              `;
              btnTineye.onclick = () => reverseImageSearch(imgSrc, 'tineye');
              imageLinksDiv.appendChild(btnTineye);

              const btnGoogle = document.createElement('button');
              btnGoogle.textContent = `Image ${idx} - Google`;
              btnGoogle.style.cssText = `
                display: block !important;
                width: 100% !important;
                margin: 4px 0 8px 0 !important;
                padding: 8px !important;
                background: #34a853 !important;
                color: white !important;
                border: none !important;
                border-radius: 4px !important;
                cursor: pointer !important;
                font-size: 11px !important;
              `;
              btnGoogle.onclick = () => reverseImageSearch(imgSrc, 'google');
              imageLinksDiv.appendChild(btnGoogle);
            }
          });

          document.body.appendChild(imageLinksDiv);
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

  function removeOverlay(container) {
    container.querySelector('[data-fc-overlay]')?.remove();
  }

  function renderClaim(claim) {
    const verdictClass = {
      'true': 'fc-verdict-true',
      'false': 'fc-verdict-false',
      'mixture': 'fc-verdict-mixture',
      'unverified': 'fc-verdict-unverified',
    }[claim.verdict?.toLowerCase()] ?? 'fc-verdict-unverified';

    const sources = claim.sources.map(s =>
      `<a href="${escapeHtml(s.url)}" target="_blank" rel="noopener">${escapeHtml(s.publisher)}</a>`
    ).join(', ');

    return `
      <li class="fc-claim">
        <p class="fc-claim-text">"${escapeHtml(claim.text)}"</p>
        <span class="fc-verdict ${verdictClass}">${claim.verdict ?? 'Unverified'}</span>
        ${sources ? `<p class="fc-sources">Sources: ${sources}</p>` : ''}
      </li>
    `;
  }

  function showResults(container, data) {
    removeOverlay(container);
    const overlay = document.createElement('div');
    overlay.className = 'fc-overlay';
    overlay.setAttribute('data-fc-overlay', 'true');

    if (data.claims.length === 0) {
      overlay.innerHTML = `<p class="fc-no-results">No fact-checkable claims found in this post.</p>`;
    } else {
      overlay.innerHTML = `
        <div class="fc-header">
          <span class="fc-title">Fact Check Results</span>
          <button class="fc-close" aria-label="Close">✕</button>
        </div>
        <ul class="fc-claims">
          ${data.claims.map(c => renderClaim(c)).join('')}
        </ul>
      `;
      overlay.querySelector('.fc-close').addEventListener('click', () => removeOverlay(container));
    }

    container.appendChild(overlay);
  }

  function parseTextWithLinks(text) {
    if (!text || typeof text !== 'string') {
      console.error('parseTextWithLinks received invalid text:', text);
      return escapeHtml(String(text));
    }

    // Add link CSS if not already added
    if (!document.getElementById('fc-link-styles')) {
      const styleSheet = document.createElement('style');
      styleSheet.id = 'fc-link-styles';
      styleSheet.textContent = `
        a.fc-link {
          color: #0891B2 !important;
          text-decoration: none !important;
          font-weight: 500 !important;
          transition: text-decoration 0.2s !important;
        }
        a.fc-link:hover {
          text-decoration: underline !important;
        }
      `;
      document.head.appendChild(styleSheet);
    }

    let html = escapeHtml(text);

    // Handle markdown-style links: [text](url)
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, linkText, url) => {
      return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="fc-link">${linkText}</a>`;
    });

    // Handle plain URLs
    const urlRegex = /(https?:\/\/[^\s<]+)/g;
    html = html.replace(urlRegex, (url) => {
      // Remove trailing punctuation if present
      const cleanUrl = url.replace(/[.,;:!?)]$/, '');
      return `<a href="${cleanUrl}" target="_blank" rel="noopener noreferrer" class="fc-link">${escapeHtml(cleanUrl)}</a>`;
    });

    return html;
  }

  function markdownToHtml(text) {
    let html = parseTextWithLinks(text);

    html = html.replace(/^###\s+(.+)$/gm, '<h3 style="margin: 16px 0 8px 0 !important; font-size: 14px !important; font-weight: 600 !important; color: #0891B2 !important;">$1</h3>');
    html = html.replace(/^##\s+(.+)$/gm, '<h2 style="margin: 18px 0 10px 0 !important; font-size: 16px !important; font-weight: 700 !important; color: #0891B2 !important;">$1</h2>');
    html = html.replace(/^#\s+(.+)$/gm, '<h1 style="margin: 20px 0 12px 0 !important; font-size: 18px !important; font-weight: 700 !important; color: #0891B2 !important;">$1</h1>');

    html = html.replace(/\*\*(.+?)\*\*/g, '<strong style="color: #1F2937 !important; font-weight: 700 !important;">$1</strong>');

    html = html.replace(/^-{2,}$/gm, '<div style="margin: 16px 0 !important; text-align: center !important;"><div style="display: inline-block !important; width: 60px !important; height: 2px !important; background: linear-gradient(90deg, transparent, #0891B2, transparent) !important; border-radius: 1px !important;"></div></div>');

    html = html.replace(/\n/g, '<br>');

    return html;
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
      background: #FFFFFF !important;
      border: 1px solid #E5E7EB !important;
      border-radius: 12px !important;
      padding: 0 !important;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
      font-size: 13px !important;
      color: #374151 !important;
      z-index: 999999 !important;
      line-height: 1.6 !important;
      width: 90% !important;
      max-width: 700px !important;
      max-height: calc(100vh - 40px) !important;
      display: flex !important;
      flex-direction: column !important;
      box-shadow: 0 10px 25px rgba(0,0,0,0.08), 0 0 1px rgba(0,0,0,0.1) !important;
    `;

    const responseHtml = markdownToHtml(responseText);

    console.log('Formatted HTML length:', responseHtml.length);

    const originalTextHtml = originalText ? `
      <div style="background: #F0F9FB !important; padding: 14px !important; margin-bottom: 16px !important; border-left: 4px solid #0891B2 !important; border-radius: 6px !important;">
        <div style="font-weight: 700 !important; font-size: 12px !important; color: #0891B2 !important; margin-bottom: 8px !important; text-transform: uppercase !important; letter-spacing: 0.5px !important;">📝 Original Text</div>
        <div style="font-size: 13px !important; color: #4B5563 !important; word-wrap: break-word !important; white-space: pre-wrap !important; max-height: 120px !important; overflow-y: auto !important; line-height: 1.5 !important;">
          ${escapeHtml(originalText.substring(0, 500))}${originalText.length > 500 ? '...' : ''}
        </div>
      </div>
    ` : '';

    overlay.innerHTML = `
      <div class="fc-header" style="display: flex !important; justify-content: space-between !important; align-items: center !important; padding: 16px 20px !important; border-bottom: 2px solid #0891B2 !important; flex-shrink: 0 !important; background: linear-gradient(135deg, #F0F9FB 0%, #F5FEFB 100%) !important;">
        <span class="fc-title" style="font-weight: 700 !important; font-size: 15px !important; color: #0891B2 !important;">✓ Fact-Check Analysis</span>
        <button class="fc-close" aria-label="Close" style="background: none !important; border: none !important; cursor: pointer !important; font-size: 20px !important; color: #9CA3AF !important; padding: 0 !important; width: 24px !important; height: 24px !important; display: flex !important; align-items: center !important; justify-content: center !important; transition: color 0.2s !important;">✕</button>
      </div>
      <div class="fc-claude-response" style="flex: 1 !important; overflow-y: auto !important; padding: 20px !important; white-space: normal !important; word-wrap: break-word !important; background: #FFFFFF !important;">
        ${originalTextHtml}
        ${responseHtml}
      </div>
    `;

    const closeBtn = overlay.querySelector('.fc-close');
    closeBtn.addEventListener('click', () => {
      console.log('Closing overlay');
      overlay.remove();
    });
    closeBtn.addEventListener('mouseover', () => {
      closeBtn.style.color = '#374151 !important';
    });
    closeBtn.addEventListener('mouseout', () => {
      closeBtn.style.color = '#9CA3AF !important';
    });

    document.body.appendChild(overlay);
    console.log('Overlay appended to body with fixed positioning');
  }

  function showLoadingAnimation() {
    const overlay = document.createElement('div');
    overlay.className = 'fc-overlay fc-overlay-loading';
    overlay.setAttribute('data-fc-overlay', 'true');
    overlay.id = 'fc-loading-overlay';
    overlay.style.cssText = `
      position: fixed !important;
      top: 50% !important;
      left: 50% !important;
      transform: translate(-50%, -50%) !important;
      background: white !important;
      border: 1px solid #E5E7EB !important;
      border-radius: 12px !important;
      padding: 40px 32px !important;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
      font-size: 14px !important;
      color: #374151 !important;
      z-index: 999999 !important;
      box-shadow: 0 10px 25px rgba(0,0,0,0.08), 0 0 1px rgba(0,0,0,0.1) !important;
      max-width: 320px !important;
      display: flex !important;
      flex-direction: column !important;
      align-items: center !important;
      gap: 20px !important;
    `;

    overlay.innerHTML = `
      <div style="font-size: 48px; display: inline-block; animation: fc-magnify 2s ease-in-out infinite;">🔍</div>
      <div style="font-weight: 500; color: #0891B2; animation: fc-pulse 1.5s ease-in-out infinite;">Searching and analyzing…</div>
    `;

    // Add keyframes if not already added
    if (!document.getElementById('fc-keyframes')) {
      const styleSheet = document.createElement('style');
      styleSheet.id = 'fc-keyframes';
      styleSheet.textContent = `
        @keyframes fc-magnify {
          0% { transform: rotate(0deg) scale(1); }
          50% { transform: rotate(25deg) scale(1.05); }
          100% { transform: rotate(0deg) scale(1); }
        }
        @keyframes fc-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.6; }
        }
      `;
      document.head.appendChild(styleSheet);
    }

    document.body.appendChild(overlay);
    return overlay;
  }

  function removeLoadingAnimation() {
    const overlay = document.getElementById('fc-loading-overlay');
    if (overlay) {
      overlay.remove();
    }
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
      background: #FEF2F2 !important;
      border: 1px solid #FECACA !important;
      border-radius: 12px !important;
      padding: 16px !important;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
      font-size: 13px !important;
      color: #7F1D1D !important;
      z-index: 999999 !important;
      box-shadow: 0 10px 25px rgba(0,0,0,0.08) !important;
      max-width: 400px !important;
      display: flex !important;
      gap: 12px !important;
      align-items: flex-start !important;
    `;
    overlay.innerHTML = `
      <span class="fc-error-icon" style="font-size: 20px !important; flex-shrink: 0 !important;">⚠️</span>
      <span style="flex: 1 !important;">${escapeHtml(message)}</span>
      <button class="fc-close" aria-label="Close" style="background: none !important; border: none !important; cursor: pointer !important; font-size: 18px !important; color: #D97706 !important; padding: 0 !important; transition: color 0.2s !important;">✕</button>
    `;
    const errorCloseBtn = overlay.querySelector('.fc-close');
    errorCloseBtn.addEventListener('click', () => overlay.remove());
    errorCloseBtn.addEventListener('mouseover', () => {
      errorCloseBtn.style.color = '#7F1D1D !important';
    });
    errorCloseBtn.addEventListener('mouseout', () => {
      errorCloseBtn.style.color = '#D97706 !important';
    });
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

      // Show loading animation
      showLoadingAnimation();

      // Send message to background service worker to handle Claude API call
      chrome.runtime.sendMessage(
        {
          action: 'factCheckWithClaude',
          text: text,
          imageUrls: imageUrls
        },
        (response) => {
          console.log('Response from background:', response);

          // Remove loading animation
          removeLoadingAnimation();

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
      removeLoadingAnimation();
      showError(article, `Error: ${e.message}`);
      btn.disabled = false;
      btn.textContent = '🔍 Fact Check';
    }
  }

  function injectButton() {
    console.log('injectButton() called');
    console.log('Current URL:', window.location.href);

    if (!isDetailPage()) {
      console.log('Not on detail page (URL check failed), skipping');
      return;
    }

    console.log('✓ On detail page');

    // Find the main post container
    const article = document.querySelector('[role="article"]');
    if (!article) {
      console.log('✗ Article not found with [role="article"]');
      return;
    }

    console.log('✓ Article found:', article);

    // Store reference to this article globally so click handler can use it
    window._fcMainArticle = article;

    // Check if button already exists
    const existingWrapper = document.querySelector('[data-fc-wrapper]');
    if (existingWrapper) {
      console.log('Button already exists, updating article reference');
      window._fcMainArticle = article;
      return;
    }

    console.log('Creating button...');

    const btn = document.createElement('button');
    btn.className = 'fc-btn';
    btn.textContent = '🔍 Fact Check';

    // Add inline styles to force visibility - VERY obvious
    btn.style.cssText = `
      background-color: #FF0000 !important;
      color: white !important;
      border: 3px solid yellow !important;
      border-radius: 8px !important;
      padding: 15px 20px !important;
      font-size: 16px !important;
      font-weight: 900 !important;
      cursor: pointer !important;
      display: block !important;
      margin: 16px auto !important;
      z-index: 10000 !important;
      width: auto !important;
      min-width: 150px !important;
      box-shadow: 0 0 10px red !important;
      position: relative !important;
    `;

    // Wrap button in a container - use fixed positioning to appear on top
    const wrapper = document.createElement('div');
    wrapper.setAttribute('data-fc-wrapper', 'true');
    wrapper.style.cssText = `
      position: fixed !important;
      top: 20px !important;
      left: 50% !important;
      transform: translateX(-50%) !important;
      background-color: #FFEEEE !important;
      border: 2px solid red !important;
      border-radius: 8px !important;
      padding: 12px !important;
      text-align: center !important;
      display: block !important;
      z-index: 999999 !important;
      width: auto !important;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3) !important;
    `;
    wrapper.appendChild(btn);

    // When button is clicked, use the stored article reference
    btn.addEventListener('click', () => {
      console.log('Button clicked!');
      const articleToCheck = window._fcMainArticle;
      if (articleToCheck && articleToCheck.isConnected) {
        console.log('Using stored article reference');
        handleFactCheck(articleToCheck, btn);
      } else {
        console.log('Stored article reference stale, finding main article');
        const allArticles = Array.from(document.querySelectorAll('[role="article"]'));
        // The main post should be the one with the largest size
        const mainArticle = allArticles.reduce((max, current) => {
          const currentSize = current.offsetHeight * current.offsetWidth;
          const maxSize = max.offsetHeight * max.offsetWidth;
          return currentSize > maxSize ? current : max;
        }, allArticles[0]);

        if (mainArticle) {
          console.log('Found main article, size:', mainArticle.offsetHeight * mainArticle.offsetWidth);
          window._fcMainArticle = mainArticle;
          handleFactCheck(mainArticle, btn);
        } else {
          console.log('Could not find any article');
          alert('Could not find post. Please refresh the page.');
        }
      }
    });

    // Append wrapper to body so it appears on top of everything
    document.body.appendChild(wrapper);
    console.log('✓ Button wrapper appended to body with fixed positioning');
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
      if (request.action === 'activateScreenshot') {
        console.log('Activating screenshot mode from popup');
        enterScreenshotMode();
        sendResponse({ success: true });
        return true;
      } else if (request.action === 'factCheckText') {
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

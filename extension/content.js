(function () {
  const BACKEND_URL = 'http://localhost:8000';
  console.log('🔍 Facebook Fact Checker: Content script loaded');

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
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const parts = text.split(urlRegex);

    return parts.map((part, idx) => {
      if (part.match(urlRegex)) {
        // Remove trailing punctuation if present
        const cleanUrl = part.replace(/[.,;:!?)]$/, '');
        return `<a href="${escapeHtml(cleanUrl)}" target="_blank" rel="noopener noreferrer" style="color: #1877f2 !important; text-decoration: none !important; font-weight: 500 !important;" onmouseover="this.style.textDecoration='underline !important'" onmouseout="this.style.textDecoration='none !important'">${escapeHtml(cleanUrl)}</a>`;
      }
      return escapeHtml(part);
    }).join('');
  }

  function showClaudeResults(container, responseText) {
    console.log('showClaudeResults called with text length:', responseText.length);
    console.log('Container:', container);

    removeOverlay(container);
    const overlay = document.createElement('div');
    overlay.className = 'fc-overlay';
    overlay.setAttribute('data-fc-overlay', 'true');
    overlay.style.cssText = `
      background: white !important;
      border: 1px solid #e4e6eb !important;
      border-radius: 8px !important;
      margin: 8px 12px 12px 12px !important;
      padding: 12px !important;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
      font-size: 13px !important;
      color: #050505 !important;
      z-index: 1000 !important;
      line-height: 1.5 !important;
    `;

    const responseHtml = parseTextWithLinks(responseText)
      .replace(/\n/g, '<br>')
      .replace(/^##\s+(.+)$/gm, '<h3 style="margin: 12px 0 6px 0 !important; font-size: 15px !important; font-weight: 600 !important;">$1</h3>')
      .replace(/^\*\*(.+?)\*\*:/gm, '<strong style="color: #1877f2 !important;">$1:</strong>');

    overlay.innerHTML = `
      <div class="fc-header">
        <span class="fc-title">Claude Fact-Check Analysis</span>
        <button class="fc-close" aria-label="Close">✕</button>
      </div>
      <div class="fc-claude-response" style="max-height: 500px !important; overflow-y: auto !important;">
        ${responseHtml}
      </div>
    `;

    overlay.querySelector('.fc-close').addEventListener('click', () => removeOverlay(container));
    container.appendChild(overlay);
    console.log('Overlay appended, offsetHeight:', overlay.offsetHeight);
  }

  function showError(container, message) {
    removeOverlay(container);
    const overlay = document.createElement('div');
    overlay.className = 'fc-overlay fc-overlay-error';
    overlay.setAttribute('data-fc-overlay', 'true');
    overlay.innerHTML = `
      <span class="fc-error-icon">⚠️</span>
      <span>${escapeHtml(message)}</span>
      <button class="fc-close" aria-label="Close">✕</button>
    `;
    overlay.querySelector('.fc-close').addEventListener('click', () => removeOverlay(container));
    container.appendChild(overlay);
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

          if (response.error) {
            showError(article, response.error);
          } else if (response.result) {
            console.log('Showing Claude results');
            showClaudeResults(article, response.result);
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

  // Listen for messages from background script
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'factCheckText') {
      const selectedText = request.text;
      console.log('Fact-checking selected text:', selectedText.substring(0, 100));

      // Find modal or create a container for results
      let modal = document.querySelector('div[aria-modal="true"]');
      let container = modal;

      if (!modal) {
        // If no modal, use body as container
        container = document.body;
      }

      performFactCheck(selectedText, container);
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
            showClaudeResults(container, response.result);
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

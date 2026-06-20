(function () {
  const BACKEND_URL = 'http://localhost:8000';
  console.log('🔍 Facebook Fact Checker: Content script loaded');

  function isDetailPage() {
    const url = window.location.href;
    return url.includes('/permalink/') || url.includes('/posts/');
  }

  function extractPostText() {
    // On detail page, find the main post article
    const articles = document.querySelectorAll('[role="article"]');

    if (articles.length === 0) {
      console.log('No articles found');
      return '';
    }

    // Use the first article (main post on detail page)
    const article = articles[0];
    console.log('Found article, extracting text');

    try {
      const clone = article.cloneNode(true);

      // Remove toolbars, buttons, etc
      clone.querySelectorAll('[role="toolbar"]').forEach(el => el.remove());
      clone.querySelectorAll('[role="button"]').forEach(el => el.remove());
      clone.querySelectorAll('[aria-label*="comment" i]').forEach(el => el.remove());
      clone.querySelectorAll('[aria-label*="reaction" i]').forEach(el => el.remove());
      clone.querySelectorAll('[aria-label*="like" i]').forEach(el => el.remove());
      clone.querySelectorAll('[aria-label*="share" i]').forEach(el => el.remove());

      const text = clone.innerText.trim();
      console.log('Extracted text length:', text.length);
      console.log('Text preview:', text.substring(0, 150));

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

  async function handleFactCheck(container, btn) {
    btn.disabled = true;
    btn.textContent = 'Checking…';
    removeOverlay(container);

    const text = extractPostText();
    console.log('Post text:', text.length, 'chars');

    if (!text.trim()) {
      showError(container, 'Could not extract text from post.');
      btn.disabled = false;
      btn.textContent = '🔍 Fact Check';
      return;
    }

    try {
      const res = await fetch(`${BACKEND_URL}/fact-check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text })
      });

      if (!res.ok) {
        const err = await res.json();
        showError(container, err.detail || 'Backend error');
      } else {
        const data = await res.json();
        showResults(container, data);
      }
    } catch (e) {
      showError(container, 'Cannot reach backend — is it running on port 8000?');
    } finally {
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

    // Check if article is visible
    const articleRect = article.getBoundingClientRect();
    const articleStyles = getComputedStyle(article);
    console.log('Article rect:', articleRect);
    console.log('Article display:', articleStyles.display);
    console.log('Article overflow:', articleStyles.overflow);
    console.log('Article visibility:', articleStyles.visibility);

    // Check if button already exists
    const existingWrapper = article.querySelector('[data-fc-wrapper]');
    if (existingWrapper) {
      console.log('Button already injected');
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

    // Wrap button in a container with obvious styling
    const wrapper = document.createElement('div');
    wrapper.setAttribute('data-fc-wrapper', 'true');
    wrapper.style.cssText = `
      background-color: #FFEEEE !important;
      border: 2px solid red !important;
      border-radius: 8px !important;
      padding: 12px !important;
      margin: 12px 0 !important;
      text-align: center !important;
      display: block !important;
      z-index: 10000 !important;
    `;
    wrapper.appendChild(btn);

    const container = article.parentElement || article;

    btn.addEventListener('click', () => handleFactCheck(container, btn));

    // Insert button at the END of the article
    article.appendChild(wrapper);
    console.log('✓ Button wrapper appended to article');

    // Check button visibility
    setTimeout(() => {
      const rect = btn.getBoundingClientRect();
      console.log('Button rect:', rect);
      console.log('Button offsetHeight:', btn.offsetHeight);
      console.log('Button offsetWidth:', btn.offsetWidth);
      console.log('Button computed display:', getComputedStyle(btn).display);
      console.log('On screen?', rect.y >= 0 && rect.y < window.innerHeight);
    }, 100);
  }

  // Inject on initial load
  setTimeout(injectButton, 500);

  // Re-inject periodically (in case React removes it)
  setInterval(injectButton, 2000);

  // Also re-inject on URL changes
  const originalPushState = window.history.pushState;
  window.history.pushState = function(...args) {
    originalPushState.apply(window.history, args);
    setTimeout(injectButton, 500);
    return;
  };

  window.addEventListener('popstate', () => {
    setTimeout(injectButton, 500);
  });
})();

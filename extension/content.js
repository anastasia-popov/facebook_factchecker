(function () {
  const ATTR = 'data-factcheck-injected';
  const BACKEND_URL = 'http://localhost:8000';

  function isTopLevelPost(el) {
    return !el.parentElement?.closest('[role="article"]');
  }

  function extractPostText(article) {
    const clone = article.cloneNode(true);
    clone.querySelectorAll('[role="toolbar"]').forEach(el => el.remove());
    clone.querySelectorAll('[aria-label*="comment" i]').forEach(el => el.remove());
    clone.querySelectorAll('[aria-label*="reaction" i]').forEach(el => el.remove());
    clone.querySelectorAll('[aria-label*="like" i]').forEach(el => el.remove());
    clone.querySelectorAll('[aria-label*="share" i]').forEach(el => el.remove());

    const text = clone.innerText.trim();
    return text.slice(0, 2000);
  }

  function escapeHtml(text) {
    const map = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, m => map[m]);
  }

  function removeOverlay(article) {
    article.querySelector('[data-fc-overlay]')?.remove();
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

  function showResults(article, data) {
    removeOverlay(article);
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
      overlay.querySelector('.fc-close').addEventListener('click', () => removeOverlay(article));
    }

    article.appendChild(overlay);
  }

  function showError(article, message) {
    removeOverlay(article);
    const overlay = document.createElement('div');
    overlay.className = 'fc-overlay fc-overlay-error';
    overlay.setAttribute('data-fc-overlay', 'true');
    overlay.innerHTML = `
      <span class="fc-error-icon">⚠️</span>
      <span>${escapeHtml(message)}</span>
      <button class="fc-close" aria-label="Close">✕</button>
    `;
    overlay.querySelector('.fc-close').addEventListener('click', () => removeOverlay(article));
    article.appendChild(overlay);
  }

  async function handleFactCheck(article, btn) {
    btn.disabled = true;
    btn.textContent = 'Checking…';
    removeOverlay(article);

    const text = extractPostText(article);
    if (!text.trim()) {
      showError(article, 'Could not extract text from this post.');
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
        showError(article, err.detail || 'Backend error');
      } else {
        const data = await res.json();
        showResults(article, data);
      }
    } catch (e) {
      showError(article, 'Cannot reach backend — is it running on port 8000?');
    } finally {
      btn.disabled = false;
      btn.textContent = '🔍 Fact Check';
    }
  }

  function injectButton(article) {
    if (article.hasAttribute(ATTR)) return;
    if (!isTopLevelPost(article)) return;
    article.setAttribute(ATTR, 'true');

    const btn = document.createElement('button');
    btn.className = 'fc-btn';
    btn.textContent = '🔍 Fact Check';
    btn.addEventListener('click', () => handleFactCheck(article, btn));

    const wrapper = document.createElement('div');
    wrapper.className = 'fc-btn-wrapper';
    wrapper.appendChild(btn);
    article.appendChild(wrapper);
  }

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        if (node.getAttribute?.('role') === 'article') {
          injectButton(node);
        } else {
          node.querySelectorAll?.('[role="article"]').forEach(injectButton);
        }
      }
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
  document.querySelectorAll('[role="article"]').forEach(injectButton);
})();

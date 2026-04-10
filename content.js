function normalizeWhitespace(text) {
  return (text || '')
    .replace(/\u00A0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function looksLikeLatex(text) {
  return /\\[a-zA-Z]+|[_^{}]/.test(text || '');
}

function getPageMeta() {
  return {
    url: location.href,
    title: document.title || location.href,
    capturedAt: new Date().toISOString()
  };
}

function extractLatexFromFormulaElement(el) {
  if (!el) return null;

  const annotation = el.querySelector('annotation[encoding="application/x-tex"], annotation[encoding="TeX"], annotation[encoding="application/tex"]');
  if (annotation?.textContent?.trim()) return annotation.textContent.trim();

  const scriptTex = el.querySelector('script[type^="math/tex"]');
  if (scriptTex?.textContent?.trim()) return scriptTex.textContent.trim();

  const katexAnnotation = el.querySelector('.katex-mathml annotation');
  if (katexAnnotation?.textContent?.trim()) return katexAnnotation.textContent.trim();

  const attrs = ['data-tex', 'data-latex', 'latex', 'alttext', 'aria-label'];
  for (const attr of attrs) {
    const value = el.getAttribute?.(attr);
    if (value && looksLikeLatex(value.trim())) return value.trim();
  }

  const imgAlt = el.tagName === 'IMG' ? el.getAttribute('alt') : null;
  if (imgAlt && looksLikeLatex(imgAlt.trim())) return imgAlt.trim();

  return null;
}

function formulaTextFallback(el) {
  const text = normalizeWhitespace(el.innerText || el.textContent || '');
  return text || null;
}

function processNode(node, results) {
  if (!node) return;

  if (node.nodeType === Node.TEXT_NODE) {
    const text = normalizeWhitespace(node.textContent || '');
    if (text) results.push({ type: 'text', content: text });
    return;
  }

  if (node.nodeType !== Node.ELEMENT_NODE) return;

  const el = node;
  const formulaSelector = 'math, .katex, .katex-display, .MathJax, mjx-container, [role="math"]';

  if (el.matches?.(formulaSelector)) {
    const latex = extractLatexFromFormulaElement(el);
    if (latex) {
      results.push({ type: 'formula', content: latex, format: 'latex' });
      return;
    }

    const fallback = formulaTextFallback(el);
    if (fallback) {
      results.push({ type: 'formula', content: fallback, format: 'text' });
      return;
    }
  }

  for (const child of Array.from(el.childNodes)) {
    processNode(child, results);
  }
}

function dedupeAdjacent(items) {
  const output = [];
  for (const item of items) {
    const prev = output[output.length - 1];
    if (prev && prev.type === item.type && prev.content === item.content && prev.format === item.format) continue;
    output.push(item);
  }
  return output;
}

function rangeToStructuredContent(range) {
  const fragment = range.cloneContents();
  const raw = [];
  processNode(fragment, raw);
  return dedupeAdjacent(raw).filter(item => item.content?.trim());
}

function getActiveSelection() {
  const sel = window.getSelection();
  if (sel && sel.rangeCount > 0 && !sel.isCollapsed && normalizeWhitespace(sel.toString())) {
    return sel;
  }
  return null;
}

function selectionToPayload() {
  const sel = getActiveSelection();
  if (!sel) return null;

  const range = sel.getRangeAt(0);
  const items = rangeToStructuredContent(range);
  const plainText = normalizeWhitespace(sel.toString());
  if (!items.length && !plainText) return null;

  return {
    ...getPageMeta(),
    plainText,
    items: items.length ? items : [{ type: 'text', content: plainText }]
  };
}

function getBestCopyText(payload) {
  if (!payload) return '';
  const formulaLatex = (payload.items || []).find(item => item.type === 'formula' && item.format === 'latex')?.content;
  return formulaLatex || payload.plainText || (payload.items || []).map(item => item.content).join('\n');
}

function noteTextFromPayload(payload) {
  return normalizeWhitespace((payload.items || []).map(item => item.content || '').filter(Boolean).join('\n') || payload.plainText || '');
}

function makePayloadSignature(payload) {
  return JSON.stringify({
    url: payload.url || '',
    plainText: normalizeWhitespace(payload.plainText || ''),
    items: (payload.items || []).map(item => ({
      type: item.type,
      format: item.format || '',
      content: normalizeWhitespace(item.content || '')
    }))
  });
}

async function saveSelectionLocally(payload, options = {}) {
  const stored = await chrome.storage.local.get(['notes', 'lastSavedSignature', 'settings', 'allItemsText']);
  const notes = Array.isArray(stored.notes) ? stored.notes : [];
  const settings = stored.settings || {};
  const now = Date.now();
  const signature = makePayloadSignature(payload);

  if (!options.forceSave && stored.lastSavedSignature?.signature === signature && now - (stored.lastSavedSignature?.at || 0) < 2500) {
    return { ok: true, skipped: true, noteId: notes[0]?.id || null, local: true };
  }

  const note = {
    id: (crypto && crypto.randomUUID) ? crypto.randomUUID() : String(now),
    title: payload.title || payload.url || 'Untitled',
    url: payload.url || '',
    pageKey: payload.url || payload.title || 'Untitled',
    capturedAt: payload.capturedAt || new Date().toISOString(),
    plainText: settings.normalizeText !== false ? normalizeWhitespace(payload.plainText || '') : (payload.plainText || ''),
    items: (payload.items || []).map(item => ({
      ...item,
      content: settings.normalizeText !== false ? normalizeWhitespace(item.content || '') : (item.content || '')
    })).filter(item => item.content)
  };

  if (!note.items.length && note.plainText) note.items = [{ type: 'text', content: note.plainText }];
  if (!note.items.length) return { ok: false, error: 'No content to save' };

  notes.unshift(note);
  const noteText = noteTextFromPayload(note);
  const allItemsText = noteText ? (stored.allItemsText ? `${stored.allItemsText}\n\n${noteText}` : noteText) : (stored.allItemsText || '');

  await chrome.storage.local.set({
    notes,
    allItemsText,
    lastSavedSignature: { signature, at: now }
  });
  return { ok: true, noteId: note.id, local: true };
}

async function saveSelectionViaBackground(payload, options = {}) {
  try {
    const result = await chrome.runtime.sendMessage({
      type: 'SAVE_SELECTION_PAYLOAD',
      payload,
      options
    });
    if (result?.ok) return result;
  } catch {}
  return null;
}

async function saveSelection(payload, options = {}) {
  const bgResult = await saveSelectionViaBackground(payload, options);
  if (bgResult?.ok) return { ...bgResult, channel: 'background' };

  const localResult = await saveSelectionLocally(payload, options).catch((error) => ({ ok: false, error: String(error) }));
  try {
    await chrome.runtime.sendMessage({ type: 'OPEN_SIDE_PANEL_AFTER_LOCAL_SAVE', options }).catch(() => null);
  } catch {}
  return localResult;
}

async function captureCurrentSelection() {
  const payload = selectionToPayload();
  if (!payload) return { ok: false, error: 'No selection' };
  return saveSelection(payload);
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'CAPTURE_SELECTION') {
    captureCurrentSelection()
      .then((result) => sendResponse({ ok: !!result?.ok }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }
});

let toolbar = null;
let toolbarHideTimer = null;
let latestSelection = null;
let rafToken = 0;
let toolbarSnapshot = null;
let toolbarInteracting = false;

function clearToolbar() {
  toolbarSnapshot = null;
  if (toolbar) {
    toolbar.remove();
    toolbar = null;
  }
}

function scheduleToolbarHide(delay = 2500) {
  clearTimeout(toolbarHideTimer);
  toolbarHideTimer = setTimeout(() => clearToolbar(), delay);
}

function getSelectionRect(range) {
  if (!range) return null;
  const rects = Array.from(range.getClientRects()).filter(r => r.width > 0 || r.height > 0);
  if (rects.length) {
    return rects[rects.length - 1];
  }
  const rect = range.getBoundingClientRect();
  if (rect && (rect.width > 0 || rect.height > 0)) return rect;
  return null;
}

function storeLatestSelection() {
  const sel = getActiveSelection();
  if (!sel) return null;
  const range = sel.getRangeAt(0).cloneRange();
  const payload = selectionToPayload();
  const rect = getSelectionRect(range);
  if (!payload || !rect) return null;
  latestSelection = { payload, range, rect };
  return latestSelection;
}

function clonePayload(payload) {
  return payload ? JSON.parse(JSON.stringify(payload)) : null;
}

function getSelectionSnapshot() {
  return storeLatestSelection() || latestSelection;
}

function flashButton(button, icon, color) {
  if (!button) return;
  const previousHTML = button.innerHTML;
  const previousBackground = button.style.background;
  button.innerHTML = icon;
  if (color) button.style.background = color;
  setTimeout(() => {
    if (!button.isConnected) return;
    button.innerHTML = previousHTML;
    button.style.background = previousBackground;
  }, 900);
}

let toolbarActionSnapshot = null;

function createIconButton({ title, svg, onAction, beforeClick }) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.title = title;
  btn.innerHTML = svg;
  btn.style.cssText = [
    'width: 34px',
    'height: 34px',
    'border-radius: 999px',
    'border: 1px solid rgba(148,163,184,0.35)',
    'background: rgba(17,24,39,0.96)',
    'display: inline-flex',
    'align-items: center',
    'justify-content: center',
    'padding: 0',
    'cursor: pointer',
    'color: #ffffff',
    'box-shadow: 0 2px 8px rgba(0,0,0,0.2)'
  ].join(';');
  btn.addEventListener('pointerdown', async (event) => {
    toolbarInteracting = true;
    toolbarActionSnapshot = toolbarSnapshot || getSelectionSnapshot() || latestSelection;
    if (typeof beforeClick === 'function') beforeClick(toolbarActionSnapshot);
    event.preventDefault();
    event.stopPropagation();
    try {
      await onAction?.(event, toolbarActionSnapshot);
    } finally {
      setTimeout(() => { toolbarInteracting = false; }, 0);
    }
  });
  btn.addEventListener('mousedown', (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  btn.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  btn.addEventListener('mouseenter', () => clearTimeout(toolbarHideTimer));
  btn.addEventListener('mouseleave', () => scheduleToolbarHide());
  return btn;
}

function getToolbarPosition(rect) {
  const toolbarWidth = 126;
  let left = rect.right + 8;
  let top = rect.top - 42;

  if (left + toolbarWidth > window.innerWidth - 8) {
    left = rect.left;
  }
  if (left < 8) left = 8;
  if (top < 8) top = rect.bottom + 8;
  if (top > window.innerHeight - 52) top = Math.max(8, window.innerHeight - 52);

  return { top, left };
}

function canHighlightSelection(snapshot) {
  const range = snapshot?.range;
  if (!range || range.collapsed) return false;
  const badAncestor = [range.startContainer, range.endContainer].some((node) => {
    const el = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
    return el?.closest?.('input, textarea, [contenteditable="true"], [contenteditable=""], pre code, #selection-notes-floating-toolbar');
  });
  return !badAncestor;
}

function getTextNodesInRange(range) {
  const root = range.commonAncestorContainer.nodeType === Node.TEXT_NODE
    ? range.commonAncestorContainer.parentNode
    : range.commonAncestorContainer;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
      try {
        return range.intersectsNode(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      } catch {
        return NodeFilter.FILTER_REJECT;
      }
    }
  });

  const nodes = [];
  let current;
  while ((current = walker.nextNode())) nodes.push(current);
  return nodes;
}

function wrapTextNodeRange(textNode, startOffset, endOffset) {
  if (!textNode || startOffset >= endOffset) return false;
  const range = document.createRange();
  range.setStart(textNode, startOffset);
  range.setEnd(textNode, endOffset);
  const mark = document.createElement('mark');
  mark.setAttribute('data-selection-notes-highlight', '1');
  mark.style.background = 'rgba(255, 221, 87, 0.78)';
  mark.style.color = 'inherit';
  mark.style.padding = '0 0.06em';
  mark.style.borderRadius = '0.22em';
  try {
    range.surroundContents(mark);
    return true;
  } catch {
    return false;
  }
}

function highlightSnapshot(snapshot) {
  if (!canHighlightSelection(snapshot)) return false;
  const range = snapshot.range.cloneRange();
  const nodes = getTextNodesInRange(range);
  let changed = false;

  for (const node of nodes) {
    if (!node.parentNode || node.parentElement?.closest?.('mark[data-selection-notes-highlight="1"]')) continue;
    const start = node === range.startContainer ? range.startOffset : 0;
    const end = node === range.endContainer ? range.endOffset : node.nodeValue.length;
    changed = wrapTextNodeRange(node, start, end) || changed;
  }

  return changed;
}

function ensureToolbar() {
  if (toolbar?.isConnected) return toolbar;
  toolbar = document.createElement('div');
  toolbar.id = 'selection-notes-floating-toolbar';
  toolbar.style.cssText = [
    'position: fixed',
    'z-index: 2147483647',
    'display: none',
    'gap: 6px',
    'padding: 6px',
    'background: rgba(15,23,42,0.98)',
    'border: 1px solid rgba(148,163,184,0.3)',
    'border-radius: 999px',
    'box-shadow: 0 12px 30px rgba(0,0,0,0.28)',
    'backdrop-filter: blur(6px)'
  ].join(';');

  const copySvg = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
  const saveSvg = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>';
  const highlightSvg = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 11-6 6v3h9l6-6"></path><path d="m22 12-4-4"></path><path d="M15 5 19 9"></path><path d="M2 21h20"></path></svg>';

  const copyBtn = createIconButton({
    title: 'Copy selected content',
    svg: copySvg,
    onAction: async (event, snapshot) => {
      event.preventDefault();
      event.stopPropagation();
      const payload = clonePayload(snapshot?.payload || toolbarSnapshot?.payload || latestSelection?.payload || selectionToPayload());
      if (!payload) return;
      await navigator.clipboard.writeText(getBestCopyText(payload)).catch(() => null);
      flashButton(copyBtn, '✓', 'rgba(5,150,105,0.95)');
      scheduleToolbarHide();
    }
  });

  const saveBtn = createIconButton({
    title: 'Add to sidebar',
    svg: saveSvg,
    beforeClick: (snapshot) => {
      if (snapshot?.payload) {
        latestSelection = {
          payload: clonePayload(snapshot.payload),
          range: snapshot.range?.cloneRange?.() || snapshot.range || null,
          rect: snapshot.rect || null
        };
      }
    },
    onAction: async (event, snapshot) => {
      event.preventDefault();
      event.stopPropagation();
      const stablePayload = clonePayload(
        snapshot?.payload ||
        toolbarActionSnapshot?.payload ||
        toolbarSnapshot?.payload ||
        latestSelection?.payload ||
        selectionToPayload()
      );
      let result = { ok: false };
      if (stablePayload) {
        result = await saveSelection(stablePayload, { forceSave: true, source: 'floating_toolbar' }).catch(() => ({ ok: false }));
      }
      flashButton(saveBtn, result?.ok ? '✓' : '!', result?.ok ? 'rgba(37,99,235,0.95)' : 'rgba(220,38,38,0.95)');
      scheduleToolbarHide();
    }
  });

  const highlightBtn = createIconButton({
    title: 'Highlight on page',
    svg: highlightSvg,
    onAction: async (event, snapshot) => {
      event.preventDefault();
      event.stopPropagation();
      const stableSnapshot = snapshot || toolbarSnapshot || latestSelection || getSelectionSnapshot();
      const ok = highlightSnapshot(stableSnapshot);
      flashButton(highlightBtn, ok ? '✓' : '!', ok ? 'rgba(202,138,4,0.95)' : 'rgba(220,38,38,0.95)');
      scheduleToolbarHide();
    }
  });

  toolbar.append(copyBtn, saveBtn, highlightBtn);
  toolbar.addEventListener('mouseenter', () => { toolbarInteracting = true; clearTimeout(toolbarHideTimer); });
  toolbar.addEventListener('mouseleave', () => { toolbarInteracting = false; scheduleToolbarHide(); });
  document.documentElement.appendChild(toolbar);
  return toolbar;
}

function showToolbar() {
  const snapshot = getSelectionSnapshot();
  if (!snapshot?.payload || !snapshot?.rect) {
    clearToolbar();
    return;
  }

  const bar = ensureToolbar();
  toolbarSnapshot = {
    payload: clonePayload(snapshot.payload),
    range: snapshot.range.cloneRange(),
    rect: snapshot.rect
  };
  const { top, left } = getToolbarPosition(snapshot.rect);
  bar.style.top = `${top}px`;
  bar.style.left = `${left}px`;
  bar.style.display = 'flex';
  scheduleToolbarHide();
}

function refreshToolbarSoon() {
  cancelAnimationFrame(rafToken);
  rafToken = requestAnimationFrame(() => {
    const snapshot = storeLatestSelection();
    if (!snapshot) {
      clearToolbar();
      return;
    }
    showToolbar();
  });
}

document.addEventListener('mouseup', () => {
  setTimeout(refreshToolbarSoon, 20);
}, true);

document.addEventListener('touchend', () => {
  setTimeout(refreshToolbarSoon, 30);
}, true);

document.addEventListener('keyup', (event) => {
  if (event.key === 'Shift' || event.key.startsWith('Arrow')) {
    setTimeout(refreshToolbarSoon, 20);
  }
}, true);

document.addEventListener('selectionchange', () => {
  const sel = getActiveSelection();
  if (!sel) {
    if (toolbarInteracting || (toolbar && document.activeElement instanceof Element && toolbar.contains(document.activeElement))) {
      return;
    }
    clearTimeout(toolbarHideTimer);
    clearToolbar();
    return;
  }
  refreshToolbarSoon();
}, true);

document.addEventListener('scroll', () => {
  if (toolbar?.isConnected && toolbar.style.display !== 'none' && getActiveSelection()) {
    refreshToolbarSoon();
  }
}, true);

document.addEventListener('mousedown', (event) => {
  if (toolbar && event.target instanceof Element && toolbar.contains(event.target)) return;
  clearTimeout(toolbarHideTimer);
}, true);

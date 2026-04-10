const MENU_ID = 'save-selection-to-sidebar';

function normalizeWhitespace(text) {
  return (text || '')
    .replace(/\u00A0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function noteTextFromPayload(payload, normalize = true) {
  const raw = (payload.items || []).map(item => item.content || '').filter(Boolean).join('\n') || payload.plainText || '';
  return normalize ? normalizeWhitespace(raw) : raw;
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

async function ensureDefaults() {
  const existing = await chrome.storage.local.get(['notes', 'settings', 'scratchPad', 'allItemsText']);
  await chrome.storage.local.set({
    notes: Array.isArray(existing.notes) ? existing.notes : [],
    scratchPad: typeof existing.scratchPad === 'string' ? existing.scratchPad : '',
    allItemsText: typeof existing.allItemsText === 'string' ? existing.allItemsText : '',
    settings: {
      autoCapture: true,
      normalizeText: true,
      openPanelOnSave: true
    }
  });
}

async function savePayload(payload, options = {}) {
  const stored = await chrome.storage.local.get(['notes', 'settings', 'lastSavedSignature', 'allItemsText']);
  const notes = Array.isArray(stored.notes) ? stored.notes : [];
  const settings = stored.settings || {};
  const now = Date.now();
  const signature = makePayloadSignature(payload);

  if (!options.forceSave && stored.lastSavedSignature?.signature === signature && now - (stored.lastSavedSignature?.at || 0) < 2500) {
    return { ok: true, skipped: true, noteId: notes[0]?.id || null };
  }

  const normalizedItems = (payload.items || []).map(item => ({
    ...item,
    content: settings.normalizeText !== false ? normalizeWhitespace(item.content || '') : (item.content || '')
  })).filter(item => item.content);

  const normalizedPlainText = settings.normalizeText !== false
    ? normalizeWhitespace(payload.plainText || '')
    : (payload.plainText || '');

  const note = {
    id: crypto.randomUUID(),
    title: payload.title || payload.url || 'Untitled',
    url: payload.url || '',
    pageKey: payload.url || payload.title || 'Untitled',
    capturedAt: payload.capturedAt || new Date().toISOString(),
    plainText: normalizedPlainText,
    items: normalizedItems.length ? normalizedItems : [{ type: 'text', content: normalizedPlainText }]
  };

  notes.unshift(note);
  const noteText = noteTextFromPayload(note, settings.normalizeText !== false);
  const allItemsText = noteText
    ? (stored.allItemsText ? `${stored.allItemsText}\n\n${noteText}` : noteText)
    : (stored.allItemsText || '');

  await chrome.storage.local.set({
    notes,
    allItemsText,
    lastSavedSignature: { signature, at: now }
  });
  return { ok: true, noteId: note.id };
}

chrome.runtime.onInstalled.addListener(async () => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ID,
      title: 'Save selection to sidebar',
      contexts: ['selection']
    });
  });
  await ensureDefaults();
});

chrome.runtime.onStartup?.addListener(() => {
  ensureDefaults().catch(() => null);
});

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab?.windowId) return;
  await chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => null);
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID || !tab?.windowId) return;

  let saved = false;
  try {
    if (tab.id) {
      const response = await chrome.tabs.sendMessage(tab.id, { type: 'CAPTURE_SELECTION' });
      saved = !!response?.ok;
    }
  } catch {
    saved = false;
  }

  if (!saved && info.selectionText?.trim()) {
    const result = await savePayload({
      title: tab.title || info.pageUrl || 'Untitled',
      url: info.pageUrl || tab.url || '',
      capturedAt: new Date().toISOString(),
      plainText: info.selectionText,
      items: [{ type: 'text', content: info.selectionText }]
    }, { forceSave: true, source: 'context_menu' });
    saved = !!result?.ok;
  }

  await chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => null);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'OPEN_SIDE_PANEL_AFTER_LOCAL_SAVE' && sender.tab?.windowId) {
    chrome.sidePanel.open({ windowId: sender.tab.windowId })
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (message?.type === 'SAVE_SELECTION_PAYLOAD') {
    savePayload(message.payload || {}, message.options || {})
      .then(async (result) => {
        if (sender.tab?.windowId) {
          await chrome.sidePanel.open({ windowId: sender.tab.windowId }).catch(() => null);
        }
        sendResponse(result);
      })
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }
});

const timelineList = document.getElementById('timelineList');
const groupedList = document.getElementById('groupedList');
const countBadge = document.getElementById('countBadge');
const noteTemplate = document.getElementById('noteTemplate');
const groupTemplate = document.getElementById('groupTemplate');
const scratchPad = document.getElementById('scratchPad');
const copyScratchBtn = document.getElementById('copyScratchBtn');
const clearAllBtn = document.getElementById('clearAllBtn');
const clearMergedBtn = document.getElementById('clearMergedBtn');

function serializeNote(note) {
  return (note.items || []).map(item => item.content || '').filter(Boolean).join('\n');
}

async function copyText(text) {
  await navigator.clipboard.writeText(text || '');
}

function makeChunk(item) {
  const wrap = document.createElement('div');
  wrap.className = 'chunk';
  const content = document.createElement('div');
  content.textContent = item.content || '';
  wrap.appendChild(content);
  return wrap;
}

async function updateAllItemsText(value) {
  await chrome.storage.local.set({ allItemsText: value || '' });
}

async function deleteNote(id) {
  const { notes } = await chrome.storage.local.get(['notes']);
  const next = (notes || []).filter(note => note.id !== id);
  await chrome.storage.local.set({ notes: next });
}

function setButtonFlash(button, text) {
  const original = button.textContent;
  button.textContent = text;
  button.classList.add('saved-ok');
  setTimeout(() => {
    button.textContent = original;
    button.classList.remove('saved-ok');
  }, 900);
}

function renderAllItemsEditor(allItemsText) {
  const wrap = document.createElement('article');
  wrap.className = 'note-card';

  const head = document.createElement('div');
  head.className = 'note-head';

  const main = document.createElement('div');
  main.className = 'note-main';
  const title = document.createElement('h3');
  title.className = 'note-title';
  title.textContent = 'Merged content';
  main.appendChild(title);

  const actions = document.createElement('div');
  actions.className = 'note-actions';
  const copyBtn = document.createElement('button');
  copyBtn.className = 'ghost';
  copyBtn.textContent = 'Copy';
  const saveBtn = document.createElement('button');
  saveBtn.className = 'ghost';
  saveBtn.textContent = 'Save';
  actions.append(copyBtn, saveBtn);
  head.append(main, actions);

  const body = document.createElement('div');
  body.className = 'note-body';
  const editor = document.createElement('textarea');
  editor.className = 'all-items-editor';
  editor.value = allItemsText || '';
  editor.placeholder = 'Saved content will appear here in one merged box.';
  body.appendChild(editor);
  wrap.append(head, body);

  copyBtn.addEventListener('click', async () => {
    await copyText(editor.value || '');
    setButtonFlash(copyBtn, 'Copied');
  });
  const persist = async () => {
    await updateAllItemsText(editor.value);
    setButtonFlash(saveBtn, 'Saved');
  };
  saveBtn.addEventListener('click', persist);
  editor.addEventListener('blur', persist);
  return wrap;
}

function renderPageNoteCard(note) {
  const node = noteTemplate.content.firstElementChild.cloneNode(true);
  node.querySelector('.note-title').textContent = note.title || 'Untitled';
  const link = node.querySelector('.note-link');
  link.href = note.url || '#';
  link.textContent = note.url || '';
  const body = node.querySelector('.note-body');
  for (const item of note.items || []) {
    body.appendChild(makeChunk(item));
  }

  node.querySelector('.copy-note').addEventListener('click', async () => {
    await copyText(serializeNote(note));
    setButtonFlash(node.querySelector('.copy-note'), 'Copied');
  });
  node.querySelector('.save-note').remove();
  node.querySelector('.highlight-note').remove();
  node.querySelector('.delete-note').addEventListener('click', async () => {
    await deleteNote(note.id);
    await render();
  });
  return node;
}

function groupNotesByPage(notes) {
  const map = new Map();
  for (const note of notes) {
    const key = note.pageKey || note.url || note.title || 'Untitled';
    if (!map.has(key)) {
      map.set(key, {
        key,
        title: note.title || 'Untitled',
        url: note.url || '',
        items: []
      });
    }
    map.get(key).items.push(note);
  }
  return Array.from(map.values());
}

async function render() {
  const { notes, scratchPad: savedScratch, allItemsText } = await chrome.storage.local.get(['notes', 'scratchPad', 'allItemsText']);
  const list = Array.isArray(notes) ? notes : [];
  countBadge.textContent = String(list.length);

  if (document.activeElement !== scratchPad) {
    scratchPad.value = savedScratch || '';
  }

  timelineList.innerHTML = '';
  groupedList.innerHTML = '';

  timelineList.appendChild(renderAllItemsEditor(allItemsText || ''));

  if (!list.length) {
    const empty2 = document.createElement('div');
    empty2.className = 'empty';
    empty2.textContent = 'Page-based groups will appear here after you save content.';
    groupedList.appendChild(empty2);
    return;
  }

  const groups = groupNotesByPage(list);
  for (const group of groups) {
    const node = groupTemplate.content.firstElementChild.cloneNode(true);
    node.querySelector('.group-title').textContent = group.title || 'Untitled';
    const link = node.querySelector('.group-link');
    link.href = group.url || '#';
    link.textContent = group.url || '';
    node.querySelector('.group-count').textContent = String(group.items.length);

    const container = node.querySelector('.group-list');
    for (const note of group.items) {
      container.appendChild(renderPageNoteCard(note));
    }

    groupedList.appendChild(node);
  }
}

scratchPad.addEventListener('input', async () => {
  await chrome.storage.local.set({ scratchPad: scratchPad.value });
});

copyScratchBtn.addEventListener('click', async () => {
  await copyText(scratchPad.value || '');
  setButtonFlash(copyScratchBtn, 'Copied');
});


clearMergedBtn?.addEventListener('click', async () => {
  await chrome.storage.local.set({ allItemsText: '' });
  await render();
});

clearAllBtn.addEventListener('click', async () => {
  await chrome.storage.local.set({ notes: [], allItemsText: '' });
  await render();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.notes || changes.scratchPad || changes.allItemsText)) {
    render();
  }
});

render();

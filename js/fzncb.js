
let notes = JSON.parse(localStorage.getItem('aloft_notes') || '[]');
let activeNoteId = null;
let noteSaveTimer = null;

function createNote() {
  const id = Date.now().toString();
  const note = { id, title: '', body: '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  notes.unshift(note); saveNotesToStorage(); renderNotesList(); openNote(id);
}

function openNote(id) {
  activeNoteId = id;
  const note = notes.find(n => n.id === id);
  if (!note) return;
  document.getElementById('notesEditorEmpty').style.display = 'none';
  const activeEl = document.getElementById('notesEditorActive');
  activeEl.style.display = 'flex'; activeEl.style.flexDirection = 'column'; activeEl.style.flex = '1'; activeEl.style.overflow = 'hidden';
  document.getElementById('noteTitleInput').value = note.title;
  document.getElementById('noteBodyInput').value = note.body;
  document.getElementById('noteSaveStatus').textContent = 'saved';
  document.getElementById('noteSaveStatus').className = 'note-save-status saved';
  renderNotesList();
  document.getElementById('noteTitleInput').focus();
}

function autoSaveNote() {
  if (!activeNoteId) return;
  document.getElementById('noteSaveStatus').textContent = 'saving…';
  document.getElementById('noteSaveStatus').className = 'note-save-status';
  clearTimeout(noteSaveTimer);
  noteSaveTimer = setTimeout(() => {
    const note = notes.find(n => n.id === activeNoteId);
    if (!note) return;
    note.title = document.getElementById('noteTitleInput').value;
    note.body = document.getElementById('noteBodyInput').value;
    note.updatedAt = new Date().toISOString();
    notes = [note, ...notes.filter(n => n.id !== activeNoteId)];
    saveNotesToStorage(); renderNotesList();
    document.getElementById('noteSaveStatus').textContent = 'saved';
    document.getElementById('noteSaveStatus').className = 'note-save-status saved';
  }, 600);
}

function deleteActiveNote() {
  if (!activeNoteId) return;
  if (!confirm('Delete this note?')) return;
  notes = notes.filter(n => n.id !== activeNoteId);
  activeNoteId = null; saveNotesToStorage(); renderNotesList();
  document.getElementById('notesEditorEmpty').style.display = 'flex';
  document.getElementById('notesEditorActive').style.display = 'none';
}

function saveNotesToStorage() { localStorage.setItem('aloft_notes', JSON.stringify(notes)); }

function renderNotesList() {
  const list = document.getElementById('notesList');
  list.innerHTML = '';
  if (notes.length === 0) {
    list.innerHTML = `<div class="notes-empty"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg><p>No notes yet.<br>Create one above.</p></div>`;
    return;
  }
  notes.forEach(note => {
    const item = document.createElement('div');
    item.className = 'note-item' + (note.id === activeNoteId ? ' active' : '');
    item.onclick = () => openNote(note.id);
    const preview = note.body.split('\n')[0] || 'No content';
    const d = parseSupabaseDate(note.updatedAt);
    const dateStr = d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    item.innerHTML = `
      <div class="note-item-title">${escHtml(note.title || 'Untitled')}</div>
      <div class="note-item-preview">${escHtml(preview)}</div>
      <div class="note-item-date">${dateStr}</div>
    `;
    list.appendChild(item);
  });
}

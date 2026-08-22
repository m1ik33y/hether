
const emojis = ['😀','😁','😂','🤣','😃','😄','😅','😆','😉','😊','😋','😎','😍','😘','🥰','😗',
'😙','😚','🙂','🤗','🤩','🤔','🤨','😐','😑','😶','🙄','😏','😣','😥','😮','🤐',
'😯','😪','😫','🥱','😴','😌','😛','😜','😝','🤤','😒','😓','😔','😕','🙃','🫠',
'🤑','😲','☹️','🙁','😖','😞','😟','😤','😢','😭','😦','😧','😨','😩','🤯','😬',
'😰','😱','🥵','🥶','😳','🤪','😵','🥴','😠','😡','🤬','😷','🤒','🤕','🤢','🤮',
'🤧','🥳','🥸','😇','🤠','🤡','💀','👻','👽','🤖','🎃','😺','😸','😹','😻','😼',
'🙈','🙉','🙊','❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❣️','💕','💞',
'💓','💗','💖','💘','💝','🔥','✨','🌟','💫','🎉','🎊','🚀','💯','👍','👎','👌',
'👏','🙌','💪','🤝','🙏','👀','🧠','🫶','🥹','🥀','👑','👽','💩'];

const EMOJI_RECENT_KEY = 'aloft_recent_emojis';
const EMOJI_RECENT_MAX = 16;

function getRecentEmojis() {
  try { return JSON.parse(localStorage.getItem(EMOJI_RECENT_KEY) || '[]'); } catch { return []; }
}
function recordRecentEmoji(emoji) {
  let recent = getRecentEmojis();
  recent = [emoji, ...recent.filter(e => e !== emoji)].slice(0, EMOJI_RECENT_MAX);
  try { localStorage.setItem(EMOJI_RECENT_KEY, JSON.stringify(recent)); } catch {}
}

function buildEmojiGrid(emojisArr, picker) {
  const grid = document.createElement('div');
  grid.className = 'emoji-grid';
  emojisArr.forEach(emoji => {
    const btn = document.createElement('button');
    btn.className = 'emoji-item'; btn.textContent = emoji;
    btn.onclick = (e) => { e.stopPropagation(); insertEmoji(emoji); renderEmojiPicker(); };
    grid.appendChild(btn);
  });
  return grid;
}

function initEmojiPicker() {
  renderEmojiPicker();
}

function renderEmojiPicker() {
  const picker = document.getElementById('emojiPicker');
  picker.innerHTML = '';

  const recent = getRecentEmojis();
  if (recent.length > 0) {
    const label = document.createElement('div');
    label.className = 'emoji-section-label'; label.textContent = 'Recently Used';
    picker.appendChild(label);
    picker.appendChild(buildEmojiGrid(recent, picker));
  }

  const allLabel = document.createElement('div');
  allLabel.className = 'emoji-section-label'; allLabel.textContent = recent.length > 0 ? 'All Emojis' : '';
  if (recent.length > 0) picker.appendChild(allLabel);
  picker.appendChild(buildEmojiGrid(emojis, picker));
}

let emojiPickerMode = null;
function toggleEmojiPicker(mode = 'relay') {
  const overlay = document.getElementById('emojiPickerOverlay');
  const picker = document.getElementById('emojiPicker');
  if (emojiPickerMode === mode && overlay.classList.contains('show')) { closeEmojiPicker(); return; }
  emojiPickerMode = mode;
  let triggerEl;
  if (mode === 'flux') triggerEl = document.getElementById('fluxEmojiBtn');
  else if (mode === 'mobile') triggerEl = document.getElementById('fluxFsEmojiBtn');
  else triggerEl = document.getElementById('emojiBtn');
  if (triggerEl) {
    const rect = triggerEl.getBoundingClientRect();
    picker.style.bottom = (window.innerHeight - rect.top + 8) + 'px';
    picker.style.left = Math.max(8, rect.left - 10) + 'px';
    picker.style.top = 'auto'; picker.style.right = 'auto';
  }
  renderEmojiPicker();
  overlay.classList.add('show'); picker.classList.add('show');
}

function closeEmojiPicker() {
  document.getElementById('emojiPickerOverlay').classList.remove('show');
  document.getElementById('emojiPicker').classList.remove('show');
  emojiPickerMode = null;
}

function insertEmoji(emoji) {
  recordRecentEmoji(emoji);
  let input;
  if (emojiPickerMode === 'flux') input = document.getElementById('fluxInput');
  else if (emojiPickerMode === 'mobile') input = document.getElementById('fluxFsInput');
  else input = document.getElementById('userInput');
  if (input) {
    input.value += emoji; input.focus();
    if (emojiPickerMode === 'relay' || emojiPickerMode === null) toggleMediaButton();
    else if (emojiPickerMode === 'flux') toggleFluxSendBtn();
    else if (emojiPickerMode === 'mobile') toggleFluxFsSendBtn();
  }
}

function toggleMediaButton() {
  const input = document.getElementById('userInput');
  const sendBtn = document.getElementById('sendBtn');
  if (input.value.trim() === '' && !aiStagedMedia) sendBtn.disabled = true;
  else sendBtn.disabled = false;
}

function toggleFluxSendBtn() {
  const input = document.getElementById('fluxInput');
  const sendBtn = document.getElementById('fluxSendBtn');
  const mediaBtn = document.getElementById('fluxMediaBtn');
  if (input.value.trim() === '' && !fluxStagedMedia) { sendBtn.classList.add('hidden'); mediaBtn.classList.remove('hidden'); }
  else { sendBtn.classList.remove('hidden'); mediaBtn.classList.add('hidden'); }
}

function toggleFluxFsSendBtn() {
  const input = document.getElementById('fluxFsInput');
  const sendBtn = document.getElementById('fluxFsSendBtn');
  if (input.value.trim() === '' && !fluxFsStagedMedia) sendBtn.classList.add('hidden');
  else sendBtn.classList.remove('hidden');
}

window.addEventListener('load', function() {
  initEmojiPicker();
  toggleMediaButton();
  document.getElementById('fluxSendBtn')?.classList.add('hidden');
  document.getElementById('fluxFsSendBtn')?.classList.add('hidden');
});

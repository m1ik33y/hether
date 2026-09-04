// Emoji picker category icon sizing.
if (!document.getElementById('emoji-picker-category-icon-size')) {
  const style = document.createElement('style');
  style.id = 'emoji-picker-category-icon-size';
  style.textContent = `
    .emoji-picker-tabs .emoji-tab-btn svg {
      width: 21.5px !important;
      height: 21.5px !important;
    }
  `;
  document.head.appendChild(style);
}

const emojis = [
  // Smileys & People
  '😀','😁','😂','🤣','😃','😄','😅','😆','😉','😊','😋','😎','😍','😘','🥰','😗','😙','😚',
  '🙂','🤗','🤩','🤔','🤨','😐','😑','😶','🙄','😏','😣','😥','😮','🤐','😯','😪','😫','🥱',
  '😴','😌','😛','😜','😝','🤤','😒','😓','😔','😕','🙃','🫠','🤑','😲','☹️','🙁','😖','😞',
  '😟','😤','😢','😭','😦','😧','😨','😩','🤯','😬','😰','😱','🥵','🥶','😳','🤪','😵','🥴',
  '😠','😡','🤬','😷','🤒','🤕','🤢','🤮','🤧','🥳','🥸','😇','🤠','🤡','💀','👻','👽','🤖',
  '🎃','😺','😸','😹','😻','😼','🙈','🙉','🙊','👋','🤚','🖐️','✋','🖖','🫱','🫲','🫳','🫴',
  '👌','🤌','🤏','✌️','🤞','🫰','🤟','🤘','👈','👉','👆','🖕','👇','☝️','🫵','👍','👎','✊',
  '👊','🤛','🤜','👏','🙌','👐','🤲','🙏','✍️','💅','🤳','💪','🤝','👀',
  '🧠','🫶','🥹','👑',

  // Animals & Nature
  '🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐨','🐯','🦁','🐮','🐷','🐸','🐵','🙈','🙉','🙊',
  '🐔','🐧','🐦','🐤','🦆','🦅','🦉','🐺','🐗','🐴','🦄','🐝','🐛','🦋','🐌','🐞','🐜','🕷️',
  '🐢','🐍','🦎','🦖','🦕','🐙','🦑','🦀','🐠','🐟','🐡','🐬','🐳','🐋','🦈','🌸','🌹','🌺',
  '🌻','🌼','🌷','🌱','🌲','🌳','🌴','🌵','🍀','🍁','🍂','🍃','🌿','🌾','🌊','☀️','🌤️','🌈',
  '⭐','🌙','⚡','🔥','❄️','☁️','🌧️','🌪️','🌍',

  // Food & Drink
  '🍎','🍏','🍐','🍊','🍋','🍌','🍉','🍇','🍓','🫐','🍈','🍒','🍑','🥭','🍍','🥥','🥝','🍅',
  '🥑','🍆','🥔','🥕','🌽','🌶️','🥒','🥬','🥦','🧄','🧅','🍞','🥐','🥖','🥨','🧀','🥚','🍳',
  '🥞','🧇','🥓','🍗','🍔','🍟','🍕','🌭','🌮','🌯','🥗','🍿','🍜','🍝','🍣','🍱','🍚','🍙',
  '🍩','🍪','🎂','🍰','🧁','🍫','🍬','🍭','🍦','🍨','☕','🍵','🧃','🥤','🧋','🍹','🍸',

  // Activities
  '⚽','🏀','🏈','⚾','🥎','🎾','🏐','🏉','🥏','🎱','🏓','🏸','🏒','🏑','🥍','🏏','⛳','🏹',
  '🎣','🥊','🥋','🎽','🛹','🛼','🛷','⛸️','🏆','🥇','🥈','🥉','🎯','🎮','🕹️','🎲','🧩','🎨',
  '🎭','🎬','🎤','🎧','🎸','🎹','🥁','🎷','🎺','🎻','🎪','🎟️','🎉','🎊','🎈','🪅',

  // Travel & Places
  '🚗','🚕','🚙','🚌','🚎','🏎️','🚓','🚑','🚒','🚐','🛻','🚚','🚛','🚜','🏍️','🛵','🚲','✈️',
  '🛫','🛬','🚁','🚀','🛸','🚢','⛵','🚤','🚂','🚆','🚇','🚉','🗺️','🧭','🏝️','🏖️','🏕️','⛺',
  '🏠','🏡','🏢','🏙️','🌆','🌃','🏰','🏯','🗼','🗽','⛪','🕌','🛕','🗿','🗻','🌋','⛲','🎡','🎢',

  // Symbols & Hearts
  '❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❣️','💕','💞','💓','💗','💖','💘','💝',
  '💟','☮️','✝️','☪️','🕉️','☯️','✡️','🔯','🛐','💯','✨','💫','❗','❓','‼️','⁉️','⭕','❌',
  '✅','☑️','✔️','➕','➖','✖️','➗','♾️','⚠️','🚫','🔴','🟠','🟡','🟢','🔵','🟣','⚫','⚪',
  '🟤','🔶','🔷','🔺','🔻','⬆️','⬇️','⬅️','➡️','🔄','🔒','🔓','🔑','💡','📌','📍','💩'
];

// Category groupings — each tab has its own emoji set.
const emojiCategories = [
  {
    id: 'smileys', label: 'Smileys & People',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>',
    emojis: [
      '😀','😁','😂','🤣','😃','😄','😅','😆','😉','😊','😋','😎','😍','😘','🥰','😗','😙','😚',
      '🙂','🤗','🤩','🤔','🤨','😐','😑','😶','🙄','😏','😣','😥','😮','🤐','😯','😪','😫','🥱',
      '😴','😌','😛','😜','😝','🤤','😒','😓','😔','😕','🙃','🫠','🤑','😲','☹️','🙁','😖','😞',
      '😟','😤','😢','😭','😦','😧','😨','😩','🤯','😬','😰','😱','🥵','🥶','😳','🤪','😵','🥴',
      '😠','😡','🤬','😷','🤒','🤕','🤢','🤮','🤧','🥳','🥸','😇','🤠','🤡','💀','👻','👽','🤖',
      '🎃','😺','😸','😹','😻','😼','🙈','🙉','🙊','👋','🤚','🖐️','✋','🖖','🫱','🫲','🫳','🫴',
      '👌','🤌','🤏','✌️','🤞','🫰','🤟','🤘','👈','👉','👆','🖕','👇','☝️','🫵','👍','👎','✊',
      '👊','🤛','🤜','👏','🙌','👐','🤲','🙏','✍️','💅','🤳','💪','🤝','👀',
      '🧠','🫶','🥹','👑'
    ],
  },
  {
    id: 'animals', label: 'Animals & Nature',
    icon: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-paw-print-icon lucide-paw-print"><circle cx="11" cy="4" r="2"/><circle cx="18" cy="8" r="2"/><circle cx="20" cy="16" r="2"/><path d="M9 10a5 5 0 0 1 5 5v3.5a3.5 3.5 0 0 1-6.84 1.045Q6.52 17.48 4.46 16.84A3.5 3.5 0 0 1 5.5 10Z"/></svg>',
    emojis: [
      '🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐨','🐯','🦁','🐮','🐷','🐸','🐵','🙈','🙉','🙊',
      '🐔','🐧','🐦','🐤','🦆','🦅','🦉','🐺','🐗','🐴','🦄','🐝','🐛','🦋','🐌','🐞','🐜','🕷️',
      '🐢','🐍','🦎','🦖','🦕','🐙','🦑','🦀','🐠','🐟','🐡','🐬','🐳','🐋','🦈','🌸','🌹','🌺',
      '🌻','🌼','🌷','🌱','🌲','🌳','🌴','🌵','🍀','🍁','🍂','🍃','🌿','🌾','🌊','☀️','🌤️','🌈',
      '⭐','🌙','⚡','🔥','❄️','☁️','🌧️','🌪️','🌍'
    ],
  },
  {
    id: 'food', label: 'Food & Drink',
    icon: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-coffee-icon lucide-coffee"><path d="M10 2v2"/><path d="M14 2v2"/><path d="M16 8a1 1 0 0 1 1 1v8a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1h14a4 4 0 1 1 0 8h-1"/><path d="M6 2v2"/></svg>',
    emojis: [
      '🍎','🍏','🍐','🍊','🍋','🍌','🍉','🍇','🍓','🫐','🍈','🍒','🍑','🥭','🍍','🥥','🥝','🍅',
      '🥑','🍆','🥔','🥕','🌽','🌶️','🥒','🥬','🥦','🧄','🧅','🍞','🥐','🥖','🥨','🧀','🥚','🍳',
      '🥞','🧇','🥓','🍗','🍔','🍟','🍕','🌭','🌮','🌯','🥗','🍿','🍜','🍝','🍣','🍱','🍚','🍙',
      '🍩','🍪','🎂','🍰','🧁','🍫','🍬','🍭','🍦','🍨','☕','🍵','🧃','🥤','🧋','🍹','🍸'
    ],
  },
  {
    id: 'activities', label: 'Activities',
    icon: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-volleyball-icon lucide-volleyball"><path d="M11 7a16 16 20 0 1 10.98 4.362"/><path d="M12 12a13 13 0 0 1-8.66 5"/><path d="M16.83 13.634a16 16 0 0 1-9.267 7.328"/><path d="M20.66 17A13 13 0 0 0 12 12a13 13 0 0 1 0-10"/><path d="M8.17 15.366a16 16 0 0 1-1.713-11.69"/><circle cx="12" cy="12" r="10"/></svg>',
    emojis: [
      '⚽','🏀','🏈','⚾','🥎','🎾','🏐','🏉','🥏','🎱','🏓','🏸','🏒','🏑','🥍','🏏','⛳','🏹',
      '🎣','🥊','🥋','🎽','🛹','🛼','🛷','⛸️','🏆','🥇','🥈','🥉','🎯','🎮','🕹️','🎲','🧩','🎨',
      '🎭','🎬','🎤','🎧','🎸','🎹','🥁','🎷','🎺','🎻','🎪','🎟️','🎉','🎊','🎈','🪅'
    ],
  },
  {
    id: 'travel', label: 'Travel & Places',
    icon: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-luggage-icon lucide-luggage"><path d="M6 20a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2"/><path d="M8 18V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v14"/><path d="M10 20h4"/><circle cx="16" cy="20" r="2"/><circle cx="8" cy="20" r="2"/></svg>',
    emojis: [
      '🚗','🚕','🚙','🚌','🚎','🏎️','🚓','🚑','🚒','🚐','🛻','🚚','🚛','🚜','🏍️','🛵','🚲','✈️',
      '🛫','🛬','🚁','🚀','🛸','🚢','⛵','🚤','🚂','🚆','🚇','🚉','🗺️','🧭','🏝️','🏖️','🏕️','⛺',
      '🏠','🏡','🏢','🏙️','🌆','🌃','🏰','🏯','🗼','🗽','⛪','🕌','🛕','🗿','🗻','🌋','⛲','🎡','🎢'
    ],
  },
  {
    id: 'symbols', label: 'Symbols & Hearts',
    icon: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-square-pilcrow-icon lucide-square-pilcrow"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M12 12H9.5a2.5 2.5 0 0 1 0-5H17"/><path d="M12 7v10"/><path d="M16 7v10"/></svg>',
    emojis: [
      '❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❣️','💕','💞','💓','💗','💖','💘','💝',
      '💟','☮️','✝️','☪️','🕉️','☯️','✡️','🔯','🛐','💯','✨','💫','❗','❓','‼️','⁉️','⭕','❌',
      '✅','☑️','✔️','➕','➖','✖️','➗','♾️','⚠️','🚫','🔴','🟠','🟡','🟢','🔵','🟣','⚫','⚪',
      '🟤','🔶','🔷','🔺','🔻','⬆️','⬇️','⬅️','➡️','🔄','🔒','🔓','🔑','💡','📌','📍','💩'
    ],
  },
];

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

function buildEmojiGrid(emojisArr) {
  const grid = document.createElement('div');
  grid.className = 'emoji-grid';
  // Build the HTML in one shot instead of creating+appending N button nodes
  // one at a time (each triggering its own attach), and use a single
  // delegated click listener instead of N per-button listeners.
  grid.innerHTML = emojisArr.map(e => `<button class="emoji-item" type="button">${e}</button>`).join('');
  grid.addEventListener('click', (e) => {
    const btn = e.target.closest('.emoji-item');
    if (!btn) return;
    e.stopPropagation();
    insertEmoji(btn.textContent);
    updateRecentEmojiSection();
  });
  return grid;
}

// The static parts (tab bar, search input, per-category sections) never change,
// so build them exactly once and reuse the same DOM nodes on every open instead
// of tearing down and rebuilding everything each time the picker is toggled.
let emojiPickerBuilt = false;
let emojiPickerBodyEl = null;
let emojiSearchInputEl = null;
let recentSectionWrap = null;
let recentSectionGrid = null;
let categorySectionEls = {}; // id -> { wrap, label, grid }
let emojiSearchResultsWrap = null;
let emojiSearchResultsGrid = null;
let emojiSearchEmptyEl = null;

function emojiSectionId(catId) { return 'emoji-section-' + catId; }

function ensureEmojiPickerSkeleton() {
  const picker = document.getElementById('emojiPicker');
  if (emojiPickerBuilt) return picker;

  picker.innerHTML = '';

  // ── Category tabs ──
  const tabs = document.createElement('div');
  tabs.className = 'emoji-picker-tabs';

  const recentTabBtn = document.createElement('button');
  recentTabBtn.type = 'button';
  recentTabBtn.className = 'emoji-tab-btn';
  recentTabBtn.dataset.target = 'recent';
  recentTabBtn.title = 'Recently Used';
  recentTabBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15.5 14"/></svg>';
  recentTabBtn.style.display = 'none';
  tabs.appendChild(recentTabBtn);

  emojiCategories.forEach(cat => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'emoji-tab-btn';
    btn.dataset.target = cat.id;
    btn.title = cat.label;
    btn.innerHTML = cat.icon;
    tabs.appendChild(btn);
  });

  tabs.addEventListener('click', (e) => {
    const btn = e.target.closest('.emoji-tab-btn');
    if (!btn) return;
    if (emojiSearchInputEl) emojiSearchInputEl.value = '';
    showEmojiCategory(btn.dataset.target);
  });
  picker.appendChild(tabs);

  // ── Search bar ──
  const searchWrap = document.createElement('div');
  searchWrap.className = 'emoji-picker-search-wrap';
  const searchRow = document.createElement('div');
  searchRow.className = 'emoji-picker-search-row';
  searchRow.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';
  emojiSearchInputEl = document.createElement('input');
  emojiSearchInputEl.type = 'text';
  emojiSearchInputEl.className = 'emoji-picker-search-input';
  emojiSearchInputEl.placeholder = 'Search emoji';
  emojiSearchInputEl.addEventListener('input', () => filterEmojiPicker(emojiSearchInputEl.value));
  searchRow.appendChild(emojiSearchInputEl);
  searchWrap.appendChild(searchRow);
  picker.appendChild(searchWrap);

  // ── Scrollable body ──
  emojiPickerBodyEl = document.createElement('div');
  emojiPickerBodyEl.className = 'emoji-picker-body';

  // Recently used section
  recentSectionWrap = document.createElement('div');
  recentSectionWrap.id = emojiSectionId('recent');
  recentSectionWrap.style.display = 'none';
  const recentLabel = document.createElement('div');
  recentLabel.className = 'emoji-section-label';
  recentLabel.textContent = 'Recently Used';
  recentSectionGrid = document.createElement('div');
  recentSectionWrap.appendChild(recentLabel);
  recentSectionWrap.appendChild(recentSectionGrid);
  emojiPickerBodyEl.appendChild(recentSectionWrap);

  // One section per category
  categorySectionEls = {};
  emojiCategories.forEach(cat => {
    const wrap = document.createElement('div');
    wrap.id = emojiSectionId(cat.id);
    const label = document.createElement('div');
    label.className = 'emoji-section-label';
    label.textContent = cat.label;
    const grid = buildEmojiGrid(cat.emojis);
    wrap.appendChild(label);
    wrap.appendChild(grid);
    emojiPickerBodyEl.appendChild(wrap);
    categorySectionEls[cat.id] = { wrap, label, grid };
  });

  // Search results (hidden unless there's an active query)
  emojiSearchResultsWrap = document.createElement('div');
  emojiSearchResultsWrap.style.display = 'none';
  const searchResultsLabel = document.createElement('div');
  searchResultsLabel.className = 'emoji-section-label';
  searchResultsLabel.textContent = 'Search Results';
  emojiSearchResultsGrid = document.createElement('div');
  emojiSearchEmptyEl = document.createElement('div');
  emojiSearchEmptyEl.className = 'emoji-picker-empty';
  emojiSearchEmptyEl.textContent = 'No emoji found';
  emojiSearchEmptyEl.style.display = 'none';
  emojiSearchResultsWrap.appendChild(searchResultsLabel);
  emojiSearchResultsWrap.appendChild(emojiSearchResultsGrid);
  emojiSearchResultsWrap.appendChild(emojiSearchEmptyEl);
  emojiPickerBodyEl.appendChild(emojiSearchResultsWrap);

  picker.appendChild(emojiPickerBodyEl);

  // Empty footer: intentional breathing room at the bottom of the picker.
  const footer = document.createElement('div');
  footer.className = 'emoji-picker-footer';
  footer.setAttribute('aria-hidden', 'true');
  picker.appendChild(footer);

  emojiPickerBuilt = true;
  return picker;
}

function setActiveEmojiTab(activeBtn) {
  const picker = document.getElementById('emojiPicker');
  picker.querySelectorAll('.emoji-tab-btn').forEach(b => b.classList.remove('active'));
  if (activeBtn) activeBtn.classList.add('active');
}

// Every category section stays visible in one continuous scrollable list —
// clicking a tab doesn't filter down to only that category, it just scrolls
// that section into view and highlights the tab.
function showEmojiCategory(targetId) {
  emojiSearchResultsWrap.style.display = 'none';
  recentSectionWrap.style.display = getRecentEmojis().length > 0 ? '' : 'none';
  Object.values(categorySectionEls).forEach(s => { s.wrap.style.display = ''; });

  const picker = document.getElementById('emojiPicker');
  setActiveEmojiTab(picker.querySelector(`.emoji-tab-btn[data-target="${targetId}"]`));

  const targetEl = targetId === 'recent' ? recentSectionWrap : categorySectionEls[targetId]?.wrap;
  if (targetEl) {
    const bodyRect = emojiPickerBodyEl.getBoundingClientRect();
    const targetRect = targetEl.getBoundingClientRect();
    emojiPickerBodyEl.scrollTop += (targetRect.top - bodyRect.top);
  }
}

// Search keywords for the emoji picker.
// The character itself is also searchable, while these aliases make normal
// text searches useful (for example: "dog", "heart", "pizza", "football").
const emojiSearchKeywords = {
  '😀':'grinning happy smile',
  '😁':'grin happy smile',
  '😂':'joy laugh tears funny',
  '🤣':'rofl laugh rolling funny',
  '😃':'smile happy',
  '😄':'smile happy',
  '😅':'sweat smile nervous',
  '😆':'laugh happy',
  '😉':'wink',
  '😊':'blush smile happy',
  '😋':'yum delicious',
  '😎':'cool sunglasses',
  '😍':'heart eyes love',
  '😘':'kiss love',
  '🥰':'love hearts affectionate',
  '🤗':'hug',
  '🤩':'star struck excited',
  '🤔':'thinking think',
  '😐':'neutral',
  '🙄':'rolling eyes',
  '😴':'sleep sleepy tired',
  '😛':'tongue',
  '😜':'wink tongue silly',
  '😝':'tongue silly',
  '🤤':'drool hungry',
  '😒':'unamused annoyed',
  '😔':'sad',
  '😕':'confused',
  '🙃':'upside down',
  '🤑':'money rich',
  '😲':'astonished shocked',
  '😖':'confounded',
  '😞':'disappointed sad',
  '😟':'worried',
  '😤':'angry steam',
  '😢':'cry sad tear',
  '😭':'sob cry tears',
  '😨':'fear scared',
  '😩':'weary tired',
  '🤯':'exploding head mind blown',
  '😬':'grimace',
  '😰':'anxious sweat',
  '😱':'scream scared fear',
  '🥵':'hot heat',
  '🥶':'cold freezing',
  '😳':'flushed embarrassed',
  '🤪':'crazy silly',
  '😵':'dizzy',
  '🥴':'woozy',
  '😠':'angry',
  '😡':'rage angry mad',
  '🤬':'cursing swearing',
  '😷':'mask sick',
  '🤒':'sick fever',
  '🤕':'injured hurt',
  '🤢':'nauseous sick',
  '🤮':'vomit sick',
  '🤧':'sneeze sick',
  '🥳':'party celebration',
  '😇':'angel innocent',
  '🤠':'cowboy',
  '🤡':'clown',
  '💀':'skull death',
  '👻':'ghost',
  '👽':'alien',
  '🤖':'robot',
  '🎃':'pumpkin halloween',
  '👋':'wave hello hi bye',
  '🤚':'raised back of hand',
  '🖐️':'hand splayed fingers stop',
  '✋':'raised hand stop high five',
  '🖖':'vulcan salute spock',
  '🫱':'rightwards hand',
  '🫲':'leftwards hand',
  '🫳':'palm down hand',
  '🫴':'palm up hand',
  '👌':'ok okay',
  '🤌':'pinched fingers italian',
  '🤏':'pinching hand small little bit',
  '✌️':'victory peace fingers',
  '🤞':'crossed fingers luck hope',
  '🫰':'hand fingers snap money',
  '🤟':'love you gesture',
  '🤘':'sign of horns rock',
  '👈':'point left',
  '👉':'point right',
  '👆':'point up',
  '🖕':'middle finger',
  '👇':'point down',
  '☝️':'index finger point up',
  '🫵':'point at you',
  '👍':'thumbs up like good',
  '👎':'thumbs down dislike bad',
  '✊':'raised fist power',
  '👊':'fist bump punch',
  '🤛':'left facing fist bump',
  '🤜':'right facing fist bump',
  '👏':'clap applause',
  '🙌':'raised hands celebrate',
  '👐':'open hands',
  '🤲':'palms up together',
  '🙏':'pray please thanks',
  '✍️':'writing hand',
  '💅':'nail polish manicure',
  '🤳':'selfie',
  '💪':'muscle strong',
  '🤝':'handshake deal',
  '👀':'eyes look see',
  '🧠':'brain',
  '🫶':'heart hands love',
  '🥹':'tears emotional',
  '👑':'crown king queen',
  '🐶':'dog puppy',
  '🐱':'cat kitten',
  '🐭':'mouse',
  '🐹':'hamster',
  '🐰':'rabbit bunny',
  '🦊':'fox',
  '🐻':'bear',
  '🐼':'panda',
  '🐨':'koala',
  '🐯':'tiger',
  '🦁':'lion',
  '🐮':'cow',
  '🐷':'pig',
  '🐸':'frog',
  '🐵':'monkey',
  '🐔':'chicken',
  '🐧':'penguin',
  '🐦':'bird',
  '🐤':'chick',
  '🦆':'duck',
  '🦅':'eagle',
  '🦉':'owl',
  '🐺':'wolf',
  '🐗':'boar',
  '🐴':'horse',
  '🦄':'unicorn',
  '🐝':'bee',
  '🐛':'bug caterpillar',
  '🦋':'butterfly',
  '🐌':'snail',
  '🐞':'ladybug beetle',
  '🐜':'ant',
  '🕷️':'spider',
  '🐢':'turtle',
  '🐍':'snake',
  '🦎':'lizard',
  '🦖':'dinosaur t rex',
  '🦕':'dinosaur',
  '🐙':'octopus',
  '🦑':'squid',
  '🦀':'crab',
  '🐠':'fish tropical',
  '🐟':'fish',
  '🐡':'blowfish',
  '🐬':'dolphin',
  '🐳':'whale',
  '🐋':'whale',
  '🦈':'shark',
  '🌸':'flower blossom',
  '🌹':'rose flower love',
  '🌺':'flower',
  '🌻':'sunflower',
  '🌼':'flower',
  '🌷':'tulip flower',
  '🌱':'seedling plant',
  '🌲':'evergreen tree',
  '🌳':'tree',
  '🌴':'palm tree',
  '🌵':'cactus',
  '🍀':'clover lucky',
  '🍁':'maple leaf',
  '🍂':'fallen leaf autumn',
  '🍃':'leaf wind',
  '🌿':'herb leaf',
  '🌾':'rice plant',
  '🌊':'wave ocean water',
  '☀️':'sun sunny',
  '🌤️':'sun cloud partly cloudy',
  '🌈':'rainbow',
  '⭐':'star',
  '🌙':'moon',
  '⚡':'lightning electric',
  '🔥':'fire flame hot',
  '❄️':'snow snowflake cold',
  '☁️':'cloud',
  '🌧️':'rain rainy',
  '🌪️':'tornado',
  '🌍':'earth world globe',
  '🍎':'apple fruit',
  '🍏':'apple green fruit',
  '🍐':'pear fruit',
  '🍊':'orange fruit',
  '🍋':'lemon fruit',
  '🍌':'banana fruit',
  '🍉':'watermelon fruit',
  '🍇':'grapes fruit',
  '🍓':'strawberry fruit',
  '🫐':'blueberry fruit',
  '🍒':'cherries fruit',
  '🍑':'peach fruit',
  '🥭':'mango fruit',
  '🍍':'pineapple fruit',
  '🥥':'coconut fruit',
  '🥝':'kiwi fruit',
  '🍅':'tomato vegetable',
  '🥑':'avocado',
  '🍆':'eggplant vegetable',
  '🥔':'potato',
  '🥕':'carrot vegetable',
  '🌽':'corn',
  '🌶️':'pepper chili hot',
  '🥒':'cucumber',
  '🥬':'leafy greens',
  '🥦':'broccoli',
  '🧄':'garlic',
  '🧅':'onion',
  '🍞':'bread',
  '🥐':'croissant',
  '🥖':'baguette bread',
  '🥨':'pretzel',
  '🧀':'cheese',
  '🥚':'egg',
  '🍳':'cooking egg breakfast',
  '🥞':'pancakes breakfast',
  '🧇':'waffle breakfast',
  '🥓':'bacon',
  '🍗':'chicken leg',
  '🍔':'burger hamburger',
  '🍟':'fries french fries',
  '🍕':'pizza',
  '🌭':'hot dog',
  '🌮':'taco',
  '🌯':'burrito',
  '🥗':'salad',
  '🍿':'popcorn',
  '🍜':'noodles ramen',
  '🍝':'spaghetti pasta',
  '🍣':'sushi',
  '🍱':'bento',
  '🍚':'rice',
  '🍙':'rice ball',
  '🍩':'donut doughnut',
  '🍪':'cookie',
  '🎂':'birthday cake',
  '🍰':'cake',
  '🧁':'cupcake',
  '🍫':'chocolate',
  '🍬':'candy',
  '🍭':'lollipop',
  '🍦':'ice cream',
  '🍨':'ice cream',
  '☕':'coffee',
  '🍵':'tea',
  '🧃':'juice',
  '🥤':'drink soda',
  '🧋':'bubble tea boba',
  '🍹':'cocktail drink',
  '🍸':'martini drink',
  '⚽':'football soccer',
  '🏀':'basketball',
  '🏈':'american football',
  '⚾':'baseball',
  '🥎':'softball',
  '🎾':'tennis',
  '🏐':'volleyball',
  '🏉':'rugby',
  '🎱':'pool billiards',
  '🏓':'ping pong table tennis',
  '🏸':'badminton',
  '🏒':'hockey',
  '🏑':'field hockey',
  '🥍':'lacrosse',
  '🏏':'cricket',
  '⛳':'golf',
  '🏹':'archery',
  '🎣':'fishing',
  '🥊':'boxing',
  '🥋':'martial arts',
  '🛹':'skateboard',
  '🛼':'roller skate',
  '⛸️':'ice skate skating',
  '🏆':'trophy winner',
  '🥇':'gold medal first',
  '🥈':'silver medal second',
  '🥉':'bronze medal third',
  '🎯':'target bullseye',
  '🎮':'video game gaming',
  '🕹️':'joystick game',
  '🎲':'dice game',
  '🧩':'puzzle',
  '🎨':'art painting',
  '🎭':'theater drama',
  '🎬':'movie film cinema',
  '🎤':'microphone singing',
  '🎧':'headphones music',
  '🎸':'guitar music',
  '🎹':'piano music',
  '🥁':'drum music',
  '🎷':'saxophone music',
  '🎺':'trumpet music',
  '🎻':'violin music',
  '🎪':'circus',
  '🎉':'party celebration',
  '🎊':'confetti celebration',
  '🎈':'balloon party',
  '🚗':'car automobile',
  '🚕':'taxi cab',
  '🚙':'car suv',
  '🚌':'bus',
  '🚎':'trolley bus',
  '🏎️':'race car racing',
  '🚓':'police car',
  '🚑':'ambulance',
  '🚒':'fire truck',
  '🚚':'truck delivery',
  '🚜':'tractor',
  '🏍️':'motorcycle',
  '🛵':'scooter',
  '🚲':'bicycle bike',
  '✈️':'airplane plane flight',
  '🛫':'departure airplane',
  '🛬':'arrival airplane',
  '🚁':'helicopter',
  '🚀':'rocket space',
  '🛸':'ufo flying saucer',
  '🚢':'ship boat',
  '⛵':'sailboat',
  '🚤':'speedboat',
  '🚂':'locomotive train',
  '🚆':'train',
  '🚇':'metro subway',
  '🚉':'station train',
  '🗺️':'map',
  '🧭':'compass navigation',
  '🏝️':'island beach',
  '🏖️':'beach vacation',
  '🏕️':'camping',
  '⛺':'tent camping',
  '🏠':'house home',
  '🏡':'house garden home',
  '🏢':'office building',
  '🏙️':'city cityscape',
  '🌆':'city sunset',
  '🌃':'night city',
  '🏰':'castle',
  '🏯':'japanese castle',
  '🗼':'tokyo tower',
  '🗽':'statue liberty',
  '⛪':'church',
  '🕌':'mosque',
  '🛕':'temple',
  '🗿':'moai statue',
  '🗻':'mount fuji mountain',
  '🌋':'volcano',
  '⛲':'fountain',
  '🎡':'ferris wheel',
  '🎢':'roller coaster',
  '❤️':'heart red love',
  '🧡':'heart orange love',
  '💛':'heart yellow love',
  '💚':'heart green love',
  '💙':'heart blue love',
  '💜':'heart purple love',
  '🖤':'heart black love',
  '🤍':'heart white love',
  '🤎':'heart brown love',
  '💔':'broken heart',
  '❣️':'heart exclamation love',
  '💕':'two hearts love',
  '💞':'revolving hearts love',
  '💓':'beating heart love',
  '💗':'growing heart love',
  '💖':'sparkling heart love',
  '💘':'heart arrow cupid love',
  '💝':'heart ribbon love gift',
  '💟':'heart decoration love',
  '☮️':'peace',
  '✝️':'cross',
  '☪️':'star crescent',
  '🕉️':'om',
  '☯️':'yin yang',
  '✡️':'star of david',
  '💯':'hundred perfect score',
  '✨':'sparkles',
  '💫':'dizzy star',
  '❗':'exclamation',
  '❓':'question',
  '‼️':'double exclamation',
  '⁉️':'question exclamation',
  '⭕':'circle',
  '❌':'cross no wrong',
  '✅':'check yes correct',
  '☑️':'check box',
  '✔️':'check mark correct',
  '➕':'plus add',
  '➖':'minus subtract',
  '✖️':'multiply',
  '➗':'divide',
  '♾️':'infinity',
  '⚠️':'warning',
  '🚫':'prohibited no',
  '🔴':'red circle',
  '🟠':'orange circle',
  '🟡':'yellow circle',
  '🟢':'green circle',
  '🔵':'blue circle',
  '🟣':'purple circle',
  '⚫':'black circle',
  '⚪':'white circle',
  '🟤':'brown circle',
  '🔶':'orange diamond',
  '🔷':'blue diamond',
  '🔺':'red triangle up',
  '🔻':'red triangle down',
  '⬆️':'up arrow',
  '⬇️':'down arrow',
  '⬅️':'left arrow',
  '➡️':'right arrow',
  '🔄':'refresh reload',
  '🔒':'lock locked',
  '🔓':'unlock',
  '🔑':'key',
  '💡':'idea light bulb',
  '📌':'pin pushpin',
  '📍':'location pin',
  '💩':'poop poopoo'
};

function filterEmojiPicker(query) {
  const q = query.trim();

  if (!q) {
    // Back to normal browse mode: every section visible again, scrolled to smileys.
    showEmojiCategory('smileys');
    return;
  }

  // Search mode: hide the normal sections, show only matches.
  recentSectionWrap.style.display = 'none';
  Object.values(categorySectionEls).forEach(s => { s.wrap.style.display = 'none'; });
  setActiveEmojiTab(null);

  const normalizedQuery = q.toLowerCase();

  // Search by emoji name/keywords as well as the emoji character itself.
  // This lets searches such as "heart", "dog", "coffee", "car", "laugh", etc. work.
  const matches = emojis.filter(emoji => {
    if (emoji.includes(q)) return true;
    const keywords = emojiSearchKeywords[emoji] || '';
    return keywords.toLowerCase().split(/\\s+/).some(word => word.includes(normalizedQuery));
  });

  emojiSearchResultsGrid.innerHTML = '';
  if (matches.length) {
    emojiSearchResultsGrid.appendChild(buildEmojiGrid(matches));
    emojiSearchEmptyEl.style.display = 'none';
  } else {
    emojiSearchEmptyEl.style.display = '';
  }
  emojiSearchResultsWrap.style.display = '';
  emojiPickerBodyEl.scrollTop = 0;
}

function updateRecentEmojiSection() {
  if (!recentSectionGrid) return;
  const recent = getRecentEmojis();
  const hasRecent = recent.length > 0;
  const picker = document.getElementById('emojiPicker');
  const recentTabBtn = picker?.querySelector('.emoji-tab-btn[data-target="recent"]');

  if (recentTabBtn) recentTabBtn.style.display = hasRecent ? '' : 'none';
  if (recentSectionWrap) recentSectionWrap.style.display = hasRecent ? '' : 'none';

  recentSectionGrid.innerHTML = '';
  if (hasRecent) {
    recentSectionGrid.appendChild(buildEmojiGrid(recent));
  }
}

function initEmojiPicker() {
  ensureEmojiPickerSkeleton();
  updateRecentEmojiSection();
}

function renderEmojiPicker() {
  ensureEmojiPickerSkeleton();
  updateRecentEmojiSection();
  if (emojiSearchInputEl) emojiSearchInputEl.value = '';
  showEmojiCategory('smileys');
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
    const pickerWidth = picker.offsetWidth || 480;
    const triggerCenter = rect.left + (rect.width / 2);
    const centeredLeft = triggerCenter - (pickerWidth / 2);
    const clampedLeft = Math.max(8, Math.min(
      centeredLeft,
      window.innerWidth - pickerWidth - 8
    ));
    picker.style.bottom = (window.innerHeight - rect.top + 22) + 'px';
    picker.style.left = clampedLeft + 'px';
    picker.style.top = 'auto';
    picker.style.right = 'auto';
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
  const hasStagedMedia = Array.isArray(fluxStagedMedia) ? fluxStagedMedia.length > 0 : !!fluxStagedMedia;
  if (input.value.trim() === '' && !hasStagedMedia) { sendBtn.classList.add('hidden'); mediaBtn.classList.remove('hidden'); }
  else { sendBtn.classList.remove('hidden'); mediaBtn.classList.add('hidden'); }
}

function toggleFluxFsSendBtn() {
  const input = document.getElementById('fluxFsInput');
  const sendBtn = document.getElementById('fluxFsSendBtn');
  const hasStagedMedia = Array.isArray(fluxFsStagedMedia) ? fluxFsStagedMedia.length > 0 : !!fluxFsStagedMedia;
  if (input.value.trim() === '' && !hasStagedMedia) sendBtn.classList.add('hidden');
  else sendBtn.classList.remove('hidden');
}

window.addEventListener('load', function() {
  toggleMediaButton();
  document.getElementById('fluxSendBtn')?.classList.add('hidden');
  document.getElementById('fluxFsSendBtn')?.classList.add('hidden');
});

// Build the emoji picker's DOM (all category grids, ~500 buttons) as early
// and as cheaply as possible, well before the user can click the emoji
// button — this is what makes opening the picker / switching categories
// feel instant instead of janking on the first click while it builds.
(function scheduleEmojiPickerPrebuild() {
  const build = () => initEmojiPicker();
  const schedule = () => {
    if ('requestIdleCallback' in window) requestIdleCallback(build, { timeout: 600 });
    else setTimeout(build, 0);
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', schedule);
  } else {
    schedule();
  }
})();


// ── CODE EDITOR LINE NUMBERS & AUTO-INDENT ──
function updateCodeLineNumbers() {
  const ta = document.getElementById('codeInput');
  const lnEl = document.getElementById('codeLineNumbers');
  if (!ta || !lnEl) return;
  const lineCount = ta.value.split('\n').length;
  lnEl.textContent = Array.from({ length: lineCount }, (_, i) => i + 1).join('\n');
  // Sync scroll
  lnEl.scrollTop = ta.scrollTop;
}

// Sync line number scroll with textarea scroll
document.addEventListener('DOMContentLoaded', function() {
  const ta = document.getElementById('codeInput');
  if (!ta) return;
  ta.addEventListener('scroll', () => {
    const lnEl = document.getElementById('codeLineNumbers');
    if (lnEl) lnEl.scrollTop = ta.scrollTop;
  });
  ta.addEventListener('input', updateCodeLineNumbers);
  // Clear default placeholder content on load
  ta.value = '';
  updateCodeLineNumbers();
});

// Auto-indent + auto-close for code editor
document.addEventListener('keydown', function(e) {
  if (!document.activeElement || document.activeElement.id !== 'codeInput') return;
  const ta = document.activeElement;
  const lang = (document.getElementById('langSelect') || {}).value || 'html';

  if (e.key === 'Tab') {
    e.preventDefault();
    const s = ta.selectionStart, end = ta.selectionEnd;
    ta.value = ta.value.substring(0, s) + '  ' + ta.value.substring(end);
    ta.selectionStart = ta.selectionEnd = s + 2;
    updateCodeLineNumbers();
    return;
  }

  // ── AUTO-CLOSING PAIRS (all languages) ──
  const pairs = { '{': '}', '(': ')', '[': ']', '"': '"', "'": "'" };
  // For HTML, also handle < > but we do it specially below
  if (pairs[e.key] && !e.ctrlKey && !e.metaKey) {
    const s = ta.selectionStart, end = ta.selectionEnd;
    const selected = ta.value.substring(s, end);
    // If text is selected, wrap it
    if (selected.length > 0) {
      e.preventDefault();
      const close = pairs[e.key];
      ta.value = ta.value.substring(0, s) + e.key + selected + close + ta.value.substring(end);
      ta.selectionStart = s + 1;
      ta.selectionEnd = end + 1;
      updateCodeLineNumbers();
      return;
    }
    // Skip over existing closing char
    const nextChar = ta.value[s];
    if (e.key === nextChar && ['}',')',']','"',"'"].includes(e.key)) {
      e.preventDefault();
      ta.selectionStart = ta.selectionEnd = s + 1;
      return;
    }
    e.preventDefault();
    const close = pairs[e.key];
    ta.value = ta.value.substring(0, s) + e.key + close + ta.value.substring(end);
    ta.selectionStart = ta.selectionEnd = s + 1;
    updateCodeLineNumbers();
    return;
  }

  // ── BACKSPACE: remove paired closing char ──
  if (e.key === 'Backspace') {
    const s = ta.selectionStart, end = ta.selectionEnd;
    if (s === end && s > 0) {
      const prev = ta.value[s - 1];
      const next = ta.value[s];
      const pairs2 = { '{':'}', '(':')','[':']','"':'"',"'":"'" };
      if (pairs2[prev] && pairs2[prev] === next) {
        e.preventDefault();
        ta.value = ta.value.substring(0, s - 1) + ta.value.substring(s + 1);
        ta.selectionStart = ta.selectionEnd = s - 1;
        updateCodeLineNumbers();
        return;
      }
    }
  }

  // ── HTML AUTO-CLOSING TAGS ──
  if (lang === 'html' && e.key === '>') {
    const s = ta.selectionStart;
    const textBefore = ta.value.substring(0, s);
    // Match an opening tag: <tagname or <tagname attr...
    const openTagMatch = textBefore.match(/<([a-zA-Z][a-zA-Z0-9]*)(\s[^>]*)?\s*$/);
    // Void elements that should not be auto-closed
    const voidTags = new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);
    if (openTagMatch && !voidTags.has(openTagMatch[1].toLowerCase())) {
      e.preventDefault();
      const tagName = openTagMatch[1];
      const closeTag = `</${tagName}>`;
      ta.value = ta.value.substring(0, s) + '>' + closeTag + ta.value.substring(s);
      // Place cursor between opening and closing tag
      ta.selectionStart = ta.selectionEnd = s + 1;
      updateCodeLineNumbers();
      return;
    }
  }

  // ── ENTER: smart indent + brace expansion ──
  if (e.key === 'Enter') {
    e.preventDefault();
    const s = ta.selectionStart;
    const textBefore = ta.value.substring(0, s);
    const textAfter = ta.value.substring(ta.selectionEnd);
    const lines = textBefore.split('\n');
    const currentLine = lines[lines.length - 1];
    const indentMatch = currentLine.match(/^(\s*)/);
    let indent = indentMatch ? indentMatch[1] : '';

    const lastNonSpace = currentLine.trimEnd().slice(-1);
    const nextChar = textAfter[0];

    // Brace expansion: cursor between { } ( ) [ ]
    const openBraces = ['{','(','['];
    const closeBraces = ['}',')',']'];
    const closeBraceIdx = openBraces.indexOf(lastNonSpace);
    if (closeBraceIdx !== -1 && nextChar === closeBraces[closeBraceIdx]) {
      e.preventDefault();
      const innerIndent = indent + '  ';
      const insertion = '\n' + innerIndent + '\n' + indent;
      ta.value = textBefore + insertion + textAfter;
      ta.selectionStart = ta.selectionEnd = s + innerIndent.length + 1;
      updateCodeLineNumbers();
      return;
    }

    // HTML tag expansion: cursor between >...</tag>  like ><div></div> after >
    if (lang === 'html') {
      const htmlExpand = textBefore.match(/<([a-zA-Z][a-zA-Z0-9]*)(?:\s[^>]*)?>$/) && textAfter.match(/^<\/[a-zA-Z]/);
      if (htmlExpand) {
        const innerIndent = indent + '  ';
        const insertion = '\n' + innerIndent + '\n' + indent;
        ta.value = textBefore + insertion + textAfter;
        ta.selectionStart = ta.selectionEnd = s + innerIndent.length + 1;
        updateCodeLineNumbers();
        return;
      }
    }

    // Normal indent (increase after { ( [ for non-HTML too)
    if (openBraces.includes(lastNonSpace)) indent += '  ';
    const insertion = '\n' + indent;
    ta.value = textBefore + insertion + textAfter;
    ta.selectionStart = ta.selectionEnd = s + insertion.length;
    updateCodeLineNumbers();
  }
});

// ── CODE EDITOR ──
function onLangChange() {
  const lang = document.getElementById('langSelect').value;
  const iframe = document.getElementById('codeOutput');
  const textOut = document.getElementById('codeOutputText');
  iframe.style.display = 'none';
  textOut.style.display = 'none';
  const hints = {
    html: '<!-- HTML / CSS / JS\n     Write full HTML page or just body content -->\n',
    javascript: '// JavaScript — console.log outputs shown below\n'
  };
  const curr = document.getElementById('codeInput').value;
  if (!curr.trim()) document.getElementById('codeInput').value = hints[lang] || '';
}

function runCode() {
  const lang = document.getElementById('langSelect').value;
  const code = document.getElementById('codeInput').value;
  const iframe = document.getElementById('codeOutput');
  const textOut = document.getElementById('codeOutputText');

  if (lang === 'html') {
    iframe.style.display = 'block';
    textOut.style.display = 'none';
    const doc = iframe.contentDocument || iframe.contentWindow.document;
    doc.open();
    // Inject theme colors
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const prefix = `<style>body{background:${isDark ? '#0e0e10' : '#f4f4f6'};color:${isDark ? '#e4e4e7' : '#18181b'};font-family:system-ui,sans-serif;margin:0;padding:16px;}</style>`;
    doc.write(prefix + code);
    doc.close();
  } else if (lang === 'javascript') {
    iframe.style.display = 'none';
    textOut.style.display = 'block';
    textOut.innerHTML = '';
    const logs = [];
    const origLog = console.log;
    const origErr = console.error;
    const origWarn = console.warn;
    const capture = (type) => (...args) => {
      logs.push({ type, text: args.map(a => typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)).join(' ') });
    };
    console.log = capture('log');
    console.error = capture('error');
    console.warn = capture('warn');
    try {
      // eslint-disable-next-line no-new-func
      new Function(code)();
    } catch(e) {
      logs.push({ type: 'error', text: e.toString() });
    }
    console.log = origLog;
    console.error = origErr;
    console.warn = origWarn;
    if (logs.length === 0) {
      textOut.innerHTML = '<span style="color:var(--text3);font-size:12px;">No output</span>';
    } else {
      logs.forEach(l => {
        const line = document.createElement('div');
        line.style.marginBottom = '4px';
        if (l.type === 'error') line.style.color = '#ef4444';
        else if (l.type === 'warn') line.style.color = '#f59e0b';
        line.textContent = l.text;
        textOut.appendChild(line);
      });
    }
  }
  // Do NOT save code to localStorage — cleared on refresh
  // localStorage.setItem('aloft_code_' + lang, document.getElementById('codeInput').value);
  // localStorage.setItem('aloft_code_lang', lang);
}

// ── MOBILE CODE EDITOR: RUN → OUTPUT SCREEN, BACK BUTTON ──
function runCodeMobile() {
  runCode();
  if (isMobile()) {
    document.getElementById('codeView').classList.add('mob-output-active');
  }
}
function codeMobBack() {
  const view = document.getElementById('codeView');
  if (view.classList.contains('mob-output-active')) {
    // On the output screen — go back to the editor
    view.classList.remove('mob-output-active');
  } else {
    // On the editor screen — leave the code editor
    showView('relay');
    updateMobNav('relay');
  }
}

// ── SAVE CODE FILE ──
function saveCodeFile() {
  const lang = document.getElementById('langSelect').value;
  const code = document.getElementById('codeInput').value;
  const extMap = { html: 'html', javascript: 'js', java: 'java' };
  const ext = extMap[lang] || 'txt';
  const filename = `aloft_code.${ext}`;
  const blob = new Blob([code], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function clearCodeOutput() {
  document.getElementById('codeOutput').style.display = 'none';
  document.getElementById('codeOutputText').style.display = 'none';
  document.getElementById('codeOutputText').innerHTML = '';
  const doc = document.getElementById('codeOutput').contentDocument || document.getElementById('codeOutput').contentWindow?.document;
  if (doc) { doc.open(); doc.write(''); doc.close(); }
}

// Code editor starts fresh on every page load — no localStorage restore
function restoreCodeEditor() {
  const sel = document.getElementById('langSelect');
  if (sel) { sel.value = 'html'; }
  updateCodeLineNumbers();
}
document.addEventListener('DOMContentLoaded', restoreCodeEditor);

// ── CALCULATOR ──
let calcExpr = '';
let calcHasResult = false;

function calcAction(btn) {
  const display = document.getElementById('calcResult');
  const exprEl = document.getElementById('calcExpr');
  const ops = ['+','-','*','/','%'];

  if (btn === 'AC') {
    calcExpr = ''; calcHasResult = false;
    display.textContent = '0'; exprEl.textContent = '';
    return;
  }
  if (btn === '=') {
    try {
      exprEl.textContent = calcExpr + ' =';
      const result = Function('"use strict"; return (' + calcExpr + ')')();
      const formatted = Number.isInteger(result) ? result : parseFloat(result.toFixed(10));
      display.textContent = formatted;
      calcExpr = String(formatted);
      calcHasResult = true;
    } catch(e) {
      display.textContent = 'Error';
      calcExpr = ''; calcHasResult = false; exprEl.textContent = '';
    }
    return;
  }
  if (ops.includes(btn)) {
    calcHasResult = false;
    // Prevent double operators
    if (calcExpr && ops.includes(calcExpr.slice(-1))) calcExpr = calcExpr.slice(0, -1);
    calcExpr += btn;
  } else {
    if (calcHasResult && !ops.includes(btn)) { calcExpr = btn; calcHasResult = false; }
    else calcExpr += btn;
  }
  // Evaluate live
  try {
    const live = Function('"use strict"; return (' + calcExpr + ')')();
    display.textContent = parseFloat(live.toFixed(10));
  } catch(e) {
    display.textContent = calcExpr;
  }
  exprEl.textContent = calcExpr;
}

// Calculator keyboard support
document.addEventListener('keydown', function(e) {
  if (currentView !== 'calc') return;
  const map = {'0':'0','1':'1','2':'2','3':'3','4':'4','5':'5','6':'6','7':'7','8':'8','9':'9','+':'+','-':'-','*':'*','/':'/','%':'%','.':'.',',':'.','Enter':'=','=':'=','Escape':'AC','Backspace':'BS'};
  const action = map[e.key];
  if (!action) return;
  if (action === 'BS') {
    calcExpr = calcExpr.slice(0,-1) || '0';
    const el = document.getElementById('calcResult');
    el.textContent = calcExpr || '0';
    document.getElementById('calcExpr').textContent = calcExpr;
    return;
  }
  calcAction(action);
});

let _relayHistoryStore = [];

function saveRelayTurn(question, answer) {
  if (!question || !answer) return;
  // Session only — not saved to localStorage
  _relayHistoryStore.unshift({ id: Date.now(), q: question, a: answer, ts: new Date().toISOString() });
  if (_relayHistoryStore.length > 100) _relayHistoryStore = _relayHistoryStore.slice(0, 100);
}

function renderHistoryList() {
  const list = document.getElementById('historyList');
  if (!list) return;
  // Session-only — no localStorage read
  list.innerHTML = '';
  if (_relayHistoryStore.length === 0) {
    list.innerHTML = `<div class="history-empty"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg><p>No relay history yet.</p></div>`;
    return;
  }
  _relayHistoryStore.forEach(item => {
    const div = document.createElement('div');
    div.className = 'history-item';
    div.onclick = () => { loadHistoryItem(item); };
    const d = parseSupabaseDate(item.ts);
    const dateStr = d.toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    div.innerHTML = `<div class="history-item-q">${escHtml(item.q)}</div><div class="history-item-a">${escHtml(item.a.substring(0, 100))}${item.a.length > 100 ? '…' : ''}</div><div class="history-item-time">${dateStr}</div>`;
    list.appendChild(div);
  });
}

function loadHistoryItem(item) {
  showView('relay');
  const welcome = document.getElementById('welcomeScreen');
  if (welcome) welcome.remove();
  document.getElementById('relayView').classList.remove('welcome-mode');
  appendMessage('user', item.q);
  appendMessage('ai', item.a);
}

function clearAllHistory() {
  if (!confirm('Clear all relay history?')) return;
  _relayHistoryStore = [];
  renderHistoryList();
}

// ── SETTINGS EXTRAS ──
function toggleSetting(key) {
  const btn = document.getElementById(key + 'Toggle');
  if (!btn) return;
  const isOn = btn.classList.contains('on');
  btn.classList.toggle('on', !isOn);
  localStorage.setItem('aloft_setting_' + key, !isOn ? 'on' : 'off');
  const btn2 = document.getElementById(key + 'Toggle2');
  if (btn2) btn2.classList.toggle('on', !isOn);
}
// For duplicate toggle buttons (id ends in 2) — syncs both buttons
function toggleSettingDup(key, el) {
  const isOn = el.classList.contains('on');
  el.classList.toggle('on', !isOn);
  localStorage.setItem('aloft_setting_' + key, !isOn ? 'on' : 'off');
  const primary = document.getElementById(key + 'Toggle');
  if (primary) primary.classList.toggle('on', !isOn);
}

function filterSettingsNav(query) {
  const q = query.trim().toLowerCase();
  const nav = document.getElementById('settingsNav');
  const items = nav.querySelectorAll('.settings-nav-item');
  const groupLabels = nav.querySelectorAll('.settings-nav-group-label');

  if (!q) {
    items.forEach(i => i.style.display = '');
    groupLabels.forEach(l => l.style.display = '');
    return;
  }

  // Hide/show items
  items.forEach(i => {
    const match = i.textContent.trim().toLowerCase().includes(q);
    i.style.display = match ? '' : 'none';
  });

  // Hide group labels that have no visible items after them
  groupLabels.forEach(label => {
    let next = label.nextElementSibling;
    let hasVisible = false;
    while (next && !next.classList.contains('settings-nav-group-label')) {
      if (next.classList.contains('settings-nav-item') && next.style.display !== 'none') {
        hasVisible = true; break;
      }
      next = next.nextElementSibling;
    }
    label.style.display = hasVisible ? '' : 'none';
  });
}

function showSettingsPanel(id, btn) {
  document.querySelectorAll('.settings-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.settings-nav-item').forEach(b => b.classList.remove('active'));
  const panel = document.getElementById('panel-' + id);
  if (panel) panel.classList.add('active');
  if (btn) btn.classList.add('active');
  // Mobile: slide panel in and nav out
  const nav = document.getElementById('settingsNav');
  if (nav && window.innerWidth <= 768) {
    nav.classList.add('mob-panel-open');
    if (panel) panel.scrollTop = 0;
  }
}

function mobSettingsBack() {
  const nav = document.getElementById('settingsNav');
  if (nav) nav.classList.remove('mob-panel-open');
  // Deactivate all panels on mobile so none peek through
  document.querySelectorAll('.settings-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.settings-nav-item').forEach(b => b.classList.remove('active'));
}

// ── SETTINGS: SELECTS & TEXTAREAS ──
function saveSelectSetting(key, value) {
  localStorage.setItem('aloft_select_' + key, value);
}
function saveTextareaSetting(key, value) {
  localStorage.setItem('aloft_textarea_' + key, value);
}

// ── SETTINGS: KEYBINDINGS ──
const _kbDefaults = {
  kbRun: 'Ctrl+Enter', kbFormat: 'Alt+Shift+F', kbSave: 'Ctrl+S',
  kbComment: 'Ctrl+/', kbFind: 'Ctrl+F', kbDup: 'Ctrl+D',
  kbGoto: 'Ctrl+G', kbSwitch: 'Ctrl+Tab'
};
let _rebindingKey = null;
let _rebindListener = null;

function _loadKeybindings() {
  Object.entries(_kbDefaults).forEach(([k, def]) => {
    const saved = localStorage.getItem('aloft_kb_' + k) || def;
    const lbl = document.getElementById(k + 'Label');
    if (lbl) lbl.textContent = saved;
  });
}

function startRebind(key, el) {
  if (_rebindingKey) cancelRebind();
  _rebindingKey = key;
  el.classList.add('rebinding');
  el.querySelector('kbd').textContent = 'Press keys…';
  _rebindListener = function(e) {
    e.preventDefault(); e.stopPropagation();
    if (e.key === 'Escape') { cancelRebind(); return; }
    const parts = [];
    if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
    if (e.altKey) parts.push('Alt');
    if (e.shiftKey) parts.push('Shift');
    const k = e.key.length === 1 ? e.key.toUpperCase() : e.key;
    if (!['Control','Alt','Shift','Meta'].includes(e.key)) parts.push(k);
    if (parts.length === 0) return;
    const combo = parts.join('+');
    localStorage.setItem('aloft_kb_' + key, combo);
    el.querySelector('kbd').textContent = combo;
    el.classList.remove('rebinding');
    document.removeEventListener('keydown', _rebindListener, true);
    _rebindingKey = null; _rebindListener = null;
  };
  document.addEventListener('keydown', _rebindListener, true);
}

function cancelRebind() {
  if (_rebindListener) document.removeEventListener('keydown', _rebindListener, true);
  if (_rebindingKey) {
    const el = document.getElementById(_rebindingKey + 'Display');
    if (el) {
      el.classList.remove('rebinding');
      const saved = localStorage.getItem('aloft_kb_' + _rebindingKey) || _kbDefaults[_rebindingKey];
      el.querySelector('kbd').textContent = saved;
    }
    _rebindingKey = null; _rebindListener = null;
  }
}

function resetKeybindings() {
  if (!confirm('Reset all key bindings to defaults?')) return;
  Object.entries(_kbDefaults).forEach(([k, def]) => {
    localStorage.removeItem('aloft_kb_' + k);
    const lbl = document.getElementById(k + 'Label');
    if (lbl) lbl.textContent = def;
  });
}

// ── SETTINGS: AI MEMORY ──
function calcAiMemoryCount() {
  const keys = Object.keys(localStorage).filter(k => k.startsWith('aloft_aimem_'));
  const el = document.getElementById('aiMemoryCountText');
  if (el) el.textContent = keys.length + ' stored entr' + (keys.length === 1 ? 'y' : 'ies');
}
function clearAiMemory() {
  if (!confirm('Clear all AI memory? This cannot be undone.')) return;
  Object.keys(localStorage).filter(k => k.startsWith('aloft_aimem_')).forEach(k => localStorage.removeItem(k));
  calcAiMemoryCount();
}
function calcNotesCount() {
  const notes = JSON.parse(localStorage.getItem('aloft_notes') || '[]');
  const el = document.getElementById('aiNotesCountText');
  if (el) el.textContent = notes.length + ' note' + (notes.length === 1 ? '' : 's') + ' stored locally';
}

// ── SETTINGS: AI PERSONA ──
function togglePersonalGreet() {
  const btn = document.getElementById('personalGreetToggle');
  if (!btn) return;
  const isOn = btn.classList.contains('on');
  btn.classList.toggle('on', !isOn);
  localStorage.setItem('aloft_setting_personalGreet', !isOn ? 'on' : 'off');
  setWelcomeGreeting(); // re-run greeting with new pref
}

// ── SETTINGS: ACCESSIBILITY ──
function applyFontSize(size, silent) {
  document.documentElement.style.fontSize = size + 'px';
  if (!silent) localStorage.setItem('aloft_select_a11yFontSize', size);
}
function toggleHighContrast() {
  const html = document.documentElement;
  const on = html.getAttribute('data-high-contrast') === 'on';
  html.setAttribute('data-high-contrast', on ? 'off' : 'on');
  localStorage.setItem('aloft_setting_highContrast', on ? 'off' : 'on');
  const btn = document.getElementById('highContrastToggle');
  if (btn) btn.classList.toggle('on', !on);
}
function toggleReduceMotion() {
  const html = document.documentElement;
  const on = html.getAttribute('data-reduce-motion') === 'on';
  html.setAttribute('data-reduce-motion', on ? 'off' : 'on');
  localStorage.setItem('aloft_setting_reduceMotion', on ? 'off' : 'on');
  const btn = document.getElementById('reduceMotionToggle');
  if (btn) btn.classList.toggle('on', !on);
}
function toggleFocusRing() {
  const html = document.documentElement;
  const on = html.getAttribute('data-focus-ring') === 'on';
  html.setAttribute('data-focus-ring', on ? 'off' : 'on');
  localStorage.setItem('aloft_setting_focusRing', on ? 'off' : 'on');
  const btn = document.getElementById('focusRingToggle');
  if (btn) btn.classList.toggle('on', !on);
}

// ── SETTINGS: PERFORMANCE ──
function calcPerfStats() {
  const el = document.getElementById('perfMemText');
  if (!el) return;
  if (performance && performance.memory) {
    const mb = (performance.memory.usedJSHeapSize / 1048576).toFixed(1);
    el.textContent = mb + ' MB JS heap used';
  } else {
    el.textContent = 'Memory info not available in this browser';
  }
}
function toggleMsgAnim() {
  const btn = document.getElementById('msgAnimToggle');
  const isOn = btn.classList.contains('on');
  btn.classList.toggle('on', !isOn);
  localStorage.setItem('aloft_setting_msgAnim', !isOn ? 'on' : 'off');
  // Inject or remove a style override
  let styleEl = document.getElementById('_msgAnimStyle');
  if (!styleEl) { styleEl = document.createElement('style'); styleEl.id = '_msgAnimStyle'; document.head.appendChild(styleEl); }
  styleEl.textContent = isOn ? '@keyframes msgIn { from{} to{} }' : '';
}
function toggleBlurEffects() {
  const btn = document.getElementById('blurEffectsToggle');
  const isOn = btn.classList.contains('on');
  btn.classList.toggle('on', !isOn);
  localStorage.setItem('aloft_setting_blurEffects', !isOn ? 'on' : 'off');
  let styleEl = document.getElementById('_blurStyle');
  if (!styleEl) { styleEl = document.createElement('style'); styleEl.id = '_blurStyle'; document.head.appendChild(styleEl); }
  styleEl.textContent = isOn ? '.overlay{backdrop-filter:none!important;} .companion-popup::before{display:none!important;}' : '';
}

// ── SETTINGS: NETWORK ──
function checkNetworkStatus() {
  const el = document.getElementById('networkStatusText');
  if (!el) return;
  el.textContent = navigator.onLine ? '✓ Connected to the internet' : '✗ No internet connection detected';
}

function clearNetworkCache() {
  if ('caches' in window) {
    caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k)))).then(() => {
      alert('Network cache cleared.');
    });
  } else {
    alert('Cache API not available in this browser.');
  }
}

function initSettings() {
  const keys = ['saveRelay', 'enterSend', 'autosave', 'lineNumbers', 'wordWrap',
    'snippetBadges','snippetHighlight','snippetCompact','snippetClickCopy','snippetDoubleOpen',
    'highContrast','reduceMotion','focusRing',
    'msgAnim','blurEffects','personalGreet'
  ];
  const defaults = { saveRelay: 'on', enterSend: 'on', lineNumbers: 'on', msgAnim: 'on', blurEffects: 'on', personalGreet: 'on' };
  keys.forEach(key => {
    const val = localStorage.getItem('aloft_setting_' + key) || defaults[key] || 'off';
    const btn = document.getElementById(key + 'Toggle');
    if (btn) btn.classList.toggle('on', val === 'on');
    const btn2 = document.getElementById(key + 'Toggle2');
    if (btn2) btn2.classList.toggle('on', val === 'on');
  });

  // Restore textarea
  const sp = document.getElementById('aiSystemPrompt');
  if (sp) sp.value = localStorage.getItem('aloft_textarea_aiSystemPrompt') || '';

  // Restore keybindings
  _loadKeybindings();

  // Fill session info
  const devEl = document.getElementById('sessionDeviceText');
  if (devEl) devEl.textContent = navigator.userAgent.includes('Mobile') ? 'Mobile browser' : 'Desktop browser — ' + (navigator.platform || 'unknown OS');
  const sessEl = document.getElementById('sessionStartText');
  if (sessEl) {
    const st = sessionStorage.getItem('aloft_session_start') || (() => { const n = Date.now().toString(); sessionStorage.setItem('aloft_session_start', n); return n; })();
    sessEl.textContent = new Date(parseInt(st)).toLocaleString();
  }

  // Restore font size
  const fsSaved = localStorage.getItem('aloft_select_a11yFontSize');
  if (fsSaved) { applyFontSize(fsSaved, true); const el = document.getElementById('a11yFontSize'); if (el) el.value = fsSaved; }

  // Restore high contrast
  if (localStorage.getItem('aloft_setting_highContrast') === 'on') document.documentElement.setAttribute('data-high-contrast', 'on');

  // Restore reduce motion
  if (localStorage.getItem('aloft_setting_reduceMotion') === 'on') document.documentElement.setAttribute('data-reduce-motion', 'on');

  // Restore focus ring
  if (localStorage.getItem('aloft_setting_focusRing') === 'on') document.documentElement.setAttribute('data-focus-ring', 'on');

  // Restore blur/anim suppression
  if (localStorage.getItem('aloft_setting_msgAnim') === 'off') {
    let s = document.getElementById('_msgAnimStyle');
    if (!s) { s = document.createElement('style'); s.id = '_msgAnimStyle'; document.head.appendChild(s); }
    s.textContent = '@keyframes msgIn { from{} to{} }';
  }
  if (localStorage.getItem('aloft_setting_blurEffects') === 'off') {
    let s = document.getElementById('_blurStyle');
    if (!s) { s = document.createElement('style'); s.id = '_blurStyle'; document.head.appendChild(s); }
    s.textContent = '.overlay{backdrop-filter:none!important;} .companion-popup::before{display:none!important;}';
  }

  // AI memory count
  calcAiMemoryCount();
  calcNotesCount();
}
initSettings();

function calcStorageUsage() {
  let total = 0;
  for (const key of Object.keys(localStorage)) {
    total += (localStorage.getItem(key) || '').length;
  }
  const kb = (total / 1024).toFixed(1);
  const el = document.getElementById('storageUsageText');
  if (el) el.textContent = `${kb} KB used (estimated)`;
}

function exportData() {
  const data = {
    notes: JSON.parse(localStorage.getItem('aloft_notes') || '[]'),
    history: JSON.parse(localStorage.getItem('aloft_history') || '[]'),
    exportedAt: new Date().toISOString()
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = 'aloft_export.json'; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function clearAllData() {
  if (!confirm('This will permanently wipe all local data including notes, history, and preferences. Continue?')) return;
  const keysToKeep = [];
  const allKeys = Object.keys(localStorage).filter(k => k.startsWith('aloft_'));
  allKeys.forEach(k => localStorage.removeItem(k));
  alert('All local data cleared.');
  location.reload();
}

// ── INFO MODALS (Privacy, Terms, Security) ──
const modalContent = {
  privacy: {
    title: 'Privacy Policy',
    body: `<p><strong>Last updated:</strong> 2025</p>
<p>hether is committed to protecting your privacy. Here's what you need to know about how your data is handled:</p>
<p><strong>What we collect</strong><br>
hether stores your notes, relay history, and preferences locally on your device using browser localStorage. This data does not leave your device unless you explicitly export it.</p>
<p><strong>Account data</strong><br>
When you create an account, we store your email address and chosen username to identify you. This data is stored securely using Supabase infrastructure.</p>
<p><strong>AI interactions</strong><br>
Conversations with hetherGPT are processed to generate responses. Relay history is stored locally on your device only — we do not store your AI conversations on our servers.</p>
<p><strong>No advertising</strong><br>
hether does not display advertisements and does not sell your data to third parties.</p>
<p><strong>Data deletion</strong><br>
You can clear all local data at any time via Settings. To delete your account and associated data, contact us.</p>
<p><strong>Cookies &amp; tracking</strong><br>
We do not use tracking cookies. We may use essential session cookies for authentication purposes only.</p>
<p><strong>Contact</strong><br>
For privacy-related questions, please reach out to us through the app.</p>`
  },
  terms: {
    title: 'Terms of Service',
    body: `<p><strong>Last updated:</strong> 2025</p>
<p>By using hether, you agree to the following terms:</p>
<p><strong>Acceptable Use</strong><br>
You agree to use hether only for lawful purposes. You must not use hether to harass, harm, or threaten others, spread misinformation, transmit spam or malicious content, or attempt to gain unauthorized access to any system.</p>
<p><strong>Account Responsibility</strong><br>
You are responsible for maintaining the security of your account credentials. You agree not to share your account with others or use another person's account without their explicit permission.</p>
<p><strong>Content</strong><br>
You retain ownership of content you create in hether. By using the platform, you grant us a limited license to store and transmit your content as necessary to provide the service.</p>
<p><strong>AI Usage</strong><br>
hetherGPT is provided as an informational tool. Responses may not always be accurate. Do not rely on AI responses for medical, legal, financial, or safety-critical decisions without verification from qualified professionals.</p>
<p><strong>Modifications</strong><br>
We reserve the right to modify or discontinue the service at any time. We will provide reasonable notice of significant changes.</p>
<p><strong>Limitation of Liability</strong><br>
hether is provided "as is" without warranty of any kind. We are not liable for any indirect, incidental, or consequential damages arising from your use of the service.</p>`
  },
  security: {
    title: 'Security Information',
    body: `<p>hether takes the security of your data seriously. Here is an overview of the security measures in place:</p>
<p><strong>Encryption in transit</strong><br>
All data transmitted between your device and our servers is encrypted using TLS (Transport Layer Security). This prevents interception of your messages and account information.</p>
<p><strong>Authentication</strong><br>
Account authentication is handled by Supabase, which implements industry-standard security practices including bcrypt password hashing. Passwords are never stored in plaintext.</p>
<p><strong>Local storage</strong><br>
Data stored locally (notes, relay history, preferences) is saved in your browser's localStorage. This data is accessible only by hether within your browser and is not transmitted to our servers.</p>
<p><strong>Session management</strong><br>
Login sessions are managed with secure tokens. You can log out at any time to invalidate your session.</p>
<p><strong>Responsible disclosure</strong><br>
If you discover a security vulnerability in hether, please report it responsibly. Do not exploit or publicly disclose the vulnerability before we've had the opportunity to address it.</p>
<p><strong>Best practices for users</strong></p>
<ul style="margin:8px 0 8px 16px;line-height:2;">
  <li>Use a strong, unique password for your account</li>
  <li>Do not share your login credentials with others</li>
  <li>Log out when using shared or public devices</li>
  <li>Keep your device and browser updated</li>
</ul>`
  }
};

function showModal(type) {
  const content = modalContent[type];
  if (!content) return;
  document.getElementById('infoModalTitle').textContent = content.title;
  document.getElementById('infoModalBody').innerHTML = content.body;
  document.getElementById('infoModalOverlay').classList.add('show');
}
function closeInfoModal() {
  document.getElementById('infoModalOverlay').classList.remove('show');
}
document.getElementById('infoModalOverlay')?.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeInfoModal();
});

// ── SNIPPETS ──
let activeSnippetTab = 'web';
const webSnippets = [
  {
    title: 'Responsive Flexbox Center',
    code: `.container {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
}`,
    desc: ['Centers any child element both horizontally and vertically', 'min-height: 100vh makes it fill the full viewport', 'Works for both single and multiple children']
  },
  {
    title: 'CSS Custom Properties (Variables)',
    code: `:root {
    --primary: #6664c2;
    --radius: 8px;
    --gap: 16px;
}
.btn { background: var(--primary); border-radius: var(--radius); }`,
    desc: ['Define once, reuse everywhere with var()', 'Scoped to :root makes them globally available', 'Change one value to update the whole design']
  },
  {
    title: 'Dark Mode Toggle CSS',
    code: `[data-theme="dark"] {
    --bg: #0e0e10;
    --text: #e4e4e7;
}
[data-theme="light"] {
    --bg: #f4f4f6;
    --text: #18181b;
}`,
    desc: ['Switch themes by setting data-theme attribute on <html>', 'document.documentElement.setAttribute("data-theme","dark")', 'All CSS variables update instantly — no JS repaint needed']
  },
  {
    title: 'Smooth Scroll to Element',
    code: `function scrollTo(id) {
    document.getElementById(id).scrollIntoView({
        behavior: 'smooth',
        block: 'start'
    });
}`,
    desc: ['behavior: smooth animates the scroll instead of jumping', 'block: "start" aligns the element to the top of the viewport', 'Works in all modern browsers without any library']
  },
  {
    title: 'debounce Function',
    code: `function debounce(fn, delay = 300) {
    let timer;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), delay);
    };
}
// Usage:
const onSearch = debounce((val) => fetchResults(val), 400);`,
    desc: ['Delays execution until user stops triggering the event', 'Great for search inputs and window resize handlers', 'clearTimeout on each call resets the waiting period']
  },
  {
    title: 'Fetch API with async/await',
    code: `async function getData(url) {
    try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(\`HTTP \${res.status}\`);
        const data = await res.json();
        return data;
    } catch (err) {
        console.error('Fetch error:', err);
    }
}`,
    desc: ['async/await makes async code read like synchronous code', 'Check res.ok before parsing — a 404 still "succeeds" in fetch', 'try/catch handles both network and parsing errors']
  },
  {
    title: 'LocalStorage Helper',
    code: `const store = {
    get: (key) => JSON.parse(localStorage.getItem(key)),
    set: (key, val) => localStorage.setItem(key, JSON.stringify(val)),
    remove: (key) => localStorage.removeItem(key),
};
// Usage:
store.set('user', { name: 'Alice' });
const user = store.get('user');`,
    desc: ['localStorage only stores strings — JSON.parse/stringify handles objects', 'Returns null (not an error) when key does not exist', 'Data persists even after browser is closed']
  },
  {
    title: 'CSS Glassmorphism Card',
    code: `.glass-card {
    background: rgba(255, 255, 255, 0.12);
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 16px;
    padding: 24px;
}`,
    desc: ['backdrop-filter applies blur to whatever is behind the element', '-webkit-backdrop-filter needed for Safari support', 'Semi-transparent background + blur creates the frosted glass effect']
  },
  {
    title: 'Copy Text to Clipboard',
    code: `async function copyToClipboard(text) {
    try {
        await navigator.clipboard.writeText(text);
        console.log('Copied!');
    } catch (err) {
        // Fallback for older browsers
        const el = document.createElement('textarea');
        el.value = text; document.body.appendChild(el);
        el.select(); document.execCommand('copy');
        document.body.removeChild(el);
    }
}`,
    desc: ['navigator.clipboard.writeText is the modern API', 'The fallback works in older browsers that lack clipboard API', 'Always wrap in try/catch — clipboard access can be denied']
  },
  {
    title: 'CSS Keyframe Animation',
    code: `@keyframes fadeInUp {
    from { opacity: 0; transform: translateY(20px); }
    to   { opacity: 1; transform: translateY(0); }
}
.animated {
    animation: fadeInUp 0.4s cubic-bezier(0.22, 1, 0.36, 1);
}`,
    desc: ['cubic-bezier(0.22,1,0.36,1) gives a smooth spring-like feel', 'from/to define start and end states', 'Apply the class via JS to trigger animation on demand']
  },
  {
    title: 'Simple Event Delegation',
    code: `document.getElementById('list').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    console.log('Action:', action);
});`,
    desc: ['One listener on the parent handles all children — even dynamically added ones', 'closest() walks up the DOM to find the matching element', 'data-action attribute makes intent clear without coupling to class names']
  },
  {
    title: 'Throttle Function',
    code: `function throttle(fn, limit = 200) {
    let waiting = false;
    return (...args) => {
        if (waiting) return;
        fn(...args);
        waiting = true;
        setTimeout(() => { waiting = false; }, limit);
    };
}
// Usage:
window.addEventListener('scroll', throttle(onScroll, 100));`,
    desc: ['throttle ensures a function fires at most once per interval', 'Unlike debounce, it runs immediately then waits', 'Ideal for scroll, resize, and mousemove events']
  },
  {
    title: 'CSS Grid Layout',
    code: `.grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 16px;
}`,
    desc: ['auto-fill creates as many columns as fit without overflow', 'minmax(220px, 1fr) sets a minimum width and lets columns grow', 'Responsive with zero media queries']
  },
  {
    title: 'Intersection Observer',
    code: `const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            entry.target.classList.add('visible');
            observer.unobserve(entry.target);
        }
    });
}, { threshold: 0.1 });

document.querySelectorAll('.fade-in').forEach(el => observer.observe(el));`,
    desc: ['Triggers when an element enters the viewport — no scroll listener needed', 'threshold: 0.1 fires when 10% of the element is visible', 'unobserve() stops watching once the animation has played']
  },
  {
    title: 'Promise.all for Parallel Requests',
    code: `async function loadAll() {
    const [users, posts, comments] = await Promise.all([
        fetch('/api/users').then(r => r.json()),
        fetch('/api/posts').then(r => r.json()),
        fetch('/api/comments').then(r => r.json()),
    ]);
    return { users, posts, comments };
}`,
    desc: ['Promise.all runs all fetches in parallel, not sequentially', 'Total time equals the slowest request, not the sum', 'Rejects immediately if any promise fails']
  },
  {
    title: 'CSS Sticky Header',
    code: `header {
    position: sticky;
    top: 0;
    z-index: 100;
    background: #fff;
    box-shadow: 0 1px 4px rgba(0,0,0,0.08);
}`,
    desc: ['sticky keeps the element in flow but pins it when scrolled past', 'top: 0 sets where it sticks relative to the scroll container', 'z-index ensures it sits above scrolled content']
  },
  {
    title: 'Array Grouping (Object.groupBy)',
    code: `const products = [
    { name: 'Apple', type: 'fruit' },
    { name: 'Carrot', type: 'veg' },
    { name: 'Banana', type: 'fruit' },
];
const grouped = Object.groupBy(products, p => p.type);
// { fruit: [{...},{...}], veg: [{...}] }`,
    desc: ['Object.groupBy is a modern JS method (ES2024)', 'Groups array items by the return value of the callback', 'Falls back to reduce() for older environments']
  },
  {
    title: 'Drag and Drop (HTML5)',
    code: `// Make element draggable
el.setAttribute('draggable', true);
el.addEventListener('dragstart', e => {
    e.dataTransfer.setData('text/plain', el.id);
});
// Drop zone
zone.addEventListener('dragover', e => e.preventDefault());
zone.addEventListener('drop', e => {
    const id = e.dataTransfer.getData('text/plain');
    zone.appendChild(document.getElementById(id));
});`,
    desc: ['draggable="true" opts the element into the drag API', 'dragover must call preventDefault() to allow dropping', 'dataTransfer passes data between drag source and drop target']
  },
  {
    title: 'Web Worker Offload',
    code: `// main.js
const worker = new Worker('worker.js');
worker.postMessage({ data: heavyArray });
worker.onmessage = e => console.log('Result:', e.data);

// worker.js
self.onmessage = e => {
    const result = e.data.data.reduce((a, b) => a + b, 0);
    self.postMessage(result);
};`,
    desc: ['Workers run JS on a separate thread — UI stays responsive', 'postMessage / onmessage is the only communication channel', 'Workers have no access to the DOM']
  },
  {
    title: 'CSS :has() Selector',
    code: `/* Card that contains an image gets extra padding */
.card:has(img) {
    padding: 0;
}
/* Form row with an invalid input turns red label */
.form-row:has(input:invalid) label {
    color: crimson;
}`,
    desc: [':has() selects a parent based on its children — the "parent selector"', 'Supported in all modern browsers since 2023', 'Eliminates JS that previously had to walk up the DOM']
  },
  {
    title: 'Custom HTML Element',
    code: `class ToastAlert extends HTMLElement {
    connectedCallback() {
        this.innerHTML = \`<div class="toast">\${this.getAttribute('message')}</div>\`;
        setTimeout(() => this.remove(), 3000);
    }
}
customElements.define('toast-alert', ToastAlert);
// Usage in HTML:
// <toast-alert message="Saved!"></toast-alert>`,
    desc: ['Web Components let you create reusable HTML tags', 'connectedCallback fires when the element is inserted into the DOM', 'Attributes are read with getAttribute()']
  },
  {
    title: 'AbortController for Cancellable Fetch',
    code: `const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 5000);

fetch('/api/data', { signal: controller.signal })
    .then(r => r.json())
    .then(data => { clearTimeout(timeout); use(data); })
    .catch(err => {
        if (err.name === 'AbortError') console.log('Request cancelled');
    });`,
    desc: ['AbortController lets you cancel in-flight fetch requests', 'Pass signal to fetch; call abort() to cancel', 'AbortError distinguishes cancellation from real network errors']
  },
  {
    title: 'CSS Scroll Snap',
    code: `.slider {
    display: flex;
    overflow-x: auto;
    scroll-snap-type: x mandatory;
    scroll-behavior: smooth;
}
.slide {
    flex: 0 0 100%;
    scroll-snap-align: start;
}`,
    desc: ['scroll-snap-type enables snapping on the container', 'mandatory snaps to the nearest point; proximity is more relaxed', 'scroll-snap-align: start aligns each slide to the left edge']
  },
  {
    title: 'Reactive State with Proxy',
    code: `function reactive(data, onChange) {
    return new Proxy(data, {
        set(target, key, value) {
            target[key] = value;
            onChange(key, value);
            return true;
        }
    });
}
const state = reactive({ count: 0 }, (k, v) => console.log(\`\${k} = \${v}\`));
state.count++; // logs: count = 1`,
    desc: ['Proxy intercepts property assignments transparently', 'set trap fires every time a property changes', 'Foundation of reactivity systems in Vue 3 and similar frameworks']
  },
  {
    title: 'CSS Container Queries',
    code: `.card-wrapper {
    container-type: inline-size;
}
@container (min-width: 400px) {
    .card {
        display: flex;
        flex-direction: row;
    }
}`,
    desc: ['Container queries respond to the parent element size, not the viewport', 'container-type: inline-size enables width-based queries', 'Makes components truly self-contained and reusable']
  },
  {
    title: 'Generate UUID (browser)',
    code: `function uuid() {
    return crypto.randomUUID();
}
// Fallback for older environments:
function uuidFallback() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0;
        return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
}`,
    desc: ['crypto.randomUUID() is available in all modern browsers and Node 15+', 'The fallback produces a v4-style UUID using Math.random()', 'UUIDs are useful as unique keys for lists, database rows, etc.']
  },
  {
    title: 'IndexedDB Wrapper',
    code: `async function openDB(name, version, upgrade) {
    return new Promise((res, rej) => {
        const req = indexedDB.open(name, version);
        req.onupgradeneeded = e => upgrade(e.target.result);
        req.onsuccess = e => res(e.target.result);
        req.onerror = e => rej(e.target.error);
    });
}
// Usage:
const db = await openDB('myApp', 1, db => {
    db.createObjectStore('notes', { keyPath: 'id' });
});`,
    desc: ['IndexedDB is a full key-value database built into the browser', 'onupgradeneeded only runs on version bump — safe place to create stores', 'Wrapping in a Promise makes it compatible with async/await']
  },
  {
    title: 'CSS Clamp for Fluid Typography',
    code: `h1 {
    font-size: clamp(1.5rem, 4vw, 3rem);
}
p {
    font-size: clamp(0.9rem, 2vw, 1.125rem);
}`,
    desc: ['clamp(min, preferred, max) keeps size within bounds', 'The middle value scales with the viewport width', 'No media queries needed for fluid type scaling']
  },
  {
    title: 'Broadcast Channel (cross-tab comms)',
    code: `const channel = new BroadcastChannel('app-events');

// Send from any tab:
channel.postMessage({ type: 'LOGOUT' });

// Listen in all other tabs:
channel.onmessage = e => {
    if (e.data.type === 'LOGOUT') redirectToLogin();
};`,
    desc: ['BroadcastChannel lets same-origin tabs talk to each other', 'No server needed — pure browser API', 'Useful for syncing logout, theme changes, or cart updates across tabs']
  },
];

function switchSnippetTab(tab) {
  activeSnippetTab = tab;
  document.getElementById('snippetTabWeb').classList.toggle('active', tab === 'web');
  renderSnippets();
}

function renderSnippets() {
  const container = document.getElementById('snippetsContent');
  if (!container) return;
  const snippets = webSnippets;
  container.innerHTML = '';
  snippets.forEach((s, i) => {
    const card = document.createElement('div');
    card.className = 'snippet-card';
    const descHtml = s.desc.map(d => `<li>${escHtml(d)}</li>`).join('');
    card.innerHTML = `
      <div class="snippet-card-header">
        <div class="snippet-card-title">${escHtml(s.title)}</div>
        <div style="display:flex;gap:6px;flex-shrink:0;">
          <button class="snippet-copy-btn" id="snippetCopyBtn_${i}" onclick="copySnippet(${i})">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="12" height="12"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            Copy
          </button>
        </div>
      </div>
      <div class="snippet-card-body">
        <div class="snippet-card-main">
          <div class="snippet-code">${escHtml(s.code)}</div>
          <div class="snippet-desc"><ul>${descHtml}</ul></div>
        </div>
      </div>
    `;
    container.appendChild(card);
  });
}

function copySnippet(index) {
  const snippets = webSnippets;
  const code = snippets[index].code;
  navigator.clipboard.writeText(code).catch(() => {
    const ta = document.createElement('textarea');
    ta.value = code; document.body.appendChild(ta); ta.select();
    document.execCommand('copy'); document.body.removeChild(ta);
  });
  const btn = document.getElementById(`snippetCopyBtn_${index}`);
  if (btn) {
    btn.textContent = '✓ Copied';
    btn.classList.add('copied');
    setTimeout(() => {
      btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="12" height="12"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copy`;
      btn.classList.remove('copied');
    }, 1800);
  }
}

// ══════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════

const RELAY_THEMES = [
  {
    id: 'default',
    label: 'Default Blue',
    tag: 'Default',
    sent: '#495cea',
    recv: '#e4e4ea',
    sentText: '#ffffff',
    recvText: '#18181b',
  },
  {
    id: 'lovecore',
    label: 'Valentine',
    tag: 'Lovecore',
    sent: '#e8265a',
    recv: '#e4e4ea',
    sentText: '#ffffff',
    recvText: '#18181b',
  },
  {
    id: 'solarized',
    label: 'Black & White',
    tag: 'Solarized Ink',
    sent: '#F5F5F5',
    recv: '#e4e4ea',
    sentText: '#18181b',
    recvText: '#18181b',
  },
  {
    id: 'honey',
    label: 'Warm Yellow',
    tag: 'Honey',
    sent: '#e6a817',
    recv: '#e4e4ea',
    sentText: '#ffffff',
    recvText: '#18181b',
  },
  {
    id: 'bluehaze',
    label: 'Faded Blue',
    tag: 'One Storm',
    sent: '#6081A8',
    recv: '#e4e4ea',
    sentText: '#ffffff',
    recvText: '#18181b',
  },
  {
    id: 'nightdrive',
    label: 'Dark Blue',
    tag: 'Night Drive',
    sent: '#224F73',
    recv: '#e4e4ea',
    sentText: '#c8d8f8',
    recvText: '#18181b',
  },
  {
    id: 'lagoon',
    label: 'Teal & Orange',
    tag: 'Lagoon',
    sent: '#166480',
    recv: '#e4e4ea',
    sentText: '#ffffff',
    recvText: '#18181b',
  },
  // ── Couples Themes ──
  {
    id: 'tandem',
    label: 'Soft Rose & Slate',
    tag: 'Tandem',
    sub: 'Couples',
    sent: '#c96b8a',
    recv: '#e4e4ea',
    sentText: '#ffffff',
    recvText: '#18181b',
  },
  {
    id: 'duskpact',
    label: 'Crimson & Golden Brown',
    tag: 'Golden Brown',
    sub: 'Couples',
    sent: '#BAA557',
    recv: '#e4e4ea',
    sentText: '#2a2107',
    recvText: '#18181b',
  },
  // ── Other Themes ──
  {
    id: 'mintleaf',
    label: 'Fresh Mint',
    tag: 'Wasabii',
    sent: '#2E6924',
    recv: '#e4e4ea',
    sentText: '#ffffff',
    recvText: '#18181b',
  },
  {
    id: 'ember',
    label: 'Deep Orange & Charcoal',
    tag: 'Ember',
    sent: '#c94a1a',
    recv: '#e4e4ea',
    sentText: '#fff4ee',
    recvText: '#18181b',
  },
  {
    id: 'arctic',
    label: 'Ice Blue & Silver',
    tag: 'Arctic',
    sent: '#3a8fc2',
    recv: '#e4e4ea',
    sentText: '#ffffff',
    recvText: '#18181b',
  },
  {
    id: 'sakura',
    label: 'Blush Pink & Sage',
    tag: 'Sakura',
    sent: '#e88faa',
    recv: '#e4e4ea',
    sentText: '#ffffff',
    recvText: '#18181b',
  },
  {
    id: 'obsidian',
    label: 'Dark Violet & Neon',
    tag: 'Obsidian',
    sent: '#312D87',
    recv: '#e4e4ea',
    sentText: '#f0e6ff',
    recvText: '#18181b',
  },
  {
    id: 'console',
    label: 'Olive Terminal',
    tag: 'Console',
    sent: '#738C29',
    recv: '#e4e4ea',
    sentText: '#ffffff',
    recvText: '#18181b',
  },
  {
    id: 'moss',
    label: 'Sap',
    tag: 'Sap artifact',
    sent: '#144D37',
    recv: '#e4e4ea',
    sentText: '#ffffff',
    recvText: '#18181b',
  },
];

let _themePickerOpen = false;
let _relayThemeChannel = null;
let _currentAppliedTheme = 'default';

function toggleThemePicker() {
  _themePickerOpen = !_themePickerOpen;
  const picker = document.getElementById('fluxThemePicker');
  const chevron = document.getElementById('fluxThemeChevron');
  if (picker) picker.classList.toggle('open', _themePickerOpen);
  if (chevron) chevron.style.transform = _themePickerOpen ? 'rotate(180deg)' : '';
  if (_themePickerOpen) renderThemePicker();
}

function renderThemePicker() {
  const picker = document.getElementById('fluxThemePicker');
  if (!picker) return;
  picker.innerHTML = '';
  RELAY_THEMES.forEach(t => {
    const item = document.createElement('div');
    item.className = 'flux-theme-item' + (t.id === _currentAppliedTheme ? ' active' : '');
    item.dataset.theme = t.id;
    item.onclick = () => selectRelayTheme(t.id);
    item.innerHTML = `
      <div class="flux-theme-preview">
        <span class="flux-theme-bubble-recv" style="background:${t.recv};color:${t.recvText};">hey! 👋</span>
        <span class="flux-theme-bubble-sent" style="background:${t.sent};color:${t.sentText};">hii!!</span>
      </div>
      <div style="flex:1;min-width:0;">
        <div class="flux-theme-item-label">${t.tag}</div>
        <div class="flux-theme-item-sub">${t.label}</div>
      </div>
      
    `;
    picker.appendChild(item);
  });
}

function applyRelayTheme(themeId) {
  _currentAppliedTheme = themeId || 'default';
  const relayWrap = document.getElementById('fluxActiveRelayWrap');
  if (relayWrap) relayWrap.dataset.relayTheme = _currentAppliedTheme;
  // Desktop overlay wrapper
  const fluxOverlay = document.getElementById('fluxOverlay');
  if (fluxOverlay) fluxOverlay.dataset.relayTheme = _currentAppliedTheme;
  // Mobile fullscreen — set on the outer container so CSS selectors reach bubbles inside
  const fluxFullscreen = document.getElementById('fluxFullscreen');
  if (fluxFullscreen) fluxFullscreen.dataset.relayTheme = _currentAppliedTheme;
  const fsRelayView = document.getElementById('fluxFsRelayView');
  if (fsRelayView) fsRelayView.dataset.relayTheme = _currentAppliedTheme;
  const fsMessages = document.getElementById('fluxFsMessages');
  if (fsMessages) fsMessages.dataset.relayTheme = _currentAppliedTheme;
}

async function selectRelayTheme(themeId) {
  applyRelayTheme(themeId);
  renderThemePicker();
  await saveRelayThemeToSupabase(themeId);
}

function _sortUserIds(uid1, uid2) {
  return [uid1, uid2].sort();
}

async function saveRelayThemeToSupabase(themeId) {
  if (!activeFluxProfileTarget) return;
  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) return;
  const [u1, u2] = _sortUserIds(user.id, activeFluxProfileTarget);

  // upsert by user1_id + user2_id
  const { error } = await supabaseClient
    .from('chat_settings')
    .upsert(
      {
        user1_id: u1,
        user2_id: u2,
        theme: themeId,
        changed_by: user.id,
      },
      { onConflict: 'user1_id,user2_id' }
    );
  if (error) { console.error('Theme save error:', error); return; }

  // Broadcast theme change instantly over the typing channel so the other
  // user sees it in real time without waiting for DB replication.
  if (typingChannel && typingChannel.state === 'joined') {
    typingChannel.send({
      type: 'broadcast',
      event: 'theme_change',
      payload: { theme: themeId, senderId: user.id }
    });
  }

  const themeObj = RELAY_THEMES.find(t => t.id === themeId);
  const themeName = themeObj ? themeObj.tag : themeId;
  const myName = (await supabaseClient.from('profiles').select('username').eq('id', user.id).single()).data?.username || 'Someone';
  const systemText = `${myName} changed the theme to ${themeName}.`;

  if (activeFluxId && activeFluxProfileTarget) {
    await supabaseClient.from('messages').insert({
      sender_id: user.id,
      receiver_id: activeFluxProfileTarget,
      content: systemText,
      message_type: 'system'
    });
  }
}

async function loadRelayThemeFromSupabase(otherUserId) {
  if (!otherUserId) return;
  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) return;
  const [u1, u2] = _sortUserIds(user.id, otherUserId);

  const { data, error } = await supabaseClient
    .from('chat_settings')
    .select('theme')
    .eq('user1_id', u1)
    .eq('user2_id', u2)
    .maybeSingle();

  const theme = data?.theme || 'default';
  applyRelayTheme(theme);
  if (_themePickerOpen) renderThemePicker();
}

async function subscribeToRelayTheme(otherUserId) {
  if (!otherUserId) return;
  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) return;
  const [u1, u2] = _sortUserIds(user.id, otherUserId);

  // Unsubscribe from previous
  if (_relayThemeChannel) {
    try { await supabaseClient.removeChannel(_relayThemeChannel); } catch(e) {}
    _relayThemeChannel = null;
  }

  // Supabase postgres_changes only supports one column per filter,
  // so we filter by user1_id and verify user2_id client-side.
  _relayThemeChannel = supabaseClient
    .channel(`relay_theme:${u1}:${u2}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'chat_settings',
        filter: `user1_id=eq.${u1}`,
      },
      (payload) => {
        const row = payload.new || payload.old;
        if (row && row.user1_id === u1 && row.user2_id === u2) {
          const newTheme = row.theme || 'default';
          applyRelayTheme(newTheme);
          if (_themePickerOpen) renderThemePicker();
        }
      }
    )
    .subscribe((status, err) => {
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        console.warn('Relay theme channel error:', status, err);
      }
    });
}

// ── REAL-TIME SEEN: mark conversation seen when user returns to tab/window ──
// This ensures the receiver-side marks seen immediately when they focus the page,
// triggering the BroadcastChannel event so the sender sees the "Seen" tag instantly.
// ── GHOST MODE ──
let _ghostModeEnabled = true; // default on (mirrors DB default)
let _squaredBubbleEnabled = false; // default off (mirrors DB default)

function _isVaultPanelOpen() {
  const vaultOv = document.getElementById('vaultOverlay');
  const fluxOv    = document.getElementById('fluxOverlay');
  const fluxFs    = document.getElementById('fluxFullscreen');
  return (vaultOv && vaultOv.classList.contains('show'))
      || (fluxOv   && fluxOv.classList.contains('show'))
      || (fluxFs   && fluxFs.classList.contains('show'));
}

function _ghostTrigger() {
  if (!_ghostModeEnabled) return;
  if (!_isVaultPanelOpen()) return;
  closeVaultPopup();
  if (typeof closeFLUX === 'function') closeFLUX();
}

// ── REALTIME REHYDRATION ──
// Supabase WebSockets can silently drop when a tab is hidden, throttled by
// the browser, or idle for a long time. This rebuilds every dead channel so
let _rehydrating = false;
async function _rehydrateRealtime() {
  if (!fluxOpen || _rehydrating) return;
  _rehydrating = true;
  try {
    // 1. Presence heartbeat — restart if channel is gone or not joined
    if (!presenceChannel || presenceChannel.state !== 'joined') {
      await joinPresence();
    }

    const deadWatchers = Object.keys(_presenceWatchChannels).filter(uid => {
      const entry = _presenceWatchChannels[uid];
      return !entry.channel || entry.channel.state === 'closed' || entry.channel.state === 'errored';
    });
    deadWatchers.forEach(uid => {
      unwatchUserPresence(uid);   // remove the dead one
      watchUserPresence(uid);     // fresh subscribe
    });
    // Also kick any watcher whose channel is just stalled (not 'joined' yet)
    Object.keys(_presenceWatchChannels).forEach(uid => {
      const entry = _presenceWatchChannels[uid];
      if (entry.channel && entry.channel.state !== 'joined' && entry.channel.state !== 'joining') {
        unwatchUserPresence(uid);
        watchUserPresence(uid);
      }
    });

    // 3. Global inbox channel — rebuild if dead
    const globalChState = window._fluxGlobalChannel?.state;
    if (!window._fluxGlobalChannel || globalChState === 'closed' || globalChState === 'errored') {
      try { if (window._fluxGlobalChannel) await supabaseClient.removeChannel(window._fluxGlobalChannel); } catch(e) {}
      window._fluxGlobalChannel = null;
      const { data: { user } } = await supabaseClient.auth.getUser();
      if (user) {
        const globalCh = supabaseClient.channel(`global-inbox:${user.id}`)
          .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages',
            filter: `receiver_id=eq.${user.id}` }, (payload) => {
            if (!fluxOpen) return;
            const msg = payload.new;
            if (msg.sender_id === activeFluxId && _isRelayVisibleFor(msg.sender_id)) return;
            _maybePlayMessageSound(msg.sender_id, user.id);
            const contact = fluxContacts.find(c => c.id === msg.sender_id);
            if (contact) {
              contact.unread = true;
              contact.unreadCount = (contact.unreadCount || 0) + 1;
              const d = parseSupabaseDate(msg.created_at);
              contact.lastMessage = { type: 'received', text: msg.content, media: !!msg.media_url, time: formatMsgTime(d) };
              contact.lastMessageTs = d.getTime();
              buildFLUXConvList();
            }
          })
          .subscribe();
        window._fluxGlobalChannel = globalCh;
      }
    }

    // 3b. Global group inbox channel — rebuild if dead
    const globalGroupChState = window._fluxGlobalGroupChannel?.state;
    if (!window._fluxGlobalGroupChannel || globalGroupChState === 'closed' || globalGroupChState === 'errored') {
      try { if (window._fluxGlobalGroupChannel) await supabaseClient.removeChannel(window._fluxGlobalGroupChannel); } catch(e) {}
      window._fluxGlobalGroupChannel = null;
      const { data: { user } } = await supabaseClient.auth.getUser();
      if (user) {
        const globalGroupCh = supabaseClient.channel(`global-inbox-groups:${user.id}`)
          .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload) => {
            if (!fluxOpen) return;
            const msg = payload.new;
            if (!msg.group_id || !_fluxMyGroupIds.has(msg.group_id)) return;
            if (msg.sender_id === user.id) return;
            if (msg.group_id === activeFluxId && _isRelayVisibleFor(msg.group_id)) return;
            _maybePlayMessageSound(msg.group_id, user.id);
            const contact = fluxContacts.find(c => c.id === msg.group_id);
            if (contact) {
              contact.unread = true;
              contact.unreadCount = (contact.unreadCount || 0) + 1;
              const d = parseSupabaseDate(msg.created_at);
              contact.lastMessage = { type: 'received', text: msg.content, media: !!msg.media_url, time: formatMsgTime(d) };
              contact.lastMessageTs = d.getTime();
              buildFLUXConvList();
            }
          })
          .subscribe();
        window._fluxGlobalGroupChannel = globalGroupCh;
      }
    }

    // 4. Global typing channel — rebuild if dead
    const globalTypingState = window._fluxGlobalTypingChannel?.state;
    if (!window._fluxGlobalTypingChannel || globalTypingState === 'closed' || globalTypingState === 'errored') {
      try { if (window._fluxGlobalTypingChannel) await supabaseClient.removeChannel(window._fluxGlobalTypingChannel); } catch(e) {}
      window._fluxGlobalTypingChannel = null;
      const { data: { user } } = await supabaseClient.auth.getUser();
      if (user) {
        const globalTypingCh = supabaseClient.channel(`typing-notify:${user.id}`, {
          config: { broadcast: { self: false } }
        });
        globalTypingCh
          .on('broadcast', { event: 'typing' }, ({ payload }) => {
            const senderId = payload.userId;
            if (!senderId) return;
            if (payload.isTyping) {
              ['fluxConvList', 'fluxFsConvList'].forEach(listId => {
                const list = document.getElementById(listId);
                if (!list) return;
                const item = list.querySelector(`.flux-conv-item[data-id="${senderId}"]`);
                if (!item) return;
                const preview = item.querySelector('.flux-conv-preview');
                if (preview && !preview.classList.contains('typing')) {
                  preview.dataset.prevText = preview.textContent;
                  preview.dataset.prevClass = preview.className;
                  preview.className = 'flux-conv-preview typing';
                  preview.textContent = 'Typing\u2026';
                }
              });
              if (senderId === activeFluxId) showRemoteTyping(senderId);
            } else {
              if (senderId === activeFluxId) {
                hideRemoteTyping();
              } else {
                ['fluxConvList', 'fluxFsConvList'].forEach(listId => {
                  const list = document.getElementById(listId);
                  if (!list) return;
                  const item = list.querySelector(`.flux-conv-item[data-id="${senderId}"]`);
                  if (!item) return;
                  const preview = item.querySelector('.flux-conv-preview.typing');
                  if (preview) {
                    preview.className = preview.dataset.prevClass || 'flux-conv-preview';
                    preview.textContent = preview.dataset.prevText || '';
                    delete preview.dataset.prevText;
                    delete preview.dataset.prevClass;
                  }
                });
              }
            }
          })
          .subscribe();
        window._fluxGlobalTypingChannel = globalTypingCh;
      }
    }

    const relayChState = subscriptionManager.activeSubscription?.state;
    if (activeFluxId && (!subscriptionManager.activeSubscription || relayChState === 'closed' || relayChState === 'errored')) {
      // Re-open without resetting the UI — just restore the realtime subscription.
      const isMobile = document.getElementById('fluxFullscreen')?.classList.contains('show');
      if (isMobile) {
        if (typeof openFsRelay === 'function') await openFsRelay(activeFluxId);
      } else {
        if (typeof openDesktopRelay === 'function') await openDesktopRelay(activeFluxId);
      }
    }

    // 6. Typing channel — rebuild if dead
    if (activeFluxId) {
      const typingChState = typingChannel?.state;
      if (!typingChannel || typingChState === 'closed' || typingChState === 'errored') {
        const { data: { user } } = await supabaseClient.auth.getUser();
        if (user) await setupTypingChannel(user.id, activeFluxId);
      }
    }

    // 7. Seen channel — rebuild if dead
    if (_seenMyUserId) {
      const seenChState = _seenChannel?.state;
      if (!_seenChannel || seenChState === 'closed' || seenChState === 'errored') {
        await startSeenChannel(_seenMyUserId);
      }
    }

    if (activeFluxId) {
      const themeChState = _relayThemeChannel?.state;
      if (!_relayThemeChannel || themeChState === 'closed' || themeChState === 'errored') {
        await subscribeToRelayTheme(activeFluxId);
      }
    }

    const clearedChState = window._fluxRelayClearedChannel?.state;
    if (!window._fluxRelayClearedChannel || clearedChState === 'closed' || clearedChState === 'errored') {
      try { if (window._fluxRelayClearedChannel) await supabaseClient.removeChannel(window._fluxRelayClearedChannel); } catch(e) {}
      window._fluxRelayClearedChannel = null;
      const { data: { user: _ccUser } } = await supabaseClient.auth.getUser();
      if (_ccUser) {
        const relayClearedCh = supabaseClient.channel(`relay-cleared:${_ccUser.id}`, {
          config: { broadcast: { self: false } }
        });
        relayClearedCh
          .on('broadcast', { event: 'relay-cleared' }, ({ payload }) => {
            if (!fluxOpen) return;
            const clearerId = payload?.clearerId;
            if (clearerId) _handleRemoteRelayCleared(clearerId);
          })
          .subscribe();
        window._fluxRelayClearedChannel = relayClearedCh;
      }
    }

    // Always refresh presence dots after rehydrating
    updatePresenceDots();
  } catch(e) {
    // Silently swallow — rehydration is best-effort
  } finally {
    _rehydrating = false;
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    _ghostTrigger();
  } else if (document.visibilityState === 'visible' && fluxOpen && activeFluxId) {
    markConversationSeen(activeFluxId);
    if (_seenMyUserId) pollSeenStatus(_seenMyUserId);
    const contact = fluxContacts ? fluxContacts.find(c => c.id === activeFluxId) : null;
    if (contact) { contact.unread = false; contact.unreadCount = 0; }
    _updateTitleUnreadBadge();
    buildFLUXConvList();
    // Reconnect any channels that died while hidden
    _rehydrateRealtime();
  }
});

window.addEventListener('blur', () => { _ghostTrigger(); });

window.addEventListener('focus', () => {
  if (fluxOpen && activeFluxId) {
    markConversationSeen(activeFluxId);
    if (_seenMyUserId) pollSeenStatus(_seenMyUserId);
    const contact = fluxContacts ? fluxContacts.find(c => c.id === activeFluxId) : null;
    if (contact) { contact.unread = false; contact.unreadCount = 0; }
    _updateTitleUnreadBadge();
    buildFLUXConvList();
    // Reconnect any channels that dropped while the window was blurred
    _rehydrateRealtime();
  }
});

async function loadGhostMode() {
  try {
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) return;
    const { data } = await supabaseClient.from('profiles').select('ghost_mode').eq('id', user.id).single();
    // DB default is true; treat null/undefined as true
    _ghostModeEnabled = data?.ghost_mode !== false;
    _syncGhostToggleUI();
  } catch(e) {}
}

function _syncGhostToggleUI() {
  const btn = document.getElementById('ghostModeToggle');
  if (btn) btn.classList.toggle('on', _ghostModeEnabled);
}

async function toggleGhostMode() {
  _ghostModeEnabled = !_ghostModeEnabled;
  _syncGhostToggleUI();
  try {
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) return;
    await supabaseClient.from('profiles').update({ ghost_mode: _ghostModeEnabled }).eq('id', user.id);
  } catch(e) {
    // Revert on failure
    _ghostModeEnabled = !_ghostModeEnabled;
    _syncGhostToggleUI();
  }
}

async function loadSquaredBubble() {
  try {
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) return;
    const { data } = await supabaseClient.from('profiles').select('squared_bubble').eq('id', user.id).single();
    // DB default is false; treat null/undefined as false
    _squaredBubbleEnabled = data?.squared_bubble === true;
    _syncSquaredBubbleUI();
  } catch(e) {}
}

function _syncSquaredBubbleUI() {
  const btn = document.getElementById('squaredBubbleToggle');
  if (btn) btn.classList.toggle('on', _squaredBubbleEnabled);
  document.documentElement.toggleAttribute('data-squared-bubble', _squaredBubbleEnabled);
}

async function toggleSquaredBubble() {
  _squaredBubbleEnabled = !_squaredBubbleEnabled;
  _syncSquaredBubbleUI();
  try {
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) return;
    await supabaseClient.from('profiles').update({ squared_bubble: _squaredBubbleEnabled }).eq('id', user.id);
  } catch(e) {
    // Revert on failure
    _squaredBubbleEnabled = !_squaredBubbleEnabled;
    _syncSquaredBubbleUI();
  }
}

let _inboxGroupingEnabled = true; // default ON (mirrors DB default true)

async function loadInboxGrouping() {
  try {
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) return;
    const { data } = await supabaseClient.from('profiles').select('inbox_grouping').eq('id', user.id).single();
    // DB default is true; treat null/undefined as true so existing users get it on by default
    _inboxGroupingEnabled = data?.inbox_grouping !== false;
    _syncInboxGroupingUI();
  } catch(e) {}
}

function _syncInboxGroupingUI() {
  const btn = document.getElementById('inboxGroupingToggle');
  if (btn) btn.classList.toggle('on', _inboxGroupingEnabled);
}

async function toggleInboxGrouping() {
  _inboxGroupingEnabled = !_inboxGroupingEnabled;
  _syncInboxGroupingUI();
  try {
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) return;
    await supabaseClient.from('profiles').update({ inbox_grouping: _inboxGroupingEnabled }).eq('id', user.id);
  } catch(e) {
    // Revert on failure
    _inboxGroupingEnabled = !_inboxGroupingEnabled;
    _syncInboxGroupingUI();
  }
}

let _notificationsEnabled = false; // default off (mirrors DB default=false)
let _soundEnabled = false;         // default off (mirrors DB default=false)

// ── LOW BLIP SOUND (Discord-style warm blip) ──
const _notifAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
function _playLowBlip() {
  const _doPlay = () => {
    try {
      const o = _notifAudioCtx.createOscillator();
      const g = _notifAudioCtx.createGain();
      const f = _notifAudioCtx.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.value = 1000;
      o.type = 'sine';
      o.frequency.setValueAtTime(480, _notifAudioCtx.currentTime);
      g.gain.setValueAtTime(0, _notifAudioCtx.currentTime);
      g.gain.linearRampToValueAtTime(0.32, _notifAudioCtx.currentTime + 0.008);
      g.gain.exponentialRampToValueAtTime(0.001, _notifAudioCtx.currentTime + 0.008 + 0.12);
      const o2 = _notifAudioCtx.createOscillator();
      const g2 = _notifAudioCtx.createGain();
      o2.type = 'sine'; o2.frequency.value = 580;
      g2.gain.setValueAtTime(0, _notifAudioCtx.currentTime + 0.14);
      g2.gain.linearRampToValueAtTime(0.28, _notifAudioCtx.currentTime + 0.148);
      g2.gain.exponentialRampToValueAtTime(0.001, _notifAudioCtx.currentTime + 0.148 + 0.18);
      o.connect(f); f.connect(g); g.connect(_notifAudioCtx.destination);
      o2.connect(g2); g2.connect(_notifAudioCtx.destination);
      o.start(); o.stop(_notifAudioCtx.currentTime + 0.15);
      o2.start(_notifAudioCtx.currentTime + 0.14); o2.stop(_notifAudioCtx.currentTime + 0.35);
    } catch(e) {}
  };
  if (_notifAudioCtx.state === 'suspended') {
    _notifAudioCtx.resume().then(_doPlay).catch(() => {});
  } else {
    _doPlay();
  }
}

function _maybePlayMessageSound(conversationId, currentUserId) {
  if (!fluxOpen) return;
  if (!_notificationsEnabled || !_soundEnabled) return;
  if (conversationId === currentUserId) return;
  if (_fluxMutedOf(conversationId)) return; // person or group is muted
  if (activeFluxId === conversationId && document.hasFocus() && document.visibilityState === 'visible' && _isFLUXPanelOpen()) return;
  _playLowBlip();
}

async function loadNotifications() {
  try {
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) return;
    const { data } = await supabaseClient.from('profiles').select('notifications, sound').eq('id', user.id).single();
    _notificationsEnabled = data?.notifications === true;
    _soundEnabled = _notificationsEnabled ? (data?.sound === true) : false;
    _syncNotificationsToggleUI();
    _syncSoundToggleUI();
  } catch(e) {}
}

function _syncNotificationsToggleUI() {
  const btn = document.getElementById('notificationsToggle');
  if (btn) btn.classList.toggle('on', _notificationsEnabled);
  if (!_notificationsEnabled) document.title = "Hether - Code n' Arcade";
}

function _syncSoundToggleUI() {
  const btn = document.getElementById('soundToggle');
  // Sound toggle is disabled/greyed when notifications are off
  if (btn) {
    btn.classList.toggle('on', _soundEnabled);
    btn.disabled = !_notificationsEnabled;
    btn.style.opacity = _notificationsEnabled ? '' : '0.4';
    btn.style.cursor = _notificationsEnabled ? '' : 'not-allowed';
  }
}

async function toggleNotifications() {
  _notificationsEnabled = !_notificationsEnabled;
  // If turning notifications off, force sound off too
  if (!_notificationsEnabled && _soundEnabled) {
    _soundEnabled = false;
    try {
      const { data: { user } } = await supabaseClient.auth.getUser();
      if (user) await supabaseClient.from('profiles').update({ notifications: false, sound: false }).eq('id', user.id);
    } catch(e) {}
    _syncNotificationsToggleUI();
    _syncSoundToggleUI();
    return;
  }
  _syncNotificationsToggleUI();
  _syncSoundToggleUI();
  try {
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) return;
    await supabaseClient.from('profiles').update({ notifications: _notificationsEnabled }).eq('id', user.id);
  } catch(e) {
    _notificationsEnabled = !_notificationsEnabled;
    _syncNotificationsToggleUI();
    _syncSoundToggleUI();
  }
}

async function toggleSound() {
  // Sound can only be toggled if notifications are on
  if (!_notificationsEnabled) return;
  _soundEnabled = !_soundEnabled;
  _syncSoundToggleUI();
  try {
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) return;
    await supabaseClient.from('profiles').update({ sound: _soundEnabled }).eq('id', user.id);
  } catch(e) {
    _soundEnabled = !_soundEnabled;
    _syncSoundToggleUI();
  }
}

function _isFLUXPanelOpen() {
  const fluxOv = document.getElementById('fluxOverlay');
  const fluxFs = document.getElementById('fluxFullscreen');
  return (fluxOv && fluxOv.classList.contains('show'))
      || (fluxFs && fluxFs.classList.contains('show'));
}

function _isRelayVisibleFor(userId) {
  if (!userId || activeFluxId !== userId) return false;
  if (!_isFLUXPanelOpen()) return false;
  return document.visibilityState === 'visible' && document.hasFocus();
}

function _updateTitleUnreadBadge() {
  if (!fluxOpen || !_notificationsEnabled) {
    document.title = "Hether - Code n' Arcade";
    return;
  }
  const unreadUsers = (typeof fluxContacts !== 'undefined')
    ? fluxContacts.filter(c => {
        if (!c.unread) return false;
        if (c.id === activeFluxId && _isRelayVisibleFor(c.id)) return false;
        return true;
      }).length
    : 0;
  if (unreadUsers <= 0) {
    document.title = "Hether - Code n' Arcade";
  } else {
    document.title = `(${unreadUsers}) Hether - Code n' Arcade`;
  }
}

(function _patchBuildFLUXConvListForNotifications() {
  const _originalBuild = window.buildFLUXConvList;
  if (typeof _originalBuild === 'function') {
    window.buildFLUXConvList = function() {
      _originalBuild.apply(this, arguments);
      _updateTitleUnreadBadge();
    };
  }
})();

const _originalCloseFLUX = window.closeFLUX;
if (typeof _originalCloseFLUX === 'function') {
  window.closeFLUX = async function() {
    await _originalCloseFLUX.apply(this, arguments);
    document.title = "Hether - Code n' Arcade";
  };
}




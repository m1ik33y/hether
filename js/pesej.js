let _vaultSessionValid = false;

// Internal: only hides the overlay UI, does NOT touch auth flags.
function _dismissVaultOverlay() {
  const overlay = document.getElementById('vaultOverlay');
  const input = document.getElementById('vaultInput');
  overlay.classList.remove('show');
  input.value = '';
  input.blur();
  document.getElementById('vaultError').style.display = 'none';
}

// Public close — called by Cancel button, ESC, clicking outside, browser events.
function closeVaultPopup() {
  _vaultSessionValid = false;
  vaultAuthenticated = false;
  // Stop any active typing broadcast so the remote side doesn't get stuck showing "Typing…"
  if (isCurrentlyTyping) stopTypingBroadcast();
  document.getElementById('fluxProfileTab')?.classList.remove('show');
  _dismissVaultOverlay();
}

function openVaultPopup() {
  if (window._guestMode) return; // disabled in guest / "Try for Free" mode
  _vaultSessionValid = false;
  vaultAuthenticated = false;
  const input = document.getElementById('vaultInput');
  document.getElementById('vaultOverlay').classList.add('show');
  input.value = '';
  document.getElementById('vaultError').style.display = 'none';
  input.focus();
}

function vaultKeyHandler(e) {
  if (e.key === 'Enter') verifyVault();
  if (e.key === 'Escape') closeVaultPopup(); // wipes flags
}

async function verifyVault() {
  const input = document.getElementById('vaultInput');
  const val = input.value;
  const err = document.getElementById('vaultError');
  const btn = document.getElementById('vaultVerifyBtn');
  const label = document.getElementById('vaultVerifyLabel');
  const spinner = document.getElementById('vaultVerifySpinner');

  if (!val) return;

  // Show spinner in place of the "Verify" text while we hit Supabase
  err.style.display = 'none';
  btn.disabled = true;
  label.style.display = 'none';
  spinner.style.display = 'inline-block';

  let match = false;
  try {
    // Server-side check via RPC — only true/false ever comes back,
    // the password value itself never leaves the database.
    const { data, error } = await supabaseClient.rpc('verify_admin_key', { key: val });
    if (error) throw error;
    match = data === true;
  } catch (e) {
    console.warn('[Vault] Verification request failed', e);
    match = false;
  }

  // Restore button state
  btn.disabled = false;
  spinner.style.display = 'none';
  label.style.display = 'inline';

  if (match) {
    // Grant access FIRST, then dismiss overlay WITHOUT wiping flags
    _vaultSessionValid = true;
    vaultAuthenticated = true;
    _dismissVaultOverlay(); // just hides UI, flags stay true
    openFLUX();
  } else {
    err.style.display = 'block';
    input.value = '';
    input.focus();
  }
}

// Uses a flag-check function so it reads live variable values, not closures.
function _isFluxAuthValid() { return vaultAuthenticated === true && _vaultSessionValid === true; }

(function _patchFluxSecurity() {
  const fluxOvEl = document.getElementById('fluxOverlay');
  const fluxFsEl = document.getElementById('fluxFullscreen');

  if (fluxOvEl) {
    const _origOvAdd = DOMTokenList.prototype.add.bind(fluxOvEl.classList);
    fluxOvEl.classList.add = function(...args) {
      if (args.includes('show') && !_isFluxAuthValid()) {
        console.warn('[Security] Blocked unauthorized fluxOverlay show');
        return;
      }
      _origOvAdd(...args);
    };
  }

  if (fluxFsEl) {
    const _origFsAdd = DOMTokenList.prototype.add.bind(fluxFsEl.classList);
    fluxFsEl.classList.add = function(...args) {
      if (args.includes('show') && !_isFluxAuthValid()) {
        console.warn('[Security] Blocked unauthorized fluxFullscreen show');
        return;
      }
      _origFsAdd(...args);
    };
  }

  const vaultOvEl = document.getElementById('vaultOverlay');
  if (vaultOvEl) {
    vaultOvEl.addEventListener('click', (e) => {
      if (e.target === vaultOvEl) closeVaultPopup();
    });
  }
})();

let _seenChannel = null;
let _seenBroadcast = null; // BroadcastChannel for cross-tab/window instant seen sync
let _seenPollInterval = null; // Fallback polling for when realtime UPDATE events don't fire
let _seenMyUserId = null; // Stored so polling can use it

function applySeen(updatedId, myUserId) {
  const containers = ['fluxRelayMessages', 'fluxFsMessages']
    .map(id => document.getElementById(id))
    .filter(Boolean);

  containers.forEach(msgsEl => {
    let outer = msgsEl.querySelector(`.flux-bubble-outer[data-msg-id="${updatedId}"]`);
    if (!outer) {
      const wrap = msgsEl.querySelector(`.flux-bubble-wrap[data-msg-id="${updatedId}"]`);
      if (wrap) outer = wrap.closest('.flux-bubble-outer') || wrap.parentElement;
    }

    if (outer) {
      const allSentOuters = [...msgsEl.querySelectorAll('.flux-msg-group.sent .flux-bubble-outer')];
      let found = false;
      for (let i = allSentOuters.length - 1; i >= 0; i--) {
        if (allSentOuters[i] === outer) found = true;
        if (found) allSentOuters[i].dataset.seen = 'true';
      }
    } else {
      msgsEl.querySelectorAll('.flux-msg-group.sent .flux-bubble-outer').forEach(o => {
        o.dataset.seen = 'true';
      });
    }
    fixSeenLabels(msgsEl);
  });
}

async function pollSeenStatus(myUserId) {
  if (!activeFluxId) return;
  try {
    const { data } = await supabaseClient.from('messages')
      .select('id, seen')
      .eq('sender_id', myUserId)
      .eq('receiver_id', activeFluxId)
      .eq('seen', true)
      .order('created_at', { ascending: false })
      .limit(30);

    if (!data || data.length === 0) return;

    const containers = ['fluxRelayMessages', 'fluxFsMessages']
      .map(id => document.getElementById(id))
      .filter(Boolean);

    containers.forEach(msgsEl => {
      let changed = false;
      data.forEach(row => {
        const outer = msgsEl.querySelector(`.flux-bubble-outer[data-msg-id="${row.id}"]`);
        if (outer && outer.dataset.seen !== 'true') {
          outer.dataset.seen = 'true';
          changed = true;
        }
        // Also check via wrap
        if (!outer) {
          const wrap = msgsEl.querySelector(`.flux-bubble-wrap[data-msg-id="${row.id}"]`);
          if (wrap) {
            const o = wrap.closest('.flux-bubble-outer') || wrap.parentElement;
            if (o && o.dataset.seen !== 'true') {
              o.dataset.seen = 'true';
              changed = true;
            }
          }
        }
      });
      if (changed) fixSeenLabels(msgsEl);
    });
  } catch(e) {}
}

// 1. Supabase realtime UPDATE (works if REPLICA IDENTITY FULL is set)
// 2. BroadcastChannel (works when both users are on same origin in different tabs/windows)
// 3. Polling every 3 seconds (universal fallback for real-time seen updates)
async function startSeenChannel(myUserId) {
  _seenMyUserId = myUserId;

  // Clean up any existing subscriptions
  if (_seenChannel) {
    try { await supabaseClient.removeChannel(_seenChannel); } catch(e) {}
    _seenChannel = null;
  }
  if (_seenBroadcast) {
    try { _seenBroadcast.close(); } catch(e) {}
    _seenBroadcast = null;
  }
  if (_seenPollInterval) {
    clearInterval(_seenPollInterval);
    _seenPollInterval = null;
  }

  // ── Mechanism 1: Supabase realtime UPDATE events ──
  _seenChannel = supabaseClient
    .channel(`seen-updates:${myUserId}`)
    .on('postgres_changes', {
      event: 'UPDATE',
      schema: 'public',
      table: 'messages'
      // No server-side filter — filter client-side to avoid REPLICA IDENTITY requirement
    }, (payload) => {
      const updated = payload.new;
      if (updated.sender_id !== myUserId) return;
      if (!updated.seen) return;
      applySeen(updated.id, myUserId);
    })
    .subscribe();

  // ── Mechanism 2: BroadcastChannel for instant cross-tab seen sync ──
  // When the receiver (in another tab/window on same origin) calls markConversationSeen,
  // it broadcasts the seen event so the sender tab updates immediately without DB roundtrip.
  try {
    _seenBroadcast = new BroadcastChannel('aloft-seen-updates');
    _seenBroadcast.onmessage = (e) => {
      const { type, receiverId, senderId, msgId } = e.data || {};
      if (type !== 'SEEN' || senderId !== myUserId) return;
      if (msgId) {
        applySeen(msgId, myUserId);
      } else {
        // No specific msgId — mark all rendered sent bubbles in this conversation
        const containers = ['fluxRelayMessages', 'fluxFsMessages']
          .map(id => document.getElementById(id))
          .filter(Boolean);
        containers.forEach(msgsEl => {
          msgsEl.querySelectorAll('.flux-msg-group.sent .flux-bubble-outer').forEach(o => {
            o.dataset.seen = 'true';
          });
          fixSeenLabels(msgsEl);
        });
      }
    };
  } catch(e) {
    // BroadcastChannel not supported (rare) — polling covers it
  }

  // ── Polling fallback REMOVED ──
  // This used to re-check seen-status every 3s as a fallback for when realtime
  // UPDATE events don't fire (missing REPLICA IDENTITY FULL). Removed per request —
  // adds up in egress for no real benefit here. Mechanisms 1 (realtime UPDATE) and
  // 2 (BroadcastChannel, for same-browser cross-tab sync) still run and cover the
  // normal case; the tab-focus/visibility one-shot calls to pollSeenStatus() also
  // still exist below as an extra one-time refresh, so seen-ticks still update,
  // just without a background timer constantly re-checking.
}

async function stopSeenChannel() {
  if (_seenChannel) {
    try { await supabaseClient.removeChannel(_seenChannel); } catch(e) {}
    _seenChannel = null;
  }
  if (_seenBroadcast) {
    try { _seenBroadcast.close(); } catch(e) {}
    _seenBroadcast = null;
  }
  if (_seenPollInterval) {
    clearInterval(_seenPollInterval);
    _seenPollInterval = null;
  }
  _seenMyUserId = null;
}

function showFluxListSkeleton() {
  const skeleton = `
    <div class="flux-conv-skeleton"><div class="flux-sk-avatar"></div><div class="flux-sk-lines"><div class="flux-sk-line long"></div><div class="flux-sk-line short"></div></div></div>
    <div class="flux-conv-skeleton"><div class="flux-sk-avatar"></div><div class="flux-sk-lines"><div class="flux-sk-line long"></div><div class="flux-sk-line short"></div></div></div>
    <div class="flux-conv-skeleton"><div class="flux-sk-avatar"></div><div class="flux-sk-lines"><div class="flux-sk-line long"></div><div class="flux-sk-line short"></div></div></div>
  `;
  const desktopList = document.getElementById('fluxConvList');
  const mobileList = document.getElementById('fluxFsConvList');
  if (desktopList) desktopList.innerHTML = skeleton;
  if (mobileList) mobileList.innerHTML = skeleton;
}

async function markConversationSeen(senderId) {
  try {
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) return;

    const { data: unseenMsgs } = await supabaseClient.from('messages')
      .select('id')
      .eq('sender_id', senderId)
      .eq('receiver_id', user.id)
      .eq('seen', false)
      .order('created_at', { ascending: false })
      .limit(1);

    const latestUnseenId = unseenMsgs && unseenMsgs.length > 0 ? unseenMsgs[0].id : null;

    await supabaseClient.from('messages')
      .update({ seen: true, seen_at: new Date().toISOString() })
      .eq('sender_id', senderId)
      .eq('receiver_id', user.id)
      .eq('seen', false);

    // ── Broadcast seen event via BroadcastChannel so sender tab updates instantly ──
    // This fires even when Supabase realtime UPDATE events don't (no REPLICA IDENTITY FULL needed)
    try {
      const bc = new BroadcastChannel('aloft-seen-updates');
      bc.postMessage({ type: 'SEEN', senderId: senderId, receiverId: user.id, msgId: latestUnseenId });
      bc.close();
    } catch(e) {}

    ['fluxRelayMessages', 'fluxFsMessages'].forEach(id => {
      const el = document.getElementById(id);
      if (el) fixSeenLabels(el);
    });
  } catch (e) {}
}

async function openFLUX() {
  fluxOpen = true;
  if (isMobile()) {
    document.getElementById('fluxFullscreen').classList.add('show');
    document.getElementById('fluxFsListView').style.display = 'flex';
    document.getElementById('fluxFsRelayView').style.display = 'none';
  } else {
    document.getElementById('fluxOverlay').classList.add('show');
    showFluxEmptyState();
  }
  _startLoadBar('fluxSidebarLoadBar', 'fluxSidebarLoadFill');
  _startLoadBar('fluxFsSidebarLoadBar', 'fluxFsSidebarLoadFill');
  showFluxListSkeleton();
  await joinPresence();
  try {
    await loadContacts();
    await preloadAllRelays();
  } catch (e) {
    buildFLUXConvList();
  }
  _finishLoadBar('fluxSidebarLoadBar', 'fluxSidebarLoadFill');
  _finishLoadBar('fluxFsSidebarLoadBar', 'fluxFsSidebarLoadFill');
  if (typeof _updateTitleUnreadBadge === 'function') _updateTitleUnreadBadge();
  try {
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (user) {
      const globalCh = supabaseClient.channel(`global-inbox:${user.id}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages',
          filter: `receiver_id=eq.${user.id}` }, (payload) => {
          if (!fluxOpen) return; // panel closed — ignore all incoming events
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
      // Store so we can remove on close
      window._fluxGlobalChannel = globalCh;
      // Postgres realtime filters only support a single eq per subscription,
      // so group inbox updates (any group I'm a member of) can't be
      // server-filtered the way DMs are above — listen unfiltered and check
      // membership client-side against _fluxMyGroupIds instead.
      const globalGroupCh = supabaseClient.channel(`global-inbox-groups:${user.id}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload) => {
          if (!fluxOpen) return;
          const msg = payload.new;
          if (!msg.group_id || !_fluxMyGroupIds.has(msg.group_id)) return;
          if (msg.sender_id === user.id) return; // my own send is handled optimistically already
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
      // ── GLOBAL TYPING SIDEBAR ──
      // Each user broadcasts to `typing-notify:{recipientId}` so we only need one channel here.
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
              // Otherwise just restore the sidebar preview
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
      const relayClearedCh = supabaseClient.channel(`relay-cleared:${user.id}`, {
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
      // Start the persistent seen-updates channel for this user
      await startSeenChannel(user.id);
    }
  } catch(e) {}
}

async function closeFLUX() {
  fluxOpen = false; // set first so any in-flight realtime callbacks are gated out immediately
  // Wipe auth flags unconditionally — no path should leave these true after close
  vaultAuthenticated = false;
  _vaultSessionValid = false;
  _dismissVaultOverlay();

  stopTypingBroadcast();

  // ── Everything below closes the panel SYNCHRONOUSLY, with no awaits ──
  // This must stay await-free. Background tabs throttle network/websocket
  // activity, so if the visual close waited on an awaited call (like the
  // old leavePresence()/removeChannel() chain below), ghost mode would only
  // finish closing once that call resolved — which the browser delays until
  // the tab is refocused. That produced exactly the bug this fixes: the
  // panel staying open while the tab was switched away, then closing a few
  // seconds after coming back instead of closing the instant focus was lost.
  activeFluxId = null;
  if (typeof fluxContacts !== 'undefined') { fluxContacts.length = 0; }
  // Wipe the RENDERED DOM too — hiding the overlay with a CSS class still
  // inspectable via devtools even while the panel is visually closed.
  ['fluxConvList', 'fluxFsConvList'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = '';
  });
  ['fluxRelayMessages', 'fluxFsMessages'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = '';
  });
  const _profileTabName = document.getElementById('fluxProfileTabName');
  const _profileTabUsername = document.getElementById('fluxProfileTabUsername');
  const _profileTabAvatar = document.getElementById('fluxProfileTabAvatar');
  if (_profileTabName) _profileTabName.textContent = 'User';
  if (_profileTabUsername) _profileTabUsername.textContent = 'username';
  if (_profileTabAvatar) _profileTabAvatar.innerHTML = '';
  activeFluxProfileTarget = null;
  activeFluxNickname = null;
  fluxDesktopContact = null;
  fluxMobileContact = null;
  // Reset title immediately — no notifications when panel is closed
  document.title = "Hether - Code n' Arcade ";
  document.getElementById('fluxOverlay').classList.remove('show');
  document.getElementById('fluxFullscreen').classList.remove('show');
  document.getElementById('fluxProfileTab')?.classList.remove('show');
  // Reset AI panel
  _fluxAiOpen = false;
  _fluxAiHistory = [];
  const _fluxAiMsgs = document.getElementById('fluxAiMessages');
  if (_fluxAiMsgs) _fluxAiMsgs.innerHTML = '';
  const _aiPanel = document.getElementById('fluxAiPanel');
  if (_aiPanel) _aiPanel.classList.remove('show');
  const _aiBtn = document.getElementById('fluxAiToggleBtn');
  if (_aiBtn) _aiBtn.classList.remove('active');
  const _relayPanel = document.getElementById('fluxRelayPanel');
  if (_relayPanel) _relayPanel.style.display = '';
  closeMsgActionMenu(); hideRemoteTyping(); resetPresenceDots();

  // ── Async network/channel teardown — fire-and-forget, runs in the
  // background so it can never delay the visual close above. ──
  (async () => {
    try {
      await leavePresence();
      unwatchAllPresence();
      if (typingChannel) { await supabaseClient.removeChannel(typingChannel); typingChannel = null; }
      if (window._fluxGlobalChannel) { await supabaseClient.removeChannel(window._fluxGlobalChannel); window._fluxGlobalChannel = null; }
      if (window._fluxGlobalGroupChannel) { await supabaseClient.removeChannel(window._fluxGlobalGroupChannel); window._fluxGlobalGroupChannel = null; }
      if (window._fluxGlobalTypingChannel) { await supabaseClient.removeChannel(window._fluxGlobalTypingChannel); window._fluxGlobalTypingChannel = null; }
      if (window._fluxRelayClearedChannel) { await supabaseClient.removeChannel(window._fluxRelayClearedChannel); window._fluxRelayClearedChannel = null; }
      await stopSeenChannel();
      await subscriptionManager.replaceSubscription(null);
    } catch (e) {
      // Best-effort cleanup — a dropped connection here shouldn't surface to the user
    }
  })();
}

function fluxOverlayClick(e) { if (e.target === document.getElementById('fluxOverlay')) closeFLUX(); }

let _fluxAiOpen = false;
let _fluxAiHistory = [];
let _fluxAiTyping = false;

function newFluxAiRelay() {
  _fluxAiHistory = [];
  const container = document.getElementById('fluxAiMessages');
  if (container) container.innerHTML = '';
  _appendFluxAiMsg('ai', 'Hi! I\'m hetherGPT. How can I help you?');
}

function toggleFluxAiPanel() {
  _fluxAiOpen = !_fluxAiOpen;
  const panel = document.getElementById('fluxAiPanel');
  const relayPanel = document.getElementById('fluxRelayPanel');
  const profileTab = document.getElementById('fluxProfileTab');
  const btn = document.getElementById('fluxAiToggleBtn');
  if (_fluxAiOpen) {
    panel.classList.add('show');
    relayPanel.style.display = 'none';
    if (profileTab) profileTab.classList.remove('show');
    btn.classList.add('active');
    // Greet on first open
    if (_fluxAiHistory.length === 0) {
      _appendFluxAiMsg('ai', 'Hi! I\'m hetherGPT. How can I help you?');
    }
    setTimeout(() => {
      const inp = document.getElementById('fluxAiInput');
      if (inp) inp.focus();
    }, 80);
  } else {
    panel.classList.remove('show');
    relayPanel.style.display = '';
    btn.classList.remove('active');
  }
}

function _appendFluxAiMsg(role, text) {
  const container = document.getElementById('fluxAiMessages');
  if (!container) return;
  const wrap = document.createElement('div');
  wrap.className = `flux-ai-msg ${role}`;
  const av = document.createElement('div');
  av.className = `flux-ai-avatar${role === 'user' ? ' user-av' : ''}`;
  av.textContent = role === 'ai' ? 'AI' : '';
  if (role === 'user') {
    // Use profile avatar if available
    if (typeof profile !== 'undefined' && profile.avatarUrl) {
      av.innerHTML = `<img src="${profile.avatarUrl}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`;
    } else {
      av.innerHTML = typeof DEFAULT_AVATAR_SVG !== 'undefined' ? DEFAULT_AVATAR_SVG : '';
    }
  }
  const bubble = document.createElement('div');
  bubble.className = 'flux-ai-bubble';
  bubble.innerHTML = typeof formatText === 'function' ? formatText(text) : text.replace(/\n/g, '<br>');
  wrap.appendChild(av);
  wrap.appendChild(bubble);
  container.appendChild(wrap);
  container.scrollTop = container.scrollHeight;
  return wrap;
}

function _removeFluxAiTyping(el) {
  if (el && el.parentNode) el.parentNode.removeChild(el);
}

function _appendFluxAiTyping() {
  const container = document.getElementById('fluxAiMessages');
  if (!container) return null;
  const wrap = document.createElement('div');
  wrap.className = 'flux-ai-msg ai';
  const av = document.createElement('div');
  av.className = 'flux-ai-avatar';
  av.textContent = 'AI';
  const bubble = document.createElement('div');
  bubble.className = 'flux-ai-bubble';
  bubble.innerHTML = '<div class="flux-ai-typing"><span></span><span></span><span></span></div>';
  wrap.appendChild(av);
  wrap.appendChild(bubble);
  container.appendChild(wrap);
  container.scrollTop = container.scrollHeight;
  return wrap;
}

async function sendFluxAiMessage() {
  const input = document.getElementById('fluxAiInput');
  const btn = document.getElementById('fluxAiSendBtn');
  if (!input) return;
  const text = input.value.trim();
  if (!text || _fluxAiTyping) return;
  _appendFluxAiMsg('user', text);
  _fluxAiHistory.push({ role: 'user', content: text });
  input.value = '';
  input.style.height = 'auto';
  btn.disabled = true;
  _fluxAiTyping = true;
  const typingEl = _appendFluxAiTyping();
  try {
    const reply = await geminiChat(_fluxAiHistory);
    _removeFluxAiTyping(typingEl);
    _appendFluxAiMsg('ai', reply);
    _fluxAiHistory.push({ role: 'ai', content: reply });
  } catch (err) {
    _removeFluxAiTyping(typingEl);
    _appendFluxAiMsg('ai', `Error: ${err.message}`);
  }
  _fluxAiTyping = false;
  btn.disabled = false;
}

function fluxAiHandleKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendFluxAiMessage(); }
}

function autoResizeFluxAi(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 120) + 'px';
}

// ── AI COMPANION POPUP ──
let _companionOpen = false;
let _companionHistory = [];
let _companionTyping = false;

function toggleCompanion() {
  _companionOpen ? closeCompanion() : openCompanion();
}

function openCompanion() {
  _companionOpen = true;
  const popup = document.getElementById('companionPopup');
  const btn = document.getElementById('companionBtn');
  popup.classList.add('show');
  btn.classList.add('active');
  btn.style.color = 'var(--accent)';
  if (_companionHistory.length === 0) {
    _appendCompanionMsg('ai', 'Hi! I\'m Hether AI. How can I help you today?');
  }
  setTimeout(() => {
    const inp = document.getElementById('companionInput');
    if (inp) inp.focus();
  }, 80);
}

function closeCompanion() {
  _companionOpen = false;
  const popup = document.getElementById('companionPopup');
  const btn = document.getElementById('companionBtn');
  popup.classList.remove('show');
  btn.classList.remove('active');
  btn.style.color = 'var(--text3)';
}

function _appendCompanionMsg(role, text) {
  const container = document.getElementById('companionMessages');
  if (!container) return;
  const wrap = document.createElement('div');
  wrap.className = `companion-msg ${role}`;
  const av = document.createElement('div');
  av.className = `companion-avatar${role === 'user' ? ' user-av' : ''}`;
  if (role === 'ai') {
    av.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/></svg>';
  } else {
    if (typeof profile !== 'undefined' && profile.avatarUrl) {
      av.innerHTML = `<img src="${profile.avatarUrl}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`;
    } else {
      av.innerHTML = typeof DEFAULT_AVATAR_SVG !== 'undefined' ? DEFAULT_AVATAR_SVG : '';
    }
  }
  const bubble = document.createElement('div');
  bubble.className = 'companion-bubble';
  bubble.innerHTML = typeof formatText === 'function' ? formatText(text) : text.replace(/\n/g, '<br>');
  wrap.appendChild(av);
  wrap.appendChild(bubble);
  container.appendChild(wrap);
  container.scrollTop = container.scrollHeight;
  return wrap;
}

function _appendCompanionTyping() {
  const container = document.getElementById('companionMessages');
  if (!container) return null;
  const wrap = document.createElement('div');
  wrap.className = 'companion-msg ai';
  const av = document.createElement('div');
  av.className = 'companion-avatar';
  av.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/></svg>';
  const bubble = document.createElement('div');
  bubble.className = 'companion-bubble';
  bubble.innerHTML = '<div class="companion-typing"><span></span><span></span><span></span></div>';
  wrap.appendChild(av);
  wrap.appendChild(bubble);
  container.appendChild(wrap);
  container.scrollTop = container.scrollHeight;
  return wrap;
}

async function sendCompanionMessage() {
  const input = document.getElementById('companionInput');
  const btn = document.getElementById('companionSendBtn');
  if (!input) return;
  const text = input.value.trim();
  if (!text || _companionTyping) return;
  _appendCompanionMsg('user', text);
  _companionHistory.push({ role: 'user', content: text });
  input.value = '';
  input.style.height = 'auto';
  btn.disabled = true;
  _companionTyping = true;
  const typingEl = _appendCompanionTyping();
  try {
    const reply = await geminiChat(_companionHistory);
    if (typingEl && typingEl.parentNode) typingEl.parentNode.removeChild(typingEl);
    _appendCompanionMsg('ai', reply);
    _companionHistory.push({ role: 'ai', content: reply });
  } catch (err) {
    if (typingEl && typingEl.parentNode) typingEl.parentNode.removeChild(typingEl);
    _appendCompanionMsg('ai', `Error: ${err.message}`);
  }
  _companionTyping = false;
  btn.disabled = false;
}

function companionHandleKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendCompanionMessage(); }
  if (e.key === 'Escape') { closeCompanion(); }
}

function autoResizeCompanion(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 100) + 'px';
}



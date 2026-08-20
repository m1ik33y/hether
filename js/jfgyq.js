let vaultAuthenticated = false;
let currentView = 'explore';
let isTyping = false;
let relayHistory = [];
let fluxOpen = false;
let sidebarMini = false;
const isMobile = () => window.innerWidth <= 640;

const fluxContacts = [];
const fluxCategories = new Map();
const fluxMuted = new Map();
const fluxPinned = new Map();
const fluxArchived = new Map();
const fluxDeletedBefore = new Map(); // contactId -> ms epoch cutoff, from "Delete for me"
let fluxActiveTab = 'primary';
let _fluxMyUserId = null;
let activeFluxId = null;
let activeFluxProfileTarget = null;
let activeFluxNickname = null;
let _fluxLoadToken = 0;
let replyingTo = null;

// ── Group-chat aware message helpers ──────────────────────────────────────
// Groups carry their messages via messages.group_id instead of the DM
// sender_id/receiver_id pair. These two helpers are the single source of
// truth for "does this message belong to this conversation" so every read
// path (initial load, pagination, realtime, reply-jump, etc.) treats groups
// and DMs consistently instead of re-deriving the filter in each place.
let _fluxMyGroupIds = new Set();

function _fluxConvIsGroup(convId) {
  const c = fluxContacts.find(x => x.id === convId);
  return !!(c && c.isGroup) || _fluxMyGroupIds.has(convId);
}

// chat_categories is polymorphic: a DM row sets contact_id (FK -> profiles) and
// leaves group_id null; a group row sets group_id (FK -> flux_groups) and leaves
// contact_id null (see chat_categories_contact_xor_group). Everywhere else in the
// app a "conversation id" is used as one unified key (DM id or group id) in the
// local fluxCategories/fluxMuted/fluxPinned/fluxArchived/fluxDeletedBefore Maps;
// these two helpers translate that unified id into the right DB column and
// upsert target so writes hit the correct FK/unique constraint.
function _fluxCatRowKey(convId) {
  return _fluxConvIsGroup(convId)
    ? { contact_id: null, group_id: convId }
    : { contact_id: convId, group_id: null };
}
function _fluxCatOnConflict(convId) {
  return _fluxConvIsGroup(convId) ? 'owner_id,group_id' : 'owner_id,contact_id';
}

// Posts a system message into a conversation, following the same pattern
// already used for nickname changes and DM theme changes (messages row with
// message_type: 'system'). Routes to group_id or receiver_id depending on
// whether convId is a group or a DM, same split as normal message sends.
async function _fluxPostSystemMessage(convId, text) {
  if (!convId || !text) return;
  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) return;
  const isGroup = _fluxConvIsGroup(convId);
  const { error } = await supabaseClient.from('messages').insert({
    sender_id: user.id,
    receiver_id: isGroup ? null : convId,
    group_id: isGroup ? convId : null,
    content: text,
    message_type: 'system'
  });
  if (error) console.warn('[FLUX] system message post failed:', error.message);
}

// "A" / "A and B" / "A, B, and C" — used for "X added A, B, and C." style
// system messages.
function _fluxJoinNames(names) {
  const list = (names || []).filter(Boolean);
  if (list.length <= 1) return list[0] || '';
  if (list.length === 2) return `${list[0]} and ${list[1]}`;
  return `${list.slice(0, -1).join(', ')}, and ${list[list.length - 1]}`;
}

// Applies the correct filter to a Supabase query builder for a given
// conversation. `q` must be a builder that still supports .eq/.or (i.e.
// call this before .order()/.range()/.single()).
function _fluxApplyConvFilter(q, convId, myId, isGroup) {
  return isGroup
    ? q.eq('group_id', convId)
    : q.or(`and(sender_id.eq.${myId},receiver_id.eq.${convId}),and(sender_id.eq.${convId},receiver_id.eq.${myId})`);
}

// Client-side equivalent, used inside realtime callbacks where we already
// have the row and just need to know if it belongs to the open conversation.
function _fluxMsgBelongsToConv(msg, convId, myId, isGroup) {
  return isGroup
    ? msg.group_id === convId
    : ((msg.sender_id === myId && msg.receiver_id === convId) || (msg.sender_id === convId && msg.receiver_id === myId));
}

let fluxStagedMedia = null;
let fluxFsStagedMedia = null;
let aiStagedMedia = null;

const renderedMsgIds = new Set();

let _clearingRelayForUserId = null; // set during bulk clear to suppress per-delete re-renders

let profile = JSON.parse(localStorage.getItem('aloft_profile') || 'null') || {
  name: 'User', username: '@user', email: 'user@example.com', avatarUrl: null
};

// ── MSG ACTION MENU ──
let _actionMenuOpen = false;

function showMsgActionMenu(e, bWrap, msg, isSent) {
  e.stopPropagation();
  const menu = document.getElementById('fluxMsgActionMenu');
  menu.innerHTML = '';
  const text = bWrap.dataset.text || '';

  const copyBtn = document.createElement('button');
  copyBtn.className = 'flux-msg-action-item';
  copyBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copy`;
  copyBtn.onclick = (ev) => { ev.stopPropagation(); if (text) navigator.clipboard.writeText(text).catch(() => {}); closeMsgActionMenu(); };
  menu.appendChild(copyBtn);

  if (isSent && msg && msg.id) {
    if (bWrap.dataset.text && bWrap.dataset.text.trim()) {
      const editBtn = document.createElement('button');
      editBtn.className = 'flux-msg-action-item';
      editBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> Edit`;
      editBtn.onclick = (ev) => { ev.stopPropagation(); closeMsgActionMenu(); editMessage(msg.id, bWrap); };
      menu.appendChild(editBtn);
    }
    const unsendBtn = document.createElement('button');
    unsendBtn.className = 'flux-msg-action-item danger';
    unsendBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg> Unsend`;
    unsendBtn.onclick = async (ev) => { ev.stopPropagation(); closeMsgActionMenu(); await unsendMessage(msg.id); };
    menu.appendChild(unsendBtn);
  }

  const btn = e.currentTarget || e.target;
  const rect = btn.getBoundingClientRect ? btn.getBoundingClientRect() : { left: e.clientX, top: e.clientY, width: 0, height: 0 };
  let left = rect.left;
  menu.style.display = 'block';
  menu.classList.add('show');
  _actionMenuOpen = true;
  requestAnimationFrame(() => {
    const mw = menu.offsetWidth, mh = menu.offsetHeight;
    if (left + mw > window.innerWidth - 8) left = window.innerWidth - mw - 8;
    if (left < 8) left = 8;
    let top = rect.top - mh - 4;
    if (top < 8) top = rect.bottom + 4;
    menu.style.left = left + 'px';
    menu.style.top = top + 'px';
  });
}

function closeMsgActionMenu() {
  const menu = document.getElementById('fluxMsgActionMenu');
  menu.classList.remove('show'); menu.style.display = 'none'; _actionMenuOpen = false;
}

async function unsendMessage(msgId) {
  const { error } = await supabaseClient.from('messages').delete().eq('id', msgId);
  if (error) alert('Failed to unsend message: ' + error.message);
}

// ── PER-CONVERSATION MENU (Clear / Move / Mute) ──
let _convMenuOpen = false;
let _convMenuActiveItem = null;

function openFluxConvMenu(e, contactId) {
  e.stopPropagation();
  const menu = document.getElementById('fluxConvMenu');
  const currentCategory = _fluxCategoryOf(contactId);
  const isMuted = _fluxMutedOf(contactId);
  const isPinned = _fluxPinnedOf(contactId);
  const isArchived = _fluxArchivedOf(contactId);
  const isGroupConv = _fluxConvIsGroup(contactId);
  menu.innerHTML = '';

  const makeItem = (label, iconPath, onClick, opts) => {
    opts = opts || {};
    const btn = document.createElement('button');
    btn.className = 'flux-conv-menu-item' + (opts.danger ? ' danger' : '');
    btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${iconPath}</svg> ${label}`;
    btn.onclick = (ev) => { ev.stopPropagation(); closeFluxConvMenu(); onClick(); };
    return btn;
  };

  // Group conversations can't spawn another group from themselves, so this
  // only makes sense for DMs.
  if (!isGroupConv) {
    // Start a group with this DM participant already selected.
    menu.appendChild(makeItem('Add group',
      '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><path d="M16 3.128a4 4 0 0 1 0 7.744"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><circle cx="9" cy="7" r="4"/>',
      () => openFluxCreateGroup(contactId)));
  }

  // Move to the other category — only one direction shown at a time,
  // matching wherever the conversation currently lives.
  if (currentCategory === 'primary') {
    menu.appendChild(makeItem('Move to General',
      '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M3 10h18"/>',
      () => moveFluxContact(contactId, 'general')));
  } else {
    menu.appendChild(makeItem('Move to Primary',
      '<path d="m3 11 18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/>',
      () => moveFluxContact(contactId, 'primary')));
  }

  // Mute / unmute — silences the notification sound for this person only.
  menu.appendChild(makeItem(isMuted ? 'Unmute' : 'Mute',
    isMuted
      ? '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>'
      : '<path d="M8.7 3A6 6 0 0 1 18 8c0 2.1.8 3.9 1.6 5.2"/><path d="M17 17H3s3-2 3-9c0-.7.1-1.4.3-2"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/><path d="m2 2 20 20"/>',
    () => toggleFluxMute(contactId)));

  // Pin / unpin — pinned conversations always sort to the top of the list.
  menu.appendChild(makeItem(isPinned ? 'Unpin' : 'Pin',
    isPinned
      ? '<path d="M12 17v5"/><path d="M15 9.34V6a1 1 0 0 1 1-1 2 2 0 0 0 0-4H9.31"/><path d="M16.13 16.13A2 2 0 0 1 15 17H5a1 1 0 0 1-.71-1.71l.87-.87A2 2 0 0 0 6 13.03V10a1 1 0 0 1 .61-.92"/><line x1="2" x2="22" y1="2" y2="22"/>'
      : '<path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/>',
    () => toggleFluxPin(contactId)));

  menu.appendChild(makeItem(isArchived ? 'Unarchive' : 'Archive',
    '<path d="M21 8v13H3V8"/><rect x="1" y="3" width="22" height="5" rx="1"/><path d="M10 12h4"/>',
    () => toggleFluxArchive(contactId)));

  if (isGroupConv) {
    // Owner, admin, and regular members all use the same Exit group action.
    // The confirmation decides whether the owner deletes the group or a
    // non-owner only removes their own membership.
    menu.appendChild(makeItem('Exit group',
      '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/>',
      () => openDeleteGroupConfirm(contactId), { danger: true }));
  } else {
    menu.appendChild(makeItem('Clear all',
      '<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>',
      () => openClearRelayConfirm(contactId)));
  }

  const btn = e.currentTarget || e.target;
  const rect = btn.getBoundingClientRect ? btn.getBoundingClientRect() : { left: e.clientX, top: e.clientY, width: 0, height: 0 };
  menu.style.display = 'block';
  menu.classList.add('show');
  _convMenuOpen = true;

  // Keep the chevron visible on its row while the menu is open, even if the
  // mouse leaves that row.
  const item = btn.closest ? btn.closest('.flux-conv-item') : null;
  if (_convMenuActiveItem && _convMenuActiveItem !== item) _convMenuActiveItem.classList.remove('menu-open');
  if (item) item.classList.add('menu-open');
  _convMenuActiveItem = item;

  requestAnimationFrame(() => {
    const mw = menu.offsetWidth, mh = menu.offsetHeight;
    let left = rect.left - mw + rect.width;
    if (left < 8) left = 8;
    if (left + mw > window.innerWidth - 8) left = window.innerWidth - mw - 8;
    let top = rect.bottom + 4;
    if (top + mh > window.innerHeight - 8) top = rect.top - mh - 4;
    menu.style.left = left + 'px';
    menu.style.top = top + 'px';
  });
}

function closeFluxConvMenu() {
  const menu = document.getElementById('fluxConvMenu');
  if (!menu) return;
  menu.classList.remove('show'); menu.style.display = 'none'; _convMenuOpen = false;
  if (_convMenuActiveItem) { _convMenuActiveItem.classList.remove('menu-open'); _convMenuActiveItem = null; }
}

document.addEventListener('click', (e) => {
  if (_convMenuOpen && !document.getElementById('fluxConvMenu').contains(e.target) && !e.target.closest('.flux-conv-menu-btn')) closeFluxConvMenu();
});

// ── CHAT HEADER MORE MENU (groups + DMs) ──
let _headerMoreMenuOpen = false;

async function openFluxHeaderMoreMenu(e) {
  e.stopPropagation();
  const id = activeFluxId;
  if (!id) return;

  const menu = document.getElementById('fluxHeaderMoreMenu');
  if (!menu) return;

  const isGroup = _fluxConvIsGroup(id);
  const isMuted = _fluxMutedOf(id);
  const isArchived = _fluxArchivedOf(id);
  const contact = fluxContacts.find(c => c.id === id);
  const isGroupOwner = isGroup && !!contact && contact.ownerId === _fluxMyUserId;

  // Resolve the viewer's current group role. Prefer the already-loaded
  // group-info permissions, but fetch membership when they are stale/missing.
  let isGroupAdmin = isGroupOwner;
  if (isGroup && !isGroupAdmin) {
    if (_fluxGroupInfoPerms?.groupId === id) {
      isGroupAdmin = !!_fluxGroupInfoPerms.viewerIsAdmin;
    } else {
      try {
        const members = await _fluxFetchGroupMembers(id);
        const me = members.find(m => m.id === _fluxMyUserId);
        isGroupAdmin = !!me && (me.role === 'admin' || me.role === 'owner');
      } catch (_) {
        isGroupAdmin = false;
      }
    }
  }

  menu.innerHTML = '';

  const makeItem = (label, iconPath, onClick, opts) => {
    opts = opts || {};
    const btn = document.createElement('button');
    btn.className = 'flux-conv-menu-item' + (opts.danger ? ' danger' : '');
    btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${iconPath}</svg> ${label}`;
    btn.onclick = (ev) => {
      ev.stopPropagation();
      closeFluxHeaderMoreMenu();
      onClick();
    };
    return btn;
  };

  const infoIcon = '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>';
  const trashIcon = '<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>';
  const archiveIcon = '<path d="M21 8v13H3V8"/><rect x="1" y="3" width="22" height="5" rx="1"/><path d="M10 12h4"/>';
  const muteIcon = isMuted
    ? '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>'
    : '<path d="M8.7 3A6 6 0 0 1 18 8c0 2.1.8 3.9 1.6 5.2"/><path d="M17 17H3s3-2 3-9c0-.7.1-1.4.3-2"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/><path d="m2 2 20 20"/>';
  const clearIcon = '<path d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 6 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z"/><line x1="15" x2="9" y1="9" y2="15"/><line x1="9" x2="15" y1="15" y2="9"/>';
  const exitIcon = '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/>';

  if (isGroup) {
    menu.appendChild(makeItem('Add member',
      '<path d="M2 21a8 8 0 0 1 13.292-6"/><circle cx="10" cy="8" r="5"/><path d="M19 16v6"/><path d="M22 19h-6"/>',
      () => openAddMembersToGroup(id)));

    menu.appendChild(makeItem('Group info', infoIcon, () => openNicknamePanel()));

    // Non-admin group members must never receive a group-wide clear/delete
    // action. They only get "Delete for me".
    menu.appendChild(makeItem('Delete for me', trashIcon,
      () => openDeleteForMeConfirm(id)));

    // Only admins/owners can perform the group-wide deletion.
    if (isGroupAdmin) {
      menu.appendChild(makeItem('Delete for all', trashIcon,
        () => openDeleteGroupConfirm(id), { danger: true }));
    }
  } else {
    menu.appendChild(makeItem('Profile info', infoIcon, () => openNicknamePanel()));

    menu.appendChild(makeItem(isArchived ? 'Unarchive' : 'Archive', archiveIcon,
      () => toggleFluxArchive(id)));

    menu.appendChild(makeItem(isMuted ? 'Unmute' : 'Mute', muteIcon,
      () => toggleFluxMute(id)));

    // Keep both clear actions together at the bottom.
    const clearForMeItem = makeItem('Clear for me', clearIcon,
      () => openClearForMeConfirm(id), { danger: true });
    clearForMeItem.style.marginTop = '4px';
    clearForMeItem.style.borderTop = '1px solid var(--border)';
    menu.appendChild(clearForMeItem);

    menu.appendChild(makeItem('Clear all', clearIcon,
      () => openClearRelayConfirm(id), { danger: true }));
  }

  const btn = e.currentTarget || e.target;
  const rect = btn.getBoundingClientRect
    ? btn.getBoundingClientRect()
    : { left: e.clientX, top: e.clientY, width: 0, height: 0 };

  menu.style.display = 'block';
  menu.classList.add('show');
  _headerMoreMenuOpen = true;

  requestAnimationFrame(() => {
    const mw = menu.offsetWidth, mh = menu.offsetHeight;
    let left = rect.left;
    if (left + mw > window.innerWidth - 8) left = window.innerWidth - mw - 8;
    if (left < 8) left = 8;
    let top = rect.bottom + 4;
    if (top + mh > window.innerHeight - 8) top = rect.top - mh - 4;
    menu.style.left = left + 'px';
    menu.style.top = top + 'px';
  });
}

function closeFluxHeaderMoreMenu() {
  const menu = document.getElementById('fluxHeaderMoreMenu');
  if (!menu) return;
  menu.classList.remove('show');
  menu.style.display = 'none';
  _headerMoreMenuOpen = false;
}

document.addEventListener('click', (e) => {
  if (
    _headerMoreMenuOpen &&
    !document.getElementById('fluxHeaderMoreMenu').contains(e.target) &&
    !e.target.closest('#fluxHeaderMoreBtn') &&
    !e.target.closest('#fluxFsHeaderMoreBtn')
  ) closeFluxHeaderMoreMenu();
});

async function moveFluxContact(contactId, category) {
  const ownerId = _fluxMyUserId || (await supabaseClient.auth.getUser()).data?.user?.id;
  if (!ownerId) return;

  const previousCategory = _fluxCategoryOf(contactId);

  // Optimistic local update so the row jumps tabs immediately
  fluxCategories.set(contactId, category);
  buildFLUXConvList();

  const { error } = await supabaseClient
    .from('chat_categories')
    .upsert(
      { owner_id: ownerId, ..._fluxCatRowKey(contactId), category, muted: _fluxMutedOf(contactId), pinned: _fluxPinnedOf(contactId), updated_at: new Date().toISOString() },
      { onConflict: _fluxCatOnConflict(contactId) }
    );

  if (error) {
    console.error('Failed to move conversation:', error.message);
    // Roll back on failure
    fluxCategories.set(contactId, previousCategory);
    buildFLUXConvList();
    alert('Could not move the conversation. Please try again.');
  }
}

// Tracks current edit state: { msgId, bWrap, mode }
let currentEditState = null;

function editMessage(msgId, bWrap) {
  const currentText = bWrap.dataset.text || '';
  const mode = isMobile() ? 'mobile' : 'desktop';

  // Cancel any existing reply when entering edit mode
  cancelReply(mode);

  // Store edit state
  currentEditState = { msgId, bWrap, mode };

  const inputEl = document.getElementById(mode === 'mobile' ? 'fluxFsInput' : 'fluxInput');
  if (inputEl) {
    inputEl.value = currentText;
    inputEl.style.height = 'auto';
    inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + 'px';
    if (mode === 'mobile') toggleFluxFsSendBtn(); else toggleFluxSendBtn();
    inputEl.focus();
    inputEl.selectionStart = inputEl.selectionEnd = inputEl.value.length;
  }

  // Show edit bar with preview of current text
  const preview = currentText.length > 60 ? currentText.slice(0, 60) + '…' : currentText;
  const desktopBar = document.getElementById('fluxEditBar');
  const desktopBarText = document.getElementById('fluxEditBarText');
  if (desktopBar && desktopBarText) { desktopBarText.textContent = preview; desktopBar.classList.add('show'); }
  const mobileBar = document.getElementById('fluxFsEditBar');
  const mobileBarText = document.getElementById('fluxFsEditBarText');
  if (mobileBar && mobileBarText) { mobileBarText.textContent = preview; mobileBar.classList.add('show'); }
}

function cancelEdit(mode) {
  currentEditState = null;
  const inputEl = document.getElementById(mode === 'mobile' ? 'fluxFsInput' : 'fluxInput');
  if (inputEl) { inputEl.value = ''; inputEl.style.height = 'auto'; }
  if (mode === 'mobile') toggleFluxFsSendBtn(); else toggleFluxSendBtn();
  document.getElementById('fluxEditBar')?.classList.remove('show');
  document.getElementById('fluxFsEditBar')?.classList.remove('show');
}

async function commitEdit(newText) {
  if (!currentEditState) return;
  const { msgId, bWrap, mode } = currentEditState;
  if (!newText) { cancelEdit(mode); return; }

  // Clear edit state & bars
  cancelEdit(mode);

  // Optimistic update — reflect in UI immediately
  applyEditToBubble(bWrap, newText, true);

  // UPDATE the row in Supabase (content + edited flag)
  const { error } = await supabaseClient
    .from('messages')
    .update({ content: newText, edited: true })
    .eq('id', msgId);

  if (error) {
    console.error('Edit failed:', error.message);
    return;
  }

  // Broadcast the edit instantly over the typing channel so the other
  // user's UI updates in real time without waiting for DB replication.
  const { data: { user } } = await supabaseClient.auth.getUser();
  if (user && typingChannel && typingChannel.state === 'joined') {
    typingChannel.send({
      type: 'broadcast',
      event: 'msg_edit',
      payload: { msgId, content: newText, senderId: user.id }
    });
  }
}

// Patch a bubble's text content in place (used by sender optimistic + receiver realtime)
function applyEditToBubble(bWrap, newText, isSent) {
  const bubble = bWrap.querySelector('.flux-bubble');
  if (!bubble) return;

  // Remove old text node (preserve reply-preview and media)
  Array.from(bubble.childNodes).forEach(n => {
    if (n.nodeType === 1 && !n.classList.contains('flux-reply-preview') &&
        !n.tagName.match(/^(IMG|VIDEO)$/i) && !n.classList.contains('flux-sending-icon')) {
      n.remove();
    }
  });

  const textDiv = document.createElement('div');
  textDiv.textContent = newText;
  bubble.appendChild(textDiv);

  // Add or update the external edited tag on bOuter (above the bubble)
  const bOuter = bWrap.closest('.flux-bubble-outer') || bWrap.parentElement;
  if (bOuter) {
    let editedTag = bOuter.querySelector('.flux-edited-tag');
    if (!editedTag) {
      editedTag = document.createElement('div');
      editedTag.className = 'flux-edited-tag';
      editedTag.textContent = 'edited';
      bOuter.insertBefore(editedTag, bWrap);
    }
  }

  // Update dataset so copy/reply use new text
  bWrap.dataset.text = newText;
}

document.addEventListener('click', (e) => {
  if (_actionMenuOpen && !document.getElementById('fluxMsgActionMenu').contains(e.target)) closeMsgActionMenu();
});

// ── CONFIRM DIALOG ──
let _confirmCallback = null;
function showConfirm(title, msg, okLabel, callback) {
  document.getElementById('confirmTitle').textContent = title;
  document.getElementById('confirmMsg').textContent = msg;
  document.getElementById('confirmOkBtn').textContent = okLabel || 'Confirm';
  _confirmCallback = callback;
  document.getElementById('confirmOverlay').classList.add('show');
}
function closeConfirm() { document.getElementById('confirmOverlay').classList.remove('show'); _confirmCallback = null; }
function confirmAction() {
  const cb = _confirmCallback;
  closeConfirm();
  if (cb) cb();
}

// ── DOWNLOAD (desktop only) ──
// Always resolves to whatever release is currently marked "Latest" on GitHub,
// regardless of tag name — no need to update this URL on future releases.
const HETHER_INSTALLER_URL = 'https://github.com/m1ik33y/hether/releases/latest/download/Hether.Setup.exe';
function handleDownloadClick() {
  if (isMobile()) return; // desktop-only feature, nav item hidden via CSS on mobile too
  showConfirm('Download Hether', 'Download Hether in your PC?', 'Yes', () => {
    window.location.href = HETHER_INSTALLER_URL;
  });
}

// ── SEARCH ──
// Archive search is deliberately gated by Enter. The old SECRET-prefix/dash
// mechanism is removed completely. Typing never verifies or reveals archives.
let _fluxSearchToken = 0;
let _fluxArchivedView = false;
let _fluxArchiveEntryUnlocked = false;
let _fluxPendingArchiveContact = null;
const FLUX_ARCHIVE_SECRET_STORAGE = 'flux_archive_secret_hash_v1';

async function _fluxHashSecret(value) {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function _fluxHasArchiveSecret() {
  try { return !!localStorage.getItem(FLUX_ARCHIVE_SECRET_STORAGE); } catch (_) { return false; }
}

// Same auto-archive rule as the one in loadContacts(), but self-contained so
// it can be re-run the moment a secret gets created mid-session (see
// submitFluxArchiveSecretConfirm below), instead of waiting for the next
// full contacts reload to catch groups that arrived before the secret existed.
async function _fluxSweepInboxGrouping() {
  if (!_inboxGroupingEnabled || !_fluxHasArchiveSecret()) return;
  try {
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) return;

    const [{ data: memberRows }, { data: catRows }] = await Promise.all([
      supabaseClient.from('flux_group_members').select('group_id').eq('user_id', user.id),
      supabaseClient.from('chat_categories').select('contact_id, group_id').eq('owner_id', user.id)
    ]);
    const myGroupIds = [...new Set((memberRows || []).map(r => r.group_id))];
    if (!myGroupIds.length) return;

    const { data: groupRows } = await supabaseClient
      .from('flux_groups')
      .select('id, owner_id')
      .in('id', myGroupIds);

    const alreadySeen = new Set((catRows || []).map(row => row.contact_id || row.group_id));
    const newlyAddedGroups = (groupRows || []).filter(g => g.owner_id !== user.id && !alreadySeen.has(g.id));
    if (!newlyAddedGroups.length) return;

    newlyAddedGroups.forEach(g => fluxArchived.set(g.id, true));
    const { error } = await supabaseClient
      .from('chat_categories')
      .upsert(
        newlyAddedGroups.map(g => ({
          owner_id: user.id,
          contact_id: null,
          group_id: g.id,
          category: 'primary',
          muted: false,
          pinned: false,
          archived: true,
          updated_at: new Date().toISOString()
        })),
        { onConflict: 'owner_id,group_id' }
      );
    if (error) { console.warn('[FLUX] inbox grouping sweep failed:', error.message); return; }
    buildFLUXConvList();
  } catch (e) {
    console.warn('[FLUX] inbox grouping sweep failed:', e.message || e);
  }
}

async function _fluxVerifyArchiveSecret(candidate) {
  if (!candidate || !_fluxHasArchiveSecret()) return false;
  try {
    const stored = localStorage.getItem(FLUX_ARCHIVE_SECRET_STORAGE);
    const hash = await _fluxHashSecret(candidate);
    return hash === stored;
  } catch (_) { return false; }
}

let _fluxPendingArchiveSecretKey = '';

function openFluxArchiveSecretSetup(contactId) {
  _fluxPendingArchiveContact = contactId || null;
  _fluxPendingArchiveSecretKey = '';
  const ov = document.getElementById('fluxArchiveSecretOverlay');
  const input = document.getElementById('fluxArchiveSecretInput');
  const err = document.getElementById('fluxArchiveSecretError');
  if (!ov || !input) return;
  input.value = '';
  if (err) { err.textContent = ''; err.style.display = 'none'; }
  ov.classList.add('show');
  setTimeout(() => input.focus(), 30);
}

function closeFluxArchiveSecretSetup() {
  document.getElementById('fluxArchiveSecretOverlay')?.classList.remove('show');
  document.getElementById('fluxArchiveSecretConfirmOverlay')?.classList.remove('show');
  _fluxPendingArchiveContact = null;
  _fluxPendingArchiveSecretKey = '';
}

function submitFluxArchiveSecretSetup() {
  const input = document.getElementById('fluxArchiveSecretInput');
  const err = document.getElementById('fluxArchiveSecretError');
  if (!input) return;
  const key = input.value;
  const showError = (text) => { if (err) { err.textContent = text; err.style.display = 'block'; } input.focus(); };
  if (!key) return showError('Enter a secret key.');
  if (key.length < 4) return showError('Use at least 4 characters.');
  _fluxPendingArchiveSecretKey = key;
  if (err) err.style.display = 'none';
  // Step 1 must completely close before Step 2 is opened as a separate modal.
  const firstOv = document.getElementById('fluxArchiveSecretOverlay');
  const confirmOv = document.getElementById('fluxArchiveSecretConfirmOverlay');
  const confirm = document.getElementById('fluxArchiveSecretConfirm');
  const confirmErr = document.getElementById('fluxArchiveSecretConfirmError');
  firstOv?.classList.remove('show');
  if (confirm) confirm.value = '';
  if (confirmErr) { confirmErr.textContent = ''; confirmErr.style.display = 'none'; }

  // Wait for the first overlay to finish closing/paint before showing the
  // confirmation overlay, so the two steps are visually distinct popups.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      confirmOv?.classList.add('show');
      setTimeout(() => confirm?.focus(), 30);
    });
  });
}

async function submitFluxArchiveSecretConfirm() {
  const confirm = document.getElementById('fluxArchiveSecretConfirm');
  const err = document.getElementById('fluxArchiveSecretConfirmError');
  if (!confirm) return;
  const key = _fluxPendingArchiveSecretKey;
  const key2 = confirm.value;
  const showError = (text) => { if (err) { err.textContent = text; err.style.display = 'block'; } confirm.focus(); };
  if (!key) return closeFluxArchiveSecretSetup();
  if (!key2) return showError('Confirm your secret key.');
  if (key !== key2) return showError('The secret keys do not match.');

  try {
    const hash = await _fluxHashSecret(key);
    localStorage.setItem(FLUX_ARCHIVE_SECRET_STORAGE, hash);
    const contactId = _fluxPendingArchiveContact;
    closeFluxArchiveSecretSetup();
    if (contactId) await _archiveFluxContactNow(contactId);
    // Now that a secret exists, catch up on any group chats Inbox Grouping
    // had to skip earlier because there was nowhere safe to send them yet.
    _fluxSweepInboxGrouping();
  } catch (e) {
    console.error('[Archive] Failed to create secret:', e);
    showError('Could not create the secret key. Please try again.');
  }
}

// Allow Enter to perform the same step as the visible button.
document.addEventListener('keydown', function(e) {
  if (e.key !== 'Enter') return;
  if (e.target?.id === 'fluxArchiveSecretInput' && document.getElementById('fluxArchiveSecretOverlay')?.classList.contains('show')) {
    e.preventDefault();
    submitFluxArchiveSecretSetup();
  } else if (e.target?.id === 'fluxArchiveSecretConfirm' && document.getElementById('fluxArchiveSecretConfirmOverlay')?.classList.contains('show')) {
    e.preventDefault();
    submitFluxArchiveSecretConfirm();
  }
});

function _updateFluxArchivedSidebarHeaders() {
  const desktopTitle = document.getElementById('fluxSidebarTitle');
  const mobileTitle = document.getElementById('fluxFsSidebarTitle');
  const desktopSidebar = desktopTitle?.closest('.flux-sidebar');
  const fullscreen = document.getElementById('fluxFullscreen') || document.getElementById('fluxArchivedFullscreenSidebar');
  if (desktopSidebar) desktopSidebar.id = _fluxArchivedView ? 'fluxArchivedSidebar' : '';
  if (fullscreen) fullscreen.id = _fluxArchivedView ? 'fluxArchivedFullscreenSidebar' : 'fluxFullscreen';

  if (_fluxArchivedView) {
    if (desktopTitle) {
      desktopTitle.className = 'flux-sidebar-title archived-folder-title';
      desktopTitle.innerHTML = `
        <button class="flux-archived-back-btn" type="button" onclick="exitFluxArchivedView()" aria-label="Back to messages" title="Back">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 19-7-7 7-7"/><path d="M19 12H5"/></svg>
        </button>
        <span>Archived folder</span>
        <div class="flux-archived-header-actions">
          <button class="flux-archived-chevron-btn" type="button" onclick="toggleFluxFolderKeyMenu(event)" aria-label="Folder options" title="Folder options">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
          </button>
          <div class="flux-folder-key-menu" id="fluxFolderKeyMenu">
            <button type="button" onclick="openFluxFolderKeyChange(event)">Folder key</button>
          </div>
        </div>`
    }
    if (mobileTitle) {
      mobileTitle.className = 'flux-fs-archived-title';
      mobileTitle.innerHTML = `
        <button class="flux-archived-back-btn" type="button" onclick="exitFluxArchivedView()" aria-label="Back to messages" title="Back">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 19-7-7 7-7"/><path d="M19 12H5"/></svg>
        </button>
        <span>Archived folder</span>
        <div class="flux-archived-header-actions">
          <button class="flux-archived-chevron-btn" type="button" onclick="toggleFluxFolderKeyMenu(event)" aria-label="Folder options" title="Folder options">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
          </button>
          <div class="flux-folder-key-menu">
            <button type="button" onclick="openFluxFolderKeyChange(event)">Folder key</button>
          </div>
        </div>`
    }
  } else {
    if (desktopTitle) {
      desktopTitle.className = 'flux-sidebar-title';
      desktopTitle.innerHTML = `Messages <span class="flux-secure-badge">SECURE</span>`;
    }
    if (mobileTitle) {
      mobileTitle.className = '';
      mobileTitle.style.fontSize = '15px';
      mobileTitle.style.fontWeight = '600';
      mobileTitle.style.display = 'flex';
      mobileTitle.style.alignItems = 'center';
      mobileTitle.style.gap = '8px';
      mobileTitle.innerHTML = `Messages <span class="flux-secure-badge">SECURE</span>`;
    }
  }
}

function enterFluxArchivedView() {
  // The sidebar unlock is only for reaching the secret folder. Once the
  // folder is opened, hide the temporary Archived row from the sidebar.
  _fluxArchiveEntryUnlocked = false;
  _fluxArchivedView = true;
  fluxActiveTab = 'all';
  _updateFluxArchivedSidebarHeaders();
  ['fluxTabBar','fluxFsTabBar'].forEach(id => {
    const bar = document.getElementById(id);
    if (bar) bar.style.display = 'none';
  });
  buildFLUXConvList();
}

function exitFluxArchivedView() {
  if (!_fluxArchivedView) return;
  _fluxSidebarSearchTerm = '';
  ['fluxSearchInput','fluxFsSearchInput'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  _fluxArchivedView = false;
  _updateFluxArchivedSidebarHeaders();
  ['fluxTabBar','fluxFsTabBar'].forEach(id => {
    const bar = document.getElementById(id);
    if (bar) bar.style.display = '';
  });
  buildFLUXConvList();
}

function _closeFluxFolderKeyMenus() {
  document.querySelectorAll('.flux-folder-key-menu').forEach(m => m.classList.remove('show'));
}

function toggleFluxFolderKeyMenu(e) {
  if (e) e.stopPropagation();
  const parent = e?.currentTarget?.parentElement;
  const menu = parent?.querySelector('.flux-folder-key-menu');
  if (!menu) return;
  const open = menu.classList.contains('show');
  _closeFluxFolderKeyMenus();
  if (!open) menu.classList.add('show');
}

function openFluxFolderKeyChange(e) {
  if (e) e.stopPropagation(); _closeFluxFolderKeyMenus();
  const ov=document.getElementById('fluxFolderKeyOverlay'), cur=document.getElementById('fluxFolderKeyCurrent'), err=document.getElementById('fluxFolderKeyCurrentError');
  if(!ov||!cur)return; cur.value=''; if(err){err.textContent='';err.style.display='none';}
  ['fluxFolderKeyNewOverlay','fluxFolderKeyConfirmOverlay'].forEach(id=>document.getElementById(id)?.classList.remove('show'));
  ov.classList.add('show'); setTimeout(()=>cur.focus(),30);
}
function closeFluxFolderKeyChange(){['fluxFolderKeyOverlay','fluxFolderKeyNewOverlay','fluxFolderKeyConfirmOverlay'].forEach(id=>document.getElementById(id)?.classList.remove('show'));window._fluxPendingFolderKeyNew='';}
async function submitFluxFolderKeyCurrent(){
  const cur=document.getElementById('fluxFolderKeyCurrent'),err=document.getElementById('fluxFolderKeyCurrentError'); if(!cur)return;
  const bad=t=>{if(err){err.textContent=t;err.style.display='block';}cur.focus();}; if(!cur.value)return bad('Enter your current folder key.');
  if(!(await _fluxVerifyArchiveSecret(cur.value.trim())))return bad('Incorrect current key.'); if(err)err.style.display='none';
  document.getElementById('fluxFolderKeyOverlay')?.classList.remove('show'); const ov=document.getElementById('fluxFolderKeyNewOverlay'),nw=document.getElementById('fluxFolderKeyNew'),e=document.getElementById('fluxFolderKeyNewError');
  if(nw)nw.value='';if(e){e.textContent='';e.style.display='none';} requestAnimationFrame(()=>{ov?.classList.add('show');setTimeout(()=>nw?.focus(),30);});
}
function submitFluxFolderKeyNew(){
  const nw=document.getElementById('fluxFolderKeyNew'),err=document.getElementById('fluxFolderKeyNewError');if(!nw)return;const bad=t=>{if(err){err.textContent=t;err.style.display='block';}nw.focus();};
  if(!nw.value)return bad('Enter a new secret key.');if(nw.value.length<4)return bad('Use at least 4 characters.');window._fluxPendingFolderKeyNew=nw.value;if(err)err.style.display='none';
  document.getElementById('fluxFolderKeyNewOverlay')?.classList.remove('show');const ov=document.getElementById('fluxFolderKeyConfirmOverlay'),cf=document.getElementById('fluxFolderKeyConfirm'),e=document.getElementById('fluxFolderKeyConfirmError');
  if(cf)cf.value='';if(e){e.textContent='';e.style.display='none';}requestAnimationFrame(()=>{ov?.classList.add('show');setTimeout(()=>cf?.focus(),30);});
}
async function submitFluxFolderKeyConfirm(){
  const cf=document.getElementById('fluxFolderKeyConfirm'),err=document.getElementById('fluxFolderKeyConfirmError'),nw=window._fluxPendingFolderKeyNew||'';if(!cf)return;const bad=t=>{if(err){err.textContent=t;err.style.display='block';}cf.focus();};
  if(!nw)return closeFluxFolderKeyChange();if(!cf.value)return bad('Confirm your new secret key.');if(nw!==cf.value)return bad('The secret keys do not match.');
  try{localStorage.setItem(FLUX_ARCHIVE_SECRET_STORAGE,await _fluxHashSecret(nw));closeFluxFolderKeyChange();}catch(e){console.error('[Archive] Failed to change secret:',e);bad('Could not change the secret key. Please try again.');}
}

document.addEventListener('keydown', function(e) {
  if(e.key!=='Enter')return; const t=e.target;if(!t)return;
  if(t.id==='fluxFolderKeyCurrent'&&document.getElementById('fluxFolderKeyOverlay')?.classList.contains('show')){e.preventDefault();submitFluxFolderKeyCurrent();}
  else if(t.id==='fluxFolderKeyNew'&&document.getElementById('fluxFolderKeyNewOverlay')?.classList.contains('show')){e.preventDefault();submitFluxFolderKeyNew();}
  else if(t.id==='fluxFolderKeyConfirm'&&document.getElementById('fluxFolderKeyConfirmOverlay')?.classList.contains('show')){e.preventDefault();submitFluxFolderKeyConfirm();}
});
document.addEventListener('click', function(e) {
  if (!e.target.closest('.flux-archived-header-actions')) _closeFluxFolderKeyMenus();
});

async function onFluxSearchEnter(val, mode) {
  const trimmed = (val || '').trim();
  if (!trimmed) return;
  const valid = await _fluxVerifyArchiveSecret(trimmed);
  const dropdown = document.getElementById(mode === 'mobile' ? 'fluxFsSearchDropdown' : 'fluxSearchDropdown');
  if (dropdown) { dropdown.innerHTML = ''; dropdown.classList.remove('show'); }
  if (!valid) return;

  // A valid archive key unlocks the Archived entry in the DM sidebar itself.
  // It must never be rendered as a search suggestion.
  _fluxArchiveEntryUnlocked = true;
  _fluxSidebarSearchTerm = '';
  const input = document.getElementById(mode === 'mobile' ? 'fluxFsSearchInput' : 'fluxSearchInput');
  if (input) input.value = '';
  exitFluxArchivedView();
  buildFLUXConvList();
}

function _buildFluxArchivedSidebarItem(isFsList) {
  const item = document.createElement('div');
  item.className = 'flux-conv-item flux-archived-sidebar-item';
  item.setAttribute('role', 'button');
  item.setAttribute('tabindex', '0');
  item.innerHTML = `
    <div class="flux-archived-sidebar-icon" aria-hidden="true">
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-folder-lock-icon lucide-folder-lock"><rect width="8" height="5" x="14" y="17" rx="1"/><path d="M10 20H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v2.5"/><path d="M20 17v-2a2 2 0 1 0-4 0v2"/></svg>
    </div>
    <div class="flux-conv-info">
      <div class="flux-conv-toprow">
        <div class="flux-conv-name">Archived</div>
      </div>
      <div class="flux-conv-bottomrow">
        <div class="flux-conv-preview">Hidden chats</div>
      </div>
    </div>
  `;
  const open = (e) => {
    if (e) e.stopPropagation();
    enterFluxArchivedView();
  };
  item.onclick = open;
  item.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(e); } };
  return item;
}

let _fluxSidebarSearchTerm = '';

function _renderNormalFluxSearch(val, dropdown, mode) {
  const trimmed = (val || '').trim();
  if (dropdown) {
    dropdown.innerHTML = '';
    dropdown.classList.remove('show');
  }
  _fluxSidebarSearchTerm = trimmed.toLowerCase();
  buildFLUXConvList();
}

function onFluxSearch(val) {
  ++_fluxSearchToken;
  if ((val || '').trim()) _fluxArchiveEntryUnlocked = false;
  _renderNormalFluxSearch(val, document.getElementById('fluxSearchDropdown'), 'desktop');
}

function onFluxFsSearch(val) {
  ++_fluxSearchToken;
  if ((val || '').trim()) _fluxArchiveEntryUnlocked = false;
  _renderNormalFluxSearch(val, document.getElementById('fluxFsSearchDropdown'), 'mobile');
}

function renderSearchDropdown(dropdown, matches, mode) {
  dropdown.innerHTML = '';
  if (matches.length === 0) {
    dropdown.innerHTML = '<div class="flux-search-empty">No users found</div>';
    dropdown.classList.add('show'); return;
  }
  // Sort by real username
  const sorted = [...matches].sort((a, b) => (a.realName || a.name).localeCompare(b.realName || b.name));
  sorted.forEach(c => {
    const item = document.createElement('div');
    item.className = 'flux-search-item';
    const realName = c.realName || c.name;
    item.innerHTML = `
      <div class="flux-search-avatar default-avatar" style="background:#e8e8ec;overflow:hidden;position:relative;">
        ${c.avatarUrl ? `<img src="${c.avatarUrl}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%;position:absolute;inset:0;">` : DEFAULT_AVATAR_SVG}
      </div>
      <div class="flux-search-name">${escHtml(realName)}</div>
    `;
    item.onclick = () => {
      dropdown.classList.remove('show');
      if (mode === 'mobile') { document.getElementById('fluxFsSearchInput').value = ''; openFsRelay(c.id); }
      else { document.getElementById('fluxSearchInput').value = ''; openDesktopRelay(c.id); }
    };
    dropdown.appendChild(item);
  });
  dropdown.classList.add('show');
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('.flux-search-wrap') && !e.target.closest('.flux-fs-search-wrap')) {
    document.getElementById('fluxSearchDropdown')?.classList.remove('show');
    document.getElementById('fluxFsSearchDropdown')?.classList.remove('show');
  }
});

// ── PROFILE ──
function getInitial(name) { return (name || 'U').trim()[0].toUpperCase(); }

/* FIX 1: Avatar rendering helper — uses proper silhouette SVG */
function setAvatarEl(el, avatarUrl) {
  el.innerHTML = '';
  if (avatarUrl) {
    el.classList.remove('default-avatar');
    const img = document.createElement('img');
    img.src = avatarUrl;
    img.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:inherit;display:block;';
    el.appendChild(img);
  } else {
    el.classList.add('default-avatar');
    el.innerHTML = DEFAULT_AVATAR_SVG;
  }
}

function renderProfileEverywhere() {
  // Sidebar avatar
  const sAvEl = document.getElementById('sidebarProfileAvatar');
  setAvatarEl(sAvEl, profile.avatarUrl);
  document.getElementById('sidebarProfileName').textContent = profile.name;

  // Mobile top-right profile button
  const mobProfileBtn = document.getElementById('mobileProfileBtn');
  if (mobProfileBtn) setAvatarEl(mobProfileBtn, profile.avatarUrl);

  // Profile dropdown header
  document.getElementById('pdDisplayName').textContent = profile.name;
  document.getElementById('pdEmail').textContent = profile.email;
  const pdAvEl = document.getElementById('pdAvatarLarge');
  const overlay = pdAvEl.querySelector('.pd-avatar-overlay');
  setAvatarEl(pdAvEl, profile.avatarUrl);
  if (overlay) pdAvEl.appendChild(overlay); // re-attach overlay

  document.getElementById('acc0Name').textContent = `${profile.name} (current)`;

  // Profile page banner (name, username, avatar, and its derived monotone/vintage palette)
  const pbNameEl = document.getElementById('profileBannerName');
  if (pbNameEl) pbNameEl.textContent = profile.name;
  const pbUserEl = document.getElementById('profileBannerUsername');
  if (pbUserEl) pbUserEl.textContent = profile.username ? profile.username.replace(/^@/, '') : '';
  const pbAvEl = document.getElementById('profileBannerAvatar');
  if (pbAvEl) setProfileBannerAvatarAndPalette(pbAvEl, profile.avatarUrl);

  // Profile details popup
  const pdpAvEl = document.getElementById('pdpAvatar');
  if (pdpAvEl) setAvatarEl(pdpAvEl, profile.avatarUrl);
}
renderProfileEverywhere();

// ── Profile page banner palette: samples the avatar's average color, then
// converts it to a single desaturated hue at a flat lightness so the banner
// reads as a muted, faded/vintage solid tone rather than a literal
// photo-accurate swatch. Falls back to the default solid color (set in CSS) if
// there's no avatar or the image can't be sampled (e.g. a CORS-blocked host).
function setProfileBannerAvatarAndPalette(avatarEl, avatarUrl) {
  setAvatarEl(avatarEl, avatarUrl);
  const banner = document.getElementById('profileBanner');
  if (!banner) return;
  if (!avatarUrl) {
    banner.style.background = '';
    banner.style.backgroundImage = '';
    return;
  }
  const probe = new Image();
  probe.crossOrigin = 'anonymous';
  probe.onload = () => {
    const rgb = sampleAvgImageColor(probe);
    if (rgb) applyProfileBannerPalette(banner, rgb);
  };
  probe.onerror = () => { /* leave the default solid color */ };
  probe.src = avatarUrl;
}
function sampleAvgImageColor(imgEl) {
  try {
    const w = 20, h = 20;
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(imgEl, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < data.length; i += 4) { r += data[i]; g += data[i + 1]; b += data[i + 2]; n++; }
    return { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n) };
  } catch (e) { return null; } // canvas got tainted (no CORS) — just skip the palette
}
function applyProfileBannerPalette(banner, rgb) {
  const { h } = rgbToHslLite(rgb.r, rgb.g, rgb.b);
  // Single flat, muted color — no gradient, one layer — derived from the avatar's sampled hue.
  const solid = hslLiteToRgbStr(h, 16, 20);
  banner.style.backgroundImage = '';
  banner.style.background = solid;
}
function rgbToHslLite(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0;
  const d = max - min;
  if (d !== 0) {
    switch (max) {
      case r: h = ((g - b) / d) % 6; break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h *= 60; if (h < 0) h += 360;
  }
  return { h };
}
function hslLiteToRgbStr(h, s, l) {
  s /= 100; l /= 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs((h / 60) % 2 - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; b = 0; }
  else if (h < 120) { r = x; g = c; b = 0; }
  else if (h < 180) { r = 0; g = c; b = x; }
  else if (h < 240) { r = 0; g = x; b = c; }
  else if (h < 300) { r = x; g = 0; b = c; }
  else { r = c; g = 0; b = x; }
  r = Math.round((r + m) * 255); g = Math.round((g + m) * 255); b = Math.round((b + m) * 255);
  return `rgb(${r},${g},${b})`;
}

// ── THEME ──
// Light mode has been removed. The app always uses the dark interface.
function initTheme() {
  const html = document.documentElement;
  html.setAttribute('data-theme', 'dark');
  html.removeAttribute('data-solarized');
  localStorage.setItem('aloft_theme', 'dark');
  localStorage.removeItem('aloft_solarized');
}
initTheme();

// ── ACCENT COLOR ──
function _updateAccentSwatches(color) {
  const blueBtn = document.getElementById('accentSwatchBlue');
  const greenBtn = document.getElementById('accentSwatchGreen');
  if (blueBtn) blueBtn.classList.toggle('active', color === 'blue');
  if (greenBtn) greenBtn.classList.toggle('active', color === 'green');
}
function setAccentColor(color) {
  document.documentElement.setAttribute('data-accent', color);
  localStorage.setItem('aloft_accent', color);
  _updateAccentSwatches(color);
}
function initAccentColor() {
  const saved = localStorage.getItem('aloft_accent') || 'green';
  document.documentElement.setAttribute('data-accent', saved);
  _updateAccentSwatches(saved);
}
initAccentColor();

// ── MINI CALCULATOR WIDGET ──
let miniCalcExpr = '';
let miniCalcJustEval = false;
function toggleCalcWidget() {
  const w = document.getElementById('miniCalcWidget');
  w.classList.toggle('show');
  const btn = document.getElementById('navCalc');
  btn.classList.toggle('active', w.classList.contains('show'));
}
function miniCalcAction(val) {
  const exprEl = document.getElementById('miniCalcExpr');
  const resEl = document.getElementById('miniCalcResult');
  if (val === 'AC') { miniCalcExpr = ''; exprEl.textContent = ''; resEl.textContent = '0'; miniCalcJustEval = false; return; }
  if (val === '=') {
    try {
      const result = Function('"use strict"; return (' + miniCalcExpr.replace(/÷/g,'/').replace(/×/g,'*') + ')')();
      exprEl.textContent = miniCalcExpr + ' =';
      const r = parseFloat(result.toFixed(10));
      resEl.textContent = isNaN(r) ? 'Error' : r;
      miniCalcExpr = String(isNaN(r) ? '' : r);
      miniCalcJustEval = true;
    } catch { resEl.textContent = 'Error'; miniCalcExpr = ''; miniCalcJustEval = false; }
    return;
  }
  if (val === '%') {
    try { const r = parseFloat((Function('"use strict"; return (' + miniCalcExpr + ')')() / 100).toFixed(10)); miniCalcExpr = String(r); resEl.textContent = r; exprEl.textContent = ''; } catch {}
    return;
  }
  const isOp = ['+','-','*','/'].includes(val);
  if (miniCalcJustEval && !isOp) { miniCalcExpr = ''; exprEl.textContent = ''; miniCalcJustEval = false; }
  else if (miniCalcJustEval && isOp) { miniCalcJustEval = false; }
  miniCalcExpr += val;
  try { const r = Function('"use strict"; return (' + miniCalcExpr + ')')(); resEl.textContent = parseFloat(r.toFixed(10)); } catch {}
  exprEl.textContent = miniCalcExpr;
}
// Close mini calc when clicking outside
document.addEventListener('click', (e) => {
  const w = document.getElementById('miniCalcWidget');
  if (!w) return;
  if (w.classList.contains('show') && !w.contains(e.target) && !document.getElementById('navCalc').contains(e.target)) {
    w.classList.remove('show');
    document.getElementById('navCalc').classList.remove('active');
  }
});

// ── WELCOME ──
function setWelcomeGreeting() {
  const name = profile.name && profile.name !== 'User' ? profile.name.split(' ')[0] : null;
  const greetings = name
    ? [`Hello, ${name}`, `${name} is back!`, `Welcome back, ${name}.`, `Hey ${name} 👋`]
    : [`Hello there `, `What can I help with?`, `Ask me anything.`,`User is back!`];
  const el = document.getElementById('welcomeHello');
  if (el) el.textContent = greetings[Math.floor(Math.random() * greetings.length)];
}
setWelcomeGreeting();

// ── SIDEBAR ──
function setupSidebarHover() {
  const sidebar = document.getElementById('sidebar');
  const dropdown = document.getElementById('profileDropdown');
  // Expansion is handled by CSS :hover on .sidebar
  // JS only needed for collapse-on-dropdown-leave
  dropdown.addEventListener('mouseleave', (e) => {
    if (isMobile()) return;
    if (!sidebar.contains(e.relatedTarget)) {
      document.getElementById('profileDropdown').classList.remove('show');
    }
  });
}
function expandSidebar() {
  // CSS handles expansion via :hover; this is only needed for mobile
  if (isMobile()) {
    document.getElementById('sidebar').classList.remove('mini');
    document.getElementById('mainArea').classList.remove('sidebar-mini');
  }
}
function miniSidebar() {
  const dropdown = document.getElementById('profileDropdown');
  sidebarMini = true;
  document.getElementById('sidebar').classList.add('mini');
  document.getElementById('mainArea').classList.add('sidebar-mini');
  dropdown.classList.remove('show');
}
function toggleSidebarMobile() {
  if (isMobile()) {
    const sidebar = document.getElementById('sidebar');
    if (sidebar.classList.contains('mini')) { expandSidebar(); document.getElementById('mobileOverlay').classList.add('show'); }
    else { miniSidebar(); document.getElementById('mobileOverlay').classList.remove('show'); }
  }
}
function hideSidebar() { miniSidebar(); document.getElementById('mobileOverlay').classList.remove('show'); }
setupSidebarHover();

// ── VIEWS ──
// BACKUP: was used to randomize the library banner slogan each time the view opened.
// Kept here disabled since the heading is now fixed to "Tune Into" / "Everything".
const LIB_BANNER_SLOGANS = ['Turn It Up', 'Press Play', 'Catch the Vibe', 'Drop the Beat', 'Crank It Up', 'Tune In'];
function setRandomLibBannerSlogan() {
  const el = document.getElementById('libBannerTitle');
  if (!el) return;
  el.textContent = LIB_BANNER_SLOGANS[Math.floor(Math.random() * LIB_BANNER_SLOGANS.length)];
}
function showView(view) {
  if (view === currentView) return;
  const prevView = currentView;
  currentView = view;
  const views = ['relay','settings','notes','explore','favourites','profile','library','history','aloft'];
  views.forEach(v => {
    const el = document.getElementById(v === 'relay' ? 'relayView' : v === 'settings' ? 'settingsView' : v === 'notes' ? 'notesView' : v === 'explore' ? 'exploreView' : v === 'favourites' ? 'favouritesView' : v === 'profile' ? 'profileView' : v === 'library' ? 'libraryView' : v === 'aloft' ? 'aloftView' : 'historyView');
    if (!el) return;
    if (v === 'relay') el.style.display = view === 'relay' ? 'flex' : 'none';
    else if (v === 'favourites' || v === 'explore' || v === 'profile') el.style.display = view === v ? 'flex' : 'none';
    else if (v === 'aloft') el.style.display = view === 'aloft' ? 'flex' : 'none';
    else el.classList.toggle('show', view === v);
  });
  if (view === 'aloft') aloftOnShow();
  if (prevView === 'aloft' && view !== 'aloft') aloftOnHide();
  const navMap = { relay: 'navRelay', settings: 'navSettings', notes: 'navNotes', explore: 'navExplore', favourites: 'navFavourites', library: 'navLibrary', history: 'navHistory', aloft: 'navAloft' };
  Object.entries(navMap).forEach(([v, id]) => { const el = document.getElementById(id); if (el) el.classList.toggle('active', view === v); });
  if (view === 'notes' && typeof renderSpotlightView === 'function') renderSpotlightView();
  if (view === 'history') renderHistoryList();
  if (view === 'library') { if (!libLoaded) renderLibrarySkeleton(); loadLibrary(); }
  if (view === 'favourites') { loadLibrary().then(renderSearchPageResults); renderSearchPageResults(); }
  if (view === 'explore') { if (!libLoaded) renderExploreSkeleton(); loadExploreView(); }
  if (view === 'profile') { renderProfileEverywhere(); if (!libLoaded) renderProfileSkeleton(); loadProfileTopSongs(); }
  updateNowPlayingPanelVisibility(view);
  if (view === 'settings') {
    calcStorageUsage();
    const alreadyInSettings = prevView === 'settings';
    if (!alreadyInSettings) {
      if (window.innerWidth <= 768) {
        // Mobile: reset to nav list view
        const nav = document.getElementById('settingsNav');
        if (nav) nav.classList.remove('mob-panel-open');
        document.querySelectorAll('.settings-panel').forEach(p => p.classList.remove('active'));
        document.querySelectorAll('.settings-nav-item').forEach(b => b.classList.remove('active'));
      } else {
        // Desktop: default to appearance tab
        showSettingsPanel('appearance', document.querySelector('.settings-nav-item[onclick*="appearance"]'));
      }
    }
  }
  if (isMobile()) hideSidebar();
}

// ── MOBILE BOTTOM NAV SYNC ──
function updateMobNav(view) {
  const map = { relay: 'mobNavRelay', explore: 'mobNavExplore', favourites: 'mobNavFavourites', aloft: 'mobNavAloft', settings: 'mobNavSettings' };
  Object.entries(map).forEach(([v, id]) => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('active', view === v);
  });
}

// Patch showView to also update mobile nav
const _origShowView = showView;
showView = function(view) {
  _origShowView(view);
  updateMobNav(view);
};
function autoResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 160) + 'px';
  document.getElementById('sendBtn').disabled = el.value.trim() === '';
}
function autoResizeFlux(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 120) + 'px';
}
function handleKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
}
function handleRelayPaste(e) {
  const items = e.clipboardData?.items;
  if (!items) return;
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      e.preventDefault();
      const file = item.getAsFile();
      if (!file) return;
      const reader = new FileReader();
      reader.onload = ev => stageAIMediaFromDataUrl(ev.target.result, false);
      reader.readAsDataURL(file);
      return;
    }
  }
}
function handleFluxPaste(e, mode) {
  const items = e.clipboardData?.items;
  if (!items) return;
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      e.preventDefault();
      const file = item.getAsFile();
      if (!file) return;
      const reader = new FileReader();
      reader.onload = ev => { cancelReply(mode); stageFluxMediaFromDataUrl(ev.target.result, false, mode); };
      reader.readAsDataURL(file);
      return;
    }
  }
}
function fillSuggestion(text) {
  const i = document.getElementById('userInput');
  i.value = text; autoResize(i); i.focus();
}

function newRelay() {
  relayHistory = []; clearAIStaging();
  const msgs = document.getElementById('messages');
  msgs.innerHTML = '';
  // Rebuild welcome above the input wrap
  const inputArea = document.querySelector('.input-area');
  let w = document.getElementById('welcomeScreen');
  if (!w) {
    w = document.createElement('div');
    w.className = 'welcome'; w.id = 'welcomeScreen';
    inputArea.insertBefore(w, inputArea.firstChild);
  }
  w.innerHTML = `<div class="welcome-hello" id="welcomeHello">Hello there</div>`;
  document.getElementById('relayView').classList.add('welcome-mode');
  setWelcomeGreeting();
  showView('relay');
}

// ── AI CHAT (web) ──
// Calls the serverless endpoint at /api/chat.js instead of Electron's IPC bridge.
async function geminiChat(history) {
  const res = await fetch('/api/chat.js', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: history })
  });
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try { const errBody = await res.json(); if (errBody && errBody.error) msg = errBody.error; } catch (e) {}
    throw new Error(msg);
  }
  const data = await res.json();
  return data.reply;
}

async function sendMessage() {
  const input = document.getElementById('userInput');
  const text = input.value.trim();
  if (!text && !aiStagedMedia || isTyping) return;

  if (window._guestMode) {
    const welcome = document.getElementById('welcomeScreen');
    if (welcome) welcome.style.display = "none";
    document.getElementById('relayView').classList.remove('welcome-mode');
    if (text) appendMessage('user', text);
    input.value = ''; input.style.height = 'auto';
    document.getElementById('sendBtn').disabled = true;
    clearAIStaging();
    appendMessage('ai', 'Please login or sign up to continue.');
    return;
  }

  const welcome = document.getElementById('welcomeScreen');
  if (welcome) welcome.style.display = "none";
  document.getElementById('relayView').classList.remove('welcome-mode');

  if (aiStagedMedia) {
    const caption = document.getElementById('mediaStagingCaption').value.trim();
    appendMediaMessage('user', aiStagedMedia.dataUrl, aiStagedMedia.isVideo, caption);
    clearAIStaging();
    if (!text) {
      input.value = ''; input.style.height = 'auto';
      document.getElementById('sendBtn').disabled = true;
      return;
    }
  }

  if (!text) return;
  appendMessage('user', text);
  relayHistory.push({ role: 'user', content: text });
  input.value = ''; input.style.height = 'auto';
  document.getElementById('sendBtn').disabled = true;
  const typingEl = appendTyping();
  isTyping = true;
  try {
    const reply = await geminiChat(relayHistory);
    removeTyping(typingEl);
    await appendMessageWordByWord(reply);
    relayHistory.push({ role: 'ai', content: reply });
  } catch (err) {
    removeTyping(typingEl);
    await appendMessageWordByWord(`Error: ${err.message}`);
  }
  isTyping = false;
}

function appendMediaMessage(role, dataUrl, isVideo, caption) {
  const msgs = document.getElementById('messages');
  const mediaDiv = document.createElement('div');
  mediaDiv.className = `message ${role}`;
  const av1 = document.createElement('div');
  av1.className = `avatar ${role === 'ai' ? 'ai' : 'user-av'}`;
  if (role !== 'ai') {
    if (profile.avatarUrl) { av1.innerHTML = `<img src="${profile.avatarUrl}" alt="">`; }
    else { av1.classList.add('default-avatar'); av1.innerHTML = DEFAULT_AVATAR_SVG; }
  } else { av1.textContent = 'AI'; }
  const mediaBubble = document.createElement('div');
  mediaBubble.className = 'bubble media-only';
  if (isVideo) {
    mediaBubble.innerHTML = `<video class="relay-media-vid" controls src="${dataUrl}"></video>`;
  } else {
    mediaBubble.innerHTML = `<img class="relay-media-img" src="${dataUrl}" alt="media" onclick="openLightbox(this.src, [this.src])">`;
  }
  mediaDiv.appendChild(av1);
  mediaDiv.appendChild(mediaBubble);
  msgs.appendChild(mediaDiv);

  if (caption) {
    const captionDiv = document.createElement('div');
    captionDiv.className = `message ${role}`;
    const av2 = document.createElement('div');
    av2.className = `avatar ${role === 'ai' ? 'ai' : 'user-av'}`;
    av2.style.visibility = 'hidden';
    const captionBubble = document.createElement('div');
    captionBubble.className = 'bubble';
    captionBubble.innerHTML = formatText(caption);
    captionDiv.appendChild(av2);
    captionDiv.appendChild(captionBubble);
    msgs.appendChild(captionDiv);
  }
  const bubbleEl = mediaBubble || mediaDiv;
  if (bubbleEl) {
    const delta = (bubbleEl.offsetHeight || mediaDiv.offsetHeight || 0);
    const maxScroll = msgs.scrollHeight - msgs.clientHeight;
    msgs.scrollTop = Math.min(msgs.scrollTop + delta, maxScroll);
  }
}

function appendMessage(role, text) {
  const msgs = document.getElementById('messages');
  const div = document.createElement('div');
  div.className = `message ${role}`;
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  const processed = role === 'user' ? text.replace(/(?<![a-zA-Z])[Tt]-[Tt](?![a-zA-Z])/g, '😭') : text;
  bubble.innerHTML = formatText(processed);
  div.appendChild(bubble);
  msgs.appendChild(div);
  const bubbleHeight = (div.querySelector('.bubble')?.offsetHeight) || div.offsetHeight || 0;
  const maxScroll = msgs.scrollHeight - msgs.clientHeight;
  msgs.scrollTop = Math.min(msgs.scrollTop + bubbleHeight, maxScroll);
  return div;
}

function appendMessageWordByWord(text) {
  return new Promise(resolve => {
    const msgs = document.getElementById('messages');
    const div = document.createElement('div');
    div.className = 'message ai';
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    div.appendChild(bubble);
    msgs.appendChild(div);

    const words = text.split(/(\s+)/); // keep whitespace tokens so spacing/newlines are preserved
    let i = 0;
    function step() {
      i++;
      const partial = words.slice(0, i).join('');
      bubble.innerHTML = formatText(partial);
      msgs.scrollTop = msgs.scrollHeight;
      if (i < words.length) {
        setTimeout(step, 14 + Math.random() * 17.5);
      } else {
        resolve();
      }
    }
    step();
  });
}

function appendTyping() {
  const msgs = document.getElementById('messages');
  const div = document.createElement('div'); div.className = 'message ai'; div.id = 'typingIndicator';
  const bubble = document.createElement('div'); bubble.className = 'bubble';
  bubble.innerHTML = '<div class="typing-dots"><span class="pulse-dot"></span></div>';
  div.appendChild(bubble); msgs.appendChild(div);
  const typingBubbleHeight = (div.querySelector('.bubble')?.offsetHeight) || div.offsetHeight || 0;
  const maxScrollTip = msgs.scrollHeight - msgs.clientHeight;
  msgs.scrollTop = Math.min(msgs.scrollTop + typingBubbleHeight, maxScrollTip);
  return div;
}
function removeTyping(el) { if (el && el.parentNode) el.remove(); }

function formatText(text) {
  return text
    .replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => `<pre><code>${escHtml(code.trim())}</code></pre>`)
    .replace(/`([^`]+)`/g, (_, c) => `<code>${escHtml(c)}</code>`)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/\n/g, '<br>');
}
function escHtml(s) { if (!s) return ''; return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

// ── AI MEDIA STAGING ──
function stageAIMedia(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => stageAIMediaFromDataUrl(ev.target.result, file.type.startsWith('video/'));
  reader.readAsDataURL(file);
  event.target.value = '';
}

function stageAIMediaFromDataUrl(dataUrl, isVideo) {
  aiStagedMedia = { dataUrl, isVideo };
  const wrap = document.getElementById('mediaStagingWrap');
  const thumb = document.getElementById('mediaStagingThumb');
  thumb.innerHTML = isVideo
    ? `<video src="${dataUrl}" style="width:90px;height:74px;object-fit:cover;border-radius:8px;"></video>`
    : `<img src="${dataUrl}" style="width:90px;height:74px;object-fit:cover;border-radius:8px;">`;
  const removeBtn = document.createElement('button');
  removeBtn.className = 'media-staging-remove'; removeBtn.textContent = '×'; removeBtn.onclick = clearAIStaging;
  thumb.appendChild(removeBtn);
  wrap.classList.add('show');
  document.getElementById('mediaStagingCaption').value = '';
  document.getElementById('sendBtn').disabled = false;
  document.getElementById('mediaStagingCaption').focus();
}

function clearAIStaging() {
  aiStagedMedia = null;
  document.getElementById('mediaStagingWrap').classList.remove('show');
  document.getElementById('mediaStagingThumb').innerHTML = '';
  document.getElementById('mediaStagingCaption').value = '';
  toggleMediaButton();
}

function sendStagedMedia() {
  if (!aiStagedMedia) return;
  const welcome = document.getElementById('welcomeScreen');
  if (welcome) welcome.style.display = "none";
  document.getElementById('relayView').classList.remove('welcome-mode');
  const caption = document.getElementById('mediaStagingCaption').value.trim();
  appendMediaMessage('user', aiStagedMedia.dataUrl, aiStagedMedia.isVideo, caption);
  clearAIStaging();
}

// Session-only flags — never stored in localStorage/sessionStorage
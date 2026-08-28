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
let fluxActiveTab = 'primary';
let _fluxMyUserId = null;
let activeFluxId = null;
let activeFluxProfileTarget = null;
let activeFluxNickname = null;
let _fluxLoadToken = 0;
let replyingTo = null;

// Conversations cleared during the current realtime session. This is a
// client-side tombstone: it prevents stale preload/realtime hydration from
// putting the deleted last message back into the sidebar. A brand-new INSERT
// for the conversation removes the tombstone and resumes normal previews.
const _fluxRealtimeClearedConversations = new Set();

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
// local fluxCategories/fluxMuted/fluxPinned/fluxArchived Maps; these two helpers
// translate that unified id into the right DB column and upsert target so
// writes hit the correct FK/unique constraint.
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

// Called when this user's own flux_group_members row for a brand-new group
// shows up over realtime (see the `group-membership` channel in openFLUX()
// and _rehydrateRealtime()). loadContacts() alone registers the group
// locally but fetches no messages, so the "X added Y" system message the
// creator posts right after group creation would otherwise sit unseen
// until the panel reopened. createFluxGroup() posts that message several
// awaited steps AFTER the membership insert, so it usually isn't in the DB
// yet at the instant this runs — a single immediate fetch would race and
// miss it. Instead: fetch whatever's already there, and also open a
// short-lived listener scoped to just this group to catch the message
// whenever it actually lands, then hand off to the normal
// global-inbox-groups channel (now that the group is in _fluxMyGroupIds)
// for everything after that.
async function _fluxHandleNewGroupMembership(groupId, myUserId) {
  await loadContacts();
  buildFLUXConvList();

  const applyIncoming = (msg) => {
    if (!msg || msg.sender_id === myUserId) return;
    const contact = fluxContacts.find(c => c.id === groupId);
    if (!contact) return;
    _fluxRealtimeClearedConversations.delete(groupId);
    contact.unread = true;
    contact.unreadCount = (contact.unreadCount || 0) + 1;
    const d = parseSupabaseDate(msg.created_at);
    const senderName = _fluxGroupMsgSenderName(contact, msg.sender_id) || 'Someone';
    contact.lastMessage = { type: 'received', text: msg.content, media: !!msg.media_url, time: formatMsgTime(d), senderName };
    contact.lastMessageTs = d.getTime();
    _maybePlayMessageSound(groupId, myUserId);
    buildFLUXConvList();
  };

  // Catch it if it already landed by the time loadContacts() finished.
  try {
    const { data: existingMsgs } = await supabaseClient
      .from('messages')
      .select('*')
      .eq('group_id', groupId)
      .order('created_at', { ascending: false })
      .limit(1);
    if (existingMsgs && existingMsgs[0]) applyIncoming(existingMsgs[0]);
  } catch (e) {
    console.warn('[FLUX] new-group message catch-up failed:', e.message || e);
  }

  // Otherwise wait for it — self-tears-down after the first message, since
  // the persistent global-inbox-groups channel takes over from there.
  const oneOffCh = supabaseClient
    .channel(`new-group-catchup:${groupId}:${myUserId}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages',
      filter: `group_id=eq.${groupId}` }, (payload) => {
      applyIncoming(payload.new);
      supabaseClient.removeChannel(oneOffCh);
    })
    .subscribe();
  setTimeout(() => { try { supabaseClient.removeChannel(oneOffCh); } catch (e) {} }, 15000);
}

// Applies the correct filter to a Supabase query builder for a given
// conversation. `q` must be a builder that still supports .eq/.or (i.e.
// call this before .order()/.range()/.single()).
function _fluxApplyConvFilter(q, convId, myId, isGroup) {
  return isGroup
    ? q.eq('group_id', convId)
    : q.or(`and(sender_id.eq.${myId},receiver_id.eq.${convId}),and(sender_id.eq.${convId},receiver_id.eq.${myId})`);
}

// Fetches every message in a conversation, ignoring PostgREST's default
// row cap (1000). A single unpaginated select with .order('created_at',
// {ascending:true}) silently truncates to the OLDEST rows once a chat
// crosses that cap — which is exactly backwards for search, since it means
// the most recent messages quietly stop being searchable. This pages
// through with .range() and concatenates until a page comes back short.
async function _fluxFetchAllConvMessages(id, myId, isGroup) {
  const PAGE_SIZE = 1000;
  let all = [];
  let from = 0;
  while (true) {
    const { data, error } = await _fluxApplyConvFilter(
      supabaseClient.from('messages').select('id, sender_id, receiver_id, group_id, content, created_at, media_url, is_video, message_type'),
      id, myId, isGroup
    ).order('created_at', { ascending: true }).range(from, from + PAGE_SIZE - 1);
    if (error) return { data: null, error };
    all = all.concat(data || []);
    if (!data || data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return { data: all, error: null };
}

// Client-side equivalent, used inside realtime callbacks where we already
// have the row and just need to know if it belongs to the open conversation.
function _fluxMsgBelongsToConv(msg, convId, myId, isGroup) {
  return isGroup
    ? msg.group_id === convId
    : ((msg.sender_id === myId && msg.receiver_id === convId) || (msg.sender_id === convId && msg.receiver_id === myId));
}

let fluxStagedMedia = [];
let fluxFsStagedMedia = [];
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
  // Archived chats can't be pinned: pinning is meant to keep a chat glued to
  // the top of the main sidebar, and archived chats deliberately don't live
  // there, so offering it here would just be a dead/misleading action.
  if (!isArchived) {
    menu.appendChild(makeItem(isPinned ? 'Unpin' : 'Pin',
      isPinned
        ? '<path d="M12 17v5"/><path d="M15 9.34V6a1 1 0 0 1 1-1 2 2 0 0 0 0-4H9.31"/><path d="M16.13 16.13A2 2 0 0 1 15 17H5a1 1 0 0 1-.71-1.71l.87-.87A2 2 0 0 0 6 13.03V10a1 1 0 0 1 .61-.92"/><line x1="2" x2="22" y1="2" y2="22"/>'
        : '<path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/>',
      () => toggleFluxPin(contactId)));
  }

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

  const searchIcon = '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>';
  const infoIcon = '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>';
  const clearIcon = '<path d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 6 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z"/><line x1="15" x2="9" y1="9" y2="15"/><line x1="9" x2="15" y1="15" y2="9"/>';
  const archiveIcon = '<path d="M21 8v13H3V8"/><rect x="1" y="3" width="22" height="5" rx="1"/><path d="M10 12h4"/>';
  const muteIcon = isMuted
    ? '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>'
    : '<path d="M8.7 3A6 6 0 0 1 18 8c0 2.1.8 3.9 1.6 5.2"/><path d="M17 17H3s3-2 3-9c0-.7.1-1.4.3-2"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/><path d="m2 2 20 20"/>';

  if (isGroup) {
    // All group members have identical group actions.
    menu.appendChild(makeItem(
      'Add member',
      '<path d="M2 21a8 8 0 0 1 13.292-6"/><circle cx="10" cy="8" r="5"/><path d="M19 16v6"/><path d="M22 19h-6"/>',
      () => openAddMembersToGroup(id)
    ));

    menu.appendChild(makeItem('Search', searchIcon, () => openFluxChatSearch(id)));
    menu.appendChild(makeItem('Group info', infoIcon, () => openNicknamePanel()));

    // Keep the destructive action last in the three-dot menu.
    menu.appendChild(makeItem(
      'Clear all',
      clearIcon,
      () => openClearRelayConfirm(id),
      { danger: true }
    ));
  } else {
    menu.appendChild(makeItem('Profile info', infoIcon, () => openNicknamePanel()));
    menu.appendChild(makeItem('Search', searchIcon, () => openFluxChatSearch(id)));
    menu.appendChild(makeItem(
      isArchived ? 'Unarchive' : 'Archive',
      archiveIcon,
      () => toggleFluxArchive(id)
    ));
    menu.appendChild(makeItem(
      isMuted ? 'Unmute' : 'Mute',
      muteIcon,
      () => toggleFluxMute(id)
    ));

    // Keep the destructive action last in the three-dot menu.
    menu.appendChild(makeItem(
      'Clear all',
      clearIcon,
      () => openClearRelayConfirm(id),
      { danger: true }
    ));
  }

  const btn = e.currentTarget || e.target;
  const rect = btn && btn.getBoundingClientRect
    ? btn.getBoundingClientRect()
    : { left: e.clientX, top: e.clientY, width: 0, height: 0 };

  // closeFluxHeaderMoreMenu() hides the menu with an inline display:none.
  // Clear that inline value before measuring/showing it so the button can be
  // opened repeatedly without requiring a page reload.
  menu.style.display = '';
  menu.style.position = 'fixed';
  menu.style.left = Math.max(8, Math.min(
    window.innerWidth - menu.offsetWidth - 8,
    rect.right - menu.offsetWidth
  )) + 'px';
  menu.style.top = Math.min(
    window.innerHeight - menu.offsetHeight - 8,
    rect.bottom + 6
  ) + 'px';
  menu.classList.add('show');
  menu.style.display = '';
  _headerMoreMenuOpen = true;
}
// ── CHAT HISTORY SEARCH ──
let _fluxChatSearchState = null;

function _ensureFluxChatSearchStyles() {
  if (document.getElementById('fluxChatSearchStyles')) return;
  const style = document.createElement('style');
  style.id = 'fluxChatSearchStyles';
  style.textContent = `
    /* Search uses the exact same width/transition as the profile side tab.
       Do not set a fixed width here: the base .flux-profile-tab rule collapses
       the panel when .show is removed. */
    #fluxSearchTab { max-width:calc(100vw - 24px); }
    @media (max-width:640px) {
      #fluxSearchTab, #fluxSearchTab.show {
        position:fixed !important;
        top:0 !important;
        right:0 !important;
        bottom:0 !important;
        left:0 !important;
        width:100vw !important;
        max-width:none !important;
        height:100dvh !important;
        max-height:none !important;
        margin:0 !important;
        border-radius:0 !important;
        transform:none !important;
        z-index:10050 !important;
        box-sizing:border-box !important;
      }
      #fluxSearchTab .flux-chat-search-tab-inner {
        width:100% !important;
        height:100% !important;
        min-height:100% !important;
        border-radius:0 !important;
        box-sizing:border-box !important;
      }
      #fluxSearchTab .flux-chat-search-tab-body {
        min-height:0 !important;
        flex:1 1 auto !important;
        overflow:hidden !important;
        padding-left:12px !important;
        padding-right:12px !important;
      }
      #fluxSearchTab .flux-chat-search-results {
        min-height:0 !important;
        flex:1 1 auto !important;
        overflow-y:auto !important;
        -webkit-overflow-scrolling:touch;
      }
    }
    .flux-chat-search-tab-inner { display:flex; flex-direction:column; min-height:0; width:100%; }
    .flux-chat-search-tab-body { display:flex; flex-direction:column; min-height:0; flex:1; padding:0 0px 18px; }
    .flux-chat-search-tab-input-wrap { position:relative; flex-shrink:0; margin:2px 0 12px; }
    .flux-chat-search-tab-input-wrap svg { position:absolute; left:12px; top:50%; transform:translateY(-50%); width:16px; height:16px; color:#8b8b91; pointer-events:none; }
    .flux-chat-search-input { width:100%; height:42px; box-sizing:border-box; border:1px solid rgba(255,255,255,.08); outline:none; border-radius:9px; padding:0 12px 0 36px; background:#2a2a2e; color:var(--text,#f4f4f5); font:inherit; font-size:13px; }
    .flux-chat-search-input:focus { border-color:rgba(31,199,137,.45); background:#2d2d31; }
    .flux-chat-search-input::placeholder { color:#85858c; }
    .flux-chat-search-results { overflow:auto; min-height:0; flex:1; padding:2px 0 8px;&::-webkit-scrollbar {
    display: none;
  } }
    .flux-chat-search-empty { padding:30px 8px; text-align:center; color:var(--text3,#929298); font-size:12.5px; }
    .flux-chat-search-result { width:100%; text-align:left; border:0; background:transparent; color:inherit; display:block; padding:11px 10px; border-radius:9px; cursor:pointer; }
    .flux-chat-search-result:hover { background:rgba(255,255,255,.06); }
    .flux-chat-search-result-top { display:flex; align-items:center; gap:7px; margin-bottom:4px; }
    .flux-chat-search-result-sender { color:var(--text,#f4f4f5); font-size:12px; font-weight:650; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .flux-chat-search-result-time { margin-left:auto; flex:0 0 auto; color:var(--text3,#85858c); font-size:10.5px; }
    .flux-chat-search-result-text { color:#c5c5ca; font-size:12px; line-height:1.4; overflow:hidden; display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; }
    .flux-chat-search-result-text mark { background:rgba(31,199,137,.22); color:#e9fff6; border-radius:2px; padding:0 1px; }
    .flux-search-jump-highlight { animation: fluxSearchJumpHighlight 1.4s ease; }
    @keyframes fluxSearchJumpHighlight { 0%,100% { background:transparent; } 20%,70% { background:rgba(255,255,255,.14); } }

  `;
  document.head.appendChild(style);
}

function _fluxSearchEscapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function _fluxSearchHighlight(text, query) {
  const safe = escHtml(text || '');
  if (!query) return safe;
  const re = new RegExp(_fluxSearchEscapeRegExp(query), 'ig');
  return safe.replace(re, m => `<mark>${m}</mark>`);
}

function _fluxSearchSenderName(msg, contact, myId) {
  if (msg.message_type === 'system') return 'System';
  if (msg.sender_id === myId) return profile?.username ? profile.username.replace(/^@/, '') : 'You';
  if (contact?.isGroup) return _fluxGroupMsgSenderName(contact, msg.sender_id) || 'User';
  return contact?.username || contact?.realName || contact?.name || 'User';
}

function _fluxSearchMessageText(msg) {
  const content = String(msg?.content || '').trim();
  if (content) return content;
  if (msg?.media_url) return msg.is_video ? 'Video' : 'Photo';
  return '';
}

// Escape a value for a Postgres ILIKE pattern. This keeps %, _ and \\ from
// becoming wildcards while still allowing normal text search.
function _fluxSearchEscapeIlike(value) {
  return String(value || '').replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

async function _fluxFetchMatchingConvMessages(id, myId, isGroup, query) {
  const PAGE_SIZE = 500;
  const pattern = `%${_fluxSearchEscapeIlike(query)}%`;
  let all = [];
  let from = 0;

  // Search directly in the database instead of filtering only the currently
  // loaded chat window. Pagination means chats with thousands of messages are
  // searched completely, including messages beyond Supabase's first 1000 rows.
  while (true) {
    let q = _fluxApplyConvFilter(
      supabaseClient.from('messages').select('id, sender_id, receiver_id, group_id, content, created_at, media_url, is_video, message_type'),
      id, myId, isGroup
    );
    q = q.ilike('content', pattern).order('created_at', { ascending: false }).range(from, from + PAGE_SIZE - 1);

    const { data, error } = await q;
    if (error) return { data: null, error };

    all = all.concat(data || []);
    if (!data || data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return { data: all, error: null };
}

function _fluxPositionChatSearchPanel(panel, anchor) {
  if (!panel) return;
  if (isMobile()) {
    panel.style.top = '58px';
    panel.style.left = '12px';
    return;
  }
  const rect = anchor?.getBoundingClientRect?.();
  const width = panel.offsetWidth || 430;
  const height = panel.offsetHeight || 300;
  let left = rect ? rect.right - width : window.innerWidth - width - 20;
  let top = rect ? rect.bottom + 7 : 70;
  left = Math.max(12, Math.min(left, window.innerWidth - width - 12));
  if (top + height > window.innerHeight - 12) top = Math.max(12, (rect?.top || 70) - height - 7);
  panel.style.left = `${left}px`;
  panel.style.top = `${top}px`;
}

let _fluxChatSearchOpenToken = 0;
let _fluxChatSearchQueryToken = 0;

function _closeFluxChatSearch() {
  _fluxChatSearchOpenToken++;
  _fluxChatSearchQueryToken++;
  const tab = document.getElementById('fluxSearchTab');
  if (tab) tab.classList.remove('show');
  _fluxChatSearchState = null;
}

function _fluxUpdateOpenChatSearchWithMessage(msg, conversationId) {
  const state = _fluxChatSearchState;
  if (!state || !msg) return;
  const id = conversationId || state.conversationId;
  if (!id || id !== state.conversationId) return;

  const msgId = msg.id != null ? String(msg.id) : '';
  if (msgId && state.messages.some(existing => String(existing?.id) === msgId)) return;
  state.messages.push(msg);

  const input = document.getElementById('fluxChatSearchInput');
  if (input && document.getElementById('fluxSearchTab')?.classList.contains('show')) {
    const q = input.value.trim();
    if (q && _fluxSearchMessageText(msg).toLocaleLowerCase().includes(q.toLocaleLowerCase())) {
      _renderFluxChatSearchResults(q);
    }
  }
}

window._fluxUpdateOpenChatSearchWithMessage = _fluxUpdateOpenChatSearchWithMessage;

async function _renderFluxChatSearchResults(query) {
  const state = _fluxChatSearchState;
  const resultsEl = document.getElementById('fluxChatSearchResults');
  if (!state || !resultsEl) return;

  const q = String(query || '').trim();
  if (!q) {
    resultsEl.innerHTML = '<div class="flux-chat-search-empty">Search messages in this chat</div>';
    return;
  }

  const myToken = ++_fluxChatSearchQueryToken;
  resultsEl.innerHTML = '<div class="flux-chat-search-empty">Searching messages...</div>';

  const isGroup = _fluxConvIsGroup(state.conversationId);
  const { data, error } = await _fluxFetchMatchingConvMessages(
    state.conversationId, state.myId, isGroup, q
  );

  // Ignore an older request if the user typed another query, closed Search,
  // or switched conversations while the database request was in flight.
  if (myToken !== _fluxChatSearchQueryToken || state !== _fluxChatSearchState) return;

  if (error) {
    console.warn('[FLUX] chat search query failed:', error.message || error);
    resultsEl.innerHTML = '<div class="flux-chat-search-empty">Could not search messages</div>';
    return;
  }

  const matches = data || [];
  if (!matches.length) {
    resultsEl.innerHTML = '<div class="flux-chat-search-empty">No messages found</div>';
    return;
  }

  // Keep the complete server result set in memory too, so a realtime INSERT
  // can be reflected immediately without losing older search matches.
  const byId = new Map((state.messages || []).map(msg => [String(msg.id), msg]));
  matches.forEach(msg => byId.set(String(msg.id), msg));
  state.messages = Array.from(byId.values());

  const fragment = document.createDocumentFragment();
  matches.forEach(msg => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'flux-chat-search-result';
    const sender = _fluxSearchSenderName(msg, state.contact, state.myId);
    const d = parseSupabaseDate(msg.created_at);
    const time = formatMsgTime(d);
    const text = _fluxSearchMessageText(msg);
    btn.innerHTML = `
      <div class="flux-chat-search-result-top">
        <span class="flux-chat-search-result-sender">${escHtml(sender)}</span>
        <span class="flux-chat-search-result-time">${escHtml(time)}</span>
      </div>
      <div class="flux-chat-search-result-text">${_fluxSearchHighlight(text, q)}</div>
    `;
    btn.addEventListener('click', () => _jumpToFluxSearchMessage(msg.id));
    fragment.appendChild(btn);
  });
  resultsEl.innerHTML = '';
  resultsEl.appendChild(fragment);
}

async function _jumpToFluxSearchMessage(messageId) {
  if (!messageId || !_fluxChatSearchState) return;

  const state = _fluxChatSearchState;
  const safeId = String(messageId);
  const selector = `.flux-bubble-wrap[data-msg-id="${CSS.escape(safeId)}"], .flux-system-msg[data-msg-id="${CSS.escape(safeId)}"]`;
  const containers = [
    document.getElementById('fluxRelayMessages'),
    document.getElementById('fluxFsMessages')
  ].filter(Boolean);

  // If the result is already rendered, never ask the browser to guess where
  // it is. Scroll the actual DOM node by id.
  for (const container of containers) {
    const target = container.querySelector(selector);
    if (target) {
      _closeFluxChatSearch();
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          target.scrollIntoView({ behavior: 'smooth', block: 'center' });
          target.classList.add('flux-search-jump-highlight');
          setTimeout(() => target.classList.remove('flux-search-jump-highlight'), 1400);
        });
      });
      return;
    }
  }

  // The search result can point at a message that is outside the currently
  // paginated chat window. Do NOT render the whole conversation here: that
  // can hit Supabase's row cap and, more importantly, gives scrollIntoView a
  // stale/incorrect DOM position. Instead use the chat's existing exact
  // message loader. It finds the target's position in the conversation,
  // loads the missing section into the current paginated window, preserves
  // the existing scroll position while prepending, and only then scrolls to
  // the exact message node.
  _closeFluxChatSearch();

  // Make sure the selected conversation is still the active one before using
  // the normal pagination state.
  if (activeFluxId !== state.conversationId) return;

  try {
    await scrollToReplyTarget(safeId, '', '');

    // scrollToReplyTarget normally flashes the target itself. The extra exact
    // lookup below is intentionally delayed until layout has settled, so a
    // very old target that was just prepended cannot race the browser layout.
    const container = isMobile()
      ? document.getElementById('fluxFsMessages')
      : document.getElementById('fluxRelayMessages');
    if (!container) return;

    let attempts = 0;
    const findAndCenter = () => {
      const target = container.querySelector(selector);
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        target.classList.add('flux-search-jump-highlight');
        setTimeout(() => target.classList.remove('flux-search-jump-highlight'), 1400);
        return;
      }
      // A prepend can take a couple of frames when many grouped bubbles are
      // being created. Never fall back to a coordinate-based/random scroll.
      if (++attempts < 20) requestAnimationFrame(findAndCenter);
    };
    requestAnimationFrame(findAndCenter);
  } catch (e) {
    console.warn('[FLUX] search jump failed:', e?.message || e);
  }
}

async function openFluxChatSearch(conversationId) {
  const id = conversationId || activeFluxId;
  if (!id) return;

  const profileTab = document.getElementById('fluxProfileTab');
  const replacingProfileTab = !!profileTab?.classList.contains('show');
  if (replacingProfileTab) {
    profileTab.style.transition = 'none';
    profileTab.classList.remove('show');
    void profileTab.offsetWidth;
    profileTab.style.transition = '';
  }

  _closeFluxChatSearch();
  const openToken = ++_fluxChatSearchOpenToken;
  _ensureFluxChatSearchStyles();

  const searchTab = document.getElementById('fluxSearchTab');
  const searchInput = document.getElementById('fluxChatSearchInput');
  if (!searchTab || !searchInput) return;

  searchInput.value = '';
  searchInput.oninput = () => {
    _renderFluxChatSearchResults(searchInput.value);
  };
  searchInput.onkeydown = e => { if (e.key === 'Escape') closeFluxChatSearch(); };

  _fluxChatSearchState = {
    conversationId: id,
    myId: null,
    contact: fluxContacts.find(c => c.id === id),
    messages: []
  };
  _renderFluxChatSearchResults('');

  searchTab.style.transition = 'none';
  searchTab.classList.add('show');
  void searchTab.offsetWidth;
  searchTab.style.transition = '';
  searchInput.focus();

  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user || openToken !== _fluxChatSearchOpenToken || activeFluxId !== id) return;

  const contact = fluxContacts.find(c => c.id === id);
  _fluxChatSearchState.myId = user.id;
  _fluxChatSearchState.contact = contact;

  // Do not rely on the normal chat's paginated/rendered message window.
  // Search itself queries the entire conversation on demand, so every old
  // message remains searchable even when it has never been loaded into UI.
  const currentQuery = searchInput.value.trim();
  if (currentQuery) _renderFluxChatSearchResults(currentQuery);
}

function closeFluxChatSearch() {
  _closeFluxChatSearch();
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
      <div class="flux-search-avatar default-avatar" style="overflow:hidden;position:relative;">
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
  const items = Array.from(e.clipboardData?.items || []);
  const mediaItems = items.filter(item => item.type.startsWith('image/') || item.type.startsWith('video/'));
  if (!mediaItems.length) return;
  e.preventDefault();

  mediaItems.forEach(item => {
    const file = item.getAsFile();
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      cancelReply(mode);
      stageFluxMediaFromDataUrl(ev.target.result, file.type.startsWith('video/'), mode);
    };
    reader.readAsDataURL(file);
  });
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

async function sendMessage(retryText) {
  const input = document.getElementById('userInput');
  const isRetry = retryText !== undefined;
  const text = isRetry ? retryText : input.value.trim();
  if ((!text && !aiStagedMedia) || isTyping) return;

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

  if (!isRetry && aiStagedMedia) {
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
    appendError(() => sendMessage(text));
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
        setTimeout(step, 2 + Math.random() * 3);
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
  bubble.innerHTML = _buildAiThinkingBubbleHtml();
  div.appendChild(bubble); msgs.appendChild(div);
  const typingBubbleHeight = (div.querySelector('.bubble')?.offsetHeight) || div.offsetHeight || 0;
  const maxScrollTip = msgs.scrollHeight - msgs.clientHeight;
  msgs.scrollTop = Math.min(msgs.scrollTop + typingBubbleHeight, maxScrollTip);
  _startAiThinkingRotation(div);
  return div;
}
function removeTyping(el) { _stopAiThinkingRotation(el); if (el && el.parentNode) el.remove(); }

function appendError(onRetry) {
  const msgs = document.getElementById('messages');
  const div = document.createElement('div'); div.className = 'message ai';
  const bubble = document.createElement('div'); bubble.className = 'bubble ai-error-bubble';
  bubble.innerHTML = _buildAiErrorBoxHtml();
  div.appendChild(bubble); msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
  const retryBtn = bubble.querySelector('.ai-error-retry-btn');
  if (retryBtn) {
    retryBtn.onclick = () => {
      retryBtn.disabled = true;
      onRetry();
    };
  }
  return div;
}

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

// FLUX mobile chat layout override: force the fullscreen DM/GC header to a normal height
// and keep the chat input surface consistent with the app surface theme.
(function ensureFluxMobileChatLayout() {
  const styleId = 'fluxMobileChatLayoutOverride';
  const apply = () => {
    if (document.getElementById(styleId)) return;
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      @media (max-width: 640px) {
        #fluxFullscreen .flux-fs-header {
          box-sizing: border-box !important;
          height: 64px !important;
          min-height: 64px !important;
          max-height: 64px !important;
          flex: 0 0 64px !important;
          padding: 0 16px !important;
          background: var(--surface) !important;
        }
        #fluxFullscreen .flux-fs-input-area {
          background: none !important;
        }
        #fluxFullscreen .flux-fs-input-row,
        #fluxFullscreen .flux-input-row {
          background: var(--surface) !important;
        }
      }
    `;
    document.head.appendChild(style);
  };
  if (document.head) apply();
  else document.addEventListener('DOMContentLoaded', apply, { once: true });
})();

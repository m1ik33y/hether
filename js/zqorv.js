function _fluxCategoryOf(contactId) {
  return fluxCategories.get(contactId) || 'primary';
}

function _fluxMutedOf(contactId) {
  return fluxMuted.get(contactId) === true;
}

function _fluxPinnedOf(contactId) {
  return fluxPinned.get(contactId) === true;
}

function _fluxArchivedOf(contactId) {
  return fluxArchived.get(contactId) === true;
}

// ── UNARCHIVE (from open chat header) ──
// Archived chats disappear from the sidebar, so the per-conversation "..."
// menu (which lives on the sidebar row) becomes unreachable for them. This
// mirrors that same Archive/Unarchive toggle directly in the chat header so
// an archived conversation can always be unarchived from within itself.
function _updateUnarchiveBtnVisibility(id) {
  const archived = id ? _fluxArchivedOf(id) : false;
  const desktopBtn = document.getElementById('fluxUnarchiveBtn');
  const fsBtn = document.getElementById('fluxFsUnarchiveBtn');
  if (desktopBtn) desktopBtn.style.display = archived ? 'flex' : 'none';
  if (fsBtn) fsBtn.style.display = archived ? 'flex' : 'none';
}

function _updateGroupMenuBtnVisibility(id) {
  const hasChat = !!id;
  const desktopBtn = document.getElementById('fluxHeaderMoreBtn');
  const mobileBtn = document.getElementById('fluxFsHeaderMoreBtn');
  if (desktopBtn) desktopBtn.style.setProperty('display', hasChat ? 'flex' : 'none', 'important');
  if (mobileBtn) mobileBtn.style.setProperty('display', hasChat ? 'flex' : 'none', 'important');
  const desktopSearchBtn = document.getElementById('fluxHeaderSearchBtn');
  const mobileSearchBtn = document.getElementById('fluxFsHeaderSearchBtn');
  if (desktopSearchBtn) desktopSearchBtn.style.setProperty('display', hasChat ? 'flex' : 'none', 'important');
  if (mobileSearchBtn) mobileSearchBtn.style.setProperty('display', hasChat ? 'flex' : 'none', 'important');
  _updateGroupHeaderMuteVisibility(id);
}

function _setGroupMuteIcon(btn, muted) {
  if (!btn) return;
  const icon = btn.querySelector('svg');
  if (!icon) return;
  // Use the exact same mute/unmute icons as the chat More dropdown.
  // Muted state shows the plain bell (Unmute); unmuted shows the slashed bell (Mute).
  icon.innerHTML = muted
    ? '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>'
    : '<path d="M8.7 3A6 6 0 0 1 18 8c0 2.1.8 3.9 1.6 5.2"/><path d="M17 17H3s3-2 3-9c0-.7.1-1.4.3-2"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/><path d="m2 2 20 20"/>';
  const label = muted ? 'Unmute group' : 'Mute group';
  btn.title = label;
  btn.setAttribute('aria-label', label);
}

function _setFluxHeaderClearIcon(button, isGroup) {
  if (!button) return;
  const icon = button.querySelector('svg');
  if (!icon) return;
  icon.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  icon.setAttribute('width', '24');
  icon.setAttribute('height', '24');
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('fill', 'none');
  icon.setAttribute('stroke', 'currentColor');
  icon.setAttribute('stroke-width', '2');
  icon.setAttribute('stroke-linecap', 'round');
  icon.setAttribute('stroke-linejoin', 'round');
  icon.removeAttribute('class');
  icon.innerHTML = '<path d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z"/><line x1="15" x2="9" y1="9" y2="15"/><line x1="9" x2="15" y1="9" y2="15"/>';
  button.title = 'Clear all';
  button.setAttribute('aria-label', button.title);
}

function _updateGroupHeaderMuteVisibility(id) {
  const isGroup = id ? _fluxConvIsGroup(id) : false;
  const muted = isGroup && _fluxMutedOf(id);

  const desktopClear = document.getElementById('fluxDeleteRelayBtn');
  const mobileClear = document.getElementById('fluxFsDeleteRelayBtn');

  // Clear all is available to every conversation member.
  if (desktopClear) desktopClear.style.display = 'inline-flex';
  if (mobileClear) mobileClear.style.display = 'inline-flex';

  _setFluxHeaderClearIcon(desktopClear, false);
  _setFluxHeaderClearIcon(mobileClear, false);

  [['fluxGroupMuteBtn',null], ['fluxFsGroupMuteBtn',null]].forEach(([btnId, dividerId]) => {
    const btn = document.getElementById(btnId);
    const divider = dividerId ? document.getElementById(dividerId) : null;
    if (btn) btn.style.display = isGroup ? 'inline-flex' : 'none';
    if (divider) divider.style.display = isGroup ? 'block' : 'none';
    if (btn) _setGroupMuteIcon(btn, muted);
  });
}

async function toggleActiveFluxGroupMute() {
  const id = activeFluxId;
  if (!id || !_fluxConvIsGroup(id)) return;
  await toggleFluxMute(id);
  _updateGroupHeaderMuteVisibility(id);
}


function confirmUnarchiveActive() {
  const id = activeFluxId;
  if (!id) return;
  showConfirm(
    'Unarchive conversation?',
    'This chat will move back into your inbox and appear in your sidebar again.',
    'Unarchive',
    async () => {
      await toggleFluxArchive(id);
    }
  );
}

async function toggleFluxArchive(contactId) {
  const wasArchived = _fluxArchivedOf(contactId);
  const newArchived = !wasArchived;

  // The first archive creates the secret before anything is hidden.
  if (newArchived && !_fluxHasArchiveSecret()) {
    openFluxArchiveSecretSetup(contactId);
    return;
  }
  await _archiveFluxContactNow(contactId);
}

async function _archiveFluxContactNow(contactId) {
  const ownerId = _fluxMyUserId || (await supabaseClient.auth.getUser()).data?.user?.id;
  if (!ownerId) return;

  const wasArchived = _fluxArchivedOf(contactId);
  const newArchived = !wasArchived;
  fluxArchived.set(contactId, newArchived);
  _updateUnarchiveBtnVisibility(activeFluxId);

  if (!newArchived) {
    const contactCategory = _fluxCategoryOf(contactId);
    if (fluxActiveTab !== 'all' && fluxActiveTab !== contactCategory) switchFluxTab('all');
    else buildFLUXConvList();
  } else {
    buildFLUXConvList();
  }

  const { error } = await supabaseClient
    .from('chat_categories')
    .upsert(
      { owner_id: ownerId, ..._fluxCatRowKey(contactId), category: _fluxCategoryOf(contactId), muted: _fluxMutedOf(contactId), pinned: _fluxPinnedOf(contactId), archived: newArchived, updated_at: new Date().toISOString() },
      { onConflict: _fluxCatOnConflict(contactId) }
    );

  if (error) {
    console.error('Failed to update archive state:', error.message);
    fluxArchived.set(contactId, wasArchived);
    buildFLUXConvList();
    _updateUnarchiveBtnVisibility(activeFluxId);
    // Surfacing the real Supabase error (instead of a generic message) makes
    // it possible to diagnose *why* it failed. _fluxCatRowKey()/_fluxCatOnConflict()
    // route group ids to chat_categories.group_id (FK -> flux_groups) and contact
    // ids to chat_categories.contact_id (FK -> profiles) — if this still fails,
    // check that split is intact rather than assuming it's a group-vs-contact issue.
    alert('Could not update archive setting: ' + (error.message || 'unknown error') + '\n\nPlease try again.');
  }
}

async function toggleFluxPin(contactId) {
  const ownerId = _fluxMyUserId || (await supabaseClient.auth.getUser()).data?.user?.id;
  if (!ownerId) return;

  // Archived chats can't be pinned — the menu already hides this action for
  // them, but guard here too in case toggleFluxPin ever gets called from
  // somewhere else (e.g. a keyboard shortcut or a stale menu handler).
  if (_fluxArchivedOf(contactId)) return;

  const wasPinned = _fluxPinnedOf(contactId);
  const newPinned = !wasPinned;

  // Optimistic local update
  fluxPinned.set(contactId, newPinned);
  buildFLUXConvList();

  const { error } = await supabaseClient
    .from('chat_categories')
    .upsert(
      { owner_id: ownerId, ..._fluxCatRowKey(contactId), category: _fluxCategoryOf(contactId), muted: _fluxMutedOf(contactId), pinned: newPinned, updated_at: new Date().toISOString() },
      { onConflict: _fluxCatOnConflict(contactId) }
    );

  if (error) {
    console.error('Failed to update pin state:', error.message);
    fluxPinned.set(contactId, wasPinned);
    buildFLUXConvList();
    alert('Could not update pin setting. Please try again.');
  }
}

async function toggleFluxMute(contactId) {
  const ownerId = _fluxMyUserId || (await supabaseClient.auth.getUser()).data?.user?.id;
  if (!ownerId) return;

  const wasMuted = _fluxMutedOf(contactId);
  const newMuted = !wasMuted;

  // Optimistic local update
  fluxMuted.set(contactId, newMuted);
  if (contactId === activeFluxId && _fluxConvIsGroup(contactId)) _updateGroupHeaderMuteVisibility(contactId);
  buildFLUXConvList();

  const { error } = await supabaseClient
    .from('chat_categories')
    .upsert(
      { owner_id: ownerId, ..._fluxCatRowKey(contactId), category: _fluxCategoryOf(contactId), muted: newMuted, pinned: _fluxPinnedOf(contactId), updated_at: new Date().toISOString() },
      { onConflict: _fluxCatOnConflict(contactId) }
    );

  if (error) {
    // Keep mute/unmute silent in the UI. The More-menu mute action and the
    // header mute button both use this same Supabase-backed function.
    console.error('Failed to update mute state:', error.message);
    fluxMuted.set(contactId, wasMuted);
    if (contactId === activeFluxId && _fluxConvIsGroup(contactId)) {
      _updateGroupHeaderMuteVisibility(contactId);
    }
    buildFLUXConvList();
  }
}

function _updateFluxTabCounts(withSentMessages) {
  const isUnreadConvo = c => c.unread && !(c.id === activeFluxId && _isRelayVisibleFor(c.id));
  const primaryCount = withSentMessages.filter(c => _fluxCategoryOf(c.id) === 'primary' && isUnreadConvo(c)).length;
  const generalCount = withSentMessages.filter(c => _fluxCategoryOf(c.id) === 'general' && isUnreadConvo(c)).length;
  [['fluxPrimaryCount', primaryCount], ['fluxFsPrimaryCount', primaryCount],
   ['fluxGeneralCount', generalCount], ['fluxFsGeneralCount', generalCount]].forEach(([id, count]) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = count;
    el.dataset.zero = count === 0 ? 'true' : 'false';
  });
}

function switchFluxTab(tab, mode) {
  fluxActiveTab = tab;
  ['fluxTabBar', 'fluxFsTabBar'].forEach(barId => {
    const bar = document.getElementById(barId);
    if (!bar) return;
    bar.querySelectorAll('.flux-tab-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tab));
  });
  buildFLUXConvList();
}

function buildFLUXConvList() {
  const searchTerm = (_fluxSidebarSearchTerm || '').trim();
  // Normal sidebar: conversations where the user has participated, PLUS
  // anything pinned — a pinned chat stays in the list even with zero message
  // history so it never disappears just because nothing's been sent yet.
  // Search is broader for groups: any unarchived group the user is currently
  // a member of may appear if it matches the query.
  const baseContacts = _fluxArchivedView
    ? fluxContacts.filter(c => _fluxArchivedOf(c.id))
    : fluxContacts.filter(c => (c.sentByMe === true || _fluxPinnedOf(c.id)) && !_fluxArchivedOf(c.id));
  const withSentMessages = searchTerm
    ? (_fluxArchivedView
        ? baseContacts.filter(c => (c.realName || c.name || '').toLowerCase().includes(searchTerm))
        // Search should reach every backend profile (and group), not just
        // the ones already in the sidebar's "has an active conversation"
        // list — but still respect the user's own archive choices.
        : fluxContacts.filter(c => !_fluxArchivedOf(c.id) && (c.realName || c.name || c.username || '').toLowerCase().includes(searchTerm)))
    : baseContacts;
  _updateFluxTabCounts(withSentMessages);
  const inActiveTab = fluxActiveTab === 'all'
    ? withSentMessages
    : withSentMessages.filter(c => _fluxCategoryOf(c.id) === fluxActiveTab);
  // While searching, results are just matches on the query — pinned/unread/
  // recency ordering only makes sense for "my list" and shouldn't keep
  // existing DMs glued to the top over an otherwise-better search match.
  const sorted = searchTerm
    ? [...inActiveTab].sort((a, b) => (a.realName || a.name || '').localeCompare(b.realName || b.name || ''))
    : [...inActiveTab].sort((a, b) => {
        const aPinned = _fluxPinnedOf(a.id) ? 1 : 0;
        const bPinned = _fluxPinnedOf(b.id) ? 1 : 0;
        if (bPinned !== aPinned) return bPinned - aPinned;
        const aUnread = a.unread && !(a.id === activeFluxId && _isRelayVisibleFor(a.id)) ? 1 : 0;
        const bUnread = b.unread && !(b.id === activeFluxId && _isRelayVisibleFor(b.id)) ? 1 : 0;
        if (bUnread !== aUnread) return bUnread - aUnread;
        return (b.lastMessageTs || 0) - (a.lastMessageTs || 0);
      });

  ['fluxConvList', 'fluxFsConvList'].forEach(listId => {
    const list = document.getElementById(listId);
    if (!list) return;
    const isFsList = listId === 'fluxFsConvList';
    list.innerHTML = '';

    // Once the archive key has been entered successfully, show Archived as a
    // normal DM-style sidebar row. It is intentionally not part of search results.
    if (!_fluxArchivedView && _fluxArchiveEntryUnlocked && !searchTerm) {
      list.appendChild(_buildFluxArchivedSidebarItem(isFsList));
    }

    if (sorted.length === 0) {
      if (!searchTerm && !_fluxArchivedView && _fluxArchiveEntryUnlocked) {
        return;
      }
      if (searchTerm) {
        list.innerHTML = `
          <div class="flux-sidebar-no-user">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-message-square-off-icon lucide-message-square-off"><path d="M19 19H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.7.7 0 0 1 2 21.286V5a2 2 0 0 1 1.184-1.826"/><path d="m2 2 20 20"/><path d="M8.656 3H20a2 2 0 0 1 2 2v11.344"/></svg>
            <div>No user found</div>
          </div>`;
        return;
      }
      const emptyMsg = withSentMessages.length === 0
        ? (_fluxArchivedView ? 'No archived chats.<br><span style="font-size:11.5px;opacity:0.7;">Archived chats will appear here.</span>' : 'No conversations yet.<br><span style="font-size:11.5px;opacity:0.7;">Search above to start relayting.</span>')
        : (fluxActiveTab === 'general'
            ? 'No general chats.<br><span style="font-size:11.5px;opacity:0.7;">Chats you move here will show up in this tab.</span>'
            : 'No primary chats.<br><span style="font-size:11.5px;opacity:0.7;">Check the General tab.</span>');
      list.innerHTML = `<div style="padding:28px 16px;text-align:center;font-size:12.5px;color:var(--text3);line-height:1.7;">${emptyMsg}</div>`;
      return;
    }

    sorted.forEach(c => {
      const item = document.createElement('div');
      item.className = 'flux-conv-item' + (c.id === activeFluxId ? ' active' : '');
      item.dataset.id = c.id;
      item.onclick = () => {
        // Leaving the temporary archive-unlocked state as soon as a normal
        // DM is selected prevents the Archived row from lingering.
        _fluxArchiveEntryUnlocked = false;
        isFsList ? openFsRelay(c.id) : openDesktopRelay(c.id);
      };
      // A realtime-cleared conversation must stay visually blank even if
      // another hydration path temporarily leaves stale lastMessage data on
      // the contact object. A genuinely new message removes the tombstone.
      const lastMsg = _fluxRealtimeClearedConversations.has(c.id) ? null : c.lastMessage;
      const isUnread = c.unread && !(c.id === activeFluxId && _isRelayVisibleFor(c.id));
      const unreadCount = isUnread ? (c.unreadCount || 0) : 0;

      // Build preview text
      // DMs: show "You: " when the last message is yours (so you can tell
      // at a glance you're the one who sent it), but never show the other
      // person's name — there's only one other possible sender in a DM so
      // it's redundant. Groups still need the sender's name since any
      // member could be the sender.
      let previewHtml = '';
      const senderPrefix = type => {
        if (type === 'sent') return 'You: ';
        return c.isGroup ? `${lastMsg?.senderName || c.name}: ` : '';
      };
      const mediaPreviewText = lastMsg && lastMsg.media && !(lastMsg.text || '').trim()
        ? `${senderPrefix(lastMsg.type)}sent an attachment`
        : null;
      if (isUnread && unreadCount >= 2) {
        const label = unreadCount > 4 ? '4+ new messages' : `${unreadCount} new messages`;
        previewHtml = `<div class="flux-conv-preview unread">${label}</div>`;
      } else if (isUnread && unreadCount === 1) {
        const msgText = mediaPreviewText || (lastMsg ? senderPrefix(lastMsg.type) + (lastMsg.text || '') : '');
        const truncated = msgText.length > 38 ? msgText.substring(0, 38) + '…' : msgText;
        previewHtml = `<div class="flux-conv-preview unread">${escHtml(truncated)}</div>`;
      } else {
        const msgText = mediaPreviewText || (lastMsg ? senderPrefix(lastMsg.type) + (lastMsg.text || '') : '');
        previewHtml = `<div class="flux-conv-preview">${escHtml(msgText)}</div>`;
      }

      // Badge: always just a dot regardless of count
      let badgeHtml = isUnread ? '<div class="flux-unread-dot"></div>' : '';

      // FIX 1: Conv list avatar using proper silhouette
      // Groups with no custom avatar_url get a "two member pfps" default
      // avatar instead of the generic single silhouette. That default isn't
      // itself circular (it's two separate circles), so the wrapper must not
      // clip it with its own circular mask the way a normal single pfp does.
      const isDualAvatar = c.isGroup && !c.avatarUrl;
      const avatarInner = c.avatarUrl
        ? `<img src="${c.avatarUrl}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%;display:block;">`
        : (c.isGroup ? buildDualAvatarHtml(c.memberAvatars) : DEFAULT_AVATAR_SVG);
      const avatarBg = c.avatarUrl ? 'transparent' : (c.isGroup ? 'transparent' : '#e8e8ec');
      const avatarWrapStyle = isDualAvatar
        ? `background:${avatarBg};overflow:visible;border-radius:0;position:relative;`
        : `background:${avatarBg};overflow:hidden;position:relative;`;

      const isOnlineInList = onlineUsers.has(c.id);
      item.innerHTML = `
        <div class="flux-conv-avatar-wrap">
          <div class="flux-conv-avatar${isDualAvatar ? '' : ' default-avatar'}" style="${avatarWrapStyle}">
            ${avatarInner}
          </div>
          <div class="flux-conv-presence-dot${isOnlineInList ? ' online' : ''}" data-presence-user="${c.id}"></div>
        </div>
        <div class="flux-conv-info">
          <div class="flux-conv-toprow">
            <div class="flux-conv-name">${escHtml(c.name)}</div>
            <div class="flux-conv-time">${lastMsg ? lastMsg.time : ''}</div>
          </div>
          <div class="flux-conv-bottomrow">
            ${previewHtml}
            <div class="flux-conv-meta">
              ${_fluxMutedOf(c.id) ? '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--text3)" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M8.7 3A6 6 0 0 1 18 8c0 2.1.8 3.9 1.6 5.2"/><path d="M17 17H3s3-2 3-9c0-.7.1-1.4.3-2"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/><path d="m2 2 20 20"/></svg>' : ''}
              ${_fluxPinnedOf(c.id) ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text3)" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/></svg>' : ''}
              ${_fluxArchivedOf(c.id) ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text3)" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="5" rx="1"/><path d="M5 9v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9"/><line x1="10" y1="13" x2="14" y2="13"/></svg>' : ''}
              ${badgeHtml}
            </div>
          </div>
        </div>
        <button class="flux-conv-menu-btn" onclick="event.stopPropagation(); openFluxConvMenu(event, '${c.id}')">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
      `;
      list.appendChild(item);
    });
  });
}

async function loadContacts() {
  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) return;
  _fluxMyUserId = user.id;
  const [{ data }, { data: nicknameRows }, { data: categoryRows }] = await Promise.all([
    supabaseClient.from('profiles').select('id, username, display_name, avatar_url'),
    supabaseClient.from('nicknames').select('target_id, nickname').eq('setter_id', user.id),
    supabaseClient.from('chat_categories').select('contact_id, group_id, category, muted, pinned, archived').eq('owner_id', user.id)
  ]);
  if (!data) return;

  // Load every group the current user belongs to (not just ones they own).
  // Groups use their own conversation id and are kept in the same local
  // contact collection so the normal sidebar renderer can display them like
  // other conversations. Filtering by owner_id alone previously meant that
  // anyone added to a group by someone else would never see it in their
  // sidebar at all.
  let groupRows = [];
  try {
    const { data: memberRows, error: memberErr } = await supabaseClient
      .from('flux_group_members')
      .select('group_id')
      .eq('user_id', user.id);
    if (memberErr) throw memberErr;
    const myGroupIds = [...new Set((memberRows || []).map(r => r.group_id))];
    if (myGroupIds.length) {
      const { data: groups, error: groupsError } = await supabaseClient
        .from('flux_groups')
        .select('id, owner_id, name, name_is_custom, avatar_url, created_at, updated_at')
        .in('id', myGroupIds)
        .order('updated_at', { ascending: false });
      if (groupsError) throw groupsError;
      groupRows = groups || [];
    }
  } catch (e) {
    console.warn('[FLUX] group sidebar load failed:', e.message || e);
  }
  // Keep every group the user is currently a member of in the local search
  // pool, but separately track where they have actually sent a message.
  // Normal sidebar rendering uses that participation flag; search may still
  // surface any matching unarchived group membership.
  let groupIdsWithMyMessage = new Set();
  if (groupRows.length) {
    try {
      const { data: myGroupMessages, error: myGroupMessagesErr } = await supabaseClient
        .from('messages')
        .select('group_id')
        .eq('sender_id', user.id)
        .in('group_id', groupRows.map(g => g.id));
      if (myGroupMessagesErr) throw myGroupMessagesErr;

      groupIdsWithMyMessage = new Set(
        (myGroupMessages || []).map(m => m.group_id).filter(Boolean)
      );
    } catch (e) {
      console.warn('[FLUX] group participation check failed:', e.message || e);
      // Fail closed for the normal sidebar, while preserving verified current
      // membership so group search still works.
      groupIdsWithMyMessage = new Set();
    }
  }

  _fluxMyGroupIds = new Set(groupRows.map(g => g.id));

  fluxCategories.clear();
  fluxMuted.clear();
  fluxPinned.clear();
  fluxArchived.clear();
  (categoryRows || []).forEach(row => {
    const convId = row.contact_id || row.group_id;
    fluxCategories.set(convId, row.category);
    if (row.muted) fluxMuted.set(convId, true);
    if (row.pinned) fluxPinned.set(convId, true);
    if (row.archived) fluxArchived.set(convId, true);
  });
  // Build a quick lookup: target_id -> nickname
  const nicknameMap = {};
  (nicknameRows || []).forEach(row => { nicknameMap[row.target_id] = row.nickname; });
  const existingMap = new Map(fluxContacts.map(c => [c.id, c]));
  fluxContacts.length = 0;
  const colors = [
    'linear-gradient(135deg,#5b6af0,#a855f7)',
    'linear-gradient(135deg,#f97316,#ec4899)',
    'linear-gradient(135deg,#22c55e,#06b6d4)',
    'linear-gradient(135deg,#6366f1,#0ea5e9)',
    'linear-gradient(135deg,#f43f5e,#8b5cf6)',
    'linear-gradient(135deg,#14b8a6,#06b6d4)'
  ];
  let colorIdx = 0;
  data.forEach(u => {
    if (u.id === user.id) return;
    const existing = existingMap.get(u.id);
    const rawUsername = u.username || 'User';
    const realName = u.display_name || rawUsername;
    const nickname = nicknameMap[u.id] || null;
    const displayName = nickname || realName;
    fluxContacts.push({
      id: u.id,
      name: displayName,
      realName: realName,
      username: rawUsername,
      nickname: nickname,
      initials: displayName[0].toUpperCase(),
      avatarUrl: u.avatar_url || null, color: colors[colorIdx % colors.length], online: true,
      lastMessage: existing && !_fluxRealtimeClearedConversations.has(u.id) ? existing.lastMessage : null,
      lastMessageTs: existing && !_fluxRealtimeClearedConversations.has(u.id) ? existing.lastMessageTs : 0,
      unread: existing ? existing.unread : false,
      unreadCount: existing ? (existing.unreadCount || 0) : 0,
      sentByMe: existing ? existing.sentByMe : false,
    });
    colorIdx++;
  });

  // Batch-fetch membership for every group the user is in, so the sidebar
  // can build a "two overlapping member pfps" default avatar for groups that
  // have no custom avatar_url set (mirrors what _fluxFetchGroupMembers does
  // per-group, just done once here for the whole list).
  const groupMembersByGroup = new Map();
  if (groupRows.length) {
    const { data: allMemberRows } = await supabaseClient
      .from('flux_group_members')
      .select('group_id, user_id')
      .in('group_id', groupRows.map(g => g.id));
    (allMemberRows || []).forEach(r => {
      if (!groupMembersByGroup.has(r.group_id)) groupMembersByGroup.set(r.group_id, []);
      groupMembersByGroup.get(r.group_id).push(r.user_id);
    });
  }
  const profileById = new Map((data || []).map(u => [u.id, u]));

  // Add every current group membership. sentByMe is only true when the user
  // has actually participated, so cleared/inactive groups stay out of the
  // normal sidebar after reload but remain searchable while unarchived.
  groupRows.forEach(g => {
    const existing = existingMap.get(g.id);
    const memberIds = groupMembersByGroup.get(g.id) || existing?.groupMembers || [];
    const pickedMemberIds = _fluxPickTwoGroupMembers(g.id, memberIds);
    const memberAvatars = pickedMemberIds.map(id => profileById.get(id)?.avatar_url || null);
    fluxContacts.push({
      id: g.id,
      groupId: g.id,
      isGroup: true,
      name: g.name || 'Group',
      realName: g.name || 'Group',
      username: g.name || 'Group',
      nickname: null,
      initials: (g.name || 'G').charAt(0).toUpperCase(),
      avatarUrl: g.avatar_url || null,
      memberAvatars: memberAvatars,
      color: null,
      online: false,
       ownerId: g.owner_id,
       nameIsCustom: g.name_is_custom === true,
       groupMembers: memberIds,
      groupMemberProfiles: Object.fromEntries(memberIds.map(id => {
        const profile = profileById.get(id);
        return [id, { username: profile?.username || '', displayName: profile?.display_name || profile?.username || 'User', avatarUrl: profile?.avatar_url || null }];
      })),
      lastMessage: existing && !_fluxRealtimeClearedConversations.has(g.id) ? (existing.lastMessage || null) : null,
      lastMessageTs: existing && !_fluxRealtimeClearedConversations.has(g.id) ? (existing.lastMessageTs || new Date(g.updated_at || g.created_at || 0).getTime()) : 0,
      unread: existing?.unread || false,
      unreadCount: existing?.unreadCount || 0,
      sentByMe: groupIdsWithMyMessage.has(g.id),
      category: existing?.category || 'primary'
    });
  });

  // ── INBOX GROUPING (beta) ──
  // When enabled, a group chat someone else added me to lands straight in
  // Archived instead of the DM sidelist, the first time it's ever seen.
  // "First time" is tracked implicitly: chat_categories only ever gets a row
  // for a contact/group once the user (or this logic) touches its settings,
  // so a group with no existing row is by definition brand new to this
  // account. This also means a manual unarchive afterwards sticks, since a
  // row now exists and this block never touches it again.
  //
  // Guarded on _fluxHasArchiveSecret(): the Archived folder can only ever be
  // opened again by typing the exact secret the user chose — it's a local
  // hash, nothing server-side backs it up. Auto-archiving before a secret
  // exists would strand the group somewhere the user has no way to unlock,
  // which is worse than just leaving it in the main list. So if no secret is
  // set up yet, Inbox Grouping simply doesn't act; the group shows normally
  // until the user sets up an archive secret (e.g. by manually archiving
  // anything once), after which newly-added groups start being caught here.
  if (_inboxGroupingEnabled && _fluxHasArchiveSecret()) {
    const alreadySeen = new Set((categoryRows || []).map(row => row.contact_id || row.group_id));
    const newlyAddedGroups = groupRows.filter(g => g.owner_id !== user.id && !alreadySeen.has(g.id));
    if (newlyAddedGroups.length) {
      newlyAddedGroups.forEach(g => fluxArchived.set(g.id, true));
      supabaseClient
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
        )
        .then(({ error }) => {
          if (error) console.warn('[FLUX] inbox grouping auto-archive failed:', error.message);
        });
    }
  }

  fluxContacts.forEach(c => {
    if (!c.isGroup) watchUserPresence(c.id);
  });
}

function showFluxEmptyState() {
  document.getElementById('fluxEmptyState').style.display = 'flex';
  document.getElementById('fluxActiveRelayWrap').style.display = 'none';
}

function showSkeletonMessages(container) {
  container.innerHTML = '';
  for (let i = 0; i < 5; i++) {
    const isSent = i % 2 === 0;
    const sk = document.createElement('div');
    sk.className = `flux-skeleton-msg${isSent ? ' sent' : ''}`;
    if (!isSent) { const av = document.createElement('div'); av.className = 'flux-skeleton-av'; sk.appendChild(av); }
    const bub = document.createElement('div');
    bub.className = 'flux-skeleton-bubble';
    bub.style.width = (60 + Math.random() * 80) + 'px';
    sk.appendChild(bub);
    container.appendChild(sk);
  }
}

async function openDesktopRelay(id) {
  _fluxArchiveEntryUnlocked = false;
  const contact = fluxContacts.find(c => c.id === id);
  if (!contact) return;
  contact.unread = false;
  contact.unreadCount = 0;
  hideRemoteTyping();
  closeFluxChatSearch();
  document.getElementById('fluxProfileTab')?.classList.remove('show');
  activeFluxId = id;
  _updateUnarchiveBtnVisibility(id);
  _updateGroupMenuBtnVisibility(id);

  const myToken = ++_fluxLoadToken;

  document.querySelectorAll('#fluxConvList .flux-conv-item').forEach(el => el.classList.toggle('active', el.dataset.id === id));
  document.getElementById('fluxTopbarName').textContent = contact.name;
  const usernameEl = document.getElementById('fluxTopbarUsername');
  if (usernameEl) {
    const raw = contact.username || contact.realName || contact.name;
    usernameEl.textContent = raw;
  }
  if (_fluxConvIsGroup(id)) {
    _fluxUpdateGroupHeaderMembers(id);
  }
  const av = document.getElementById('fluxTopbarAvatar');
  // FIX 1: topbar avatar — groups with no custom avatar_url get the same
  // "two overlapping member pfps" default used in the sidebar list, instead
  // of the generic single silhouette.
  _fluxSetProfileTabAvatar(av, contact.avatarUrl, (contact.isGroup && !contact.avatarUrl) ? contact.memberAvatars : null);

  resetPresenceDots();
  updatePresenceDots();
  document.getElementById('fluxEmptyState').style.display = 'none';
  document.getElementById('fluxActiveRelayWrap').style.display = 'flex';

  // Kick off theme fetch immediately in parallel — no blocking yet
  const themePromise = loadRelayThemeFromSupabase(id);
  subscribeToRelayTheme(id);

  _startLoadBar('fluxRelayLoadBar', 'fluxRelayLoadFill');
  _startLoadBar('fluxFsRelayLoadBar', 'fluxFsRelayLoadFill');
  const fsMsgsEl = document.getElementById('fluxFsMessages');
  if (fsMsgsEl) fsMsgsEl.classList.add('flux-loading');
  const msgsEl = document.getElementById('fluxRelayMessages');
  if (msgsEl) msgsEl.classList.add('flux-loading');
  msgsEl.innerHTML = '';

  const { data: { user } } = await supabaseClient.auth.getUser();
  // Bail if user switched away while we were awaiting
  if (_fluxLoadToken !== myToken) return;

  if (user) await setupTypingChannel(user.id, id);
  if (_fluxLoadToken !== myToken) return;

  await themePromise;
  if (_fluxLoadToken !== myToken) return;

  await loadMessages(id, myToken);

  cancelReply();
  if (currentEditState) { currentEditState = null; document.getElementById('fluxEditBar')?.classList.remove('show'); document.getElementById('fluxFsEditBar')?.classList.remove('show'); }
  clearFluxStaging();
  document.getElementById('fluxInput').focus();
  markConversationSeen(id);
}

async function openNicknamePanel() {
  if (!activeFluxId) return;

  const searchTab = document.getElementById('fluxSearchTab');
  const tab = document.getElementById('fluxProfileTab');
  const replacingSearchTab = !!searchTab?.classList.contains('show');

  if (replacingSearchTab) {
    // Search -> Profile is a true tab replacement: remove Search and put
    // Profile in the exact same frame, with no slide/width transition.
    // This avoids the visible "search closes, then profile opens" glitch.
    searchTab.style.transition = 'none';
    searchTab.classList.remove('show');
    void searchTab.offsetWidth;

    tab.style.transition = 'none';
    tab.classList.add('show');
    void tab.offsetWidth;

    searchTab.style.transition = '';
    tab.style.transition = '';
  } else {
    // Normal Profile opening keeps its existing slide-in animation.
    tab.getBoundingClientRect();
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        tab.classList.add('show');
      });
    });
  }

  // Load the profile data in parallel; the tab is already visible when
  // switching from Search, so there is no visual gap while data loads.
  await loadNicknameSideTab(activeFluxId);
}

function closeNicknamePanel() {
  document.getElementById('fluxProfileTab').classList.remove('show');
}

async function loadNicknameSideTab(targetId) {
  if (!targetId) return;
  activeFluxProfileTarget = targetId;
  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) return;

  if (_fluxConvIsGroup(targetId)) {
    await loadGroupInfoSideTab(targetId, user.id);
    return;
  }

  // Reset in case a group panel was open right before this
  const titleEl = document.getElementById('fluxProfileTabTitle');
  if (titleEl) titleEl.textContent = 'Profile';
  const mutualSection = document.getElementById('fluxMutualSection');
  if (mutualSection) mutualSection.style.display = '';
  const groupSection = document.getElementById('fluxGroupMembersSection');
  if (groupSection) groupSection.style.display = 'none';
  hideGroupNameEditor();
  const groupNameEditBtn = document.getElementById('fluxGroupNameEditBtn');
  if (groupNameEditBtn) groupNameEditBtn.style.display = 'none';
  const groupSettingsBtn = document.getElementById('fluxGroupSettingsBtn');
  if (groupSettingsBtn) groupSettingsBtn.style.display = 'none';
  const groupNameRow = document.getElementById('fluxGroupNameRow');
  if (groupNameRow) groupNameRow.classList.remove('is-group');
  const closeBtn = document.getElementById('fluxProfileCloseBtn');
  if (closeBtn) closeBtn.style.display = '';

  const [{ data: profileData }, { data: nicknameRows }, { data: theirNicknameForMeRows }] = await Promise.all([
    supabaseClient.from('profiles').select('username, display_name, avatar_url').eq('id', targetId).single(),
    supabaseClient.from('nicknames').select('nickname').eq('setter_id', user.id).eq('target_id', targetId).order('created_at', { ascending: false }).limit(1),
    supabaseClient.from('nicknames').select('nickname').eq('setter_id', targetId).eq('target_id', user.id).order('created_at', { ascending: false }).limit(1)
  ]);

  const rawUsername = profileData?.username || 'User';
  const profileName = profileData?.display_name || rawUsername;
  activeFluxNickname = nicknameRows?.[0]?.nickname || null;
  const displayName = activeFluxNickname || profileName;
  const actualUsername = profileData?.username || 'Unknown user';

  document.getElementById('fluxProfileTabName').textContent = displayName;
  document.getElementById('fluxProfileTabUsername').textContent = actualUsername;
  const avatarEl = document.getElementById('fluxProfileTabAvatar');
  avatarEl.classList.remove('flux-avatar-editable');
  _fluxSetProfileTabAvatar(avatarEl, profileData?.avatar_url || null);

  // Mutual names section: their pfp + name (top), my pfp + what they call me (bottom)
  const theirMutualAvatar = document.getElementById('fluxMutualTheirAvatar');
  if (theirMutualAvatar) setAvatarEl(theirMutualAvatar, profileData?.avatar_url || null);
  const theirMutualName = document.getElementById('fluxMutualTheirName');
  if (theirMutualName) theirMutualName.textContent = displayName;
  const theirMutualUsername = document.getElementById('fluxMutualTheirUsername');
  if (theirMutualUsername) theirMutualUsername.textContent = actualUsername;

  const myMutualAvatar = document.getElementById('fluxMutualMyAvatar');
  if (myMutualAvatar) setAvatarEl(myMutualAvatar, profile?.avatarUrl || null);
  const theirNicknameForMe = theirNicknameForMeRows?.[0]?.nickname || null;
  const myMutualName = document.getElementById('fluxMutualMyName');
  if (myMutualName) myMutualName.textContent = theirNicknameForMe || profile?.name || 'You';
  const myMutualUsername = document.getElementById('fluxMutualMyUsername');
  if (myMutualUsername) myMutualUsername.textContent = (profile?.username ? profile.username.replace(/^@/, '') : 'you');

  // Reset editor state (button visible, editor hidden)
  hideNicknameEditor();

  // Reset theme picker state
  _themePickerOpen = false;
  const picker = document.getElementById('fluxThemePicker');
  const chevron = document.getElementById('fluxThemeChevron');
  if (picker) picker.classList.remove('open');
  if (chevron) chevron.style.transform = '';
}

// Fetches the live membership list for a group (role + profile info),
// rather than relying on the client-side `groupMembers` cache on the
// contact object, which is only ever populated at creation time and is
// empty for anyone who was added by someone else.
async function _fluxFetchGroupMembers(groupId) {
  const { data: memberRows } = await supabaseClient
    .from('flux_group_members')
    .select('user_id, role')
    .eq('group_id', groupId);
  const ids = (memberRows || []).map(r => r.user_id);
  if (!ids.length) return [];
  const { data: profileRows } = await supabaseClient
    .from('profiles')
    .select('id, username, display_name, avatar_url')
    .in('id', ids);
  const roleMap = new Map((memberRows || []).map(r => [r.user_id, r.role]));
  const profileMap = new Map((profileRows || []).map(p => [p.id, p]));
  return ids.map(id => {
    const p = profileMap.get(id) || {};
    return {
      id,
      role: roleMap.get(id) || 'member',
      username: p.username || 'user',
      name: p.display_name || p.username || 'User',
      avatarUrl: p.avatar_url || null
    };
  });
}

function _fluxGroupDefaultMemberLabel(member, index) {
  const raw = String(member?.username || member?.name || '').replace(/^@/, '').trim();
  return raw || `user${index + 1}`;
}

async function _fluxBuildDefaultGroupName(groupId) {
  const { data: memberRows, error: memberError } = await supabaseClient
    .from('flux_group_members')
    .select('user_id, created_at')
    .eq('group_id', groupId)
    .order('created_at', { ascending: true });
  if (memberError) throw memberError;

  const ids = (memberRows || []).map(row => row.user_id).filter(Boolean);
  if (!ids.length) return 'Group';

  const { data: profiles, error: profileError } = await supabaseClient
    .from('profiles')
    .select('id, username, display_name')
    .in('id', ids);
  if (profileError) throw profileError;

  const profileMap = new Map((profiles || []).map(p => [p.id, p]));
  return ids
    .map((id, index) => _fluxGroupDefaultMemberLabel(profileMap.get(id), index))
    .join(', ')
    .slice(0, 80) || 'Group';
}

function _fluxApplyGroupNameLocally(groupId, name) {
  const value = name || 'Group';
  fluxContacts.forEach(contact => {
    if (contact.groupId === groupId || contact.id === groupId) {
      contact.name = value;
      contact.realName = value;
      contact.username = value;
      contact.initials = value.charAt(0).toUpperCase();
    }
  });
  if (activeFluxId === groupId) {
    const topbarName = document.getElementById('fluxTopbarName');
    if (topbarName) topbarName.textContent = value;
    const fsName = document.getElementById('fluxFsName');
    if (fsName) fsName.textContent = value;
    if (activeFluxProfileTarget === groupId) {
      const mobName = document.getElementById('mobProfileSheetName');
      if (mobName) mobName.textContent = value;
    }
    // For groups, the second header row is the member list, not the group name.
    if (_fluxConvIsGroup(groupId)) {
      _fluxUpdateGroupHeaderMembers(groupId);
    } else {
      const topbarUsername = document.getElementById('fluxTopbarUsername');
      if (topbarUsername) topbarUsername.textContent = value;
    }
  }
  try { buildFLUXConvList(); } catch (e) {}
}

// ── Group avatar: dropdown menu (Upload photo / Remove photo) ──
let _groupAvatarMenuOpen = false;

function openGroupAvatarMenu(e) {
  const groupId = activeFluxProfileTarget;
  // The avatar box is shared with DM profiles — only groups get the menu.
  if (!groupId || !_fluxConvIsGroup(groupId)) return;
  e.stopPropagation();
  const menu = document.getElementById('fluxGroupAvatarMenu');
  if (!menu) return;
  const contact = fluxContacts.find(c => c.id === groupId);
  const hasCustomAvatar = !!(contact && contact.avatarUrl);
  menu.innerHTML = '';

  const makeItem = (label, iconPath, onClick, opts) => {
    opts = opts || {};
    const btn = document.createElement('button');
    btn.className = 'flux-conv-menu-item' + (opts.danger ? ' danger' : '');
    if (opts.disabled) btn.disabled = true;
    btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${iconPath}</svg> ${label}`;
    btn.onclick = (ev) => { ev.stopPropagation(); closeGroupAvatarMenu(); if (!opts.disabled) onClick(); };
    return btn;
  };

  menu.appendChild(makeItem('Upload photo',
    '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
    () => document.getElementById('fluxGroupAvatarUpload').click()));

  menu.appendChild(makeItem('Remove photo',
    '<path d="M3 6h18"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>',
    () => removeGroupAvatar(groupId), { danger: true, disabled: !hasCustomAvatar }));

  const btn = e.currentTarget || e.target;
  const rect = btn.getBoundingClientRect ? btn.getBoundingClientRect() : { left: e.clientX, top: e.clientY, width: 0, height: 0 };
  menu.style.display = 'block';
  menu.classList.add('show');
  _groupAvatarMenuOpen = true;

  requestAnimationFrame(() => {
    const mw = menu.offsetWidth, mh = menu.offsetHeight;
    let left = rect.left + rect.width / 2 - mw / 2;
    if (left + mw > window.innerWidth - 8) left = window.innerWidth - mw - 8;
    if (left < 8) left = 8;
    let top = rect.bottom + 6;
    if (top + mh > window.innerHeight - 8) top = rect.top - mh - 6;
    menu.style.left = left + 'px';
    menu.style.top = top + 'px';
  });
}

function closeGroupAvatarMenu() {
  const menu = document.getElementById('fluxGroupAvatarMenu');
  if (!menu) return;
  menu.classList.remove('show'); menu.style.display = 'none'; _groupAvatarMenuOpen = false;
}

document.addEventListener('click', (e) => {
  if (_groupAvatarMenuOpen && !document.getElementById('fluxGroupAvatarMenu').contains(e.target) && !e.target.closest('#fluxProfileTabAvatar')) closeGroupAvatarMenu();
});

// -- Group photo upload (no crop -- upload as-is, displayed cover) --
let _gacGroupId = null;

function handleGroupAvatarUpload(e) {
  const file = e.target.files[0];
  e.target.value = ''; // allow re-selecting the same file next time
  if (!file) return;
  const groupId = activeFluxProfileTarget;
  if (!groupId || !_fluxConvIsGroup(groupId)) return;
  _gacGroupId = groupId;
  uploadCroppedGroupAvatar(file);
}


async function uploadCroppedGroupAvatar(file) {
  const groupId = _gacGroupId;
  if (!groupId) return;

  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) return;

  // Clean up the previous custom avatar file for this group, if any.
  const contact = fluxContacts.find(c => c.id === groupId);
  if (contact?.avatarUrl) {
    try {
      const path = contact.avatarUrl.split('/avatars/')[1]?.split('?')[0];
      if (path) await supabaseClient.storage.from('avatars').remove([path]);
    } catch (err) {}
  }

  const filePath = `group_${groupId}/avatar.png`;
  const { error: uploadError } = await supabaseClient.storage.from('avatars').upload(filePath, file, { upsert: true });
  if (uploadError) { alert('Upload failed: ' + uploadError.message); return; }

  const { data } = supabaseClient.storage.from('avatars').getPublicUrl(filePath);
  const publicUrl = data.publicUrl + `?t=${Date.now()}`;

  const { error: rpcError } = await supabaseClient.rpc('set_flux_group_avatar', {
    p_group_id: groupId,
    p_avatar_url: publicUrl
  });
  if (rpcError) { alert('Failed to save group photo: ' + rpcError.message); return; }

  _fluxApplyGroupAvatarLocally(groupId, publicUrl);

  try {
    const myName = (await supabaseClient.from('profiles').select('username').eq('id', user.id).single()).data?.username || 'Someone';
    await _fluxPostSystemMessage(groupId, `${myName} changed the group icon.`);
  } catch (e) {
    console.warn('[FLUX] group-icon-change system message failed:', e.message || e);
  }
}

async function removeGroupAvatar(groupId) {
  if (!groupId) return;
  const contact = fluxContacts.find(c => c.id === groupId);
  if (contact?.avatarUrl) {
    try {
      const path = contact.avatarUrl.split('/avatars/')[1]?.split('?')[0];
      if (path) await supabaseClient.storage.from('avatars').remove([path]);
    } catch (err) {}
  }

  const { error } = await supabaseClient.rpc('set_flux_group_avatar', {
    p_group_id: groupId,
    p_avatar_url: null
  });
  if (error) { alert('Failed to remove group photo: ' + error.message); return; }

  _fluxApplyGroupAvatarLocally(groupId, null);

  try {
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (user) {
      const myName = (await supabaseClient.from('profiles').select('username').eq('id', user.id).single()).data?.username || 'Someone';
      await _fluxPostSystemMessage(groupId, `${myName} removed the group icon.`);
    }
  } catch (e) {
    console.warn('[FLUX] group-icon-remove system message failed:', e.message || e);
  }
}

// Mirrors _fluxApplyGroupNameLocally: pushes a changed group avatar_url into
// every place it's rendered (sidebar row, open topbar, open group-info panel)
// without a full reload.
function _fluxApplyProfileLocally(userId, profileData) {
  if (!userId) return;

  // Keep the local media-sending permission flag in sync live, so an admin
  // toggling it from the vault terminal takes effect immediately instead of
  // only after the member's next page load.
  if (currentUser?.id && userId === currentUser.id && profileData && Object.prototype.hasOwnProperty.call(profileData, 'media_perm')) {
    window._cachedMediaPerm = profileData.media_perm !== false;
  }

  const avatarUrl = profileData?.avatar_url || null;
  const username = profileData?.username || '';
  const displayName = profileData?.display_name || username || 'User';

  // Update the direct 1-to-1 contact everywhere it is cached/rendered.
  const dmContact = fluxContacts.find(c => c.id === userId && !c.isGroup);
  if (dmContact) {
    dmContact.avatarUrl = avatarUrl;
    if (username) dmContact.username = username;
    if (profileData?.display_name) dmContact.realName = displayName;
  }

  // Update this member's cached profile inside every group they belong to.
  fluxContacts.forEach(contact => {
    if (!contact.isGroup || !contact.groupMembers?.includes(userId)) return;
    if (!contact.groupMemberProfiles) contact.groupMemberProfiles = {};
    const existing = contact.groupMemberProfiles[userId] || {};
    contact.groupMemberProfiles[userId] = {
      ...existing,
      username: username || existing.username || '',
      displayName: displayName || existing.displayName || 'User',
      avatarUrl
    };

    // Rebuild the group's default two-member avatar when it has no custom icon.
    if (!contact.avatarUrl) {
      const pickedIds = _fluxPickTwoGroupMembers(contact.id, contact.groupMembers || []);
      contact.memberAvatars = pickedIds.map(id => {
        if (id === userId) return avatarUrl;
        const member = fluxContacts.find(c => c.id === id && !c.isGroup);
        return member?.avatarUrl || contact.groupMemberProfiles?.[id]?.avatarUrl || null;
      });
    }
  });

  // Update already-rendered individual message avatars without reopening the chat.
  document.querySelectorAll('.flux-group-avatar[data-sender-id]').forEach(el => {
    if (el.dataset.senderId !== userId) return;
    if (avatarUrl) {
      el.style.background = 'transparent';
      el.classList.remove('default-avatar');
      el.innerHTML = '';
      const img = document.createElement('img');
      img.src = avatarUrl;
      img.alt = '';
      el.appendChild(img);
    } else {
      el.style.background = '#e8e8ec';
      el.classList.add('default-avatar');
      el.innerHTML = typeof DEFAULT_AVATAR_SVG !== 'undefined' ? DEFAULT_AVATAR_SVG : '';
    }
  });

  if (activeFluxId === userId && !_fluxConvIsGroup(userId)) {
    const dmContactNow = fluxContacts.find(c => c.id === userId);
    const targets = [
      document.getElementById('fluxTopbarAvatar'),
      document.getElementById('fluxFsAvatar'),
      document.getElementById('fluxProfileTabAvatar'),
      document.getElementById('mobProfileSheetAvatar')
    ];
    targets.forEach(el => { if (el) _fluxSetProfileTabAvatar(el, avatarUrl); });
  }

  // If this member is represented by a group's default icon, refresh any open group UI.
  fluxContacts.filter(c => c.isGroup && c.groupMembers?.includes(userId) && !c.avatarUrl).forEach(group => {
    if (activeFluxId === group.id) {
      const topbarAv = document.getElementById('fluxTopbarAvatar');
      const fsAv = document.getElementById('fluxFsAvatar');
      if (topbarAv) _fluxSetProfileTabAvatar(topbarAv, null, group.memberAvatars);
      if (fsAv) _fluxSetProfileTabAvatar(fsAv, null, group.memberAvatars);
    }
    if (activeFluxProfileTarget === group.id) {
      const panelAv = document.getElementById('fluxProfileTabAvatar');
      const mobAv = document.getElementById('mobProfileSheetAvatar');
      if (panelAv) _fluxSetProfileTabAvatar(panelAv, null, group.memberAvatars);
      if (mobAv) _fluxSetProfileTabAvatar(mobAv, null, group.memberAvatars);
    }
  });

  try { buildFLUXConvList(); } catch (e) {}
}

function _fluxApplyGroupMetadataLocally(groupId, patch) {
  if (!groupId || !patch) return;
  if (Object.prototype.hasOwnProperty.call(patch, 'name')) {
    _fluxApplyGroupNameLocally(groupId, patch.name);
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'avatar_url')) {
    _fluxApplyGroupAvatarLocally(groupId, patch.avatar_url);
  }
}

async function _fluxSetupMetadataRealtime(userId) {
  if (!userId || !supabaseClient) return;

  const remove = async (key) => {
    const ch = window[key];
    if (ch) {
      try { await supabaseClient.removeChannel(ch); } catch (e) {}
      window[key] = null;
    }
  };

  const profileState = window._fluxProfileMetaChannel?.state;
  if (!window._fluxProfileMetaChannel || profileState === 'closed' || profileState === 'errored') {
    await remove('_fluxProfileMetaChannel');
    window._fluxProfileMetaChannel = supabaseClient
      .channel(`profile-meta:${userId}`)
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'profiles'
      }, payload => {
        const row = payload.new;
        if (!row?.id) return;
        _fluxApplyProfileLocally(row.id, row);
      })
      .subscribe();
  }

  const groupState = window._fluxGroupMetaChannel?.state;
  if (!window._fluxGroupMetaChannel || groupState === 'closed' || groupState === 'errored') {
    await remove('_fluxGroupMetaChannel');
    window._fluxGroupMetaChannel = supabaseClient
      .channel(`group-meta:${userId}`)
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'flux_groups'
      }, payload => {
        const row = payload.new;
        if (!row?.id || !_fluxMyGroupIds?.has(row.id)) return;
        _fluxApplyGroupMetadataLocally(row.id, row);
      })
      .subscribe();
  }
}

function _fluxApplyGroupAvatarLocally(groupId, avatarUrl) {
  const contact = fluxContacts.find(c => c.id === groupId);
  if (contact) contact.avatarUrl = avatarUrl;

  if (activeFluxId === groupId) {
    const desktopAv = document.getElementById('fluxTopbarAvatar');
    if (desktopAv) _fluxSetProfileTabAvatar(desktopAv, avatarUrl, avatarUrl ? null : contact?.memberAvatars);
    const fsAv = document.getElementById('fluxFsAvatar');
    if (fsAv) _fluxSetProfileTabAvatar(fsAv, avatarUrl, avatarUrl ? null : contact?.memberAvatars);
    const mobAv = document.getElementById('mobProfileSheetAvatar');
    if (mobAv && activeFluxProfileTarget === groupId) _fluxSetProfileTabAvatar(mobAv, avatarUrl, avatarUrl ? null : contact?.memberAvatars);
  }
  if (activeFluxProfileTarget === groupId) {
    const panelAv = document.getElementById('fluxProfileTabAvatar');
    if (panelAv) _fluxSetProfileTabAvatar(panelAv, avatarUrl, avatarUrl ? null : contact?.memberAvatars);
  }
  try { buildFLUXConvList(); } catch (e) {}
}

async function _fluxUpdateGroupHeaderMembers(groupId, members) {
  if (!groupId || !_fluxConvIsGroup(groupId)) return;
  try {
    const list = members || await _fluxFetchGroupMembers(groupId);
    const labels = list.map((member, index) => _fluxGroupDefaultMemberLabel(member, index)).filter(Boolean);
    const text = labels.join(', ') || 'No members';
    const desktop = document.getElementById('fluxTopbarUsername');
    const mobile = document.getElementById('fluxFsUsername');
    if (desktop) desktop.textContent = text;
    if (mobile) mobile.textContent = text;
  } catch (e) {
    console.warn('[FLUX] failed to update group header members:', e.message || e);
  }
}

function showGroupNameEditor() {
  const groupId = activeFluxProfileTarget || activeFluxId;
  if (!groupId || !_fluxConvIsGroup(groupId)) return;
  const editor = document.getElementById('fluxGroupNameEditor');
  const input = document.getElementById('fluxGroupNameInput');
  const current = document.getElementById('fluxProfileTabName')?.textContent || '';
  if (!editor || !input) return;
  input.value = current === 'Group' ? '' : current;
  editor.style.display = 'flex';
  input.focus();
  input.select();
}

function hideGroupNameEditor() {
  const editor = document.getElementById('fluxGroupNameEditor');
  if (editor) editor.style.display = 'none';
}

function groupNameInputKey(e) {
  if (e.key === 'Enter') {
    e.preventDefault();
    commitGroupName();
  } else if (e.key === 'Escape') {
    e.preventDefault();
    hideGroupNameEditor();
  }
}

async function commitGroupName() {
  const groupId = activeFluxProfileTarget || activeFluxId;
  const input = document.getElementById('fluxGroupNameInput');
  if (!groupId || !_fluxConvIsGroup(groupId) || !input) return;
  const name = input.value.trim().slice(0, 80);
  if (!name) return;

  const { error } = await supabaseClient.rpc('set_flux_group_name', {
    p_group_id: groupId,
    p_name: name,
    p_is_custom: true
  });

  if (error) {
    alert('Failed to change group name: ' + error.message);
    return;
  }

  const nameEl = document.getElementById('fluxProfileTabName');
  if (nameEl) nameEl.textContent = name;
  _fluxApplyGroupNameLocally(groupId, name);
  hideGroupNameEditor();

  try {
    const { data: { user } } = await supabaseClient.auth.getUser();
    const myName = user ? ((await supabaseClient.from('profiles').select('username').eq('id', user.id).single()).data?.username || 'Someone') : 'Someone';
    await _fluxPostSystemMessage(groupId, `${myName} changed the group name to "${name}".`);
  } catch (e) {
    console.warn('[FLUX] group-name-change system message failed:', e.message || e);
  }
}

// Sets the profile-tab avatar box, resetting any inline overrides left over
// from a previous render (e.g. a group's clip-free dual avatar) before
// applying the new one. Pass `dualAvatarUrls` (array of up to 2 urls) for a
// group with no custom avatar_url to get the "two member pfps" default;
// otherwise a normal single circular avatar (or silhouette) is used.
function _fluxSetProfileTabAvatar(el, avatarUrl, dualAvatarUrls) {
  if (avatarUrl) {
    el.style.overflow = 'hidden';
    el.style.borderRadius = '50%';
    el.style.background = '';
    setAvatarEl(el, avatarUrl);
  } else if (dualAvatarUrls) {
    // Two separate circles, not one clipped avatar — the box itself must
    // not mask them into a single bigger circle.
    el.classList.remove('default-avatar');
    el.style.overflow = 'visible';
    el.style.borderRadius = '0';
    el.style.background = 'transparent';
    el.innerHTML = buildDualAvatarHtml(dualAvatarUrls);
  } else {
    el.style.overflow = 'hidden';
    el.style.borderRadius = '50%';
    el.style.background = '';
    setAvatarEl(el, null);
  }
}

async function loadGroupInfoSideTab(groupId, myUserId) {
  const titleEl = document.getElementById('fluxProfileTabTitle');
  if (titleEl) titleEl.textContent = 'Group Info';

  // Group-only sections vs DM-only sections
  const mutualSection = document.getElementById('fluxMutualSection');
  if (mutualSection) mutualSection.style.display = 'none';
  const groupSection = document.getElementById('fluxGroupMembersSection');
  if (groupSection) groupSection.style.display = '';
  const editor = document.getElementById('fluxNicknameEditor');
  if (editor) editor.style.display = 'none';
  hideGroupNameEditor();
  const groupNameRow = document.getElementById('fluxGroupNameRow');
  const groupNameEditBtn = document.getElementById('fluxGroupNameEditBtn');
  if (groupNameRow) groupNameRow.classList.add('is-group');

  const { data: groupData } = await supabaseClient
    .from('flux_groups')
    .select('name, name_is_custom, avatar_url')
    .eq('id', groupId)
    .single();

  const groupName = groupData?.name || 'Group';
  document.getElementById('fluxProfileTabName').textContent = groupName;
  const groupNameInput = document.getElementById('fluxGroupNameInput');
  if (groupNameInput) groupNameInput.value = groupName === 'Group' ? '' : groupName;

  const members = await _fluxFetchGroupMembers(groupId);

  // All group members are equal in the UI.
  const canChangePfp = true;
  const canChangeName = true;
  if (groupNameEditBtn) groupNameEditBtn.style.display = 'flex';

  const avatarEl = document.getElementById('fluxProfileTabAvatar');
  avatarEl.classList.toggle('flux-avatar-editable', canChangePfp);
  const pickedIds = _fluxPickTwoGroupMembers(groupId, members.map(m => m.id));
  const memberAvatars = pickedIds.map(id => (members.find(m => m.id === id) || {}).avatarUrl || null);
  _fluxSetProfileTabAvatar(avatarEl, groupData?.avatar_url || null, groupData?.avatar_url ? null : memberAvatars);
  // Keep the in-memory contact in sync with what we just fetched, so a
  // later avatar change (upload/remove) has fresh data to fall back to.
  const _groupContact = fluxContacts.find(c => c.id === groupId);
  if (_groupContact) {
    _groupContact.avatarUrl = groupData?.avatar_url || null;
    _groupContact.memberAvatars = memberAvatars;
    _groupContact.memberAvatars = memberAvatars;
  }

  const usernameEl = document.getElementById('fluxProfileTabUsername');
  if (usernameEl) usernameEl.textContent = `${members.length} member${members.length === 1 ? '' : 's'}`;

  const listEl = document.getElementById('fluxGroupMembersList');
  if (listEl) {
    listEl.innerHTML = members.map(m => {
      const avatar = m.avatarUrl ? `<img src="${escHtml(m.avatarUrl)}" alt="">` : DEFAULT_AVATAR_SVG;
      const nameLabel = m.id === myUserId ? 'You' : escHtml(m.name);
      return `<div class="flux-mutual-row">
        <div class="flux-mutual-avatar">${avatar}</div>
        <div class="flux-mutual-name-col">
          <div class="flux-mutual-name-wrap">
            <div class="flux-mutual-name">${nameLabel}</div>
          </div>
          <div class="flux-mutual-username">@${escHtml((m.username || '').replace(/^@/,''))}</div>
        </div>
      </div>`;
    }).join('');
  }

  // Reset theme picker state
  _themePickerOpen = false;
  const picker = document.getElementById('fluxThemePicker');
  const chevron = document.getElementById('fluxThemeChevron');
  if (picker) picker.classList.remove('open');
  if (chevron) chevron.style.transform = '';
}



async function openNicknameEditor() {
  if (!activeFluxProfileTarget) return;
  showNicknameEditor();
}

function showNicknameEditor() {
  const input = document.getElementById('fluxNicknameInput');
  const editor = document.getElementById('fluxNicknameEditor');
  const editBtn = document.getElementById('fluxNicknameEditBtn');
  if (!editor) return;
  if (input) input.value = activeFluxNickname || '';
  if (editBtn) editBtn.style.display = 'none';
  editor.style.display = 'flex';
  if (input) input.focus();
}

function hideNicknameEditor() {
  const editor = document.getElementById('fluxNicknameEditor');
  const editBtn = document.getElementById('fluxNicknameEditBtn');
  if (!editor) return;
  editor.style.display = 'none';
  if (editBtn) editBtn.style.display = 'flex';
}

function nicknameInputKey(e) {
  if (e.key === 'Enter') { e.preventDefault(); commitNickname(); }
  if (e.key === 'Escape') hideNicknameEditor();
}

async function commitNickname() {
  const input = document.getElementById('fluxNicknameInput');
  const val = (input?.value || '').trim();
  await saveNicknameForTarget(val);
  hideNicknameEditor();
}

async function clearNickname() {
  await saveNicknameForTarget('');
  hideNicknameEditor();
}

async function saveNicknameForTarget(nickname) {
  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user || !activeFluxProfileTarget) return;

  const contact = fluxContacts.find(c => c.id === activeFluxProfileTarget);
  const targetRealName = contact?.realName || contact?.name || 'them';
  const myName = (await supabaseClient.from('profiles').select('username').eq('id', user.id).single()).data?.username || 'You';

  let systemText = null;

  if (nickname === '') {
    await supabaseClient.from('nicknames').delete()
      .eq('setter_id', user.id)
      .eq('target_id', activeFluxProfileTarget);
    activeFluxNickname = null;
    systemText = `${myName} removed the nickname for ${targetRealName}.`;
  } else {
    await supabaseClient.from('nicknames').upsert(
      [{ setter_id: user.id, target_id: activeFluxProfileTarget, nickname }],
      { onConflict: 'setter_id,target_id' }
    );
    activeFluxNickname = nickname;
    systemText = `${myName} set the nickname for ${targetRealName} to "${nickname}".`;
  }

  if (systemText && activeFluxId === activeFluxProfileTarget) {
    await supabaseClient.from('messages').insert({
      sender_id: user.id,
      receiver_id: activeFluxProfileTarget,
      content: systemText,
      message_type: 'system'
    });
  }

  if (contact) {
    contact.nickname = activeFluxNickname;
    contact.name = activeFluxNickname || contact.realName || contact.name;
    contact.initials = contact.name[0].toUpperCase();
    buildFLUXConvList();
    if (activeFluxId === activeFluxProfileTarget) {
      const topbarName = document.getElementById('fluxTopbarName');
      if (topbarName) topbarName.textContent = contact.name;
      const fsName = document.getElementById('fluxFsName');
      if (fsName) fsName.textContent = contact.name;
      const rawUser = contact.username || contact.realName || contact.name;
      const usernameEl = document.getElementById('fluxTopbarUsername');
      if (usernameEl) usernameEl.textContent = rawUser;
      const fsUsernameEl = document.getElementById('fluxFsUsername');
      if (fsUsernameEl) fsUsernameEl.textContent = '@' + rawUser;
      if (_fluxConvIsGroup(activeFluxId)) {
        _fluxUpdateGroupHeaderMembers(activeFluxId);
      }
    }
  }

  await loadNicknameSideTab(activeFluxProfileTarget);
}

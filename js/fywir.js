async function loadMessages(userId, loadToken) {
  const token = loadToken !== undefined ? loadToken : _fluxLoadToken;
  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) { _hideLoadBar(); return; }
  if (_fluxLoadToken !== token) return; // stale — user already switched

  await subscriptionManager.replaceSubscription(null);
  renderedMsgIds.clear();
  fluxDesktopOffset = 0;
  fluxDesktopAllLoaded = false;
  fluxDesktopLoadingMore = false;
  fluxDesktopUserId = userId;
  fluxDesktopUser = user;
  fluxDesktopContact = fluxContacts.find(c => c.id === userId);
  const msgsEl = document.getElementById('fluxRelayMessages');
  if (!msgsEl) { _hideLoadBar(); return; }
  const isGroupConv = _fluxConvIsGroup(userId);

  try {
    // Count total
    const { count } = await _fluxApplyConvFilter(
      supabaseClient.from('messages').select('*', { count: 'exact', head: true }), userId, user.id, isGroupConv
    );

    if (_fluxLoadToken !== token) return; // switched while counting

    const total = count || 0;
    fluxDesktopOffset = Math.max(0, total - FLUX_PAGE_SIZE);
    if (fluxDesktopOffset === 0) fluxDesktopAllLoaded = true;

    const { data, error } = await _fluxApplyConvFilter(
      supabaseClient.from('messages').select('*'), userId, user.id, isGroupConv
    )
      .order('created_at', { ascending: true })
      .range(fluxDesktopOffset, total - 1);

    if (_fluxLoadToken !== token) return; // switched while fetching

    if (error) { _hideLoadBar(); return; }
    if (data && data.length > 0) {
      data.forEach(m => { if (m.id) renderedMsgIds.add(m.id); });
      const groups = groupMessages(data.map(m => ({ ...m, ts: m.created_at })));
      renderGroupedMessages(msgsEl, groups, user.id, fluxDesktopContact);
      if (!fluxDesktopAllLoaded) {
        prependLoadMoreIndicator(msgsEl, 'desktop');
      }
      const last = data[data.length - 1];
      updateContactLastMsg(userId, last, user.id);
    } else { msgsEl.innerHTML = ''; }
  } catch (err) { msgsEl.innerHTML = ''; }

  _hideLoadBar();

  // Scroll listener for pagination
  msgsEl.onscroll = null;
  msgsEl.onscroll = () => {
    if (msgsEl.scrollTop < 80 && !fluxDesktopLoadingMore && !fluxDesktopAllLoaded) {
      loadMoreMessagesDesktop();
    }
  };

  try {
    const channel = supabaseClient.channel(`messages:${user.id}:${userId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload) => {
        const newMsg = payload.new;
        const isForThis = _fluxMsgBelongsToConv(newMsg, userId, user.id, isGroupConv);
        if (!isForThis) return;
        if (renderedMsgIds.has(newMsg.id)) return;
        renderedMsgIds.add(newMsg.id);
        if (activeFluxId === userId) {
          // FIX 2: instead of full reload, smartly append into correct group
          appendIncomingMessage(msgsEl, newMsg, user.id, fluxDesktopContact);
          updateContactLastMsg(userId, newMsg, user.id);
          buildFLUXConvList();
          // Only mark as seen if the tab is actually visible & focused. Group
          // read receipts aren't tracked per-message yet, so skip the DB call
          // for groups — it's a no-op anyway since group rows have no
          // receiver_id, but no point issuing it.
          if (!isGroupConv && _isRelayVisibleFor(userId)) {
            markConversationSeen(userId).then(() => fixSeenLabels(msgsEl));
          } else if (isGroupConv && _isRelayVisibleFor(userId)) {
            fixSeenLabels(msgsEl);
          } else {
            // Treat as unread so the title badge and conv list update
            const contact = fluxContacts.find(c => c.id === userId);
            if (contact) {
              contact.unread = true;
              contact.unreadCount = (contact.unreadCount || 0) + 1;
            }
            _updateTitleUnreadBadge();
          }
        }
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages' }, (payload) => {
        const updated = payload.new;
        if (!updated) return;
        const isForThis = _fluxMsgBelongsToConv(updated, userId, user.id, isGroupConv);
        if (!isForThis) return;
        // Handle edit updates
        if (updated.edited) {
          ['fluxRelayMessages', 'fluxFsMessages'].forEach(cId => {
            const container = document.getElementById(cId);
            if (!container) return;
            const bWrap = container.querySelector(`.flux-bubble-wrap[data-msg-id="${updated.id}"]`);
            if (bWrap) applyEditToBubble(bWrap, updated.content, updated.sender_id === user.id);
          });
        }
        // Handle reaction updates — sync to both containers for both users
        if (updated.reactions !== undefined) {
          if (updated.id) _reactionCache[updated.id] = updated.reactions || {};
          ['fluxRelayMessages', 'fluxFsMessages'].forEach(cId => {
            const container = document.getElementById(cId);
            if (!container) return;
            const bWrap = container.querySelector(`.flux-bubble-wrap[data-msg-id="${updated.id}"]`);
            if (bWrap) applyReactionsToWrap(bWrap, updated.reactions || {}, user.id);
          });
        }
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'messages' }, async (payload) => {
        if (activeFluxId !== userId) return;
        if (_clearingRelayForUserId === userId) return;
        // Surgically remove just the deleted bubble — no full re-render needed.
        const deletedId = payload.old?.id;
        if (deletedId) {
          const bWrap = msgsEl.querySelector(`.flux-bubble-wrap[data-msg-id="${deletedId}"]`);
          if (bWrap) {
            const parentGroup = bWrap.closest('.flux-msg-group');
            bWrap.remove();
            if (parentGroup && parentGroup.querySelectorAll('.flux-bubble-wrap').length === 0) parentGroup.remove();
          }
        }
        const { data: lastMsg } = await _fluxApplyConvFilter(
          supabaseClient.from('messages').select('*'), userId, user.id, isGroupConv
        )
          .order('created_at', { ascending: false }).limit(1).single();
        if (lastMsg) { updateContactLastMsg(userId, lastMsg, user.id); }
        else { buildFLUXConvList(); }
      })
      .subscribe();
    await subscriptionManager.replaceSubscription(channel);
  } catch (err) {}
}

function _startLoadBar(barId, fillId) {
  const bar = document.getElementById(barId);
  const fill = document.getElementById(fillId);
  if (!bar || !fill) return;
  // Reset
  fill.style.transition = 'none';
  fill.style.width = '0%';
  bar.classList.add('active');
  // Kick off fake progress: fast to ~75%, then slow crawl to ~88%
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      fill.style.transition = 'width 0.7s cubic-bezier(0.25, 1, 0.5, 1)';
      fill.style.width = '75%';
      setTimeout(() => {
        fill.style.transition = 'width 2.5s cubic-bezier(0.1, 0.9, 0.3, 1)';
        fill.style.width = '88%';
      }, 720);
    });
  });
}

function _finishLoadBar(barId, fillId) {
  const bar = document.getElementById(barId);
  const fill = document.getElementById(fillId);
  if (!bar || !fill) return;
  // Snap to 100%, then fade out
  fill.style.transition = 'width 0.22s cubic-bezier(0.4, 0, 0.2, 1)';
  fill.style.width = '100%';
  setTimeout(() => {
    bar.style.transition = 'opacity 0.25s ease';
    bar.classList.remove('active');
    // Reset fill after fade
    setTimeout(() => {
      fill.style.transition = 'none';
      fill.style.width = '0%';
      bar.style.transition = '';
    }, 280);
  }, 240);
}

function _hideLoadBar() {
  _finishLoadBar('fluxRelayLoadBar', 'fluxRelayLoadFill');
  _finishLoadBar('fluxFsRelayLoadBar', 'fluxFsRelayLoadFill');
  const msgsEl = document.getElementById('fluxRelayMessages');
  if (msgsEl) {
    msgsEl.classList.remove('flux-loading');
    requestAnimationFrame(() => { msgsEl.scrollTop = msgsEl.scrollHeight; });
  }
  const fsMsgsEl2 = document.getElementById('fluxFsMessages');
  if (fsMsgsEl2) {
    fsMsgsEl2.classList.remove('flux-loading');
    requestAnimationFrame(() => { fsMsgsEl2.scrollTop = fsMsgsEl2.scrollHeight; });
  }
}

function prependLoadMoreIndicator(container, mode) {
  const existing = container.querySelector('.flux-load-more-indicator');
  if (existing) existing.remove();
  const indicator = document.createElement('div');
  indicator.className = 'flux-load-more-indicator';
  indicator.style.cssText = 'text-align:center;padding:8px;font-size:11.5px;color:var(--text3);cursor:pointer;user-select:none;';
  indicator.textContent = '↑ Scroll up to load more';
  container.insertBefore(indicator, container.firstChild);
}

async function loadMoreMessagesDesktop() {
  if (fluxDesktopAllLoaded || fluxDesktopLoadingMore || !fluxDesktopUserId || !fluxDesktopUser) return;
  fluxDesktopLoadingMore = true;
  const msgsEl = document.getElementById('fluxRelayMessages');
  if (!msgsEl) { fluxDesktopLoadingMore = false; return; }

  const newEnd = fluxDesktopOffset - 1;
  const newStart = Math.max(0, fluxDesktopOffset - FLUX_LOAD_MORE);
  if (newStart <= 0) fluxDesktopAllLoaded = true;
  fluxDesktopOffset = newStart;

  try {
    const { data } = await _fluxApplyConvFilter(
      supabaseClient.from('messages').select('*'), fluxDesktopUserId, fluxDesktopUser.id, _fluxConvIsGroup(fluxDesktopUserId)
    )
      .order('created_at', { ascending: true })
      .range(newStart, newEnd);

    if (data && data.length > 0) {
      const prevScrollHeight = msgsEl.scrollHeight;
      const groups = groupMessages(data.map(m => ({ ...m, ts: m.created_at })));
      // Build fragment and prepend
      const frag = document.createDocumentFragment();
      groups.forEach(item => {
        if (item.type === 'separator') {
          const sep = document.createElement('div');
          sep.className = 'flux-time-separator'; sep.textContent = item.label;
          frag.appendChild(sep);
        } else if (item.type === 'system') {
          frag.appendChild(makeSystemMsgEl(item.content));
        } else {
          const isSent = item.sender_id === fluxDesktopUser.id;
          const groupEl = document.createElement('div');
          groupEl.className = `flux-msg-group ${isSent ? 'sent' : 'received'}`;
          groupEl.dataset.groupTs = item.groupKey;
          groupEl.dataset.senderId = item.sender_id;
          groupEl.dataset.minuteKey = item.minuteKey;
          groupEl.dataset.createdAt = item.firstTs || '';
          const rowEl = document.createElement('div');
          rowEl.className = 'flux-msg-group-row';
          if (!isSent) rowEl.appendChild(makeGroupAvatar(fluxDesktopContact));
          const bubblesWrap = document.createElement('div');
          bubblesWrap.className = 'flux-msg-bubbles';
          const collapsed = collapseMediaGroups(item.messages);
          collapsed.forEach(msg => {
            if (msg.type === 'mediaGroup') {
              msg.msgs.forEach(m => { if (m.id) renderedMsgIds.add(m.id); });
              bubblesWrap.appendChild(makeMediaCollageBubble(msg, isSent, fluxDesktopContact, fluxDesktopUser.id));
            } else {
              if (msg.id) renderedMsgIds.add(msg.id);
              bubblesWrap.appendChild(makeBubbleWrap(msg, isSent, fluxDesktopContact, fluxDesktopUser.id));
            }
          });
          applyBubbleGrouping(bubblesWrap);
          rowEl.appendChild(bubblesWrap);
          groupEl.appendChild(rowEl);
          const timeEl = document.createElement('div');
          timeEl.className = 'flux-group-time'; timeEl.textContent = item.time;
          groupEl.appendChild(timeEl);
          frag.appendChild(groupEl);
        }
      });
      const indicator = msgsEl.querySelector('.flux-load-more-indicator');
      if (indicator) { msgsEl.insertBefore(frag, indicator.nextSibling); indicator.remove(); }
      else { msgsEl.insertBefore(frag, msgsEl.firstChild); }
      mergeAdjacentGroups(msgsEl);
      if (!fluxDesktopAllLoaded) prependLoadMoreIndicator(msgsEl, 'desktop');
      // Maintain scroll position
      msgsEl.scrollTop = msgsEl.scrollHeight - prevScrollHeight;
    } else {
      fluxDesktopAllLoaded = true;
      const indicator = msgsEl.querySelector('.flux-load-more-indicator');
      if (indicator) indicator.remove();
    }
  } catch(e) {}
  fluxDesktopLoadingMore = false;
}

let fluxMobileOffset = 0;
let fluxMobileAllLoaded = false;
let fluxMobileLoadingMore = false;
let fluxMobileUserId = null;
let fluxMobileUser = null;
let fluxMobileContact = null;

async function loadFsMessages(userId) {
  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) return;
  await subscriptionManager.replaceSubscription(null);
  renderedMsgIds.clear();
  fluxMobileOffset = 0;
  fluxMobileAllLoaded = false;
  fluxMobileLoadingMore = false;
  fluxMobileUserId = userId;
  fluxMobileUser = user;
  fluxMobileContact = fluxContacts.find(c => c.id === userId);
  const msgsEl = document.getElementById('fluxFsMessages');
  if (!msgsEl) return;
  const isGroupConv = _fluxConvIsGroup(userId);

  try {
    const { count } = await _fluxApplyConvFilter(
      supabaseClient.from('messages').select('*', { count: 'exact', head: true }), userId, user.id, isGroupConv
    );
    const total = count || 0;
    fluxMobileOffset = Math.max(0, total - FLUX_PAGE_SIZE);
    if (fluxMobileOffset === 0) fluxMobileAllLoaded = true;

    const { data, error } = await _fluxApplyConvFilter(
      supabaseClient.from('messages').select('*'), userId, user.id, isGroupConv
    )
      .order('created_at', { ascending: true })
      .range(fluxMobileOffset, total - 1);
    if (error) return;
    if (data && data.length > 0) {
      data.forEach(m => { if (m.id) renderedMsgIds.add(m.id); });
      const groups = groupMessages(data.map(m => ({ ...m, ts: m.created_at })));
      renderGroupedMessages(msgsEl, groups, user.id, fluxMobileContact);
      if (!fluxMobileAllLoaded) prependLoadMoreIndicator(msgsEl, 'mobile');
    } else { msgsEl.innerHTML = ''; }
  } catch (err) { msgsEl.innerHTML = ''; }

  msgsEl.onscroll = null;
  msgsEl.onscroll = () => {
    if (msgsEl.scrollTop < 80 && !fluxMobileLoadingMore && !fluxMobileAllLoaded) {
      loadMoreMessagesMobile();
    }
  };

  try {
    const channel = supabaseClient.channel(`fs-messages:${user.id}:${userId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload) => {
        const newMsg = payload.new;
        const isForThis = _fluxMsgBelongsToConv(newMsg, userId, user.id, isGroupConv);
        if (!isForThis) return;
        if (renderedMsgIds.has(newMsg.id)) return;
        renderedMsgIds.add(newMsg.id);
        if (activeFluxId === userId) {
          appendIncomingMessage(msgsEl, newMsg, user.id, fluxMobileContact);
          updateContactLastMsg(userId, newMsg, user.id);
          buildFLUXConvList();
          // Only mark as seen if the tab is actually visible & focused. Group
          // read receipts aren't tracked per-message yet, so skip the DB call
          // for groups — the update is a no-op anyway (no receiver_id) but
          // there's no point issuing it.
          if (!isGroupConv && _isRelayVisibleFor(userId)) {
            markConversationSeen(userId).then(() => fixSeenLabels(msgsEl));
          } else if (isGroupConv && _isRelayVisibleFor(userId)) {
            fixSeenLabels(msgsEl);
          } else {
            const contact = fluxContacts.find(c => c.id === userId);
            if (contact) {
              contact.unread = true;
              contact.unreadCount = (contact.unreadCount || 0) + 1;
            }
            _updateTitleUnreadBadge();
          }
        } else {
          const c = fluxContacts.find(c => c.id === userId);
          if (c) { updateContactLastMsg(userId, newMsg, user.id); buildFLUXConvList(); }
        }
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages' }, (payload) => {
        const updated = payload.new;
        if (!updated) return;
        const isForThis = _fluxMsgBelongsToConv(updated, userId, user.id, isGroupConv);
        if (!isForThis) return;
        if (updated.edited) {
          ['fluxRelayMessages', 'fluxFsMessages'].forEach(cId => {
            const container = document.getElementById(cId);
            if (!container) return;
            const bWrap = container.querySelector(`.flux-bubble-wrap[data-msg-id="${updated.id}"]`);
            if (bWrap) applyEditToBubble(bWrap, updated.content, updated.sender_id === user.id);
          });
        }
        if (updated.reactions !== undefined) {
          if (updated.id) _reactionCache[updated.id] = updated.reactions || {};
          ['fluxRelayMessages', 'fluxFsMessages'].forEach(cId => {
            const container = document.getElementById(cId);
            if (!container) return;
            const bWrap = container.querySelector(`.flux-bubble-wrap[data-msg-id="${updated.id}"]`);
            if (bWrap) applyReactionsToWrap(bWrap, updated.reactions || {}, user.id);
          });
        }
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'messages' }, async (payload) => {
        if (activeFluxId !== userId) return;
        if (_clearingRelayForUserId === userId) return;
        // Surgically remove just the deleted bubble — no full re-render needed.
        const deletedId = payload.old?.id;
        if (deletedId) {
          const bWrap = msgsEl.querySelector(`.flux-bubble-wrap[data-msg-id="${deletedId}"]`);
          if (bWrap) {
            const parentGroup = bWrap.closest('.flux-msg-group');
            bWrap.remove();
            if (parentGroup && parentGroup.querySelectorAll('.flux-bubble-wrap').length === 0) parentGroup.remove();
          }
        }
        const { data: lastMsg } = await _fluxApplyConvFilter(
          supabaseClient.from('messages').select('*'), userId, user.id, isGroupConv
        )
          .order('created_at', { ascending: false }).limit(1).single();
        if (lastMsg) { updateContactLastMsg(userId, lastMsg, user.id); }
        else { buildFLUXConvList(); }
      })
      .subscribe();
    await subscriptionManager.replaceSubscription(channel);
  } catch (err) {}
}

async function loadMoreMessagesMobile() {
  if (fluxMobileAllLoaded || fluxMobileLoadingMore || !fluxMobileUserId || !fluxMobileUser) return;
  fluxMobileLoadingMore = true;
  const msgsEl = document.getElementById('fluxFsMessages');
  if (!msgsEl) { fluxMobileLoadingMore = false; return; }

  const newEnd = fluxMobileOffset - 1;
  const newStart = Math.max(0, fluxMobileOffset - FLUX_LOAD_MORE);
  if (newStart <= 0) fluxMobileAllLoaded = true;
  fluxMobileOffset = newStart;

  try {
    const { data } = await _fluxApplyConvFilter(
      supabaseClient.from('messages').select('*'), fluxMobileUserId, fluxMobileUser.id, _fluxConvIsGroup(fluxMobileUserId)
    )
      .order('created_at', { ascending: true })
      .range(newStart, newEnd);

    if (data && data.length > 0) {
      const prevScrollHeight = msgsEl.scrollHeight;
      const groups = groupMessages(data.map(m => ({ ...m, ts: m.created_at })));
      const frag = document.createDocumentFragment();
      groups.forEach(item => {
        if (item.type === 'separator') {
          const sep = document.createElement('div');
          sep.className = 'flux-time-separator'; sep.textContent = item.label;
          frag.appendChild(sep);
        } else if (item.type === 'system') {
          frag.appendChild(makeSystemMsgEl(item.content));
        } else {
          const isSent = item.sender_id === fluxMobileUser.id;
          const groupEl = document.createElement('div');
          groupEl.className = `flux-msg-group ${isSent ? 'sent' : 'received'}`;
          groupEl.dataset.groupTs = item.groupKey;
          groupEl.dataset.senderId = item.sender_id;
          groupEl.dataset.minuteKey = item.minuteKey;
          groupEl.dataset.createdAt = item.firstTs || '';
          const rowEl = document.createElement('div');
          rowEl.className = 'flux-msg-group-row';
          if (!isSent) rowEl.appendChild(makeGroupAvatar(fluxMobileContact));
          const bubblesWrap = document.createElement('div');
          bubblesWrap.className = 'flux-msg-bubbles';
          const collapsed = collapseMediaGroups(item.messages);
          collapsed.forEach(msg => {
            if (msg.type === 'mediaGroup') {
              msg.msgs.forEach(m => { if (m.id) renderedMsgIds.add(m.id); });
              bubblesWrap.appendChild(makeMediaCollageBubble(msg, isSent, fluxMobileContact, fluxMobileUser.id));
            } else {
              if (msg.id) renderedMsgIds.add(msg.id);
              bubblesWrap.appendChild(makeBubbleWrap(msg, isSent, fluxMobileContact, fluxMobileUser.id));
            }
          });
          applyBubbleGrouping(bubblesWrap);
          rowEl.appendChild(bubblesWrap);
          groupEl.appendChild(rowEl);
          const timeEl = document.createElement('div');
          timeEl.className = 'flux-group-time'; timeEl.textContent = item.time;
          groupEl.appendChild(timeEl);
          frag.appendChild(groupEl);
        }
      });
      const indicator = msgsEl.querySelector('.flux-load-more-indicator');
      if (indicator) { msgsEl.insertBefore(frag, indicator.nextSibling); indicator.remove(); }
      else { msgsEl.insertBefore(frag, msgsEl.firstChild); }
      mergeAdjacentGroups(msgsEl);
      if (!fluxMobileAllLoaded) prependLoadMoreIndicator(msgsEl, 'mobile');
      msgsEl.scrollTop = msgsEl.scrollHeight - prevScrollHeight;
    } else {
      fluxMobileAllLoaded = true;
      const indicator = msgsEl.querySelector('.flux-load-more-indicator');
      if (indicator) indicator.remove();
    }
  } catch(e) {}
  fluxMobileLoadingMore = false;
}

/* ────────────────────────────────────────────
   FIX 2: Smart append — checks last group in
   the DOM and merges into it if same sender
   and same minute. Otherwise creates new group.
   Also removes matching optimistic bubble first.
──────────────────────────────────────────── */
function appendIncomingMessage(container, msg, currentUserId, contact) {
  if (msg.message_type === 'system') {
    const el = makeSystemMsgEl(msg.content || '');
    const typingEl = document.getElementById('fluxTypingSlot') || document.getElementById('fluxFsTypingSlot')
                  || document.getElementById('fluxTypingDots') || document.getElementById('fluxFsTypingDots');
    if (typingEl && typingEl.parentNode === container) container.insertBefore(el, typingEl);
    else container.appendChild(el);
    container.scrollTop = container.scrollHeight;
    return;
  }

  const isSent = msg.sender_id === currentUserId;
  const d = parseSupabaseDate(msg.created_at || new Date().toISOString());
  const ts = d.getTime();

  if (isSent) {
    const msgText = msg.content || '';
    container.querySelectorAll('.flux-bubble.sending').forEach(b => {
      const clone = b.cloneNode(true);
      clone.querySelectorAll('.flux-reply-preview, .flux-sending-icon').forEach(el => el.remove());
      if (clone.textContent.trim() === msgText.trim()) {
        const wrap = b.closest('.flux-bubble-wrap');
        if (wrap) {
          b.classList.remove('sending');
          b.style.opacity = '';
          const spinner = b.querySelector('.flux-sending-icon');
          if (spinner) spinner.remove();
          b.dataset.msgId = msg.id;
          wrap.dataset.msgId = msg.id;
          const outer = wrap.closest('.flux-bubble-outer');
          if (outer) outer.dataset.msgId = msg.id;
          const moreBtn = wrap.querySelector('.flux-more-btn');
          if (moreBtn) {
            moreBtn.onclick = (e) => { e.stopPropagation(); showMsgActionMenu(e, wrap, msg, true); };
          }
          const parentGroup = wrap.closest('.flux-msg-group');
          if (parentGroup) parentGroup.dataset.groupTs = ts;
          container.scrollTop = container.scrollHeight;
          fixSeenLabels(container);
          return;
        }
      }
    });
    const stillPending = [...container.querySelectorAll('.flux-bubble.sending')].some(b => {
      const clone = b.cloneNode(true);
      clone.querySelectorAll('.flux-reply-preview, .flux-sending-icon').forEach(el => el.remove());
      return clone.textContent.trim() === (msg.content || '').trim();
    });
    if (!stillPending) {
      container.scrollTop = container.scrollHeight;
      return;
    }
  }

  // Check last group — merge if same sender AND (same minute-key OR consecutive image-only within 5 min)
  const allGroups = container.querySelectorAll('.flux-msg-group');
  const lastGroup = allGroups[allGroups.length - 1];
  const msgCreatedAt = msg.created_at || null;
  const incomingMinuteKey = msgCreatedAt ? msgMinuteKey(msgCreatedAt, msg.sender_id) : null;
  const isIncomingMediaOnly = _isMsgMediaOnly(msg);

  if (lastGroup && lastGroup.dataset.senderId === msg.sender_id) {
    const bubblesWrap = lastGroup.querySelector('.flux-msg-bubbles');
    const lastBubbleOuter = bubblesWrap ? bubblesWrap.lastElementChild : null;
    const lastBubbleIsMedia = lastBubbleOuter && (lastBubbleOuter.querySelector('.flux-bubble-media-only') !== null || lastBubbleOuter.querySelector('.flux-media-collage') !== null);
    const lastGroupTs = parseInt(lastGroup.dataset.groupTs || '0', 10);
    const withinWindow = (ts - lastGroupTs) <= MEDIA_GROUP_GAP_MS;
    const withinMediaGap = isIncomingMediaOnly && lastBubbleIsMedia && withinWindow;

    if ((withinWindow || withinMediaGap) && bubblesWrap) {
      if (withinMediaGap && !withinWindow) {
        _appendMediaToGroup(bubblesWrap, msg, isSent, contact, currentUserId);
      } else {
        bubblesWrap.appendChild(makeBubbleWrap(msg, isSent, contact, currentUserId));
        if (isIncomingMediaOnly) _recollapseMediaInBubbles(bubblesWrap, isSent, contact, currentUserId);
      }
      applyBubbleGrouping(bubblesWrap);
      const timeEl = lastGroup.querySelector('.flux-group-time');
      if (timeEl) timeEl.textContent = formatMsgTime(d);
      lastGroup.dataset.groupTs = ts;
      if (incomingMinuteKey) lastGroup.dataset.minuteKey = incomingMinuteKey;
      lastGroup.dataset.createdAt = msgCreatedAt || lastGroup.dataset.createdAt;
      mergeAdjacentGroups(container);
      pinTypingIndicator(container);
      container.scrollTop = container.scrollHeight;
      return;
    }
  }

  // Create a new group
  const groupEl = document.createElement('div');
  groupEl.className = `flux-msg-group ${isSent ? 'sent' : 'received'}`;
  groupEl.dataset.groupTs = ts;
  groupEl.dataset.senderId = msg.sender_id;
  groupEl.dataset.minuteKey = incomingMinuteKey || '';
  groupEl.dataset.createdAt = msgCreatedAt || '';
  groupEl.style.animation = 'msgIn 0.15s ease';

  const rowEl = document.createElement('div');
  rowEl.className = 'flux-msg-group-row';
  if (!isSent) rowEl.appendChild(makeGroupAvatar(contact));

  const bubblesWrap = document.createElement('div');
  bubblesWrap.className = 'flux-msg-bubbles';
  bubblesWrap.appendChild(makeBubbleWrap(msg, isSent, contact, currentUserId));
  applyBubbleGrouping(bubblesWrap);

  rowEl.appendChild(bubblesWrap);
  groupEl.appendChild(rowEl);
  const timeEl = document.createElement('div');
  timeEl.className = 'flux-group-time'; timeEl.textContent = formatMsgTime(d);
  groupEl.appendChild(timeEl);

  // Insert before typing indicator if present
  const typingEl = document.getElementById('fluxTypingSlot') || document.getElementById('fluxFsTypingSlot')
                || document.getElementById('fluxTypingDots') || document.getElementById('fluxFsTypingDots');
  if (typingEl && typingEl.parentNode === container) {
    container.insertBefore(groupEl, typingEl);
  } else {
    container.appendChild(groupEl);
  }
  mergeAdjacentGroups(container);
  pinTypingIndicator(container);
  container.scrollTop = container.scrollHeight;
}

function updateContactLastMsg(userId, msg, currentUserId) {
  const contact = fluxContacts.find(c => c.id === userId);
  if (!contact) return;
  const d = parseSupabaseDate(msg.created_at);
  contact.lastMessage = { type: msg.sender_id === currentUserId ? 'sent' : 'received', text: msg.content, media: !!msg.media_url, time: formatMsgTime(d) };
  contact.lastMessageTs = d.getTime();
  if (msg.sender_id === currentUserId) contact.sentByMe = true;
  if (msg.sender_id !== currentUserId && activeFluxId !== userId) {
    contact.unread = true;
    contact.unreadCount = (contact.unreadCount || 0) + 1;
  }
  buildFLUXConvList();
}

async function openFsRelay(id) {
  _fluxArchiveEntryUnlocked = false;
  const contact = fluxContacts.find(c => c.id === id);
  if (!contact) return;
  contact.unread = false;
  contact.unreadCount = 0;
  hideRemoteTyping();
  activeFluxId = id;
  _updateUnarchiveBtnVisibility(id);

  // FIX 1: fs avatar — groups with no custom avatar_url get the same
  // "two overlapping member pfps" default used in the sidebar list, instead
  // of the generic single silhouette.
  const av = document.getElementById('fluxFsAvatar');
  _fluxSetProfileTabAvatar(av, contact.avatarUrl, (contact.isGroup && !contact.avatarUrl) ? contact.memberAvatars : null);

  document.getElementById('fluxFsName').textContent = contact.name;
  const fsUsernameEl = document.getElementById('fluxFsUsername');
  if (fsUsernameEl) {
    const raw = contact.username || contact.realName || contact.name;
    fsUsernameEl.textContent = '@' + raw;
  }
  if (_fluxConvIsGroup(id)) {
    _fluxUpdateGroupHeaderMembers(id);
  }
  resetPresenceDots(); updatePresenceDots();

  // Kick off theme fetch immediately in parallel — no blocking yet
  const themePromise = loadRelayThemeFromSupabase(id);
  subscribeToRelayTheme(id);

  document.getElementById('fluxFsListView').style.display = 'none';
  const relayView = document.getElementById('fluxFsRelayView');
  relayView.style.display = 'flex'; relayView.style.flexDirection = 'column'; relayView.style.height = '100%';

  const msgsEl = document.getElementById('fluxFsMessages');
  showSkeletonMessages(msgsEl);

  const { data: { user } } = await supabaseClient.auth.getUser();
  if (user) await setupTypingChannel(user.id, id);

  await themePromise;

  loadFsMessages(id);
  cancelReply('mobile'); clearFluxFsStaging();
  if (currentEditState) { currentEditState = null; document.getElementById('fluxEditBar')?.classList.remove('show'); document.getElementById('fluxFsEditBar')?.classList.remove('show'); }
  document.getElementById('fluxFsInput').focus();
  markConversationSeen(id);
}

function fluxFsBack() {
  document.getElementById('fluxFsRelayView').style.display = 'none';
  document.getElementById('fluxFsListView').style.display = 'flex';
  stopTypingBroadcast();
  activeFluxId = null; hideRemoteTyping(); resetPresenceDots(); buildFLUXConvList();
}

function fluxHandleKey(e, mode) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); fluxSend(mode); }
  if (e.key === 'Escape' && currentEditState) { e.preventDefault(); cancelEdit(mode); }
}

async function fluxSend(mode) {
  if (currentEditState) {
    const inputId = mode === 'mobile' ? 'fluxFsInput' : 'fluxInput';
    const input = document.getElementById(inputId);
    const newText = (input?.value || '').trim();
    await commitEdit(newText);
    return;
  }

  const inputId = mode === 'mobile' ? 'fluxFsInput' : 'fluxInput';
  const sendBtnId = mode === 'mobile' ? 'fluxFsSendBtn' : 'fluxSendBtn';
  const input = document.getElementById(inputId);
  const sendBtn = document.getElementById(sendBtnId);
  const staged = mode === 'mobile' ? fluxFsStagedMedia : fluxStagedMedia;

  // Prevent double-send: if already sending, bail out immediately
  if (sendBtn && sendBtn.dataset.sending === '1') return;

  if (staged) {
    const msgsEl = document.getElementById(mode === 'mobile' ? 'fluxFsMessages' : 'fluxRelayMessages');
    const contact = fluxContacts.find(c => c.id === activeFluxId);
    const { data: { user } } = await supabaseClient.auth.getUser();
    window._fluxMediaLoadingRemover = appendFluxMediaBubble(msgsEl, staged.dataUrl, staged.isVideo, user ? user.id : null, contact);
    if (mode === 'mobile') clearFluxFsStaging(); else clearFluxStaging();
  }

  const text = input.value.trim().replace(/(?<![a-zA-Z])[Tt]-[Tt](?![a-zA-Z])/g, '😭');
  if ((!text && !staged) || !activeFluxId) { input.style.height = 'auto'; return; }

  // Lock send button immediately — clear input right away so user knows it's queued
  if (sendBtn) { sendBtn.dataset.sending = '1'; sendBtn.style.opacity = '0.5'; sendBtn.disabled = true; }
  input.value = ''; input.style.height = 'auto';
  if (mode === 'mobile') input.focus();
  if (mode === 'mobile') toggleFluxFsSendBtn(); else toggleFluxSendBtn();

  const { data: { user } } = await supabaseClient.auth.getUser();
  const msgReplyTo = replyingTo ? { ...replyingTo } : null;
  cancelReply(mode);
  stopTypingBroadcast();

  const msgsEl = document.getElementById(mode === 'mobile' ? 'fluxFsMessages' : 'fluxRelayMessages');
  const contact = fluxContacts.find(c => c.id === activeFluxId);

  // ── Optimistic bubble ──
  const now = new Date();
  const nowTs = now.getTime();
  const nowIso = now.toISOString();
  const allGroups = msgsEl.querySelectorAll('.flux-msg-group');
  const lastGroup = allGroups[allGroups.length - 1];

  const bWrap = document.createElement('div');
  bWrap.className = 'flux-bubble-wrap';
  bWrap.dataset.text = text;
  bWrap.dataset.sender = profile.username ? profile.username.slice(1) : 'me';
  bWrap.dataset.ts = nowIso;
  bWrap.dataset.minuteKey = msgMinuteKey(nowIso, user.id);

  const replyBtnOpt = document.createElement('button');
  replyBtnOpt.className = 'flux-reply-btn'; replyBtnOpt.title = 'Reply';
  replyBtnOpt.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg>`;
  replyBtnOpt.onclick = (e) => { e.stopPropagation(); startReply(text, profile.username ? profile.username.slice(1) : 'me', bWrap.dataset.msgId || null); };

  const moreBtnOpt = document.createElement('button');
  moreBtnOpt.className = 'flux-more-btn'; moreBtnOpt.title = 'More options';
  moreBtnOpt.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg>`;

  const displayText = text;
  const bubble = document.createElement('div');
  const optimisticEmojiOnly = isEmojiOnly(displayText) && !staged;
  bubble.className = 'flux-bubble' + (optimisticEmojiOnly ? ' flux-bubble-emoji-only' : '') + ' sending';

  if (msgReplyTo) {
    const rp = _buildReplyPreview(msgReplyTo.text, msgReplyTo.author, msgReplyTo.image);
    rp.dataset.replyToId = msgReplyTo.id || '';
    rp.onclick = (e) => { e.stopPropagation(); scrollToReplyTarget(msgReplyTo.id, msgReplyTo.text, msgReplyTo.author || ''); };
    bubble.prepend(rp);
  }

  if (displayText) { const textNode = document.createElement('div'); textNode.textContent = displayText; bubble.appendChild(textNode); }

  bWrap.appendChild(moreBtnOpt); bWrap.appendChild(replyBtnOpt); bWrap.appendChild(bubble);

  // Mobile swipe-to-reply for optimistic bubble
  addSwipeToReply(bWrap, true, () => startReply(text, profile.username ? profile.username.slice(1) : 'me', bWrap.dataset.msgId || null));

  // Only show optimistic text bubble if there's actual text
  if (!text) {
    // media-only: no text bubble to show optimistically
  } else {
    const nowMinuteKey = msgMinuteKey(nowIso, user.id);
    // merge into last group if same sender AND same minute-key, else create new group
    if (lastGroup && lastGroup.dataset.senderId === user.id && lastGroup.dataset.minuteKey === nowMinuteKey) {
      const bubblesWrap = lastGroup.querySelector('.flux-msg-bubbles');
      if (bubblesWrap) {
        bubblesWrap.appendChild(bWrap);
        applyBubbleGrouping(bubblesWrap);
        const timeEl = lastGroup.querySelector('.flux-group-time');
        if (timeEl) timeEl.textContent = formatMsgTime(now);
        lastGroup.dataset.groupTs = nowTs;
        lastGroup.dataset.minuteKey = nowMinuteKey;
        lastGroup.dataset.createdAt = nowIso;
      }
    } else {
      // New group
      const optimisticGroup = document.createElement('div');
      optimisticGroup.className = 'flux-msg-group sent';
      optimisticGroup.dataset.groupTs = nowTs;
      optimisticGroup.dataset.senderId = user.id;
      optimisticGroup.dataset.minuteKey = nowMinuteKey;
      optimisticGroup.dataset.createdAt = nowIso;
      optimisticGroup.dataset.optimistic = 'true';
      const rowEl = document.createElement('div'); rowEl.className = 'flux-msg-group-row';
      const bubblesWrap = document.createElement('div'); bubblesWrap.className = 'flux-msg-bubbles';
      bubblesWrap.appendChild(bWrap);
      applyBubbleGrouping(bubblesWrap);
      rowEl.appendChild(bubblesWrap);
      optimisticGroup.appendChild(rowEl);
      const timeEl = document.createElement('div'); timeEl.className = 'flux-group-time'; timeEl.textContent = formatMsgTime(now);
      optimisticGroup.appendChild(timeEl);
      // Insert before typing indicator so it stays at the bottom
      const _typSlot = msgsEl.querySelector(".flux-typing-indicator");
      if (_typSlot) { msgsEl.insertBefore(optimisticGroup, _typSlot); } else { msgsEl.appendChild(optimisticGroup); }
      pinTypingIndicator(msgsEl);
    }
  }

  mergeAdjacentGroups(msgsEl);
  try {
    const bubbleForScroll = bWrap && (bWrap.querySelector('.flux-bubble') || bWrap);
    const delta = (bubbleForScroll && bubbleForScroll.offsetHeight) || 0;
    const maxScroll = msgsEl.scrollHeight - msgsEl.clientHeight;
    if (delta > 0) msgsEl.scrollTop = Math.min(msgsEl.scrollTop + delta + 5, maxScroll);
  } catch (e) { /* safe fallback */ }

  try {
    let uploadedMediaUrl = null;
    if (staged) {
      uploadedMediaUrl = await uploadChatMedia(staged.dataUrl, staged.isVideo, user.id);
    }
    // Group conversations store their messages via group_id, not receiver_id
    // (receiver_id is a single-user FK and a group id isn't a user, so sending
    // it there violates the FK constraint and Postgres/PostgREST reports it
    // back as a 409 Conflict).
    const isGroupConv = !!(contact && contact.isGroup);
    const insertData = {
      sender_id: user.id,
      receiver_id: isGroupConv ? null : activeFluxId,
      group_id: isGroupConv ? activeFluxId : null,
      content: (text && text.trim()) ? text.trim() : null,  // never send whitespace-only text
      media_url: staged ? (uploadedMediaUrl || staged.dataUrl) : null,
      is_video: staged ? staged.isVideo : false
    };
    if (msgReplyTo) { insertData.reply_to_text = msgReplyTo.text; insertData.reply_to_author = msgReplyTo.author; if (msgReplyTo.id) insertData.reply_to_id = msgReplyTo.id; if (msgReplyTo.image) insertData.reply_to_media_url = msgReplyTo.image; }
    const { data: inserted, error } = await supabaseClient.from('messages').insert(insertData).select().single();
    if (error) throw error;

    // Upgrade optimistic bubble with real ID (the real-time INSERT will also fire but renderedMsgIds will block double render)
    bubble.classList.remove('sending');
    bubble.style.opacity = '';
    if (inserted?.id) {
      bWrap.dataset.msgId = inserted.id;
      bubble.dataset.msgId = inserted.id;
      const bOuter = bWrap.closest('.flux-bubble-outer');
      if (bOuter) bOuter.dataset.msgId = inserted.id;
      renderedMsgIds.add(inserted.id);
      // Attach real msg to more button
      moreBtnOpt.onclick = (e) => { e.stopPropagation(); showMsgActionMenu(e, bWrap, inserted, true); };
    }
    updateContactLastMsg(activeFluxId, inserted, user.id);
    buildFLUXConvList();
    // Remove media loading indicator now that upload is confirmed
    if (window._fluxMediaLoadingRemover) { window._fluxMediaLoadingRemover(); window._fluxMediaLoadingRemover = null; }
    if (msgsEl) fixSeenLabels(msgsEl);
  } catch (err) {
    if (window._fluxMediaLoadingRemover) { window._fluxMediaLoadingRemover(); window._fluxMediaLoadingRemover = null; }
    bubble.classList.remove('sending'); bubble.style.opacity = '0.5'; bubble.title = 'Failed to send';
  } finally {
    if (sendBtn) { delete sendBtn.dataset.sending; sendBtn.style.opacity = ''; sendBtn.disabled = false; }
    // On mobile, re-focus to keep keyboard up
    if (mode === 'mobile') input.focus();
    else input.focus();
  }
}

// large enough that Supabase Realtime's postgres_changes payload either arrives
// without the media_url value or doesn't arrive at all for the receiver — so the
// receiver sees an empty bubble until the next full page load re-fetches the row
// via a normal select(). Uploading to Storage keeps the row (and the realtime
// payload) tiny — just a short URL — so the image/video shows up instantly.
async function uploadChatMedia(dataUrl, isVideo, userId) {
  try {
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    const ext = isVideo ? (blob.type.split('/')[1] || 'mp4') : (blob.type.split('/')[1] || 'jpg');
    const path = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    const { error: uploadError } = await supabaseClient.storage.from('chat-media').upload(path, blob, { contentType: blob.type, upsert: false });
    if (uploadError) throw uploadError;
    const { data } = supabaseClient.storage.from('chat-media').getPublicUrl(path);
    return data?.publicUrl || null;
  } catch (err) {
    console.error('Chat media upload failed, falling back to inline data URL:', err);
    return null;
  }
}

function stageFluxMedia(e, mode) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => stageFluxMediaFromDataUrl(ev.target.result, file.type.startsWith('video/'), mode);
  reader.readAsDataURL(file);
  e.target.value = '';
}

function stageFluxMediaFromDataUrl(dataUrl, isVideo, mode) {
  if (mode === 'mobile') {
    fluxFsStagedMedia = { dataUrl, isVideo };
    const wrap = document.getElementById('fluxFsMediaStagingWrap');
    const thumb = document.getElementById('fluxFsMediaStagingThumb');
    thumb.innerHTML = isVideo
      ? `<video src="${dataUrl}" style="width:72px;height:58px;object-fit:cover;border-radius:7px;"></video>`
      : `<img src="${dataUrl}" style="width:72px;height:58px;object-fit:cover;border-radius:7px;">`;
    wrap.classList.add('show'); toggleFluxFsSendBtn();
  } else {
    fluxStagedMedia = { dataUrl, isVideo };
    const wrap = document.getElementById('fluxMediaStagingWrap');
    const thumb = document.getElementById('fluxMediaStagingThumb');
    thumb.innerHTML = isVideo
      ? `<video src="${dataUrl}" style="width:72px;height:58px;object-fit:cover;border-radius:7px;"></video>`
      : `<img src="${dataUrl}" style="width:72px;height:58px;object-fit:cover;border-radius:7px;">`;
    wrap.classList.add('show'); toggleFluxSendBtn();
  }
}

function clearFluxStaging() {
  fluxStagedMedia = null;
  document.getElementById('fluxMediaStagingWrap').classList.remove('show');
  document.getElementById('fluxMediaStagingThumb').innerHTML = '';
}
function clearFluxFsStaging() {
  fluxFsStagedMedia = null;
  document.getElementById('fluxFsMediaStagingWrap').classList.remove('show');
  const el = document.getElementById('fluxFsMediaStagingThumb');
  if (el) el.innerHTML = '';
}

function appendFluxMediaBubble(container, dataUrl, isVideo, currentUserId, contact) {
  const now = new Date();
  const groupEl = document.createElement('div');
  groupEl.className = 'flux-msg-group sent';
  groupEl.dataset.groupTs = now.getTime();
  groupEl.dataset.senderId = currentUserId || '';
  const rowEl = document.createElement('div'); rowEl.className = 'flux-msg-group-row';
  const bubblesWrap = document.createElement('div'); bubblesWrap.className = 'flux-msg-bubbles';
  const bWrap = document.createElement('div'); bWrap.className = 'flux-bubble-wrap';
  const mediaWrap = document.createElement('div');
  mediaWrap.className = 'flux-bubble-media-only';
  if (isVideo) {
    const vid = document.createElement('video');
    vid.controls = true; vid.src = dataUrl;
    vid.style.cssText = 'max-width:220px;max-height:180px;border-radius:12px;display:block;box-shadow:0 2px 10px rgba(0,0,0,0.12);';
    mediaWrap.appendChild(vid);
  } else {
    const img = document.createElement('img');
    img.src = dataUrl;
    img.style.cssText = 'max-width:220px;max-height:180px;border-radius:12px;display:block;cursor:pointer;box-shadow:0 2px 10px rgba(0,0,0,0.12);';
    img.onclick = () => openLightbox(dataUrl, [dataUrl]);
    mediaWrap.appendChild(img);
  }
  // Loading indicator below media
  const loadingEl = document.createElement('div');
  loadingEl.className = 'flux-media-loading';
  loadingEl.innerHTML = `<div class="flux-sending-spinner"></div>`;
  loadingEl.style.cssText = 'display:flex;align-items:center;justify-content:flex-end;padding:3px 2px 0;';
  bWrap.appendChild(mediaWrap);
  bWrap.appendChild(loadingEl);
  bubblesWrap.appendChild(bWrap); rowEl.appendChild(bubblesWrap); groupEl.appendChild(rowEl);
  const timeEl = document.createElement('div'); timeEl.className = 'flux-group-time'; timeEl.textContent = formatMsgTime(now);
  groupEl.appendChild(timeEl);
  // Insert before typing indicator so it stays at the bottom
  const _typSlotMedia = container.querySelector('.flux-typing-indicator');
  if (_typSlotMedia) { container.insertBefore(groupEl, _typSlotMedia); } else { container.appendChild(groupEl); }
  pinTypingIndicator(container);
  container.scrollTop = container.scrollHeight;
  // Return a function to remove the loading indicator once upload completes
  return () => { loadingEl.remove(); };
}

let _lightboxUrls = [];
let _lightboxIdx = 0;
// Collage context — set when opening from a collage cell, enables per-image delete
let _lightboxBWrap = null;
let _lightboxMediaGroup = null;
let _lightboxIsSent = false;
let _lightboxContact = null;
let _lightboxCurrentUserId = null;

function openLightbox(src, allUrls, bWrap, mediaGroup, isSent, contact, currentUserId) {
  _lightboxUrls = allUrls && allUrls.length > 1 ? allUrls : [src];
  _lightboxIdx = _lightboxUrls.indexOf(src);
  if (_lightboxIdx < 0) _lightboxIdx = 0;
  _lightboxBWrap = bWrap || null;
  _lightboxMediaGroup = mediaGroup || null;
  _lightboxIsSent = isSent || false;
  _lightboxContact = contact || null;
  _lightboxCurrentUserId = currentUserId || null;
  _renderLightbox();
  document.getElementById('lightbox').classList.add('show');
  document.addEventListener('keydown', _lightboxKey);
}

function _renderLightbox() {
  const img = document.getElementById('lightboxImg');
  const footer = document.getElementById('lightboxFooter');
  const strip = document.getElementById('lightboxStrip');
  const counter = document.getElementById('lightboxCounter');
  const prev = document.getElementById('lightboxPrev');
  const next = document.getElementById('lightboxNext');
  const delBtn = document.getElementById('lightboxDeleteBtn');
  img.src = _lightboxUrls[_lightboxIdx];
  // Header + footer (counter + thumbnail strip) always render, even for a single
  // image, so a lone image gets the exact same lightbox chrome as a grouped one.
  // Prev/Next arrows are the only thing that hide — there's nothing to step to.
  if (_lightboxUrls.length > 1) {
    prev.style.display = 'flex';
    next.style.display = 'flex';
    prev.disabled = _lightboxIdx === 0;
    next.disabled = _lightboxIdx === _lightboxUrls.length - 1;
  } else {
    prev.style.display = 'none';
    next.style.display = 'none';
  }
  counter.textContent = (_lightboxIdx + 1) + ' of ' + _lightboxUrls.length;
  footer.style.display = 'flex';
  strip.innerHTML = '';
  _lightboxUrls.forEach((u, i) => {
    const t = document.createElement('img');
    t.src = u; t.className = 'lightbox-thumb' + (i === _lightboxIdx ? ' active' : '');
    t.onclick = (e) => { e.stopPropagation(); _lightboxIdx = i; _renderLightbox(); };
    strip.appendChild(t);
  });
  // Show delete button only when collage context is available and sender is current user
  if (delBtn) {
    delBtn.style.display = (_lightboxBWrap && _lightboxIsSent) ? 'flex' : 'none';
  }
}

function lightboxDownloadCurrentImage() {
  const url = _lightboxUrls[_lightboxIdx];
  if (!url) return;
  const a = document.createElement('a');
  a.href = url;
  a.download = url.split('/').pop().split('?')[0] || 'image';
  a.target = '_blank';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function lightboxReplyToCurrentImage() {
  const url = _lightboxUrls[_lightboxIdx];
  if (!url) return;
  const author = _lightboxIsSent ? (profile.username ? profile.username.slice(1) : 'me') : (_lightboxContact ? (_lightboxContact.username || _lightboxContact.realName || _lightboxContact.name) : 'User');
  const msgId = _lightboxMediaGroup ? _lightboxMediaGroup.id : (_lightboxBWrap ? _lightboxBWrap.dataset.msgId : null);
  startReply('Photo', author, msgId || null, url);
  closeLightbox();
}

function lightboxStep(dir) {
  const next = _lightboxIdx + dir;
  if (next < 0 || next >= _lightboxUrls.length) return;
  _lightboxIdx = next;
  _renderLightbox();
}

function _lightboxKey(e) {
  if (e.key === 'ArrowRight') lightboxStep(1);
  else if (e.key === 'ArrowLeft') lightboxStep(-1);
  else if (e.key === 'Escape') closeLightbox();
}

function closeLightbox() {
  document.getElementById('lightbox').classList.remove('show');
  document.removeEventListener('keydown', _lightboxKey);
  _lightboxUrls = []; _lightboxIdx = 0;
  _lightboxBWrap = null; _lightboxMediaGroup = null;
  _lightboxIsSent = false; _lightboxContact = null; _lightboxCurrentUserId = null;
}

function lightboxDeleteCurrentImage() {
  if (!_lightboxBWrap || !_lightboxMediaGroup) return;
  const urlToDelete = _lightboxUrls[_lightboxIdx];
  deleteSingleCollageImage(
    _lightboxBWrap, urlToDelete, _lightboxMediaGroup,
    _lightboxIsSent, _lightboxContact, _lightboxCurrentUserId
  );
}


// ── PROFILE DROPDOWN ──
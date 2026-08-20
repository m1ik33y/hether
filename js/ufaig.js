function formatMsgTime(date) {
  const now = new Date();
  const isToday = date.getDate() === now.getDate() && date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
  if (isToday) return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const isThisYear = date.getFullYear() === now.getFullYear();
  if (isThisYear) return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  return date.toLocaleDateString([], { month: 'short', day: 'numeric', year: '2-digit' });
}
function formatTimeSeparator(date) {
  const now = new Date();
  const diff = now - date;
  const dayMs = 86400000;
  if (diff < dayMs && date.getDate() === now.getDate()) return 'Today';
  if (diff < 2 * dayMs) return 'Yesterday';
  return date.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
}

// Robustly parse a Supabase/ISO timestamp string to a Date object.
// Supabase can return "2025-05-17 10:30:45.123456+00:00" (space instead of T)
// or "2025-05-17T10:30:45.123456" (no tz), etc. We normalise to ISO format so
// every browser parses it the same way (as UTC when no tz, matching Supabase default).
// Parse any Supabase/ISO timestamp string safely across all browsers.
// Supabase can return "2025-05-17 10:30:45.123456+00:00" (space not T),
// or no timezone at all. We normalise so every browser agrees.
function parseSupabaseDate(rawTs) {
  if (!rawTs) return new Date();
  let s = String(rawTs).trim().replace(' ', 'T');
  // If no timezone suffix, assume UTC (Supabase stores UTC)
  if (!/[Zz]$/.test(s) && !/[+-]\d{2}:\d{2}$/.test(s) && !/[+-]\d{4}$/.test(s)) s += 'Z';
  const d = new Date(s);
  return isNaN(d) ? new Date() : d;
}

// A stable string key representing the local minute + sender.
// Uses local time to stay consistent with formatTimeSeparator (which also uses local time).
function msgMinuteKey(rawTs, senderId) {
  const d = parseSupabaseDate(rawTs);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()} ${d.getHours()}:${d.getMinutes()} ${senderId}`;
}

function _isMsgMediaOnly(msg) {
  return !!(msg.media_url && !msg.is_video && !(msg.content && msg.content.trim()));
}

// are merged into the same group to form a gallery collage (5 minutes).
const MEDIA_GROUP_GAP_MS = 5 * 60 * 1000;

function groupMessages(messages) {
  const groups = [];
  let currentGroup = null;
  let lastDayLabel = null;

  messages.forEach(msg => {
    const rawTs = msg.created_at || msg.ts || null;
    const d = parseSupabaseDate(rawTs);
    const ts = d.getTime();
    const dayLabel = formatTimeSeparator(d);
    if (dayLabel !== lastDayLabel) {
      groups.push({ type: 'separator', label: dayLabel });
      lastDayLabel = dayLabel;
      currentGroup = null;
    }

    if (msg.message_type === 'system') {
      currentGroup = null;
      groups.push({ type: 'system', content: msg.content || '', ts: rawTs });
      return;
    }

    const mKey = msgMinuteKey(rawTs, msg.sender_id);
    const isMediaOnly = _isMsgMediaOnly(msg);

    if (currentGroup && currentGroup.sender_id === msg.sender_id) {
      const lastMsg = currentGroup.messages[currentGroup.messages.length - 1];
      const lastRawTs = lastMsg.created_at || lastMsg.ts || null;
      const lastD = parseSupabaseDate(lastRawTs);
      const gap = ts - lastD.getTime();

      // A different sender always starts a new group regardless of time.
      const withinWindow = gap <= MEDIA_GROUP_GAP_MS; // 5 * 60 * 1000
      const canMergeAsMedia = isMediaOnly && _isMsgMediaOnly(lastMsg) && withinWindow;

      if (withinWindow || canMergeAsMedia) {
        if (isMediaOnly && _isMsgMediaOnly(lastMsg)) {
          if (!currentGroup.mediaGroupStart) {
            currentGroup.mediaGroupStart = currentGroup.messages.length - 1;
          }
        } else {
          currentGroup.mediaGroupStart = undefined;
        }
        currentGroup.messages.push(msg);
        currentGroup.time = formatMsgTime(d);
        currentGroup.lastTs = rawTs;
        currentGroup.groupKey = ts;
        currentGroup.minuteKey = mKey;
        return;
      }
    }

    currentGroup = {
      type: 'group', groupKey: ts, sender_id: msg.sender_id,
      minuteKey: mKey, firstTs: rawTs, lastTs: rawTs,
      messages: [msg], time: formatMsgTime(d)
    };
    groups.push(currentGroup);
  });
  return groups;
}

function collapseMediaGroups(messages) {
  const result = [];
  let i = 0;
  while (i < messages.length) {
    const msg = messages[i];
    if (_isMsgMediaOnly(msg)) {
      const run = [msg];
      while (i + 1 < messages.length && _isMsgMediaOnly(messages[i + 1])) {
        i++;
        run.push(messages[i]);
      }
      if (run.length >= 2) {
        result.push({
          type: 'mediaGroup',
          urls: run.map(m => m.media_url),
          msgs: run,
          id: run[0].id,
          sender_id: run[0].sender_id,
          created_at: run[0].created_at,
        });
      } else {
        result.push(msg);
      }
    } else {
      result.push(msg);
    }
    i++;
  }
  return result;
}

function makeGroupAvatar(contact) {
  const av = document.createElement('div');
  const isDual = !!(contact && contact.isGroup && !contact.avatarUrl && contact.memberAvatars?.length);
  av.className = 'flux-group-avatar';
  if (contact && contact.avatarUrl) {
    av.style.background = 'transparent';
    const img = document.createElement('img');
    img.src = contact.avatarUrl;
    img.alt = '';
    av.appendChild(img);
  } else if (isDual) {
    av.style.background = 'transparent';
    av.style.overflow = 'visible';
    av.style.borderRadius = '0';
    av.innerHTML = buildDualAvatarHtml(contact.memberAvatars);
  } else {
    av.style.background = '#e8e8ec';
    av.classList.add('default-avatar');
    av.innerHTML = DEFAULT_AVATAR_SVG;
  }
  return av;
}

function makeSystemMsgEl(text) {
  const wrap = document.createElement('div');
  wrap.className = 'flux-system-msg';
  const inner = document.createElement('div');
  inner.className = 'flux-system-msg-text';
  inner.textContent = text;
  wrap.appendChild(inner);
  return wrap;
}

function renderGroupedMessages(container, groups, currentUserId, contact) {
  container.innerHTML = '';
  renderedMsgIds.clear();

  groups.forEach(item => {
    if (item.type === 'separator') {
      const sep = document.createElement('div');
      sep.className = 'flux-time-separator'; sep.textContent = item.label;
      container.appendChild(sep); return;
    }

    if (item.type === 'system') {
      container.appendChild(makeSystemMsgEl(item.content)); return;
    }

    const isSent = item.sender_id === currentUserId;
    const groupEl = document.createElement('div');
    groupEl.className = `flux-msg-group ${isSent ? 'sent' : 'received'}`;
    groupEl.dataset.groupTs = item.groupKey;
    groupEl.dataset.senderId = item.sender_id;
    groupEl.dataset.minuteKey = item.minuteKey;
    groupEl.dataset.createdAt = item.firstTs || '';
    const rowEl = document.createElement('div');
    rowEl.className = 'flux-msg-group-row';

    if (!isSent) {
      rowEl.appendChild(makeGroupAvatar(contact));
    }

    const bubblesWrap = document.createElement('div');
    bubblesWrap.className = 'flux-msg-bubbles';

    const collapsed = collapseMediaGroups(item.messages);
    collapsed.forEach((msg) => {
      if (msg.type === 'mediaGroup') {
        msg.msgs.forEach(m => { if (m.id) renderedMsgIds.add(m.id); });
        bubblesWrap.appendChild(makeMediaCollageBubble(msg, isSent, contact, currentUserId));
      } else {
        if (msg.id) renderedMsgIds.add(msg.id);
        bubblesWrap.appendChild(makeBubbleWrap(msg, isSent, contact, currentUserId));
      }
    });
    applyBubbleGrouping(bubblesWrap);

    rowEl.appendChild(bubblesWrap);
    groupEl.appendChild(rowEl);
    const timeEl = document.createElement('div');
    timeEl.className = 'flux-group-time'; timeEl.textContent = item.time;
    groupEl.appendChild(timeEl);
    container.appendChild(groupEl);
  });

  mergeAdjacentGroups(container);
  pinTypingIndicator(container);
  container.scrollTop = container.scrollHeight;
}
function fixSeenLabels(container) { /* seen UI removed */ }

// Returns true if the string contains only emoji characters (and whitespace)
function isEmojiOnly(str) {
  if (!str || !str.trim()) return false;
  // Reject if the string contains any digit or ASCII letter — numbers like "42"
  // are Emoji_Component chars but should always render as text with a bubble.
  if (/[0-9a-zA-Z]/.test(str.trim())) return false;
  // Strip all emoji sequences; if nothing remains the string is emoji-only
  const emojiRegex = /^(\p{Emoji_Presentation}|\p{Extended_Pictographic}|\uFE0F|\u200D|\p{Emoji_Modifier}|\p{Emoji_Modifier_Base}|\uFE0E|\p{Emoji_Component}|\s)+$/u;
  return emojiRegex.test(str.trim());
}

// that belong to the same sender AND share the same minute-key —
// moving all bubbles from the later group into the earlier one.
function mergeAdjacentGroups(container) {
  let changed = true;
  while (changed) {
    changed = false;
    const groups = container.querySelectorAll(':scope > .flux-msg-group');
    for (let i = 0; i < groups.length - 1; i++) {
      const a = groups[i];
      const b = groups[i + 1];
      if (!a.dataset.senderId || !b.dataset.senderId) continue;
      if (a.dataset.senderId !== b.dataset.senderId) continue;

      // Derive minute-key from the group's stored value, or from the last/first bubble inside it
      function groupMinuteKey(grp) {
        if (grp.dataset.minuteKey) return grp.dataset.minuteKey;
        const wraps = grp.querySelectorAll('.flux-bubble-wrap');
        const lastWrap = wraps[wraps.length - 1];
        return lastWrap ? lastWrap.dataset.minuteKey || '' : '';
      }

      // Use timestamp gap for merging: same sender + within 5 minutes = same group.
      const aTs = parseInt(a.dataset.groupTs || '0', 10);
      const bCreatedAt = b.dataset.createdAt;
      const bFirstTs = bCreatedAt ? parseSupabaseDate(bCreatedAt).getTime() : parseInt(b.dataset.groupTs || '0', 10);
      const gap = bFirstTs - aTs;
      const withinWindow = gap <= MEDIA_GROUP_GAP_MS; // 5 * 60 * 1000

      // For the merge commit below we still need keyB to update minuteKey
      const keyB = groupMinuteKey(b);

      let canMergeAsMedia = false;
      if (withinWindow) {
        const aBubblesCheck = a.querySelector('.flux-msg-bubbles');
        const bBubblesCheck = b.querySelector('.flux-msg-bubbles');
        const aLastChild = aBubblesCheck ? aBubblesCheck.lastElementChild : null;
        const bFirstChild = bBubblesCheck ? bBubblesCheck.firstElementChild : null;
        const aLastIsMedia = aLastChild && (aLastChild.querySelector('.flux-bubble-media-only') !== null || aLastChild.querySelector('.flux-media-collage') !== null);
        const bFirstIsMedia = bFirstChild && (bFirstChild.querySelector('.flux-bubble-media-only') !== null || bFirstChild.querySelector('.flux-media-collage') !== null);
        if (aLastIsMedia && bFirstIsMedia) canMergeAsMedia = true;
      }

      if (!withinWindow && !canMergeAsMedia) continue;

      const aBubbles = a.querySelector('.flux-msg-bubbles');
      const bBubbles = b.querySelector('.flux-msg-bubbles');
      if (aBubbles && bBubbles) {
        // Move all bubble-outers from b into a
        Array.from(bBubbles.children).forEach(child => aBubbles.appendChild(child));
        applyBubbleGrouping(aBubbles);
        if (b.dataset.groupTs) a.dataset.groupTs = b.dataset.groupTs;
        a.dataset.minuteKey = keyB;
        if (b.dataset.createdAt) a.dataset.createdAt = b.dataset.createdAt;
        const bTime = b.querySelector('.flux-group-time');
        const aTime = a.querySelector('.flux-group-time');
        if (bTime && aTime) aTime.textContent = bTime.textContent;
        b.remove();
        // Re-collapse any newly adjacent image-only bubbles after the merge
        const isSent = a.classList.contains('sent');
        _recollapseMediaInBubbles(aBubbles, isSent, null, null);
        changed = true;
        break;
      }
    }
  }
}

function applyBubbleGrouping(bubblesWrap) {
  if (!bubblesWrap) return;
  const children = Array.from(bubblesWrap.children).filter(el =>
    el.classList.contains('flux-bubble-outer') || el.classList.contains('flux-bubble-wrap')
  );
  const total = children.length;
  children.forEach((child, i) => {
    const bubble = child.querySelector('.flux-bubble');
    if (!bubble) return;
    // Skip emoji-only and media-only bubbles (keep fully round)
    if (bubble.classList.contains('flux-bubble-emoji-only') || bubble.classList.contains('flux-bubble-media-only')) {
      bubble.classList.remove('bubble-first','bubble-middle','bubble-last','bubble-solo');
      return;
    }
    bubble.classList.remove('bubble-first','bubble-middle','bubble-last','bubble-solo');
    if (total === 1) {
      bubble.classList.add('bubble-solo');
    } else if (i === 0) {
      bubble.classList.add('bubble-first');
    } else if (i === total - 1) {
      bubble.classList.add('bubble-last');
    } else {
      bubble.classList.add('bubble-middle');
    }
  });
}

function makeMediaCollageBubble(mediaGroup, isSent, contact, currentUserId) {
  const urls = mediaGroup.urls;
  const count = urls.length;

  const bWrap = document.createElement('div');
  bWrap.className = 'flux-bubble-wrap';
  bWrap.dataset.msgId = mediaGroup.id || '';
  bWrap.dataset.mediaUrls = urls.join('||');

  const collage = document.createElement('div');
  const countClass = count === 2 ? 'count-2' : count === 3 ? 'count-3' : count === 4 ? 'count-4' : 'count-5up';
  collage.className = 'flux-media-collage ' + countClass;

  // How many cells to render (max 5, with overlay on the 5th if more)
  const renderCount = Math.min(count, 5);
  const extra = count > 5 ? count - 5 : 0;

  function makeCell(url, idx) {
    const cell = document.createElement('div');
    cell.className = 'collage-cell';
    const img = document.createElement('img');
    img.src = url;
    img.loading = 'lazy';
    img.alt = '';
    cell.appendChild(img);
    // Show "+N" overlay on the 5th cell if there are more than 5 total
    if (count > 5 && idx === 4) {
      const ov = document.createElement('div');
      ov.className = 'collage-more-overlay';
      ov.textContent = '+' + (extra + 1);
      cell.appendChild(ov);
    }
    cell.onclick = () => openLightbox(url, urls, bWrap, mediaGroup, isSent, contact, currentUserId);
    return cell;
  }

  if (count <= 4) {
    // 2: side-by-side | 3: tall-left + 2-right | 4: 2×2
    for (let i = 0; i < renderCount; i++) {
      collage.appendChild(makeCell(urls[i], i));
    }
  } else {
    // 5+: 2 on top row, 3 on bottom row
    const top = document.createElement('div');
    top.className = 'collage-row-top';
    urls.slice(0, 2).forEach((url, i) => top.appendChild(makeCell(url, i)));

    const bottom = document.createElement('div');
    bottom.className = 'collage-row-bottom';
    urls.slice(2, 5).forEach((url, i) => bottom.appendChild(makeCell(url, i + 2)));

    collage.appendChild(top);
    collage.appendChild(bottom);
  }

  // Reply / more buttons (outside collage, floating on hover)
  const replyBtn = document.createElement('button');
  replyBtn.className = 'flux-reply-btn'; replyBtn.title = 'Reply';
  replyBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg>`;
  replyBtn.onclick = (e) => { e.stopPropagation(); startReply('Photo', isSent ? (profile.username ? profile.username.slice(1) : 'me') : (contact ? (contact.username || contact.realName || contact.name) : 'User'), mediaGroup.id, urls[0]); };

  const moreBtn = document.createElement('button');
  moreBtn.className = 'flux-more-btn'; moreBtn.title = 'More options';
  moreBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg>`;
  moreBtn.onclick = (e) => {
    e.stopPropagation();
    showCollageActionMenu(e, bWrap, mediaGroup, isSent);
  };

  if (isSent) { bWrap.appendChild(moreBtn); bWrap.appendChild(replyBtn); bWrap.appendChild(collage); }
  else { bWrap.appendChild(collage); bWrap.appendChild(replyBtn); bWrap.appendChild(moreBtn); }

  const bOuter = document.createElement('div');
  bOuter.className = 'flux-bubble-outer';
  bOuter.dataset.msgId = mediaGroup.id || '';
  bOuter.appendChild(bWrap);
  return bOuter;
}

// Re-collapse any consecutive image-only bubble-outers in bubblesWrap into collages.
// Called after appending a new image-only bubble to an existing group.
function _recollapseMediaInBubbles(bubblesWrap, isSent, contact, currentUserId) {
  const children = Array.from(bubblesWrap.children);
  const msgs = [];
  let hasNewMedia = false;
  children.forEach(child => {
    const bWrap = child.classList.contains('flux-bubble-wrap') ? child : child.querySelector('.flux-bubble-wrap');
    if (!bWrap) return;
    const collage = bWrap.querySelector('.flux-media-collage');
    if (collage) {
      // Existing collage — extract stored URLs
      const storedUrls = bWrap.dataset.mediaUrls ? bWrap.dataset.mediaUrls.split('||') : [];
      storedUrls.forEach(url => msgs.push({ _url: url, _el: child }));
      return;
    }
    const mediaBubble = bWrap.querySelector('.flux-bubble-media-only');
    if (mediaBubble) {
      const imgEl = mediaBubble.querySelector('img');
      if (imgEl) { msgs.push({ _url: imgEl.src, _el: child }); hasNewMedia = true; }
      return;
    }
    msgs.push({ _text: true, _el: child });
  });
  if (!hasNewMedia) return;

  // Now rebuild: collapse consecutive image msgs into collages
  bubblesWrap.innerHTML = '';
  let i = 0;
  while (i < msgs.length) {
    const m = msgs[i];
    if (m._url) {
      const run = [m._url];
      while (i + 1 < msgs.length && msgs[i + 1]._url) { i++; run.push(msgs[i]._url); }
      if (run.length >= 2) {
        const fakeGroup = { urls: run, id: '', sender_id: '' };
        const collageEl = makeMediaCollageBubble(fakeGroup, isSent, contact, currentUserId);
        // Store URLs on the bubble-wrap for future merges
        const bw = collageEl.querySelector('.flux-bubble-wrap') || collageEl;
        bw.dataset.mediaUrls = run.join('||');
        bubblesWrap.appendChild(collageEl);
      } else {
        // Single image — put back or append as normal bubble
        // Reconstruct a simple media bubble
        const singleBWrap = document.createElement('div');
        singleBWrap.className = 'flux-bubble-wrap';
        singleBWrap.dataset.mediaUrls = run[0];
        const bubble = document.createElement('div');
        bubble.className = 'flux-bubble flux-bubble-media-only';
        bubble.innerHTML = `<img src="${run[0]}" style="max-width:220px;border-radius:10px;cursor:pointer;" onclick="openLightbox(this.src,[this.src])">`;
        const replyBtn = document.createElement('button');
        replyBtn.className = 'flux-reply-btn'; replyBtn.title = 'Reply';
        replyBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg>`;
        if (isSent) { singleBWrap.appendChild(bubble); } else { singleBWrap.appendChild(bubble); }
        const bOuter = document.createElement('div'); bOuter.className = 'flux-bubble-outer';
        bOuter.appendChild(singleBWrap);
        bubblesWrap.appendChild(bOuter);
      }
    } else {
      bubblesWrap.appendChild(m._el);
    }
    i++;
  }
}

// into the last media collage (or upgrading a single image into a collage).
function _appendMediaToGroup(bubblesWrap, msg, isSent, contact, currentUserId) {
  if (!msg.media_url) return;
  const newUrl = msg.media_url;
  const children = Array.from(bubblesWrap.children);
  // Walk backwards to find the last media element
  for (let i = children.length - 1; i >= 0; i--) {
    const child = children[i];
    const bWrap = child.classList.contains('flux-bubble-wrap') ? child : child.querySelector('.flux-bubble-wrap');
    if (!bWrap) continue;

    // Case 1: existing collage — add URL and rebuild
    const collage = bWrap.querySelector('.flux-media-collage');
    if (collage) {
      const existingUrls = bWrap.dataset.mediaUrls ? bWrap.dataset.mediaUrls.split('||') : [];
      existingUrls.push(newUrl);
      const fakeGroup = { urls: existingUrls, id: bWrap.dataset.msgId || '', sender_id: '' };
      const newCollageEl = makeMediaCollageBubble(fakeGroup, isSent, contact, currentUserId);
      const newBWrap = newCollageEl.querySelector('.flux-bubble-wrap') || newCollageEl;
      newBWrap.dataset.mediaUrls = existingUrls.join('||');
      child.replaceWith(newCollageEl);
      return;
    }

    // Case 2: single-image bubble — upgrade to 2-image collage
    const mediaBubble = bWrap.querySelector('.flux-bubble.flux-bubble-media-only');
    if (mediaBubble) {
      const imgEl = mediaBubble.querySelector('img');
      if (imgEl) {
        const urls = [imgEl.src, newUrl];
        const fakeGroup = { urls, id: bWrap.dataset.msgId || '', sender_id: '' };
        const newCollageEl = makeMediaCollageBubble(fakeGroup, isSent, contact, currentUserId);
        const newBWrap = newCollageEl.querySelector('.flux-bubble-wrap') || newCollageEl;
        newBWrap.dataset.mediaUrls = urls.join('||');
        child.replaceWith(newCollageEl);
        return;
      }
    }
    break; // last element wasn't media — don't merge
  }
  // Fallback: just append as normal bubble
  bubblesWrap.appendChild(makeBubbleWrap(msg, isSent, contact, currentUserId));
}

// ── SWIPE-TO-REPLY (mobile) ──
function addSwipeToReply(bWrap, isSent, onReply) {
  const THRESHOLD = 52;   // px to trigger reply
  const MAX_DRAG  = 72;   // px cap so it doesn't slide too far
  let startX = 0, startY = 0, curX = 0, dragging = false, triggered = false, maybeSwipe = false;

  bWrap.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return;
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    curX = 0; triggered = false; maybeSwipe = false; dragging = false;
  }, { passive: true });

  bWrap.addEventListener('touchmove', (e) => {
    if (e.touches.length !== 1) return;
    const dx = e.touches[0].clientX - startX;
    const dy = e.touches[0].clientY - startY;

    // First move: decide if this is a horizontal or vertical gesture
    if (!dragging && !maybeSwipe) {
      if (Math.abs(dy) > Math.abs(dx) + 4) return; // vertical scroll — ignore
      maybeSwipe = true;
    }
    if (!maybeSwipe) return;

    // Correct direction: sent → swipe left (dx < 0), received → swipe right (dx > 0)
    const correct = isSent ? dx < 0 : dx > 0;
    if (!correct && !dragging) return;

    dragging = true;
    e.preventDefault(); // stop scroll while doing horizontal swipe

    const clamped = isSent
      ? Math.max(-MAX_DRAG, Math.min(0, dx))
      : Math.min(MAX_DRAG, Math.max(0, dx));
    curX = clamped;
    bWrap.classList.add('swiping');
    bWrap.style.transform = `translateX(${curX}px)`;

    if (!triggered && Math.abs(curX) >= THRESHOLD) {
      triggered = true;
      if (navigator.vibrate) navigator.vibrate(30);
    }
  }, { passive: false });

  function endSwipe() {
    if (!dragging) { bWrap.classList.remove('swiping'); return; }
    dragging = false; maybeSwipe = false;
    bWrap.classList.remove('swiping');
    bWrap.style.transform = '';
    if (triggered) onReply();
  }

  bWrap.addEventListener('touchend',    endSwipe, { passive: true });
  bWrap.addEventListener('touchcancel', endSwipe, { passive: true });
}

function makeBubbleWrap(msg, isSent, contact, currentUserId) {
  const bWrap = document.createElement('div');
  bWrap.className = 'flux-bubble-wrap';
  bWrap.dataset.msgId = msg.id || '';
  bWrap.dataset.text = msg.content || msg.text || '';
  bWrap.dataset.sender = isSent ? (profile.username ? profile.username.slice(1) : 'me') : (contact ? (contact.username || contact.realName || contact.name) : 'User');

  // Stamp the raw timestamp on the wrap — used by grouping logic
  const rawTs = msg.created_at || msg.ts || '';
  bWrap.dataset.ts = rawTs;
  bWrap.dataset.minuteKey = rawTs ? msgMinuteKey(rawTs, msg.sender_id) : '';

  const rawContent = msg.content || msg.text || '';
  const msgText = rawContent.replace(/(?<![a-zA-Z])[Tt]-[Tt](?![a-zA-Z])/g, '😭');
  if (msg.content) msg.content = msg.content.replace(/(?<![a-zA-Z])[Tt]-[Tt](?![a-zA-Z])/g, '😭');
  const msgSender = isSent ? (profile.username ? profile.username.slice(1) : 'me') : (contact ? (contact.username || contact.realName || contact.name) : 'User');

  const replyBtn = document.createElement('button');
  replyBtn.className = 'flux-reply-btn'; replyBtn.title = 'Reply';
  replyBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg>`;
  replyBtn.onclick = (e) => { e.stopPropagation(); startReply(msg.media_url && !msgText ? 'Photo' : msgText, msgSender, msg.id, msg.media_url || null); };

  const moreBtn = document.createElement('button');
  moreBtn.className = 'flux-more-btn'; moreBtn.title = 'More options';
  moreBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg>`;
  moreBtn.onclick = (e) => { e.stopPropagation(); showMsgActionMenu(e, bWrap, msg, isSent); };

  const bubble = document.createElement('div');
  const emojiOnly = isEmojiOnly(msgText) && !msg.media_url;
  bubble.className = 'flux-bubble' + (emojiOnly ? ' flux-bubble-emoji-only' : '') + (msg.sending ? ' sending' : '');
  bubble.dataset.msgId = msg.id || '';

  if (msg.reply_to_text) {
    const rp = _buildReplyPreview(msg.reply_to_text, msg.reply_to_author, msg.reply_to_media_url);
    rp.dataset.replyToId = msg.reply_to_id || '';
    rp.onclick = (e) => { e.stopPropagation(); scrollToReplyTarget(msg.reply_to_id, msg.reply_to_text, msg.reply_to_author || ''); };
    bubble.prepend(rp);
  }

  if (msg.media_url && !msg.content) {
    bubble.className = 'flux-bubble flux-bubble-media-only' + (msg.sending ? ' sending' : '');
    if (msg.is_video) {
      bubble.innerHTML = `<video controls src="${msg.media_url}" style="max-width:220px;border-radius:10px;"></video>`;
    } else {
      bubble.innerHTML = `<img src="${msg.media_url}" style="max-width:220px;border-radius:10px;cursor:pointer;" onclick="openLightbox(this.src, [this.src])">`;
    }
  } else if (msg.media_url && msg.content) {
    if (msg.is_video) {
      bubble.innerHTML += `<video controls src="${msg.media_url}" style="max-width:220px;border-radius:10px;margin-bottom:6px;display:block;"></video>`;
    } else {
      bubble.innerHTML += `<img src="${msg.media_url}" style="max-width:220px;border-radius:10px;margin-bottom:6px;display:block;cursor:pointer;" onclick="openLightbox(this.src, [this.src])">`;
    }
    if (msg.content && msg.content.trim()) {
      const textNode = document.createElement('div');
      textNode.textContent = msg.content;
      bubble.appendChild(textNode);
    }
  } else if (msg.content && msg.content.trim()) {
    const textNode = document.createElement('div');
    textNode.textContent = msg.content;
    bubble.appendChild(textNode);
  }

  bubble.addEventListener('dblclick', (e) => { e.preventDefault(); addReaction(bWrap, '❤️'); });
  bubble.addEventListener('contextmenu', (e) => {
    e.preventDefault(); showCtxMenu(e.clientX, e.clientY, bWrap, msg, isSent, contact);
  });

  if (isSent) { bWrap.appendChild(moreBtn); bWrap.appendChild(replyBtn); bWrap.appendChild(bubble); }
  else { bWrap.appendChild(bubble); bWrap.appendChild(replyBtn); bWrap.appendChild(moreBtn); }

  // Mobile swipe-to-reply
  addSwipeToReply(bWrap, isSent, () => startReply(msgText, msgSender, msg.id));

  // Render existing reactions from DB data and seed the cache
  if (msg.reactions && Object.keys(msg.reactions).length > 0) {
    if (msg.id) _reactionCache[msg.id] = msg.reactions;
    requestAnimationFrame(() => applyReactionsToWrap(bWrap, msg.reactions, currentUserId));
  }

  // Wrap bWrap in a column container so seen label sits BELOW the bubble row
  const bOuter = document.createElement('div');
  bOuter.className = 'flux-bubble-outer';

  // Edited tag sits ABOVE the bubble, outside it
  if (msg.edited) {
    const editedTag = document.createElement('div');
    editedTag.className = 'flux-edited-tag';
    editedTag.textContent = 'edited';
    bOuter.appendChild(editedTag);
  }

  bOuter.appendChild(bWrap);

  bOuter.dataset.msgId = msg.id || '';

  return bOuter;
}

const _reactionCache = {};

async function addReaction(bWrap, emoji) {
  const msgId = bWrap.dataset.msgId;
  if (!msgId) return;

  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) return;

  // Use cached reactions if available, otherwise start empty and let DB fill it
  let reactions = _reactionCache[msgId] ? { ..._reactionCache[msgId] } : {};

  // Toggle logic
  if (reactions[user.id] === emoji) {
    delete reactions[user.id];
  } else {
    reactions[user.id] = emoji;
  }

  // Update cache
  _reactionCache[msgId] = reactions;

  // ✅ Optimistically show immediately for this user
  applyReactionsToWrap(bWrap, reactions, user.id);

  // Save to DB in background — realtime UPDATE event will sync to the other user
  supabaseClient.from('messages').update({ reactions }).eq('id', msgId).then(({ error }) => {
    if (error) {
      // Rollback on failure
      delete _reactionCache[msgId];
      // Refetch from DB to restore correct state
      supabaseClient.from('messages').select('reactions').eq('id', msgId).single().then(({ data }) => {
        if (data) {
          _reactionCache[msgId] = data.reactions || {};
          applyReactionsToWrap(bWrap, data.reactions || {}, user.id);
        }
      });
    }
  });
}

function applyReactionsToWrap(bWrap, reactions, currentUserId) {
  // Remove all existing reaction elements
  bWrap.querySelectorAll('.flux-reaction').forEach(el => el.remove());
  if (!reactions || Object.keys(reactions).length === 0) return;

  // Group by emoji
  const counts = {};
  let myEmoji = null;
  for (const [uid, emoji] of Object.entries(reactions)) {
    counts[emoji] = (counts[emoji] || 0) + 1;
    if (uid === currentUserId) myEmoji = emoji;
  }

  for (const [emoji, count] of Object.entries(counts)) {
    const reactionEl = document.createElement('div');
    reactionEl.className = 'flux-reaction';
    reactionEl.dataset.emoji = emoji;
    reactionEl.textContent = emoji + (count > 1 ? count : '');
    reactionEl.style.opacity = (myEmoji === emoji) ? '1' : '0.75';
    reactionEl.onclick = () => addReaction(bWrap, emoji);
    bWrap.appendChild(reactionEl);
  }
}

const QUICK_REACTIONS = ['❤️','😂','😮','😢','😡','👍','👎','🔥'];

function showReactionPicker(bWrap) {
  // Remove any existing picker
  const existing = document.getElementById('flux-reaction-picker-popup');
  if (existing) existing.remove();

  const picker = document.createElement('div');
  picker.id = 'flux-reaction-picker-popup';
  picker.style.cssText = 'position:fixed;z-index:10001;background:#060000;border:1px solid var(--border);border-radius:12px;padding:8px 10px;display:flex;gap:6px;box-shadow:0 8px 24px rgba(0,0,0,0.18);animation:popIn 0.15s ease;';

  QUICK_REACTIONS.forEach(emoji => {
    const btn = document.createElement('button');
    btn.style.cssText = 'background:none;border:none;font-size:20px;cursor:pointer;padding:4px;border-radius:8px;transition:transform 0.1s;';
    btn.textContent = emoji;
    btn.onmouseenter = () => { btn.style.transform = 'scale(1.3)'; };
    btn.onmouseleave = () => { btn.style.transform = ''; };
    btn.onclick = () => { addReaction(bWrap, emoji); picker.remove(); };
    picker.appendChild(btn);
  });

  document.body.appendChild(picker);

  // Position near bWrap
  const rect = bWrap.getBoundingClientRect();
  let top = rect.top - 56;
  if (top < 8) top = rect.bottom + 8;
  let left = rect.left;
  const pickerW = QUICK_REACTIONS.length * 38 + 20;
  if (left + pickerW > window.innerWidth - 8) left = window.innerWidth - pickerW - 8;
  picker.style.top = top + 'px';
  picker.style.left = left + 'px';

  // Close on outside click
  setTimeout(() => {
    document.addEventListener('click', function closePicker() {
      picker.remove();
      document.removeEventListener('click', closePicker);
    });
  }, 0);
}

function showCtxMenu(x, y, bWrap, msg, isSent, contact) {
  const menu = document.getElementById('fluxCtxMenu');
  menu.innerHTML = ''; menu.style.display = 'block'; menu.style.left = x + 'px'; menu.style.top = y + 'px';
  const text = bWrap.dataset.text; const sender = bWrap.dataset.sender;

  const replyBtn = document.createElement('button');
  replyBtn.className = 'flux-ctx-item';
  replyBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg> Reply`;
  replyBtn.onclick = () => { startReply(text, sender, msg ? msg.id : null); closeCtxMenu(); };

  const reactBtn = document.createElement('button');
  reactBtn.className = 'flux-ctx-item'; reactBtn.innerHTML = `😊 React`;
  reactBtn.onclick = () => { closeCtxMenu(); showReactionPicker(bWrap); };

  const copyBtn = document.createElement('button');
  copyBtn.className = 'flux-ctx-item';
  copyBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copy`;
  copyBtn.onclick = () => { if (text) navigator.clipboard.writeText(text).catch(() => {}); closeCtxMenu(); };

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'flux-ctx-item danger';
  deleteBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg> Delete message`;
  deleteBtn.onclick = () => { closeCtxMenu(); showConfirm('Delete message?', 'This message will be removed from your view.', 'Delete', () => { deleteMessage(msg, bWrap); }); };

  if (isSent && msg && msg.id && text && text.trim()) {
    const editCtxBtn = document.createElement('button');
    editCtxBtn.className = 'flux-ctx-item';
    editCtxBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> Edit`;
    editCtxBtn.onclick = () => { closeCtxMenu(); editMessage(msg.id, bWrap); };
    menu.appendChild(editCtxBtn);
  }
  menu.appendChild(replyBtn); menu.appendChild(reactBtn); menu.appendChild(copyBtn); menu.appendChild(deleteBtn);
  if (x + 160 > window.innerWidth) menu.style.left = (x - 160) + 'px';
  if (y + 100 > window.innerHeight) menu.style.top = (y - 100) + 'px';
}

function deleteMessage(msg, bWrap) {
  const parentGroup = bWrap.closest('.flux-msg-group');
  bWrap.remove();
  if (parentGroup && parentGroup.querySelectorAll('.flux-bubble-wrap').length === 0) parentGroup.remove();
  if (msg && msg.id) supabaseClient.from('messages').delete().eq('id', msg.id).then(() => {});
}

// Show action menu for a media collage (3-dot button)
function showCollageActionMenu(e, bWrap, mediaGroup, isSent) {
  e.stopPropagation();
  const menu = document.getElementById('fluxMsgActionMenu');
  menu.innerHTML = '';

  if (isSent) {
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'flux-msg-action-item danger';
    deleteBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg> Delete group`;
    deleteBtn.onclick = (ev) => {
      ev.stopPropagation();
      closeMsgActionMenu();
      showConfirm('Delete media group?', 'All images in this group will be removed.', 'Delete', () => {
        deleteMediaGroup(bWrap, mediaGroup);
      });
    };
    menu.appendChild(deleteBtn);
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

function deleteMediaGroup(bWrap, mediaGroup) {
  const bOuter = bWrap.closest('.flux-bubble-outer') || bWrap;
  const parentGroup = bWrap.closest('.flux-msg-group');
  bOuter.remove();
  if (parentGroup && parentGroup.querySelectorAll('.flux-bubble-wrap').length === 0) parentGroup.remove();
  const ids = (mediaGroup.msgs || []).map(m => m.id).filter(Boolean);
  if (ids.length > 0) {
    supabaseClient.from('messages').delete().in('id', ids).then(() => {});
  } else if (mediaGroup.id) {
    supabaseClient.from('messages').delete().eq('id', mediaGroup.id).then(() => {});
  }
}

// Delete a single image from a collage by its URL, rebuild collage or remove group if last
async function deleteSingleCollageImage(bWrap, urlToDelete, mediaGroup, isSent, contact, currentUserId) {
  const allUrls = bWrap.dataset.mediaUrls ? bWrap.dataset.mediaUrls.split('||') : (mediaGroup.urls || []);
  const allMsgs = mediaGroup.msgs || [];

  const targetMsg = allMsgs.find(m => m.media_url === urlToDelete);
  if (targetMsg && targetMsg.id) {
    await supabaseClient.from('messages').delete().eq('id', targetMsg.id);
  }

  const newUrls = allUrls.filter(u => u !== urlToDelete);
  const newMsgs = allMsgs.filter(m => m.media_url !== urlToDelete);

  const bOuter = bWrap.closest('.flux-bubble-outer') || bWrap;
  const bubblesWrap = bOuter.parentElement;
  const parentGroup = bWrap.closest('.flux-msg-group');

  if (newUrls.length === 0) {
    // Last image — remove whole group element
    bOuter.remove();
    if (parentGroup && parentGroup.querySelectorAll('.flux-bubble-wrap').length === 0) parentGroup.remove();
    closeLightbox();
    return;
  }

  // Rebuild with remaining URLs. A single leftover image should NOT go through
  // the collage layout (its CSS grid assumes 2+ cells) — render it as a normal
  // single-image bubble instead so it displays correctly and stays clickable.
  const newMediaGroup = { urls: newUrls, msgs: newMsgs, id: mediaGroup.id || (newMsgs[0] && newMsgs[0].id) || '' };
  let newCollageEl, newBWrap;
  if (newUrls.length === 1) {
    newBWrap = document.createElement('div');
    newBWrap.className = 'flux-bubble-wrap';
    newBWrap.dataset.msgId = newMediaGroup.id || '';
    newBWrap.dataset.mediaUrls = newUrls[0];
    const bubble = document.createElement('div');
    bubble.className = 'flux-bubble flux-bubble-media-only';
    const img = document.createElement('img');
    img.src = newUrls[0];
    img.style.cssText = 'max-width:220px;border-radius:10px;cursor:pointer;';
    img.onclick = () => openLightbox(img.src, [img.src], newBWrap, newMediaGroup, isSent, contact, currentUserId);
    bubble.appendChild(img);
    newBWrap.appendChild(bubble);
    newCollageEl = document.createElement('div');
    newCollageEl.className = 'flux-bubble-outer';
    newCollageEl.dataset.msgId = newMediaGroup.id || '';
    newCollageEl.appendChild(newBWrap);
  } else {
    newCollageEl = makeMediaCollageBubble(newMediaGroup, isSent, contact, currentUserId);
    newBWrap = newCollageEl.querySelector('.flux-bubble-wrap') || newCollageEl;
    newBWrap.dataset.mediaUrls = newUrls.join('||');
  }
  bOuter.replaceWith(newCollageEl);

  // Update lightbox to show remaining images
  const newIdx = Math.min(_lightboxIdx, newUrls.length - 1);
  _lightboxUrls = newUrls;
  _lightboxIdx = newIdx;
  // Store reference to new bWrap for further deletes
  _lightboxBWrap = newBWrap;
  _lightboxMediaGroup = newMediaGroup;
  _lightboxIsSent = isSent;
  _lightboxContact = contact;
  _lightboxCurrentUserId = currentUserId;
  _renderLightbox();
}

function closeCtxMenu() { document.getElementById('fluxCtxMenu').style.display = 'none'; }
document.addEventListener('click', () => closeCtxMenu());

function _buildReplyPreview(text, author, mediaUrl) {
  const rp = document.createElement('div');
  rp.className = 'flux-reply-preview' + (mediaUrl ? ' media-reply' : '');
  const content = document.createElement('div');
  content.className = 'flux-reply-preview-content';
  const mediaIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" class="flux-reply-media-icon lucide lucide-image-icon lucide-image"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>';
  content.innerHTML = `<div class="flux-reply-author">${escHtml(author || '')}</div><div class="flux-reply-text">${mediaUrl ? mediaIcon : ''}${escHtml(text || '')}</div>`;
  rp.appendChild(content);
  if (mediaUrl) {
    const thumb = document.createElement('img');
    thumb.className = 'flux-reply-thumb';
    thumb.src = mediaUrl;
    thumb.alt = '';
    rp.appendChild(thumb);
  }
  return rp;
}

function startReply(text, author, msgId, imageUrl) {
  if (currentEditState) cancelEdit(currentEditState.mode);
  replyingTo = { text, author, id: msgId || null, image: imageUrl || null };
  clearFluxStaging(); clearFluxFsStaging();
  const bar = document.getElementById('fluxReplyBar');
  if (bar) {
    bar.classList.add('show'); document.getElementById('fluxReplyBarAuthor').textContent = author; document.getElementById('fluxReplyBarText').textContent = text;
    _setReplyBarThumb('fluxReplyBarThumb', imageUrl);
  }
  const fsBar = document.getElementById('fluxFsReplyBar');
  if (fsBar) {
    fsBar.classList.add('show'); document.getElementById('fluxFsReplyBarAuthor').textContent = author; document.getElementById('fluxFsReplyBarText').textContent = text;
    _setReplyBarThumb('fluxFsReplyBarThumb', imageUrl);
  }
  const inputEl = isMobile() ? document.getElementById('fluxFsInput') : document.getElementById('fluxInput');
  if (inputEl) inputEl.focus();
}

function _setReplyBarThumb(id, imageUrl) {
  const el = document.getElementById(id);
  if (!el) return;
  if (imageUrl) { el.src = imageUrl; el.style.display = 'block'; }
  else { el.removeAttribute('src'); el.style.display = 'none'; }
}

function cancelReply(mode) {
  replyingTo = null;
  document.getElementById('fluxReplyBar')?.classList.remove('show');
  document.getElementById('fluxFsReplyBar')?.classList.remove('show');
  _setReplyBarThumb('fluxReplyBarThumb', null);
  _setReplyBarThumb('fluxFsReplyBarThumb', null);
}

async function scrollToReplyTarget(replyMsgId, replyText, replyAuthor) {
  console.log('[scrollToReply] called', { replyMsgId, replyText, replyAuthor });
  const isMob = isMobile();
  const msgsElId = isMob ? 'fluxFsMessages' : 'fluxRelayMessages';
  const containers = ['fluxRelayMessages', 'fluxFsMessages'].map(id => document.getElementById(id)).filter(Boolean);
  console.log('[scrollToReply] isMob:', isMob, 'containers:', containers.length);

  function flashWrap(wrap) {
    wrap.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function findInDOM() {
    if (!replyMsgId) return null;
    for (const c of containers) {
      const w = c.querySelector(`.flux-bubble-wrap[data-msg-id="${replyMsgId}"]`);
      if (w) return w;
    }
    return null;
  }

  // Fast path: already in DOM
  const existing = findInDOM();
  console.log('[scrollToReply] findInDOM:', existing);
  if (existing) { flashWrap(existing); return; }

  console.log('[scrollToReply] not in DOM, will load');
  if (!replyMsgId) return;

  const msgsEl = document.getElementById(msgsElId);
  if (!msgsEl) return;

  const allLoaded = isMob ? fluxMobileAllLoaded : fluxDesktopAllLoaded;
  console.log('[scrollToReply] allLoaded:', allLoaded, 'desktopOffset:', fluxDesktopOffset, 'mobileOffset:', fluxMobileOffset);
  if (allLoaded) return;

  // Show a subtle loading indicator so the user knows something is happening
  const _findBarId = isMob ? 'fluxFsRelayLoadBar' : 'fluxRelayLoadBar';
  const _findFillId = isMob ? 'fluxFsRelayLoadFill' : 'fluxRelayLoadFill';
  _startLoadBar(_findBarId, _findFillId);
  // Override color to white (dark) / black (light) for find-msg only
  const _findFill = document.getElementById(_findFillId);
  const _findIsDark = document.documentElement.getAttribute('data-theme') === 'dark';
  if (_findFill) { _findFill.dataset.origBg = _findFill.style.background; _findFill.dataset.origShadow = _findFill.style.boxShadow; _findFill.style.background = _findIsDark ? '#ffffff' : '#000000'; _findFill.style.boxShadow = 'none'; }

  try {
    const { data: targetMsg } = await supabaseClient.from('messages').select('id, created_at').eq('id', replyMsgId).single();
    console.log('[scrollToReply] targetMsg:', targetMsg);
    if (!targetMsg) { _finishLoadBar(_findBarId, _findFillId); setTimeout(() => { if (_findFill) { _findFill.style.background = _findFill.dataset.origBg || ''; _findFill.style.boxShadow = _findFill.dataset.origShadow || ''; } }, 560); return; }

    const userId = isMob ? fluxMobileUserId : fluxDesktopUserId;
    const user   = isMob ? fluxMobileUser   : fluxDesktopUser;
    const contact= isMob ? fluxMobileContact: fluxDesktopContact;
    if (!userId || !user) { _finishLoadBar(_findBarId, _findFillId); setTimeout(() => { if (_findFill) { _findFill.style.background = _findFill.dataset.origBg || ''; _findFill.style.boxShadow = _findFill.dataset.origShadow || ''; } }, 560); return; }

    const _replyConvIsGroup = _fluxConvIsGroup(userId);
    const { count: posCount } = await _fluxApplyConvFilter(
      supabaseClient.from('messages').select('*', { count: 'exact', head: true }), userId, user.id, _replyConvIsGroup
    ).lte('created_at', targetMsg.created_at);

    console.log('[scrollToReply] posCount:', posCount);
    if (!posCount) { _finishLoadBar(_findBarId, _findFillId); setTimeout(() => { if (_findFill) { _findFill.style.background = _findFill.dataset.origBg || ''; _findFill.style.boxShadow = _findFill.dataset.origShadow || ''; } }, 560); return; }

    // We want to load from (posCount - a small context window) so the target has some context above it
    const CONTEXT = 5;
    const newStart = Math.max(0, posCount - 1 - CONTEXT); // row index of first msg to load
    // We need to load from newStart all the way to the current offset (what's already in DOM)
    const currentOffset = isMob ? fluxMobileOffset : fluxDesktopOffset;
    console.log('[scrollToReply] newStart:', newStart, 'currentOffset:', currentOffset);
    if (newStart >= currentOffset) {
      _finishLoadBar(_findBarId, _findFillId); setTimeout(() => { if (_findFill) { _findFill.style.background = _findFill.dataset.origBg || ''; _findFill.style.boxShadow = _findFill.dataset.origShadow || ''; } }, 560); return;
    }

    // Load the gap: newStart → currentOffset-1
    const { data: gapData } = await _fluxApplyConvFilter(
      supabaseClient.from('messages').select('*'), userId, user.id, _replyConvIsGroup
    )
      .order('created_at', { ascending: true })
      .range(newStart, currentOffset - 1);

    console.log('[scrollToReply] gapData:', gapData && gapData.length);
    if (!gapData || gapData.length === 0) { _finishLoadBar(_findBarId, _findFillId); setTimeout(() => { if (_findFill) { _findFill.style.background = _findFill.dataset.origBg || ''; _findFill.style.boxShadow = _findFill.dataset.origShadow || ''; } }, 560); return; }

    // Update offset state
    if (isMob) {
      fluxMobileOffset = newStart;
      if (newStart <= 0) fluxMobileAllLoaded = true;
    } else {
      fluxDesktopOffset = newStart;
      if (newStart <= 0) fluxDesktopAllLoaded = true;
    }

    const prevScrollHeight = msgsEl.scrollHeight;
    const groups = groupMessages(gapData.map(m => ({ ...m, ts: m.created_at })));
    const frag = document.createDocumentFragment();
    groups.forEach(item => {
      if (item.type === 'separator') {
        const sep = document.createElement('div');
        sep.className = 'flux-time-separator'; sep.textContent = item.label;
        frag.appendChild(sep);
      } else if (item.type === 'system') {
        frag.appendChild(makeSystemMsgEl(item.content));
      } else {
        const isSent = item.sender_id === user.id;
        const groupEl = document.createElement('div');
        groupEl.className = `flux-msg-group ${isSent ? 'sent' : 'received'}`;
        groupEl.dataset.groupTs = item.groupKey;
        groupEl.dataset.senderId = item.sender_id;
        groupEl.dataset.minuteKey = item.minuteKey;
        groupEl.dataset.createdAt = item.firstTs || '';
        const rowEl = document.createElement('div');
        rowEl.className = 'flux-msg-group-row';
        if (!isSent) rowEl.appendChild(makeGroupAvatar(contact));
        const bubblesWrap = document.createElement('div');
        bubblesWrap.className = 'flux-msg-bubbles';
        item.messages.forEach(msg => { if (msg.id) renderedMsgIds.add(msg.id); bubblesWrap.appendChild(makeBubbleWrap(msg, isSent, contact, user.id)); });
        applyBubbleGrouping(bubblesWrap);
        rowEl.appendChild(bubblesWrap);
        groupEl.appendChild(rowEl);
        const timeEl = document.createElement('div');
        timeEl.className = 'flux-group-time'; timeEl.textContent = item.time;
        groupEl.appendChild(timeEl);
        frag.appendChild(groupEl);
      }
    });

    // Remove old load-more indicator and loading pill, then prepend new content
    _finishLoadBar(_findBarId, _findFillId); setTimeout(() => { if (_findFill) { _findFill.style.background = _findFill.dataset.origBg || ''; _findFill.style.boxShadow = _findFill.dataset.origShadow || ''; } }, 560);
    const oldIndicator = msgsEl.querySelector('.flux-load-more-indicator');
    if (oldIndicator) oldIndicator.remove();
    msgsEl.insertBefore(frag, msgsEl.firstChild);
    mergeAdjacentGroups(msgsEl);

    // Re-add load-more indicator if still not at top
    const stillNotLoaded = isMob ? !fluxMobileAllLoaded : !fluxDesktopAllLoaded;
    if (stillNotLoaded) prependLoadMoreIndicator(msgsEl, isMob ? 'mobile' : 'desktop');

    // Keep scroll position stable (don't jump)
    msgsEl.scrollTop = msgsEl.scrollHeight - prevScrollHeight;

    // Now find and flash the target
    const found = findInDOM();
    console.log('[scrollToReply] found after prepend:', found);
    if (found) {
      // Small delay so layout settles before scrollIntoView
      setTimeout(() => flashWrap(found), 80);
    }
  } catch(e) {
    console.error('[scrollToReply] catch:', e);
    _finishLoadBar(_findBarId, _findFillId); setTimeout(() => { if (_findFill) { _findFill.style.background = _findFill.dataset.origBg || ''; _findFill.style.boxShadow = _findFill.dataset.origShadow || ''; } }, 560);
  }
}

const FLUX_PAGE_SIZE = 15;
const FLUX_LOAD_MORE = 10;
let fluxDesktopOffset = 0;
let fluxDesktopAllLoaded = false;
let fluxDesktopLoadingMore = false;
let fluxDesktopUserId = null;
let fluxDesktopUser = null;
let fluxDesktopContact = null;

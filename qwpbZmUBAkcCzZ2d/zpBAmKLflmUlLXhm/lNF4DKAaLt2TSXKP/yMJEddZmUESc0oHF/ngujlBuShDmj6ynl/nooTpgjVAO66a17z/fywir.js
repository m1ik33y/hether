let _fluxRebuildMsgChannel = null;

async function loadMessages(userId, loadToken) {
  const token = loadToken !== undefined ? loadToken : _fluxLoadToken;
  const {data: {user: user}} = await supabaseClient.auth.getUser();
  if (!user) {
    _hideLoadBar();
    return;
  }
  if (_fluxLoadToken !== token) return;
  await subscriptionManager.replaceSubscription(null);
  renderedMsgIds.clear();
  fluxDesktopOffset = 0;
  fluxDesktopAllLoaded = false;
  fluxDesktopLoadingMore = false;
  fluxDesktopUserId = userId;
  fluxDesktopUser = user;
  fluxDesktopContact = fluxContacts.find(c => c.id === userId);
  const msgsEl = document.getElementById("fluxRelayMessages");
  if (!msgsEl) {
    _hideLoadBar();
    return;
  }
  const isGroupConv = _fluxConvIsGroup(userId);
  try {
    const {count: count} = await _fluxApplyConvFilter(supabaseClient.from("messages").select("*", {
      count: "exact",
      head: true
    }), userId, user.id, isGroupConv);
    if (_fluxLoadToken !== token) return;
    const total = count || 0;
    fluxDesktopOffset = Math.max(0, total - FLUX_PAGE_SIZE);
    if (fluxDesktopOffset === 0) fluxDesktopAllLoaded = true;
    const {data: data, error: error} = await _fluxApplyConvFilter(supabaseClient.from("messages").select("*"), userId, user.id, isGroupConv).order("created_at", {
      ascending: true
    }).range(fluxDesktopOffset, total - 1);
    if (_fluxLoadToken !== token) return;
    if (error) {
      _hideLoadBar();
      return;
    }
    if (data && data.length > 0) {
      data.forEach(m => {
        if (m.id) renderedMsgIds.add(m.id);
      });
      const groups = groupMessages(data.map(m => ({
        ...m,
        ts: m.created_at
      })));
      renderGroupedMessages(msgsEl, groups, user.id, fluxDesktopContact);
      if (!fluxDesktopAllLoaded) {
        prependLoadMoreIndicator(msgsEl, "desktop");
      }
      loadFluxPinnedMessages(userId, "fluxRelayMessages");
      const last = data[data.length - 1];
      updateContactLastMsg(userId, last, user.id);
    } else {
      msgsEl.innerHTML = "";
    }
    loadFluxPinnedMessages(userId, "fluxRelayMessages");
  } catch (err) {
    msgsEl.innerHTML = "";
  }
  _hideLoadBar();
  msgsEl.onscroll = null;
  msgsEl.onscroll = () => {
    if (msgsEl.scrollTop < 80 && !fluxDesktopLoadingMore && !fluxDesktopAllLoaded) {
      loadMoreMessagesDesktop();
    }
  };
  async function _setupDesktopMsgChannel() {
    try {
      const channel = supabaseClient.channel(`messages:${user.id}:${userId}`).on("postgres_changes", {
        event: "INSERT",
        schema: "public",
        table: "messages"
      }, payload => {
        const newMsg = payload.new;
        const isForThis = _fluxMsgBelongsToConv(newMsg, userId, user.id, isGroupConv);
        if (!isForThis) return;
        window._fluxUpdateOpenChatSearchWithMessage?.(newMsg, userId);
        if (renderedMsgIds.has(newMsg.id)) return;
        renderedMsgIds.add(newMsg.id);
        if (activeFluxId === userId) {
          if (!isGroupConv && newMsg.sender_id !== user.id) {
            _maybePlayMessageSound(userId, user.id);
          }
          appendIncomingMessage(msgsEl, newMsg, user.id, fluxDesktopContact);
          updateContactLastMsg(userId, newMsg, user.id);
          if (!isGroupConv && _isRelayVisibleFor(userId)) {
            markConversationSeen(userId).then(() => fixSeenLabels(msgsEl));
          } else if (isGroupConv && _isRelayVisibleFor(userId)) {
            fixSeenLabels(msgsEl);
          }
          if (!_isRelayVisibleFor(userId)) {
            _markActiveConvBgUnread(userId);
          }
          buildFLUXConvList();
          _updateTitleUnreadBadge();
        }
      }).on("postgres_changes", {
        event: "UPDATE",
        schema: "public",
        table: "messages"
      }, payload => {
        const updated = payload.new;
        if (!updated) return;
        const isForThis = _fluxMsgBelongsToConv(updated, userId, user.id, isGroupConv);
        if (!isForThis) return;
        if (updated.edited) {
          [ "fluxRelayMessages", "fluxFsMessages" ].forEach(cId => {
            const container = document.getElementById(cId);
            if (!container) return;
            const bWrap = container.querySelector(`.flux-bubble-wrap[data-msg-id="${updated.id}"]`);
            if (bWrap) applyEditToBubble(bWrap, updated.content, updated.sender_id === user.id);
          });
        }
        if (updated.reactions !== undefined) {
          if (updated.id) _reactionCache[updated.id] = updated.reactions || {};
          [ "fluxRelayMessages", "fluxFsMessages" ].forEach(cId => {
            const container = document.getElementById(cId);
            if (!container) return;
            const bWrap = container.querySelector(`.flux-bubble-wrap[data-msg-id="${updated.id}"]`);
            if (bWrap) applyReactionsToWrap(bWrap, updated.reactions || {}, user.id);
          });
        }
      }).on("postgres_changes", {
        event: "DELETE",
        schema: "public",
        table: "messages"
      }, async payload => {
        if (activeFluxId !== userId) return;
        if (_clearingRelayForUserId === userId) return;
        const deletedId = payload.old?.id;
        if (deletedId) {
          const bWrap = msgsEl.querySelector(`.flux-bubble-wrap[data-msg-id="${deletedId}"]`);
          if (bWrap) {
            const parentGroup = bWrap.closest(".flux-msg-group");
            bWrap.remove();
            if (parentGroup && parentGroup.querySelectorAll(".flux-bubble-wrap").length === 0) parentGroup.remove();
          }
        }
        const {data: lastMsg} = await _fluxApplyConvFilter(supabaseClient.from("messages").select("*"), userId, user.id, isGroupConv).order("created_at", {
          ascending: false
        }).limit(1).single();
        if (lastMsg) {
          updateContactLastMsg(userId, lastMsg, user.id);
        } else {
          buildFLUXConvList();
        }
      }).subscribe((status, err) => {
        if ((status === "CLOSED" || status === "CHANNEL_ERROR" || status === "TIMED_OUT") && !subscriptionManager._intentionalTeardown && fluxOpen && activeFluxId === userId) {
          console.warn("[FLUX] desktop message channel dropped, reconnecting:", status, err);
          _setupDesktopMsgChannel();
        }
      });
      await subscriptionManager.replaceSubscription(channel);
    } catch (err) {}
  }
  _fluxRebuildMsgChannel = _setupDesktopMsgChannel;
  await _setupDesktopMsgChannel();
}

function _startLoadBar(barId, fillId) {
  const bar = document.getElementById(barId);
  const fill = document.getElementById(fillId);
  if (!bar || !fill) return;
  fill.style.transition = "none";
  fill.style.width = "0%";
  bar.classList.add("active");
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      fill.style.transition = "width 0.7s cubic-bezier(0.25, 1, 0.5, 1)";
      fill.style.width = "75%";
      setTimeout(() => {
        fill.style.transition = "width 2.5s cubic-bezier(0.1, 0.9, 0.3, 1)";
        fill.style.width = "88%";
      }, 720);
    });
  });
}

function _finishLoadBar(barId, fillId) {
  const bar = document.getElementById(barId);
  const fill = document.getElementById(fillId);
  if (!bar || !fill) return;
  fill.style.transition = "width 0.22s cubic-bezier(0.4, 0, 0.2, 1)";
  fill.style.width = "100%";
  setTimeout(() => {
    bar.style.transition = "opacity 0.25s ease";
    bar.classList.remove("active");
    setTimeout(() => {
      fill.style.transition = "none";
      fill.style.width = "0%";
      bar.style.transition = "";
    }, 280);
  }, 240);
}

function _hideLoadBar() {
  _finishLoadBar("fluxRelayLoadBar", "fluxRelayLoadFill");
  _finishLoadBar("fluxFsRelayLoadBar", "fluxFsRelayLoadFill");
  const msgsEl = document.getElementById("fluxRelayMessages");
  if (msgsEl) {
    msgsEl.classList.remove("flux-loading");
    requestAnimationFrame(() => {
      msgsEl.scrollTop = msgsEl.scrollHeight;
    });
  }
  const fsMsgsEl2 = document.getElementById("fluxFsMessages");
  if (fsMsgsEl2) {
    fsMsgsEl2.classList.remove("flux-loading");
    requestAnimationFrame(() => {
      fsMsgsEl2.scrollTop = fsMsgsEl2.scrollHeight;
    });
  }
}

function prependLoadMoreIndicator(container, mode) {
  const existing = container.querySelector(".flux-load-more-indicator");
  if (existing) existing.remove();
  const indicator = document.createElement("div");
  indicator.className = "flux-load-more-indicator";
  indicator.style.cssText = "text-align:center;padding:8px;font-size:11.5px;color:var(--text3);cursor:pointer;user-select:none;";
  indicator.textContent = "↑ Scroll up to load more";
  container.insertBefore(indicator, container.firstChild);
}

async function loadMoreMessagesDesktop() {
  if (fluxDesktopAllLoaded || fluxDesktopLoadingMore || !fluxDesktopUserId || !fluxDesktopUser) return;
  fluxDesktopLoadingMore = true;
  const msgsEl = document.getElementById("fluxRelayMessages");
  if (!msgsEl) {
    fluxDesktopLoadingMore = false;
    return;
  }
  const newEnd = fluxDesktopOffset - 1;
  const newStart = Math.max(0, fluxDesktopOffset - FLUX_LOAD_MORE);
  if (newStart <= 0) fluxDesktopAllLoaded = true;
  fluxDesktopOffset = newStart;
  try {
    const {data: data} = await _fluxApplyConvFilter(supabaseClient.from("messages").select("*"), fluxDesktopUserId, fluxDesktopUser.id, _fluxConvIsGroup(fluxDesktopUserId)).order("created_at", {
      ascending: true
    }).range(newStart, newEnd);
    if (data && data.length > 0) {
      const prevScrollHeight = msgsEl.scrollHeight;
      const groups = groupMessages(data.map(m => ({
        ...m,
        ts: m.created_at
      })));
      const frag = document.createDocumentFragment();
      groups.forEach(item => {
        if (item.type === "separator") {
          const sep = document.createElement("div");
          sep.className = "flux-time-separator";
          sep.textContent = item.label;
          frag.appendChild(sep);
        } else if (item.type === "system") {
          frag.appendChild(makeSystemMsgEl(item.content));
        } else {
          const isSent = item.sender_id === fluxDesktopUser.id;
          const groupEl = document.createElement("div");
          groupEl.className = `flux-msg-group ${isSent ? "sent" : "received"}`;
          groupEl.dataset.groupTs = item.groupKey;
          groupEl.dataset.senderId = item.sender_id;
          groupEl.dataset.minuteKey = item.minuteKey;
          groupEl.dataset.createdAt = item.firstTs || "";
          const rowEl = document.createElement("div");
          rowEl.className = "flux-msg-group-row";
          if (!isSent) rowEl.appendChild(makeGroupAvatar(fluxDesktopContact, item.sender_id));
          const bubblesWrap = document.createElement("div");
          bubblesWrap.className = "flux-msg-bubbles";
          const collapsed = collapseMediaGroups(item.messages);
          collapsed.forEach(msg => {
            if (msg.type === "mediaGroup") {
              msg.msgs.forEach(m => {
                if (m.id) renderedMsgIds.add(m.id);
              });
              bubblesWrap.appendChild(makeMediaCollageBubble(msg, isSent, fluxDesktopContact, fluxDesktopUser.id));
            } else {
              if (msg.id) renderedMsgIds.add(msg.id);
              bubblesWrap.appendChild(makeBubbleWrap(msg, isSent, fluxDesktopContact, fluxDesktopUser.id));
            }
          });
          applyBubbleGrouping(bubblesWrap);
          rowEl.appendChild(bubblesWrap);
          groupEl.appendChild(rowEl);
          const timeEl = document.createElement("div");
          timeEl.className = "flux-group-time";
          timeEl.textContent = item.time;
          groupEl.appendChild(timeEl);
          frag.appendChild(groupEl);
        }
      });
      const indicator = msgsEl.querySelector(".flux-load-more-indicator");
      if (indicator) {
        msgsEl.insertBefore(frag, indicator.nextSibling);
        indicator.remove();
      } else {
        msgsEl.insertBefore(frag, msgsEl.firstChild);
      }
      mergeAdjacentGroups(msgsEl);
      if (!fluxDesktopAllLoaded) prependLoadMoreIndicator(msgsEl, "desktop");
      msgsEl.scrollTop = msgsEl.scrollHeight - prevScrollHeight;
    } else {
      fluxDesktopAllLoaded = true;
      const indicator = msgsEl.querySelector(".flux-load-more-indicator");
      if (indicator) indicator.remove();
    }
  } catch (e) {}
  fluxDesktopLoadingMore = false;
}

let fluxMobileOffset = 0;

let fluxMobileAllLoaded = false;

let fluxMobileLoadingMore = false;

let fluxMobileUserId = null;

let fluxMobileUser = null;

let fluxMobileContact = null;

async function loadFsMessages(userId) {
  const {data: {user: user}} = await supabaseClient.auth.getUser();
  if (!user) return;
  await subscriptionManager.replaceSubscription(null);
  renderedMsgIds.clear();
  fluxMobileOffset = 0;
  fluxMobileAllLoaded = false;
  fluxMobileLoadingMore = false;
  fluxMobileUserId = userId;
  fluxMobileUser = user;
  fluxMobileContact = fluxContacts.find(c => c.id === userId);
  const msgsEl = document.getElementById("fluxFsMessages");
  if (!msgsEl) return;
  const isGroupConv = _fluxConvIsGroup(userId);
  try {
    const {count: count} = await _fluxApplyConvFilter(supabaseClient.from("messages").select("*", {
      count: "exact",
      head: true
    }), userId, user.id, isGroupConv);
    const total = count || 0;
    fluxMobileOffset = Math.max(0, total - FLUX_PAGE_SIZE);
    if (fluxMobileOffset === 0) fluxMobileAllLoaded = true;
    const {data: data, error: error} = await _fluxApplyConvFilter(supabaseClient.from("messages").select("*"), userId, user.id, isGroupConv).order("created_at", {
      ascending: true
    }).range(fluxMobileOffset, total - 1);
    if (error) return;
    if (data && data.length > 0) {
      data.forEach(m => {
        if (m.id) renderedMsgIds.add(m.id);
      });
      const groups = groupMessages(data.map(m => ({
        ...m,
        ts: m.created_at
      })));
      renderGroupedMessages(msgsEl, groups, user.id, fluxMobileContact);
      if (!fluxMobileAllLoaded) prependLoadMoreIndicator(msgsEl, "mobile");
      loadFluxPinnedMessages(userId, "fluxFsMessages");
    } else {
      msgsEl.innerHTML = "";
    }
    loadFluxPinnedMessages(userId, "fluxFsMessages");
  } catch (err) {
    msgsEl.innerHTML = "";
  }
  msgsEl.onscroll = null;
  msgsEl.onscroll = () => {
    if (msgsEl.scrollTop < 80 && !fluxMobileLoadingMore && !fluxMobileAllLoaded) {
      loadMoreMessagesMobile();
    }
  };
  async function _setupMobileMsgChannel() {
    try {
      const channel = supabaseClient.channel(`fs-messages:${user.id}:${userId}`).on("postgres_changes", {
        event: "INSERT",
        schema: "public",
        table: "messages"
      }, payload => {
        const newMsg = payload.new;
        const isForThis = _fluxMsgBelongsToConv(newMsg, userId, user.id, isGroupConv);
        if (!isForThis) return;
        window._fluxUpdateOpenChatSearchWithMessage?.(newMsg, userId);
        if (renderedMsgIds.has(newMsg.id)) return;
        renderedMsgIds.add(newMsg.id);
        if (activeFluxId === userId) {
          if (!isGroupConv && newMsg.sender_id !== user.id) {
            _maybePlayMessageSound(userId, user.id);
          }
          appendIncomingMessage(msgsEl, newMsg, user.id, fluxMobileContact);
          updateContactLastMsg(userId, newMsg, user.id);
          if (!isGroupConv && _isRelayVisibleFor(userId)) {
            markConversationSeen(userId).then(() => fixSeenLabels(msgsEl));
          } else if (isGroupConv && _isRelayVisibleFor(userId)) {
            fixSeenLabels(msgsEl);
          }
          if (!_isRelayVisibleFor(userId)) {
            _markActiveConvBgUnread(userId);
          }
          buildFLUXConvList();
          _updateTitleUnreadBadge();
        } else {
          const c = fluxContacts.find(c => c.id === userId);
          if (c) {
            updateContactLastMsg(userId, newMsg, user.id);
            buildFLUXConvList();
          }
        }
      }).on("postgres_changes", {
        event: "UPDATE",
        schema: "public",
        table: "messages"
      }, payload => {
        const updated = payload.new;
        if (!updated) return;
        const isForThis = _fluxMsgBelongsToConv(updated, userId, user.id, isGroupConv);
        if (!isForThis) return;
        if (updated.edited) {
          [ "fluxRelayMessages", "fluxFsMessages" ].forEach(cId => {
            const container = document.getElementById(cId);
            if (!container) return;
            const bWrap = container.querySelector(`.flux-bubble-wrap[data-msg-id="${updated.id}"]`);
            if (bWrap) applyEditToBubble(bWrap, updated.content, updated.sender_id === user.id);
          });
        }
        if (updated.reactions !== undefined) {
          if (updated.id) _reactionCache[updated.id] = updated.reactions || {};
          [ "fluxRelayMessages", "fluxFsMessages" ].forEach(cId => {
            const container = document.getElementById(cId);
            if (!container) return;
            const bWrap = container.querySelector(`.flux-bubble-wrap[data-msg-id="${updated.id}"]`);
            if (bWrap) applyReactionsToWrap(bWrap, updated.reactions || {}, user.id);
          });
        }
      }).on("postgres_changes", {
        event: "DELETE",
        schema: "public",
        table: "messages"
      }, async payload => {
        if (activeFluxId !== userId) return;
        if (_clearingRelayForUserId === userId) return;
        const deletedId = payload.old?.id;
        if (deletedId) {
          const bWrap = msgsEl.querySelector(`.flux-bubble-wrap[data-msg-id="${deletedId}"]`);
          if (bWrap) {
            const parentGroup = bWrap.closest(".flux-msg-group");
            bWrap.remove();
            if (parentGroup && parentGroup.querySelectorAll(".flux-bubble-wrap").length === 0) parentGroup.remove();
          }
        }
        const {data: lastMsg} = await _fluxApplyConvFilter(supabaseClient.from("messages").select("*"), userId, user.id, isGroupConv).order("created_at", {
          ascending: false
        }).limit(1).single();
        if (lastMsg) {
          updateContactLastMsg(userId, lastMsg, user.id);
        } else {
          buildFLUXConvList();
        }
      }).subscribe((status, err) => {
        if ((status === "CLOSED" || status === "CHANNEL_ERROR" || status === "TIMED_OUT") && !subscriptionManager._intentionalTeardown && fluxOpen && activeFluxId === userId) {
          console.warn("[FLUX] mobile message channel dropped, reconnecting:", status, err);
          _setupMobileMsgChannel();
        }
      });
      await subscriptionManager.replaceSubscription(channel);
    } catch (err) {}
  }
  _fluxRebuildMsgChannel = _setupMobileMsgChannel;
  await _setupMobileMsgChannel();
}

async function loadMoreMessagesMobile() {
  if (fluxMobileAllLoaded || fluxMobileLoadingMore || !fluxMobileUserId || !fluxMobileUser) return;
  fluxMobileLoadingMore = true;
  const msgsEl = document.getElementById("fluxFsMessages");
  if (!msgsEl) {
    fluxMobileLoadingMore = false;
    return;
  }
  const newEnd = fluxMobileOffset - 1;
  const newStart = Math.max(0, fluxMobileOffset - FLUX_LOAD_MORE);
  if (newStart <= 0) fluxMobileAllLoaded = true;
  fluxMobileOffset = newStart;
  try {
    const {data: data} = await _fluxApplyConvFilter(supabaseClient.from("messages").select("*"), fluxMobileUserId, fluxMobileUser.id, _fluxConvIsGroup(fluxMobileUserId)).order("created_at", {
      ascending: true
    }).range(newStart, newEnd);
    if (data && data.length > 0) {
      const prevScrollHeight = msgsEl.scrollHeight;
      const groups = groupMessages(data.map(m => ({
        ...m,
        ts: m.created_at
      })));
      const frag = document.createDocumentFragment();
      groups.forEach(item => {
        if (item.type === "separator") {
          const sep = document.createElement("div");
          sep.className = "flux-time-separator";
          sep.textContent = item.label;
          frag.appendChild(sep);
        } else if (item.type === "system") {
          frag.appendChild(makeSystemMsgEl(item.content));
        } else {
          const isSent = item.sender_id === fluxMobileUser.id;
          const groupEl = document.createElement("div");
          groupEl.className = `flux-msg-group ${isSent ? "sent" : "received"}`;
          groupEl.dataset.groupTs = item.groupKey;
          groupEl.dataset.senderId = item.sender_id;
          groupEl.dataset.minuteKey = item.minuteKey;
          groupEl.dataset.createdAt = item.firstTs || "";
          const rowEl = document.createElement("div");
          rowEl.className = "flux-msg-group-row";
          if (!isSent) rowEl.appendChild(makeGroupAvatar(fluxMobileContact, item.sender_id));
          const bubblesWrap = document.createElement("div");
          bubblesWrap.className = "flux-msg-bubbles";
          const collapsed = collapseMediaGroups(item.messages);
          collapsed.forEach(msg => {
            if (msg.type === "mediaGroup") {
              msg.msgs.forEach(m => {
                if (m.id) renderedMsgIds.add(m.id);
              });
              bubblesWrap.appendChild(makeMediaCollageBubble(msg, isSent, fluxMobileContact, fluxMobileUser.id));
            } else {
              if (msg.id) renderedMsgIds.add(msg.id);
              bubblesWrap.appendChild(makeBubbleWrap(msg, isSent, fluxMobileContact, fluxMobileUser.id));
            }
          });
          applyBubbleGrouping(bubblesWrap);
          rowEl.appendChild(bubblesWrap);
          groupEl.appendChild(rowEl);
          const timeEl = document.createElement("div");
          timeEl.className = "flux-group-time";
          timeEl.textContent = item.time;
          groupEl.appendChild(timeEl);
          frag.appendChild(groupEl);
        }
      });
      const indicator = msgsEl.querySelector(".flux-load-more-indicator");
      if (indicator) {
        msgsEl.insertBefore(frag, indicator.nextSibling);
        indicator.remove();
      } else {
        msgsEl.insertBefore(frag, msgsEl.firstChild);
      }
      mergeAdjacentGroups(msgsEl);
      if (!fluxMobileAllLoaded) prependLoadMoreIndicator(msgsEl, "mobile");
      msgsEl.scrollTop = msgsEl.scrollHeight - prevScrollHeight;
    } else {
      fluxMobileAllLoaded = true;
      const indicator = msgsEl.querySelector(".flux-load-more-indicator");
      if (indicator) indicator.remove();
    }
  } catch (e) {}
  fluxMobileLoadingMore = false;
}

function appendIncomingMessage(container, msg, currentUserId, contact) {
  if (msg.message_type === "system") {
    const el = makeSystemMsgEl(msg.content || "");
    const typingEl = document.getElementById("fluxTypingSlot") || document.getElementById("fluxFsTypingSlot") || document.getElementById("fluxTypingDots") || document.getElementById("fluxFsTypingDots");
    if (typingEl && typingEl.parentNode === container) container.insertBefore(el, typingEl); else container.appendChild(el);
    container.scrollTop = container.scrollHeight;
    return;
  }
  const isSent = msg.sender_id === currentUserId;
  const d = parseSupabaseDate(msg.created_at || (new Date).toISOString());
  const ts = d.getTime();
  if (isSent) {
    const msgText = msg.content || "";
    container.querySelectorAll(".flux-bubble.sending").forEach(b => {
      const clone = b.cloneNode(true);
      clone.querySelectorAll(".flux-reply-preview, .flux-sending-icon").forEach(el => el.remove());
      if (clone.textContent.trim() === msgText.trim()) {
        const wrap = b.closest(".flux-bubble-wrap");
        if (wrap) {
          b.classList.remove("sending");
          b.style.opacity = "";
          const spinner = b.querySelector(".flux-sending-icon");
          if (spinner) spinner.remove();
          b.dataset.msgId = msg.id;
          wrap.dataset.msgId = msg.id;
          const outer = wrap.closest(".flux-bubble-outer");
          if (outer) outer.dataset.msgId = msg.id;
          const moreBtn = wrap.querySelector(".flux-more-btn");
          if (moreBtn) {
            moreBtn.onclick = e => {
              e.stopPropagation();
              showMsgActionMenu(e, wrap, msg, true);
            };
          }
          const parentGroup = wrap.closest(".flux-msg-group");
          if (parentGroup) parentGroup.dataset.groupTs = ts;
          container.scrollTop = container.scrollHeight;
          fixSeenLabels(container);
          return;
        }
      }
    });
    const stillPending = [ ...container.querySelectorAll(".flux-bubble.sending") ].some(b => {
      const clone = b.cloneNode(true);
      clone.querySelectorAll(".flux-reply-preview, .flux-sending-icon").forEach(el => el.remove());
      return clone.textContent.trim() === (msg.content || "").trim();
    });
    if (!stillPending) {
      container.scrollTop = container.scrollHeight;
      return;
    }
  }
  const allGroups = container.querySelectorAll(".flux-msg-group");
  const lastGroup = allGroups[allGroups.length - 1];
  const msgCreatedAt = msg.created_at || null;
  const incomingMinuteKey = msgCreatedAt ? msgMinuteKey(msgCreatedAt, msg.sender_id) : null;
  const isIncomingMediaOnly = _isMsgMediaOnly(msg);
  if (lastGroup && lastGroup.dataset.senderId === msg.sender_id) {
    const bubblesWrap = lastGroup.querySelector(".flux-msg-bubbles");
    const lastBubbleOuter = bubblesWrap ? bubblesWrap.lastElementChild : null;
    const lastBubbleIsMedia = lastBubbleOuter && (lastBubbleOuter.querySelector(".flux-bubble-media-only") !== null || lastBubbleOuter.querySelector(".flux-media-collage") !== null);
    const lastGroupTs = parseInt(lastGroup.dataset.groupTs || "0", 10);
    const withinWindow = ts - lastGroupTs <= MEDIA_GROUP_GAP_MS;
    const withinMediaGap = isIncomingMediaOnly && lastBubbleIsMedia && withinWindow;
    if ((withinWindow || withinMediaGap) && bubblesWrap) {
      if (withinMediaGap && !withinWindow) {
        _appendMediaToGroup(bubblesWrap, msg, isSent, contact, currentUserId);
      } else {
        bubblesWrap.appendChild(makeBubbleWrap(msg, isSent, contact, currentUserId));
        if (isIncomingMediaOnly) _recollapseMediaInBubbles(bubblesWrap, isSent, contact, currentUserId);
      }
      applyBubbleGrouping(bubblesWrap);
      const timeEl = lastGroup.querySelector(".flux-group-time");
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
  const groupEl = document.createElement("div");
  groupEl.className = `flux-msg-group ${isSent ? "sent" : "received"}`;
  groupEl.dataset.groupTs = ts;
  groupEl.dataset.senderId = msg.sender_id;
  groupEl.dataset.minuteKey = incomingMinuteKey || "";
  groupEl.dataset.createdAt = msgCreatedAt || "";
  groupEl.style.animation = "msgIn 0.15s ease";
  const rowEl = document.createElement("div");
  rowEl.className = "flux-msg-group-row";
  if (!isSent) rowEl.appendChild(makeGroupAvatar(contact, msg.sender_id));
  const bubblesWrap = document.createElement("div");
  bubblesWrap.className = "flux-msg-bubbles";
  bubblesWrap.appendChild(makeBubbleWrap(msg, isSent, contact, currentUserId));
  applyBubbleGrouping(bubblesWrap);
  rowEl.appendChild(bubblesWrap);
  groupEl.appendChild(rowEl);
  const timeEl = document.createElement("div");
  timeEl.className = "flux-group-time";
  timeEl.textContent = formatMsgTime(d);
  groupEl.appendChild(timeEl);
  const typingEl = document.getElementById("fluxTypingSlot") || document.getElementById("fluxFsTypingSlot") || document.getElementById("fluxTypingDots") || document.getElementById("fluxFsTypingDots");
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
  _fluxRealtimeClearedConversations.delete(userId);
  const d = parseSupabaseDate(msg.created_at);
  const senderName = msg.sender_id === currentUserId ? "You" : _fluxGroupMsgSenderName(contact, msg.sender_id) || contact.username || contact.realName || contact.name;
  contact.lastMessage = {
    type: msg.sender_id === currentUserId ? "sent" : "received",
    text: msg.content,
    media: !!msg.media_url,
    time: formatMsgTime(d),
    senderName: senderName
  };
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
  _fluxActiveConvBgUnread = false;
  hideRemoteTyping();
  activeFluxId = id;
  _fluxClearPinnedFrontend?.();
  _updateUnarchiveBtnVisibility(id);
  _fluxSubscribePinnedMessages(id);
  const av = document.getElementById("fluxFsAvatar");
  _fluxSetProfileTabAvatar(av, contact.avatarUrl, contact.isGroup && !contact.avatarUrl ? contact.memberAvatars : null);
  document.getElementById("fluxFsName").textContent = contact.name;
  const fsUsernameEl = document.getElementById("fluxFsUsername");
  if (fsUsernameEl) {
    const raw = contact.username || contact.realName || contact.name;
    fsUsernameEl.textContent = "@" + raw;
  }
  if (_fluxConvIsGroup(id)) {
    _fluxUpdateGroupHeaderMembers(id);
  }
  resetPresenceDots();
  updatePresenceDots();
  const themePromise = loadRelayThemeFromSupabase(id);
  subscribeToRelayTheme(id);
  document.getElementById("fluxFsListView").style.display = "none";
  const relayView = document.getElementById("fluxFsRelayView");
  relayView.style.display = "flex";
  relayView.style.flexDirection = "column";
  relayView.style.height = "100%";
  const msgsEl = document.getElementById("fluxFsMessages");
  showSkeletonMessages(msgsEl);
  const {data: {user: user}} = await supabaseClient.auth.getUser();
  if (user) await setupTypingChannel(user.id, id);
  await themePromise;
  loadFsMessages(id);
  cancelReply("mobile");
  clearFluxFsStaging();
  if (currentEditState) {
    currentEditState = null;
    document.getElementById("fluxEditBar")?.classList.remove("show");
    document.getElementById("fluxFsEditBar")?.classList.remove("show");
  }
  document.getElementById("fluxFsInput").focus();
  await markConversationSeen(id);
}

function fluxFsBack() {
  document.getElementById("fluxFsRelayView").style.display = "none";
  document.getElementById("fluxFsListView").style.display = "flex";
  stopTypingBroadcast();
  activeFluxId = null;
  _fluxActiveConvBgUnread = false;
  hideRemoteTyping();
  resetPresenceDots();
  buildFLUXConvList();
  if (_fluxPinnedChannel) {
    try {
      supabaseClient.removeChannel(_fluxPinnedChannel);
    } catch (e) {}
    _fluxPinnedChannel = null;
  }
}

function fluxHandleKey(e, mode) {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    fluxSend(mode);
  }
  if (e.key === "Escape" && currentEditState) {
    e.preventDefault();
    cancelEdit(mode);
  }
}

async function fluxSend(mode) {
  if (currentEditState) {
    const inputId = mode === "mobile" ? "fluxFsInput" : "fluxInput";
    const input = document.getElementById(inputId);
    const newText = (input?.value || "").trim();
    await commitEdit(newText);
    return;
  }
  const inputId = mode === "mobile" ? "fluxFsInput" : "fluxInput";
  const sendBtnId = mode === "mobile" ? "fluxFsSendBtn" : "fluxSendBtn";
  const input = document.getElementById(inputId);
  const sendBtn = document.getElementById(sendBtnId);
  const staged = _getFluxStaged(mode).slice();
  if (sendBtn && sendBtn.dataset.sending === "1") return;
  if (!staged.length && !input.value.trim()) {
    input.style.height = "auto";
    return;
  }
  if (!activeFluxId) {
    input.style.height = "auto";
    return;
  }
  if (staged.length && !fluxMediaSendingAllowed()) {
    _setFluxStaged(mode, []);
    if (mode === "mobile") clearFluxFsStaging(); else clearFluxStaging();
    showMediaPermToast();
    return;
  }
  const text = input.value.trim().replace(/(?<![a-zA-Z])[Tt]-[Tt](?![a-zA-Z])/g, "😭");
  if (sendBtn) {
    sendBtn.dataset.sending = "1";
    sendBtn.style.opacity = "0.5";
    sendBtn.disabled = true;
  }
  input.value = "";
  input.style.height = "auto";
  if (mode === "mobile") input.focus();
  if (mode === "mobile") toggleFluxFsSendBtn(); else toggleFluxSendBtn();
  const {data: {user: user}} = await supabaseClient.auth.getUser();
  const msgReplyTo = replyingTo ? {
    ...replyingTo
  } : null;
  cancelReply(mode);
  stopTypingBroadcast();
  const msgsEl = document.getElementById(mode === "mobile" ? "fluxFsMessages" : "fluxRelayMessages");
  const contact = fluxContacts.find(c => c.id === activeFluxId);
  const mediaLoadingRemovers = [];
  let captionBubbleRefs = null;
  staged.forEach((media, idx) => {
    const isLastMedia = idx === staged.length - 1;
    if (isLastMedia && text) {
      const refs = appendFluxMediaCaptionBubble(msgsEl, media.dataUrl, media.isVideo, text, user ? user.id : null, contact);
      captionBubbleRefs = refs;
      mediaLoadingRemovers.push(refs.removeLoading);
    } else {
      mediaLoadingRemovers.push(appendFluxMediaBubble(msgsEl, media.dataUrl, media.isVideo, user ? user.id : null, contact));
    }
  });
  if (mode === "mobile") clearFluxFsStaging(); else clearFluxStaging();
  const now = new Date;
  const nowTs = now.getTime();
  const nowIso = now.toISOString();
  const allGroups = msgsEl.querySelectorAll(".flux-msg-group");
  const lastGroup = allGroups[allGroups.length - 1];
  let bWrap, bubble, moreBtnOpt;
  if (captionBubbleRefs) {
    bWrap = captionBubbleRefs.bWrap;
    bubble = captionBubbleRefs.bubble;
  } else {
    bWrap = document.createElement("div");
    bWrap.className = "flux-bubble-wrap";
    bWrap.dataset.text = text;
    bWrap.dataset.sender = profile.username ? profile.username.slice(1) : "me";
    bWrap.dataset.ts = nowIso;
    bWrap.dataset.minuteKey = msgMinuteKey(nowIso, user.id);
    const replyBtnOpt = document.createElement("button");
    replyBtnOpt.className = "flux-reply-btn";
    replyBtnOpt.title = "Reply";
    replyBtnOpt.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg>`;
    replyBtnOpt.onclick = e => {
      e.stopPropagation();
      startReply(text, profile.username ? profile.username.slice(1) : "me", bWrap.dataset.msgId || null);
    };
    moreBtnOpt = document.createElement("button");
    moreBtnOpt.className = "flux-more-btn";
    moreBtnOpt.title = "More options";
    moreBtnOpt.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg>`;
    const displayText = text;
    bubble = document.createElement("div");
    const optimisticEmojiOnly = isEmojiOnly(displayText) && !staged.length;
    bubble.className = "flux-bubble" + (optimisticEmojiOnly ? " flux-bubble-emoji-only" : "") + " sending";
    if (msgReplyTo) {
      const rp = _buildReplyPreview(msgReplyTo.text, msgReplyTo.author, msgReplyTo.image);
      rp.dataset.replyToId = msgReplyTo.id || "";
      rp.onclick = e => {
        e.stopPropagation();
        scrollToReplyTarget(msgReplyTo.id, msgReplyTo.text, msgReplyTo.author || "");
      };
      bubble.prepend(rp);
    }
    if (displayText) {
      const textNode = document.createElement("div");
      textNode.textContent = displayText;
      bubble.appendChild(textNode);
    }
    bWrap.appendChild(moreBtnOpt);
    bWrap.appendChild(replyBtnOpt);
    bWrap.appendChild(bubble);
    addSwipeToReply(bWrap, true, () => startReply(text, profile.username ? profile.username.slice(1) : "me", bWrap.dataset.msgId || null));
    if (!text) {} else {
      const nowMinuteKey = msgMinuteKey(nowIso, user.id);
      if (lastGroup && lastGroup.dataset.senderId === user.id && lastGroup.dataset.minuteKey === nowMinuteKey) {
        const bubblesWrap = lastGroup.querySelector(".flux-msg-bubbles");
        if (bubblesWrap) {
          bubblesWrap.appendChild(bWrap);
          applyBubbleGrouping(bubblesWrap);
          const timeEl = lastGroup.querySelector(".flux-group-time");
          if (timeEl) timeEl.textContent = formatMsgTime(now);
          lastGroup.dataset.groupTs = nowTs;
          lastGroup.dataset.minuteKey = nowMinuteKey;
          lastGroup.dataset.createdAt = nowIso;
        }
      } else {
        const optimisticGroup = document.createElement("div");
        optimisticGroup.className = "flux-msg-group sent";
        optimisticGroup.dataset.groupTs = nowTs;
        optimisticGroup.dataset.senderId = user.id;
        optimisticGroup.dataset.minuteKey = nowMinuteKey;
        optimisticGroup.dataset.createdAt = nowIso;
        optimisticGroup.dataset.optimistic = "true";
        const rowEl = document.createElement("div");
        rowEl.className = "flux-msg-group-row";
        const bubblesWrap = document.createElement("div");
        bubblesWrap.className = "flux-msg-bubbles";
        bubblesWrap.appendChild(bWrap);
        applyBubbleGrouping(bubblesWrap);
        rowEl.appendChild(bubblesWrap);
        optimisticGroup.appendChild(rowEl);
        const timeEl = document.createElement("div");
        timeEl.className = "flux-group-time";
        timeEl.textContent = formatMsgTime(now);
        optimisticGroup.appendChild(timeEl);
        const _typSlot = msgsEl.querySelector(".flux-typing-indicator");
        if (_typSlot) {
          msgsEl.insertBefore(optimisticGroup, _typSlot);
        } else {
          msgsEl.appendChild(optimisticGroup);
        }
        pinTypingIndicator(msgsEl);
      }
    }
  }
  mergeAdjacentGroups(msgsEl);
  try {
    const bubbleForScroll = bWrap && (bWrap.querySelector(".flux-bubble") || bWrap);
    const delta = bubbleForScroll && bubbleForScroll.offsetHeight || 0;
    const maxScroll = msgsEl.scrollHeight - msgsEl.clientHeight;
    if (delta > 0) msgsEl.scrollTop = Math.min(msgsEl.scrollTop + delta + 5, maxScroll);
  } catch (e) {}
  try {
    const isGroupConv = !!(contact && contact.isGroup);
    const mediaMessages = [];
    for (let mediaIndex = 0; mediaIndex < staged.length; mediaIndex++) {
      const media = staged[mediaIndex];
      const uploadedMediaUrl = await uploadChatMedia(media.dataUrl, media.isVideo, user.id);
      const insertData = {
        sender_id: user.id,
        receiver_id: isGroupConv ? null : activeFluxId,
        group_id: isGroupConv ? activeFluxId : null,
        content: mediaIndex === staged.length - 1 && text ? text.trim() : null,
        media_url: uploadedMediaUrl || media.dataUrl,
        is_video: media.isVideo
      };
      if (msgReplyTo && mediaIndex === 0) {
        insertData.reply_to_text = msgReplyTo.text;
        insertData.reply_to_author = msgReplyTo.author;
        if (msgReplyTo.id) insertData.reply_to_id = msgReplyTo.id;
        if (msgReplyTo.image) insertData.reply_to_media_url = msgReplyTo.image;
      }
      const {data: inserted, error: error} = await supabaseClient.from("messages").insert(insertData).select().single();
      if (error) throw error;
      mediaMessages.push(inserted);
      if (inserted?.id) renderedMsgIds.add(inserted.id);
      window._fluxUpdateOpenChatSearchWithMessage?.(inserted, activeFluxId);
      updateContactLastMsg(activeFluxId, inserted, user.id);
    }
    let inserted = mediaMessages[mediaMessages.length - 1] || null;
    if (!staged.length && text) {
      const insertData = {
        sender_id: user.id,
        receiver_id: isGroupConv ? null : activeFluxId,
        group_id: isGroupConv ? activeFluxId : null,
        content: text.trim(),
        media_url: null,
        is_video: false
      };
      if (msgReplyTo) {
        insertData.reply_to_text = msgReplyTo.text;
        insertData.reply_to_author = msgReplyTo.author;
        if (msgReplyTo.id) insertData.reply_to_id = msgReplyTo.id;
        if (msgReplyTo.image) insertData.reply_to_media_url = msgReplyTo.image;
      }
      const result = await supabaseClient.from("messages").insert(insertData).select().single();
      if (result.error) throw result.error;
      inserted = result.data;
      if (inserted?.id) {
        renderedMsgIds.add(inserted.id);
        window._fluxUpdateOpenChatSearchWithMessage?.(inserted, activeFluxId);
        updateContactLastMsg(activeFluxId, inserted, user.id);
      }
    }
    bubble.classList.remove("sending");
    bubble.style.opacity = "";
    if (inserted?.id) {
      bWrap.dataset.msgId = inserted.id;
      bubble.dataset.msgId = inserted.id;
      const bOuter = bWrap.closest(".flux-bubble-outer");
      if (bOuter) bOuter.dataset.msgId = inserted.id;
      if (moreBtnOpt) moreBtnOpt.onclick = e => {
        e.stopPropagation();
        showMsgActionMenu(e, bWrap, inserted, true);
      };
    }
    buildFLUXConvList();
    mediaLoadingRemovers.forEach(fn => {
      try {
        fn?.();
      } catch (e) {}
    });
    if (msgsEl) fixSeenLabels(msgsEl);
  } catch (err) {
    if (window._fluxMediaLoadingRemover) {
      window._fluxMediaLoadingRemover();
      window._fluxMediaLoadingRemover = null;
    }
    bubble.classList.remove("sending");
    bubble.style.opacity = "0.5";
    bubble.title = "Failed to send";
  } finally {
    if (sendBtn) {
      delete sendBtn.dataset.sending;
      sendBtn.style.opacity = "";
      sendBtn.disabled = false;
    }
    if (mode === "mobile") input.focus(); else input.focus();
  }
}

async function uploadChatMedia(dataUrl, isVideo, userId) {
  try {
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    const ext = isVideo ? blob.type.split("/")[1] || "mp4" : blob.type.split("/")[1] || "jpg";
    const path = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    const {error: uploadError} = await supabaseClient.storage.from("chat-media").upload(path, blob, {
      contentType: blob.type,
      upsert: false
    });
    if (uploadError) throw uploadError;
    const {data: data} = supabaseClient.storage.from("chat-media").getPublicUrl(path);
    return data?.publicUrl || null;
  } catch (err) {
    console.error("Chat media upload failed, falling back to inline data URL:", err);
    return null;
  }
}

(function ensureFluxMultiMediaStagingStyles() {
  if (document.getElementById("fluxMultiMediaStagingStyles")) return;
  const style = document.createElement("style");
  style.id = "fluxMultiMediaStagingStyles";
  style.textContent = `\n    .flux-media-staging-inner { min-width:0; display:flex; align-items:center; gap:10px; }\n    .flux-media-staging-thumb {\n      display:flex !important;\n      align-items:center;\n      gap:7px;\n      min-width:0;\n      max-width:calc(100vw - 210px);\n      overflow-x:auto;\n      overflow-y:hidden;\n      scrollbar-width:none;\n    }\n    .flux-media-staging-thumb::-webkit-scrollbar { display:none; }\n    .flux-media-staging-item { position:relative; }\n    .flux-media-staging-remove {\n      position:absolute;\n      top:-6px;\n      right:-6px;\n      width:18px;\n      height:18px;\n      padding:0;\n      border:0;\n      border-radius:50%;\n      background:rgba(20,20,22,.94);\n      color:#fff;\n      font-size:14px;\n      line-height:18px;\n      text-align:center;\n      cursor:pointer;\n      opacity:1;\n      transform:scale(1);\n      transition:opacity .14s ease, transform .14s ease;\n      z-index:3;\n      box-shadow:0 2px 6px rgba(0,0,0,.25);\n    }\n    .flux-media-staging-item:hover .flux-media-staging-remove,\n    .flux-media-staging-remove:focus-visible {\n      opacity:1;\n      transform:scale(1);\n    }\n    .flux-media-staging-remove:hover { background:#333; }\n    .flux-media-staging-addmore {\n      flex:0 0 auto;\n      width:59px;\n      height:59px;\n      border-radius:9px;\n      border:1.5px dashed var(--border, rgba(255,255,255,.25));\n      background:var(--bg2, rgba(255,255,255,.04));\n      color:var(--text2, #999);\n      display:flex;\n      align-items:center;\n      justify-content:center;\n      cursor:pointer;\n      transition:background .15s ease;\n    }\n    .flux-media-staging-addmore:hover {\n      background:#333;\n    }\n  `;
  document.head.appendChild(style);
})();

function stageFluxMedia(e, mode) {
  const files = Array.from(e.target.files || []);
  if (!files.length) return;
  files.forEach(file => {
    if (!file.type.startsWith("image/") && !file.type.startsWith("video/")) return;
    const reader = new FileReader;
    reader.onload = ev => stageFluxMediaFromDataUrl(ev.target.result, file.type.startsWith("video/"), mode);
    reader.readAsDataURL(file);
  });
  e.target.value = "";
}

function _getFluxStaged(mode) {
  if (mode === "mobile") {
    if (!Array.isArray(fluxFsStagedMedia)) fluxFsStagedMedia = fluxFsStagedMedia ? [ fluxFsStagedMedia ] : [];
    return fluxFsStagedMedia;
  }
  if (!Array.isArray(fluxStagedMedia)) fluxStagedMedia = fluxStagedMedia ? [ fluxStagedMedia ] : [];
  return fluxStagedMedia;
}

function _setFluxStaged(mode, value) {
  if (mode === "mobile") fluxFsStagedMedia = value; else fluxStagedMedia = value;
}

function _renderFluxStaging(mode) {
  const staged = _getFluxStaged(mode);
  const wrapId = mode === "mobile" ? "fluxFsMediaStagingWrap" : "fluxMediaStagingWrap";
  const thumbId = mode === "mobile" ? "fluxFsMediaStagingThumb" : "fluxMediaStagingThumb";
  const wrap = document.getElementById(wrapId);
  const thumb = document.getElementById(thumbId);
  if (!wrap || !thumb) return;
  thumb.innerHTML = "";
  staged.forEach((media, index) => {
    const item = document.createElement("div");
    item.className = "flux-media-staging-item";
    item.style.cssText = "position:relative;width:72px;height:58px;flex:0 0 auto;";
    const mediaEl = media.isVideo ? document.createElement("video") : document.createElement("img");
    mediaEl.src = media.dataUrl;
    mediaEl.style.cssText = "width:72px;height:58px;object-fit:cover;border-radius:7px;display:block;";
    if (media.isVideo) {
      mediaEl.muted = true;
      mediaEl.playsInline = true;
      mediaEl.preload = "metadata";
    }
    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "flux-media-staging-remove";
    removeBtn.title = "Remove";
    removeBtn.setAttribute("aria-label", "Remove media");
    removeBtn.innerHTML = "&times;";
    removeBtn.onclick = ev => {
      ev.preventDefault();
      ev.stopPropagation();
      const next = _getFluxStaged(mode).filter((_, i) => i !== index);
      _setFluxStaged(mode, next);
      _renderFluxStaging(mode);
      if (mode === "mobile") toggleFluxFsSendBtn(); else toggleFluxSendBtn();
    };
    item.appendChild(mediaEl);
    item.appendChild(removeBtn);
    thumb.appendChild(item);
  });
  wrap.classList.toggle("show", staged.length > 0);
  if (mode === "mobile") toggleFluxFsSendBtn(); else toggleFluxSendBtn();
}

function fluxMediaSendingAllowed() {
  return window._cachedMediaPerm !== false;
}

function stageFluxMediaFromDataUrl(dataUrl, isVideo, mode) {
  if (!fluxMediaSendingAllowed()) {
    showMediaPermToast();
    return;
  }
  const staged = _getFluxStaged(mode);
  staged.push({
    dataUrl: dataUrl,
    isVideo: isVideo
  });
  _setFluxStaged(mode, staged);
  _renderFluxStaging(mode);
}

function showMediaPermToast() {
  showFluxErrorToast("Insufficient permission", "Error (403)");
}

function showFluxErrorToast(message, title = "Error") {
  let el = document.getElementById("fluxErrorToast");
  if (el) el.remove();
  el = document.createElement("div");
  el.id = "fluxErrorToast";
  el.innerHTML = '<div style="font-weight:600;">' + escHtml(title) + "</div>" + '<div style="margin-top:4px;color:#c9c9c9;">' + escHtml(message) + "</div>";
  el.style.cssText = "position:fixed;top:32px;right:0;width:250px;height:98px;" + "background:#0a0a0a;color:#fff;box-sizing:border-box;" + "border-left:6px solid #76b900;" + "display:flex;flex-direction:column;align-items:flex-start;justify-content:center;padding:16px 18px;" + "font-size:13px;font-family:inherit;letter-spacing:.2px;line-height:1.4;" + "box-shadow:0 8px 28px rgba(0,0,0,.55);" + "z-index:99999;pointer-events:none;" + "transform:translateX(100%);transition:transform .30s cubic-bezier(.16,.84,.44,1);";
  document.body.appendChild(el);
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      el.style.transform = "translateX(0)";
    });
  });
  setTimeout(() => {
    el.style.transition = "transform .26s cubic-bezier(.55,0,.85,.35)";
    el.style.transform = "translateX(100%)";
    setTimeout(() => el.remove(), 280);
  }, 3400);
}

function clearFluxStaging() {
  fluxStagedMedia = [];
  const wrap = document.getElementById("fluxMediaStagingWrap");
  const thumb = document.getElementById("fluxMediaStagingThumb");
  if (wrap) wrap.classList.remove("show");
  if (thumb) thumb.innerHTML = "";
  toggleFluxSendBtn();
}

function clearFluxFsStaging() {
  fluxFsStagedMedia = [];
  const wrap = document.getElementById("fluxFsMediaStagingWrap");
  const el = document.getElementById("fluxFsMediaStagingThumb");
  if (wrap) wrap.classList.remove("show");
  if (el) el.innerHTML = "";
  toggleFluxFsSendBtn();
}

function appendFluxMediaBubble(container, dataUrl, isVideo, currentUserId, contact) {
  const now = new Date;
  const groupEl = document.createElement("div");
  groupEl.className = "flux-msg-group sent";
  groupEl.dataset.groupTs = now.getTime();
  groupEl.dataset.senderId = currentUserId || "";
  const rowEl = document.createElement("div");
  rowEl.className = "flux-msg-group-row";
  const bubblesWrap = document.createElement("div");
  bubblesWrap.className = "flux-msg-bubbles";
  const bWrap = document.createElement("div");
  bWrap.className = "flux-bubble-wrap";
  const mediaWrap = document.createElement("div");
  mediaWrap.className = "flux-bubble-media-only";
  if (isVideo) {
    const vid = document.createElement("video");
    vid.controls = true;
    vid.src = dataUrl;
    vid.style.cssText = "max-width:220px;max-height:180px;border-radius:12px;display:block;box-shadow:0 2px 10px rgba(0,0,0,0.12);";
    mediaWrap.appendChild(vid);
  } else {
    const img = document.createElement("img");
    img.src = dataUrl;
    img.style.cssText = "max-width:220px;max-height:180px;border-radius:12px;display:block;cursor:pointer;box-shadow:0 2px 10px rgba(0,0,0,0.12);";
    img.onclick = () => openLightbox(dataUrl, [ dataUrl ]);
    mediaWrap.appendChild(img);
  }
  const loadingEl = document.createElement("div");
  loadingEl.className = "flux-media-loading";
  loadingEl.innerHTML = `<div class="flux-sending-spinner"></div>`;
  loadingEl.style.cssText = "display:flex;align-items:center;justify-content:flex-end;padding:3px 2px 0;";
  bWrap.appendChild(mediaWrap);
  bWrap.appendChild(loadingEl);
  bubblesWrap.appendChild(bWrap);
  rowEl.appendChild(bubblesWrap);
  groupEl.appendChild(rowEl);
  const timeEl = document.createElement("div");
  timeEl.className = "flux-group-time";
  timeEl.textContent = formatMsgTime(now);
  groupEl.appendChild(timeEl);
  const _typSlotMedia = container.querySelector(".flux-typing-indicator");
  if (_typSlotMedia) {
    container.insertBefore(groupEl, _typSlotMedia);
  } else {
    container.appendChild(groupEl);
  }
  pinTypingIndicator(container);
  container.scrollTop = container.scrollHeight;
  return () => {
    loadingEl.remove();
  };
}

function appendFluxMediaCaptionBubble(container, dataUrl, isVideo, captionText, currentUserId, contact) {
  const now = new Date;
  const groupEl = document.createElement("div");
  groupEl.className = "flux-msg-group sent";
  groupEl.dataset.groupTs = now.getTime();
  groupEl.dataset.senderId = currentUserId || "";
  const rowEl = document.createElement("div");
  rowEl.className = "flux-msg-group-row";
  const bubblesWrap = document.createElement("div");
  bubblesWrap.className = "flux-msg-bubbles";
  const bWrap = document.createElement("div");
  bWrap.className = "flux-bubble-wrap";
  const bubble = document.createElement("div");
  bubble.className = "flux-bubble flux-bubble-media-caption sending";
  if (isVideo) {
    const vid = document.createElement("video");
    vid.controls = true;
    vid.src = dataUrl;
    vid.className = "flux-bubble-caption-media";
    bubble.appendChild(vid);
  } else {
    const img = document.createElement("img");
    img.src = dataUrl;
    img.className = "flux-bubble-caption-media";
    img.onclick = () => openLightbox(dataUrl, [ dataUrl ]);
    bubble.appendChild(img);
  }
  const textEl = document.createElement("div");
  textEl.className = "flux-bubble-caption-text";
  textEl.textContent = captionText;
  bubble.appendChild(textEl);
  const loadingEl = document.createElement("div");
  loadingEl.className = "flux-media-loading";
  loadingEl.innerHTML = `<div class="flux-sending-spinner"></div>`;
  loadingEl.style.cssText = "display:flex;align-items:center;justify-content:flex-end;padding:3px 8px 4px;";
  bubble.appendChild(loadingEl);
  bWrap.appendChild(bubble);
  bubblesWrap.appendChild(bWrap);
  rowEl.appendChild(bubblesWrap);
  groupEl.appendChild(rowEl);
  const timeEl = document.createElement("div");
  timeEl.className = "flux-group-time";
  timeEl.textContent = formatMsgTime(now);
  groupEl.appendChild(timeEl);
  const _typSlotMediaCap = container.querySelector(".flux-typing-indicator");
  if (_typSlotMediaCap) {
    container.insertBefore(groupEl, _typSlotMediaCap);
  } else {
    container.appendChild(groupEl);
  }
  pinTypingIndicator(container);
  container.scrollTop = container.scrollHeight;
  return {
    bWrap: bWrap,
    bubble: bubble,
    removeLoading: () => {
      loadingEl.remove();
      bubble.classList.remove("sending");
    }
  };
}

let _lightboxUrls = [];

let _lightboxIdx = 0;

let _lightboxBWrap = null;

let _lightboxMediaGroup = null;

let _lightboxIsSent = false;

let _lightboxContact = null;

let _lightboxCurrentUserId = null;

function openLightbox(src, allUrls, bWrap, mediaGroup, isSent, contact, currentUserId) {
  _lightboxUrls = allUrls && allUrls.length > 1 ? allUrls : [ src ];
  _lightboxIdx = _lightboxUrls.indexOf(src);
  if (_lightboxIdx < 0) _lightboxIdx = 0;
  _lightboxBWrap = bWrap || null;
  _lightboxMediaGroup = mediaGroup || null;
  _lightboxIsSent = isSent || false;
  _lightboxContact = contact || null;
  _lightboxCurrentUserId = currentUserId || null;
  _renderLightbox();
  document.getElementById("lightbox").classList.add("show");
  document.addEventListener("keydown", _lightboxKey);
}

function _renderLightbox() {
  const img = document.getElementById("lightboxImg");
  const footer = document.getElementById("lightboxFooter");
  const strip = document.getElementById("lightboxStrip");
  const counter = document.getElementById("lightboxCounter");
  const prev = document.getElementById("lightboxPrev");
  const next = document.getElementById("lightboxNext");
  const delBtn = document.getElementById("lightboxDeleteBtn");
  img.src = _lightboxUrls[_lightboxIdx];
  if (_lightboxUrls.length > 1) {
    prev.style.display = "flex";
    next.style.display = "flex";
    prev.disabled = _lightboxIdx === 0;
    next.disabled = _lightboxIdx === _lightboxUrls.length - 1;
  } else {
    prev.style.display = "none";
    next.style.display = "none";
  }
  counter.textContent = _lightboxIdx + 1 + " of " + _lightboxUrls.length;
  footer.style.display = "flex";
  strip.innerHTML = "";
  _lightboxUrls.forEach((u, i) => {
    const t = document.createElement("img");
    t.src = u;
    t.className = "lightbox-thumb" + (i === _lightboxIdx ? " active" : "");
    t.onclick = e => {
      e.stopPropagation();
      _lightboxIdx = i;
      _renderLightbox();
    };
    strip.appendChild(t);
  });
  if (delBtn) {
    delBtn.style.display = _lightboxBWrap && _lightboxIsSent ? "flex" : "none";
  }
}

function lightboxDownloadCurrentImage() {
  const url = _lightboxUrls[_lightboxIdx];
  if (!url) return;
  const a = document.createElement("a");
  a.href = url;
  a.download = url.split("/").pop().split("?")[0] || "image";
  a.target = "_blank";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function lightboxReplyToCurrentImage() {
  const url = _lightboxUrls[_lightboxIdx];
  if (!url) return;
  const author = _lightboxIsSent ? profile.username ? profile.username.slice(1) : "me" : _lightboxContact ? _lightboxContact.username || _lightboxContact.realName || _lightboxContact.name : "User";
  const msgId = _lightboxMediaGroup ? _lightboxMediaGroup.id : _lightboxBWrap ? _lightboxBWrap.dataset.msgId : null;
  startReply("Photo", author, msgId || null, url);
  closeLightbox();
}

function lightboxStep(dir) {
  const next = _lightboxIdx + dir;
  if (next < 0 || next >= _lightboxUrls.length) return;
  _lightboxIdx = next;
  _renderLightbox();
}

function _lightboxKey(e) {
  if (e.key === "ArrowRight") lightboxStep(1); else if (e.key === "ArrowLeft") lightboxStep(-1); else if (e.key === "Escape") closeLightbox();
}

function closeLightbox() {
  document.getElementById("lightbox").classList.remove("show");
  document.removeEventListener("keydown", _lightboxKey);
  _lightboxUrls = [];
  _lightboxIdx = 0;
  _lightboxBWrap = null;
  _lightboxMediaGroup = null;
  _lightboxIsSent = false;
  _lightboxContact = null;
  _lightboxCurrentUserId = null;
}

function lightboxDeleteCurrentImage() {
  if (!_lightboxBWrap || !_lightboxMediaGroup) return;
  const urlToDelete = _lightboxUrls[_lightboxIdx];
  deleteSingleCollageImage(_lightboxBWrap, urlToDelete, _lightboxMediaGroup, _lightboxIsSent, _lightboxContact, _lightboxCurrentUserId);
}
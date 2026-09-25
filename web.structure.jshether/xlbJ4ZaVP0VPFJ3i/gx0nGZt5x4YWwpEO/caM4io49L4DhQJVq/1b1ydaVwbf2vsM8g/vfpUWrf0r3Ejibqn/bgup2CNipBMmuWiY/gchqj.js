let presenceChannel = null;

let onlineUsers = new Set;

let _presenceWatchChannels = {};

let _heartbeatInterval = null;

async function joinPresence() {
  if (!currentUser) return;
  if (presenceChannel) {
    await supabaseClient.removeChannel(presenceChannel);
    presenceChannel = null;
  }
  if (_heartbeatInterval) {
    clearInterval(_heartbeatInterval);
    _heartbeatInterval = null;
  }
  presenceChannel = supabaseClient.channel(`presence-hb:${currentUser.id}`, {
    config: {
      broadcast: {
        self: false
      }
    }
  });
  presenceChannel.subscribe(async status => {
    if (status === "SUBSCRIBED") {
      setTimeout(() => {
        if (presenceChannel?.state === "joined") {
          presenceChannel.send({
            type: "broadcast",
            event: "hb",
            payload: {}
          });
        }
      }, 50);
      _heartbeatInterval = setInterval(() => {
        if (presenceChannel?.state === "joined") {
          presenceChannel.send({
            type: "broadcast",
            event: "hb",
            payload: {}
          });
        }
      }, 5e3);
    }
  });
}

async function leavePresence() {
  if (_heartbeatInterval) {
    clearInterval(_heartbeatInterval);
    _heartbeatInterval = null;
  }
  if (presenceChannel) {
    if (presenceChannel.state === "joined") {
      presenceChannel.send({
        type: "broadcast",
        event: "offline",
        payload: {}
      });
      await new Promise(r => setTimeout(r, 80));
    }
    await supabaseClient.removeChannel(presenceChannel);
    presenceChannel = null;
  }
  onlineUsers.clear();
  updatePresenceDots();
}

function watchUserPresence(userId) {
  if (!userId || _presenceWatchChannels[userId]) return;
  const ch = supabaseClient.channel(`presence-hb:${userId}`, {
    config: {
      broadcast: {
        self: false
      }
    }
  });
  let offlineTimer = null;
  function markOffline() {
    onlineUsers.delete(userId);
    updatePresenceDots();
    if (userId === activeFluxId) hideRemoteTyping();
    offlineTimer = null;
  }
  function resetTimer() {
    if (offlineTimer) clearTimeout(offlineTimer);
    offlineTimer = setTimeout(markOffline, 1e4);
  }
  ch.on("broadcast", {
    event: "hb"
  }, () => {
    const wasOffline = !onlineUsers.has(userId);
    onlineUsers.add(userId);
    if (wasOffline) updatePresenceDots();
    resetTimer();
  }).on("broadcast", {
    event: "offline"
  }, () => {
    if (offlineTimer) {
      clearTimeout(offlineTimer);
      offlineTimer = null;
    }
    onlineUsers.delete(userId);
    updatePresenceDots();
    if (userId === activeFluxId) hideRemoteTyping();
  }).subscribe();
  _presenceWatchChannels[userId] = {
    channel: ch,
    timer: null,
    clearTimer: () => {
      if (offlineTimer) {
        clearTimeout(offlineTimer);
        offlineTimer = null;
      }
    }
  };
}

function unwatchUserPresence(userId) {
  const entry = _presenceWatchChannels[userId];
  if (!entry) return;
  entry.clearTimer();
  supabaseClient.removeChannel(entry.channel);
  delete _presenceWatchChannels[userId];
  onlineUsers.delete(userId);
}

function unwatchAllPresence() {
  Object.keys(_presenceWatchChannels).forEach(unwatchUserPresence);
  onlineUsers.clear();
  updatePresenceDots();
}

function updatePresenceDots() {
  if (activeFluxId) {
    const isOnline = onlineUsers.has(activeFluxId);
    const dot = document.getElementById("fluxPresenceDot");
    if (dot) {
      dot.classList.toggle("online", isOnline);
      dot.classList.toggle("offline", !isOnline);
    }
    const fsDot = document.getElementById("fluxFsPresenceDot");
    if (fsDot) {
      fsDot.classList.toggle("online", isOnline);
      fsDot.classList.toggle("offline", !isOnline);
    }
  }
  document.querySelectorAll(".flux-conv-presence-dot[data-presence-user]").forEach(dot => {
    const userId = dot.dataset.presenceUser;
    dot.classList.toggle("online", onlineUsers.has(userId));
  });
}

function resetPresenceDots() {
  [ "fluxPresenceDot", "fluxFsPresenceDot" ].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.classList.remove("online");
      el.classList.add("offline");
    }
  });
}

let typingChannel = null;

let isCurrentlyTyping = false;

let remoteTypingTimer = null;

let typingHeartbeatInterval = null;

async function setupTypingChannel(myUserId, otherUserId) {
  if (typingHeartbeatInterval) {
    clearInterval(typingHeartbeatInterval);
    typingHeartbeatInterval = null;
  }
  if (typingChannel) {
    await supabaseClient.removeChannel(typingChannel);
    typingChannel = null;
  }
  const channelName = [ myUserId, otherUserId ].sort().join(":");
  typingChannel = supabaseClient.channel(`typing:${channelName}`, {
    config: {
      broadcast: {
        self: false
      }
    }
  });
  typingChannel.on("broadcast", {
    event: "typing"
  }, ({payload: payload}) => {
    if (payload.userId === myUserId) return;
    if (payload.isTyping) {
      showRemoteTyping(otherUserId);
    } else {
      hideRemoteTyping();
    }
  }).on("broadcast", {
    event: "theme_change"
  }, ({payload: payload}) => {
    if (payload.senderId === myUserId) return;
    applyRelayTheme(payload.theme);
    if (_themePickerOpen) renderThemePicker();
  }).on("broadcast", {
    event: "msg_edit"
  }, ({payload: payload}) => {
    if (payload.senderId === myUserId) return;
    [ "fluxRelayMessages", "fluxFsMessages" ].forEach(cId => {
      const container = document.getElementById(cId);
      if (!container) return;
      const bWrap = container.querySelector(`.flux-bubble-wrap[data-msg-id="${payload.msgId}"]`);
      if (bWrap) applyEditToBubble(bWrap, payload.content, false);
    });
  }).subscribe(status => {
    if (status === "SUBSCRIBED" && typingChannel._pendingTyping) {
      typingChannel.send({
        type: "broadcast",
        event: "typing",
        payload: {
          userId: myUserId,
          isTyping: true
        }
      });
      delete typingChannel._pendingTyping;
    }
  });
}

function pinTypingIndicator(container) {
  if (!container) return;
  const el = container.querySelector(".flux-typing-indicator");
  if (!el) return;
  if (container.lastElementChild !== el) {
    container.appendChild(el);
  }
}

function showRemoteTyping(userId) {
  if (remoteTypingTimer) clearTimeout(remoteTypingTimer);
  remoteTypingTimer = setTimeout(() => {
    hideRemoteTyping();
    remoteTypingTimer = null;
  }, 4e3);
  const _typingContact = fluxContacts.find(c => c.id === userId);
  let _avatarHtml;
  if (_typingContact && _typingContact.avatarUrl) {
    _avatarHtml = `<div class="flux-typing-avatar"><img src="${_typingContact.avatarUrl}" alt=""></div>`;
  } else {
    _avatarHtml = `<div class="flux-typing-avatar default-avatar"><svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="18" cy="13" r="6" fill="currentColor" opacity="0.55"/><path d="M6 30c0-6.627 5.373-12 12-12s12 5.373 12 12" fill="currentColor" opacity="0.38"/></svg></div>`;
  }
  const indicatorHtml = _avatarHtml + `<div class="flux-typing-bubble-wrap"><div class="flux-typing-bubble"><span></span><span></span><span></span></div></div>`;
  [ "fluxRelayMessages", "fluxFsMessages" ].forEach(msgsId => {
    const msgs = document.getElementById(msgsId);
    if (!msgs) return;
    if (msgs.querySelector(".flux-typing-indicator")) return;
    const el = document.createElement("div");
    el.className = "flux-typing-indicator";
    el.id = msgsId === "fluxRelayMessages" ? "fluxTypingSlot" : "fluxFsTypingSlot";
    el.innerHTML = indicatorHtml;
    const wasAtBottom = msgs.scrollHeight - msgs.scrollTop - msgs.clientHeight < 60;
    msgs.appendChild(el);
    if (wasAtBottom) setTimeout(() => {
      msgs.scrollTop = msgs.scrollHeight;
    }, 0);
  });
  [ "fluxConvList", "fluxFsConvList" ].forEach(listId => {
    const list = document.getElementById(listId);
    if (!list) return;
    const item = list.querySelector(`.flux-conv-item[data-id="${userId}"]`);
    if (!item) return;
    const preview = item.querySelector(".flux-conv-preview");
    if (preview && !preview.classList.contains("typing")) {
      preview.dataset.prevText = preview.textContent;
      preview.dataset.prevClass = preview.className;
      preview.className = "flux-conv-preview typing";
      preview.textContent = "Typing…";
    }
  });
}

function hideRemoteTyping() {
  if (remoteTypingTimer) {
    clearTimeout(remoteTypingTimer);
    remoteTypingTimer = null;
  }
  [ "fluxRelayMessages", "fluxFsMessages" ].forEach(msgsId => {
    const msgs = document.getElementById(msgsId);
    if (!msgs) return;
    const el = msgs.querySelector(".flux-typing-indicator");
    if (el) el.remove();
  });
  [ "fluxTypingDots", "fluxFsTypingDots" ].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.remove();
  });
  [ "fluxConvList", "fluxFsConvList" ].forEach(listId => {
    const list = document.getElementById(listId);
    if (!list) return;
    list.querySelectorAll(".flux-conv-preview.typing").forEach(preview => {
      preview.className = preview.dataset.prevClass || "flux-conv-preview";
      preview.textContent = preview.dataset.prevText || "";
      delete preview.dataset.prevText;
      delete preview.dataset.prevClass;
    });
  });
}

function broadcastTyping(isTyping) {
  if (!typingChannel || !activeFluxId || !currentUser) return;
  if (typingChannel.state !== "joined") {
    if (isTyping) typingChannel._pendingTyping = true;
    return;
  }
  const payload = {
    userId: currentUser.id,
    isTyping: isTyping
  };
  typingChannel.send({
    type: "broadcast",
    event: "typing",
    payload: payload
  });
  const recipientChannel = supabaseClient.channel(`typing-notify:${activeFluxId}`);
  recipientChannel.send({
    type: "broadcast",
    event: "typing",
    payload: payload
  });
  if (isTyping) {
    if (!typingHeartbeatInterval) {
      typingHeartbeatInterval = setInterval(() => {
        if (!isCurrentlyTyping) {
          clearInterval(typingHeartbeatInterval);
          typingHeartbeatInterval = null;
          return;
        }
        const p = {
          userId: currentUser.id,
          isTyping: true
        };
        if (typingChannel?.state === "joined") typingChannel.send({
          type: "broadcast",
          event: "typing",
          payload: p
        });
      }, 3e3);
    }
  } else {
    if (typingHeartbeatInterval) {
      clearInterval(typingHeartbeatInterval);
      typingHeartbeatInterval = null;
    }
  }
}

function onFluxInputChange(mode) {
  toggleFluxSendBtn();
  const expectedInputId = mode === "mobile" ? "fluxFsInput" : "fluxInput";
  const inputEl = document.getElementById(expectedInputId);
  if (!inputEl || document.activeElement !== inputEl) return;
  const val = inputEl.value;
  if (val.trim() === "") {
    if (isCurrentlyTyping) {
      isCurrentlyTyping = false;
      broadcastTyping(false);
    }
  } else {
    if (!isCurrentlyTyping) {
      isCurrentlyTyping = true;
      broadcastTyping(true);
    }
  }
}

function onFluxInputFocus(mode) {}

function onFluxInputBlur(mode) {
  if (isCurrentlyTyping) {
    isCurrentlyTyping = false;
    broadcastTyping(false);
  }
}

function onFluxKeypress(e, mode) {}

function stopTypingBroadcast() {
  if (typingHeartbeatInterval) {
    clearInterval(typingHeartbeatInterval);
    typingHeartbeatInterval = null;
  }
  isCurrentlyTyping = false;
  broadcastTyping(false);
}

function clearRelayUI() {
  const clearedConvId = activeFluxId;
  if (clearedConvId) _fluxRealtimeClearedConversations.add(clearedConvId);
  const isGroup = _fluxConvIsGroup(clearedConvId);
  const msgsEl = document.getElementById("fluxRelayMessages");
  if (msgsEl) msgsEl.innerHTML = "";
  const fsMsgsEl = document.getElementById("fluxFsMessages");
  if (fsMsgsEl) fsMsgsEl.innerHTML = "";
  renderedMsgIds.clear();
  const contact = fluxContacts.find(c => c.id === clearedConvId);
  if (contact) {
    contact.lastMessage = null;
    contact.lastMessageTs = 0;
    contact.unread = false;
    contact.unreadCount = 0;
  }
  if (isMobile()) {
    const fluxFsRelayView = document.getElementById("fluxFsRelayView");
    const fluxFsConvView = document.getElementById("fluxFsConvView");
    if (fluxFsRelayView) fluxFsRelayView.classList.add("show");
    if (fluxFsConvView) fluxFsConvView.classList.add("hide");
  }
  buildFLUXConvList();
}

function _handleRemoteRelayCleared(conversationId) {
  if (!fluxOpen || !conversationId) return;
  _fluxRealtimeClearedConversations.add(conversationId);
  const contact = fluxContacts.find(c => c.id === conversationId);
  if (!contact) return;
  const isGroup = _fluxConvIsGroup(conversationId);
  contact.lastMessage = null;
  contact.lastMessageTs = 0;
  contact.unread = false;
  contact.unreadCount = 0;
  if (activeFluxId === conversationId) {
    _fluxClearPinnedFrontend?.();
    const msgsEl = document.getElementById("fluxRelayMessages");
    if (msgsEl) msgsEl.innerHTML = "";
    const fsMsgsEl = document.getElementById("fluxFsMessages");
    if (fsMsgsEl) fsMsgsEl.innerHTML = "";
    renderedMsgIds.clear();
    if (isMobile()) {
      const fluxFsRelayView = document.getElementById("fluxFsRelayView");
      const fluxFsConvView = document.getElementById("fluxFsConvView");
      if (fluxFsRelayView) fluxFsRelayView.classList.add("show");
      if (fluxFsConvView) fluxFsConvView.classList.add("hide");
    }
  }
  buildFLUXConvList();
}

let _pendingClearTargetId = null;

function openClearRelayConfirm(targetId) {
  const id = targetId || activeFluxId;
  if (!id) return;
  _pendingClearTargetId = id;
  document.getElementById("clearRelayOverlay").classList.add("show");
  setTimeout(() => document.getElementById("clearRelayConfirmBtn").focus(), 50);
}

function closeClearRelayConfirm() {
  document.getElementById("clearRelayOverlay").classList.remove("show");
}

async function confirmClearRelay() {
  closeClearRelayConfirm();
  const targetId = _pendingClearTargetId || activeFluxId;
  _pendingClearTargetId = null;
  if (!targetId) return;
  const {data: {user: user}} = await supabaseClient.auth.getUser();
  if (!user) return;
  const clearingActiveRelay = targetId === activeFluxId;
  if (clearingActiveRelay) {
    _clearingRelayForUserId = targetId;
    _showClearingOverlay();
  }
  const targetIsGroup = _fluxConvIsGroup(targetId);
  if (clearingActiveRelay) _fluxClearPinnedFrontend?.();
  try {
    const pinsToClear = await _fluxGetPinnedMessages(targetId);
    const pinMessageIds = pinsToClear.map(m => m.id).filter(Boolean);
    if (pinMessageIds.length) {
      const {error: pinDeleteError} = await supabaseClient.from("pinned_messages").delete().in("message_id", pinMessageIds);
      if (pinDeleteError) throw pinDeleteError;
    }
  } catch (pinErr) {
    if (clearingActiveRelay) {
      _clearingRelayForUserId = null;
      _hideClearingOverlay();
    }
    showFluxErrorToast?.("Failed to clear pinned messages: " + (pinErr.message || pinErr));
    return;
  }
  const DELETE_BATCH_SIZE = 200;
  const MAX_BATCHES = 500;
  let deleteError = null;
  for (let batch = 0; batch < MAX_BATCHES; batch++) {
    const {data: idRows, error: selectError} = await _fluxApplyConvFilter(supabaseClient.from("messages").select("id"), targetId, user.id, targetIsGroup).limit(DELETE_BATCH_SIZE);
    if (selectError) {
      deleteError = selectError;
      break;
    }
    if (!idRows || idRows.length === 0) break;
    const ids = idRows.map(r => r.id);
    const {error: batchDeleteError} = await supabaseClient.from("messages").delete().in("id", ids);
    if (batchDeleteError) {
      deleteError = batchDeleteError;
      break;
    }
    if (idRows.length < DELETE_BATCH_SIZE) break;
  }
  if (deleteError) {
    if (clearingActiveRelay) {
      _clearingRelayForUserId = null;
      _hideClearingOverlay();
    }
    alert("Failed to clear relay: " + deleteError.message);
    return;
  }
  const MAX_POLLS = 12;
  const POLL_MS = 300;
  for (let i = 0; i < MAX_POLLS; i++) {
    await new Promise(r => setTimeout(r, POLL_MS));
    const {count: count} = await _fluxApplyConvFilter(supabaseClient.from("messages").select("*", {
      count: "exact",
      head: true
    }), targetId, user.id, targetIsGroup);
    if (count === 0) break;
  }
  _fluxRealtimeClearedConversations.add(targetId);
  if (clearingActiveRelay) {
    clearRelayUI();
    _clearingRelayForUserId = null;
    _hideClearingOverlay();
  } else {
    const contact = fluxContacts.find(c => c.id === targetId);
    if (contact) {
      contact.lastMessage = null;
      contact.lastMessageTs = 0;
      contact.unread = false;
      contact.unreadCount = 0;
    }
    buildFLUXConvList();
  }
  try {
    const notifyChannel = supabaseClient.channel("relay-cleared:global", {
      config: {
        broadcast: {
          self: false
        }
      }
    });
    await new Promise(r => setTimeout(r, 80));
    notifyChannel.subscribe(async status => {
      if (status === "SUBSCRIBED") {
        await notifyChannel.send({
          type: "broadcast",
          event: "relay-cleared",
          payload: {
            conversationId: targetId,
            clearerId: user.id
          }
        });
        setTimeout(() => supabaseClient.removeChannel(notifyChannel), 2e3);
      }
    });
  } catch (e) {}
}

function handleFluxHeaderClear() {
  const id = activeFluxId;
  if (!id) return;
  openClearRelayConfirm(id);
}

function _fluxRemoveGroupLocally(groupId) {
  const idx = fluxContacts.findIndex(c => c.id === groupId);
  if (idx >= 0) fluxContacts.splice(idx, 1);
  _fluxMyGroupIds.delete(groupId);
  if (activeFluxId === groupId) {
    const msgsEl = document.getElementById("fluxRelayMessages");
    if (msgsEl) msgsEl.innerHTML = "";
    const fsMsgsEl = document.getElementById("fluxFsMessages");
    if (fsMsgsEl) fsMsgsEl.innerHTML = "";
    renderedMsgIds.clear();
    if (isMobile()) {
      const fluxFsRelayView = document.getElementById("fluxFsRelayView");
      const fluxFsConvView = document.getElementById("fluxFsConvView");
      if (fluxFsRelayView) fluxFsRelayView.classList.remove("show");
      if (fluxFsConvView) fluxFsConvView.classList.remove("hide");
    } else {
      showFluxEmptyState();
    }
    activeFluxId = null;
    _fluxActiveConvBgUnread = false;
    document.querySelectorAll("#fluxConvList .flux-conv-item, #fluxFsConvList .flux-conv-item").forEach(el => el.classList.remove("active"));
    _updateGroupMenuBtnVisibility(null);
  }
  buildFLUXConvList();
}

function openDeleteGroupConfirm(groupId) {
  const id = groupId || activeFluxId;
  if (!id) return;
  showConfirm("Exit group?", "You’ll be removed from this group. It stays intact for everyone else, and you can be added back anytime.", "Exit group", () => exitFluxGroup(id));
}

async function exitFluxGroup(groupId) {
  const {data: {user: user}} = await supabaseClient.auth.getUser();
  if (!user) return;
  try {
    const myName = (await supabaseClient.from("profiles").select("username").eq("id", user.id).single()).data?.username || "Someone";
    await _fluxPostSystemMessage(groupId, `${myName} left the group.`);
  } catch (e) {
    console.warn("[FLUX] left-group system message failed:", e.message || e);
  }
  const {error: error} = await supabaseClient.from("flux_group_members").delete().eq("group_id", groupId).eq("user_id", user.id);
  if (error) {
    alert("Failed to exit group: " + error.message);
    return;
  }
  _fluxRemoveGroupLocally(groupId);
}

function _showClearingOverlay() {
  const ov = document.getElementById("fluxClearingOverlay");
  const fill = document.getElementById("fluxClearingBarFill");
  const ovFs = document.getElementById("fluxFsClearingOverlay");
  const fillFs = document.getElementById("fluxFsClearingBarFill");
  [ fill, fillFs ].forEach(f => {
    if (!f) return;
    f.style.transition = "none";
    f.style.width = "0%";
  });
  [ ov, ovFs ].forEach(o => {
    if (o) o.classList.add("show");
  });
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      [ fill, fillFs ].forEach(f => {
        if (!f) return;
        f.style.transition = "width 0.6s cubic-bezier(0.25, 1, 0.5, 1)";
        f.style.width = "70%";
        setTimeout(() => {
          f.style.transition = "width 3s cubic-bezier(0.1, 0.9, 0.3, 1)";
          f.style.width = "88%";
        }, 640);
      });
    });
  });
}

function _hideClearingOverlay() {
  const ov = document.getElementById("fluxClearingOverlay");
  const fill = document.getElementById("fluxClearingBarFill");
  const ovFs = document.getElementById("fluxFsClearingOverlay");
  const fillFs = document.getElementById("fluxFsClearingBarFill");
  [ fill, fillFs ].forEach(f => {
    if (!f) return;
    f.style.transition = "width 0.2s ease";
    f.style.width = "100%";
  });
  setTimeout(() => {
    [ ov, ovFs ].forEach(o => {
      if (o) o.classList.remove("show");
    });
    setTimeout(() => {
      [ fill, fillFs ].forEach(f => {
        if (!f) return;
        f.style.transition = "none";
        f.style.width = "0%";
      });
    }, 200);
  }, 220);
}

document.getElementById("clearRelayOverlay").addEventListener("keydown", function(e) {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    confirmClearRelay();
  }
  if (e.key === "Escape") closeClearRelayConfirm();
});

function toggleFluxDmMenu(e) {
  if (e) e.stopPropagation();
  openFluxCreateGroup();
}

function closeFluxDmMenu() {}

function openFluxCreateGroup(contactId) {
  _fluxGroupAddMode = "create";
  _fluxAddMembersGroupId = null;
  _fluxAddMembersExistingIds = new Set;
  _fluxGroupDraft = [];
  _fluxGroupArchivedPickerUnlocked = false;
  _fluxGroupArchivedPickerOpen = false;
  if (contactId) {
    const contact = fluxContacts.find(c => c.id === contactId);
    if (contact && !_fluxArchivedOf(contactId)) _fluxGroupDraft.push(contact);
  }
  _openFluxGroupAddViewShared("Add group", "Create group");
}

async function openAddMembersToGroup(groupId) {
  const id = groupId || activeFluxId;
  if (!id) return;
  _fluxGroupAddMode = "add";
  _fluxAddMembersGroupId = id;
  _fluxGroupDraft = [];
  _fluxGroupArchivedPickerUnlocked = false;
  _fluxGroupArchivedPickerOpen = false;
  const members = await _fluxFetchGroupMembers(id);
  _fluxAddMembersExistingIds = new Set(members.map(m => m.id));
  _openFluxGroupAddViewShared("Add members", "Add members");
}

function _openFluxGroupAddViewShared(title, submitLabel) {
  const view = document.getElementById("fluxGroupAddView");
  const header = document.getElementById("fluxSidebarHeader");
  const search = document.querySelector(".flux-search-wrap");
  const tabs = document.getElementById("fluxTabBar");
  const list = document.getElementById("fluxConvList");
  const bar = document.getElementById("fluxSidebarLoadBar");
  [ header, search, tabs, list, bar ].forEach(el => {
    if (el) el.style.display = "none";
  });
  if (view) view.style.display = "flex";
  const titleEl = document.getElementById("fluxGroupAddTitle");
  if (titleEl) titleEl.textContent = title;
  const createBtn = document.getElementById("fluxGroupCreateBtn");
  if (createBtn) createBtn.textContent = submitLabel;
  const input = document.getElementById("fluxGroupMemberSearch");
  if (input) {
    input.value = "";
    input.focus();
  }
  renderFluxGroupMemberResults("");
  renderFluxGroupDraft();
}

function handleFluxGroupAddBack() {
  if (_fluxGroupArchivedPickerOpen) {
    _fluxGroupArchivedPickerOpen = false;
    _fluxGroupArchivedPickerUnlocked = false;
    const input = document.getElementById("fluxGroupMemberSearch");
    if (input) {
      input.value = "";
      input.focus();
    }
    renderFluxGroupMemberResults("");
    return;
  }
  closeFluxCreateGroup();
}

function closeFluxCreateGroup() {
  const view = document.getElementById("fluxGroupAddView");
  const header = document.getElementById("fluxSidebarHeader");
  const search = document.querySelector(".flux-search-wrap");
  const tabs = document.getElementById("fluxTabBar");
  const list = document.getElementById("fluxConvList");
  const bar = document.getElementById("fluxSidebarLoadBar");
  if (view) view.style.display = "none";
  [ header, search, tabs, list, bar ].forEach(el => {
    if (el) el.style.display = "";
  });
  _fluxGroupDraft = [];
  _fluxGroupAddMode = "create";
  _fluxAddMembersGroupId = null;
  _fluxAddMembersExistingIds = new Set;
}

let _fluxGroupDraft = [];

let _fluxGroupAddMode = "create";

let _fluxAddMembersGroupId = null;

let _fluxAddMembersExistingIds = new Set;

async function handleFluxGroupAddSubmit() {
  if (_fluxGroupAddMode === "add") {
    await submitAddMembersToGroup();
  } else {
    await createFluxGroup();
  }
}

async function submitAddMembersToGroup() {
  const groupId = _fluxAddMembersGroupId;
  const newMembers = _fluxGroupDraft.filter(c => c.id && !_fluxAddMembersExistingIds.has(c.id));
  if (!groupId || !newMembers.length) {
    closeFluxCreateGroup();
    return;
  }
  const {data: groupBefore, error: groupBeforeError} = await supabaseClient.from("flux_groups").select("name, name_is_custom").eq("id", groupId).single();
  if (groupBeforeError) {
    alert("Failed to load group settings: " + groupBeforeError.message);
    return;
  }
  const rows = newMembers.map(c => ({
    group_id: groupId,
    user_id: c.id,
    role: "member"
  }));
  const {error: error} = await supabaseClient.from("flux_group_members").upsert(rows, {
    onConflict: "group_id,user_id",
    ignoreDuplicates: true
  });
  if (error) {
    alert("Failed to add members: " + error.message);
    return;
  }
  try {
    const {data: {user: user}} = await supabaseClient.auth.getUser();
    const myName = user ? (await supabaseClient.from("profiles").select("username").eq("id", user.id).single()).data?.username || "Someone" : "Someone";
    const addedNames = newMembers.map(c => c.realName || c.name || c.username).filter(Boolean);
    if (addedNames.length) {
      await _fluxPostSystemMessage(groupId, `${myName} added ${_fluxJoinNames(addedNames)}.`);
    }
  } catch (e) {
    console.warn("[FLUX] member-added system message failed:", e.message || e);
  }
  if (!groupBefore.name_is_custom) {
    try {
      const defaultName = await _fluxBuildDefaultGroupName(groupId);
      await supabaseClient.rpc("set_flux_group_name", {
        p_group_id: groupId,
        p_name: defaultName,
        p_is_custom: false
      });
      _fluxApplyGroupNameLocally(groupId, defaultName);
    } catch (e) {
      console.warn("[FLUX] default group name update after member add failed:", e.message || e);
    }
  }
  if (activeFluxId === groupId) _fluxUpdateGroupHeaderMembers(groupId);
  closeFluxCreateGroup();
  const profileTab = document.getElementById("fluxProfileTab");
  if (profileTab && profileTab.classList.contains("show") && activeFluxProfileTarget === groupId) {
    loadNicknameSideTab(groupId);
  }
}

let _fluxGroupArchivedPickerUnlocked = false;

let _fluxGroupArchivedPickerOpen = false;

async function handleFluxGroupMemberSearchKeydown(e) {
  if (e.key !== "Enter") return;
  e.preventDefault();
  const input = e.currentTarget;
  const value = (input?.value || "").trim();
  if (!value) return;
  if (await _fluxVerifyArchiveSecret(value)) {
    _fluxGroupArchivedPickerUnlocked = true;
    _fluxGroupArchivedPickerOpen = false;
    input.value = "";
    renderFluxGroupMemberResults("");
    return;
  }
}

function searchFluxGroupMembers(value) {
  const q = (value || "").trim();
  if (q) _fluxGroupArchivedPickerOpen = false;
  renderFluxGroupMemberResults(q);
}

function _buildFluxGroupArchivedFolderResult() {
  const row = document.createElement("div");
  row.className = "flux-group-result flux-group-archived-folder-result";
  row.setAttribute("role", "button");
  row.setAttribute("tabindex", "0");
  row.innerHTML = `\n    <div class="flux-group-result-avatar flux-archived-sidebar-icon" style="display:flex;align-items:center;justify-content:center;">\n      <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="8" height="5" x="14" y="17" rx="1"/><path d="M10 20H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v2.5"/><path d="M20 17v-2a2 2 0 1 0-4 0v2"/></svg>\n    </div>\n    <div class="flux-group-result-info">\n      <div class="flux-group-result-name">Archived</div>\n      <div class="flux-group-result-username">Hidden users</div>\n    </div>`;
  const open = e => {
    if (e) e.stopPropagation();
    _fluxGroupArchivedPickerOpen = true;
    const input = document.getElementById("fluxGroupMemberSearch");
    if (input) input.value = "";
    renderFluxGroupMemberResults("");
  };
  row.onclick = open;
  row.onkeydown = e => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      open(e);
    }
  };
  return row;
}

function _buildFluxGroupArchivedBackResult() {
  const row = document.createElement("div");
  row.className = "flux-group-result flux-group-archived-back-result";
  row.setAttribute("role", "button");
  row.setAttribute("tabindex", "0");
  row.innerHTML = `\n    <div class="flux-group-result-avatar" style="display:flex;align-items:center;justify-content:center;">\n      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="18" height="18"><path d="m15 18-6-6 6-6"/></svg>\n    </div>\n    <div class="flux-group-result-info">\n      <div class="flux-group-result-name">Back</div>\n      <div class="flux-group-result-username">Search regular users</div>\n    </div>`;
  const back = e => {
    if (e) e.stopPropagation();
    _fluxGroupArchivedPickerOpen = false;
    renderFluxGroupMemberResults("");
  };
  row.onclick = back;
  row.onkeydown = e => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      back(e);
    }
  };
  return row;
}

function renderFluxGroupMemberResults(value) {
  const box = document.getElementById("fluxGroupMemberResults");
  if (!box) return;
  const q = (value || "").trim().toLowerCase();
  const selected = new Set(_fluxGroupDraft.map(x => x.id));
  box.innerHTML = "";
  if (_fluxGroupArchivedPickerUnlocked && !_fluxGroupArchivedPickerOpen && !q) {
    box.appendChild(_buildFluxGroupArchivedFolderResult());
  }
  if (_fluxGroupArchivedPickerOpen) {
    const archivedMatches = fluxContacts.filter(c => c.id !== _fluxMyUserId).filter(c => !c.isGroup).filter(c => _fluxArchivedOf(c.id)).filter(c => _fluxGroupAddMode !== "add" || !_fluxAddMembersExistingIds.has(c.id)).filter(c => !q || (c.username || "").toLowerCase().includes(q) || (c.realName || c.name || "").toLowerCase().includes(q)).slice(0, 100);
    if (!archivedMatches.length) {
      box.insertAdjacentHTML("beforeend", `<div class="flux-sidebar-no-user"><div>${q ? "No archived users found" : "No archived users found"}</div></div>`);
      return;
    }
    archivedMatches.forEach(c => {
      const selectedAlready = selected.has(c.id);
      const row = document.createElement("div");
      row.className = "flux-group-result" + (selectedAlready ? " disabled" : "");
      const avatar = c.avatarUrl ? `<img src="${c.avatarUrl}" alt="">` : DEFAULT_AVATAR_SVG;
      row.innerHTML = `<div class="flux-group-result-avatar">${avatar}</div><div class="flux-group-result-info"><div class="flux-group-result-name">${escHtml(c.realName || c.name || c.username || "User")}</div><div class="flux-group-result-username">@${escHtml((c.username || "").replace(/^@/, ""))}</div></div>`;
      if (!selectedAlready) row.onclick = () => {
        _fluxGroupDraft.push(c);
        renderFluxGroupDraft();
        renderFluxGroupMemberResults(document.getElementById("fluxGroupMemberSearch")?.value || "");
      };
      box.appendChild(row);
    });
    return;
  }
  const matches = fluxContacts.filter(c => c.id !== _fluxMyUserId).filter(c => !c.isGroup).filter(c => !_fluxArchivedOf(c.id)).filter(c => _fluxGroupAddMode !== "add" || !_fluxAddMembersExistingIds.has(c.id)).filter(c => q || c.sentByMe === true).filter(c => !q || (c.username || "").toLowerCase().includes(q) || (c.realName || c.name || "").toLowerCase().includes(q)).slice(0, 30);
  if (!matches.length) {
    if (_fluxGroupArchivedPickerUnlocked && !q) return;
    box.innerHTML = `<div class="flux-sidebar-no-user"><div>${q ? "No users found" : "No previous conversations found"}</div></div>`;
    return;
  }
  matches.forEach(c => {
    const selectedAlready = selected.has(c.id);
    const row = document.createElement("div");
    row.className = "flux-group-result" + (selectedAlready ? " disabled" : "");
    const avatar = c.avatarUrl ? `<img src="${c.avatarUrl}" alt="">` : DEFAULT_AVATAR_SVG;
    row.innerHTML = `<div class="flux-group-result-avatar">${avatar}</div><div class="flux-group-result-info"><div class="flux-group-result-name">${escHtml(c.realName || c.name || c.username || "User")}</div><div class="flux-group-result-username">@${escHtml((c.username || "").replace(/^@/, ""))}</div></div>`;
    if (!selectedAlready) row.onclick = () => {
      _fluxGroupDraft.push(c);
      renderFluxGroupDraft();
      renderFluxGroupMemberResults(document.getElementById("fluxGroupMemberSearch")?.value || "");
    };
    box.appendChild(row);
  });
}

function renderFluxGroupDraft() {
  const box = document.getElementById("fluxGroupDraftMembers");
  const btn = document.getElementById("fluxGroupCreateBtn");
  if (!box) return;
  box.innerHTML = _fluxGroupDraft.map(c => `<span class="flux-group-member-chip">${escHtml(c.realName || c.name || c.username)}<button type="button" aria-label="Remove" onclick="removeFluxGroupDraftMember('${c.id}')">×</button></span>`).join("");
  if (btn) btn.classList.toggle("show", _fluxGroupDraft.length > 0);
}

function removeFluxGroupDraftMember(id) {
  _fluxGroupDraft = _fluxGroupDraft.filter(c => c.id !== id);
  renderFluxGroupDraft();
  renderFluxGroupMemberResults(document.getElementById("fluxGroupMemberSearch")?.value || "");
}

async function createFluxGroup() {
  const members = _fluxGroupDraft.filter(c => c.id !== _fluxMyUserId);
  if (!members.length || !_fluxMyUserId) return;
  let groupName = members.map(c => String(c.username || c.realName || c.name || "User").replace(/^@/, "").trim()).filter(Boolean).join(", ").slice(0, 80) || "Group";
  const groupId = window.crypto && crypto.randomUUID ? crypto.randomUUID() : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    const v = c === "x" ? r : r & 3 | 8;
    return v.toString(16);
  });
  const {error: groupError} = await supabaseClient.from("flux_groups").insert({
    id: groupId,
    owner_id: _fluxMyUserId,
    name: groupName,
    name_is_custom: false,
    avatar_url: null
  });
  if (groupError) {
    console.error("[FLUX] group create failed:", {
      message: groupError.message,
      details: groupError.details,
      hint: groupError.hint,
      code: groupError.code
    });
    return;
  }
  const uniqueMemberIds = [ ...new Set([ _fluxMyUserId, ...members.map(c => c.id).filter(Boolean) ]) ];
  const rows = uniqueMemberIds.map(userId => ({
    group_id: groupId,
    user_id: userId,
    role: userId === _fluxMyUserId ? "admin" : "member"
  }));
  const {error: memberError} = await supabaseClient.from("flux_group_members").upsert(rows, {
    onConflict: "group_id,user_id",
    ignoreDuplicates: true
  });
  if (memberError) {
    console.error("[FLUX] group members failed:", {
      message: memberError.message,
      details: memberError.details,
      hint: memberError.hint,
      code: memberError.code
    });
    await supabaseClient.from("flux_groups").delete().eq("id", groupId);
    return;
  }
  try {
    const defaultName = await _fluxBuildDefaultGroupName(groupId);
    groupName = defaultName;
    await supabaseClient.rpc("set_flux_group_name", {
      p_group_id: groupId,
      p_name: defaultName,
      p_is_custom: false
    });
  } catch (e) {
    console.warn("[FLUX] default group name generation failed:", e.message || e);
  }
  const groupMemberIds = [ ...new Set([ _fluxMyUserId, ...members.map(c => c.id).filter(Boolean) ]) ];
  let creatorAvatarUrl = null;
  try {
    const {data: creatorProfile} = await supabaseClient.from("profiles").select("avatar_url").eq("id", _fluxMyUserId).single();
    creatorAvatarUrl = creatorProfile?.avatar_url || null;
  } catch (e) {
    console.warn("[FLUX] creator avatar lookup during group creation failed:", e.message || e);
  }
  const getCreatedGroupMemberAvatar = memberId => {
    if (memberId === _fluxMyUserId) return creatorAvatarUrl;
    return members.find(c => c.id === memberId)?.avatarUrl || null;
  };
  const pickedCreatedMemberIds = _fluxPickTwoGroupMembers(groupId, groupMemberIds);
  const createdMemberAvatars = pickedCreatedMemberIds.map(getCreatedGroupMemberAvatar);
  const groupContact = {
    id: groupId,
    groupId: groupId,
    isGroup: true,
    username: groupName,
    realName: groupName,
    name: groupName,
    avatarUrl: null,
    memberAvatars: createdMemberAvatars,
    memberAvatarMap: Object.fromEntries(groupMemberIds.map(memberId => [ memberId, getCreatedGroupMemberAvatar(memberId) ])),
    ownerId: _fluxMyUserId,
    nameIsCustom: false,
    groupMembers: groupMemberIds,
    lastMessage: null,
    lastMessageTs: Date.now(),
    sentByMe: true,
    category: "primary"
  };
  const existing = fluxContacts.findIndex(c => c.groupId === groupId || c.isGroup && c.id === groupId);
  if (existing >= 0) fluxContacts[existing] = groupContact; else fluxContacts.unshift(groupContact);
  try {
    buildFLUXConvList();
  } catch (e) {
    console.warn("[FLUX] sidebar rebuild after group creation failed:", e);
  }
  try {
    const myName = (await supabaseClient.from("profiles").select("username").eq("id", _fluxMyUserId).single()).data?.username || "Someone";
    const addedNames = members.map(c => c.realName || c.name || c.username).filter(Boolean);
    if (addedNames.length) {
      await _fluxPostSystemMessage(groupId, `${myName} added ${_fluxJoinNames(addedNames)}.`);
    }
  } catch (e) {
    console.warn("[FLUX] group-created system message failed:", e.message || e);
  }
  closeFluxCreateGroup();
}

document.addEventListener("click", function(e) {
  const wrap = document.querySelector(".flux-sidebar-menu-wrap");
  if (wrap && !wrap.contains(e.target)) closeFluxDmMenu();
});
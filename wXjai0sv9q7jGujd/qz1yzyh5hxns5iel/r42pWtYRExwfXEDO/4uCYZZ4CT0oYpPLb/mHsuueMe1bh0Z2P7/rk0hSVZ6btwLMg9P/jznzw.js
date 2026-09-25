function ensureStartupSplash() {
  let splash = document.getElementById("startupSplash");
  if (splash) return splash;
  splash = document.createElement("div");
  splash.id = "startupSplash";
  splash.style.cssText = "position:fixed;inset:0;z-index:999999;background:#121212;display:flex;align-items:center;justify-content:center;color:#fff;";
  const center = document.createElement("div");
  center.style.cssText = "display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;";
  const logo = document.querySelector(".auth-logo-icon img");
  if (logo) {
    const splashLogo = logo.cloneNode(true);
    splashLogo.style.cssText = "display:block;width:min(68px,22vw);height:auto;object-fit:contain;";
    center.appendChild(splashLogo);
  } else {
    const fallback = document.createElement("div");
    fallback.textContent = "hether";
    fallback.style.cssText = "font-size:54px;font-weight:700;letter-spacing:-1px;";
    center.appendChild(fallback);
  }
  splash.appendChild(center);
  const name = document.createElement("div");
  name.textContent = "Hether";
  name.style.cssText = "position:absolute;left:50%;bottom:56px;transform:translateX(-50%);font-size:18px;font-weight:400;letter-spacing:-.4px;opacity:1;white-space:nowrap;";
  splash.appendChild(name);
  const bottom = document.createElement("div");
  bottom.style.cssText = "position:absolute;left:50%;bottom:34px;transform:translateX(-50%);display:flex;align-items:center;gap:7px;font-size:13px;color:#9b9b9b;opacity:.85;white-space:nowrap;";
  bottom.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-headphones-icon lucide-headphones"><path d="M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3"/></svg><span>Handcrafted music</span>';
  splash.appendChild(bottom);
  document.body.appendChild(splash);
  return splash;
}

function hideStartupSplash() {
  const splash = document.getElementById("startupSplash");
  if (!splash) return;
  splash.style.transition = "opacity 180ms ease";
  splash.style.opacity = "0";
  setTimeout(() => splash.remove(), 180);
}

async function checkAuth() {
  ensureStartupSplash();
  try {
    const {data: {session: session}} = await supabaseClient.auth.getSession();
    if (session) {
      showApp();
      await loadUserProfile();
    } else {
      showAuthPage();
    }
  } finally {
    hideStartupSplash();
  }
}

function clearAuthFields() {
  [ "loginEmail", "loginPassword", "signupUsername", "signupEmail", "signupPassword" ].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
  const le = document.getElementById("loginError");
  if (le) le.style.display = "none";
  const se = document.getElementById("signupError");
  if (se) se.style.display = "none";
}

function showAuthPage() {
  document.getElementById("authPage").style.display = "flex";
  document.getElementById("mainApp").style.display = "none";
  clearAuthFields();
  showAuthView("landing");
}

function showApp() {
  window._guestMode = false;
  const profileBtnEl = document.getElementById("profileBtn");
  const guestBtnEl = document.getElementById("guestSignupBtn");
  if (profileBtnEl) profileBtnEl.style.display = "";
  if (guestBtnEl) guestBtnEl.style.display = "none";
  const headerBtn = document.getElementById("guestHeaderSignupBtn");
  if (headerBtn) headerBtn.style.display = "none";
  document.getElementById("authPage").style.display = "none";
  document.getElementById("mainApp").style.display = "flex";
  closeLogout();
  closeVaultPopup();
  closeProfileEdit();
  currentView = null;
  showView("aloft");
}

window._guestMode = false;

function enterGuestMode() {
  window._guestMode = true;
  currentUser = null;
  window._cachedUserRole = undefined;
  vaultAuthenticated = false;
  _vaultSessionValid = false;
  supabaseClient.auth.signOut().catch(() => {});
  document.getElementById("authPage").style.display = "none";
  document.getElementById("mainApp").style.display = "flex";
  closeLogout();
  closeVaultPopup();
  closeProfileEdit();
  const profileBtnEl = document.getElementById("profileBtn");
  const guestBtnEl = document.getElementById("guestSignupBtn");
  const guestAvatarEl = document.getElementById("guestSignupAvatar");
  if (profileBtnEl) profileBtnEl.style.display = "none";
  if (guestBtnEl) guestBtnEl.style.display = "flex";
  if (guestAvatarEl && typeof DEFAULT_AVATAR_SVG !== "undefined") guestAvatarEl.innerHTML = DEFAULT_AVATAR_SVG;
  const headerBtn = document.getElementById("guestHeaderSignupBtn");
  if (headerBtn) headerBtn.style.display = "flex";
  currentView = null;
  showView("aloft");
}

function exitGuestMode() {
  window._guestMode = false;
  const profileBtnEl = document.getElementById("profileBtn");
  const guestBtnEl = document.getElementById("guestSignupBtn");
  if (profileBtnEl) profileBtnEl.style.display = "";
  if (guestBtnEl) guestBtnEl.style.display = "none";
  const headerBtn = document.getElementById("guestHeaderSignupBtn");
  if (headerBtn) headerBtn.style.display = "none";
}

function goToSignupFromGuest() {
  exitGuestMode();
  document.getElementById("mainApp").style.display = "none";
  showAuthPage();
  showAuthView("signup");
}

function showAuthView(view) {
  document.querySelectorAll(".auth-panel-view").forEach(el => el.classList.remove("active"));
  const views = {
    landing: "authLanding",
    login: "authLoginView",
    signup: "authSignupView"
  };
  const el = document.getElementById(views[view]);
  if (el) el.classList.add("active");
  [ "loginError", "signupError" ].forEach(id => {
    const e = document.getElementById(id);
    if (e) e.style.display = "none";
  });
}

function authKeyHandler(e, formType) {
  if (e.key === "Enter") {
    if (formType === "login") handleLoginSubmit(); else handleSignupSubmit();
  }
}

async function handleLoginSubmit() {
  const email = document.getElementById("loginEmail").value.trim();
  const password = document.getElementById("loginPassword").value;
  const err = document.getElementById("loginError");
  const {data: data, error: error} = await supabaseClient.auth.signInWithPassword({
    email: email,
    password: password
  });
  if (error) {
    err.textContent = error.message;
    err.style.display = "block";
    return;
  }
  setTimeout(() => {
    showApp();
    loadUserProfile();
  }, 100);
}

async function handleSignupSubmit() {
  const username = document.getElementById("signupUsername").value.trim();
  const email = document.getElementById("signupEmail").value.trim();
  const password = document.getElementById("signupPassword").value;
  const {data: data, error: error} = await supabaseClient.auth.signUp({
    email: email,
    password: password
  });
  if (error) {
    document.getElementById("signupError").textContent = error.message;
    document.getElementById("signupError").style.display = "block";
    return;
  }
  const user = data.user;
  await supabaseClient.from("profiles").insert([ {
    id: user.id,
    username: username
  } ]);
  showApp();
  loadUserProfile();
}

async function preloadAllRelays() {
  const {data: {user: user}} = await supabaseClient.auth.getUser();
  if (!user) return;
  const PAGE_SIZE = 1e3;
  const MAX_PAGES = 25;
  async function fetchAllPaginated(queryBuilderFn, idFromMsg) {
    const seenIds = new Set;
    const rows = [];
    let offset = 0;
    for (let page = 0; page < MAX_PAGES; page++) {
      let pageData;
      try {
        const {data: d, error: error} = await queryBuilderFn().order("created_at", {
          ascending: false
        }).range(offset, offset + PAGE_SIZE - 1);
        if (error) throw error;
        pageData = d || [];
      } catch (e) {
        console.warn("[FLUX] message preload page failed:", e.message || e);
        break;
      }
      if (pageData.length === 0) break;
      rows.push(...pageData);
      const sizeBefore = seenIds.size;
      pageData.forEach(msg => seenIds.add(idFromMsg(msg)));
      const introducedNewPartner = seenIds.size > sizeBefore;
      if (pageData.length < PAGE_SIZE) break;
      if (!introducedNewPartner) break;
      offset += PAGE_SIZE;
    }
    return rows;
  }
  const data = await fetchAllPaginated(() => supabaseClient.from("messages").select("*").or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`), msg => msg.sender_id === user.id ? msg.receiver_id : msg.sender_id);
  let groupMsgs = [];
  if (_fluxMyGroupIds.size > 0) {
    groupMsgs = await fetchAllPaginated(() => supabaseClient.from("messages").select("*").in("group_id", [ ..._fluxMyGroupIds ]), msg => msg.group_id);
  }
  const latestMap = new Map;
  const sentByMeSet = new Set;
  const unseenCountMap = new Map;
  const last15Map = new Map;
  data.forEach(msg => {
    const otherId = msg.sender_id === user.id ? msg.receiver_id : msg.sender_id;
    if (!_fluxRealtimeClearedConversations.has(otherId)) {
      if (!latestMap.has(otherId)) latestMap.set(otherId, msg);
      if (msg.sender_id === user.id) sentByMeSet.add(otherId);
    }
    if (msg.sender_id === otherId && msg.receiver_id === user.id && msg.seen === false) {
      unseenCountMap.set(otherId, (unseenCountMap.get(otherId) || 0) + 1);
    }
    if (!_fluxRealtimeClearedConversations.has(otherId)) {
      if (!last15Map.has(otherId)) last15Map.set(otherId, []);
      const arr = last15Map.get(otherId);
      if (arr.length < 15) arr.push(msg);
    }
  });
  groupMsgs.forEach(msg => {
    const groupId = msg.group_id;
    if (_fluxRealtimeClearedConversations.has(groupId)) return;
    if (!latestMap.has(groupId)) latestMap.set(groupId, msg);
    if (!last15Map.has(groupId)) last15Map.set(groupId, []);
    const arr = last15Map.get(groupId);
    if (arr.length < 15) arr.push(msg);
  });
  fluxContacts.forEach(c => {
    if (sentByMeSet.has(c.id)) c.sentByMe = true;
    if (!c.isGroup) {
      const count = unseenCountMap.get(c.id) || 0;
      c.unread = count > 0;
      c.unreadCount = count;
    }
    const msgs = last15Map.get(c.id);
    if (msgs) c.preloadedMsgs = [ ...msgs ].reverse();
  });
  latestMap.forEach((msg, convId) => {
    const contact = fluxContacts.find(c => c.id === convId);
    if (!contact || _fluxRealtimeClearedConversations.has(convId)) return;
    const d = parseSupabaseDate(msg.created_at);
    const senderProfile = contact.isGroup ? contact.groupMemberProfiles?.[msg.sender_id] : null;
    const senderName = msg.sender_id === user.id ? "You" : senderProfile?.username || senderProfile?.displayName || "User";
    contact.lastMessage = {
      type: msg.sender_id === user.id ? "sent" : "received",
      text: msg.content,
      media: !!msg.media_url,
      time: formatMsgTime(d),
      senderName: senderName
    };
    contact.lastMessageTs = d.getTime();
  });
  buildFLUXConvList();
}

async function loadUserProfile() {
  const {data: {user: user}} = await supabaseClient.auth.getUser();
  if (!user) {
    currentUser = null;
    return;
  }
  currentUser = user;
  const {data: data} = await supabaseClient.from("profiles").select("*").eq("id", user.id).single();
  if (data) {
    profile = {
      name: data.display_name || data.username,
      username: "@" + data.username,
      email: user.email,
      avatarUrl: data.avatar_url
    };
    window._cachedUserRole = data.role || null;
    window._cachedMediaPerm = data.media_perm !== false;
  }
  renderProfileEverywhere();
  loadGhostMode();
  loadNotifications();
  loadSquaredBubble();
  loadInboxGrouping();
}

window.addEventListener("load", async function() {
  await initUser();
  checkAuth();
});

document.getElementById("fluxInput")?.addEventListener("blur", () => {
  stopTypingBroadcast();
});
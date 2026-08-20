
async function checkAuth() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (session) { showApp(); loadUserProfile(); }
  else showAuthPage();
}

function clearAuthFields() {
  ['loginEmail', 'loginPassword', 'signupUsername', 'signupEmail', 'signupPassword'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const le = document.getElementById('loginError'); if (le) le.style.display = 'none';
  const se = document.getElementById('signupError'); if (se) se.style.display = 'none';
}

function showAuthPage() {
  document.getElementById('authPage').style.display = 'flex';
  document.getElementById('mainApp').style.display = 'none';
  clearAuthFields();
  showAuthView('landing');
}
function showApp() {
  window._guestMode = false;
  const profileBtnEl = document.getElementById('profileBtn');
  const guestBtnEl = document.getElementById('guestSignupBtn');
  if (profileBtnEl) profileBtnEl.style.display = '';
  if (guestBtnEl) guestBtnEl.style.display = 'none';
  const headerBtn = document.getElementById('guestHeaderSignupBtn');
  if (headerBtn) headerBtn.style.display = 'none';
  document.getElementById('authPage').style.display = 'none';
  document.getElementById('mainApp').style.display = 'flex';
  closeLogout(); closeVaultPopup(); closeProfileEdit();
  // should never carry into a fresh login.
  currentView = null;
  showView('explore');
}

// ── GUEST MODE ("Try for Free") ──
// No data is stored, saved, or loaded — locally or remotely. No profile is
window._guestMode = false;

function enterGuestMode() {
  window._guestMode = true;
  // Make sure guest mode can never inherit a real account's session/role.
  // If a real account was logged in earlier in this tab, tear it down completely.
  currentUser = null;
  window._cachedUserRole = undefined;
  vaultAuthenticated = false;
  _vaultSessionValid = false;
  supabaseClient.auth.signOut().catch(() => {});
  document.getElementById('authPage').style.display = 'none';
  document.getElementById('mainApp').style.display = 'flex';
  closeLogout(); closeVaultPopup(); closeProfileEdit();
  // Swap the sidebar profile button for a blank/guest avatar + "Guest" label
  const profileBtnEl = document.getElementById('profileBtn');
  const guestBtnEl = document.getElementById('guestSignupBtn');
  const guestAvatarEl = document.getElementById('guestSignupAvatar');
  if (profileBtnEl) profileBtnEl.style.display = 'none';
  if (guestBtnEl) guestBtnEl.style.display = 'flex';
  if (guestAvatarEl && typeof DEFAULT_AVATAR_SVG !== 'undefined') guestAvatarEl.innerHTML = DEFAULT_AVATAR_SVG;
  // Show the green Sign Up button in the header
  const headerBtn = document.getElementById('guestHeaderSignupBtn');
  if (headerBtn) headerBtn.style.display = 'flex';
  currentView = null;
  showView('explore');
}

function exitGuestMode() {
  window._guestMode = false;
  const profileBtnEl = document.getElementById('profileBtn');
  const guestBtnEl = document.getElementById('guestSignupBtn');
  if (profileBtnEl) profileBtnEl.style.display = '';
  if (guestBtnEl) guestBtnEl.style.display = 'none';
  const headerBtn = document.getElementById('guestHeaderSignupBtn');
  if (headerBtn) headerBtn.style.display = 'none';
}

function goToSignupFromGuest() {
  exitGuestMode();
  document.getElementById('mainApp').style.display = 'none';
  showAuthPage();
  showAuthView('signup');
}
function showAuthView(view) {
  document.querySelectorAll('.auth-panel-view').forEach(el => el.classList.remove('active'));
  const views = { landing: 'authLanding', login: 'authLoginView', signup: 'authSignupView' };
  const el = document.getElementById(views[view]);
  if (el) el.classList.add('active');
  ['loginError', 'signupError'].forEach(id => { const e = document.getElementById(id); if (e) e.style.display = 'none'; });
}

function authKeyHandler(e, formType) {
  if (e.key === 'Enter') { if (formType === 'login') handleLoginSubmit(); else handleSignupSubmit(); }
}

async function handleLoginSubmit() {
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  const err = document.getElementById('loginError');
  const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
  if (error) { err.textContent = error.message; err.style.display = 'block'; return; }
  setTimeout(() => { showApp(); loadUserProfile(); }, 100);
}

async function handleSignupSubmit() {
  const username = document.getElementById('signupUsername').value.trim();
  const email = document.getElementById('signupEmail').value.trim();
  const password = document.getElementById('signupPassword').value;
  const { data, error } = await supabaseClient.auth.signUp({ email, password });
  if (error) { document.getElementById('signupError').textContent = error.message; document.getElementById('signupError').style.display = 'block'; return; }
  const user = data.user;
  await supabaseClient.from('profiles').insert([{ id: user.id, username }]);
  showApp(); loadUserProfile();
}

async function preloadAllRelays() {
  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) return;

  const { data, error } = await supabaseClient.from('messages').select('*')
    .or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`)
    .order('created_at', { ascending: false });
  if (error || !data) { buildFLUXConvList(); return; }

  // Group messages don't carry receiver_id, so the OR filter above never
  // sees them — pull them separately for every group the user belongs to
  // so group previews/sorting populate the same way DM previews do.
  let groupMsgs = [];
  if (_fluxMyGroupIds.size > 0) {
    const { data: gData, error: gErr } = await supabaseClient.from('messages').select('*')
      .in('group_id', [..._fluxMyGroupIds])
      .order('created_at', { ascending: false });
    if (!gErr && gData) groupMsgs = gData;
  }

  const latestMap = new Map();    // otherId -> latest msg
  const sentByMeSet = new Set();
  const unseenCountMap = new Map(); // otherId -> count of unseen msgs sent TO me
  const last15Map = new Map();    // otherId -> array of last 15 msgs (ascending)

  data.forEach(msg => {
    const otherId = msg.sender_id === user.id ? msg.receiver_id : msg.sender_id;
    if (!latestMap.has(otherId)) latestMap.set(otherId, msg);
    if (msg.sender_id === user.id) sentByMeSet.add(otherId);
    if (msg.sender_id === otherId && msg.receiver_id === user.id && msg.seen === false) {
      unseenCountMap.set(otherId, (unseenCountMap.get(otherId) || 0) + 1);
    }
    if (!last15Map.has(otherId)) last15Map.set(otherId, []);
    const arr = last15Map.get(otherId);
    if (arr.length < 15) arr.push(msg);
  });

  // Same bucketing as above, keyed by group_id instead of the sender/receiver
  // pair. Group unread counts aren't tracked yet (no per-member read state),
  // so those are left for the local session-only tracking already in place.
  groupMsgs.forEach(msg => {
    const groupId = msg.group_id;
    if (!latestMap.has(groupId)) latestMap.set(groupId, msg);
    if (!last15Map.has(groupId)) last15Map.set(groupId, []);
    const arr = last15Map.get(groupId);
    if (arr.length < 15) arr.push(msg);
  });

  fluxContacts.forEach(c => {
    if (sentByMeSet.has(c.id)) c.sentByMe = true;
    const count = unseenCountMap.get(c.id) || 0;
    if (count > 0) {
      c.unread = true;
      c.unreadCount = count;
    }
    const msgs = last15Map.get(c.id);
    if (msgs) c.preloadedMsgs = [...msgs].reverse();
  });

  latestMap.forEach((msg, convId) => {
    const contact = fluxContacts.find(c => c.id === convId);
    if (!contact) return;
    const d = parseSupabaseDate(msg.created_at);
    contact.lastMessage = { type: msg.sender_id === user.id ? 'sent' : 'received', text: msg.content, media: !!msg.media_url, time: formatMsgTime(d) };
    contact.lastMessageTs = d.getTime();
  });

  buildFLUXConvList();
}

async function loadUserProfile() {
  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) { currentUser = null; return; }
  // Keep the global currentUser in sync with whoever is actually authenticated
  // right now — this only ran once at page load before, so switching accounts
  // without a reload left presence/typing/game-score writes pointed at the
  // previous account.
  currentUser = user;
  const { data } = await supabaseClient.from('profiles').select('*').eq('id', user.id).single();
  if (data) {
    profile = { name: data.display_name || data.username, username: '@' + data.username, email: user.email, avatarUrl: data.avatar_url };
    window._cachedUserRole = data.role || null;
  }
  renderProfileEverywhere();
  loadGhostMode();
  loadNotifications();
  loadSquaredBubble();
  loadInboxGrouping();
}

window.addEventListener('load', async function() {
  await initUser();
  checkAuth();
});

document.getElementById('fluxInput')?.addEventListener('blur', () => { stopTypingBroadcast(); });

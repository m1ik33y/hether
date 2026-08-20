
// ── MOBILE PROFILE BOTTOM SHEET ──
let _mobThemePickerOpen = false;

async function openMobileProfileSheet() {
  if (!activeFluxId) return;
  await _loadMobProfileSheet(activeFluxId);
  document.getElementById('mobProfileSheetBackdrop').classList.add('show');
  requestAnimationFrame(() => {
    document.getElementById('mobProfileSheet').classList.add('show');
  });
}

function closeMobileProfileSheet() {
  document.getElementById('mobProfileSheet').classList.remove('show');
  document.getElementById('mobProfileSheetBackdrop').classList.remove('show');
  mobHideNicknameEditor();
  _mobThemePickerOpen = false;
  const picker = document.getElementById('mobThemePicker');
  const chevron = document.getElementById('mobThemeChevron');
  if (picker) picker.classList.remove('open');
  if (chevron) chevron.style.transform = '';
}

async function _loadMobProfileSheet(targetId) {
  if (!targetId) return;
  activeFluxProfileTarget = targetId;
  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) return;

  const [{ data: profileData }, { data: nicknameRows }] = await Promise.all([
    supabaseClient.from('profiles').select('username, display_name, avatar_url').eq('id', targetId).single(),
    supabaseClient.from('nicknames').select('nickname').eq('setter_id', user.id).eq('target_id', targetId).order('created_at', { ascending: false }).limit(1)
  ]);

  const rawUsername = profileData?.username || 'User';
  const profileName = profileData?.display_name || rawUsername;
  activeFluxNickname = nicknameRows?.[0]?.nickname || null;
  const displayName = activeFluxNickname || profileName;
  const actualUsername = profileData?.username ? '@' + profileData.username : 'Unknown user';

  document.getElementById('mobProfileSheetName').textContent = displayName;
  document.getElementById('mobProfileSheetUsername').textContent = actualUsername;
  const avatarEl = document.getElementById('mobProfileSheetAvatar');
  setAvatarEl(avatarEl, profileData?.avatar_url || null);
  avatarEl.style.borderRadius = '50%';

  const editBtn = document.getElementById('mobNicknameEditBtn');
  if (editBtn) editBtn.textContent = activeFluxNickname ? 'Edit Nickname' : 'Add Nickname';

  mobHideNicknameEditor();
  _mobThemePickerOpen = false;
  const picker = document.getElementById('mobThemePicker');
  const chevron = document.getElementById('mobThemeChevron');
  if (picker) picker.classList.remove('open');
  if (chevron) chevron.style.transform = '';
  mobRenderThemePicker();
}

function mobShowNicknameEditor() {
  document.getElementById('mobNicknameEditor').style.display = 'flex';
  document.getElementById('mobNicknameEditBtn').style.display = 'none';
  const input = document.getElementById('mobNicknameInput');
  if (input) { input.value = activeFluxNickname || ''; input.focus(); }
  const clearBtn = document.getElementById('mobNicknameClearBtn');
  if (clearBtn) clearBtn.style.display = activeFluxNickname ? '' : 'none';
}

function mobHideNicknameEditor() {
  const editor = document.getElementById('mobNicknameEditor');
  const editBtn = document.getElementById('mobNicknameEditBtn');
  if (editor) editor.style.display = 'none';
  if (editBtn) editBtn.style.display = '';
}

function mobNicknameInputKey(e) {
  if (e.key === 'Enter') { e.preventDefault(); mobCommitNickname(); }
  if (e.key === 'Escape') { mobHideNicknameEditor(); }
}

async function _saveNicknameValue(nickValue) {
  if (!activeFluxProfileTarget) return;
  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) return;
  if (nickValue) {
    await supabaseClient.from('nicknames').upsert(
      { setter_id: user.id, target_id: activeFluxProfileTarget, nickname: nickValue },
      { onConflict: 'setter_id,target_id' }
    );
    if (activeFluxId) {
      const myName = (await supabaseClient.from('profiles').select('username').eq('id', user.id).single()).data?.username || 'Someone';
      await supabaseClient.from('messages').insert({
        sender_id: user.id, receiver_id: activeFluxProfileTarget,
        content: myName + ' set a nickname for this conversation.',
        message_type: 'system'
      });
    }
  } else {
    await supabaseClient.from('nicknames').delete().eq('setter_id', user.id).eq('target_id', activeFluxProfileTarget);
  }
}

async function mobCommitNickname() {
  const input = document.getElementById('mobNicknameInput');
  const newNick = input ? input.value.trim() : '';
  await _saveNicknameValue(newNick);
  activeFluxNickname = newNick || null;
  const { data: profileData } = await supabaseClient.from('profiles').select('username, display_name').eq('id', activeFluxProfileTarget).single();
  const profileName = profileData?.display_name || profileData?.username || 'User';
  const displayName = activeFluxNickname || profileName;
  document.getElementById('mobProfileSheetName').textContent = displayName;
  const editBtn = document.getElementById('mobNicknameEditBtn');
  if (editBtn) editBtn.textContent = activeFluxNickname ? 'Edit Nickname' : 'Add Nickname';
  mobHideNicknameEditor();
  const fsName = document.getElementById('fluxFsName');
  if (fsName) fsName.textContent = displayName;
  const contact = fluxContacts.find(c => c.id === activeFluxProfileTarget);
  if (contact) { contact.nickname = activeFluxNickname; contact.name = displayName; contact.initials = displayName[0].toUpperCase(); buildFLUXConvList(); }
}

async function mobClearNickname() {
  await _saveNicknameValue('');
  activeFluxNickname = null;
  const { data: profileData } = await supabaseClient.from('profiles').select('username, display_name').eq('id', activeFluxProfileTarget).single();
  const profileName = profileData?.display_name || profileData?.username || 'User';
  document.getElementById('mobProfileSheetName').textContent = profileName;
  const editBtn = document.getElementById('mobNicknameEditBtn');
  if (editBtn) editBtn.textContent = 'Add Nickname';
  mobHideNicknameEditor();
  const fsName = document.getElementById('fluxFsName');
  if (fsName) fsName.textContent = profileName;
  const contact = fluxContacts.find(c => c.id === activeFluxProfileTarget);
  if (contact) { contact.nickname = null; contact.name = profileName; contact.initials = profileName[0].toUpperCase(); buildFLUXConvList(); }
}

function mobToggleThemePicker() {
  _mobThemePickerOpen = !_mobThemePickerOpen;
  const picker = document.getElementById('mobThemePicker');
  const chevron = document.getElementById('mobThemeChevron');
  if (picker) picker.classList.toggle('open', _mobThemePickerOpen);
  if (chevron) chevron.style.transform = _mobThemePickerOpen ? 'rotate(180deg)' : '';
  if (_mobThemePickerOpen) mobRenderThemePicker();
}

function mobRenderThemePicker() {
  const picker = document.getElementById('mobThemePicker');
  if (!picker) return;
  picker.innerHTML = '';
  (typeof RELAY_THEMES !== 'undefined' ? RELAY_THEMES : []).forEach(theme => {
    const item = document.createElement('div');
    item.className = 'flux-theme-item' + (_currentAppliedTheme === theme.id ? ' active' : '');
    item.onclick = () => { selectRelayTheme(theme.id); mobRenderThemePicker(); };
    item.innerHTML =
      '<div class="flux-theme-preview">' +
        '<span class="flux-theme-bubble-sent" style="background:' + theme.sent + ';color:' + theme.sentText + ';">Hey!</span>' +
        '<span class="flux-theme-bubble-recv" style="background:' + theme.recv + ';color:' + theme.recvText + ';">Hello &#128075;</span>' +
      '</div>' +
      '<div>' +
        '<div class="flux-theme-item-label">' + theme.tag + '</div>' +
        '<div class="flux-theme-item-sub">' + (theme.sub || '') + '</div>' +
      '</div>';
    picker.appendChild(item);
  });
}

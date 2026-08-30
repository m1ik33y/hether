
(function() {

  const TERM_HISTORY = [];
  let termHistIdx = -1;

  function termEl()      { return document.getElementById('vaultTerminal'); }
  function bodyEl()      { return document.getElementById('termBody'); }
  function inputEl()     { return document.getElementById('termLiveInput'); }
  function inputLineEl() { return document.querySelector('#termBody .term-input-line'); }

  // Focus the hidden input when clicking anywhere in the terminal body
  window.focusTermInput = function() {
    const inp = inputEl();
    if (inp) inp.focus();
  };

  function termPrint(text, cls) {
    const body = bodyEl();
    const inputLine = inputLineEl();
    if (!body || !inputLine) return;
    const line = document.createElement('div');
    line.className = 'term-line' + (cls ? ' ' + cls : '');
    line.textContent = text;
    body.insertBefore(line, inputLine);
    body.scrollTop = body.scrollHeight;
  }

  function termBanner() {
    termPrint('hether vault-shell  —  initialized', 'info');
    termPrint('type --help for available directives', 'info');
    termPrint('', '');
  }

  window.showVaultAccessErrorPill = function(msg) {
    console.error('[hether] ' + (msg || 'Access denied — vault key not found'));
  };

  // ── ASYNC ROLE CHECK ──
  async function isCurrentUserVault() {
    // previous real login in this tab.
    if (window._guestMode) return false;
    // Fast path: use cached role if available
    if (typeof window._cachedUserRole !== 'undefined') {
      return window._cachedUserRole === 'admin';
    }
    try {
      const { data: { user }, error } = await supabaseClient.auth.getUser();
      if (error || !user) return false;
      const { data: p } = await supabaseClient.from('profiles').select('role').eq('id', user.id).single();
      window._cachedUserRole = p ? (p.role || null) : null;
      return window._cachedUserRole === 'admin';
    } catch(e) {
      return false;
    }
  }

  window.openVaultTerminal = async function() {
    if (window._guestMode) {
      window.showVaultAccessErrorPill('Access denied — Vault clearance required');
      return;
    }
    const vault = await isCurrentUserVault();
    if (!vault) {
      window.showVaultAccessErrorPill('Access denied — Vault clearance required');
      return;
    }
    const el = termEl();
    const ov = document.getElementById('terminalOverlay');
    if (!el || !ov) return;
    el.classList.add('show');
    ov.classList.add('show');
    // Always start fresh — clear all output lines then print banner
    const body = bodyEl();
    if (body) body.querySelectorAll('.term-line').forEach(l => l.remove());
    termBanner();
    setTimeout(() => { const inp = inputEl(); if (inp) inp.focus(); }, 80);
  };

  window.closeVaultTerminal = function() {
    const el = termEl();
    const ov = document.getElementById('terminalOverlay');
    if (el) el.classList.remove('show');
    if (ov) ov.classList.remove('show');
    const inp = inputEl();
    if (inp) inp.value = '';
  };

  // Alt+T shortcut — desktop only
  document.addEventListener('keydown', function(e) {
    if (e.altKey && e.key === 't' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      if (window._guestMode) return; // disabled in guest / "Try for Free" mode
      if (window.innerWidth <= 640) return;
      e.preventDefault();
      const el = termEl();
      if (el && el.classList.contains('show')) {
        window.closeVaultTerminal();
      } else {
        window.openVaultTerminal();
      }
    }
    if (e.key === 'Escape') {
      const el = termEl();
      if (el && el.classList.contains('show')) {
        e.stopPropagation();
        window.closeVaultTerminal();
      }
    }
  });

  window.termHandleKey = function(e) {
    const inp = inputEl();
    if (e.key === 'Enter') {
      const raw = inp.value.trim();
      if (!raw) return;
      TERM_HISTORY.unshift(raw);
      termHistIdx = -1;
      inp.value = '';
      termPrint('>> ' + raw, 'cmd');
      runTermCmd(raw);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (termHistIdx + 1 < TERM_HISTORY.length) {
        termHistIdx++;
        inp.value = TERM_HISTORY[termHistIdx];
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (termHistIdx > 0) {
        termHistIdx--;
        inp.value = TERM_HISTORY[termHistIdx];
      } else {
        termHistIdx = -1;
        inp.value = '';
      }
    }
  };

  async function runTermCmd(raw) {
    const parts = raw.trim().split(/\s+/);
    const cmd = parts[0].toLowerCase();

    const vault = await isCurrentUserVault();
    if (!vault) {
      termPrint('', '');
      termPrint('  ACCESS DENIED  oversight key not present in session', 'err');
      termPrint('  required clearance: VAULT  |  current clearance: ' + (window._cachedUserRole || 'NONE'), 'err');
      termPrint('', '');
      return;
    }

    if (cmd === '--help') {
      termPrint('', '');
      termPrint('  DIRECTIVES', 'info');
      termPrint('  --check <u1> <u2>        check if two users have message history', 'info');
      termPrint('  --clear <uid1> <uid2>    purge all messages between two users', 'info');
      termPrint('  --clear <uid>            purge all FLUXs for a user with everyone', 'info');
      termPrint('  --reset                  flush terminal output buffer', 'info');
      termPrint('  --help                   display this index', 'info');
      termPrint('', '');
      return;
    }

    if (cmd === '--reset') {
      const body = bodyEl();
      const inputLine = inputLineEl();
      if (body && inputLine) {
        // Remove all .term-line divs, keep input-line
        body.querySelectorAll('.term-line').forEach(l => l.remove());
        termBanner();
      }
      return;
    }

    if (cmd === '--check') {
      if (parts.length !== 3) {
        termPrint('', '');
        termPrint('  ERR  invalid argument count', 'err');
        termPrint('  usage: --check <u1> <u2>', 'err');
        termPrint('', '');
        return;
      }
      await cmdCheckHistory(parts[1], parts[2]);
      return;
    }

    if (cmd === '--clear') {
      if (parts.length === 2) {
        await cmdClearAll(parts[1]);
        return;
      }
      if (parts.length === 3) {
        await cmdClearRelay(parts[1], parts[2]);
        return;
      }
      termPrint('', '');
      termPrint('  ERR  invalid argument count', 'err');
      termPrint('  usage: --clear <u1> <u2>   or   --clear <u>', 'err');
      termPrint('', '');
      return;
    }

    termPrint('', '');
    termPrint('  ERR  unrecognized directive: ' + cmd, 'err');
    termPrint('  run --help to list valid directives', 'err');
    termPrint('', '');
  }

  async function cmdClearRelay(u1, u2) {
    termPrint('', '');
    let currentUser;
    try {
      const { data: { user }, error } = await supabaseClient.auth.getUser();
      if (error || !user) {
        termPrint('  ERR  session token absent or expired — reauthenticate', 'err');
        termPrint('', '');
        return;
      }
      currentUser = user;
    } catch(e) {
      termPrint('  ERR  auth subsystem fault: ' + e.message, 'err');
      termPrint('', '');
      return;
    }

    // Check role in profiles table
    const { data: myProfile, error: roleErr } = await supabaseClient
      .from('profiles').select('role').eq('id', currentUser.id).single();

    if (roleErr || !myProfile) {
      termPrint('  ERR  profile record unresolvable — uid: ' + currentUser.id, 'err');
      termPrint('', '');
      return;
    }
    if (myProfile.role !== 'admin') {
      termPrint('  ACCESS DENIED  oversight key not present in session', 'err');
      termPrint('  required clearance: VAULT  |  current clearance: ' + (myProfile.role || 'NONE'), 'err');
      termPrint('', '');
      return;
    }

    // 2. Resolve both usernames to profile IDs
    termPrint('  [1/4]  resolving uid: ' + u1, 'info');

    const { data: p1Data, error: p1Err } = await supabaseClient
      .from('profiles').select('id, username').eq('username', u1).maybeSingle();
    if (p1Err) {
      termPrint('  ERR  profiles lookup fault — ' + p1Err.message, 'err');
      termPrint('', '');
      return;
    }
    if (!p1Data) {
      termPrint('  ERR  no record for handle: ' + u1, 'err');
      termPrint('', '');
      return;
    }

    termPrint('  [2/4]  resolving uid: ' + u2, 'info');

    const { data: p2Data, error: p2Err } = await supabaseClient
      .from('profiles').select('id, username').eq('username', u2).maybeSingle();
    if (p2Err) {
      termPrint('  ERR  profiles lookup fault — ' + p2Err.message, 'err');
      termPrint('', '');
      return;
    }
    if (!p2Data) {
      termPrint('  ERR  no record for handle: ' + u2, 'err');
      termPrint('', '');
      return;
    }

    if (p1Data.id === p2Data.id) {
      termPrint('  ERR  uid collision — both handles map to identical account', 'err');
      termPrint('', '');
      return;
    }

    const id1 = p1Data.id, id2 = p2Data.id;
    termPrint('  [3/4]  targets bound: ' + p1Data.username + ' <-> ' + p2Data.username, 'info');
    termPrint('  [4/4]  issuing DELETE on messages table...', 'info');

    const { error: delErr, count } = await supabaseClient
      .from('messages')
      .delete({ count: 'exact' })
      .or(`and(sender_id.eq.${id1},receiver_id.eq.${id2}),and(sender_id.eq.${id2},receiver_id.eq.${id1})`);

    if (delErr) {
      termPrint('', '');
      termPrint('  ERR  DELETE rejected by backend', 'err');
      termPrint('  db:  ' + delErr.message, 'err');
      termPrint('  code: ' + (delErr.code || 'n/a') + '  hint: ' + (delErr.hint || 'none'), 'err');
      termPrint('', '');
      return;
    }

    termPrint('       deleted ' + (count ?? '?') + ' message(s)', 'ok');

    // 4. Notify both users in real time
    try {
      const ch1 = supabaseClient.channel(`relay-cleared:${id1}`);
      const ch2 = supabaseClient.channel(`relay-cleared:${id2}`);
      await new Promise(r => setTimeout(r, 80));

      for (const [ch, notifyId, clearerId] of [[ch1, id1, id2], [ch2, id2, id1]]) {
        ch.subscribe(async (status) => {
          if (status === 'SUBSCRIBED') {
            await ch.send({
              type: 'broadcast',
              event: 'relay-cleared',
              payload: { clearerId }
            });
            setTimeout(() => supabaseClient.removeChannel(ch), 2000);
          }
        });
      }
    } catch(e) {
      termPrint('  WARN  realtime dispatch fault: ' + e.message, 'warn');
      termPrint('       messages purged but clients may not sync immediately', 'warn');
    }

    termPrint('', '');
  }

  async function cmdCheckHistory(u1, u2) {
    termPrint('', '');
    termPrint('  [1/3]  resolving: ' + u1, 'info');
    const { data: p1, error: e1 } = await supabaseClient
      .from('profiles').select('id, username').eq('username', u1).maybeSingle();
    if (e1 || !p1) { termPrint('  ERR  no record for handle: ' + u1, 'err'); termPrint('', ''); return; }

    termPrint('  [2/3]  resolving: ' + u2, 'info');
    const { data: p2, error: e2 } = await supabaseClient
      .from('profiles').select('id, username').eq('username', u2).maybeSingle();
    if (e2 || !p2) { termPrint('  ERR  no record for handle: ' + u2, 'err'); termPrint('', ''); return; }

    if (p1.id === p2.id) { termPrint('  ERR  both handles resolve to the same account', 'err'); termPrint('', ''); return; }

    termPrint('  [3/3]  querying message history...', 'info');
    const { data: msgs, error: mErr } = await supabaseClient
      .from('messages')
      .select('id', { count: 'exact' })
      .or(`and(sender_id.eq.${p1.id},receiver_id.eq.${p2.id}),and(sender_id.eq.${p2.id},receiver_id.eq.${p1.id})`)
      .limit(1);

    if (mErr) { termPrint('  ERR  query fault — ' + mErr.message, 'err'); termPrint('', ''); return; }

    const hasHistory = msgs && msgs.length > 0;
    termPrint('', '');
    termPrint('  ' + p1.username + ' <-> ' + p2.username, 'info');
    termPrint('  message history: ' + (hasHistory ? 'true' : 'false'), hasHistory ? 'ok' : 'warn');
    termPrint('', '');
  }

  async function cmdClearAll(u) {
    termPrint('', '');
    termPrint('  [1/4]  resolving: ' + u, 'info');
    const { data: profile, error: pErr } = await supabaseClient
      .from('profiles').select('id, username').eq('username', u).maybeSingle();
    if (pErr || !profile) { termPrint('  ERR  no record for handle: ' + u, 'err'); termPrint('', ''); return; }

    const uid = profile.id;

    termPrint('  [2/4]  discovering all FLUX partners...', 'info');
    const { data: msgs, error: mErr } = await supabaseClient
      .from('messages')
      .select('sender_id, receiver_id')
      .or(`sender_id.eq.${uid},receiver_id.eq.${uid}`);

    if (mErr) { termPrint('  ERR  query fault — ' + mErr.message, 'err'); termPrint('', ''); return; }

    const partnerIds = [...new Set(
      (msgs || []).map(m => m.sender_id === uid ? m.receiver_id : m.sender_id)
    )];

    termPrint('  [3/4]  found ' + partnerIds.length + ' partner(s) — issuing DELETE...', 'info');

    const { error: delErr, count } = await supabaseClient
      .from('messages')
      .delete({ count: 'exact' })
      .or(`sender_id.eq.${uid},receiver_id.eq.${uid}`);

    if (delErr) {
      termPrint('  ERR  DELETE rejected by backend', 'err');
      termPrint('  db:  ' + delErr.message, 'err');
      termPrint('', '');
      return;
    }

    termPrint('       deleted ' + (count ?? '?') + ' message(s) across ' + partnerIds.length + ' conversation(s)', 'ok');

    termPrint('  [4/4]  broadcasting clear to all affected clients...', 'info');
    try {
      for (const partnerId of partnerIds) {
        for (const [notifyId, clearerId] of [[uid, partnerId], [partnerId, uid]]) {
          const ch = supabaseClient.channel(`relay-cleared:${notifyId}`);
          ch.subscribe(async (status) => {
            if (status === 'SUBSCRIBED') {
              await ch.send({ type: 'broadcast', event: 'relay-cleared', payload: { clearerId } });
              setTimeout(() => supabaseClient.removeChannel(ch), 2000);
            }
          });
        }
        await new Promise(r => setTimeout(r, 40));
      }
    } catch(e) {
      termPrint('  WARN  realtime dispatch fault: ' + e.message, 'warn');
      termPrint('       messages purged but clients may not sync immediately', 'warn');
    }

    termPrint('', '');
    termPrint('  cleared all FLUXs for: ' + profile.username, 'ok');
    termPrint('', '');
  }

})();

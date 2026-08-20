

/* ────────────────────────────────────────────
   FIX 1: PROPER DEFAULT AVATAR SVG
   Head = circle, body = semicircle that fills
   the bottom half so it looks complete when
   cropped by the circular overflow:hidden.
   Uses fill so it renders solidly at any size.
──────────────────────────────────────────── */
const DEFAULT_AVATAR_SVG = `<svg viewBox="0 0 40 44" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <!-- head -->
  <circle cx="20" cy="13" r="8" fill="currentColor"/>
  <!-- body: a full ellipse anchored at the bottom so it fills the circle crop -->
  <ellipse cx="20" cy="40" rx="16" ry="13" fill="currentColor"/>
</svg>`;

// Deterministically picks 2 member ids to represent a group's default avatar:
// the group's first 2 members if there are only 2 or fewer, otherwise a
// stable "random" 2 among them (seeded by groupId so it doesn't reshuffle
// on every re-render, but still varies from group to group).
function _fluxPickTwoGroupMembers(groupId, memberIds) {
  const ids = (memberIds || []).slice();
  if (ids.length <= 2) return ids;
  ids.sort();
  let seed = 0;
  String(groupId).split('').forEach(ch => { seed = (seed * 31 + ch.charCodeAt(0)) >>> 0; });
  for (let i = ids.length - 1; i > 0; i--) {
    seed = (seed * 1103515245 + 12345) >>> 0;
    const j = seed % (i + 1);
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  return ids.slice(0, 2);
}

// Builds the "two overlapping pfps" markup used as a group's default avatar
// (in place of the generic single silhouette) when no custom group avatar_url
// is set. `urls` is an array of up to 2 avatar URLs (or null/undefined for a
// member with no pfp of their own, which falls back to the silhouette).
function buildDualAvatarHtml(urls) {
  const list = (urls || []).filter(u => u !== undefined);
  if (!list.length) {
    return `<div class="flux-dual-avatar"><div class="flux-dual-avatar-back">${DEFAULT_AVATAR_SVG}</div><div class="flux-dual-avatar-front">${DEFAULT_AVATAR_SVG}</div></div>`;
  }
  const first = list[0] || null;
  const second = list.length > 1 ? (list[1] || null) : first;
  const slot = (url) => url ? `<img src="${escHtml(url)}" alt="">` : DEFAULT_AVATAR_SVG;
  return `<div class="flux-dual-avatar"><div class="flux-dual-avatar-back">${slot(first)}</div><div class="flux-dual-avatar-front">${slot(second)}</div></div>`;
}

let currentUser = null;

async function initUser() {
  const { data: { user } } = await supabaseClient.auth.getUser();
  currentUser = user;
}

const supabaseClient = window.supabase.createClient(
  "https://zdxevrzwndranrcerrhs.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpkeGV2cnp3bmRyYW5yY2VycmhzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc0NzA1NjYsImV4cCI6MjA5MzA0NjU2Nn0.F6HWXevFCBF1KTd7IahlqbfHhm3koC0pqmRFK4TPPfM"
);

// ── LIBRARY (separate Supabase project) ──
const libraryClient = window.supabase.createClient(
  "https://fkstfwciwtialzycuefl.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZrc3Rmd2Npd3RpYWx6eWN1ZWZsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYzNTI4MjEsImV4cCI6MjEwMTkyODgyMX0.ZGZJ51xX_SMUjs1TvoBJNvqMMJoxPrZla2dt4lCvjls"
);

// ── SUBSCRIPTION MANAGER ──
const subscriptionManager = {
  activeSubscription: null,
  async replaceSubscription(newChannel) {
    if (this.activeSubscription) {
      await supabaseClient.removeChannel(this.activeSubscription);
    }
    this.activeSubscription = newChannel;
  }
};

// ── LIBRARY FEATURE ──
const LIB_THUMB_BUCKET = 'thumbnail';
const LIB_MUSIC_BUCKET = 'music';
let libSongsCache = [];
let libSelectedThumbFile = null;
let libSelectedMusicFile = null;
let libIsFavorite = false;
let libLoaded = false;
let libCurrentSong = null;
let libCurrentIndex = null;
let libIsPlaying = false;
let libQueueNextIndex = null; // index of the "next in queue" song shown in the panel
let libRepeatMode = 'off'; // 'off' | 'one' | 'all'
let libPlayMode = 'sequential'; // 'sequential' | 'shuffle' | 'manual'
let libUserIsAdmin = false; // whether the badge/delete control shows on cards
const LIB_LS_LAST_PLAYED = 'hetherLibLastPlayed';
const LIB_LS_RECENT = 'hetherLibRecentlyPlayed';
const LIB_LS_PLAYCOUNTS = 'hetherLibPlayCounts'; // { [songId]: playCount } — drives Explore's "Based on your interest"
let libRecentIds = loadLibRecentIds(); // song ids, most recent first, capped at 2 — drives the featured cards
let libThumbPos = { x: 50, y: 50 }; // object-position % chosen by dragging the thumbnail preview
let libThumbDragState = null;
let libThumbDidDrag = false;
let libNowPlayingThumbBlob = null;

function escapeLibText(s) {
  const d = document.createElement('div');
  d.textContent = s == null ? '' : String(s);
  return d.innerHTML;
}

// ── SKELETON LOADING HELPERS ──
// Generic shimmer placeholders shown the instant a nav item is clicked, so
// the layout (banner/buttons) appears immediately while the real content is
// still being fetched — never an empty/half-built page.
function skelRowsHtml(n) {
  let out = '';
  for (let i = 0; i < n; i++) {
    out += `<div class="skel-row"><div class="skel-block skel-row-thumb"></div><div class="skel-row-lines"><div class="skel-block skel-line w60"></div><div class="skel-block skel-line w35"></div></div></div>`;
  }
  return `<div class="skel-list">${out}</div>`;
}
function skelCardsHtml(n) {
  let out = '';
  for (let i = 0; i < n; i++) out += `<div class="skel-block skel-card"></div>`;
  return `<div class="skel-card-grid">${out}</div>`;
}
function skelExploreCardsHtml(n, more = false) {
  let out = '';
  for (let i = 0; i < n; i++) {
    out += `<div class="skel-explore-card ${more ? 'skel-more-card' : ''}">
      <div class="skel-block skel-card-bubble"></div>
      <div class="skel-block skel-card-title"></div>
      <div class="skel-block skel-card-title-short"></div>
      <div class="skel-block skel-card-button"></div>
    </div>`;
  }
  return more ? `<div class="skel-more-grid">${out}</div>` : `<div class="skel-card-grid">${out}</div>`;
}
function skelTilesHtml(n) {
  let out = '';
  for (let i = 0; i < n; i++) out += `<div class="skel-tile"><div class="skel-block skel-tile-thumb"></div><div class="skel-block skel-line w60"></div></div>`;
  return `<div class="skel-tile-row">${out}</div>`;
}
// Immediately paints skeleton placeholders into a view's containers, before
// the async data fetch has even started.
function renderLibrarySkeleton() {
  const grid = document.getElementById('libGrid');
  const listEl = document.getElementById('libList');
  if (grid) grid.innerHTML = skelCardsHtml(2);
  if (listEl) listEl.innerHTML = skelRowsHtml(6);
}
function renderExploreSkeleton() {
  const topRow = document.getElementById('exploreTopRow');
  const interestList = document.getElementById('exploreInterestList');
  const moreGrid = document.getElementById('exploreMoreGrid');
  if (topRow) topRow.innerHTML = skelExploreCardsHtml(2);
  if (interestList) interestList.innerHTML = skelRowsHtml(4);
  if (moreGrid) moreGrid.innerHTML = skelExploreCardsHtml(4, true);
}
function renderProfileSkeleton() {
  const row = document.getElementById('profileSongsRow');
  const section = document.getElementById('profileSongsSection');
  if (section) section.style.display = 'block';
  if (row) row.innerHTML = skelTilesHtml(6);
}

// Card titles are capped at 3 words at upload time. On render, put each word
// on its own line (1 word = 1 line, 2 words = 2 lines, 3 words = 3 lines).
function formatLibCardTitle(title) {
  const words = String(title || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return escapeLibText('Untitled');
  return words.map(w => `<span class="lib-card-title-word">${escapeLibText(w)}</span>`).join('');
}

// ── Local persistence: last played song + recently played (for the featured cards) ──
function saveLibLastPlayed(song) {
  try {
    localStorage.setItem(LIB_LS_LAST_PLAYED, JSON.stringify({
      id: song.id, title: song.title, artist: song.artist,
      thumbnail_url: song.thumbnail_url, music_url: song.music_url, file_path: song.file_path
    }));
  } catch (e) { /* storage unavailable — not fatal */ }
}
function loadLibLastPlayed() {
  try {
    const raw = localStorage.getItem(LIB_LS_LAST_PLAYED);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}
function loadLibRecentIds() {
  try {
    const raw = localStorage.getItem(LIB_LS_RECENT);
    return raw ? JSON.parse(raw) : [];
  } catch (e) { return []; }
}
function saveLibRecentId(songId) {
  if (songId == null) return;
  libRecentIds = [songId, ...libRecentIds.filter(id => id !== songId)].slice(0, 2);
  try { localStorage.setItem(LIB_LS_RECENT, JSON.stringify(libRecentIds)); } catch (e) { /* not fatal */ }
}
// ── Local persistence: per-song play counts (for Explore's "Based on your interest") ──
function loadLibPlayCounts() {
  try {
    const raw = localStorage.getItem(LIB_LS_PLAYCOUNTS);
    return raw ? JSON.parse(raw) : {};
  } catch (e) { return {}; }
}
function incrementLibPlayCount(songId) {
  if (songId == null) return;
  try {
    const counts = loadLibPlayCounts();
    counts[songId] = (counts[songId] || 0) + 1;
    localStorage.setItem(LIB_LS_PLAYCOUNTS, JSON.stringify(counts));
  } catch (e) { /* not fatal */ }
}
// Once the real library rows are in, swap the localStorage snapshot of the
// last played song for the actual row (real duration, current thumbnail, etc.)
// and figure out its index so playback controls (next/prev/queue) work.
function reconcileLibLastPlayedWithCache() {
  if (!libCurrentSong || libCurrentIndex !== null) return;
  const idx = libSongsCache.findIndex(s => s.id === libCurrentSong.id);
  if (idx === -1) return;
  libCurrentIndex = idx;
  libCurrentSong = libSongsCache[idx];
  updateNpQueueCard();
  updateLibGridPlayingState();
}
// Runs once on app load: if a song was played before, show it in the bottom
// bar (paused) immediately, without waiting on the library fetch or autoplaying.
function hydrateLibBarFromStorage() {
  const song = loadLibLastPlayed();
  if (!song) return;
  libCurrentSong = song;
  libCurrentIndex = null; // resolved once loadLibrary() runs, see reconcileLibLastPlayedWithCache
  const audio = document.getElementById('libAudio');
  if (audio && song.music_url) audio.src = song.music_url;
  libIsPlaying = false;

  document.getElementById('npEmpty').style.display = 'none';
  document.getElementById('npContent').classList.add('show');
  document.getElementById('npThumb').src = song.thumbnail_url || '';
  document.getElementById('npTitle').textContent = song.title || 'Untitled';
  document.getElementById('npArtist').textContent = song.artist || 'Anonymous';
  const creditsCard = document.getElementById('npCreditsCard');
  const creditsAuthor = document.getElementById('npCreditsAuthor');
  if (creditsAuthor) creditsAuthor.textContent = song.artist || 'Anonymous';
  if (creditsCard) creditsCard.style.display = 'block';
  updateNowPlayingPanelVisibility(currentView);

  const sbThumb = document.getElementById('sbThumb');
  const sbTitle = document.getElementById('sbTitle');
  const sbArtist = document.getElementById('sbArtist');
  if (sbThumb) sbThumb.src = song.thumbnail_url || '';
  if (sbTitle) sbTitle.textContent = song.title || 'Untitled';
  if (sbArtist) sbArtist.textContent = song.artist || 'Anonymous';
  const bar = document.getElementById('spotifyBar');
  if (bar) bar.classList.add('show');
  document.body.classList.add('has-player-bar');
  setLibPlayIcon(false);
}

// Checks the *auth* Supabase project (not the library one) for the current
// user's profile role. Cached on window._cachedUserRole so this only hits
// the network once per session, same cache the vault-terminal role check uses.
async function isLibUserAdmin() {
  if (window._guestMode) return false;
  if (typeof window._cachedUserRole !== 'undefined') {
    return window._cachedUserRole === 'admin';
  }
  try {
    const { data: { user }, error } = await supabaseClient.auth.getUser();
    if (error || !user) return false;
    const { data: p } = await supabaseClient.from('profiles').select('role').eq('id', user.id).single();
    window._cachedUserRole = p ? (p.role || null) : null;
    return window._cachedUserRole === 'admin';
  } catch (e) {
    return false;
  }
}

async function loadLibrary(force) {
  if (libLoaded && !force) return;
  const grid = document.getElementById('libGrid');
  const listEl = document.getElementById('libList');
  if (!grid || !listEl) return;
  grid.innerHTML = skelCardsHtml(2);
  listEl.innerHTML = skelRowsHtml(6);
  try {
    const { data, error } = await libraryClient
      .from('songs')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    libSongsCache = data || [];
    libLoaded = true;
    libUserIsAdmin = await isLibUserAdmin();
    reconcileLibLastPlayedWithCache();
    renderLibGrid();
  } catch (e) {
    console.error('Failed to load library', e);
    grid.innerHTML = '';
    listEl.innerHTML = '<div class="lib-empty">Couldn\'t load the library. Make sure the "songs" table exists in Supabase.<br>' + escapeLibText(e.message || e) + '</div>';
  }
}

// The top of the library shows up to 2 cards for the most recently played
// songs; everything else renders below as a compact Spotify-style row list.
function renderLibGrid() {
  const grid = document.getElementById('libGrid');
  const listEl = document.getElementById('libList');
  if (!grid || !listEl) return;
  if (!libSongsCache.length) {
    grid.innerHTML = '';
    listEl.innerHTML = '<div class="lib-empty">No songs yet. Click "Upload" to add the first one.</div>';
    return;
  }

  const recentIndices = [];
  libRecentIds.forEach(id => {
    if (recentIndices.length >= 2) return;
    const idx = libSongsCache.findIndex(s => s.id === id);
    if (idx !== -1 && !recentIndices.includes(idx)) recentIndices.push(idx);
  });

  grid.innerHTML = recentIndices.map(i => libCardHtml(libSongsCache[i], i)).join('');

  // The list below always shows every song, including the ones featured as
  // "recently played" cards above — being recently played shouldn't hide a
  // song from the full list.
  listEl.innerHTML = libSongsCache.length
    ? libSongsCache.map((s, i) => libRowHtml(s, i, i + 1)).join('')
    : '<div class="lib-empty">No songs yet. Click "Upload" to add the first one.</div>';

  loadLibCardDurations();
}

// ── LIBRARY BANNER SEARCH ──
// Filters libSongsCache by title/artist as the user types in the Library
// page's own banner search bar. Reuses the same .lib-row markup as the main
// list so playback controls keep working; clearing the box restores the
// normal "recently played" cards + full list view via renderLibGrid().
function handleLibBannerSearchInput() {
  filterLibraryBySearch();
}
function filterLibraryBySearch() {
  const grid = document.getElementById('libGrid');
  const listEl = document.getElementById('libList');
  const input = document.getElementById('libBannerSearchInput');
  if (!grid || !listEl || !input) return;
  const query = input.value.trim().toLowerCase();

  if (!query) {
    renderLibGrid();
    return;
  }
  if (!libLoaded) {
    grid.innerHTML = '';
    listEl.innerHTML = skelRowsHtml(6);
    return;
  }

  const matches = [];
  libSongsCache.forEach((song, i) => {
    const title = (song.title || '').toLowerCase();
    const artist = (song.artist || '').toLowerCase();
    if (title.includes(query) || artist.includes(query)) matches.push({ song, i });
  });

  grid.innerHTML = '';
  if (!matches.length) {
    listEl.innerHTML = `<div class="lib-empty">No songs found for "${escapeLibText(input.value.trim())}"</div>`;
    return;
  }
  listEl.innerHTML = matches.map((m, pos) => libRowHtml(m.song, m.i, pos + 1)).join('');
  loadLibCardDurations();
}

// ── SEARCH PAGE (favourites nav repurposed as Search) ──
// Filters the same libSongsCache used by the Library view and renders results
// in the identical .lib-row "playlist menu" format, using each song's real
// index into libSongsCache so play/pause/next controls keep working.
function handleSearchPageInput() {
  renderSearchPageResults();
}
function renderSearchPageResults() {
  const resultsEl = document.getElementById('searchPageResults');
  if (!resultsEl) return;
  const input = document.getElementById('searchPageInput');
  const query = (input && input.value || '').trim().toLowerCase();

  if (!query) {
    resultsEl.innerHTML = '';
    return;
  }
  if (!libLoaded) {
    resultsEl.innerHTML = skelRowsHtml(6);
    return;
  }
  const matches = [];
  libSongsCache.forEach((song, i) => {
    const title = (song.title || '').toLowerCase();
    const artist = (song.artist || '').toLowerCase();
    if (title.includes(query) || artist.includes(query)) matches.push({ song, i });
  });

  if (!matches.length) {
    resultsEl.innerHTML = '<div class="search-page-hint">No results</div>';
    return;
  }
  resultsEl.innerHTML = matches.map((m, pos) => libRowHtml(m.song, m.i, pos + 1)).join('');
  loadLibCardDurations();
}

function libCardDeleteBtnHtml(i) {
  if (!libUserIsAdmin) return '';
  return `<button type="button" class="lib-card-delete-btn" onclick="event.stopPropagation(); deleteLibSong(${i})" title="Delete song">
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z"/><line x1="15" x2="9" y1="9" y2="15"/><line x1="9" x2="15" y1="9" y2="15"/></svg>
  </button>`;
}

function libCardHtml(song, i, extraClass) {
  const author = escapeLibText(song.artist || 'Anonymous');
  const title = formatLibCardTitle(song.title || 'Untitled');
  const active = libIsPlaying && libCurrentIndex === i;
  const durText = song._durationText || '--:--';
  return `
  <div class="lib-card lib-playable-item${extraClass ? ' ' + extraClass : ''}${active ? ' is-playing' : ''}" data-index="${i}" onclick="handleLibCardClick(${i})">
    <img class="lib-card-thumb" src="${escapeLibText(song.thumbnail_url)}" alt="" loading="lazy">
    ${libCardDeleteBtnHtml(i)}
    <div class="lib-card-overlay">
      <div class="lib-card-meta-bubble">
        <span class="lib-card-meta-author">${author}</span>
        <span class="lib-card-meta-dot">&bull;</span>
        <span class="lib-card-meta-duration" data-dur-index="${i}">${durText}</span>
      </div>
      <div class="lib-card-bottom">
        <div class="lib-card-title">${title}</div>
        <button class="lib-card-play-btn" onclick="event.stopPropagation(); handleLibCardClick(${i})">
          <svg class="lib-card-play-icon" viewBox="0 0 24 24" fill="currentColor">${active ? '<path d="M6 5h4v14H6zM14 5h4v14h-4z"/>' : '<path d="M8 5v14l11-7z"/>'}</svg>
          <span class="lib-card-play-label">${active ? 'Now Playing' : 'Play'}</span>
        </button>
      </div>
    </div>
  </div>
`;
}

function libRowHtml(song, i, serial) {
  const author = escapeLibText(song.artist || 'Anonymous');
  const title = escapeLibText(song.title || 'Untitled');
  const active = libIsPlaying && libCurrentIndex === i;
  const durText = song._durationText || '--:--';
  return `
  <div class="lib-row lib-playable-item${active ? ' is-playing' : ''}" data-index="${i}" onclick="handleLibCardClick(${i})">
    <span class="lib-row-serial">${serial}</span>
    <div class="lib-row-thumb-wrap">
      <img class="lib-row-thumb" src="${escapeLibText(song.thumbnail_url)}" alt="" loading="lazy">
      <button type="button" class="lib-row-play-btn" onclick="event.stopPropagation(); handleLibCardClick(${i})" title="${active ? 'Pause' : 'Play'}">
        <svg class="lib-row-play-icon" viewBox="0 0 24 24" fill="currentColor">${active ? '<path d="M6 5h4v14H6zM14 5h4v14h-4z"/>' : '<path d="M8 5v14l11-7z"/>'}</svg>
      </button>
    </div>
    <div class="lib-row-text">
      <div class="lib-row-title">${title}</div>
      <div class="lib-row-author">${author}</div>
    </div>
    <span class="lib-row-duration" data-dur-index="${i}">${durText}</span>
    ${libUserIsAdmin ? `<button type="button" class="lib-row-delete-btn" onclick="event.stopPropagation(); deleteLibSong(${i})" title="Delete song">
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z"/><line x1="15" x2="9" y1="9" y2="15"/><line x1="9" x2="15" y1="9" y2="15"/></svg>
    </button>` : ''}
  </div>
`;
}

// Lazily probe each song's audio file for its duration (metadata-only load) and
// fill in the duration bubble once known. Cached on the song object so repeated
// re-renders don't re-fetch.
function loadLibCardDurations() {
  libSongsCache.forEach((song, i) => {
    if (song._durationText || !song.music_url) return;
    const probe = new Audio();
    probe.preload = 'metadata';
    probe.src = song.music_url;
    probe.addEventListener('loadedmetadata', () => {
      song._durationText = formatLibTime(probe.duration);
      document.querySelectorAll(`[data-dur-index="${i}"]`).forEach(el => { el.textContent = song._durationText; });
    });
    probe.addEventListener('error', () => {
      document.querySelectorAll(`[data-dur-index="${i}"]`).forEach(el => { el.textContent = '--:--'; });
    });
  });
}

// ── EXPLORE VIEW (Spotify-style discovery page) ──
// Returns `count` random library indices, excluding any song id in `excludeIds`.
function pickRandomLibIndices(count, excludeIds) {
  const exclude = excludeIds || [];
  const pool = [];
  libSongsCache.forEach((s, i) => { if (!exclude.includes(s.id)) pool.push(i); });
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count);
}

// Ranks songs by localStorage play count (most played first). If fewer than
// `limit` songs have ever been played, the rest are filled in randomly so
// the section never looks sparse.
function getMostPlayedLibIndices(limit) {
  const counts = loadLibPlayCounts();
  const ranked = libSongsCache
    .map((s, i) => ({ i, count: counts[s.id] || 0 }))
    .filter(x => x.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
    .map(x => x.i);
  if (ranked.length < limit) {
    const filler = pickRandomLibIndices(limit - ranked.length, ranked.map(i => libSongsCache[i].id));
    ranked.push(...filler);
  }
  return ranked;
}

// ── PROFILE: "Most played" row (square thumbnails, single row, sourced from
// the same play-count ranking Explore uses) ──
async function loadProfileTopSongs() {
  if (!libLoaded) await loadLibrary();
  renderProfileTopSongs();
}
function profileSongTileHtml(song, i) {
  const author = escapeLibText(song.artist || 'Anonymous');
  const title = escapeLibText(song.title || 'Untitled');
  const active = libIsPlaying && libCurrentIndex === i;
  return `
  <button type="button" class="profile-song-tile lib-playable-item${active ? ' is-playing' : ''}" data-index="${i}" onclick="handleLibCardClick(${i})">
    <div class="profile-song-thumb-wrap">
      <img class="profile-song-thumb" src="${escapeLibText(song.thumbnail_url)}" alt="" loading="lazy">
      <span class="profile-song-play-btn" onclick="event.stopPropagation(); handleLibCardClick(${i})" title="${active ? 'Pause' : 'Play'}">
        <svg viewBox="0 0 24 24" fill="#fff">${active ? '<rect x="6" y="5" width="4" height="14" rx="1.5"/><rect x="14" y="5" width="4" height="14" rx="1.5"/>' : '<path d="M8 5v14l11-7z" stroke="#fff" stroke-width="2" stroke-linejoin="round"/>'}</svg>
      </span>
    </div>
    <div class="profile-song-name">${title}</div>
    <div class="profile-song-artist">${author}</div>
  </button>
`;
}
function renderProfileTopSongs() {
  const section = document.getElementById('profileSongsSection');
  const row = document.getElementById('profileSongsRow');
  if (!section || !row) return;
  if (!libSongsCache.length) {
    section.style.display = 'none';
    row.innerHTML = '';
    return;
  }
  const topIndices = getMostPlayedLibIndices(6);
  row.innerHTML = topIndices.map(i => profileSongTileHtml(libSongsCache[i], i)).join('');
  section.style.display = topIndices.length ? 'block' : 'none';
}

async function loadExploreView() {
  if (!libLoaded) await loadLibrary();
  renderExploreView();
}

function renderExploreView() {
  const topRow = document.getElementById('exploreTopRow');
  const interestList = document.getElementById('exploreInterestList');
  const moreGrid = document.getElementById('exploreMoreGrid');
  if (!topRow || !interestList || !moreGrid) return;

  if (!libSongsCache.length) {
    topRow.innerHTML = '';
    interestList.innerHTML = '<div class="lib-empty">No songs yet. Head to Library to add some.</div>';
    moreGrid.innerHTML = '';
    return;
  }

  const topIndices = pickRandomLibIndices(2, []);
  topRow.innerHTML = topIndices.map(i => libCardHtml(libSongsCache[i], i)).join('');

  const interestIndices = getMostPlayedLibIndices(4);
  interestList.innerHTML = interestIndices.length
    ? interestIndices.map((i, n) => libRowHtml(libSongsCache[i], i, n + 1)).join('')
    : '<div class="lib-empty">Play a few songs to get picks here.</div>';

  const usedIds = topIndices.concat(interestIndices).map(i => libSongsCache[i].id);
  const moreIndices = pickRandomLibIndices(4, usedIds);
  moreGrid.innerHTML = moreIndices.map(i => libCardHtml(libSongsCache[i], i, 'explore-more-card')).join('');

  loadLibCardDurations();
}

// Sync every card/row's Play / Now Playing state with current playback.
function updateLibGridPlayingState() {
  document.querySelectorAll('.lib-playable-item').forEach(el => {
    const idx = parseInt(el.dataset.index, 10);
    const active = libIsPlaying && libCurrentIndex === idx;
    el.classList.toggle('is-playing', active);
    const icon = el.querySelector('.lib-card-play-icon, .lib-row-play-icon, .profile-song-play-btn svg');
    const label = el.querySelector('.lib-card-play-label');
    if (icon) icon.innerHTML = active ? '<path d="M6 5h4v14H6zM14 5h4v14h-4z"/>' : '<path d="M8 5v14l11-7z"/>';
    if (label) label.textContent = active ? 'Now Playing' : 'Play';
  });
}


function openLibUpload() {
  document.getElementById('libCreateRow').style.display = 'none';
  libSelectedThumbFile = null;
  libSelectedMusicFile = null;
  libThumbPos = { x: 50, y: 50 };
  document.getElementById('libThumbPreview').style.display = 'none';
  document.getElementById('libThumbPreview').style.objectPosition = '50% 50%';
  document.getElementById('libThumbRepositionHint').classList.remove('show');
  document.getElementById('libThumbPlaceholder').style.display = 'block';
  document.getElementById('libThumbPlaceholder').textContent = 'Thumbnail';
  document.getElementById('libThumbInput').value = '';
  document.getElementById('libMusicInput').value = '';
  document.getElementById('libMusicBtn').classList.remove('has-file');
  document.getElementById('libMusicLabel').classList.remove('has-file');
  document.getElementById('libMusicLabel').textContent = '';
  document.getElementById('libTitleInput').value = '';
  document.getElementById('libArtistInput').value = '';
  document.getElementById('libArtistBox').classList.remove('show');
  document.getElementById('libArtistToggleBtn').classList.remove('active');
  document.getElementById('libArtistSaveBtn').classList.remove('show');
  libNowPlayingThumbBlob = null;
  const npBtn = document.getElementById('libNowPlayingBtn');
  npBtn.classList.remove('active');
  const swatch = npBtn.querySelector('.lib-np-swatch');
  if (swatch) swatch.remove();
  document.getElementById('libThumbNpThumb').classList.remove('show');
  document.getElementById('libThumbNpThumbImg').src = '';
  document.getElementById('libModalError').textContent = '';
  document.getElementById('libSubmitBtn').disabled = false;
  document.getElementById('libSubmitBtn').textContent = 'Upload';
  document.getElementById('libModalOverlay').classList.add('show');
}
function closeLibUpload() {
  document.getElementById('libModalOverlay').classList.remove('show');
  document.getElementById('libCreateRow').style.display = '';
}
function toggleLibArtistBox() {
  const box = document.getElementById('libArtistBox');
  const btn = document.getElementById('libArtistToggleBtn');
  const saveBtn = document.getElementById('libArtistSaveBtn');
  const showing = box.classList.toggle('show');
  btn.classList.toggle('active', showing);
  saveBtn.classList.toggle('show', showing);
  if (showing) document.getElementById('libArtistInput').focus();
}
function handleLibTitleEnter(e) {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  const val = e.target.value.trim();
  document.getElementById('libThumbPlaceholder').textContent = val || 'Thumbnail';
}
// Song titles are capped at 3 words so they render cleanly as a one-word-per-line
// card title. Trims any extra words as the user types, preserving trailing spaces
// so they can still type a new word without the limit fighting them mid-word.
function enforceLibTitleWordLimit(e) {
  const input = e.target;
  const raw = input.value;
  const words = raw.split(/\s+/).filter(Boolean);
  if (words.length > 3) {
    input.value = words.slice(0, 3).join(' ');
  }
}

// ── Now playing thumbnail crop modal ──
const LIB_CROP_OUTPUT_W = 600;
const LIB_CROP_OUTPUT_H = Math.round(LIB_CROP_OUTPUT_W / 1.17); // 1.17:1, fixed ratio — cannot be reshaped, only cropped
let libCropNaturalW = 0, libCropNaturalH = 0;
let libCropScale = 1, libCropMinScale = 1;
let libCropOffsetX = 0, libCropOffsetY = 0;
let libCropDragging = false, libCropDragStartX = 0, libCropDragStartY = 0, libCropStartOffsetX = 0, libCropStartOffsetY = 0;

function openLibCropModal() {
  document.getElementById('libCropModalOverlay').classList.add('show');
  document.getElementById('libCropPicker').style.display = 'flex';
  document.getElementById('libCropStage').style.display = 'none';
  document.getElementById('libCropFileInput').value = '';
}
function closeLibCropModal() {
  document.getElementById('libCropModalOverlay').classList.remove('show');
}
function handleLibCropFileSelect(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  const img = document.getElementById('libCropImage');
  img.onload = () => {
    // Reveal the stage BEFORE measuring the frame — a display:none element
    // always reports clientWidth/clientHeight as 0, which was collapsing
    // the image to zero size (so it never appeared).
    document.getElementById('libCropPicker').style.display = 'none';
    document.getElementById('libCropStage').style.display = 'block';

    libCropNaturalW = img.naturalWidth;
    libCropNaturalH = img.naturalHeight;
    const frame = document.getElementById('libCropFrame');
    const frameW = frame.clientWidth, frameH = frame.clientHeight;
    // scale so the image always fully covers the fixed vertical frame — never letterboxed
    libCropMinScale = Math.max(frameW / libCropNaturalW, frameH / libCropNaturalH);
    libCropScale = libCropMinScale;
    libCropOffsetX = (frameW - libCropNaturalW * libCropScale) / 2;
    libCropOffsetY = (frameH - libCropNaturalH * libCropScale) / 2;
    applyLibCropTransform();
  };
  img.src = URL.createObjectURL(file);
}
function clampLibCropOffsets() {
  const frame = document.getElementById('libCropFrame');
  const frameW = frame.clientWidth, frameH = frame.clientHeight;
  const w = libCropNaturalW * libCropScale, h = libCropNaturalH * libCropScale;
  const minX = frameW - w, maxX = 0;
  const minY = frameH - h, maxY = 0;
  libCropOffsetX = Math.min(maxX, Math.max(minX, libCropOffsetX));
  libCropOffsetY = Math.min(maxY, Math.max(minY, libCropOffsetY));
}
function applyLibCropTransform() {
  const img = document.getElementById('libCropImage');
  img.style.width = (libCropNaturalW * libCropScale) + 'px';
  img.style.height = (libCropNaturalH * libCropScale) + 'px';
  img.style.transform = `translate(${libCropOffsetX}px, ${libCropOffsetY}px)`;
}
function libCropPointerDown(e) {
  if (!libCropNaturalW) return;
  libCropDragging = true;
  libCropDragStartX = e.clientX;
  libCropDragStartY = e.clientY;
  libCropStartOffsetX = libCropOffsetX;
  libCropStartOffsetY = libCropOffsetY;
  if (e.target.setPointerCapture) e.target.setPointerCapture(e.pointerId);
}
function libCropPointerMove(e) {
  if (!libCropDragging) return;
  libCropOffsetX = libCropStartOffsetX + (e.clientX - libCropDragStartX);
  libCropOffsetY = libCropStartOffsetY + (e.clientY - libCropDragStartY);
  clampLibCropOffsets();
  applyLibCropTransform();
}
function libCropPointerUp() {
  libCropDragging = false;
}
function confirmLibCrop() {
  if (!libCropNaturalW) return;
  const frame = document.getElementById('libCropFrame');
  const frameW = frame.clientWidth, frameH = frame.clientHeight;
  const factor = LIB_CROP_OUTPUT_W / frameW;
  const canvas = document.createElement('canvas');
  canvas.width = LIB_CROP_OUTPUT_W;
  canvas.height = LIB_CROP_OUTPUT_H;
  const ctx = canvas.getContext('2d');
  const img = document.getElementById('libCropImage');
  ctx.drawImage(
    img,
    libCropOffsetX * factor, libCropOffsetY * factor,
    libCropNaturalW * libCropScale * factor, libCropNaturalH * libCropScale * factor
  );
  canvas.toBlob((blob) => {
    if (!blob) return;
    libNowPlayingThumbBlob = blob;
    const url = URL.createObjectURL(blob);
    const btn = document.getElementById('libNowPlayingBtn');
    btn.classList.add('active');
    btn.classList.remove('pop');
    void btn.offsetWidth;
    btn.classList.add('pop');
    let swatch = btn.querySelector('.lib-np-swatch');
    if (!swatch) {
      swatch = document.createElement('span');
      swatch.className = 'lib-np-swatch';
      btn.appendChild(swatch);
    }
    swatch.style.backgroundImage = `url(${url})`;
    const bannerThumb = document.getElementById('libThumbNpThumb');
    document.getElementById('libThumbNpThumbImg').src = url;
    bannerThumb.classList.add('show');
    closeLibCropModal();
  }, 'image/jpeg', 0.92);
}
function handleLibThumbSelect(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  libSelectedThumbFile = file;
  libThumbPos = { x: 50, y: 50 };
  const preview = document.getElementById('libThumbPreview');
  preview.style.objectPosition = '50% 50%';
  preview.src = URL.createObjectURL(file);
  preview.style.display = 'block';
  document.getElementById('libThumbRepositionHint').classList.add('show');
}

// Clicking the drop zone opens the file picker — unless the click was actually
// the tail end of a drag used to reposition the image.
function handleLibThumbDropClick() {
  if (libThumbDidDrag) { libThumbDidDrag = false; return; }
  document.getElementById('libThumbInput').click();
}

// ── Drag-to-reposition for the thumbnail preview ──
// Computes how far the "cover"-scaled image overflows the frame in each axis,
// then maps drag distance to object-position percentage so the drag feels 1:1.
function libThumbPointerDown(e) {
  const preview = document.getElementById('libThumbPreview');
  if (!preview || preview.style.display === 'none' || !preview.naturalWidth) return;
  e.preventDefault();
  const rect = preview.getBoundingClientRect();
  const imgAspect = preview.naturalWidth / preview.naturalHeight;
  const boxAspect = rect.width / rect.height;
  let overflowX = 0, overflowY = 0;
  if (imgAspect > boxAspect) {
    overflowX = rect.height * imgAspect - rect.width;
  } else {
    overflowY = rect.width / imgAspect - rect.height;
  }
  const point = e.touches ? e.touches[0] : e;
  libThumbDragState = {
    startX: point.clientX, startY: point.clientY,
    startPosX: libThumbPos.x, startPosY: libThumbPos.y,
    overflowX, overflowY
  };
  libThumbDidDrag = false;
  document.addEventListener('mousemove', libThumbPointerMove);
  document.addEventListener('mouseup', libThumbPointerUp);
  document.addEventListener('touchmove', libThumbPointerMove, { passive: false });
  document.addEventListener('touchend', libThumbPointerUp);
}
function libThumbPointerMove(e) {
  if (!libThumbDragState) return;
  e.preventDefault();
  const point = e.touches ? e.touches[0] : e;
  const dx = point.clientX - libThumbDragState.startX;
  const dy = point.clientY - libThumbDragState.startY;
  if (Math.abs(dx) > 3 || Math.abs(dy) > 3) libThumbDidDrag = true;
  const { overflowX, overflowY, startPosX, startPosY } = libThumbDragState;
  let x = overflowX > 0 ? startPosX - (dx / overflowX) * 100 : startPosX;
  let y = overflowY > 0 ? startPosY - (dy / overflowY) * 100 : startPosY;
  x = Math.max(0, Math.min(100, x));
  y = Math.max(0, Math.min(100, y));
  libThumbPos = { x, y };
  document.getElementById('libThumbPreview').style.objectPosition = `${x}% ${y}%`;
}
function libThumbPointerUp() {
  libThumbDragState = null;
  document.removeEventListener('mousemove', libThumbPointerMove);
  document.removeEventListener('mouseup', libThumbPointerUp);
  document.removeEventListener('touchmove', libThumbPointerMove);
  document.removeEventListener('touchend', libThumbPointerUp);
}

// Bakes the chosen crop (position + aspect ratio) into an actual image file so
// the library card and now-playing panel show exactly what was framed here.
function cropLibThumbToCover(file, posXPercent, posYPercent, targetAspect) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const iw = img.naturalWidth, ih = img.naturalHeight;
      const imgAspect = iw / ih;
      let cropW, cropH;
      if (imgAspect > targetAspect) { cropH = ih; cropW = ih * targetAspect; }
      else { cropW = iw; cropH = iw / targetAspect; }
      const sx = (iw - cropW) * (posXPercent / 100);
      const sy = (ih - cropH) * (posYPercent / 100);
      const outW = Math.min(1280, Math.round(cropW));
      const outH = Math.round(outW / targetAspect);
      const canvas = document.createElement('canvas');
      canvas.width = outW; canvas.height = outH;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, sx, sy, cropW, cropH, 0, 0, outW, outH);
      canvas.toBlob((blob) => {
        if (!blob) { reject(new Error('Could not process image')); return; }
        const base = (file.name || 'thumbnail').replace(/\.[^/.]+$/, '');
        resolve(new File([blob], `${base}.jpg`, { type: 'image/jpeg' }));
      }, 'image/jpeg', 0.9);
    };
    img.onerror = () => reject(new Error('Could not read image'));
    img.src = URL.createObjectURL(file);
  });
}
function handleLibMusicSelect(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  libSelectedMusicFile = file;
  document.getElementById('libMusicBtn').classList.add('has-file');
  document.getElementById('libMusicLabel').classList.add('has-file');
  document.getElementById('libMusicLabel').textContent = file.name;
}

// Admin-only: permanently remove a song from the library (row + its storage
// files). Only reachable via the badge that renders when libUserIsAdmin is true.
async function deleteLibSong(index) {
  const song = libSongsCache[index];
  if (!song) return;
  if (!confirm(`Delete "${song.title || 'Untitled'}"? This can't be undone.`)) return;

  try {
    const { error } = await libraryClient.from('songs').delete().eq('id', song.id);
    if (error) throw error;

    // Best-effort cleanup of the underlying storage files — the row is what
    // actually matters, so a storage failure here shouldn't block the delete.
    try {
      if (song.file_path) {
        await libraryClient.storage.from(LIB_MUSIC_BUCKET).remove([song.file_path]);
      }
      if (song.thumbnail_url) {
        const marker = `/object/public/${LIB_THUMB_BUCKET}/`;
        const idx = song.thumbnail_url.indexOf(marker);
        if (idx !== -1) {
          const thumbPath = decodeURIComponent(song.thumbnail_url.slice(idx + marker.length));
          await libraryClient.storage.from(LIB_THUMB_BUCKET).remove([thumbPath]);
        }
      }
    } catch (cleanupErr) {
      console.warn('Storage cleanup failed after song delete', cleanupErr);
    }

    // If the deleted song was playing, stop playback entirely.
    if (libCurrentIndex === index) {
      const audio = document.getElementById('libAudio');
      if (audio) { audio.pause(); audio.src = ''; }
      libIsPlaying = false;
      libCurrentSong = null;
      libCurrentIndex = null;
      libQueueNextIndex = null;
      setLibPlayIcon(false);
      const bar = document.getElementById('spotifyBar');
      if (bar) bar.classList.remove('show');
      document.body.classList.remove('has-player-bar');
      const card = document.getElementById('npQueueCard');
      if (card) card.style.display = 'none';
    } else if (libCurrentIndex !== null && libCurrentIndex > index) {
      // Everything after the removed row shifts down by one.
      libCurrentIndex -= 1;
    }

    // Drop it from the "recently played" localStorage record too, so a
    // deleted song can't keep occupying one of the 2 featured card slots.
    libRecentIds = libRecentIds.filter(id => id !== song.id);
    try { localStorage.setItem(LIB_LS_RECENT, JSON.stringify(libRecentIds)); } catch (e) { /* not fatal */ }
    const lastPlayed = loadLibLastPlayed();
    if (lastPlayed && lastPlayed.id === song.id) {
      try { localStorage.removeItem(LIB_LS_LAST_PLAYED); } catch (e) { /* not fatal */ }
    }

    libSongsCache.splice(index, 1);
    renderLibGrid();
    if (libCurrentIndex !== null) updateNpQueueCard();
  } catch (e) {
    console.error('Failed to delete song', e);
    alert('Could not delete this song: ' + (e.message || e));
  }
}

async function submitLibUpload() {
  const errEl = document.getElementById('libModalError');
  errEl.textContent = '';
  if (!libSelectedThumbFile) { errEl.textContent = 'A thumbnail image is required.'; return; }
  if (!libSelectedMusicFile) { errEl.textContent = 'A music file is required.'; return; }

  const btn = document.getElementById('libSubmitBtn');
  btn.disabled = true;
  btn.textContent = 'Uploading…';

  try {
    const stamp = Date.now();
    const safeName = (n) => n.replace(/[^a-zA-Z0-9._-]/g, '_');

    let thumbFileToUpload = libSelectedThumbFile;
    try {
      thumbFileToUpload = await cropLibThumbToCover(libSelectedThumbFile, libThumbPos.x, libThumbPos.y, 1.7);
    } catch (cropErr) {
      console.warn('Thumbnail crop failed, uploading original image instead', cropErr);
    }

    const thumbPath = `${stamp}_${safeName(thumbFileToUpload.name)}`;
    const musicPath = `${stamp}_${safeName(libSelectedMusicFile.name)}`;

    const { error: thumbErr } = await libraryClient.storage
      .from(LIB_THUMB_BUCKET)
      .upload(thumbPath, thumbFileToUpload, { cacheControl: '3600', upsert: false });
    if (thumbErr) throw new Error('Thumbnail upload failed: ' + thumbErr.message);

    const { error: musicErr } = await libraryClient.storage
      .from(LIB_MUSIC_BUCKET)
      .upload(musicPath, libSelectedMusicFile, { cacheControl: '3600', upsert: false });
    if (musicErr) throw new Error('Music upload failed: ' + musicErr.message);

    const { data: thumbUrlData } = libraryClient.storage.from(LIB_THUMB_BUCKET).getPublicUrl(thumbPath);
    const { data: musicUrlData } = libraryClient.storage.from(LIB_MUSIC_BUCKET).getPublicUrl(musicPath);

    const rawTitle = document.getElementById('libTitleInput').value.trim() || libSelectedMusicFile.name.replace(/\.[^/.]+$/, '');
    const title = rawTitle.split(/\s+/).filter(Boolean).slice(0, 3).join(' ');
    const artist = document.getElementById('libArtistInput').value.trim() || null;

    const { error: insertErr } = await libraryClient.from('songs').insert({
      title,
      artist,
      thumbnail_url: thumbUrlData.publicUrl,
      music_url: musicUrlData.publicUrl,
      file_path: musicPath,
      uploader_name: (currentUser && (currentUser.user_metadata?.display_name || currentUser.email)) || 'Anonymous'
    });
    if (insertErr) throw new Error('Saving song failed: ' + insertErr.message);

    closeLibUpload();
    await loadLibrary(true);
  } catch (e) {
    console.error(e);
    errEl.textContent = e.message || 'Something went wrong. Please try again.';
    btn.disabled = false;
    btn.textContent = 'Upload';
  }
}

// ── Playback ──
// Card/button click: if this song is the one currently playing, clicking again
// pauses it (and the button falls back to "Play"); otherwise start it playing.
function handleLibCardClick(index) {
  if (libIsPlaying && libCurrentIndex === index) {
    toggleLibPlayback();
  } else {
    playLibSong(index);
  }
}

function playLibSong(index) {
  const song = libSongsCache[index];
  if (!song) return;
  // Switching to a different song cancels any active repeat.
  if (libRepeatMode !== 'off' && libCurrentIndex !== null && libCurrentIndex !== index) {
    libRepeatMode = 'off';
    updateRepeatIcon();
  }
  libCurrentSong = song;
  libCurrentIndex = index;
  const audio = document.getElementById('libAudio');
  audio.src = song.music_url;
  audio.play().catch(err => console.warn('Playback failed', err));
  libIsPlaying = true;
  saveLibLastPlayed(song);
  saveLibRecentId(song.id);
  incrementLibPlayCount(song.id);

  document.getElementById('npEmpty').style.display = 'none';
  document.getElementById('npContent').classList.add('show');
  document.getElementById('npThumb').src = song.thumbnail_url;
  document.getElementById('npTitle').textContent = song.title || 'Untitled';
  document.getElementById('npArtist').textContent = song.artist || 'Anonymous';
  const creditsCard = document.getElementById('npCreditsCard');
  const creditsAuthor = document.getElementById('npCreditsAuthor');
  if (creditsAuthor) creditsAuthor.textContent = song.artist || 'Anonymous';
  if (creditsCard) creditsCard.style.display = 'block';
  updateNowPlayingPanelVisibility(currentView);
  // Mirror the same info into the persistent bottom player bar.
  const sbThumb = document.getElementById('sbThumb');
  const sbTitle = document.getElementById('sbTitle');
  const sbArtist = document.getElementById('sbArtist');
  if (sbThumb) sbThumb.src = song.thumbnail_url;
  if (sbTitle) sbTitle.textContent = song.title || 'Untitled';
  if (sbArtist) sbArtist.textContent = song.artist || 'Anonymous';
  const bar = document.getElementById('spotifyBar');
  if (bar) bar.classList.add('show');
  document.body.classList.add('has-player-bar');
  setLibPlayIcon(true);
  // Playing a song can change which 2 songs are "recently played", so the
  // featured cards may need to shuffle — a full re-render handles that;
  // otherwise just flip the play state on the existing markup.
  if (libLoaded) renderLibGrid(); else updateLibGridPlayingState();
  // renderLibGrid() only touches the Library view's own elements — also sync
  // play/pause state onto any other .lib-playable-item rows on screen right
  // now, e.g. the Search page's result rows.
  updateLibGridPlayingState();
  // renderLibGrid only touches the Library page's own grid/list — make sure
  // any playable items rendered elsewhere (e.g. Explore's cards & rows)
  // reflect the new playing state too.
  updateLibGridPlayingState();
  updateNpQueueCard();
  if (typeof renderSpotlightCard === 'function') renderSpotlightCard();
}
// Shows the song that will play next (wraps to the start of the library),
// mirroring the same "next" logic used by playNextLibSong().
function updateNpQueueCard() {
  const card = document.getElementById('npQueueCard');
  if (!card) return;
  if (libCurrentIndex === null || !libSongsCache.length) {
    card.style.display = 'none';
    return;
  }
  // With only one song in the library, "next" just loops back to itself.
  const nextIndex = libSongsCache.length > 1 ? (libCurrentIndex + 1) % libSongsCache.length : libCurrentIndex;
  const nextSong = libSongsCache[nextIndex];
  if (!nextSong) { card.style.display = 'none'; return; }
  libQueueNextIndex = nextIndex;

  card.style.display = 'block';
  document.getElementById('npQueueThumb').src = nextSong.thumbnail_url || '';
  document.getElementById('npQueueTitle').textContent = nextSong.title || 'Untitled';
  document.getElementById('npQueueAuthor').textContent = nextSong.artist || 'Anonymous';

  const durEl = document.getElementById('npQueueDuration');
  if (nextSong._durationText) {
    durEl.textContent = nextSong._durationText;
  } else {
    durEl.textContent = '--:--';
    if (nextSong.music_url) {
      const probe = new Audio();
      probe.preload = 'metadata';
      probe.src = nextSong.music_url;
      probe.addEventListener('loadedmetadata', () => {
        nextSong._durationText = formatLibTime(probe.duration);
        if (document.getElementById('npQueueThumb')?.src === (nextSong.thumbnail_url || '')) {
          durEl.textContent = nextSong._durationText;
        }
      });
      probe.addEventListener('error', () => { durEl.textContent = '--:--'; });
    }
  }
}
function toggleLibPlayback() {
  const audio = document.getElementById('libAudio');
  if (!libCurrentSong) return;
  if (audio.paused) { audio.play(); libIsPlaying = true; setLibPlayIcon(true); }
  else { audio.pause(); libIsPlaying = false; setLibPlayIcon(false); }
  updateLibGridPlayingState();
}
function playPrevLibSong() {
  if (libCurrentIndex === null || !libSongsCache.length) return;
  const prevIndex = (libCurrentIndex - 1 + libSongsCache.length) % libSongsCache.length;
  playLibSong(prevIndex);
}
function playNextLibSong() {
  if (libCurrentIndex === null || !libSongsCache.length) return;
  let nextIndex;
  if (libPlayMode === 'shuffle' && libSongsCache.length > 1) {
    do {
      nextIndex = Math.floor(Math.random() * libSongsCache.length);
    } while (nextIndex === libCurrentIndex);
  } else {
    nextIndex = (libCurrentIndex + 1) % libSongsCache.length;
  }
  playLibSong(nextIndex);
}
// Hovering the "next in queue" thumbnail reveals a play button that jumps
// straight to that song instead of waiting for the current one to finish.
function playQueuedNextSong() {
  if (libQueueNextIndex === null || !libSongsCache.length) return;
  playLibSong(libQueueNextIndex);
}

// ── Playback mode (bottom bar) ──
// Cycles sequential -> shuffle -> manual -> sequential.
const LIB_PLAY_MODE_ICONS = {
  sequential: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 6h1.972a4 4 0 0 1 3.6 2.2"/><path d="M2 18h1.973a4 4 0 0 0 3.3-1.7l5.454-8.6a4 4 0 0 1 3.3-1.7H22"/><path d="m18 2 4 4-4 4"/><path d="m18 14 4 4-4 4"/><path d="M22 18h-6.041a4 4 0 0 1-3.3-1.8l-.359-.45"/></svg>',
  shuffle: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m18 14 4 4-4 4"/><path d="m18 2 4 4-4 4"/><path d="M2 18h1.973a4 4 0 0 0 3.3-1.7l5.454-8.6a4 4 0 0 1 3.3-1.7H22"/><path d="M2 6h1.972a4 4 0 0 1 3.6 2.2"/><path d="M22 18h-6.041a4 4 0 0 1-3.3-1.8l-.359-.45"/></svg>',
  manual: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 12.5V10a2 2 0 0 0-2-2a2 2 0 0 0-2 2v1.4"/><path d="M14 11V9a2 2 0 1 0-4 0v2"/><path d="M10 10.5V5a2 2 0 1 0-4 0v9"/><path d="m7 15-1.76-1.76a2 2 0 0 0-2.83 2.82l3.6 3.6C7.5 21.14 9.2 22 12 22h2a8 8 0 0 0 8-8V7a2 2 0 1 0-4 0v5"/></svg>'
};
const LIB_PLAY_MODE_TITLES = { sequential: 'Play mode: Sequential', shuffle: 'Play mode: Shuffle', manual: 'Play mode: Manual' };
function toggleLibPlayMode() {
  libPlayMode = libPlayMode === 'sequential' ? 'shuffle' : libPlayMode === 'shuffle' ? 'manual' : 'sequential';
  updatePlayModeIcon();
  updateNextQueueCard();
}
function updatePlayModeIcon() {
  const iconEl = document.getElementById('sbPlayModeIcon');
  const btn = document.getElementById('sbPlayMode');
  if (iconEl) iconEl.innerHTML = LIB_PLAY_MODE_ICONS[libPlayMode];
  if (btn) {
    btn.classList.toggle('active', libPlayMode !== 'sequential');
    btn.title = LIB_PLAY_MODE_TITLES[libPlayMode];
  }
}

// ── Repeat mode (bottom bar) ──
// Cycles off -> repeat-one -> repeat-all -> off.
const LIB_REPEAT_ICONS = {
  off: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11.656 6H21l-4-4"/><path d="M17.898 17.898A4 4 0 0 1 17 18H3l4-4"/><path d="m2 2 20 20"/><path d="M21 13v1a4 4 0 0 1-.171 1.159"/><path d="m21 6-4 4"/><path d="M3 11v-1a4 4 0 0 1 3.102-3.898"/><path d="m7 22-4-4"/></svg>',
  one: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/><path d="M11 10h1v4"/></svg>',
  all: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/></svg>'
};
const LIB_REPEAT_TITLES = { off: 'Repeat: Off', one: 'Repeat: One', all: 'Repeat: All' };
function toggleLibRepeatMode() {
  libRepeatMode = libRepeatMode === 'off' ? 'one' : libRepeatMode === 'one' ? 'all' : 'off';
  updateRepeatIcon();
}
function updateRepeatIcon() {
  const iconEl = document.getElementById('sbRepeatIcon');
  const btn = document.getElementById('sbRepeat');
  if (iconEl) iconEl.innerHTML = LIB_REPEAT_ICONS[libRepeatMode];
  if (btn) {
    btn.classList.toggle('active', libRepeatMode !== 'off');
    btn.title = LIB_REPEAT_TITLES[libRepeatMode];
  }
}
function setLibPlayIcon(playing) {
  const iconPath = playing
    ? '<path d="M6 5h4v14H6zM14 5h4v14h-4z"/>'
    : '<path d="M8 5v14l11-7z"/>';
  const icon = document.getElementById('npIcon');
  if (icon) icon.innerHTML = iconPath;
  const sbIcon = document.getElementById('sbIcon');
  if (sbIcon) sbIcon.innerHTML = iconPath;
}
function formatLibTime(s) {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60).toString().padStart(2, '0');
  return `${m}:${sec}`;
}
function seekLibPlayback(val) {
  const audio = document.getElementById('libAudio');
  const seekEl = document.getElementById('npSeek');
  if (seekEl) seekEl.style.setProperty('--sb-seek-pct', val + '%');
  if (!audio.duration) return;
  audio.currentTime = (val / 100) * audio.duration;
}
// SVG path markup (inner contents only) for the three volume icon states.
const SB_VOL_ICON_PATHS = {
  high: '<path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z"/><path d="M16 9a5 5 0 0 1 0 6"/><path d="M19.364 18.364a9 9 0 0 0 0-12.728"/>',
  low: '<path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z"/><path d="M16 9a5 5 0 0 1 0 6"/>',
  mute: '<path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z"/><line x1="22" x2="16" y1="9" y2="15"/><line x1="16" x2="22" y1="9" y2="15"/>'
};
// Swap the volume icon (high / low / muted) based on the current level.
function updateLibVolumeIcon(val) {
  const iconEl = document.getElementById('sbVolIcon');
  if (!iconEl) return;
  const level = Number(val);
  const key = level <= 0 ? 'mute' : (level < 50 ? 'low' : 'high');
  iconEl.innerHTML = SB_VOL_ICON_PATHS[key];
}
// Volume slider (0-100) for the bottom player bar.
function setLibVolume(val) {
  const audio = document.getElementById('libAudio');
  if (audio) audio.volume = Math.max(0, Math.min(100, val)) / 100;
  const volEl = document.getElementById('sbVolume');
  if (volEl) volEl.style.setProperty('--sb-vol-pct', val + '%');
  updateLibVolumeIcon(val);
}
// Lets the user pick where audio plays back. Tries, in order:
//   1) Chrome/Edge's native output-device picker (navigator.mediaDevices
//      .selectAudioOutput) — this lists real OS-level devices, including any
//      Bluetooth speaker/headset already paired, plus wired/built-in outputs.
//   2) Safari's AirPlay target picker.
//   3) The Remote Playback API (Chromecast-style casting).
//   4) A built-in fallback menu built from enumerateDevices()+setSinkId(),
//      for browsers that support switching output but not a native picker.
async function connectToDevice() {
  const audio = document.getElementById('libAudio');
  const btn = document.getElementById('sbDeviceBtn');
  if (!audio) return;

  // If the menu is already open, a second click on the button should close
  // it instead of re-opening/re-rendering it.
  const existingMenu = document.getElementById('sbDeviceMenu');
  if (existingMenu && existingMenu.style.display !== 'none') {
    closeSbDeviceMenu();
    return;
  }

  // Running in Electron (Chromium): webkitShowPlaybackTargetPicker (Safari
  // AirPlay) and audio.remote.prompt() (Remote Playback API) don't exist
  // here, and navigator.mediaDevices.selectAudioOutput() is unreliable under
  // Electron's permission model — it depends on webPreferences/permission
  // handlers in the main process and throws inconsistently even when devices
  // are available. Go straight to the custom enumerateDevices + setSinkId
  // menu, which works deterministically once 'media' permission is granted
  // from the main process (see setPermissionRequestHandler).
  if (navigator.mediaDevices && typeof navigator.mediaDevices.enumerateDevices === 'function' && typeof audio.setSinkId === 'function') {
    await openSbDeviceMenu(btn);
    return;
  }

  alert("Your browser doesn't support choosing an audio output device from this page.");
}

// Skeleton rows shown inside the device menu the instant it opens, while
// enumerateDevices()/getUserMedia() are still resolving in the background.
function sbDeviceSkeletonRowsHtml(n) {
  let out = '';
  for (let i = 0; i < n; i++) {
    out += `<div class="sb-device-item-skel"><div class="skel-dot"></div><div class="skel-line"></div></div>`;
  }
  return out;
}

// Builds and shows the fallback device-picker menu, listing every audio
// output device available at the OS level (speakers, wired headphones,
// paired Bluetooth headsets/speakers, etc).
async function openSbDeviceMenu(btn) {
  const menu = document.getElementById('sbDeviceMenu');
  if (!menu || !btn) return;

  menu.innerHTML = `<div class="sb-device-menu-label">Play audio on</div>` +
    sbDeviceSkeletonRowsHtml(3);
  positionSbDeviceMenu(menu, btn);
  menu.style.display = 'block';

  let devices = await navigator.mediaDevices.enumerateDevices();
  let outputs = devices.filter(d => d.kind === 'audiooutput');

  // Device labels stay blank until the page has had mic/audio permission at
  // least once — request it briefly so real device names (Bluetooth headset
  // names, etc) can be shown, then immediately release the mic.
  if (outputs.some(d => !d.label)) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(t => t.stop());
      devices = await navigator.mediaDevices.enumerateDevices();
      outputs = devices.filter(d => d.kind === 'audiooutput');
    } catch (err) {
      console.warn('Permission to list device names was denied', err);
    }
  }

  renderSbDeviceMenu(outputs);
  // Content just grew from the placeholder to the real device list, so
  // re-run positioning against the final height/width.
  positionSbDeviceMenu(menu, btn);
}

function positionSbDeviceMenu(menu, btn) {
  const bar = document.getElementById('spotifyBar');
  const barRect = bar ? bar.getBoundingClientRect() : btn.getBoundingClientRect();
  const btnRect = btn.getBoundingClientRect();
  menu.style.visibility = 'hidden';
  menu.style.display = 'block';
  const menuH = menu.offsetHeight || 160;
  const menuW = menu.offsetWidth || 240;
  // Always anchor above the bottom player bar (never below it, where it'd be
  // hidden behind/under the bar), clamped so it never runs off the top edge.
  let top = barRect.top - menuH - 10;
  if (top < 8) top = 8;
  let left = btnRect.left - menuW / 2;
  left = Math.max(8, Math.min(left, window.innerWidth - menuW - 8));
  menu.style.top = top + 'px';
  menu.style.left = left + 'px';
  menu.style.visibility = 'visible';
}

function renderSbDeviceMenu(outputs) {
  const menu = document.getElementById('sbDeviceMenu');
  const audio = document.getElementById('libAudio');
  if (!menu) return;
  menu.innerHTML = '';

  const label = document.createElement('div');
  label.className = 'sb-device-menu-label';
  label.textContent = 'Play audio on';
  menu.appendChild(label);

  if (!outputs.length) {
    const empty = document.createElement('div');
    empty.className = 'sb-device-menu-empty';
    empty.textContent = 'No output devices found nearby.';
    menu.appendChild(empty);
    return;
  }

  const currentSinkId = (audio && audio.sinkId) || '';
  outputs.forEach(dev => {
    const item = document.createElement('button');
    const isActive = dev.deviceId === currentSinkId || (!currentSinkId && dev.deviceId === 'default');
    item.className = 'sb-device-item' + (isActive ? ' active' : '');
    const isBluetooth = /bluetooth|airpods|headset|wireless/i.test(dev.label || '');
    const icon = isBluetooth
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m7 7 10 10-5 5V2l5 5L7 17"/></svg>'
      : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="2" width="16" height="20" rx="2"/><circle cx="12" cy="18" r="1"/></svg>';
    item.innerHTML = `${icon}<span>${(dev.label || 'Audio device').replace(/</g, '&lt;')}</span><svg class="sb-device-item-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
    item.onclick = () => { applySbAudioDevice(dev.deviceId, dev.label || 'Audio device'); closeSbDeviceMenu(); };
    menu.appendChild(item);
  });
}

// Actually switches playback to the chosen device via setSinkId, and updates
// the button's appearance/tooltip to reflect what's currently connected.
async function applySbAudioDevice(deviceId, label) {
  const audio = document.getElementById('libAudio');
  const btn = document.getElementById('sbDeviceBtn');
  if (!audio) return;
  try {
    if (typeof audio.setSinkId === 'function') {
      await audio.setSinkId(deviceId);
    }
    if (btn) {
      btn.classList.add('sb-device-active');
      btn.title = `Playing on ${label}`;
    }
  } catch (err) {
    console.warn('Could not switch playback to that device', err);
    alert("Couldn't connect to that device. It may be unavailable right now.");
  }
}

function closeSbDeviceMenu() {
  const menu = document.getElementById('sbDeviceMenu');
  if (menu) menu.style.display = 'none';
}

document.addEventListener('click', (e) => {
  const menu = document.getElementById('sbDeviceMenu');
  const btn = document.getElementById('sbDeviceBtn');
  if (!menu || menu.style.display === 'none') return;
  if (menu.contains(e.target) || (btn && btn.contains(e.target))) return;
  closeSbDeviceMenu();
});
function updateNowPlayingPanelVisibility(view) {
  const panel = document.getElementById('nowPlayingPanel');
  if (!panel) return;
  // Explore now goes full-width Spotify-style (no side now-playing panel);
  // Profile keeps it, matching library/favourites.
  const showOn = ['library', 'favourites', 'profile'];
  // Only show the panel/tab at all once something has actually been loaded
  // into it (npContent has the 'show' class) — no more "Nothing's playing
  // right now" placeholder; if there's nothing to show, the tab itself is hidden.
  const npContent = document.getElementById('npContent');
  const hasSong = !!(npContent && npContent.classList.contains('show'));
  const isOpen = showOn.includes(view) && hasSong;
  panel.classList.toggle('show', isOpen);
  // Keep .main in sync so it reserves space for the fixed-width panel and never overlaps it.
  const main = document.getElementById('mainArea');
  if (main) main.classList.toggle('np-open', isOpen);
}
(function bindLibAudioEvents() {
  document.addEventListener('DOMContentLoaded', () => {
    const audio = document.getElementById('libAudio');
    if (!audio) return;
    // Show the last played song in the bottom bar right away, paused, before
    // the library table has even loaded.
    hydrateLibBarFromStorage();
    audio.addEventListener('timeupdate', () => {
      if (!audio.duration) return;
      // The seek/timer row was moved out of this panel; these elements may not
      // exist here anymore, but are guarded in case they're added elsewhere.
      const curEl = document.getElementById('npCur');
      const durEl = document.getElementById('npDur');
      const seekEl = document.getElementById('npSeek');
      if (curEl) curEl.textContent = formatLibTime(audio.currentTime);
      if (durEl) durEl.textContent = formatLibTime(audio.duration);
      if (seekEl) {
        const pct = (audio.currentTime / audio.duration) * 100;
        seekEl.value = pct;
        seekEl.style.setProperty('--sb-seek-pct', pct + '%');
      }
    });
    audio.addEventListener('ended', () => {
      libIsPlaying = false; setLibPlayIcon(false); updateLibGridPlayingState();
      if (!libSongsCache.length) return;
      if (libRepeatMode === 'one') {
        // Repeat the current song exactly once, then fall back to normal playback.
        libRepeatMode = 'off';
        updateRepeatIcon();
        audio.currentTime = 0;
        audio.play().catch(err => console.warn('Playback failed', err));
        libIsPlaying = true;
        setLibPlayIcon(true);
        updateLibGridPlayingState();
      } else if (libRepeatMode === 'all') {
        // Keep repeating the current song until stopped or switched.
        audio.currentTime = 0;
        audio.play().catch(err => console.warn('Playback failed', err));
        libIsPlaying = true;
        setLibPlayIcon(true);
        updateLibGridPlayingState();
      } else if (libPlayMode === 'manual') {
        // Manual mode: stop after the current song; the user chooses when to play next.
        updateNextQueueCard();
      } else {
        // Sequential or shuffle mode: auto-advance.
        playNextLibSong();
      }
    });
    updatePlayModeIcon();
    updateRepeatIcon();
    // Start at full volume and keep the bar's slider fill in sync.
    audio.volume = 1;
    const volEl = document.getElementById('sbVolume');
    if (volEl) volEl.style.setProperty('--sb-vol-pct', '100%');

    // Spotify-style hover preview: track the cursor position over the seek
    // bar and light up the stretch between the current playhead and the
    // cursor a bit brighter than the dim base track.
    const seekBar = document.getElementById('npSeek');
    if (seekBar) {
      seekBar.addEventListener('mousemove', (e) => {
        const rect = seekBar.getBoundingClientRect();
        const hoverPct = Math.min(100, Math.max(0, ((e.clientX - rect.left) / rect.width) * 100));
        // Never let the preview sit behind the actual playhead — only the
        // stretch ahead of what's already played should brighten up.
        const currentPct = parseFloat(seekBar.value) || 0;
        const previewPct = Math.max(hoverPct, currentPct);
        seekBar.style.setProperty('--sb-preview-pct', previewPct + '%');
      });
      seekBar.addEventListener('mouseleave', () => {
        seekBar.style.removeProperty('--sb-preview-pct');
      });
    }
  });
})();

// ── PRESENCE SYSTEM ──
// Uses broadcast heartbeats instead of Supabase Presence to get instant
// online/offline detection. Each user pings their own channel every 5s while
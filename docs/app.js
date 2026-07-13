// Photo Finder — fully client-side (GitHub Pages) build.
// Photos live in this browser's IndexedDB; Claude is called directly from the
// browser with the user's own key (stored in localStorage only).

// ---- tiny helpers ------------------------------------------------------
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.add('hidden'), 3000);
}
function esc(s) { return (s ?? '').toString().replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function fmtDate(iso) { if (!iso) return ''; const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); }
function newId(p = 'id') { return `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`; }

// ---- settings (localStorage) ------------------------------------------
const LS_KEY = 'pf_apikey', LS_MODEL = 'pf_model';
const getKey = () => localStorage.getItem(LS_KEY) || '';
const getModel = () => localStorage.getItem(LS_MODEL) || 'claude-opus-4-8';
const hasKey = () => Boolean(getKey());

// ---- IndexedDB ---------------------------------------------------------
let _db;
function db() {
  if (_db) return _db;
  _db = new Promise((resolve, reject) => {
    const req = indexedDB.open('photofinder', 1);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains('photos')) d.createObjectStore('photos', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return _db;
}
async function req(store, mode, method, ...args) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const r = d.transaction(store, mode).objectStore(store)[method](...args);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
const idbGetAll = (store) => req(store, 'readonly', 'getAll');
const idbGet = (store, key) => req(store, 'readonly', 'get', key);
const idbPut = (store, val, key) => key === undefined
  ? req(store, 'readwrite', 'put', val)
  : req(store, 'readwrite', 'put', val, key);
const idbDel = (store, key) => req(store, 'readwrite', 'delete', key);

const kvGet = async (k, def = null) => { const v = await idbGet('kv', k); return v === undefined ? def : v; };
const kvSet = (k, v) => idbPut('kv', v, k);

// ---- object URL cache for image blobs ---------------------------------
const urlCache = new Map();
function urlFor(photo) {
  if (!urlCache.has(photo.id)) urlCache.set(photo.id, URL.createObjectURL(photo.blob));
  return urlCache.get(photo.id);
}
function dropUrl(id) { const u = urlCache.get(id); if (u) { URL.revokeObjectURL(u); urlCache.delete(id); } }

// ---- Claude (direct from browser) -------------------------------------
async function claudeCreate({ system, messages, schema, maxTokens = 4000 }) {
  if (!hasKey()) throw new Error('NO_API_KEY');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': getKey(),
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: getModel(),
      max_tokens: maxTokens,
      system,
      messages,
      output_config: { format: { type: 'json_schema', schema } },
    }),
  });
  if (!res.ok) {
    let detail = `${res.status}`;
    try { const j = await res.json(); detail = j.error?.message || JSON.stringify(j); } catch { /* text */ }
    throw new Error(detail);
  }
  const data = await res.json();
  const text = (data.content || []).find((b) => b.type === 'text')?.text ?? '{}';
  return JSON.parse(text);
}
const claudeJSON = ({ system, content, schema, maxTokens }) =>
  claudeCreate({ system, messages: [{ role: 'user', content }], schema, maxTokens });

// ---- schemas -----------------------------------------------------------
const ANALYSIS_SCHEMA = {
  type: 'object',
  properties: {
    caption: { type: 'string' }, description: { type: 'string' }, setting: { type: 'string' },
    location_guess: { type: 'string' }, people_count: { type: 'integer' },
    people: { type: 'array', items: { type: 'object', properties: { description: { type: 'string' }, approx_age: { type: 'string' }, role_guess: { type: 'string' } }, required: ['description', 'approx_age', 'role_guess'], additionalProperties: false } },
    objects: { type: 'array', items: { type: 'string' } }, activities: { type: 'array', items: { type: 'string' } },
    mood: { type: 'string' }, estimated_era: { type: 'string' }, is_scanned_photo: { type: 'boolean' },
    tags: { type: 'array', items: { type: 'string' } }, nostalgia_score: { type: 'integer' },
  },
  required: ['caption', 'description', 'setting', 'location_guess', 'people_count', 'people', 'objects', 'activities', 'mood', 'estimated_era', 'is_scanned_photo', 'tags', 'nostalgia_score'],
  additionalProperties: false,
};
const PROFILE_SCHEMA = {
  type: 'object',
  properties: {
    reply: { type: 'string' }, is_complete: { type: 'boolean' },
    profile: { type: 'object', properties: {
      name: { type: 'string' }, summary: { type: 'string' },
      family: { type: 'array', items: { type: 'string' } }, friends: { type: 'array', items: { type: 'string' } },
      pets: { type: 'array', items: { type: 'string' } }, places_lived: { type: 'array', items: { type: 'string' } },
      schools: { type: 'array', items: { type: 'string' } }, hobbies: { type: 'array', items: { type: 'string' } },
      notable_events: { type: 'array', items: { type: 'string' } }, notes: { type: 'array', items: { type: 'string' } },
    }, required: ['name', 'summary', 'family', 'friends', 'pets', 'places_lived', 'schools', 'hobbies', 'notable_events', 'notes'], additionalProperties: false },
  },
  required: ['reply', 'is_complete', 'profile'],
  additionalProperties: false,
};
const SEARCH_SCHEMA = {
  type: 'object',
  properties: {
    answer: { type: 'string' },
    results: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, score: { type: 'integer' }, reason: { type: 'string' } }, required: ['id', 'score', 'reason'], additionalProperties: false } },
  },
  required: ['answer', 'results'], additionalProperties: false,
};
const MEMORY_SCHEMA = {
  type: 'object',
  properties: { title: { type: 'string' }, narrative: { type: 'string' }, photo_ids: { type: 'array', items: { type: 'string' } } },
  required: ['title', 'narrative', 'photo_ids'], additionalProperties: false,
};

// ---- profile summary helper -------------------------------------------
function profileSummary(profile) {
  if (!profile) return '';
  const lines = [];
  if (profile.name) lines.push(`Name: ${profile.name}`);
  if (profile.summary) lines.push(profile.summary);
  const list = (label, arr) => { if (arr?.length) lines.push(`${label}: ${arr.join(', ')}`); };
  list('Family', profile.family); list('Friends', profile.friends); list('Pets', profile.pets);
  list('Places lived', profile.places_lived); list('Schools', profile.schools);
  list('Hobbies', profile.hobbies); list('Notable events', profile.notable_events); list('Notes', profile.notes);
  return lines.join('\n');
}
function photoCard(p) {
  const a = p.analysis || {};
  return {
    id: p.id, date: p.takenAt || p.uploadedAt || null,
    named_people: (p.people || []).map((id) => PEOPLE.find((x) => x.id === id)?.name).filter(Boolean),
    caption: a.caption, description: a.description, setting: a.setting, location: a.location_guess,
    people_count: a.people_count, people: a.people, objects: a.objects, activities: a.activities,
    mood: a.mood, era: a.estimated_era, tags: a.tags, nostalgia: a.nostalgia_score,
  };
}

// ---- AI operations -----------------------------------------------------
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result.split(',')[1]);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}
async function analyzePhoto(photo, profile) {
  const base64 = await blobToBase64(photo.blob);
  const system =
    'You are an expert photo archivist helping someone catalogue their personal photo library so it becomes searchable by memory. ' +
    'Look carefully at the image and produce accurate, specific metadata. Note ages of people (this helps identify the same person across years — e.g. "the subject as a baby in a pram"). ' +
    'Be concrete about objects, clothing, and settings, since people search using these details. Never invent identities you cannot see.' +
    (profile ? `\n\nContext about the library owner (use only if clearly relevant):\n${profileSummary(profile)}` : '');
  const content = [
    { type: 'image', source: { type: 'base64', media_type: photo.mediaType, data: base64 } },
    { type: 'text', text: 'Analyse this photograph and return the structured metadata.' },
  ];
  return claudeJSON({ system, content, schema: ANALYSIS_SCHEMA, maxTokens: 2000 });
}
async function onboardingTurn(history, currentProfile) {
  const system =
    'You are a warm, curious interviewer helping someone set up a personal photo-memory app. ' +
    'Your job is to spend about five minutes getting to know them so their photos can be understood in context. ' +
    'Ask about: their name, close family and their names, childhood homes and places they have lived, schools, best friends, pets, hobbies, and a few memorable life events. ' +
    'Ask ONE friendly question at a time and react naturally to their answers. Keep the running profile up to date on every turn, merging new facts with what you already know. ' +
    'After you have a solid picture, set is_complete to true and give a warm closing message. Always return the full, updated profile object.';
  const messages = [];
  if (history.length === 0) {
    messages.push({ role: 'user', content: "Let's start. Please introduce yourself and ask your first question." });
  } else {
    if (currentProfile) {
      messages.push({ role: 'user', content: `Profile so far (JSON): ${JSON.stringify(currentProfile)}` });
      messages.push({ role: 'assistant', content: 'Understood, I have the profile so far.' });
    }
    for (const m of history) messages.push({ role: m.role, content: m.content });
  }
  return claudeCreate({ system, messages, schema: PROFILE_SCHEMA, maxTokens: 2000 });
}
async function runSearch(query, photos, profile) {
  const catalog = photos.map(photoCard);
  const system =
    'You help someone find photos in their personal library using natural language. ' +
    'You are given a catalogue of analysed photos and the user\'s query. Pick the photos that best match, considering people, ages, places, objects, activities, era and mood. ' +
    'Use the owner profile to resolve references like "me", "my brother", or the name of a place they lived. ' +
    'Only include photos with a genuine match (score 40+). Order by score, best first. If nothing matches, return an empty results list and say so kindly.' +
    (profile ? `\n\nOwner profile:\n${profileSummary(profile)}` : '');
  return claudeJSON({ system, content: [{ type: 'text', text: `User query: "${query}"\n\nPhoto catalogue (JSON):\n${JSON.stringify(catalog)}` }], schema: SEARCH_SCHEMA, maxTokens: 3000 });
}
async function makeMemory(prompt, photos, profile) {
  const catalog = photos.map(photoCard);
  const system =
    'You are a thoughtful memory curator. From the user\'s photo catalogue, assemble ONE evocative memory collection matching their request ' +
    '(for example "memories with friends", "childhood", "holidays by the sea"). Choose 4-15 of the most fitting, nostalgic photos, give the collection a lovely title, ' +
    'and write a short warm narrative. Prefer higher nostalgia_score photos and a coherent theme. Use the owner profile to understand references.' +
    (profile ? `\n\nOwner profile:\n${profileSummary(profile)}` : '');
  return claudeJSON({ system, content: [{ type: 'text', text: `Request: "${prompt}"\n\nPhoto catalogue (JSON):\n${JSON.stringify(catalog)}` }], schema: MEMORY_SCHEMA, maxTokens: 2000 });
}

// ---- app state ---------------------------------------------------------
let PHOTOS = [];
let PEOPLE = [];

async function loadState() {
  PHOTOS = (await idbGetAll('photos')) || [];
  PHOTOS.sort((a, b) => ((b.takenAt || b.uploadedAt) || '').localeCompare((a.takenAt || a.uploadedAt) || ''));
  PEOPLE = (await kvGet('people', [])) || [];
}

// ---- analysis queue ----------------------------------------------------
let running = false;
async function processQueue() {
  if (running || !hasKey()) return;
  running = true;
  try {
    const profile = await kvGet('profile', null);
    while (hasKey()) {
      const photo = PHOTOS.find((p) => p.status === 'pending');
      if (!photo) break;
      photo.status = 'analyzing';
      await idbPut('photos', photo);
      renderLibrary();
      try {
        photo.analysis = await analyzePhoto(photo, profile);
        photo.status = 'done';
      } catch (err) {
        photo.status = 'error';
        photo.error = err.message;
        if (err.message === 'NO_API_KEY') { await idbPut('photos', photo); break; }
      }
      await idbPut('photos', photo);
      renderLibrary();
      refreshStatus();
    }
  } finally {
    running = false;
    refreshStatus();
  }
}

// ---- status ------------------------------------------------------------
function refreshStatus() {
  const pending = PHOTOS.filter((p) => p.status === 'pending' || p.status === 'analyzing').length;
  const done = PHOTOS.filter((p) => p.status === 'done').length;
  const dot = hasKey() ? (pending ? 'busy' : 'ok') : 'warn';
  let text;
  if (!hasKey()) text = 'No API key — add one in Settings';
  else if (pending) text = `Analysing ${pending} photo(s)…`;
  else text = `${done} photos understood`;
  $('#status').innerHTML = `<span class="dot ${dot}"></span>${esc(text)}`;
  $('#key-banner').classList.toggle('hidden', hasKey());
}

// ---- tabs --------------------------------------------------------------
$('#tabs').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-tab]');
  if (!btn) return;
  showTab(btn.dataset.tab);
});
function showTab(name) {
  $$('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  $$('.tab').forEach((t) => t.classList.toggle('active', t.id === name));
  if (name === 'people') renderPeople();
  if (name === 'memories') renderMemories();
  if (name === 'about') renderOnboarding();
}
$('#key-banner-btn').addEventListener('click', () => showTab('settings'));

// ---- library + upload --------------------------------------------------
function photoCardHTML(p, extra = '') {
  const a = p.analysis || {};
  const pending = p.status !== 'done';
  const label = pending
    ? `<div class="spinner">${p.status === 'error' ? '⚠︎ failed' : (hasKey() ? 'reading…' : 'needs key')}</div>`
    : `<div class="overlay">${esc(a.caption || '')}</div>`;
  const era = a.estimated_era ? `<span class="badge">${esc(a.estimated_era)}</span>` : '';
  return `<div class="card-photo ${pending ? 'pending' : ''}" data-id="${p.id}">
    <img src="${urlFor(p)}" loading="lazy" alt="${esc(a.caption || '')}" />
    ${era}${p.favorite ? '<span class="fav">♥</span>' : ''}${label}${extra}
  </div>`;
}
function renderLibrary() {
  const grid = $('#grid'); const empty = $('#library-empty');
  if (PHOTOS.length === 0) { grid.innerHTML = ''; empty.classList.remove('hidden'); }
  else { empty.classList.add('hidden'); grid.innerHTML = PHOTOS.map((p) => photoCardHTML(p)).join(''); }
  const done = PHOTOS.filter((p) => p.status === 'done').length;
  $('#library-sub').textContent = PHOTOS.length ? `${PHOTOS.length} photos · ${done} understood by AI` : 'Add the photos from your phone to get started.';
}

const UPLOAD_BATCH = 8;
$('#file-input').addEventListener('change', async (e) => {
  const files = [...e.target.files];
  e.target.value = '';
  if (!files.length) return;
  const prog = $('#upload-progress');
  prog.classList.remove('hidden');
  let done = 0;
  for (let i = 0; i < files.length; i += UPLOAD_BATCH) {
    const slice = files.slice(i, i + UPLOAD_BATCH);
    for (const file of slice) {
      prog.textContent = `Preparing ${done + 1} of ${files.length}…`;
      let blob;
      try { blob = await resizeImage(file); } catch { blob = file; }
      const rec = {
        id: newId('ph'), blob, mediaType: 'image/jpeg', name: file.name || 'photo',
        uploadedAt: new Date().toISOString(), takenAt: null, gps: null,
        status: 'pending', analysis: null, people: [], favorite: false,
      };
      try {
        const meta = await window.exifr?.parse(file, { gps: true }).catch(() => null);
        if (meta?.DateTimeOriginal) rec.takenAt = new Date(meta.DateTimeOriginal).toISOString();
        if (meta?.latitude && meta?.longitude) rec.gps = { lat: meta.latitude, lon: meta.longitude };
      } catch { /* no exif */ }
      await idbPut('photos', rec);
      PHOTOS.unshift(rec);
      done++;
    }
    renderLibrary();
  }
  prog.classList.add('hidden');
  toast(`Added ${done} photo(s).${hasKey() ? ' Analysis is running.' : ' Add a key in Settings to analyse them.'}`);
  refreshStatus();
  processQueue();
});

function resizeImage(file, max = 1600) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width > max || height > max) { const s = max / Math.max(width, height); width = Math.round(width * s); height = Math.round(height * s); }
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      canvas.toBlob((b) => b ? resolve(b) : reject(new Error('encode failed')), 'image/jpeg', 0.88);
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

// ---- lightbox ----------------------------------------------------------
document.addEventListener('click', (e) => {
  const card = e.target.closest('.card-photo');
  if (card) openLightbox(card.dataset.id);
});
$('#lb-close').addEventListener('click', () => $('#lightbox').classList.add('hidden'));
$('#lightbox').addEventListener('click', (e) => { if (e.target.id === 'lightbox') $('#lightbox').classList.add('hidden'); });

function openLightbox(id) {
  const p = PHOTOS.find((x) => x.id === id);
  if (!p) return;
  const a = p.analysis || {};
  $('#lb-img').src = urlFor(p);
  const tags = (a.tags || []).map((t) => `<span class="tag">${esc(t)}</span>`).join('');
  const people = (a.people || []).map((per) => `${esc(per.description)} <span class="muted">(${esc(per.approx_age)})</span>`).join('<br>');
  const opts = PEOPLE.map((per) => `<option value="${per.id}" ${(p.people || []).includes(per.id) ? 'selected' : ''}>${esc(per.name)}</option>`).join('');
  $('#lb-info').innerHTML = `
    <h3>${esc(a.caption || 'Photo')}</h3>
    <p>${esc(a.description || (p.status !== 'done' ? 'Not analysed yet.' : ''))}</p>
    ${a.setting ? `<div class="meta"><b>Setting</b> · ${esc(a.setting)}</div>` : ''}
    ${a.location_guess ? `<div class="meta"><b>Place</b> · ${esc(a.location_guess)}</div>` : ''}
    ${a.estimated_era ? `<div class="meta"><b>Era</b> · ${esc(a.estimated_era)}</div>` : ''}
    ${p.takenAt ? `<div class="meta"><b>Taken</b> · ${fmtDate(p.takenAt)}</div>` : ''}
    ${a.mood ? `<div class="meta"><b>Mood</b> · ${esc(a.mood)}</div>` : ''}
    ${people ? `<div class="meta"><b>People seen</b><br>${people}</div>` : ''}
    <div style="margin:10px 0">${tags}</div>
    ${PEOPLE.length ? `<div class="lb-people"><b class="muted">Tag people (⌘/Ctrl-click for many):</b><select multiple id="lb-people-select">${opts}</select></div>` : '<p class="muted">Add people under the People tab to tag them here.</p>'}
    <div class="lb-actions">
      <button class="btn" id="lb-fav">${p.favorite ? '♥ Favourited' : '♡ Favourite'}</button>
      ${PEOPLE.length ? '<button class="btn primary" id="lb-save-people">Save tags</button>' : ''}
      <button class="btn ghost" id="lb-delete">Delete</button>
    </div>`;
  $('#lightbox').classList.remove('hidden');

  $('#lb-fav').onclick = async () => { p.favorite = !p.favorite; await idbPut('photos', p); renderLibrary(); openLightbox(id); };
  $('#lb-delete').onclick = async () => {
    if (!confirm('Delete this photo?')) return;
    await idbDel('photos', id); dropUrl(id);
    PHOTOS = PHOTOS.filter((x) => x.id !== id);
    $('#lightbox').classList.add('hidden'); renderLibrary(); refreshStatus();
  };
  const saveBtn = $('#lb-save-people');
  if (saveBtn) saveBtn.onclick = async () => {
    p.people = [...$('#lb-people-select').selectedOptions].map((o) => o.value);
    await idbPut('photos', p); toast('People tags saved');
  };
}

// ---- search ------------------------------------------------------------
const SEARCH_CHIPS = ['the photo where I was in a pram', 'me and my friends', 'holidays by the sea', 'birthdays', 'photos from the 90s', 'with my pet'];
$('#search-chips').innerHTML = SEARCH_CHIPS.map((c) => `<span class="chip">${esc(c)}</span>`).join('');
$('#search-chips').addEventListener('click', (e) => { if (e.target.classList.contains('chip')) { $('#search-input').value = e.target.textContent; $('#search-form').requestSubmit(); } });
$('#search-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const query = $('#search-input').value.trim();
  if (!query) return;
  if (!hasKey()) { toast('Add your Claude API key in Settings first.'); return; }
  const ans = $('#search-answer'), results = $('#search-results');
  const analysed = PHOTOS.filter((p) => p.status === 'done' && p.analysis);
  if (!analysed.length) { ans.classList.remove('hidden'); ans.textContent = 'No analysed photos yet — add some first.'; return; }
  ans.classList.remove('hidden'); ans.textContent = 'Looking through your photos…'; results.innerHTML = '';
  try {
    const data = await runSearch(query, analysed, await kvGet('profile', null));
    ans.textContent = data.answer || '';
    const byId = new Map(PHOTOS.map((p) => [p.id, p]));
    results.innerHTML = (data.results || []).filter((r) => byId.has(r.id)).map((r) =>
      photoCardHTML(byId.get(r.id), `<span class="score">${r.score}</span><div class="overlay">${esc(r.reason)}</div>`)
    ).join('') || '<p class="muted">No matches — try describing it differently.</p>';
  } catch (err) { ans.textContent = 'Search failed: ' + err.message; }
});

// ---- memories ----------------------------------------------------------
const MEM_CHIPS = ['memories with friends', 'childhood summers', 'family gatherings', 'my happiest moments', 'holidays'];
$('#memory-chips').innerHTML = MEM_CHIPS.map((c) => `<span class="chip">${esc(c)}</span>`).join('');
$('#memory-chips').addEventListener('click', (e) => { if (e.target.classList.contains('chip')) { $('#memory-input').value = e.target.textContent; $('#memory-form').requestSubmit(); } });
$('#memory-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const prompt = $('#memory-input').value.trim();
  if (!prompt) return;
  if (!hasKey()) { toast('Add your Claude API key in Settings first.'); return; }
  const analysed = PHOTOS.filter((p) => p.status === 'done' && p.analysis);
  if (!analysed.length) { toast('No analysed photos yet.'); return; }
  toast('Gathering your memory…');
  try {
    const mem = await makeMemory(prompt, analysed, await kvGet('profile', null));
    const byId = new Map(PHOTOS.map((p) => [p.id, p]));
    const memory = {
      id: newId('mem'), createdAt: new Date().toISOString(), prompt,
      title: mem.title, narrative: mem.narrative,
      photoIds: (mem.photo_ids || []).filter((id) => byId.has(id)),
    };
    const memories = await kvGet('memories', []);
    memories.unshift(memory);
    await kvSet('memories', memories);
    $('#memory-input').value = '';
    renderMemories();
  } catch (err) { toast('Failed: ' + err.message); }
});
async function renderMemories() {
  const memories = await kvGet('memories', []);
  const byId = new Map(PHOTOS.map((p) => [p.id, p]));
  $('#memories-list').innerHTML = memories.map((m) => `
    <div class="memory">
      <div class="mem-head">
        <div><h3>${esc(m.title)}</h3><p class="narrative">${esc(m.narrative)}</p></div>
        <button class="btn ghost" data-del-mem="${m.id}">✕</button>
      </div>
      <div class="grid">${(m.photoIds || []).filter((id) => byId.has(id)).map((id) => photoCardHTML(byId.get(id))).join('')}</div>
    </div>`).join('') || '<p class="muted">No memories yet — ask for one above.</p>';
  $$('[data-del-mem]').forEach((b) => b.onclick = async () => {
    await kvSet('memories', (await kvGet('memories', [])).filter((m) => m.id !== b.dataset.delMem));
    renderMemories();
  });
}

// ---- people ------------------------------------------------------------
async function renderPeople() {
  $('#people-list').innerHTML = PEOPLE.map((p) =>
    `<div class="person-tag">${esc(p.name)} <button data-del-person="${p.id}">✕</button></div>`
  ).join('') || '<p class="muted">No people added yet.</p>';
  $$('[data-del-person]').forEach((b) => b.onclick = async () => {
    PEOPLE = PEOPLE.filter((x) => x.id !== b.dataset.delPerson);
    await kvSet('people', PEOPLE);
    for (const p of PHOTOS) if ((p.people || []).includes(b.dataset.delPerson)) { p.people = p.people.filter((id) => id !== b.dataset.delPerson); await idbPut('photos', p); }
    renderPeople();
  });
}
$('#person-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('#person-input').value.trim();
  if (!name) return;
  PEOPLE.push({ id: newId('per'), name });
  await kvSet('people', PEOPLE);
  $('#person-input').value = '';
  renderPeople();
});

// ---- onboarding --------------------------------------------------------
async function renderOnboarding() {
  const ob = await kvGet('onboarding', { messages: [] });
  renderChat(ob.messages);
  renderProfile(await kvGet('profile', null));
}
function renderChat(messages) {
  const chat = $('#chat');
  if (!messages || messages.length === 0) {
    chat.innerHTML = '<div class="bubble assistant">Hi! I\'d love to get to know you so I can make sense of your photos. Press “Start interview”, or just say hello below.</div>';
    return;
  }
  chat.innerHTML = messages.map((m) => `<div class="bubble ${m.role}">${esc(m.content)}</div>`).join('');
  chat.scrollTop = chat.scrollHeight;
}
function renderProfile(profile) {
  const card = $('#profile-card');
  if (!profile) { card.classList.add('hidden'); return; }
  card.classList.remove('hidden');
  const row = (label, arr) => (arr && arr.length) ? `<div class="kv"><b>${label}:</b> ${esc(arr.join(', '))}</div>` : '';
  card.innerHTML = `
    <h3>${esc(profile.name || 'Your profile')}</h3>
    <p class="muted">${esc(profile.summary || '')}</p>
    ${row('Family', profile.family)}${row('Friends', profile.friends)}${row('Pets', profile.pets)}
    ${row('Places lived', profile.places_lived)}${row('Schools', profile.schools)}
    ${row('Hobbies', profile.hobbies)}${row('Notable events', profile.notable_events)}`;
}
async function sendOnboarding(message) {
  if (!hasKey()) { toast('Add your Claude API key in Settings first.'); return; }
  const ob = await kvGet('onboarding', { messages: [] });
  const chat = $('#chat');
  if (message) chat.insertAdjacentHTML('beforeend', `<div class="bubble user">${esc(message)}</div>`);
  chat.insertAdjacentHTML('beforeend', '<div class="bubble assistant" id="typing">…</div>');
  chat.scrollTop = chat.scrollHeight;
  const history = [...ob.messages];
  if (message) history.push({ role: 'user', content: message });
  try {
    const result = await onboardingTurn(history, await kvGet('profile', null));
    history.push({ role: 'assistant', content: result.reply });
    await kvSet('onboarding', { messages: history });
    await kvSet('profile', result.profile);
    $('#typing')?.remove();
    chat.insertAdjacentHTML('beforeend', `<div class="bubble assistant">${esc(result.reply)}</div>`);
    chat.scrollTop = chat.scrollHeight;
    renderProfile(result.profile);
    if (result.is_complete) toast('Nice to meet you! Your profile is ready.');
  } catch (err) { $('#typing')?.remove(); toast('Failed: ' + err.message); }
}
$('#chat-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const msg = $('#chat-input').value.trim();
  if (!msg) return;
  $('#chat-input').value = '';
  sendOnboarding(msg);
});
$('#onboard-start').addEventListener('click', async () => {
  await kvSet('onboarding', { messages: [] });
  await kvSet('profile', null);
  $('#chat').innerHTML = ''; renderProfile(null);
  sendOnboarding('');
});

// ---- settings ----------------------------------------------------------
function loadSettings() {
  $('#model').value = getModel();
  $('#api-key').placeholder = hasKey() ? '•••••••• (saved)' : 'sk-ant-…';
}
$('#save-settings').addEventListener('click', () => {
  const apiKey = $('#api-key').value.trim();
  const model = $('#model').value.trim();
  if (apiKey) localStorage.setItem(LS_KEY, apiKey);
  if (model) localStorage.setItem(LS_MODEL, model);
  $('#api-key').value = '';
  $('#settings-msg').textContent = hasKey() ? 'Saved. Analysis will run automatically.' : 'Saved, but no API key is set yet.';
  loadSettings(); refreshStatus(); processQueue();
});
$('#reanalyze').addEventListener('click', async () => {
  if (!confirm('Re-analyse every photo? This will use your API credits.')) return;
  for (const p of PHOTOS) { p.status = 'pending'; p.error = null; await idbPut('photos', p); }
  renderLibrary(); refreshStatus(); processQueue();
});
$('#clear-all').addEventListener('click', async () => {
  if (!confirm('Erase all photos, people, memories and your profile from this browser? This cannot be undone.')) return;
  const d = await db();
  await new Promise((res) => { const t = d.transaction(['photos', 'kv'], 'readwrite'); t.objectStore('photos').clear(); t.objectStore('kv').clear(); t.oncomplete = res; });
  for (const id of urlCache.keys()) dropUrl(id);
  PHOTOS = []; PEOPLE = [];
  renderLibrary(); refreshStatus(); toast('Everything erased.');
});

// ---- boot --------------------------------------------------------------
(async function init() {
  await loadState();
  renderLibrary();
  renderPeople();
  loadSettings();
  refreshStatus();
  processQueue();
})();

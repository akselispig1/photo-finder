// ---- tiny helpers ------------------------------------------------------
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];
const api = {
  async get(url) { return (await fetch(url)).json(); },
  async post(url, body) {
    return (await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) })).json();
  },
  async del(url) { return (await fetch(url, { method: 'DELETE' })).json(); },
};
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.add('hidden'), 2600);
}
function esc(s) { return (s ?? '').toString().replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function fmtDate(iso) { if (!iso) return ''; const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); }

let PHOTOS = [];
let PEOPLE = [];
let STATUS = {};

// ---- tabs --------------------------------------------------------------
$('#tabs').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-tab]');
  if (!btn) return;
  $$('.tabs button').forEach((b) => b.classList.toggle('active', b === btn));
  $$('.tab').forEach((t) => t.classList.toggle('active', t.id === btn.dataset.tab));
  if (btn.dataset.tab === 'people') renderPeople();
  if (btn.dataset.tab === 'memories') loadMemories();
  if (btn.dataset.tab === 'about') loadOnboarding();
});

// ---- status poll -------------------------------------------------------
async function refreshStatus() {
  STATUS = await api.get('/api/status');
  const busy = STATUS.counts?.pending || STATUS.counts?.analyzing;
  const dot = STATUS.hasKey ? (busy ? 'busy' : 'ok') : 'warn';
  let text;
  if (!STATUS.hasKey) text = 'No API key — add one in Settings';
  else if (busy) text = `Analysing ${((STATUS.counts.pending || 0) + (STATUS.counts.analyzing || 0))} photo(s)…`;
  else text = `${STATUS.counts?.done || 0} photos understood`;
  $('#status').innerHTML = `<span class="dot ${dot}"></span>${esc(text)}`;
  if (busy) loadPhotos();
}
setInterval(refreshStatus, 3000);

// ---- library -----------------------------------------------------------
async function loadPhotos() {
  const { photos } = await api.get('/api/photos');
  PHOTOS = photos;
  renderLibrary();
}
function photoCardHTML(p, extra = '') {
  const a = p.analysis || {};
  const pending = p.status !== 'done';
  const label = pending
    ? `<div class="spinner">${p.status === 'error' ? '⚠︎ failed' : 'reading…'}</div>`
    : `<div class="overlay">${esc(a.caption || '')}</div>`;
  const era = a.estimated_era ? `<span class="badge">${esc(a.estimated_era)}</span>` : '';
  return `<div class="card-photo ${pending ? 'pending' : ''}" data-id="${p.id}">
    <img src="${p.url}" loading="lazy" alt="${esc(a.caption || '')}" />
    ${era}${p.favorite ? '<span class="fav">♥</span>' : ''}${label}${extra}
  </div>`;
}
function renderLibrary() {
  const grid = $('#grid');
  const empty = $('#library-empty');
  if (PHOTOS.length === 0) { grid.innerHTML = ''; empty.classList.remove('hidden'); }
  else { empty.classList.add('hidden'); grid.innerHTML = PHOTOS.map((p) => photoCardHTML(p)).join(''); }
  const done = PHOTOS.filter((p) => p.status === 'done').length;
  $('#library-sub').textContent = PHOTOS.length
    ? `${PHOTOS.length} photos · ${done} understood by AI`
    : 'Upload the photos from your phone to get started.';
}

// ---- upload (with client-side resize to keep things fast & cheap) ------
$('#file-input').addEventListener('change', async (e) => {
  const files = [...e.target.files];
  e.target.value = '';
  if (!files.length) return;
  const prog = $('#upload-progress');
  prog.classList.remove('hidden');
  const fd = new FormData();
  let n = 0;
  for (const file of files) {
    prog.textContent = `Preparing ${++n}/${files.length}…`;
    try { fd.append('photos', await resizeImage(file), (file.name || 'photo').replace(/\.\w+$/, '') + '.jpg'); }
    catch { fd.append('photos', file, file.name); }
  }
  prog.textContent = `Uploading ${files.length} photo(s)…`;
  const res = await fetch('/api/photos', { method: 'POST', body: fd });
  await res.json();
  prog.classList.add('hidden');
  toast(`Added ${files.length} photo(s). Analysis has started.`);
  loadPhotos();
});

function resizeImage(file, max = 1600) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width > max || height > max) {
        const scale = max / Math.max(width, height);
        width = Math.round(width * scale); height = Math.round(height * scale);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('encode failed')), 'image/jpeg', 0.88);
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
  $('#lb-img').src = p.url;
  const tags = (a.tags || []).map((t) => `<span class="tag">${esc(t)}</span>`).join('');
  const people = (a.people || []).map((per) => `${esc(per.description)} <span class="muted">(${esc(per.approx_age)})</span>`).join('<br>');
  const opts = PEOPLE.map((per) => `<option value="${per.id}" ${(p.people || []).includes(per.id) ? 'selected' : ''}>${esc(per.name)}</option>`).join('');
  $('#lb-info').innerHTML = `
    <h3>${esc(a.caption || 'Photo')}</h3>
    <p>${esc(a.description || (p.status !== 'done' ? 'Still being analysed…' : ''))}</p>
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

  $('#lb-fav').onclick = async () => { await api.post(`/api/photos/${id}/favorite`); await loadPhotos(); openLightbox(id); };
  $('#lb-delete').onclick = async () => { if (confirm('Delete this photo?')) { await api.del(`/api/photos/${id}`); $('#lightbox').classList.add('hidden'); loadPhotos(); } };
  const saveBtn = $('#lb-save-people');
  if (saveBtn) saveBtn.onclick = async () => {
    const sel = [...$('#lb-people-select').selectedOptions].map((o) => o.value);
    await api.post(`/api/photos/${id}/people`, { people: sel });
    toast('People tags saved'); await loadPhotos();
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
  const ans = $('#search-answer'); const results = $('#search-results');
  ans.classList.remove('hidden'); ans.textContent = 'Looking through your photos…'; results.innerHTML = '';
  const data = await api.post('/api/search', { query });
  if (data.error) { ans.textContent = data.error; return; }
  ans.textContent = data.answer || '';
  results.innerHTML = (data.results || []).map((r) =>
    photoCardHTML(r.photo, `<span class="score">${r.score}</span><div class="overlay">${esc(r.reason)}</div>`)
  ).join('') || '<p class="muted">No matches — try describing it differently.</p>';
});

// ---- memories ----------------------------------------------------------
const MEM_CHIPS = ['memories with friends', 'childhood summers', 'family gatherings', 'my happiest moments', 'holidays'];
$('#memory-chips').innerHTML = MEM_CHIPS.map((c) => `<span class="chip">${esc(c)}</span>`).join('');
$('#memory-chips').addEventListener('click', (e) => { if (e.target.classList.contains('chip')) { $('#memory-input').value = e.target.textContent; $('#memory-form').requestSubmit(); } });

$('#memory-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const prompt = $('#memory-input').value.trim();
  if (!prompt) return;
  toast('Gathering your memory…');
  const data = await api.post('/api/memories', { prompt });
  if (data.error) { toast(data.error); return; }
  $('#memory-input').value = '';
  loadMemories();
});
async function loadMemories() {
  const { memories } = await api.get('/api/memories');
  $('#memories-list').innerHTML = memories.map((m) => `
    <div class="memory">
      <div class="mem-head">
        <div><h3>${esc(m.title)}</h3><p class="narrative">${esc(m.narrative)}</p></div>
        <button class="btn ghost" data-del-mem="${m.id}">✕</button>
      </div>
      <div class="grid">${m.photos.map((p) => photoCardHTML(p)).join('')}</div>
    </div>`).join('') || '<p class="muted">No memories yet — ask for one above.</p>';
  $$('[data-del-mem]').forEach((b) => b.onclick = async () => { await api.del(`/api/memories/${b.dataset.delMem}`); loadMemories(); });
}

// ---- people ------------------------------------------------------------
async function renderPeople() {
  const { people } = await api.get('/api/people');
  PEOPLE = people;
  $('#people-list').innerHTML = people.map((p) =>
    `<div class="person-tag">${esc(p.name)} <button data-del-person="${p.id}">✕</button></div>`
  ).join('') || '<p class="muted">No people added yet.</p>';
  $$('[data-del-person]').forEach((b) => b.onclick = async () => { await api.del(`/api/people/${b.dataset.delPerson}`); renderPeople(); });
}
$('#person-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('#person-input').value.trim();
  if (!name) return;
  await api.post('/api/people', { name });
  $('#person-input').value = '';
  renderPeople();
});

// ---- onboarding --------------------------------------------------------
async function loadOnboarding() {
  const { messages, profile } = await api.get('/api/onboarding');
  renderChat(messages);
  renderProfile(profile);
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
  const chat = $('#chat');
  if (message) chat.insertAdjacentHTML('beforeend', `<div class="bubble user">${esc(message)}</div>`);
  chat.insertAdjacentHTML('beforeend', '<div class="bubble assistant" id="typing">…</div>');
  chat.scrollTop = chat.scrollHeight;
  const data = await api.post('/api/onboarding/message', { message });
  $('#typing')?.remove();
  if (data.error) { toast(data.error); return; }
  chat.insertAdjacentHTML('beforeend', `<div class="bubble assistant">${esc(data.reply)}</div>`);
  chat.scrollTop = chat.scrollHeight;
  renderProfile(data.profile);
  if (data.is_complete) toast('Nice to meet you! Your profile is ready.');
}
$('#chat-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = $('#chat-input').value.trim();
  if (!msg) return;
  $('#chat-input').value = '';
  sendOnboarding(msg);
});
$('#onboard-start').addEventListener('click', async () => {
  await api.post('/api/onboarding/reset');
  $('#chat').innerHTML = '';
  renderProfile(null);
  sendOnboarding('');
});

// ---- settings ----------------------------------------------------------
async function loadSettings() {
  const s = await api.get('/api/status');
  $('#model').value = s.model || 'claude-opus-4-8';
  $('#api-key').placeholder = s.hasKey ? '•••••••• (saved)' : 'sk-ant-…';
}
$('#save-settings').addEventListener('click', async () => {
  const apiKey = $('#api-key').value.trim();
  const model = $('#model').value.trim();
  const body = { model };
  if (apiKey) body.apiKey = apiKey;
  const res = await api.post('/api/settings', body);
  $('#api-key').value = '';
  $('#settings-msg').textContent = res.hasKey ? 'Saved. Analysis will run automatically.' : 'Saved, but no API key is set yet.';
  refreshStatus();
});
$('#reanalyze').addEventListener('click', async () => {
  if (!confirm('Re-analyse every photo? This will use your API credits.')) return;
  await api.post('/api/photos/reanalyze');
  toast('Re-analysing all photos…');
  refreshStatus();
});

// ---- boot --------------------------------------------------------------
(async function init() {
  await renderPeople();
  await loadPhotos();
  await loadSettings();
  await refreshStatus();
})();

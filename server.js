import express from 'express';
import multer from 'multer';
import exifr from 'exifr';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

import { getDb, update, newId, PHOTOS_DIR } from './lib/db.js';
import * as ai from './lib/ai.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

const SUPPORTED = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

// --- helpers ------------------------------------------------------------

function publicPhoto(p) {
  const { filename, ...rest } = p;
  return { ...rest, url: `/api/photos/${p.id}/image` };
}

function asyncRoute(fn) {
  return (req, res) => fn(req, res).catch((err) => {
    console.error(err);
    if (err.message === 'NO_API_KEY') {
      return res.status(400).json({ error: 'No Claude API key set. Add it under Settings.' });
    }
    res.status(500).json({ error: err.message || 'Server error' });
  });
}

// --- background analysis queue -----------------------------------------

let running = false;
async function processQueue() {
  if (running) return;
  running = true;
  try {
    while (ai.hasKey()) {
      const photo = getDb().photos.find((p) => p.status === 'pending');
      if (!photo) break;
      update((db) => { db.photos.find((p) => p.id === photo.id).status = 'analyzing'; });
      try {
        const filePath = path.join(PHOTOS_DIR, photo.filename);
        const base64 = fs.readFileSync(filePath).toString('base64');
        const analysis = await ai.analyzePhoto({
          base64,
          mediaType: photo.mediaType,
          profile: getDb().profile,
        });
        update((db) => {
          const p = db.photos.find((x) => x.id === photo.id);
          p.analysis = analysis;
          p.status = 'done';
        });
      } catch (err) {
        console.error('Analysis failed for', photo.id, err.message);
        update((db) => {
          const p = db.photos.find((x) => x.id === photo.id);
          p.status = 'error';
          p.error = err.message;
        });
        if (err.message === 'NO_API_KEY') break;
      }
    }
  } finally {
    running = false;
  }
}

// --- settings -----------------------------------------------------------

app.get('/api/status', (req, res) => {
  const db = getDb();
  const counts = db.photos.reduce((acc, p) => {
    acc[p.status] = (acc[p.status] || 0) + 1;
    return acc;
  }, {});
  res.json({
    hasKey: ai.hasKey(),
    model: ai.getModel(),
    total: db.photos.length,
    counts,
    hasProfile: Boolean(db.profile),
    people: db.people.length,
  });
});

app.post('/api/settings', (req, res) => {
  const { apiKey, model } = req.body || {};
  update((db) => {
    if (typeof apiKey === 'string') db.settings.apiKey = apiKey.trim();
    if (typeof model === 'string' && model.trim()) db.settings.model = model.trim();
  });
  if (ai.hasKey()) processQueue();
  res.json({ ok: true, hasKey: ai.hasKey(), model: ai.getModel() });
});

// --- photos -------------------------------------------------------------

app.post('/api/photos', upload.array('photos', 100), asyncRoute(async (req, res) => {
  const files = req.files || [];
  const added = [];
  for (const file of files) {
    if (!SUPPORTED.has(file.mimetype)) continue;
    const id = newId('ph');
    const ext = file.mimetype.split('/')[1].replace('jpeg', 'jpg');
    const filename = `${id}.${ext}`;
    fs.writeFileSync(path.join(PHOTOS_DIR, filename), file.buffer);

    let takenAt = null;
    let gps = null;
    try {
      const meta = await exifr.parse(file.buffer, { gps: true }).catch(() => null);
      if (meta?.DateTimeOriginal) takenAt = new Date(meta.DateTimeOriginal).toISOString();
      if (meta?.latitude && meta?.longitude) gps = { lat: meta.latitude, lon: meta.longitude };
    } catch { /* no exif */ }

    const record = {
      id,
      filename,
      mediaType: file.mimetype,
      originalName: file.originalname,
      uploadedAt: new Date().toISOString(),
      takenAt,
      gps,
      status: 'pending',
      analysis: null,
      people: [],
      favorite: false,
    };
    update((db) => db.photos.push(record));
    added.push(publicPhoto(record));
  }
  processQueue();
  res.json({ added });
}));

app.get('/api/photos', (req, res) => {
  const photos = getDb().photos.map(publicPhoto).sort((a, b) => {
    const da = a.takenAt || a.uploadedAt;
    const dbb = b.takenAt || b.uploadedAt;
    return (dbb || '').localeCompare(da || '');
  });
  res.json({ photos });
});

app.get('/api/photos/:id/image', (req, res) => {
  const photo = getDb().photos.find((p) => p.id === req.params.id);
  if (!photo) return res.status(404).end();
  res.sendFile(path.join(PHOTOS_DIR, photo.filename));
});

app.post('/api/photos/:id/favorite', (req, res) => {
  update((db) => {
    const p = db.photos.find((x) => x.id === req.params.id);
    if (p) p.favorite = !p.favorite;
  });
  res.json({ ok: true });
});

app.post('/api/photos/:id/people', (req, res) => {
  const { people } = req.body || {};
  update((db) => {
    const p = db.photos.find((x) => x.id === req.params.id);
    if (p) p.people = Array.isArray(people) ? people : [];
  });
  res.json({ ok: true });
});

app.delete('/api/photos/:id', (req, res) => {
  update((db) => {
    const idx = db.photos.findIndex((x) => x.id === req.params.id);
    if (idx >= 0) {
      const [p] = db.photos.splice(idx, 1);
      try { fs.unlinkSync(path.join(PHOTOS_DIR, p.filename)); } catch { /* gone */ }
    }
  });
  res.json({ ok: true });
});

app.post('/api/photos/reanalyze', asyncRoute(async (req, res) => {
  update((db) => {
    for (const p of db.photos) {
      if (p.status === 'error' || p.status === 'done') p.status = 'pending';
    }
  });
  processQueue();
  res.json({ ok: true });
}));

// --- people -------------------------------------------------------------

app.get('/api/people', (req, res) => res.json({ people: getDb().people }));

app.post('/api/people', (req, res) => {
  const { name, notes } = req.body || {};
  if (!name?.trim()) return res.status(400).json({ error: 'Name required' });
  const person = { id: newId('per'), name: name.trim(), notes: notes || '' };
  update((db) => db.people.push(person));
  res.json({ person });
});

app.delete('/api/people/:id', (req, res) => {
  update((db) => {
    db.people = db.people.filter((x) => x.id !== req.params.id);
    for (const p of db.photos) p.people = (p.people || []).filter((id) => id !== req.params.id);
  });
  res.json({ ok: true });
});

// --- onboarding ---------------------------------------------------------

app.get('/api/onboarding', (req, res) => {
  const db = getDb();
  res.json({ messages: db.onboarding.messages, profile: db.profile });
});

app.post('/api/onboarding/reset', (req, res) => {
  update((db) => { db.onboarding.messages = []; db.profile = null; });
  res.json({ ok: true });
});

app.post('/api/onboarding/message', asyncRoute(async (req, res) => {
  const { message } = req.body || {};
  const db = getDb();
  const history = [...db.onboarding.messages];
  if (message?.trim()) history.push({ role: 'user', content: message.trim() });

  const result = await ai.onboardingTurn({ history, currentProfile: db.profile });
  history.push({ role: 'assistant', content: result.reply });

  update((d) => {
    d.onboarding.messages = history;
    d.profile = result.profile;
  });
  res.json({ reply: result.reply, is_complete: result.is_complete, profile: result.profile });
}));

app.get('/api/profile', (req, res) => res.json({ profile: getDb().profile }));

// --- search & memories --------------------------------------------------

function analysedPhotos() {
  return getDb().photos.filter((p) => p.status === 'done' && p.analysis);
}

app.post('/api/search', asyncRoute(async (req, res) => {
  const { query } = req.body || {};
  if (!query?.trim()) return res.status(400).json({ error: 'Query required' });
  const photos = analysedPhotos();
  if (photos.length === 0) return res.json({ answer: 'No analysed photos yet — upload some first.', results: [] });

  const result = await ai.search({ query: query.trim(), photos, profile: getDb().profile });
  const byId = new Map(getDb().photos.map((p) => [p.id, p]));
  const results = (result.results || [])
    .filter((r) => byId.has(r.id))
    .map((r) => ({ ...r, photo: publicPhoto(byId.get(r.id)) }));
  res.json({ answer: result.answer, results });
}));

app.post('/api/memories', asyncRoute(async (req, res) => {
  const { prompt } = req.body || {};
  if (!prompt?.trim()) return res.status(400).json({ error: 'Prompt required' });
  const photos = analysedPhotos();
  if (photos.length === 0) return res.json({ error: 'No analysed photos yet.' });

  const mem = await ai.generateMemory({ prompt: prompt.trim(), photos, profile: getDb().profile });
  const byId = new Map(getDb().photos.map((p) => [p.id, p]));
  const memory = {
    id: newId('mem'),
    createdAt: new Date().toISOString(),
    prompt: prompt.trim(),
    title: mem.title,
    narrative: mem.narrative,
    photos: (mem.photo_ids || []).filter((id) => byId.has(id)).map((id) => publicPhoto(byId.get(id))),
  };
  update((db) => db.memories.unshift(memory));
  res.json({ memory });
}));

app.get('/api/memories', (req, res) => res.json({ memories: getDb().memories }));

app.delete('/api/memories/:id', (req, res) => {
  update((db) => { db.memories = db.memories.filter((m) => m.id !== req.params.id); });
  res.json({ ok: true });
});

function lanAddresses() {
  const out = [];
  for (const iface of Object.values(os.networkInterfaces())) {
    for (const net of iface || []) {
      if (net.family === 'IPv4' && !net.internal) out.push(net.address);
    }
  }
  return out;
}

// Bind on all interfaces so you can open it from your phone on the same Wi-Fi.
// Resume any interrupted analysis on boot.
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  📷  Photo Finder is running.\n`);
  console.log(`     On this computer:  http://localhost:${PORT}`);
  for (const ip of lanAddresses()) {
    console.log(`     On your iPhone:    http://${ip}:${PORT}   (same Wi-Fi, then Share → Add to Home Screen)`);
  }
  console.log('');
  if (ai.hasKey()) {
    update((db) => { for (const p of db.photos) if (p.status === 'analyzing') p.status = 'pending'; });
    processQueue();
  }
});

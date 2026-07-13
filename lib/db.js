// Tiny JSON-file datastore. No native deps, fine for a personal photo library.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
export const PHOTOS_DIR = path.join(DATA_DIR, 'photos');

for (const dir of [DATA_DIR, PHOTOS_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}

const DEFAULT_DB = {
  settings: { apiKey: '', model: 'claude-opus-4-8' },
  profile: null, // built during onboarding
  onboarding: { messages: [] }, // chat history for the "who's who" interview
  photos: [], // { id, filename, mediaType, uploadedAt, takenAt, gps, status, analysis, people, favorite }
  people: [], // { id, name, notes }
  memories: [], // saved memory collections
};

let db = load();

function load() {
  try {
    const raw = fs.readFileSync(DB_FILE, 'utf8');
    return { ...structuredClone(DEFAULT_DB), ...JSON.parse(raw) };
  } catch {
    return structuredClone(DEFAULT_DB);
  }
}

let writeTimer = null;
function scheduleSave() {
  if (writeTimer) return;
  writeTimer = setTimeout(() => {
    writeTimer = null;
    const tmp = DB_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
    fs.renameSync(tmp, DB_FILE);
  }, 150);
}

export function getDb() {
  return db;
}

// Mutate then persist. Pass a function that receives the db object.
export function update(fn) {
  const result = fn(db);
  scheduleSave();
  return result;
}

export function save() {
  scheduleSave();
}

export function newId(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

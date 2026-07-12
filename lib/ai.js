// All Claude API interactions live here.
import Anthropic from '@anthropic-ai/sdk';
import { getDb } from './db.js';

export function getApiKey() {
  return getDb().settings.apiKey || process.env.ANTHROPIC_API_KEY || '';
}

export function getModel() {
  return getDb().settings.model || process.env.PHOTO_MODEL || 'claude-opus-4-8';
}

export function hasKey() {
  return Boolean(getApiKey());
}

function client() {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('NO_API_KEY');
  return new Anthropic({ apiKey });
}

// Run a request that must return JSON matching `schema`. Returns the parsed object.
async function callJSON({ system, content, schema, maxTokens = 4000 }) {
  const resp = await client().messages.create({
    model: getModel(),
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content }],
    output_config: { format: { type: 'json_schema', schema } },
  });
  const text = resp.content.find((b) => b.type === 'text')?.text ?? '{}';
  return JSON.parse(text);
}

// ---- Photo analysis ----------------------------------------------------

const ANALYSIS_SCHEMA = {
  type: 'object',
  properties: {
    caption: { type: 'string', description: 'One short sentence describing the photo.' },
    description: { type: 'string', description: 'A rich 2-4 sentence description of what is happening, who is present, and the surroundings.' },
    setting: { type: 'string', description: 'e.g. "indoor - living room", "outdoor - beach", "car interior".' },
    location_guess: { type: 'string', description: 'Best guess at the type of place or region, or "" if unknown.' },
    people_count: { type: 'integer' },
    people: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          description: { type: 'string', description: 'Visual description e.g. "young boy with blond hair in a red jumper".' },
          approx_age: { type: 'string', description: 'e.g. "baby", "toddler", "child", "teen", "adult 20s", "elderly".' },
          role_guess: { type: 'string', description: 'A cautious guess like "likely the subject as a child", "unknown", or "".' },
        },
        required: ['description', 'approx_age', 'role_guess'],
        additionalProperties: false,
      },
    },
    objects: { type: 'array', items: { type: 'string' } },
    activities: { type: 'array', items: { type: 'string' } },
    mood: { type: 'string' },
    estimated_era: { type: 'string', description: 'e.g. "1980s", "1990s", "early 2000s", "2010s", "recent". Base this on photo quality, clothing, and objects.' },
    is_scanned_photo: { type: 'boolean', description: 'True if this looks like a photo of an older printed/physical photograph.' },
    tags: { type: 'array', items: { type: 'string' } },
    nostalgia_score: { type: 'integer', description: 'How nostalgic/memory-worthy this photo feels, 1 (mundane) to 10 (deeply nostalgic).' },
  },
  required: [
    'caption', 'description', 'setting', 'location_guess', 'people_count', 'people',
    'objects', 'activities', 'mood', 'estimated_era', 'is_scanned_photo', 'tags', 'nostalgia_score',
  ],
  additionalProperties: false,
};

export async function analyzePhoto({ base64, mediaType, profile }) {
  const system =
    'You are an expert photo archivist helping someone catalogue their personal photo library so it becomes searchable by memory. ' +
    'Look carefully at the image and produce accurate, specific metadata. Note ages of people (this helps identify the same person across years — e.g. "the subject as a baby in a pram"). ' +
    'Be concrete about objects, clothing, and settings, since people search using these details. Never invent identities you cannot see.' +
    (profile ? `\n\nContext about the library owner (use only if clearly relevant):\n${profileSummary(profile)}` : '');

  const content = [
    { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
    { type: 'text', text: 'Analyse this photograph and return the structured metadata.' },
  ];
  return callJSON({ system, content, schema: ANALYSIS_SCHEMA, maxTokens: 2000 });
}

// ---- Onboarding "who's who" interview ---------------------------------

const PROFILE_SCHEMA = {
  type: 'object',
  properties: {
    reply: { type: 'string', description: 'Your warm, conversational message to the user — usually one question at a time.' },
    is_complete: { type: 'boolean', description: 'True once you have enough of a picture (name, family, places lived, key friends/pets/hobbies).' },
    profile: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        summary: { type: 'string', description: 'A short paragraph describing who this person is.' },
        family: { type: 'array', items: { type: 'string' } },
        friends: { type: 'array', items: { type: 'string' } },
        pets: { type: 'array', items: { type: 'string' } },
        places_lived: { type: 'array', items: { type: 'string' } },
        schools: { type: 'array', items: { type: 'string' } },
        hobbies: { type: 'array', items: { type: 'string' } },
        notable_events: { type: 'array', items: { type: 'string' } },
        notes: { type: 'array', items: { type: 'string' } },
      },
      required: ['name', 'summary', 'family', 'friends', 'pets', 'places_lived', 'schools', 'hobbies', 'notable_events', 'notes'],
      additionalProperties: false,
    },
  },
  required: ['reply', 'is_complete', 'profile'],
  additionalProperties: false,
};

export async function onboardingTurn({ history, currentProfile }) {
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
    // Seed with the known profile so the model keeps building on it.
    if (currentProfile) {
      messages.push({ role: 'user', content: `Profile so far (JSON): ${JSON.stringify(currentProfile)}` });
      messages.push({ role: 'assistant', content: 'Understood, I have the profile so far.' });
    }
    for (const m of history) messages.push({ role: m.role, content: m.content });
  }

  const resp = await client().messages.create({
    model: getModel(),
    max_tokens: 2000,
    system,
    messages,
    output_config: { format: { type: 'json_schema', schema: PROFILE_SCHEMA } },
  });
  const text = resp.content.find((b) => b.type === 'text')?.text ?? '{}';
  return JSON.parse(text);
}

// ---- Natural-language search ------------------------------------------

const SEARCH_SCHEMA = {
  type: 'object',
  properties: {
    answer: { type: 'string', description: 'A short natural-language reply to the user about what you found.' },
    results: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          score: { type: 'integer', description: 'How well this photo matches, 0-100.' },
          reason: { type: 'string', description: 'One sentence on why this photo matches.' },
        },
        required: ['id', 'score', 'reason'],
        additionalProperties: false,
      },
    },
  },
  required: ['answer', 'results'],
  additionalProperties: false,
};

export async function search({ query, photos, profile }) {
  const catalog = photos.map((p) => photoCard(p));
  const system =
    'You help someone find photos in their personal library using natural language. ' +
    'You are given a catalogue of analysed photos and the user\'s query. Pick the photos that best match, considering people, ages, places, objects, activities, era and mood. ' +
    'Use the owner profile to resolve references like "me", "my brother", or the name of a place they lived. ' +
    'Only include photos with a genuine match (score 40+). Order by score, best first. If nothing matches, return an empty results list and say so kindly.' +
    (profile ? `\n\nOwner profile:\n${profileSummary(profile)}` : '');

  const content = [
    { type: 'text', text: `User query: "${query}"\n\nPhoto catalogue (JSON):\n${JSON.stringify(catalog)}` },
  ];
  return callJSON({ system, content, schema: SEARCH_SCHEMA, maxTokens: 3000 });
}

// ---- Memory collections -----------------------------------------------

const MEMORY_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    narrative: { type: 'string', description: 'A warm 2-4 sentence story tying these photos together.' },
    photo_ids: { type: 'array', items: { type: 'string' } },
  },
  required: ['title', 'narrative', 'photo_ids'],
  additionalProperties: false,
};

export async function generateMemory({ prompt, photos, profile }) {
  const catalog = photos.map((p) => photoCard(p));
  const system =
    'You are a thoughtful memory curator. From the user\'s photo catalogue, assemble ONE evocative memory collection matching their request ' +
    '(for example "memories with friends", "childhood", "holidays by the sea"). Choose 4-15 of the most fitting, nostalgic photos, give the collection a lovely title, ' +
    'and write a short warm narrative. Prefer higher nostalgia_score photos and a coherent theme. Use the owner profile to understand references.' +
    (profile ? `\n\nOwner profile:\n${profileSummary(profile)}` : '');

  const content = [
    { type: 'text', text: `Request: "${prompt}"\n\nPhoto catalogue (JSON):\n${JSON.stringify(catalog)}` },
  ];
  return callJSON({ system, content, schema: MEMORY_SCHEMA, maxTokens: 2000 });
}

// ---- helpers -----------------------------------------------------------

function photoCard(p) {
  const a = p.analysis || {};
  return {
    id: p.id,
    date: p.takenAt || p.uploadedAt || null,
    named_people: (p.people || []).map((id) => peopleNameOf(id)).filter(Boolean),
    caption: a.caption,
    description: a.description,
    setting: a.setting,
    location: a.location_guess,
    people_count: a.people_count,
    people: a.people,
    objects: a.objects,
    activities: a.activities,
    mood: a.mood,
    era: a.estimated_era,
    tags: a.tags,
    nostalgia: a.nostalgia_score,
  };
}

function peopleNameOf(personId) {
  const person = getDb().people.find((x) => x.id === personId);
  return person?.name || null;
}

function profileSummary(profile) {
  if (!profile) return '';
  const lines = [];
  if (profile.name) lines.push(`Name: ${profile.name}`);
  if (profile.summary) lines.push(profile.summary);
  const list = (label, arr) => { if (arr?.length) lines.push(`${label}: ${arr.join(', ')}`); };
  list('Family', profile.family);
  list('Friends', profile.friends);
  list('Pets', profile.pets);
  list('Places lived', profile.places_lived);
  list('Schools', profile.schools);
  list('Hobbies', profile.hobbies);
  list('Notable events', profile.notable_events);
  list('Notes', profile.notes);
  return lines.join('\n');
}

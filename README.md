# 📷 Photo Finder

An AI photo‑memory app. Bring your photos over from your phone, and Photo Finder
uses Claude's vision model to understand every one — who's in it, roughly when and
where, the mood, the objects — so you can then **find any moment by describing it**
(*"the photo where I was in a pram"*), and ask it to **gather memories** for you
(*"memories with friends"*).

It also spends five minutes getting to know **who you are** — your family, the
places you lived, your friends and pets — so it understands references like *"me"*,
*"my brother"* or the town you grew up in.

## What it does

- **Import your photos** — drag in a whole camera roll. Images are resized in the
  browser before upload so it stays fast and cheap.
- **AI understands each photo** — Claude vision writes a rich description, spots
  people and their approximate ages (so *"me as a baby"* is findable), guesses the
  era, place, mood, and a nostalgia score. EXIF date & GPS are read automatically.
- **Find a photo in plain language** — *"me and Sam at the beach"*, *"birthdays from
  the 90s"*, *"the one in the pram"*. Claude ranks your library and explains each match.
- **Memories** — ask for a theme and it curates a collection with a title and a warm
  little narrative tying the photos together.
- **About me (who's who)** — a short guided interview builds a profile the AI uses as
  context everywhere else.
- **People** — name the important people in your life and tag them in photos to sharpen
  searches.
- **Favourites, timeline‑aware sorting, a full‑screen lightbox**, and a warm album feel.

## Requirements

- Node.js 18+ (developed on Node 22)
- A Claude API key (`sk-ant-…`)

## Run it

```bash
npm install
npm start
# → http://localhost:3000
```

Open the app, go to **Settings**, and paste your Claude API key (or set
`ANTHROPIC_API_KEY` in your environment before starting). Analysis begins
automatically as soon as a key is present.

## Getting your photos off your phone

Photo Finder is a web app, so export your phone's photos to your computer first
(AirDrop, Google Photos download, USB, etc.), then drag them into the **Library**
tab. Live end‑to‑end phone sync would need a native app — this keeps everything
local and simple.

## Configuration

| Setting | Where | Default |
| --- | --- | --- |
| API key | Settings tab or `ANTHROPIC_API_KEY` | — |
| Model | Settings tab or `PHOTO_MODEL` | `claude-opus-4-8` |
| Port | `PORT` | `3000` |

Analysing a large library adds up — switch the model to `claude-haiku-4-5` in
Settings for cheaper bulk analysis, then search with the default Opus.

## How it's built

- **Backend** — Node + Express. Photos and metadata live on disk under `data/`
  (a JSON store + the image files); no database to set up.
- **AI** — the official `@anthropic-ai/sdk`, using Claude vision with structured
  (JSON‑schema) outputs for reliable analysis, search, and memory generation.
- **Frontend** — a dependency‑free vanilla‑JS single page app.

Your data never leaves your machine except the photo content sent to the Claude
API for analysis and search.

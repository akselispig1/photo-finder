# 📷 Photo Finder

An AI photo‑memory app. Bring your photos over from your phone, and Photo Finder
uses Claude's vision model to understand every one — who's in it, roughly when and
where, the mood, the objects — so you can then **find any moment by describing it**
(*"the photo where I was in a pram"*), and ask it to **gather memories** for you
(*"memories with friends"*).

It also spends five minutes getting to know **who you are** — your family, the
places you lived, your friends and pets — so it understands references like *"me"*,
*"my brother"* or the town you grew up in.

## 🌐 Just want a link? Use the GitHub Pages version

There's a **no‑install, browser‑only build** in [`docs/`](docs/) that runs entirely on
your phone — no server, no computer to keep on. It stores your photos in your browser
and talks to Claude directly. Turn it on once:

1. In this repo, open **Settings → Pages**.
2. Under **Build and deployment → Source**, choose **Deploy from a branch**.
3. Pick the branch that has this code and the **`/docs`** folder, then **Save**.
4. After a minute your link is live at **`https://akselispig1.github.io/photo-finder/`**.

Open that link in Safari on your iPhone → **Share → Add to Home Screen**. In the app's
**Settings** tab, paste your Claude API key (it's saved only in your browser, never in
the repo), then tap **+ Add photos** and pick from your camera roll.

> Trade‑offs of the browser build: your photos live in that browser on that one device
> (private, but not synced across devices), and your API key is stored in the browser —
> so don't use it on a shared computer. Prefer photos that sync and stay on a server?
> Run the Node version below instead.

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

## Using it on your iPhone (no AirDrop)

You don't need to export or AirDrop anything. Use it right on the phone:

1. Run `npm start` on a computer that's on the **same Wi‑Fi** as your iPhone. The
   server prints an address like `http://192.168.1.23:3000`.
2. Open that address in **Safari** on your iPhone.
3. Tap **Share → Add to Home Screen** — it installs like a real app (full‑screen,
   its own icon).
4. Open it, tap **+ Add photos**, and pick straight from your **Photos library** —
   iOS lets you multi‑select. Photos are shrunk on the phone before uploading and
   sent in small batches, so you can add hundreds at once and watch them stream in.

That's the whole loop: your photos stay on your own computer, and only the image
content needed for analysis/search is sent to the Claude API.

> The server must keep running on your computer while you use the app on the phone.
> (A phone can't run the Node server itself.)

## Getting a link you can open anywhere (temporary public URL)

Want an `https://…` link that works from any network — not just the same Wi‑Fi?
Expose your locally‑running app with a free Cloudflare quick tunnel (no account):

1. **Terminal 1** — run the app:
   ```bash
   npm start
   ```
2. Install `cloudflared` once: `brew install cloudflared` (macOS), or download it
   from https://github.com/cloudflare/cloudflared/releases.
3. **Terminal 2** — open the tunnel:
   ```bash
   npm run share
   ```
   It prints a link like `https://random-words.trycloudflare.com`. Open that on your
   iPhone (Share → Add to Home Screen for a full‑screen app).

The link lives only while `npm run share` is running — stop it (Ctrl‑C) when you're
done. Because the app has no login, treat the URL as a secret: anyone who has it can
use your library and your API key while the tunnel is up.

> No Homebrew? You can also run `npx cloudflared tunnel --url http://localhost:3000`.

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

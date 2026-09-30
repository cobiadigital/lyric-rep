# Lyric Rep

A home for stray song lines: fragments, single lines, whole sections. Built as an iPhone home-screen app (PWA) running on a Cloudflare Worker with a D1 database.

- **Opens to a text box** for the new idea. Save with the button (or Cmd/Ctrl+Enter on a keyboard). Unsaved drafts survive closing the app.
- **Past entries below, in random order.** The shuffle button reshuffles.
- **Search icon** opens live search. Results update as you type; every word must match, and matches are highlighted.
- **Tap an entry** to copy, edit, or delete it.
- **Works offline.** Lines saved without signal are kept on the phone and sync automatically once you're back online.

## Project layout

```
wrangler.jsonc          Worker + D1 + static assets config
src/index.js            API: /api/lyrics (GET list/search, POST, PUT, DELETE)
migrations/0001_init.sql  D1 schema
public/                 The PWA (index.html, app.js, styles.css, sw.js, manifest, icons)
```

## Deploying with Workers Builds

The D1 database `lyric-rep` already exists in your Cloudflare account and its table is created. `wrangler.jsonc` points at it.

1. Cloudflare dashboard → **Workers & Pages** → **Create** → **Import a repository** → pick `lyric-rep`.
2. Build settings: leave build command empty, deploy command `npx wrangler deploy`.
   Optional: use `npm run deploy` instead, which applies any new D1 migrations before each deploy.
3. Push to the branch you connected. Each commit deploys automatically.

## Locking it down (recommended)

Without a password, anyone who finds the URL can read and add lines. To lock it:

1. Dashboard → your `lyric-rep` Worker → **Settings** → **Variables and Secrets** → **Add** → type **Secret**, name `APP_PASSWORD`, value of your choice.
2. Open the app. It asks for the password once and remembers it on that device.

## Installing on iPhone

Open the Worker URL in Safari → Share → **Add to Home Screen**. It launches full screen with no browser chrome.

## Local development (optional)

```
npm install
npm run migrate:local
npm run dev
```

# Video Streamer

Lightweight video streaming web page with Telegram bot management.

## Architecture

- **Web page**: Vanilla HTML/CSS/JS (adapted from tizen-video-player), served by Vercel
- **Videos**: Stored in `videos.json` in a GitHub repo
- **Telegram bot**: Vercel serverless function (`/api/webhook`) that edits `videos.json` via GitHub API
- **Video list**: Frontend fetches from `/api/videos` (reads from GitHub)

## Setup

### 1. GitHub

1. Create a GitHub repo (e.g. `video-streamer`), push this project to it, including `videos.json`.
2. Create a Personal Access Token (Settings → Developer settings → Tokens → Generate new token) with **repo** scope.
3. Copy `videos.json` **contents** (just `[]`) - the bot edits this file automatically.

### 2. Telegram

1. Create a bot: message `@BotFather`, `/newbot`, get the token.
2. Get your user ID: message `@userinfobot` to see your numeric ID.

### 3. Vercel

1. Deploy this project to Vercel (import from GitHub, or use the Vercel CLI).
2. Set environment variables (Project → Settings → Environment Variables):

```
TELEGRAM_BOT_TOKEN=<your bot token>
GITHUB_TOKEN=<your github PAT>
GITHUB_OWNER=<your github username>
GITHUB_REPO=video-streamer
GITHUB_BRANCH=main
ALLOWED_TELEGRAM_IDS=<numeric telegram ids, comma separated>
```

3. Deploy.

### 4. Set webhook

After deploy, register the Telegram webhook (run once, from your machine or Terminal):

```
curl -X POST "https://api.telegram.org/bot<YOUR_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://<your-vercel-domain>.vercel.app/api/webhook"}'
```

You can unregister with `deleteWebhook`.

## Usage

Tell your bot:

- `/add <title> <url>` - Add a video (URL must be a direct MP4 link)
- `/remove <index>` - Remove by index (see /list)
- `/list` - Show all videos
- `/help` - Show help

Your public video page: `https://<your-vercel-domain>.vercel.app/`

## Local dev

```
cp .env.example .env   # then fill in values
npm i -g vercel
vercel dev
```

Vercel dev reads local `.env` automatically. To simulate a Telegram webhook locally:

```
curl -X POST http://localhost:3000/api/webhook -H 'Content-Type: application/json' \
  -d '{"message":{"chat":{"id":<ID>},"from":{"id":<ID>},"text":"/list"}}'
```

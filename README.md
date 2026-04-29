# Instagram Manual Reviewer

Hebrew web UI for loading Instagram export/CSV files, tracking unfollow progress, and sending unfollow actions through a local bot server.

## Important

The website is only the UI. Login and unfollow actions require the bot API server in `bot/`.

When the site uses `http://127.0.0.1:5000`, that means the current user's own computer. If a friend opens the GitHub Pages site, they must also run the bot on their computer, or enter a reachable bot URL in the app's bot settings.

If the bot runs on your computer and only the website is public, expose the bot with an HTTPS tunnel and use that public URL in the site. A public GitHub Pages page cannot reach `127.0.0.1` on your computer from someone else's browser.

## Run The Website

```bash
npm install
npm run dev
```

## Run The Bot

Windows:

```bat
cd bot
start-bot.bat
```

Manual:

```bash
cd bot
python -m pip install -r requirements.txt
python server.py
```

The bot should listen on:

```text
http://127.0.0.1:5000
```

Keep the bot window open while using the site.

## Public Website + Bot On Your Computer

1. Start the bot locally.
2. Create an HTTPS tunnel to local port `5000` with a tool such as Cloudflare Tunnel or ngrok.
3. Copy the public HTTPS URL, for example:
   ```text
   https://your-bot-tunnel.example.com
   ```
4. In GitHub, set repository variable `BOT_API_BASE_URL` to that URL:
   `Settings -> Secrets and variables -> Actions -> Variables`.
5. Re-run the GitHub Pages workflow, or push a new commit.

You can also paste that same URL in the app's bot settings before logging in.

## Typical Flow

1. Start the bot.
2. Open the website.
3. Log in with Instagram username and password.
4. Import a ZIP/HTML export or CSV.
5. Use the queue or manual buttons to unfollow.

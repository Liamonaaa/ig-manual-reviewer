# Instagram bot server

The web app needs this local API server for Instagram login and unfollow actions.

## Windows quick start

```bat
cd bot
start-bot.bat
```

The bot should stay open and listen on:

```text
http://127.0.0.1:5000
```

Then open the website and log in. If a friend uses the public GitHub Pages site, `127.0.0.1` means their own computer, so they must run this bot on their machine too.

## Manual start

```bash
cd bot
python -m pip install -r requirements.txt
python server.py
```

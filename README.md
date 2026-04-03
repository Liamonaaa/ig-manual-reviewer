# Instagram Manual Reviewer

A local, private desktop web app designed to help you quickly manully process a list of Instagram accounts (e.g. users who don't follow you back).

This tool does **NOT** log in to Instagram, scrape pages, or use their API. We respect all rules by completely relying on manual actions triggered by you.

## Features
- Import a `.csv` with `username` columns (supports `status`, `notes`, `category` too).
- Keep track of session progress securely in your browser's local storage. No backend needed!
- Keyboard shortcuts for insanely fast manual reviewing:
  - `O`: Open profile in new tab
  - `U`: Mark as "**U**nfollowed Manually"
  - `K`: Mark as "**K**ept"
  - `S`: Mark as "**S**kipped"
  - `N` / `P`: Navigate **N**ext and **P**revious row
- Filter by status, search by name, or use batch modes (25/50/100).
- "Bulk open next 5" to drastically speed up processing limits.
- Exports your processed progress directly to CSV.

## How to Run

1. Make sure Node.js is installed.
2. Clone or open this folder.
3. Install dependencies:
   ```bash
   npm install
   ```
4. Start the local server:
   ```bash
   npm run dev
   ```
5. Open the displayed `localhost` URL in your browser.

## Sample CSV
You can find an example format in `sample.csv` in the root of the project to test things out.

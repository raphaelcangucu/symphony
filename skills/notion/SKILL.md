---
name: notion
description: >
  Import Notion pages or databases as temporary Markdown and assets via
  Symphony's import_notion_page tool. Use when the user pastes a Notion URL,
  asks to pull Notion content, or needs Markdown/images from Notion for issues
  or the KB.
---

# Notion import

## Setup

- Settings → Providers → Notion Integration token, or `NOTION_API_KEY`
- Share the page/database with the Integration in Notion

## Tool

Call `import_notion_page` with `{ "url": "<notion url>" }`.

Returns `markdown_path`, `assets_dir`, `meta_path` under `/tmp/symphony-notion/`.

If the tool is missing from the session: `mix symphony.tool call import_notion_page --url '...' --json`

## Rules

- Treat `/tmp` as temporary; do not assume it survives restarts
- Do not invent page content if import fails
- Only create issues or write KB pages when the user asks
- Prefer reading `markdown_path` with existing read tools after import

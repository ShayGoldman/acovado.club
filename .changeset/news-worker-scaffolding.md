---
'@apps/news-worker': minor
---

Initial scaffolding for the news-worker app — Bun HTTP worker with `/health`, logger + tracer wiring, SIGTERM/SIGINT lifecycle, and a headless Chromium (Playwright) launched at boot as the runtime proof for the news-fetch pipeline. M1 is scaffolding + Playwright-in-Docker only; discovery, fetch, and publish land in later milestones.

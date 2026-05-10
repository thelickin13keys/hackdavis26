# SafePath — Hackathon PRD

> Safer bike routing for at-risk cyclists (seniors, women) using AI-analyzed street view and safety-scored maps.

---

## Problem

Cyclists — especially older adults and women — prioritize safety over speed. No current tool combines real-time street safety signals with bike routing and visual street previews.

---

## Demo Moment

> User enters a destination → map renders a safety-scored bike route → side panel streams AI analysis of street view segments in real time.

---

## Tech Stack

- **Frontend:** Next.js, shadcn/ui, Mapbox GL JS
- **Backend:** Next.js API routes
- **AI:** Vision model API (street view frame analysis)
- **Data:** Mapbox Directions API, mock safety scores (green/yellow/red segments)

---

## Features (MVP — Hackathon)

| Feature | Description |
|---|---|
| Bike routing | Start/end input → Mapbox bike route on map |
| Safety overlay | Color-coded route segments (green = safe, yellow = caution, red = avoid) |
| Street view pipeline | Fetch frames for route segments, send to vision model |
| AI streaming analysis | Stream safety tags: lighting, crowds, hazard presence |
| Risk toggle | Standard mode vs. cautious mode (re-weights route) |

---

## Cut (Post-Hackathon)

- Auth / user accounts
- Saved & shared routes
- Real crime/lighting API integration
- Offline mode
- Multi-city support
- Full accessibility audit

---

## 24hr Build Plan

| Hours | Task | Owner |
|---|---|---|
| 0–2 | Next.js + shadcn + Mapbox boilerplate, env setup | Full-stack |
| 2–5 | Bike routing — start/end → route on map | Full-stack |
| 5–8 | Safety score overlay — mock color-coded segments | Frontend |
| 8–13 | Street view fetch → vision model → streaming side panel | Backend + AI |
| 13–17 | Wire frontend to stream, risk toggle, UI polish | Frontend |
| 17–20 | End-to-end demo flow, fix blockers | All |
| 20–24 | Pitch deck, demo script, bug buffer | All |

---

## Risk

**Street view → vision model latency** is the biggest risk. If the pipeline isn't ready by hour 13, swap in a preloaded mock response to keep the demo smooth.

---

## Success Criteria

- Live demo: enter destination → safety route renders → AI street preview streams
- Judges understand the problem and target user in <30 seconds
- Risk toggle visibly changes the route
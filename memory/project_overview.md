---
name: HackDavis 2026 — Bike Safety Routing
description: Hackathon project building a Davis-citywide bike safety scorer + safety-prioritized router using Street View + Gemini vision + OSMnx
type: project
---

HackDavis 2026 project. Goal: a "Street View agent" walks Davis virtually, scores every road segment for cyclist safety, then routes users along safest (not fastest) paths.

**Stack decisions**
- Backend: Python + FastAPI
- Frontend: Next.js + Mapbox GL JS
- Vision model: Gemini 2.5 Flash (cheap, fast, good enough for multi-factor scoring)
- Routing: OSMnx + NetworkX Dijkstra (chose over OSRM because hackathon timeline — OSRM custom-profile rebuild is fiddly)
- Storage: SQLite (no setup, fits hackathon scope)
- Coverage: Davis citywide, ~3k sample points, ~$5 Gemini + ~$21 Street View

**Why:** Routing for cyclists usually optimizes speed/distance, ignoring whether the route is actually safe. Gemini-scored Street View imagery gives us a per-edge safety score we can plug into Dijkstra as `cost = distance × (1 + λ × (10 − score))`.

**How to apply:** Default to NetworkX-based routing for any planning. If asked to switch to OSRM, push back unless we have buffer time. Default vision model is Gemini Flash unless quality requires Pro.

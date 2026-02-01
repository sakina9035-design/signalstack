# Signalstack

Signalstack is a lightweight prototype built on the Cloudflare Developer Platform to help Product Managers aggregate, analyze, and prioritize customer feedback.

The system ingests raw feedback, uses AI to extract structured signals, stores them in a serverless database, and surfaces prioritized product insights.

## Live Demo
Cloudflare Worker URL:  
https://dark-surf-d51e.sakina9035.workers.dev

## Architecture Overview
- **Cloudflare Workers** – Serverless execution layer exposing HTTP APIs.
- **Workers AI** – Classifies feedback by theme, urgency, severity, and sentiment.
- **D1 Database** – Stores structured feedback and enables aggregation and prioritization.

## Key Endpoints
- `/seed` – Inserts mock feedback data
- `/stats` – Returns a high-level product health summary
- `/clusters` – Returns prioritized feedback clusters with insights and recommendations

## Notes
This prototype is intentionally minimal and focused on validating feedback prioritization rather than production hardening.

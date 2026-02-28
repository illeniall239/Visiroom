# Visual Commerce AI - Context

This file logs the PowerShell commands executed during the implementation and their relevant outputs for context.

## 1. Scaffold Node.js API Gateway
`mkdir api-gateway; cd api-gateway; npm init -y; npm install express cors dotenv socket.io`

## 2. Scaffold Python CV Service
`mkdir cv-service; cd cv-service; python -m venv venv`

## 3. Scaffold Next.js Frontend
`npx create-next-app@latest frontend --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm --yes`

## 4. Install API Gateway Dependencies
`cd api-gateway; npm install uuid; npm install -D nodemon`

## 5. Build CV Service (Python)
Installed `fastapi`, `uvicorn`, `python-multipart` and `pydantic`.
Created `main.py` with endpoints for depth estimation, segmentation, and lighting analysis (with structural mocks to prevent massive model downloads locally).

## 6. Generation Pipeline & WebSockets
`cd api-gateway; npm install bullmq ioredis`
Implemented BullMQ with Redis via `queue.js`, worker in `generationWorker.js`, and WebSocket events via `socket.io` in the API gateway.

## 7. Frontend React SPA
`cd frontend; npm install socket.io-client uuid; npm install -D @types/uuid`
Created Next.js frontend with `page.tsx`, `Uploader.tsx`, and `Progress.tsx` components handling drag-and-drop file uploads and live WebSocket progress updates.

## 8. Security & Production Readiness
`cd api-gateway; npm install express-rate-limit helmet`

## 9. Pivot to Supabase Storage & Postgres
`cd api-gateway; npm install @supabase/supabase-js multer`
Moved away from local database/disk storage. 
Rewrote `upload.js` to buffer files into memory via `multer` and push them into Supabase Storage.

## 10. Pivot to Upstash Redis
Removed the local `docker-compose.yml` entirely. Updated `.env.example` and `queue.js` to accept `rediss://` TLS URLs. The project now requires zero local Docker infrastructure to run, utilizing serverless free tiers (Supabase + Upstash) instead.

## 12. Frontend Pivot to Puter.js
In order to bypass Google AI API limits entirely and scale infinitely for free, we integrated `puter.js` directly into the Next.js frontend (`layout.tsx` and `page.tsx`). The frontend now generates the image directly in the user's browser, relying on Puter's "User-Pays" billing model. No backend queue is required for the AI call anymore.
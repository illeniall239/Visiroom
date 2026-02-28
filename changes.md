# Visual Commerce AI - Changes

This file tracks file modifications and key changes made during the implementation of the project.

---

## Phase 1 — Initial Scaffold

- Created `api-gateway` folder with basic `package.json` and installed `express`, `cors`, `dotenv`, and `socket.io`.
- Created `cv-service` folder with a Python virtual environment (`venv`).
- Scaffolded Next.js frontend in `frontend` folder.
- Added `start` and `dev` scripts to `api-gateway/package.json`.
- Implemented `main.py` in `cv-service` as a FastAPI application containing endpoints for Scene Analysis (Depth, Segmentation, Lighting).
- Installed `bullmq` and `ioredis` in `api-gateway`.
- Created `queue.js` and `generationWorker.js` in `api-gateway` for background processing and WebSocket progress tracking.
- Created `ai.js` providing an abstraction layer over external AI generation APIs.
- Integrated generation endpoints into `index.js` along with WebSocket updates.
- Added frontend components (`Uploader.tsx`, `Progress.tsx`) and main page logic (`page.tsx`) in Next.js to handle file uploads, API requests, and WebSocket tracking.
- Added `helmet` and `express-rate-limit` to API Gateway `index.js` for production security and cost protection.

---

## Phase 2 — Supabase + Upstash Integration

- Installed `@supabase/supabase-js` and `multer` in `api-gateway`.
- Created `src/services/supabase.js` for database and storage initialization.
- Rewrote `api-gateway/src/routes/upload.js` to use `multer.memoryStorage()` and upload directly to Supabase Storage (bucket `visual-commerce`).
- Removed local `uploads/` static directory serving from `index.js`.
- Created `supabase_schema.sql` at the root for easy table/bucket setup in the Supabase Dashboard.
- Removed `docker-compose.yml` entirely — the project now uses zero local Docker infrastructure (Supabase + Upstash replace local Postgres + Redis).
- Updated `api-gateway/src/services/queue.js` to use `rediss://` TLS connection format for Upstash.
- Updated `api-gateway/src/services/ai.js` to call Google AI Studio (Gemini) via REST fetch, encoding the image as base64 `inlineData`.

---

## Phase 3 — Puter.js Pivot (later reversed)

- Added `<script src="https://js.puter.com/v2/"></script>` to `frontend/src/app/layout.tsx`.
- Rewrote `handleUploadComplete` in `page.tsx` to call `window.puter.ai.txt2img()` client-side, bypassing the backend queue.
- Replaced the mock `ProductSelector` with a dual-upload flow (product image + room image → canvas composite).

---

## Phase 4 — Full Pipeline Repair (Major Rewrite)

The Puter.js approach was removed and the original BullMQ/Socket.IO pipeline was properly wired end-to-end.

### `api-gateway/src/services/ai.js`
- Now downloads the composite image from Supabase Storage URL and passes it as base64 `inlineData` to Google AI (previously only sent a text prompt).
- Updated the Gemini model endpoint to `gemini-2.5-flash-image`.

### `api-gateway/src/workers/generationWorker.js`
- Updated prompt to use the composite image reference box approach.
- Worker reads `socketId` from `generationMap` at emit time (not stale job data) to support reconnect scenarios.
- Changed `supabase.insert()` → `supabase.upsert()` for idempotent retries.
- Added `job.attemptsMade` check — only marks `status: 'failed'` on the final retry, not on intermediate failures.

### `api-gateway/src/index.js`
- CORS now reads `process.env.CORS_ORIGIN || '*'`.
- Added `app.set('trust proxy', 1)` for correct IP detection behind Cloud Run's load balancer.
- Added `generationMap` (in-memory `Map<generationId, socketId>`) for reconnect support.
- Added Socket.IO `rejoin` event handler to update `generationMap` when a client reconnects.
- Increased rate limit from 3 → 20 requests per IP per day.

### `frontend/src/app/page.tsx`
- `API_URL` now reads from `process.env.NEXT_PUBLIC_GATEWAY_URL`.
- `handleUploadComplete` now uploads the composite canvas image directly to Supabase Storage, then calls the gateway `/api/generate` with `imageKey` + `socketId`.
- Supabase client moved to a lazy `getSupabase()` initializer to avoid "supabaseUrl is required" errors at module load time before env vars are available.
- Added `activeGenerationIdRef` — stores the in-flight `generationId`; emits `rejoin` to gateway on socket reconnect.
- Polling fallback uses `.maybeSingle()` instead of `.single()` to avoid 406 when the row doesn't exist yet.
- Replaced CSS `animate-in` transitions with Framer Motion (`AnimatePresence`, `motion.*`) throughout the full page.
- Removed puter.com `<script>` tag from `layout.tsx`.

### `frontend/next.config.ts`
- Added `output: 'standalone'` for Docker multi-stage build support.

### `frontend/package.json`
- Added `@supabase/supabase-js` and `framer-motion`.

---

## Phase 5 — Containerization + CI/CD

### Dockerfiles created
- `frontend/Dockerfile` — multi-stage build: `builder` runs `npm ci` + `next build`; `runner` copies only the standalone output (~150MB final image).
  - Added `ARG`/`ENV` declarations for `NEXT_PUBLIC_*` variables so they are baked into the bundle at build time.
- `api-gateway/Dockerfile` — node:20-alpine, production deps only. Added `ENV NODE_ENV=production` to prevent pino-pretty loading (dev-only dependency).
- `cv-service/Dockerfile` — python:3.11-slim.

### `.github/workflows/deploy.yml` created
- Three parallel deploy jobs: `deploy-frontend`, `deploy-gateway`, `deploy-cv-service`.
- All three blocked by a `test` job that runs Jest + Vitest first.
- Auth via `credentials_json: ${{ secrets.GCP_SA_KEY }}` (service account JSON key — WIF was attempted but failed due to configuration constraints).
- Images tagged with `${{ github.sha }}` for full traceability and instant rollback.
- Frontend build passes `NEXT_PUBLIC_*` vars as Docker `--build-arg` sourced from GCP Secret Manager at CI time.
- Gateway deployed with `--set-secrets` mapping GCP Secret Manager secrets to env vars.

### `.gitignore` created
- Protects `.env` files, `node_modules`, `__pycache__`, `.next`, build artifacts.

---

## Phase 6 — GCP Infrastructure Setup

- Created GCP project `visiroom-app`.
- Enabled APIs: Cloud Run, Artifact Registry, Secret Manager, Cloud Build, IAM, Container Registry.
- Created Artifact Registry Docker repository `visiroom` in `us-central1`.
- Stored 6 secrets in Secret Manager: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `REDIS_URL`, `GOOGLE_AI_KEY`, `GATEWAY_URL`, `FRONTEND_URL`.
- Created service account `github-deployer` with roles: Artifact Registry Writer, Cloud Run Admin, Secret Manager Secret Accessor, Service Account User.
- Granted Cloud Run runtime service account (`*-compute@developer.gserviceaccount.com`) `secretmanager.secretAccessor` role.
- Updated `GATEWAY_URL` and `FRONTEND_URL` secrets after first successful deploy with real Cloud Run URLs.
- Updated `GOOGLE_AI_KEY` secret to a new API key when the original key was replaced.

---

## Phase 7 — Testing Suite

### `api-gateway`
- Installed `jest` and `supertest` as devDependencies.
- Added Jest config to `package.json` (`testEnvironment: node`, `testMatch: **/__tests__/**/*.test.js`, `coverageThreshold: 60%`).
- Created `src/__tests__/routes/generate.test.js` — 5 integration tests (400 on missing fields, 200 + correct enqueue args, 500 on Redis failure).
- Created `src/__tests__/routes/upload.test.js` — 5 integration tests (400 no file, 400 wrong MIME, 200 JPEG/PNG, 500 Supabase error).
- Created `src/__tests__/services/ai.test.js` — 5 unit tests (no key → error, 429 → error, image response → base64 URL, text-only → error, download failure → error).
- Created `src/__tests__/workers/generationWorker.test.js` — 7 unit tests (BullMQ Worker constructor mocked to capture processor; tests generationMap socket resolution, upsert vs insert, attemptsMade gating, progress events).
- Updated `ai.test.js` after Phase 4 changed fallback behavior from `success: true` to `success: false`.

### `frontend`
- Installed `vitest`, `@vitejs/plugin-react`, `jsdom`, `@testing-library/react`, `@testing-library/jest-dom`, `@testing-library/user-event`.
- Created `vitest.config.ts`.
- Created `src/__tests__/setup.ts`.
- Created `src/__tests__/components/Uploader.test.tsx` — 5 tests.
- Created `src/__tests__/components/Progress.test.tsx` — 5 tests.
- Created `src/__tests__/components/ProductSelector.test.tsx` — 4 tests (component later removed from page but tests retained).

---

## Phase 8 — Bug Fixes During Deployment

| Fix | File | Root Cause |
|---|---|---|
| `clearInterval` null check | `page.tsx` | TypeScript strict null — `clearInterval(null)` not allowed |
| Lazy `getSupabase()` initializer | `page.tsx` | `createClient()` called at module load before `NEXT_PUBLIC_*` vars were available |
| Type cast on `.single()` result | `page.tsx` | TypeScript `never` type from chained Supabase call |
| `\|\| ""` on `generated_image_url` | `page.tsx` | `string \| null` not assignable to `string` state setter |
| `ENV NODE_ENV=production` in Dockerfile | `api-gateway/Dockerfile` | `pino-pretty` (devDep) was being required in production, crashing the container |
| `trust proxy: 1` | `api-gateway/src/index.js` | Rate limiter seeing load balancer IP instead of client IP behind Cloud Run |
| Docker `--build-arg` for `NEXT_PUBLIC_*` | `deploy.yml` + `frontend/Dockerfile` | Cloud Run runtime injection is too late — Next.js bakes these at build time |
| Removed `GOOGLE_API_KEY` from frontend `--set-secrets` | `deploy.yml` | Secret didn't exist in Secret Manager; leftover from old config |
| `.maybeSingle()` instead of `.single()` | `page.tsx` | `.single()` returns 406 when no row exists; polling starts before worker writes the row |
| RLS policies on `generations` table | `supabase_rls.sql` | Supabase enables RLS by default — no policy = all requests denied |
| `as const` on cubic bezier array | `page.tsx` | Framer Motion `Variants` type requires tuple `[n,n,n,n]`, not `number[]` |

---

## Phase 9 — AI Error Handling

- `api-gateway/src/services/ai.js` updated: all three silent fallback paths (no key, 429, text-only) now return `{ success: false, error: "..." }` instead of a placeholder Unsplash image.
- `ai.test.js` updated to assert `success: false` for these paths.

---

## Phase 10 — Supabase Schema

- `supabase_schema.sql` updated: `generations` table definition corrected to match actual gateway writes (`id TEXT PRIMARY KEY`, no `NOT NULL` on `original_image_url`).
- `supabase_rls.sql` created: standalone file containing only the three RLS policies, for easy copy-paste into the Supabase SQL editor.

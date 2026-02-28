# Visual Commerce AI - Changes

This file tracks file modifications and key changes made during the implementation of the project.

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
- **Supabase Integration:**
  - Installed `@supabase/supabase-js` in `api-gateway`.
  - Created `src/services/supabase.js` for database and storage initialization.
  - Rewrote `api-gateway/src/routes/upload.js` to use `multer.memoryStorage()` and upload directly to Supabase Storage (bucket `visual-commerce`).
  - Removed local `uploads/` static directory serving from `index.js`.
  - Created `supabase_schema.sql` at the root for easy table/bucket setup in the Supabase Dashboard.
  - Created `.env.example` in `api-gateway` for easy configuration tracking.
- **Upstash Redis Integration:**
  - Removed `docker-compose.yml` entirely, making the project 100% serverless/cloud-managed with zero local Docker dependencies.
  - Updated `api-gateway/src/services/queue.js` to use connection properties (`enableReadyCheck: false`, `keepAlive`) optimized for Upstash's TLS architecture.
  - Updated `api-gateway/.env.example` to reference the Upstash TLS URL format.
- **Google AI Studio (Gemini/Imagen) Integration:**
  - Updated `api-gateway/src/services/ai.js` to implement a REST fetch call targeted at the Google AI Studio endpoint for image generation, formatting the response from base64.
  - Added `GOOGLE_AI_STUDIO_API_KEY` to `api-gateway/.env.example`.
  - Updated `system_design.txt` to explain the architectural choice of outsourcing AI generation to Google AI Studio.
- **Frontend Puter.js AI Integration:**
  - Added `<script src="https://js.puter.com/v2/"></script>` to `frontend/src/app/layout.tsx`.
  - Rewrote `frontend/src/app/page.tsx`'s `handleUploadComplete` method to call `window.puter.ai.txt2img(prompt)` entirely client-side, abandoning the backend queue for generation in favor of Puter's popup-based free tier authentication loop.
  - Replaced the mock `ProductSelector` catalog in `frontend/src/app/page.tsx` with a dual-upload flow. Users now upload their own product image (saved as base64) followed by their room image, combining both into a single reference canvas for the AI.
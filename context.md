# Visual Commerce AI - Context

This file logs the commands executed during implementation and their relevant outputs for context.

---

## 1. Scaffold Node.js API Gateway
```bash
mkdir api-gateway; cd api-gateway; npm init -y
npm install express cors dotenv socket.io
```

## 2. Scaffold Python CV Service
```bash
mkdir cv-service; cd cv-service; python -m venv venv
pip install fastapi uvicorn python-multipart pydantic
```

## 3. Scaffold Next.js Frontend
```bash
npx create-next-app@latest frontend --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm --yes
```

## 4. Install API Gateway Dependencies
```bash
cd api-gateway
npm install uuid bullmq ioredis @supabase/supabase-js multer helmet express-rate-limit rate-limit-redis pino pino-http pino-pretty
npm install -D nodemon
```

## 5. Install Frontend Dependencies
```bash
cd frontend
npm install socket.io-client uuid @supabase/supabase-js framer-motion
npm install -D @types/uuid
```

## 6. Build CV Service (Python)
Installed `fastapi`, `uvicorn`, `python-multipart`, `pydantic`.
Created `main.py` with mocked endpoints for depth estimation, segmentation, and lighting analysis.

## 7. Generation Pipeline & WebSockets
Implemented BullMQ queue in `queue.js`, BullMQ worker in `generationWorker.js`, and Socket.IO event emission in `index.js`.
Worker emits progress events at 25%, 50%, 75%, 90%, and 100%.

## 8. Security & Production Readiness
```bash
cd api-gateway
npm install express-rate-limit helmet rate-limit-redis
```
Rate limiter backed by Upstash Redis so all Cloud Run instances share one counter.

## 9. Pivot to Supabase Storage & Postgres
```bash
cd api-gateway; npm install @supabase/supabase-js multer
```
Moved away from local database/disk. Rewrote `upload.js` to buffer files into memory via `multer` and push them into Supabase Storage.

## 10. Pivot to Upstash Redis
Removed local `docker-compose.yml` entirely. Updated `queue.js` to accept `rediss://` TLS URLs. Zero local infrastructure required.

## 11. Pipeline Repair — ai.js
Rewrote `ai.js` to:
1. Fetch the composite image URL from Supabase Storage
2. Convert to base64
3. Pass as `inlineData` to Gemini API alongside the text prompt

Previously only a text prompt was sent — no image data reached the AI.

## 12. Pipeline Repair — Frontend
Rewrote `handleUploadComplete` in `page.tsx`:
1. Draw composite canvas (room + product reference box) in the browser
2. Upload composite directly to Supabase Storage (offload pattern)
3. POST only `imageKey` + `socketId` + `generationId` to `/api/generate`
4. Listen for Socket.IO `generation-progress` / `generation-complete` / `generation-error` events
5. Start Supabase polling fallback simultaneously (`.maybeSingle()` every 3 seconds)

## 13. Removed Puter.js
```bash
# Removed from layout.tsx:
# <script src="https://js.puter.com/v2/"></script>
```
Puter.js was a temporary workaround. The full BullMQ/Socket.IO pipeline now handles generation end-to-end.

## 14. Containerization — Docker
Created Dockerfiles for all three services:

**frontend/Dockerfile** (multi-stage):
```dockerfile
FROM node:20-alpine AS builder
# Build with NEXT_PUBLIC_* vars baked in via ARG/ENV
ARG NEXT_PUBLIC_GATEWAY_URL
ENV NEXT_PUBLIC_GATEWAY_URL=$NEXT_PUBLIC_GATEWAY_URL
RUN npm run build

FROM node:20-alpine AS runner
ENV NODE_ENV=production
COPY --from=builder /app/.next/standalone ./
CMD ["node", "server.js"]
```

**api-gateway/Dockerfile**:
```dockerfile
FROM node:20-alpine
ENV NODE_ENV=production   # prevents pino-pretty crash (devDep only)
RUN npm ci --omit=dev
CMD ["node", "src/index.js"]
```

**cv-service/Dockerfile**:
```dockerfile
FROM python:3.11-slim
RUN pip install -r requirements.txt
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080"]
```

## 15. GCP Infrastructure Setup
```bash
# Create project
gcloud projects create visiroom-app --name="VisiRoom"
gcloud config set project visiroom-app
gcloud billing projects link visiroom-app --billing-account=01F5B5-AD5EF2-950061

# Enable APIs
gcloud services enable run.googleapis.com artifactregistry.googleapis.com \
  secretmanager.googleapis.com cloudbuild.googleapis.com iam.googleapis.com

# Artifact Registry
gcloud artifacts repositories create visiroom \
  --repository-format=docker --location=us-central1

# Secrets
echo -n "https://acauvbuacdcuvixwyrgj.supabase.co" | gcloud secrets create SUPABASE_URL --data-file=-
echo -n "eyJ..." | gcloud secrets create SUPABASE_ANON_KEY --data-file=-
echo -n "rediss://..." | gcloud secrets create REDIS_URL --data-file=-
echo -n "AIzaSy..." | gcloud secrets create GOOGLE_AI_KEY --data-file=-
# GATEWAY_URL and FRONTEND_URL added after first deploy with real Cloud Run URLs

# Service account for GitHub Actions
gcloud iam service-accounts create github-deployer
gcloud projects add-iam-policy-binding visiroom-app \
  --member="serviceAccount:github-deployer@visiroom-app.iam.gserviceaccount.com" \
  --role="roles/artifactregistry.writer"
gcloud projects add-iam-policy-binding visiroom-app \
  --member="serviceAccount:github-deployer@visiroom-app.iam.gserviceaccount.com" \
  --role="roles/run.admin"
# + secretmanager.secretAccessor, iam.serviceAccountUser

# Generate SA key for GitHub secret
gcloud iam service-accounts keys create key.json \
  --iam-account=github-deployer@visiroom-app.iam.gserviceaccount.com
# Contents stored as GCP_SA_KEY in GitHub repo secrets

# Grant Cloud Run runtime SA access to secrets
gcloud projects add-iam-policy-binding visiroom-app \
  --member="serviceAccount:1091829322232-compute@developer.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

## 16. GitHub Repository Setup
```bash
git init
git remote add origin https://github.com/illeniall239/Visiroom.git

# Remove embedded .git from frontend (was a nested repo)
git rm --cached frontend
# Deleted frontend/.git manually
git add frontend/
git push -u origin main
```

## 17. CI/CD Pipeline — GitHub Actions
Created `.github/workflows/deploy.yml` with 4 jobs:
- `test` — runs `npm test` in api-gateway (Jest) and frontend (Vitest)
- `deploy-frontend` — builds Docker image with `NEXT_PUBLIC_*` build args, pushes to Artifact Registry, deploys to Cloud Run
- `deploy-gateway` — builds Docker image, deploys to Cloud Run with `--set-secrets`
- `deploy-cv-service` — builds Docker image, deploys to Cloud Run with `--no-allow-unauthenticated`

All deploy jobs have `needs: test` — a failing test blocks all deployments.

Images tagged with `${{ github.sha }}` for exact traceability and rollback.

## 18. Deployment Fixes (iterative)
Issues encountered and resolved during CI/CD runs:

| Run | Error | Fix |
|---|---|---|
| 1 | WIF auth: "must specify workload_identity_provider or credentials_json" | Switched to SA JSON key (`GCP_SA_KEY`) |
| 2 | Image path had space: `us-central1-docker.pkg.dev/*** /visiroom` | Secret had trailing whitespace — hardcoded `PROJECT_ID: visiroom-app` in workflow |
| 3 | TypeScript: `clearInterval` on `null` not allowed | Added `if (pollInterval) clearInterval(pollInterval)` guards |
| 4 | Gateway crash: `Cannot find module 'pino-pretty'` | Added `ENV NODE_ENV=production` to api-gateway Dockerfile |
| 5 | Frontend crash: `supabaseUrl is required` | Moved to lazy `getSupabase()` + added `ARG/ENV` in Dockerfile + `--build-arg` in CI |
| 6 | TypeScript: `never` type on Supabase result | Added explicit type cast |
| 7 | TypeScript: `string \| null` not assignable to `string` | Added `|| ""` fallback |
| 8 | `Secret GOOGLE_API_KEY not found` | Removed leftover secret ref from frontend `--set-secrets` |
| 9 | Rate limiter `ERR_ERL_FORWARDED_HEADER` | Added `app.set('trust proxy', 1)` |
| 10 | Supabase 406 on generations poll | Created `supabase_rls.sql` with 3 RLS policies |
| 11 | Supabase 406 on missing row | Changed `.single()` to `.maybeSingle()` |
| 12 | TypeScript: `number[]` not assignable to `Easing` in Variants | Added `as const` to cubic bezier array in Framer Motion variants |

## 19. Testing Suite Setup
```bash
# api-gateway
cd api-gateway
npm install --save-dev jest supertest

# frontend
cd frontend
npm install --save-dev vitest @vitejs/plugin-react jsdom \
  @testing-library/react @testing-library/jest-dom @testing-library/user-event
```

22 api-gateway tests pass (Jest). Frontend component tests pass (Vitest).
CI runs all tests before any Docker build.

## 20. Supabase Setup
1. Created `visual-commerce` storage bucket (public) via `supabase_schema.sql`
2. Created `generations` table manually in Supabase SQL editor
3. Applied RLS policies from `supabase_rls.sql`:
   - `allow_read` (SELECT — for frontend polling)
   - `allow_insert` (INSERT — for gateway worker)
   - `allow_update` (UPDATE — for gateway worker status updates)

## 21. Live URLs
| Service | URL |
|---|---|
| Frontend | https://visiroom-frontend-xf6ga6iqoa-uc.a.run.app |
| API Gateway | https://visiroom-gateway-xf6ga6iqoa-uc.a.run.app |
| CV Service | https://visiroom-cv-service-xf6ga6iqoa-uc.a.run.app (internal only) |
| GitHub Repo | https://github.com/illeniall239/Visiroom |
| Supabase Project | https://supabase.com/dashboard/project/acauvbuacdcuvixwyrgj |

## 22. Rate Limit Management
Rate limiter: 20 requests per IP per 24 hours, backed by Upstash Redis.
To reset all counters (e.g., during testing): Upstash Console → Redis database → CLI → `FLUSHDB`.
To update the Google AI key without redeploying:
```bash
echo -n "NEW_KEY" | gcloud secrets versions add GOOGLE_AI_KEY --data-file=- --project=visiroom-app
gcloud run services update visiroom-gateway --region=us-central1 --project=visiroom-app \
  --update-secrets="GOOGLE_AI_STUDIO_API_KEY=GOOGLE_AI_KEY:latest"
```

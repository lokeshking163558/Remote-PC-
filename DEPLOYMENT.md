# RemoteHub Production Deployment Guide

This guide provides end-to-end instructions for deploying RemoteHub to production.

---

## Architecture Overview

RemoteHub is composed of three interconnected parts:
1. **Frontend Web App (`client/`)**: Single-page application built with React 19, Vite, and Tailwind CSS. Hosted on **Vercel** or any static hosting platform.
2. **Backend Gateway & Signaling Server (`server/`)**: Express REST API + WebSocket Server (`ws`) for device heartbeats, WebRTC signaling, screen frame relays, and binary agent downloads. Supports dual-mode transport: persistent WebSockets or serverless HTTP polling.
3. **Database Layer**: Dual-mode engine supporting **PostgreSQL** in production (via `DATABASE_URL`) with automatic schema initialization and SQLite fallback for local development.

> [!IMPORTANT]
> **Permanent Database Persistence (Eliminating Login Failures & Lost Devices):**
> If your server runs on Vercel Serverless without a `DATABASE_URL`, each serverless cold-start or container recycled will spin up a fresh temporary container where SQLite resets, causing "Invalid email or password" or disappearing devices.
> 
> **To make user accounts, permanent sessions, and paired devices completely permanent:**
> 1. Create a free PostgreSQL database on [Neon](https://neon.tech), [Supabase](https://supabase.com), or [Render](https://render.com).
> 2. Copy the Connection String URI (e.g. `postgresql://user:password@ep-cool-fog-12345.us-east-2.aws.neon.tech/neondb?sslmode=require`).
> 3. Add `DATABASE_URL` to your Vercel Environment Variables:
>    - Go to **Vercel Project Dashboard** -> **Settings** -> **Environment Variables**.
>    - Add Name: `DATABASE_URL`, Value: `<Your-PostgreSQL-URI>`.
>    - Also ensure `JWT_SECRET` is set to a fixed random string (e.g., `remotehub-master-jwt-secret-2026`).
> 4. Redeploy the server. RemoteHub will automatically connect to PostgreSQL and run all required migrations on startup. Your sessions, users, and devices will now persist forever!

---

## 1. Deploying the Backend Gateway

### Option A: 1-Click Deploy on Render (Recommended)

1. Log into your [Render Dashboard](https://dashboard.render.com/).
2. Click **New +** -> **Blueprint**.
3. Connect your GitHub repository (`https://github.com/lokeshking163558/Remote-PC-.git`).
4. Render will automatically detect [`render.yaml`](file:///c:/Users/Loki/OneDrive/Documents/remote%20desktop%20project/render.yaml) and configure:
   - Web Service: Node 20+, `npm install`, `npm run build`, `npm start`
   - Managed PostgreSQL instance automatically provisioned and linked via `DATABASE_URL`
5. Configure Environment Variables in Render:
   - `JWT_SECRET`: Generate a secure random string (e.g., `openssl rand -hex 32`)
   - `SESSION_HMAC_SECRET`: Generate a second secure random string
   - `CORS_ORIGIN`: `https://remote-pc-green.vercel.app` (your Vercel frontend URL)
6. Click **Apply**. Once deployed, Render will provide your backend URL (e.g., `https://remote-pc-server.onrender.com`).

### Option B: Deploy on Railway

1. In [Railway](https://railway.app/), create a **New Project**.
2. Add a **PostgreSQL** database.
3. Add a **GitHub Repo** service pointing to `server/` directory (or use the root `Dockerfile`).
4. Set Environment Variables:
   - `DATABASE_URL`: Automatically linked from the Postgres service.
   - `JWT_SECRET`: Random 64-char string.
   - `SESSION_HMAC_SECRET`: Random 64-char string.
   - `CORS_ORIGIN`: `https://remote-pc-green.vercel.app`
   - `PORT`: `5000`
5. Generate a Public Domain for the server service.

### Option C: Docker / VPS Deployment

A production-ready [`Dockerfile`](file:///c:/Users/Loki/OneDrive/Documents/remote%20desktop%20project/Dockerfile) and [`docker-compose.yml`](file:///c:/Users/Loki/OneDrive/Documents/remote%20desktop%20project/docker-compose.yml) are included in the repository.

```bash
# Clone the repository on your server
git clone https://github.com/lokeshking163558/Remote-PC-.git
cd Remote-PC-

# Copy and configure environment variables
cp .env.example .env
nano .env

# Start with Docker Compose
docker-compose up -d --build
```

---

## 2. Deploying the Frontend on Vercel

1. Log into [Vercel](https://vercel.com/) and navigate to your project (`remote-pc-green`).
2. Go to **Settings** -> **General**:
   - **Root Directory**: `client`
   - **Framework Preset**: `Vite`
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`
3. Go to **Settings** -> **Environment Variables**:
   - Add `VITE_API_URL` = `https://<YOUR-BACKEND-DOMAIN>` (e.g., `https://remote-pc-server.onrender.com` or your deployed backend URL).
4. Trigger a **Redeploy** on Vercel so Vite bakes the `VITE_API_URL` into the production JavaScript bundles.

---

## 3. Windows Desktop Agent Distribution

### Direct Server Downloads

The RemoteHub server hosts the compiled Windows Agent and checksums directly:
- Executable: `https://<YOUR-BACKEND-DOMAIN>/api/downloads/windows-agent`
- Checksum & Instructions: `https://<YOUR-BACKEND-DOMAIN>/api/downloads/windows-agent.txt`
- Version & Metadata: `https://<YOUR-BACKEND-DOMAIN>/api/downloads/info`

### Automated GitHub Actions Releases

The repository includes a GitHub Actions workflow: [`.github/workflows/build-and-release.yml`](file:///c:/Users/Loki/OneDrive/Documents/remote%20desktop%20project/.github/workflows/build-and-release.yml).

To publish a new agent release:
```bash
git tag v1.0.0
git push origin v1.0.0
```

GitHub Actions will automatically:
1. Check out code and set up .NET 8 SDK on `windows-latest`.
2. Compile `RemoteHubAgent.exe` in `Release` configuration.
3. Compute the SHA-256 cryptographic hash.
4. Publish a GitHub Release with `RemoteHubAgent.exe` and `windows-agent.txt` attached.

---

## 4. Post-Deployment Verification Checklist

Verify your production deployment using these standard checks:

1. **API Health**:
   ```bash
   curl -I https://<YOUR-BACKEND-DOMAIN>/api/health
   # Expected: HTTP/1.1 200 OK, {"status":"healthy"}
   ```
2. **Agent Download**:
   ```bash
   curl -I https://<YOUR-BACKEND-DOMAIN>/api/downloads/windows-agent
   # Expected: HTTP/1.1 200 OK, Content-Type: application/vnd.microsoft.portable-executable
   ```
3. **Agent Checksum File**:
   ```bash
   curl https://<YOUR-BACKEND-DOMAIN>/api/downloads/windows-agent.txt
   # Expected: RemoteHub Windows Agent SHA-256 checksum and install instructions
   ```
4. **User Registration & Login**:
   - Open frontend in browser: `https://remote-pc-green.vercel.app`
   - Register a new account.
   - Verify redirect to the dashboard without any `404` or CORS errors.
5. **Add Device**:
   - Click "Add Computer" and generate a 6-digit pairing code.
   - Run `RemoteHubAgent.exe` on your Windows host, pair with code and PIN.
   - Device status updates to **Online & Ready**.
6. **Remote Control & Host Approval**:
   - Click "Connect" and enter device PIN.
   - Host Windows laptop displays the 30-second approval modal.
   - Click "Approve" -> Live desktop stream begins with full touch/mouse and keyboard control.


import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import express from 'express';
import cors from 'cors';
import { initDatabase } from './db.js';
import { setupWebSocketServer } from './websocket.js';
import { authRouter } from './routes/auth.js';
import { devicesRouter } from './routes/devices.js';
import { sessionsRouter } from './routes/sessions.js';

// Initialize SQLite database
initDatabase();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors({
  origin: true,
  credentials: true
}));

app.use(express.json({ limit: '10mb' }));

// Request logging in development
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    if (!req.path.startsWith('/ws') && !req.path.startsWith('/api/health')) {
      console.log(`[HTTP] ${req.method} ${req.path} -> ${res.statusCode} (${duration}ms)`);
    }
  });
  next();
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'RemoteHub Backend & Signaling',
    uptime: process.uptime(),
    timestamp: Date.now()
  });
});

// API Routes
app.use('/api/auth', authRouter);
app.use('/api/devices', devicesRouter);
app.use('/api/sessions', sessionsRouter);

// Endpoints to download the Windows RemoteHub Agent and metadata
const DIRECT_GITHUB_AGENT_EXE = 'https://github.com/lokeshking163558/Remote-PC-/raw/main/server/downloads/RemoteHubAgent.exe';
const DIRECT_GITHUB_AGENT_TXT = 'https://github.com/lokeshking163558/Remote-PC-/raw/main/windows-agent.txt';

app.get('/api/downloads/windows-agent', (req, res) => {
  const binaryPaths = [
    path.resolve(process.cwd(), 'downloads/RemoteHubAgent.exe'),
    path.resolve(process.cwd(), 'server/downloads/RemoteHubAgent.exe'),
    path.resolve(__dirname, '../downloads/RemoteHubAgent.exe'),
    path.resolve(__dirname, '../../downloads/RemoteHubAgent.exe'),
    path.resolve(__dirname, 'downloads/RemoteHubAgent.exe'),
    path.resolve(process.cwd(), '../agent-windows/bin/Release/net8.0-windows/RemoteHubAgent.exe'),
    path.resolve(process.cwd(), '../agent-windows/bin/Release/net8.0-windows/win-x64/RemoteHubAgent.exe')
  ];

  for (const binPath of binaryPaths) {
    if (fs.existsSync(binPath)) {
      return res.download(binPath, 'RemoteHubAgent.exe');
    }
  }

  // High-reliability fallback to committed GitHub repository binary (Guaranteed 200 OK)
  return res.redirect(DIRECT_GITHUB_AGENT_EXE);
});

app.get('/api/downloads/windows-agent.txt', (req, res) => {
  const txtPaths = [
    path.resolve(process.cwd(), 'downloads/windows-agent.txt'),
    path.resolve(process.cwd(), 'server/downloads/windows-agent.txt'),
    path.resolve(process.cwd(), '../windows-agent.txt'),
    path.resolve(__dirname, '../downloads/windows-agent.txt'),
    path.resolve(__dirname, '../../windows-agent.txt'),
    path.resolve(__dirname, 'downloads/windows-agent.txt')
  ];

  for (const p of txtPaths) {
    if (fs.existsSync(p)) {
      return res.download(p, 'windows-agent.txt');
    }
  }

  return res.redirect(DIRECT_GITHUB_AGENT_TXT);
});

app.get('/api/downloads/info', (req, res) => {
  res.json({
    version: '1.0.0',
    platform: 'Windows 10 / Windows 11 (x64)',
    sha256: 'DF1866C25FF30D01EF5717CCB93F3DA2179EFF6D36C46852656D11987148A83E',
    filename: 'RemoteHubAgent.exe',
    downloadUrl: '/api/downloads/windows-agent',
    directGithubUrl: DIRECT_GITHUB_AGENT_EXE,
    githubReleaseUrl: 'https://github.com/lokeshking163558/Remote-PC-/releases/latest/download/RemoteHubAgent.exe',
    metadataUrl: '/api/downloads/windows-agent.txt'
  });
});

// Serve frontend client in production if built
const clientDist = path.resolve(process.cwd(), '../client/dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/ws')) {
      return next();
    }
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

const server = http.createServer(app);

// Attach WebSocket server for real-time WebRTC signaling and agent communication
setupWebSocketServer(server);

if (!process.env.VERCEL) {
  server.listen(PORT, () => {
    console.log(`=======================================================`);
    console.log(`   RemoteHub Server running on http://localhost:${PORT}`);
    console.log(`   WebRTC Signaling Gateway: ws://localhost:${PORT}/ws/*`);
    console.log(`=======================================================`);
  });
}

export default app;


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

// Endpoint to download the Windows RemoteHub Agent
app.get('/api/downloads/windows-agent', (req, res) => {
  const binaryPaths = [
    path.resolve(process.cwd(), '../agent-windows/bin/Release/net8.0-windows/publish/RemoteHubAgent.exe'),
    path.resolve(process.cwd(), '../agent-windows/bin/Debug/net8.0-windows/RemoteHubAgent.exe'),
    path.resolve(process.cwd(), 'downloads/RemoteHubAgent.exe')
  ];

  for (const binPath of binaryPaths) {
    if (fs.existsSync(binPath)) {
      return res.download(binPath, 'RemoteHubAgent.exe');
    }
  }

  // If binary is still compiling or not yet published, provide helpful instruction
  res.status(404).json({
    error: 'Windows Agent package is currently being built or published. Please run the build script in agent-windows directory.',
    buildInstruction: 'dotnet publish -c Release -r win-x64 --self-contained'
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


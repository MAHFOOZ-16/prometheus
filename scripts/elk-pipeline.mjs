#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════
   PROMETHEUS — Docker Container Monitor
   Watches running Docker containers for logs and health,
   feeds data into the Prometheus analysis pipeline via SSE.
   ═══════════════════════════════════════════════════════════ */

import { createServer } from "node:http";
import { exec, spawn } from "node:child_process";
import { validateReleasePayload } from "../src/release-gatekeeper.mjs";
import { normalizeVendorPayload } from "../src/integration-normalizer.mjs";
import { analyzeIncidentLogs } from "../src/incident-analyst.mjs";

const PORT = Number(process.env.MONITOR_PORT) || 4174;
const POLL_INTERVAL = Number(process.env.POLL_INTERVAL) || 5000;

// ── SSE Clients ──
const clients = new Set();

function broadcast(eventType, data) {
  const payload = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) {
    try { res.write(payload); } catch { clients.delete(res); }
  }
}

// ── Docker Integration ──
function execAsync(cmd) {
  return new Promise((resolve, reject) => {
    exec(cmd, { timeout: 10000 }, (err, stdout, stderr) => {
      if (err && !stdout) return reject(err);
      resolve(stdout.trim());
    });
  });
}

async function getContainers() {
  try {
    const raw = await execAsync('docker ps --format "{{.ID}}|{{.Names}}|{{.Image}}|{{.Status}}|{{.Ports}}" 2>/dev/null');
    if (!raw) return [];
    return raw.split("\n").filter(Boolean).map((line) => {
      const [id, name, image, status, ports] = line.split("|");
      return { id: id?.slice(0, 12), name, image, status, ports, health: status?.includes("healthy") ? "healthy" : status?.includes("unhealthy") ? "unhealthy" : "running" };
    });
  } catch {
    return [];
  }
}

async function getContainerLogs(containerId, tail = 20) {
  try {
    const raw = await execAsync(`docker logs --tail ${tail} --timestamps ${containerId} 2>&1`);
    return raw.split("\n").filter(Boolean).map((line) => {
      const level = /error|fatal|panic/i.test(line) ? "error"
        : /warn/i.test(line) ? "warning"
        : /crit/i.test(line) ? "critical"
        : "info";
      return { level, message: line.replace(/^\S+\s/, ""), raw: line };
    });
  } catch {
    return [];
  }
}

async function getContainerStats(containerId) {
  try {
    const raw = await execAsync(`docker stats --no-stream --format "{{.CPUPerc}}|{{.MemUsage}}|{{.NetIO}}" ${containerId} 2>/dev/null`);
    const [cpu, mem, net] = raw.split("|");
    return { cpu: cpu?.trim(), memory: mem?.trim(), network: net?.trim() };
  } catch {
    return { cpu: "N/A", memory: "N/A", network: "N/A" };
  }
}

// ── Polling Loop ──
let lastContainerState = {};

async function pollDocker() {
  const containers = await getContainers();
  const dockerAvailable = containers.length > 0 || await isDockerRunning();

  if (!dockerAvailable) {
    broadcast("elk-status", { available: false, message: "ELK is not running or not installed" });
    return;
  }

  broadcast("elk-status", { available: true, containerCount: containers.length });
  broadcast("containers", containers);

  for (const container of containers) {
    // Get logs and analyze
    const logs = await getContainerLogs(container.id, 30);
    const errorLogs = logs.filter((l) => l.level === "error" || l.level === "critical" || l.level === "warning");

    if (errorLogs.length > 0) {
      const analysis = analyzeIncidentLogs(errorLogs);
      broadcast("analysis", {
        containerId: container.id,
        containerName: container.name,
        image: container.image,
        ...analysis,
        logSample: errorLogs.slice(0, 5)
      });
    }

    // Get stats
    const stats = await getContainerStats(container.id);
    broadcast("stats", {
      containerId: container.id,
      containerName: container.name,
      ...stats
    });
  }
}

async function isDockerRunning() {
  try {
    await execAsync("docker info --format '{{.ServerVersion}}' 2>/dev/null");
    return true;
  } catch {
    return false;
  }
}

// ── HTTP Server ──
const server = createServer((req, res) => {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  // SSE endpoint
  if (req.url === "/events") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive"
    });
    res.write("event: connected\ndata: {}\n\n");
    clients.add(res);
    req.on("close", () => clients.delete(res));
    return;
  }

  // Manual trigger: analyze a specific container
  if (req.url?.startsWith("/analyze/") && req.method === "GET") {
    const containerId = req.url.split("/")[2];
    getContainerLogs(containerId, 50).then((logs) => {
      const errorLogs = logs.filter((l) => l.level !== "info");
      const analysis = analyzeIncidentLogs(errorLogs.length > 0 ? errorLogs : logs);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ containerId, ...analysis, logCount: logs.length }));
    }).catch((err) => {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    });
    return;
  }

  // Health check
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, clients: clients.size }));
    return;
  }

  res.writeHead(404); res.end("Not Found");
});

server.listen(PORT, () => {
  console.log(`\n  🐳 Prometheus ELK Pipeline running at http://localhost:${PORT}`);
  console.log(`     SSE endpoint: http://localhost:${PORT}/events`);
  console.log(`     Polling interval: ${POLL_INTERVAL}ms\n`);

  // Start polling
  pollDocker();
  setInterval(pollDocker, POLL_INTERVAL);
});

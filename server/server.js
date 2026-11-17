const path = require("path");
const fs = require("fs");

// node:sqlite baru ada di Node 22.5+. Di Node 22.5-22.12 modul ini butuh flag --experimental-sqlite.
let DatabaseSync;
try {
  ({ DatabaseSync } = require("node:sqlite"));
} catch (e) {
  if (!process.execArgv.includes("--experimental-sqlite") && Number(process.versions.node.split(".")[0]) >= 22) {
    console.log("Mengulang server dengan --experimental-sqlite ...");
    const r = require("child_process").spawnSync(process.execPath,
      ["--experimental-sqlite", ...process.execArgv, __filename, ...process.argv.slice(2)], { stdio: "inherit" });
    process.exit(r.status ?? 1);
  }
  console.error(`\nGAGAL: Node.js v${process.versions.node} tidak punya modul SQLite bawaan (node:sqlite).`);
  console.error("Install Node.js 22.13 LTS atau lebih baru dari https://nodejs.org/ lalu jalankan ulang.\n");
  process.exit(1);
}
const express = require("express");
const mqtt = require("mqtt");

const app = express();
const PORT = process.env.PORT || 3000;
const PREFIX = process.env.MQTT_PREFIX || "lalin-adaptif-kiel-2026-7f3a";
const BROKER = process.env.MQTT_URL || "mqtt://broker.hivemq.com:1883";
const DB_PATH = process.env.DB_PATH || path.join(__dirname, "data", "lalin.db");

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA journal_mode = WAL;");
db.exec(`
CREATE TABLE IF NOT EXISTS sensor_readings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL DEFAULT 'esp32',
  density_a INTEGER NOT NULL, density_b INTEGER NOT NULL,
  distance_a REAL NOT NULL, distance_b REAL NOT NULL,
  phase INTEGER, signal_a INTEGER, signal_b INTEGER,
  remaining_seconds INTEGER, mode TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS activity_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS command_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  command TEXT NOT NULL,
  result TEXT NOT NULL DEFAULT 'SENT',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
`);
const insertReading = db.prepare(`INSERT INTO sensor_readings
(source,density_a,density_b,distance_a,distance_b,phase,signal_a,signal_b,remaining_seconds,mode)
VALUES (@source,@dA,@dB,@cA,@cB,@ph,@sA,@sB,@rem,@mode)`);
const insertActivity = db.prepare("INSERT INTO activity_logs(event) VALUES (?)");
const insertCommand = db.prepare("INSERT INTO command_logs(command,result) VALUES (?,?)");

// CORS: dashboard tetap bisa memakai API walau halaman dibuka lewat Live Server (port 5500) / file://
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});
app.use(express.json({ limit: "100kb" }));
app.use("/vendor/mqtt.min.js", (_req, res) => res.sendFile(path.join(__dirname, "node_modules", "mqtt", "dist", "mqtt.min.js")));
app.use(express.static(path.join(__dirname, "..", "web")));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, database: "SQLite", mqttPrefix: PREFIX, mqttConnected: Boolean(mqttClient && mqttClient.connected),
    readings: db.prepare("SELECT COUNT(*) AS n FROM sensor_readings").get().n });
});
app.post("/api/telemetry", (req, res) => {
  const d = req.body || {};
  for (const k of ["dA","dB","cA","cB"]) {
    if (!Number.isFinite(Number(d[k]))) return res.status(400).json({ error: `Field ${k} harus berupa angka` });
  }
  insertReading.run({ source: "demo", dA: +d.dA, dB: +d.dB, cA: +d.cA, cB: +d.cB,
    ph: Number.isInteger(d.ph) ? d.ph : null, sA: Number.isInteger(d.sA) ? d.sA : null,
    sB: Number.isInteger(d.sB) ? d.sB : null, rem: Number.isInteger(d.rem) ? d.rem : null,
    mode: String(d.mode || "DEMO") });
  res.json({ ok: true });
});
app.post("/api/activity", (req, res) => {
  const event = String((req.body || {}).event || "").slice(0, 500);
  if (!event) return res.status(400).json({ error: "Event kosong" });
  insertActivity.run(event);
  res.json({ ok: true });
});
app.delete("/api/activity", (_req, res) => {
  db.exec("DELETE FROM activity_logs");
  res.json({ ok: true });
});
app.post("/api/command", (req, res) => {
  const command = String((req.body || {}).command || "").slice(0, 40);
  if (!["AUTO","FORCE_A","FORCE_B","ALL_RED"].includes(command)) return res.status(400).json({ error: "Perintah tidak dikenal" });
  insertCommand.run(command, "SENT");
  res.json({ ok: true });
});
app.post("/api/command-result", (req, res) => {
  const command = String((req.body || {}).command || "").slice(0, 40);
  const result = String((req.body || {}).result || "SENT").slice(0, 40);
  if (!command || !["OK","FAIL"].includes(result)) return res.status(400).json({ error: "Respons perintah tidak valid" });
  db.prepare("UPDATE command_logs SET result=? WHERE id=(SELECT MAX(id) FROM command_logs WHERE command=?)").run(result, command);
  res.json({ ok: true });
});
app.get("/api/history", (_req, res) => {
  const activities = db.prepare("SELECT id,event AS text,created_at AS time FROM activity_logs ORDER BY id DESC LIMIT 100").all();
  const commands = db.prepare("SELECT id,command,result,created_at AS time FROM command_logs ORDER BY id DESC LIMIT 50").all();
  const readings = db.prepare("SELECT id,source,density_a,density_b,distance_a,distance_b,phase,signal_a,signal_b,remaining_seconds,mode,created_at AS time FROM sensor_readings ORDER BY id DESC LIMIT 50").all();
  res.json({ activities, commands, readings });
});
app.get("/api/readings.csv", (_req, res) => {
  const rows = db.prepare("SELECT created_at,source,density_a,density_b,distance_a,distance_b,phase,signal_a,signal_b,remaining_seconds,mode FROM sensor_readings ORDER BY id DESC").all();
  const header = "waktu,sumber,kepadatan_a,kepadatan_b,jarak_a,jarak_b,fase,sinyal_a,sinyal_b,sisa_detik,mode";
  const csv = [header, ...rows.map(r => Object.values(r).map(v => `"${String(v ?? "").replace(/"/g,'""')}"`).join(","))].join("\n");
  res.type("text/csv").attachment("data-sensor-lalin.csv").send(csv);
});

const mqttClient = mqtt.connect(BROKER, { reconnectPeriod: 3000, connectTimeout: 15000, keepalive: 30, clean: true, clientId: "lalin-db-" + Math.random().toString(16).slice(2,10) });
mqttClient.on("error", (e) => console.error("MQTT error:", e.message));
mqttClient.on("offline", () => console.warn("MQTT offline - mencoba lagi... (API & database tetap berjalan)"));
mqttClient.on("reconnect", () => console.log("Mencoba menyambungkan ulang ke broker MQTT..."));
mqttClient.on("close", () => console.warn("Koneksi MQTT ditutup."));
mqttClient.on("connect", () => {
  console.log("MQTT terhubung:", BROKER, "prefix:", PREFIX);
  mqttClient.subscribe([`${PREFIX}/data`, `${PREFIX}/ack`], { qos: 0 }, (err) => { if (err) console.error("Subscribe MQTT gagal:", err.message); else console.log("Subscribe topic data & ack berhasil"); });
});
mqttClient.on("message", (topic, message) => {
  const value = message.toString();
  if (topic === `${PREFIX}/data`) {
    try {
      const d = JSON.parse(value);
      if (["dA","dB","cA","cB"].every(k => Number.isFinite(Number(d[k])))) {
        insertReading.run({ source: "esp32", dA:+d.dA, dB:+d.dB, cA:+d.cA, cB:+d.cB,
          ph:Number.isInteger(d.ph)?d.ph:null, sA:Number.isInteger(d.sA)?d.sA:null,
          sB:Number.isInteger(d.sB)?d.sB:null, rem:Number.isInteger(d.rem)?d.rem:null, mode:String(d.mode||"AUTO") });
      }
    } catch (e) { console.error("Data MQTT tidak valid:", e.message); }
  } else if (topic === `${PREFIX}/ack`) {
    insertActivity.run("Respons ESP32: " + value);
    const i = value.indexOf(":");
    const result = value.slice(0, i), command = value.slice(i + 1);
    if (i > 0 && ["OK", "FAIL"].includes(result) && command) db.prepare("UPDATE command_logs SET result=? WHERE id=(SELECT MAX(id) FROM command_logs WHERE command=?)").run(result, command);
  }
});

// Jaga ukuran database: simpan maksimal 50.000 pembacaan terakhir
setInterval(() => {
  try { db.exec("DELETE FROM sensor_readings WHERE id <= (SELECT MAX(id) FROM sensor_readings) - 50000"); } catch (e) { console.error(e.message); }
}, 10 * 60 * 1000);

const server = app.listen(PORT, () => console.log(`Dashboard aktif: http://localhost:${PORT}`));
server.on("error", (e) => {
  if (e.code === "EADDRINUSE") console.error(`\nGAGAL: port ${PORT} sudah dipakai program lain (mungkin server lama masih jalan). Tutup dulu, atau jalankan dengan port lain: set PORT=3001 && npm start\n`);
  else console.error(e);
  process.exit(1);
});

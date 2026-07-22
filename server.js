require('dotenv').config();
const express = require('express');
const cors = require('cors');
const webpush = require('web-push');
const cron = require('node-cron');
const path = require('path');
const { readDB, writeDB } = require('./db');

const PORT = process.env.PORT || 3000;

// --- VAPID (llaves para notificaciones push) ---
// Si faltan, la app sigue funcionando igual (recordatorios, historial, seguimientos)
// pero sin poder mandar notificaciones push reales.
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const PUSH_ENABLED = !!(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);

if (!PUSH_ENABLED) {
  console.warn('⚠️  Faltan VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY — la app sigue funcionando, pero sin notificaciones push.');
} else {
  webpush.setVapidDetails(
    'mailto:admin@example.com',
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY
  );
}

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------- Utilidades ----------
function deadlineOf(r) {
  if (!r.date) return null;
  return new Date(r.date + 'T' + (r.time || '23:59'));
}
function isPastDeadline(r) {
  const dl = deadlineOf(r);
  if (!dl) return false;
  return new Date() > dl;
}
function logHistory(db, r, event, note) {
  db.history.unshift({
    id: 'h_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
    ts: Date.now(),
    reminderId: r.id,
    title: r.title,
    category: r.category,
    priority: r.priority,
    event,
    note: note || null
  });
}

// ---------- Rutas ----------

// Llave pública para que el navegador se suscriba
app.get('/api/vapid-public-key', (req, res) => {
  if (!PUSH_ENABLED) return res.status(503).json({ error: 'Notificaciones push no configuradas en el servidor' });
  res.json({ publicKey: VAPID_PUBLIC_KEY });
});

// Guardar una suscripción push del navegador
app.post('/api/subscribe', (req, res) => {
  const db = readDB();
  const subscription = req.body;
  const exists = db.subscriptions.find(s => s.endpoint === subscription.endpoint);
  if (!exists) {
    db.subscriptions.push(subscription);
    writeDB(db);
  }
  res.status(201).json({ ok: true });
});

app.post('/api/unsubscribe', (req, res) => {
  const db = readDB();
  const { endpoint } = req.body;
  db.subscriptions = db.subscriptions.filter(s => s.endpoint !== endpoint);
  writeDB(db);
  res.json({ ok: true });
});

// Recordatorios
app.get('/api/reminders', (req, res) => {
  const db = readDB();
  res.json(db.reminders);
});

app.post('/api/reminders', (req, res) => {
  const db = readDB();
  const { title, date, time, priority, category } = req.body;
  if (!title || !title.trim()) {
    return res.status(400).json({ error: 'El título es obligatorio' });
  }
  const reminder = {
    id: 'r_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
    title: title.trim(),
    date: date || null,
    time: time || null,
    priority: priority || 'media',
    category: category || 'personal',
    done: false,
    completedStatus: null,
    notified: false,
    createdAt: Date.now(),
    progress: []
  };
  db.reminders.push(reminder);
  logHistory(db, reminder, 'creado');
  writeDB(db);
  res.status(201).json(reminder);
});

// Agregar un avance/seguimiento a un recordatorio puntual
app.post('/api/reminders/:id/progress', (req, res) => {
  const db = readDB();
  const r = db.reminders.find(x => x.id === req.params.id);
  if (!r) return res.status(404).json({ error: 'No encontrado' });
  const { text } = req.body;
  if (!text || !text.trim()) {
    return res.status(400).json({ error: 'El avance no puede estar vacío' });
  }
  if (!r.progress) r.progress = [];
  const entry = { id: 'p_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7), text: text.trim(), ts: Date.now() };
  r.progress.unshift(entry);
  writeDB(db);
  res.status(201).json(entry);
});

// Línea de tiempo global de avances, con el contexto de cada tarea
app.get('/api/progress', (req, res) => {
  const db = readDB();
  const entries = [];
  for (const r of db.reminders) {
    for (const p of (r.progress || [])) {
      entries.push({ ...p, reminderId: r.id, title: r.title, category: r.category, priority: r.priority });
    }
  }
  entries.sort((a, b) => b.ts - a.ts);
  res.json(entries);
});

// Reprogramar fecha/hora de una tarea, con motivo opcional
app.patch('/api/reminders/:id/reschedule', (req, res) => {
  const db = readDB();
  const r = db.reminders.find(x => x.id === req.params.id);
  if (!r) return res.status(404).json({ error: 'No encontrado' });

  const { date, time, reason } = req.body;
  const fmt = (d, t) => {
    if (!d) return 'sin fecha';
    const dd = new Date(d + 'T00:00:00').toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' });
    return t ? `${dd} ${t}` : dd;
  };
  const oldLabel = fmt(r.date, r.time);
  r.date = date || null;
  r.time = time || null;
  r.notified = false; // si se movió hacia adelante, debe poder volver a avisar
  const newLabel = fmt(r.date, r.time);

  let note = `De ${oldLabel} → ${newLabel}`;
  if (reason && reason.trim()) note += `. Motivo: ${reason.trim()}`;
  logHistory(db, r, 'reprogramada', note);

  if (reason && reason.trim()) {
    if (!r.progress) r.progress = [];
    r.progress.unshift({ id: 'p_' + Date.now(), text: reason.trim(), ts: Date.now() });
  }

  writeDB(db);
  res.json(r);
});

// Línea de tiempo unificada de UNA tarea: avances + reprogramaciones + estado
app.get('/api/reminders/:id/timeline', (req, res) => {
  const db = readDB();
  const r = db.reminders.find(x => x.id === req.params.id);
  if (!r) return res.status(404).json({ error: 'No encontrado' });

  const entries = [];
  (r.progress || []).forEach(p => entries.push({ ts: p.ts, kind: 'avance', text: p.text }));
  db.history
    .filter(h => h.reminderId === r.id)
    .forEach(h => entries.push({ ts: h.ts, kind: 'evento', event: h.event, note: h.note }));

  entries.sort((a, b) => b.ts - a.ts);
  res.json({ reminder: r, timeline: entries });
});

app.patch('/api/reminders/:id/toggle', (req, res) => {
  const db = readDB();
  const r = db.reminders.find(x => x.id === req.params.id);
  if (!r) return res.status(404).json({ error: 'No encontrado' });

  if (r.done) {
    r.done = false;
    r.completedStatus = null;
    logHistory(db, r, 'reabierto');
  } else {
    r.done = true;
    r.completedStatus = isPastDeadline(r) ? 'late' : 'ontime';
    logHistory(db, r, r.completedStatus === 'late' ? 'completado_tarde' : 'completado_a_tiempo');
  }
  writeDB(db);
  res.json(r);
});

app.delete('/api/reminders/:id', (req, res) => {
  const db = readDB();
  const r = db.reminders.find(x => x.id === req.params.id);
  if (r) logHistory(db, r, 'eliminado');
  db.reminders = db.reminders.filter(x => x.id !== req.params.id);
  writeDB(db);
  res.json({ ok: true });
});

// Historial
app.get('/api/history', (req, res) => {
  const db = readDB();
  res.json(db.history);
});

// Borrar una entrada puntual del historial
app.delete('/api/history/:id', (req, res) => {
  const db = readDB();
  const before = db.history.length;
  db.history = db.history.filter(h => h.id !== req.params.id);
  if (db.history.length === before) return res.status(404).json({ error: 'No encontrado' });
  writeDB(db);
  res.json({ ok: true });
});

// Vaciar todo el historial
app.delete('/api/history', (req, res) => {
  const db = readDB();
  db.history = [];
  writeDB(db);
  res.json({ ok: true });
});

// ---------- Envío de notificaciones ----------
async function sendPushToAll(db, payload) {
  if (!PUSH_ENABLED) return;
  const body = JSON.stringify(payload);
  const stillValid = [];
  for (const sub of db.subscriptions) {
    try {
      await webpush.sendNotification(sub, body);
      stillValid.push(sub);
    } catch (err) {
      // 410/404 = la suscripción ya no existe (usuario desinstaló, etc.)
      if (err.statusCode !== 410 && err.statusCode !== 404) {
        stillValid.push(sub);
      }
    }
  }
  db.subscriptions = stillValid;
}

// Revisa cada minuto si hay recordatorios que ya vencieron y no se han avisado
cron.schedule('* * * * *', async () => {
  const db = readDB();
  const now = new Date();
  let changed = false;

  for (const r of db.reminders) {
    if (r.done || r.notified) continue;
    const dl = deadlineOf(r);
    if (dl && now >= dl) {
      await sendPushToAll(db, {
        title: 'Recordatorio: ' + r.title,
        body: (r.category === 'trabajo' ? 'Trabajo' : 'Personal') +
              (r.time ? ' · vencía a las ' + r.time : ' · vencía hoy'),
      });
      r.notified = true;
      changed = true;
    }
  }
  if (changed) writeDB(db);
});

app.listen(PORT, () => {
  console.log(`Servidor de recordatorios corriendo en http://localhost:${PORT}`);
});

const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'data.json');

function defaultData() {
  return { reminders: [], history: [], subscriptions: [] };
}

function readDB() {
  if (!fs.existsSync(DB_PATH)) {
    writeDB(defaultData());
  }
  const raw = fs.readFileSync(DB_PATH, 'utf-8');
  try {
    return JSON.parse(raw);
  } catch (e) {
    return defaultData();
  }
}

function writeDB(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

module.exports = { readDB, writeDB };

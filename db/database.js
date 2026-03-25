const { Database } = require('node-sqlite3-wasm');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'dao.db');

let db;

// シングルトンでDB接続を管理
function getDB() {
  if (!db) {
    db = new Database(DB_PATH);
    db.exec("PRAGMA foreign_keys = ON");  // 外部キー制約を有効化
  }
  return db;
}

module.exports = { getDB };

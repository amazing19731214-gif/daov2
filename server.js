require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const { initDB } = require('./db/init');
const { getDB } = require('./db/database');

// SQLiteセッションストア（デプロイをまたいでセッションを保持）
class SQLiteStore extends session.Store {
  get(sid, cb) {
    try {
      const row = getDB().prepare('SELECT data, expires FROM sessions WHERE sid=?').get(sid);
      if (!row) { console.log('[session] get: not found', sid); return cb(null, null); }
      if (Date.now() > row.expires) {
        getDB().prepare('DELETE FROM sessions WHERE sid=?').run(sid);
        console.log('[session] get: expired', sid);
        return cb(null, null);
      }
      const parsed = JSON.parse(row.data);
      console.log('[session] get: found userId=', parsed.userId);
      cb(null, parsed);
    } catch(e) { console.error('[session] get error:', e); cb(e); }
  }
  set(sid, session, cb) {
    try {
      const expires = Date.now() + (session.cookie?.maxAge || 7*24*60*60*1000);
      const data = JSON.stringify(session);
      getDB().prepare('INSERT OR REPLACE INTO sessions (sid,data,expires) VALUES (?,?,?)').run([sid, data, expires]);
      console.log('[session] set: saved userId=', session.userId, 'sid=', sid);
      cb(null);
    } catch(e) { console.error('[session] set error:', e); cb(e); }
  }
  destroy(sid, cb) {
    try {
      getDB().prepare('DELETE FROM sessions WHERE sid=?').run(sid);
      cb(null);
    } catch(e) { cb(e); }
  }
}

const authRoutes      = require('./routes/auth');
const mapRoutes       = require('./routes/map');
const proposalRoutes  = require('./routes/proposals');
const pointRoutes     = require('./routes/points');
const adminRoutes     = require('./routes/admin');
const scheduleRoutes  = require('./routes/schedule');
const qaRoutes        = require('./routes/qa');
const noticeRoutes    = require('./routes/notices');

const app = express();
const PORT = process.env.PORT || 3000;

// Railwayのリバースプロキシを信頼（HTTPS・ホスト名を正しく取得）
app.set('trust proxy', 1);

// ── ミドルウェア ──────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// セッション設定（SQLite永続化）
app.use(session({
  store: new SQLiteStore(),
  secret: process.env.SESSION_SECRET || 'dao-v2-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000, secure: false } // 7日間
}));

// ── リクエストログ ────────────────────────────
app.use((req, res, next) => {
  console.log(`[${new Date().toLocaleTimeString()}] ${req.method} ${req.path} | session:${JSON.stringify(req.session?.lineState||null)} | query:${JSON.stringify(req.query)}`);
  next();
});

// ── APIルート ──────────────────────────────────
app.use('/api/auth',      authRoutes);
app.use('/api/map',       mapRoutes);
app.use('/api/proposals', proposalRoutes);
app.use('/api/points',    pointRoutes);
app.use('/api/admin',     adminRoutes);
app.use('/api/schedule',  scheduleRoutes);
app.use('/api/qa',        qaRoutes);
app.use('/api/notices',   noticeRoutes);

// ── フロントページのルーティング ──────────────
// ページリクエストはすべてpublicフォルダのHTMLで処理
app.get('/pages/:page', (req, res) => {
  const file = path.join(__dirname, 'public', 'pages', req.params.page + '.html');
  res.sendFile(file, err => {
    if (err) res.status(404).send('ページが見つかりません');
  });
});

// トップページ → 地図
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── 起動 ─────────────────────────────────────
initDB();
app.listen(PORT, () => {
  console.log(`🚀 自治会DAOアプリ起動: http://localhost:${PORT}`);
  console.log(`   管理者ログイン用 line_id: admin_line_id`);
});

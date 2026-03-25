require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const { initDB } = require('./db/init');
const FileStore = require('session-file-store')(session);

const authRoutes      = require('./routes/auth');
const mapRoutes       = require('./routes/map');
const proposalRoutes  = require('./routes/proposals');
const pointRoutes     = require('./routes/points');
const adminRoutes     = require('./routes/admin');
const scheduleRoutes  = require('./routes/schedule');
const qaRoutes        = require('./routes/qa');

const app = express();
const PORT = process.env.PORT || 3000;

// ── ミドルウェア ──────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// セッション設定（本番環境では connect-sqlite3 等に変更推奨）
app.use(session({
  store: new FileStore({ path: './sessions', ttl: 7 * 24 * 60 * 60, retries: 1 }),
  secret: process.env.SESSION_SECRET || 'dao-v2-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 } // 7日間
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

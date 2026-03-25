require('dotenv').config();
const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const path = require('path');
const { pool } = require('./db/database');
const { initDB } = require('./db/init');

const authRoutes      = require('./routes/auth');
const mapRoutes       = require('./routes/map');
const proposalRoutes  = require('./routes/proposals');
const pointRoutes     = require('./routes/points');
const adminRoutes     = require('./routes/admin');
const scheduleRoutes  = require('./routes/schedule');
const qaRoutes        = require('./routes/qa');
const noticeRoutes    = require('./routes/notices');
const docsRoutes      = require('./routes/docs');
const inventoryRoutes = require('./routes/inventory');
const accountingRoutes = require('./routes/accounting');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// セッション設定（PostgreSQL永続化）
app.use(session({
  store: new pgSession({
    pool,
    createTableIfMissing: true,
  }),
  secret: process.env.SESSION_SECRET || 'dao-v2-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000, secure: false, sameSite: 'lax' }
}));

app.use((req, res, next) => {
  console.log(`[${new Date().toLocaleTimeString()}] ${req.method} ${req.path} | userId:${req.session?.userId || '-'}`);
  next();
});

app.use('/api/auth',      authRoutes);
app.use('/api/map',       mapRoutes);
app.use('/api/proposals', proposalRoutes);
app.use('/api/points',    pointRoutes);
app.use('/api/admin',     adminRoutes);
app.use('/api/schedule',  scheduleRoutes);
app.use('/api/qa',        qaRoutes);
app.use('/api/notices',    noticeRoutes);
app.use('/api/docs',       docsRoutes);
app.use('/api/inventory',  inventoryRoutes);
app.use('/api/accounting', accountingRoutes);

app.get('/pages/:page', (req, res) => {
  const file = path.join(__dirname, 'public', 'pages', req.params.page + '.html');
  res.sendFile(file, err => {
    if (err) res.status(404).send('ページが見つかりません');
  });
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`🚀 自治会DAOアプリ起動: http://localhost:${PORT}`);
  });
}).catch(err => {
  console.error('DB初期化失敗:', err);
  process.exit(1);
});

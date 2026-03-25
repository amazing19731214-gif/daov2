const express = require('express');
const router = express.Router();
const { getDB } = require('../db/database');
const https = require('https');

// Android Chrome対策: stateをメモリに保存（DBより確実）
const oauthStates = new Map(); // state -> { callbackUrl, ts }

// LINE OAuth設定
const LINE_CHANNEL_ID = process.env.LINE_CHANNEL_ID;
const LINE_CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;
const LINE_CALLBACK_URL = process.env.LINE_CALLBACK_URL;

// HTTPSリクエストのユーティリティ
function httpsPost(url, data, headers) {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams(data).toString();
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body), ...headers }
    };
    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function httpsGet(url, headers) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options = { hostname: urlObj.hostname, path: urlObj.pathname, method: 'GET', headers };
    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    });
    req.on('error', reject);
    req.end();
  });
}

// LINEログイン（本番）: LINEの認証ページにリダイレクト
router.get('/line', (req, res) => {
  const state = Math.random().toString(36).substring(2);
  req.session.lineState = state;

  // callbackURL: 環境変数優先、なければリクエストから動的生成
  const host = req.hostname;
  const protocol = req.protocol; // trust proxy=1 により https が返る
  const dynamicCallbackUrl = `${protocol}://${host}/api/auth/line/callback`;
  const callbackUrl = host === 'localhost'
    ? (process.env.LINE_CALLBACK_URL_LOCAL || LINE_CALLBACK_URL || dynamicCallbackUrl)
    : (LINE_CALLBACK_URL || dynamicCallbackUrl);

  console.log(`[LINE auth] host=${host} protocol=${protocol} callbackUrl=${callbackUrl}`);
  req.session.lineCallbackUrl = callbackUrl;

  // Android Chrome対策: stateをメモリに保存（セッションが失われた場合のフォールバック）
  oauthStates.set(state, { callbackUrl, ts: Date.now() });
  // 10分以上古いstateを削除
  for (const [k, v] of oauthStates) {
    if (Date.now() - v.ts > 600000) oauthStates.delete(k);
  }

  // AndroidのChromeではLINEアプリが横取りしてエラーになるためdisable_auto_loginを追加
  const ua = req.headers['user-agent'] || '';
  const isAndroid = /android/i.test(ua);

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: LINE_CHANNEL_ID,
    redirect_uri: callbackUrl,
    state,
    scope: 'profile'
  });
  if (isAndroid) params.set('disable_auto_login', 'true');

  const lineUrl = `https://access.line.me/oauth2/v2.1/authorize?${params}`;
  res.redirect(lineUrl);
});

// LINEログインコールバック
router.get('/line/callback', async (req, res) => {
  try {
    const { code, state } = req.query;
    if (!code) return res.redirect('/pages/login?error=no_code');

    // stateの検証（セッション優先、なければDBで確認）
    let callbackUrl;
    if (state === req.session.lineState) {
      callbackUrl = req.session.lineCallbackUrl || LINE_CALLBACK_URL;
    } else if (oauthStates.has(state)) {
      // Android Chrome対策: メモリから検索
      const saved = oauthStates.get(state);
      oauthStates.delete(state);
      callbackUrl = saved.callbackUrl;
    } else {
      return res.redirect('/pages/login?error=invalid_state');
    }
    const tokenRes = await httpsPost('https://api.line.me/oauth2/v2.1/token', {
      grant_type: 'authorization_code',
      code,
      redirect_uri: callbackUrl,
      client_id: LINE_CHANNEL_ID,
      client_secret: LINE_CHANNEL_SECRET
    });

    if (!tokenRes.access_token) return res.redirect('/pages/login?error=token_failed');

    // プロフィール取得
    const profile = await httpsGet('https://api.line.me/v2/profile', {
      Authorization: `Bearer ${tokenRes.access_token}`
    });

    const line_id = profile.userId;
    const display_name = profile.displayName;

    const db = getDB();
    let user = db.prepare('SELECT * FROM users WHERE line_id = ?').get(line_id);

    if (!user) {
      db.prepare(`
        INSERT INTO users (line_id, name, status) VALUES (?, ?, 'provisional')
      `).run([line_id, display_name]);
      user = db.prepare('SELECT * FROM users WHERE line_id = ?').get(line_id);
    }

    req.session.userId = user.id;
    req.session.userStatus = user.status;
    req.session.userName = user.name;

    // Railwayのプロキシ環境での絶対URLリダイレクト（Android Chrome対策）
    const appBase = LINE_CALLBACK_URL
      ? LINE_CALLBACK_URL.split('/api/')[0]
      : '';
    res.redirect(appBase + '/');
  } catch (e) {
    console.error('LINE callback error:', e);
    res.redirect('/pages/login?error=callback_failed');
  }
});

// LINEログイン（開発用モック）
router.post('/line-mock', (req, res) => {
  try {
  const { line_id, display_name } = req.body;
  if (!line_id) return res.status(400).json({ error: 'line_idが必要です' });

  const db = getDB();
  let user = db.prepare('SELECT * FROM users WHERE line_id = ?').get(line_id);

  if (!user) {
    // 新規ユーザー：provisional状態で登録（名前が空の場合は'名前未設定'）
    const name = (display_name && display_name.trim()) ? display_name.trim() : '名前未設定';
    db.prepare(`
      INSERT INTO users (line_id, name, status)
      VALUES (?, ?, 'provisional')
    `).run([line_id, name]);
    user = db.prepare('SELECT * FROM users WHERE line_id = ?').get(line_id);
    console.log(`新規ユーザー: ${line_id} name: ${name}`);
  }

  // セッションに保存
  req.session.userId = user.id;
  req.session.userStatus = user.status;
  req.session.userName = user.name;

  res.json({ success: true, user: { id: user.id, name: user.name, status: user.status } });
  } catch (e) {
    console.error('line-mock error:', e);
    res.status(500).json({ error: e.message });
  }
});

// 本登録申請
router.post('/register', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'ログインが必要です' });

  const { name, address, phone } = req.body;
  if (!name || !address || !phone) {
    return res.status(400).json({ error: '氏名・住所・電話番号は必須です' });
  }

  const db = getDB();

  // 申請済みチェック
  const existing = db.prepare(
    'SELECT id FROM registration_requests WHERE user_id = ?'
  ).get(req.session.userId);
  if (existing) return res.status(400).json({ error: '既に申請済みです' });

  // ユーザー情報更新 & 申請登録
  db.prepare(`
    UPDATE users SET name = ?, address = ?, phone = ?, status = 'pending_review' WHERE id = ?
  `).run([name, address, phone, req.session.userId]);

  db.prepare(`
    INSERT INTO registration_requests (user_id, name, address, phone) VALUES (?, ?, ?, ?)
  `).run([req.session.userId, name, address, phone]);

  req.session.userStatus = 'pending_review';
  req.session.userName = name;

  res.json({ success: true, message: '申請を受け付けました。管理者の承認をお待ちください。' });
});

// ログアウト
router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

// 現在のユーザー情報取得
router.get('/me', (req, res) => {
  if (!req.session.userId) return res.json({ loggedIn: false });

  const db = getDB();
  const user = db.prepare('SELECT id, name, status, points FROM users WHERE id = ?')
    .get(req.session.userId);

  if (!user) {
    req.session.destroy();
    return res.json({ loggedIn: false });
  }

  // セッションのステータスを最新化
  req.session.userStatus = user.status;

  res.json({ loggedIn: true, user: { id: user.id, name: user.name, status: user.status, points: user.points } });
});

module.exports = router;

const express = require('express');
const router = express.Router();
const { getDB } = require('../db/database');
const { requireLogin } = require('../middleware/auth');

// お知らせ一覧
router.get('/', (req, res) => {
  const db = getDB();
  const notices = db.prepare(`
    SELECT n.*,
      (SELECT COUNT(*) FROM notice_reads WHERE notice_id = n.id) as read_count,
      u.name as author_name
    FROM notices n
    LEFT JOIN users u ON n.author_id = u.id
    ORDER BY
      CASE WHEN n.priority IN ('emergency','urgent') THEN 0 ELSE 1 END ASC,
      n.created_at DESC
  `).all();

  // ログイン中なら自分の既読状況も返す
  const userId = req.session.userId;
  const result = notices.map(n => ({
    ...n,
    myRead: userId
      ? !!db.prepare('SELECT id FROM notice_reads WHERE notice_id=? AND user_id=?').get(n.id, userId)
      : false
  }));

  res.json(result);
});

// お知らせ詳細
router.get('/:id', (req, res) => {
  const db = getDB();
  const notice = db.prepare(`
    SELECT n.*,
      (SELECT COUNT(*) FROM notice_reads WHERE notice_id = n.id) as read_count,
      u.name as author_name
    FROM notices n
    LEFT JOIN users u ON n.author_id = u.id
    WHERE n.id = ?
  `).get(req.params.id);

  if (!notice) return res.status(404).json({ error: 'お知らせが見つかりません' });

  const userId = req.session.userId;
  const myRead = userId
    ? !!db.prepare('SELECT id FROM notice_reads WHERE notice_id=? AND user_id=?').get(notice.id, userId)
    : false;

  res.json({ ...notice, myRead });
});

// 既読登録
router.post('/:id/read', requireLogin, (req, res) => {
  const db = getDB();
  const notice = db.prepare('SELECT id FROM notices WHERE id=?').get(req.params.id);
  if (!notice) return res.status(404).json({ error: 'お知らせが見つかりません' });

  try {
    db.prepare('INSERT OR IGNORE INTO notice_reads (notice_id, user_id) VALUES (?,?)').run(req.params.id, req.session.userId);
  } catch(e) { /* 重複は無視 */ }

  const readCount = db.prepare('SELECT COUNT(*) as c FROM notice_reads WHERE notice_id=?').get(req.params.id).c;
  res.json({ success: true, readCount });
});

// お知らせ作成（管理者・役員のみ）
router.post('/', requireLogin, (req, res) => {
  const status = req.session.userStatus;
  if (!['admin','officer'].includes(status)) return res.status(403).json({ error: '権限がありません' });

  const { title, content, category, priority, total_count } = req.body;
  if (!title) return res.status(400).json({ error: 'タイトルは必須です' });

  const db = getDB();
  const result = db.prepare(`
    INSERT INTO notices (title, content, category, priority, author_id, total_count)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(title, content || '', category || '一般', priority || 'normal', req.session.userId, total_count || 0);

  res.json({ success: true, id: result.lastInsertRowid });
});

// お知らせ更新（管理者・役員のみ）
router.put('/:id', requireLogin, (req, res) => {
  const status = req.session.userStatus;
  if (!['admin','officer'].includes(status)) return res.status(403).json({ error: '権限がありません' });

  const { title, content, category, priority, total_count } = req.body;
  if (!title) return res.status(400).json({ error: 'タイトルは必須です' });

  const db = getDB();
  db.prepare(`
    UPDATE notices SET title=?, content=?, category=?, priority=?, total_count=? WHERE id=?
  `).run(title, content || '', category || '一般', priority || 'normal', total_count || 0, req.params.id);

  res.json({ success: true });
});

// お知らせ削除（管理者・役員のみ）
router.delete('/:id', requireLogin, (req, res) => {
  const status = req.session.userStatus;
  if (!['admin','officer'].includes(status)) return res.status(403).json({ error: '権限がありません' });

  const db = getDB();
  db.prepare('DELETE FROM notice_reads WHERE notice_id=?').run(req.params.id);
  db.prepare('DELETE FROM notices WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

module.exports = router;

// 認証・権限チェックミドルウェア

// ログイン必須
function requireLogin(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'ログインが必要です' });
  }
  next();
}

// 承認済みユーザー必須（投票・コメント等）
function requireApproved(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'ログインが必要です' });
  }
  if (!['approved', 'officer', 'admin'].includes(req.session.userStatus)) {
    return res.status(403).json({ error: '承認済みメンバーのみ利用できます' });
  }
  next();
}

// 役員・管理者必須
function requireOfficer(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'ログインが必要です' });
  }
  if (!['officer', 'admin'].includes(req.session.userStatus)) {
    return res.status(403).json({ error: '役員以上のみ利用できます' });
  }
  next();
}

// 管理者必須
function requireAdmin(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'ログインが必要です' });
  }
  if (req.session.userStatus !== 'admin') {
    return res.status(403).json({ error: '管理者のみ利用できます' });
  }
  next();
}

module.exports = { requireLogin, requireApproved, requireOfficer, requireAdmin };

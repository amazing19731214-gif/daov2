// ── 共通ユーティリティ ──────────────────────

// 現在のユーザー情報（グローバルキャッシュ）
let currentUser = null;

// ユーザー情報を取得してキャッシュ
async function fetchCurrentUser() {
  const res = await fetch('/api/auth/me');
  const data = await res.json();
  if (data.loggedIn) {
    currentUser = data.user;
  } else {
    // 未ログインならログインページへ
    window.location.href = '/pages/login';
  }
  return currentUser;
}

// ログインなしでも見られるページ用
async function fetchCurrentUserOptional() {
  const res = await fetch('/api/auth/me');
  const data = await res.json();
  if (data.loggedIn) currentUser = data.user;
  return currentUser;
}

// toast通知
function showToast(msg, duration = 2500) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), duration);
}

// 日時フォーマット（相対表示）
function formatDate(dateStr) {
  const d = new Date(dateStr);
  const now = new Date();
  const diff = (now - d) / 1000;
  if (diff < 60)    return 'たった今';
  if (diff < 3600)  return `${Math.floor(diff/60)}分前`;
  if (diff < 86400) return `${Math.floor(diff/3600)}時間前`;
  const m = d.getMonth()+1, day = d.getDate();
  return `${m}/${day}`;
}

// カテゴリ名
const CATEGORY_LABELS = {
  road:  '🚧 道路・インフラ',
  safe:  '🚨 安全・防犯',
  env:   '🌿 環境・清掃',
  other: '📌 その他'
};

// ステータス名
const STATUS_LABELS = {
  open:        '⚠️ 未対応',
  in_progress: '🔧 対応中',
  resolved:    '✅ 解決済'
};

// カテゴリのバッジクラス
function categoryBadge(cat) {
  return `<span class="badge badge-${cat}">${CATEGORY_LABELS[cat] || cat}</span>`;
}
function statusBadge(st) {
  return `<span class="badge badge-${st}">${STATUS_LABELS[st] || st}</span>`;
}

// ユーザーステータスの日本語
const USER_STATUS_LABELS = {
  provisional:    '仮登録',
  pending_review: '承認待ち',
  approved:       '正会員',
  officer:        '役員',
  admin:          '管理者'
};

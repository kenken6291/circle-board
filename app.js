/* ============================================
   サークル内掲示板 - フロントエンドロジック
   ============================================ */

// ▼▼▼ ここをデプロイしたGASのWebアプリURLに書き換えてください ▼▼▼
const GAS_API_URL = 'https://script.google.com/macros/s/AKfycbzfd0MN3uqMkjAzWpBmVBpdEc126gJE_cmdCFZwC-FGfM93TOoasaxUUwBeUUiJe7Fj/exec';
// ▲▲▲ ここをデプロイしたGASのWebアプリURLに書き換えてください ▲▲▲

const STORAGE_KEY = 'circleBoardSession';

/* ---- DOM参照 ---- */
const loginScreen = document.getElementById('loginScreen');
const boardScreen = document.getElementById('boardScreen');
const loginForm = document.getElementById('loginForm');
const loginError = document.getElementById('loginError');
const userNameLabel = document.getElementById('userNameLabel');
const logoutBtn = document.getElementById('logoutBtn');
const postForm = document.getElementById('postForm');
const postContent = document.getElementById('postContent');
const postError = document.getElementById('postError');
const postList = document.getElementById('postList');
const emptyMessage = document.getElementById('emptyMessage');
const charCount = document.getElementById('charCount');
const loading = document.getElementById('loading');

/* ---- 初期化 ---- */
document.addEventListener('DOMContentLoaded', () => {
  const session = getSession();
  if (session && session.token) {
    showBoard(session);
  } else {
    showLogin();
  }
});

loginForm.addEventListener('submit', onLoginSubmit);
postForm.addEventListener('submit', onPostSubmit);
logoutBtn.addEventListener('click', onLogout);
postContent.addEventListener('input', () => {
  charCount.textContent = `${postContent.value.length} / 1000`;
});

/* ---- ログイン処理 ---- */
async function onLoginSubmit(e) {
  e.preventDefault();
  hide(loginError);

  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;

  setLoading(true);
  try {
    const res = await callApi({ action: 'login', email, password });
    if (res.success) {
      const session = { token: res.token, name: res.name, email: res.email };
      saveSession(session);
      showBoard(session);
    } else {
      showError(loginError, res.message || 'ログインに失敗しました。');
    }
  } catch (err) {
    showError(loginError, '通信エラーが発生しました。時間をおいて再度お試しください。');
  } finally {
    setLoading(false);
  }
}

/* ---- ログアウト処理 ---- */
async function onLogout() {
  const session = getSession();
  setLoading(true);
  try {
    if (session && session.token) {
      await callApi({ action: 'logout', token: session.token });
    }
  } catch (err) {
    // ログアウトAPIが失敗してもローカルセッションは破棄する
  } finally {
    clearSession();
    setLoading(false);
    showLogin();
  }
}

/* ---- 投稿処理 ---- */
async function onPostSubmit(e) {
  e.preventDefault();
  hide(postError);

  const session = getSession();
  if (!session) { showLogin(); return; }

  const content = postContent.value.trim();
  if (!content) return;

  setLoading(true);
  try {
    const res = await callApi({ action: 'addPost', token: session.token, content });
    if (res.success) {
      postContent.value = '';
      charCount.textContent = '0 / 1000';
      await loadPosts();
    } else {
      handleSessionAwareError(res, postError);
    }
  } catch (err) {
    showError(postError, '投稿に失敗しました。通信環境をご確認ください。');
  } finally {
    setLoading(false);
  }
}

/* ---- 投稿一覧の取得・描画 ---- */
async function loadPosts() {
  const session = getSession();
  if (!session) return;

  setLoading(true);
  try {
    const res = await callApi({ action: 'getPosts', token: session.token });
    if (res.success) {
      renderPosts(res.posts);
    } else {
      handleSessionAwareError(res, postError);
    }
  } catch (err) {
    showError(postError, '投稿の取得に失敗しました。');
  } finally {
    setLoading(false);
  }
}

function renderPosts(posts) {
  postList.innerHTML = '';
  if (!posts || posts.length === 0) {
    show(emptyMessage);
    return;
  }
  hide(emptyMessage);

  posts.forEach(post => {
    const card = document.createElement('div');
    card.className = 'post-card';
    card.innerHTML = `
      <div class="post-card-header">
        <span class="post-author">${escapeHtml(post.authorName)}</span>
        <span class="post-date">${formatDate(post.createdAt)}</span>
      </div>
      <div class="post-content">${escapeHtml(post.content)}</div>
    `;
    postList.appendChild(card);
  });
}

/* ---- セッション切れの場合、自動的にログイン画面へ戻す ---- */
function handleSessionAwareError(res, errorEl) {
  if (res.message && res.message.includes('セッション')) {
    clearSession();
    showLogin();
    showError(loginError, res.message);
  } else {
    showError(errorEl, res.message || 'エラーが発生しました。');
  }
}

/* ---- 画面切り替え ---- */
function showLogin() {
  hide(boardScreen);
  show(loginScreen);
  loginForm.reset();
}

function showBoard(session) {
  hide(loginScreen);
  show(boardScreen);
  userNameLabel.textContent = `${session.name} さん`;
  loadPosts();
}

/* ---- API通信 ----
   GASの doPost は text/plain で送るとCORSプリフライトを回避できる */
async function callApi(payload) {
  const res = await fetch(GAS_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    throw new Error('HTTP Error: ' + res.status);
  }
  return res.json();
}

/* ---- セッション保存(localStorage) ---- */
function saveSession(session) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}
function getSession() {
  const raw = localStorage.getItem(STORAGE_KEY);
  return raw ? JSON.parse(raw) : null;
}
function clearSession() {
  localStorage.removeItem(STORAGE_KEY);
}

/* ---- 小物ユーティリティ ---- */
function show(el) { el.classList.remove('hidden'); }
function hide(el) { el.classList.add('hidden'); }
function showError(el, msg) { el.textContent = msg; show(el); }
function setLoading(isLoading) {
  if (isLoading) show(loading); else hide(loading);
}
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
function formatDate(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

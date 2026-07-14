/* ============================================
   サークル内掲示板 - フロントエンドロジック
   ============================================ */

// ▼▼▼ ここをデプロイしたGASのWebアプリURLに書き換えてください ▼▼▼
const GAS_API_URL = 'https://script.google.com/macros/s/AKfycbzfd0MN3uqMkjAzWpBmVBpdEc126gJE_cmdCFZwC-FGfM93TOoasaxUUwBeUUiJe7Fj/exec';
// ▲▲▲ ここをデプロイしたGASのWebアプリURLに書き換えてください ▲▲▲

const STORAGE_KEY = 'circleBoardSession';

/* ---- 画面要素 ---- */
const screens = {
  login: document.getElementById('loginScreen'),
  register: document.getElementById('registerScreen'),
  forgot: document.getElementById('forgotScreen'),
  forceChange: document.getElementById('forceChangeScreen'),
  board: document.getElementById('boardScreen'),
  profile: document.getElementById('profileScreen')
};

/* ---- ログイン ---- */
const loginForm = document.getElementById('loginForm');
const loginError = document.getElementById('loginError');
const loginMessage = document.getElementById('loginMessage');

/* ---- 会員登録 ---- */
const registerForm = document.getElementById('registerForm');
const registerError = document.getElementById('registerError');
const registerMessage = document.getElementById('registerMessage');

/* ---- パスワード再発行 ---- */
const forgotForm = document.getElementById('forgotForm');
const forgotError = document.getElementById('forgotError');
const forgotMessage = document.getElementById('forgotMessage');

/* ---- 初回パスワード変更 ---- */
const forceChangeForm = document.getElementById('forceChangeForm');
const forceChangeError = document.getElementById('forceChangeError');
let pendingLoginEmail = null; // 初回ログイン変更時に使う一時保持

/* ---- 掲示板 ---- */
const userNameLabel = document.getElementById('userNameLabel');
const logoutBtn = document.getElementById('logoutBtn');
const profileBtn = document.getElementById('profileBtn');
const postForm = document.getElementById('postForm');
const postContent = document.getElementById('postContent');
const postError = document.getElementById('postError');
const postList = document.getElementById('postList');
const emptyMessage = document.getElementById('emptyMessage');
const charCount = document.getElementById('charCount');

/* ---- マイページ ---- */
const backToBoardBtn = document.getElementById('backToBoardBtn');
const nicknameForm = document.getElementById('nicknameForm');
const profileNickname = document.getElementById('profileNickname');
const nicknameError = document.getElementById('nicknameError');
const nicknameMessage = document.getElementById('nicknameMessage');
const pwChangeForm = document.getElementById('pwChangeForm');
const pwChangeError = document.getElementById('pwChangeError');
const pwChangeMessage = document.getElementById('pwChangeMessage');

const loading = document.getElementById('loading');

/* ---- 初期化 ---- */
document.addEventListener('DOMContentLoaded', () => {
  setupPasswordToggles();

  const session = getSession();
  if (session && session.token) {
    showBoard(session);
  } else {
    showScreen('login');
  }
});

/* ---- 画面切り替えリンク ---- */
document.getElementById('showRegister').addEventListener('click', (e) => {
  e.preventDefault();
  showScreen('register');
});
document.getElementById('showForgot').addEventListener('click', (e) => {
  e.preventDefault();
  showScreen('forgot');
});
document.getElementById('backToLoginFromRegister').addEventListener('click', (e) => {
  e.preventDefault();
  showScreen('login');
});
document.getElementById('backToLoginFromForgot').addEventListener('click', (e) => {
  e.preventDefault();
  showScreen('login');
});
profileBtn.addEventListener('click', () => {
  const session = getSession();
  if (session) profileNickname.value = session.nickname;
  showScreen('profile');
});
backToBoardBtn.addEventListener('click', () => showScreen('board'));

/* ---- イベント登録 ---- */
loginForm.addEventListener('submit', onLoginSubmit);
registerForm.addEventListener('submit', onRegisterSubmit);
forgotForm.addEventListener('submit', onForgotSubmit);
forceChangeForm.addEventListener('submit', onForceChangeSubmit);
postForm.addEventListener('submit', onPostSubmit);
logoutBtn.addEventListener('click', onLogout);
nicknameForm.addEventListener('submit', onNicknameSubmit);
pwChangeForm.addEventListener('submit', onPwChangeSubmit);

postContent.addEventListener('input', () => {
  charCount.textContent = `${postContent.value.length} / 1000`;
});

/* ---- パスワード表示/非表示トグル ---- */
function setupPasswordToggles() {
  document.querySelectorAll('.pw-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-target');
      const input = document.getElementById(targetId);
      if (input.type === 'password') {
        input.type = 'text';
        btn.textContent = '非表示';
      } else {
        input.type = 'password';
        btn.textContent = '表示';
      }
    });
  });
}

/* ---- ログイン処理 ---- */
async function onLoginSubmit(e) {
  e.preventDefault();
  hide(loginError);
  hide(loginMessage);

  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;

  setLoading(true);
  try {
    const res = await callApi({ action: 'login', email, password });
    if (res.success) {
      if (res.mustChangePassword) {
        pendingLoginEmail = email;
        forceChangeForm.reset();
        showScreen('forceChange');
      } else {
        const session = { token: res.token, nickname: res.nickname, email: res.email };
        saveSession(session);
        showBoard(session);
      }
    } else {
      showError(loginError, res.message || 'ログインに失敗しました。');
    }
  } catch (err) {
    showError(loginError, '通信エラーが発生しました。時間をおいて再度お試しください。');
  } finally {
    setLoading(false);
  }
}

/* ---- 会員登録処理 ---- */
async function onRegisterSubmit(e) {
  e.preventDefault();
  hide(registerError);
  hide(registerMessage);

  const email = document.getElementById('registerEmail').value.trim();
  const nickname = document.getElementById('registerNickname').value.trim();
  const agreeTerms = document.getElementById('agreeTerms').checked;

  if (!agreeTerms) {
    showError(registerError, '注意事項・免責事項への同意が必要です。');
    return;
  }

  setLoading(true);
  try {
    const res = await callApi({ action: 'register', email, nickname, agreeTerms });
    if (res.success) {
      registerForm.reset();
      showInfo(registerMessage, res.message);
    } else {
      showError(registerError, res.message || '登録に失敗しました。');
    }
  } catch (err) {
    showError(registerError, '通信エラーが発生しました。時間をおいて再度お試しください。');
  } finally {
    setLoading(false);
  }
}

/* ---- パスワード再発行処理 ---- */
async function onForgotSubmit(e) {
  e.preventDefault();
  hide(forgotError);
  hide(forgotMessage);

  const email = document.getElementById('forgotEmail').value.trim();

  setLoading(true);
  try {
    const res = await callApi({ action: 'forgotPassword', email });
    if (res.success) {
      forgotForm.reset();
      showInfo(forgotMessage, res.message);
    } else {
      showError(forgotError, res.message || '処理に失敗しました。');
    }
  } catch (err) {
    showError(forgotError, '通信エラーが発生しました。時間をおいて再度お試しください。');
  } finally {
    setLoading(false);
  }
}

/* ---- 初回ログイン時のパスワード変更 ---- */
async function onForceChangeSubmit(e) {
  e.preventDefault();
  hide(forceChangeError);

  const currentPassword = document.getElementById('forceCurrentPassword').value;
  const newPassword = document.getElementById('forceNewPassword').value;
  const newPassword2 = document.getElementById('forceNewPassword2').value;

  if (newPassword !== newPassword2) {
    showError(forceChangeError, '新しいパスワードが一致しません。');
    return;
  }
  if (newPassword.length < 8) {
    showError(forceChangeError, '新しいパスワードは8文字以上にしてください。');
    return;
  }

  setLoading(true);
  try {
    // まず仮パスワードでログインしてトークンを取得
    const loginRes = await callApi({ action: 'login', email: pendingLoginEmail, password: currentPassword });
    if (!loginRes.success) {
      showError(forceChangeError, loginRes.message || '現在のパスワードが正しくありません。');
      return;
    }

    const changeRes = await callApi({
      action: 'changePassword',
      token: loginRes.token,
      currentPassword,
      newPassword
    });

    if (changeRes.success) {
      const session = { token: loginRes.token, nickname: loginRes.nickname, email: loginRes.email };
      saveSession(session);
      pendingLoginEmail = null;
      showBoard(session);
    } else {
      showError(forceChangeError, changeRes.message || 'パスワード変更に失敗しました。');
    }
  } catch (err) {
    showError(forceChangeError, '通信エラーが発生しました。時間をおいて再度お試しください。');
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
    showScreen('login');
  }
}

/* ---- ニックネーム変更 ---- */
async function onNicknameSubmit(e) {
  e.preventDefault();
  hide(nicknameError);
  hide(nicknameMessage);

  const session = getSession();
  if (!session) { showScreen('login'); return; }

  const nickname = profileNickname.value.trim();

  setLoading(true);
  try {
    const res = await callApi({ action: 'updateProfile', token: session.token, nickname });
    if (res.success) {
      session.nickname = res.nickname;
      saveSession(session);
      userNameLabel.textContent = `${session.nickname} さん`;
      showInfo(nicknameMessage, 'ニックネームを更新しました。');
    } else {
      handleSessionAwareError(res, nicknameError);
    }
  } catch (err) {
    showError(nicknameError, '通信エラーが発生しました。');
  } finally {
    setLoading(false);
  }
}

/* ---- パスワード変更（マイページから） ---- */
async function onPwChangeSubmit(e) {
  e.preventDefault();
  hide(pwChangeError);
  hide(pwChangeMessage);

  const session = getSession();
  if (!session) { showScreen('login'); return; }

  const currentPassword = document.getElementById('pwCurrent').value;
  const newPassword = document.getElementById('pwNew').value;
  const newPassword2 = document.getElementById('pwNew2').value;

  if (newPassword !== newPassword2) {
    showError(pwChangeError, '新しいパスワードが一致しません。');
    return;
  }

  setLoading(true);
  try {
    const res = await callApi({
      action: 'changePassword',
      token: session.token,
      currentPassword,
      newPassword
    });
    if (res.success) {
      pwChangeForm.reset();
      showInfo(pwChangeMessage, 'パスワードを更新しました。');
    } else {
      handleSessionAwareError(res, pwChangeError);
    }
  } catch (err) {
    showError(pwChangeError, '通信エラーが発生しました。');
  } finally {
    setLoading(false);
  }
}

/* ---- 投稿処理 ---- */
async function onPostSubmit(e) {
  e.preventDefault();
  hide(postError);

  const session = getSession();
  if (!session) { showScreen('login'); return; }

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
    showScreen('login');
    showError(loginError, res.message);
  } else {
    showError(errorEl, res.message || 'エラーが発生しました。');
  }
}

/* ---- 画面切り替え ---- */
function showScreen(name) {
  Object.values(screens).forEach(hide);
  show(screens[name]);
  if (name === 'login') loginForm.reset();
}

function showBoard(session) {
  showScreen('board');
  userNameLabel.textContent = `${session.nickname} さん`;
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
function showInfo(el, msg) { el.textContent = msg; show(el); }
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

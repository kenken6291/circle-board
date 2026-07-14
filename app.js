/* ============================================
   サークル内掲示板 - フロントエンドロジック (v3)
   ============================================ */

// ▼▼▼ ここをデプロイしたGASのWebアプリURLに書き換えてください ▼▼▼
const GAS_API_URL = 'https://script.google.com/macros/s/AKfycbzfd0MN3uqMkjAzWpBmVBpdEc126gJE_cmdCFZwC-FGfM93TOoasaxUUwBeUUiJe7Fj/exec';
// ▲▲▲ ここをデプロイしたGASのWebアプリURLに書き換えてください ▲▲▲

const STORAGE_KEY = 'circleBoardSession';
let currentEventId = null; // 現在表示中のイベントID

/* ---- 画面要素 ---- */
const screens = {
  login: document.getElementById('loginScreen'),
  register: document.getElementById('registerScreen'),
  forgot: document.getElementById('forgotScreen'),
  forceChange: document.getElementById('forceChangeScreen'),
  eventList: document.getElementById('eventListScreen'),
  eventForm: document.getElementById('eventFormScreen'),
  eventDetail: document.getElementById('eventDetailScreen'),
  profile: document.getElementById('profileScreen')
};

/* ---- ログイン関連 ---- */
const loginForm = document.getElementById('loginForm');
const loginError = document.getElementById('loginError');
const loginMessage = document.getElementById('loginMessage');
const registerForm = document.getElementById('registerForm');
const registerError = document.getElementById('registerError');
const registerMessage = document.getElementById('registerMessage');
const forgotForm = document.getElementById('forgotForm');
const forgotError = document.getElementById('forgotError');
const forgotMessage = document.getElementById('forgotMessage');
const forceChangeForm = document.getElementById('forceChangeForm');
const forceChangeError = document.getElementById('forceChangeError');
let pendingLoginEmail = null;

/* ---- イベント一覧 ---- */
const userNameLabel = document.getElementById('userNameLabel');
const logoutBtn = document.getElementById('logoutBtn');
const profileBtn = document.getElementById('profileBtn');
const newEventBtn = document.getElementById('newEventBtn');
const eventListEl = document.getElementById('eventList');
const eventEmptyMessage = document.getElementById('eventEmptyMessage');

/* ---- イベント作成/編集 ---- */
const eventForm = document.getElementById('eventForm');
const eventFormTitle = document.getElementById('eventFormTitle');
const eventFormId = document.getElementById('eventFormId');
const eventTitle = document.getElementById('eventTitle');
const eventDescription = document.getElementById('eventDescription');
const eventStartDate = document.getElementById('eventStartDate');
const eventEndDate = document.getElementById('eventEndDate');
const eventFormError = document.getElementById('eventFormError');
const cancelEventFormBtn = document.getElementById('cancelEventFormBtn');

/* ---- イベント詳細 ---- */
const eventDetailTitle = document.getElementById('eventDetailTitle');
const eventDetailPeriod = document.getElementById('eventDetailPeriod');
const eventDetailDescription = document.getElementById('eventDetailDescription');
const eventOwnerActions = document.getElementById('eventOwnerActions');
const editEventBtn = document.getElementById('editEventBtn');
const deleteEventBtn = document.getElementById('deleteEventBtn');
const joinBtn = document.getElementById('joinBtn');
const declineBtn = document.getElementById('declineBtn');
const myStatusLabel = document.getElementById('myStatusLabel');
const joinCountLabel = document.getElementById('joinCountLabel');
const declineCountLabel = document.getElementById('declineCountLabel');
const showParticipantsLink = document.getElementById('showParticipantsLink');
const participantListBox = document.getElementById('participantListBox');
const joinedList = document.getElementById('joinedList');
const declinedList = document.getElementById('declinedList');
const backToListBtn = document.getElementById('backToListBtn');

/* ---- 投稿 ---- */
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
    showEventList(session);
  } else {
    showScreen('login');
  }
});

/* ---- 画面切り替えリンク ---- */
document.getElementById('showRegister').addEventListener('click', e => { e.preventDefault(); showScreen('register'); });
document.getElementById('showForgot').addEventListener('click', e => { e.preventDefault(); showScreen('forgot'); });
document.getElementById('backToLoginFromRegister').addEventListener('click', e => { e.preventDefault(); showScreen('login'); });
document.getElementById('backToLoginFromForgot').addEventListener('click', e => { e.preventDefault(); showScreen('login'); });

profileBtn.addEventListener('click', () => {
  const session = getSession();
  if (session) profileNickname.value = session.nickname;
  showScreen('profile');
});
backToBoardBtn.addEventListener('click', () => { showScreen('eventList'); loadEvents(); });
backToListBtn.addEventListener('click', () => { showScreen('eventList'); loadEvents(); });
cancelEventFormBtn.addEventListener('click', () => { showScreen('eventList'); loadEvents(); });

newEventBtn.addEventListener('click', () => openEventForm(null));
editEventBtn.addEventListener('click', () => openEventForm(currentEventId));

showParticipantsLink.addEventListener('click', (e) => {
  e.preventDefault();
  if (participantListBox.classList.contains('hidden')) {
    loadParticipants();
  } else {
    hide(participantListBox);
  }
});

/* ---- イベント登録 ---- */
loginForm.addEventListener('submit', onLoginSubmit);
registerForm.addEventListener('submit', onRegisterSubmit);
forgotForm.addEventListener('submit', onForgotSubmit);
forceChangeForm.addEventListener('submit', onForceChangeSubmit);
logoutBtn.addEventListener('click', onLogout);
nicknameForm.addEventListener('submit', onNicknameSubmit);
pwChangeForm.addEventListener('submit', onPwChangeSubmit);
eventForm.addEventListener('submit', onEventFormSubmit);
deleteEventBtn.addEventListener('click', onDeleteEvent);
joinBtn.addEventListener('click', () => onSetParticipation('参加'));
declineBtn.addEventListener('click', () => onSetParticipation('不参加'));
postForm.addEventListener('submit', onPostSubmit);

postContent.addEventListener('input', () => {
  charCount.textContent = `${postContent.value.length} / 1000`;
});

/* ---- パスワード表示/非表示トグル ---- */
function setupPasswordToggles() {
  document.querySelectorAll('.pw-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = document.getElementById(btn.getAttribute('data-target'));
      if (input.type === 'password') { input.type = 'text'; btn.textContent = '非表示'; }
      else { input.type = 'password'; btn.textContent = '表示'; }
    });
  });
}

/* ============ ログイン・会員登録関連 ============ */

async function onLoginSubmit(e) {
  e.preventDefault();
  hide(loginError); hide(loginMessage);

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
        showEventList(session);
      }
    } else {
      showError(loginError, res.message || 'ログインに失敗しました。');
    }
  } catch (err) {
    showError(loginError, '通信エラーが発生しました。時間をおいて再度お試しください。');
  } finally { setLoading(false); }
}

async function onRegisterSubmit(e) {
  e.preventDefault();
  hide(registerError); hide(registerMessage);

  const email = document.getElementById('registerEmail').value.trim();
  const nickname = document.getElementById('registerNickname').value.trim();
  const agreeTerms = document.getElementById('agreeTerms').checked;

  if (!agreeTerms) { showError(registerError, '注意事項・免責事項への同意が必要です。'); return; }

  setLoading(true);
  try {
    const res = await callApi({ action: 'register', email, nickname, agreeTerms });
    if (res.success) { registerForm.reset(); showInfo(registerMessage, res.message); }
    else { showError(registerError, res.message || '登録に失敗しました。'); }
  } catch (err) {
    showError(registerError, '通信エラーが発生しました。時間をおいて再度お試しください。');
  } finally { setLoading(false); }
}

async function onForgotSubmit(e) {
  e.preventDefault();
  hide(forgotError); hide(forgotMessage);

  const email = document.getElementById('forgotEmail').value.trim();

  setLoading(true);
  try {
    const res = await callApi({ action: 'forgotPassword', email });
    if (res.success) { forgotForm.reset(); showInfo(forgotMessage, res.message); }
    else { showError(forgotError, res.message || '処理に失敗しました。'); }
  } catch (err) {
    showError(forgotError, '通信エラーが発生しました。時間をおいて再度お試しください。');
  } finally { setLoading(false); }
}

async function onForceChangeSubmit(e) {
  e.preventDefault();
  hide(forceChangeError);

  const currentPassword = document.getElementById('forceCurrentPassword').value;
  const newPassword = document.getElementById('forceNewPassword').value;
  const newPassword2 = document.getElementById('forceNewPassword2').value;

  if (newPassword !== newPassword2) { showError(forceChangeError, '新しいパスワードが一致しません。'); return; }
  if (newPassword.length < 8) { showError(forceChangeError, '新しいパスワードは8文字以上にしてください。'); return; }

  setLoading(true);
  try {
    const loginRes = await callApi({ action: 'login', email: pendingLoginEmail, password: currentPassword });
    if (!loginRes.success) { showError(forceChangeError, loginRes.message || '現在のパスワードが正しくありません。'); return; }

    const changeRes = await callApi({ action: 'changePassword', token: loginRes.token, currentPassword, newPassword });
    if (changeRes.success) {
      const session = { token: loginRes.token, nickname: loginRes.nickname, email: loginRes.email };
      saveSession(session);
      pendingLoginEmail = null;
      showEventList(session);
    } else {
      showError(forceChangeError, changeRes.message || 'パスワード変更に失敗しました。');
    }
  } catch (err) {
    showError(forceChangeError, '通信エラーが発生しました。時間をおいて再度お試しください。');
  } finally { setLoading(false); }
}

async function onLogout() {
  const session = getSession();
  setLoading(true);
  try {
    if (session && session.token) await callApi({ action: 'logout', token: session.token });
  } catch (err) { /* ignore */ }
  finally {
    clearSession();
    setLoading(false);
    showScreen('login');
  }
}

async function onNicknameSubmit(e) {
  e.preventDefault();
  hide(nicknameError); hide(nicknameMessage);

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
  } catch (err) { showError(nicknameError, '通信エラーが発生しました。'); }
  finally { setLoading(false); }
}

async function onPwChangeSubmit(e) {
  e.preventDefault();
  hide(pwChangeError); hide(pwChangeMessage);

  const session = getSession();
  if (!session) { showScreen('login'); return; }

  const currentPassword = document.getElementById('pwCurrent').value;
  const newPassword = document.getElementById('pwNew').value;
  const newPassword2 = document.getElementById('pwNew2').value;

  if (newPassword !== newPassword2) { showError(pwChangeError, '新しいパスワードが一致しません。'); return; }

  setLoading(true);
  try {
    const res = await callApi({ action: 'changePassword', token: session.token, currentPassword, newPassword });
    if (res.success) { pwChangeForm.reset(); showInfo(pwChangeMessage, 'パスワードを更新しました。'); }
    else { handleSessionAwareError(res, pwChangeError); }
  } catch (err) { showError(pwChangeError, '通信エラーが発生しました。'); }
  finally { setLoading(false); }
}

/* ============ イベント（サークル・活動）一覧 ============ */

async function loadEvents() {
  const session = getSession();
  if (!session) return;

  setLoading(true);
  try {
    const res = await callApi({ action: 'getEvents', token: session.token });
    if (res.success) renderEvents(res.events);
    else handleSessionAwareError(res, eventEmptyMessage);
  } catch (err) {
    showError(eventEmptyMessage, 'イベント一覧の取得に失敗しました。');
  } finally { setLoading(false); }
}

function renderEvents(events) {
  eventListEl.innerHTML = '';
  if (!events || events.length === 0) {
    show(eventEmptyMessage);
    return;
  }
  hide(eventEmptyMessage);

  events.forEach(ev => {
    const card = document.createElement('div');
    card.className = 'event-card';
    card.addEventListener('click', () => openEventDetail(ev.eventId));

    let badge = '<span class="status-badge none">未回答</span>';
    if (ev.myStatus === '参加') badge = '<span class="status-badge join">参加予定</span>';
    else if (ev.myStatus === '不参加') badge = '<span class="status-badge decline">不参加</span>';

    card.innerHTML = `
      <p class="event-card-title">${escapeHtml(ev.title)}</p>
      <p class="event-card-period">${formatPeriod(ev.startDate, ev.endDate)}</p>
      <div class="event-card-footer">
        <span class="event-card-counts">参加 ${ev.joinCount}人 / 不参加 ${ev.declineCount}人</span>
        ${badge}
      </div>
    `;
    eventListEl.appendChild(card);
  });
}

function showEventList(session) {
  showScreen('eventList');
  userNameLabel.textContent = `${session.nickname} さん`;
  loadEvents();
}

/* ============ イベント作成・編集 ============ */

function openEventForm(eventId) {
  eventForm.reset();
  hide(eventFormError);
  eventFormId.value = eventId || '';

  if (eventId) {
    eventFormTitle.textContent = '✏️ サークル・イベントを編集';
    const session = getSession();
    setLoading(true);
    callApi({ action: 'getEvents', token: session.token }).then(res => {
      if (res.success) {
        const ev = res.events.find(x => x.eventId === eventId);
        if (ev) {
          eventTitle.value = ev.title;
          eventDescription.value = ev.description || '';
          eventStartDate.value = ev.startDate ? ev.startDate.substring(0, 10) : '';
          eventEndDate.value = ev.endDate ? ev.endDate.substring(0, 10) : '';
        }
      }
    }).finally(() => setLoading(false));
  } else {
    eventFormTitle.textContent = '＋ サークル・イベントを作成';
  }

  showScreen('eventForm');
}

async function onEventFormSubmit(e) {
  e.preventDefault();
  hide(eventFormError);

  const session = getSession();
  if (!session) { showScreen('login'); return; }

  const eventId = eventFormId.value;
  const payload = {
    token: session.token,
    title: eventTitle.value.trim(),
    description: eventDescription.value.trim(),
    startDate: eventStartDate.value || null,
    endDate: eventEndDate.value || null
  };

  setLoading(true);
  try {
    const res = eventId
      ? await callApi({ action: 'updateEvent', eventId, ...payload })
      : await callApi({ action: 'createEvent', ...payload });

    if (res.success) {
      showScreen('eventList');
      loadEvents();
    } else {
      handleSessionAwareError(res, eventFormError);
    }
  } catch (err) {
    showError(eventFormError, '通信エラーが発生しました。');
  } finally { setLoading(false); }
}

async function onDeleteEvent() {
  if (!currentEventId) return;
  if (!confirm('このサークル・イベントを削除します。関連する投稿・参加登録もすべて削除されますが、よろしいですか？')) return;

  const session = getSession();
  setLoading(true);
  try {
    const res = await callApi({ action: 'deleteEvent', token: session.token, eventId: currentEventId });
    if (res.success) {
      showScreen('eventList');
      loadEvents();
    } else {
      alert(res.message || '削除に失敗しました。');
    }
  } catch (err) {
    alert('通信エラーが発生しました。');
  } finally { setLoading(false); }
}

/* ============ イベント詳細（参加登録＋掲示板） ============ */

async function openEventDetail(eventId) {
  currentEventId = eventId;
  hide(participantListBox);
  showScreen('eventDetail');

  const session = getSession();
  setLoading(true);
  try {
    const res = await callApi({ action: 'getEvents', token: session.token });
    if (!res.success) { handleSessionAwareError(res, postError); return; }

    const ev = res.events.find(x => x.eventId === eventId);
    if (!ev) { alert('イベントが見つかりません。'); showScreen('eventList'); loadEvents(); return; }

    eventDetailTitle.textContent = ev.title;
    eventDetailPeriod.textContent = formatPeriod(ev.startDate, ev.endDate);
    eventDetailDescription.textContent = ev.description || '（説明なし）';

    if (ev.isOwner) show(eventOwnerActions); else hide(eventOwnerActions);

    updateParticipationUI(ev.myStatus);
    joinCountLabel.textContent = `参加 ${ev.joinCount}人`;
    declineCountLabel.textContent = `不参加 ${ev.declineCount}人`;

    await loadPosts();
  } catch (err) {
    showError(postError, 'イベント情報の取得に失敗しました。');
  } finally { setLoading(false); }
}

function updateParticipationUI(status) {
  joinBtn.classList.toggle('active', status === '参加');
  declineBtn.classList.toggle('active', status === '不参加');
  if (status === '参加') myStatusLabel.textContent = '現在のステータス：参加予定';
  else if (status === '不参加') myStatusLabel.textContent = '現在のステータス：不参加';
  else myStatusLabel.textContent = 'まだ回答されていません';
}

async function onSetParticipation(status) {
  const session = getSession();
  if (!session || !currentEventId) return;

  setLoading(true);
  try {
    const res = await callApi({ action: 'setParticipation', token: session.token, eventId: currentEventId, status });
    if (res.success) {
      updateParticipationUI(res.status);
      await openEventDetail(currentEventId);
    } else {
      handleSessionAwareError(res, postError);
    }
  } catch (err) {
    alert('通信エラーが発生しました。');
  } finally { setLoading(false); }
}

async function loadParticipants() {
  const session = getSession();
  if (!session || !currentEventId) return;

  setLoading(true);
  try {
    const res = await callApi({ action: 'getParticipants', token: session.token, eventId: currentEventId });
    if (res.success) {
      joinedList.innerHTML = res.joined.length
        ? res.joined.map(p => `<li>${escapeHtml(p.nickname)}</li>`).join('')
        : '<li class="participant-none">いません</li>';
      declinedList.innerHTML = res.declined.length
        ? res.declined.map(p => `<li>${escapeHtml(p.nickname)}</li>`).join('')
        : '<li class="participant-none">いません</li>';
      show(participantListBox);
    }
  } catch (err) {
    alert('参加者一覧の取得に失敗しました。');
  } finally { setLoading(false); }
}

/* ============ 投稿（掲示板）関連 ============ */

async function onPostSubmit(e) {
  e.preventDefault();
  hide(postError);

  const session = getSession();
  if (!session || !currentEventId) return;

  const content = postContent.value.trim();
  if (!content) return;

  setLoading(true);
  try {
    const res = await callApi({ action: 'addPost', token: session.token, eventId: currentEventId, content });
    if (res.success) {
      postContent.value = '';
      charCount.textContent = '0 / 1000';
      await loadPosts();
    } else {
      handleSessionAwareError(res, postError);
    }
  } catch (err) {
    showError(postError, '投稿に失敗しました。通信環境をご確認ください。');
  } finally { setLoading(false); }
}

async function loadPosts() {
  const session = getSession();
  if (!session || !currentEventId) return;

  setLoading(true);
  try {
    const res = await callApi({ action: 'getPosts', token: session.token, eventId: currentEventId });
    if (res.success) renderPosts(res.posts);
    else handleSessionAwareError(res, postError);
  } catch (err) {
    showError(postError, '投稿の取得に失敗しました。');
  } finally { setLoading(false); }
}

function renderPosts(posts) {
  postList.innerHTML = '';
  if (!posts || posts.length === 0) { show(emptyMessage); return; }
  hide(emptyMessage);

  posts.forEach(post => {
    const card = document.createElement('div');
    card.className = 'post-card';
    card.dataset.postId = post.postId;

    const editedLabel = post.updatedAt && post.updatedAt !== post.createdAt ? '（編集済み）' : '';

    card.innerHTML = `
      <div class="post-card-header">
        <span class="post-author">${escapeHtml(post.authorName)}</span>
        <span class="post-date">${formatDate(post.createdAt)}${editedLabel}</span>
      </div>
      <div class="post-content">${escapeHtml(post.content)}</div>
      ${post.isMine ? `
        <div class="post-card-actions">
          <button class="edit-link">編集</button>
          <button class="delete-link">削除</button>
        </div>
      ` : ''}
    `;

    if (post.isMine) {
      card.querySelector('.edit-link').addEventListener('click', () => showPostEditForm(card, post));
      card.querySelector('.delete-link').addEventListener('click', () => onDeletePost(post.postId));
    }

    postList.appendChild(card);
  });
}

function showPostEditForm(card, post) {
  card.innerHTML = `
    <div class="post-edit-form">
      <textarea maxlength="1000">${escapeHtml(post.content)}</textarea>
      <div class="post-edit-actions">
        <button class="btn btn-primary save-edit-btn">保存</button>
        <button class="btn btn-ghost cancel-edit-btn">キャンセル</button>
      </div>
    </div>
  `;
  card.querySelector('.cancel-edit-btn').addEventListener('click', () => loadPosts());
  card.querySelector('.save-edit-btn').addEventListener('click', async () => {
    const newContent = card.querySelector('textarea').value.trim();
    if (!newContent) return;
    await onEditPost(post.postId, newContent);
  });
}

async function onEditPost(postId, content) {
  const session = getSession();
  if (!session) return;

  setLoading(true);
  try {
    const res = await callApi({ action: 'editPost', token: session.token, postId, content });
    if (res.success) await loadPosts();
    else { handleSessionAwareError(res, postError); }
  } catch (err) {
    alert('編集に失敗しました。');
  } finally { setLoading(false); }
}

async function onDeletePost(postId) {
  if (!confirm('この投稿を削除します。よろしいですか？')) return;

  const session = getSession();
  if (!session) return;

  setLoading(true);
  try {
    const res = await callApi({ action: 'deletePost', token: session.token, postId });
    if (res.success) await loadPosts();
    else { handleSessionAwareError(res, postError); }
  } catch (err) {
    alert('削除に失敗しました。');
  } finally { setLoading(false); }
}

/* ============ 共通 ============ */

function handleSessionAwareError(res, errorEl) {
  if (res.message && res.message.includes('セッション')) {
    clearSession();
    showScreen('login');
    showError(loginError, res.message);
  } else {
    showError(errorEl, res.message || 'エラーが発生しました。');
  }
}

function showScreen(name) {
  Object.values(screens).forEach(hide);
  show(screens[name]);
  if (name === 'login') loginForm.reset();
}

async function callApi(payload) {
  const res = await fetch(GAS_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error('HTTP Error: ' + res.status);
  return res.json();
}

function saveSession(session) { localStorage.setItem(STORAGE_KEY, JSON.stringify(session)); }
function getSession() { const raw = localStorage.getItem(STORAGE_KEY); return raw ? JSON.parse(raw) : null; }
function clearSession() { localStorage.removeItem(STORAGE_KEY); }

function show(el) { el.classList.remove('hidden'); }
function hide(el) { el.classList.add('hidden'); }
function showError(el, msg) { el.textContent = msg; show(el); }
function showInfo(el, msg) { el.textContent = msg; show(el); }
function setLoading(isLoading) { if (isLoading) show(loading); else hide(loading); }

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

function formatDate(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatShortDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}`;
}

function formatPeriod(startIso, endIso) {
  const start = formatShortDate(startIso);
  const end = formatShortDate(endIso);
  if (!start && !end) return '期間未設定';
  if (start && end) return `${start} 〜 ${end}`;
  if (start) return `${start} 〜`;
  return `〜 ${end}`;
}

// ===================================================================
// SnapCall - Snapchat-Style HD Video Calling & Friends System
// ===================================================================

// Global State
let socket = null;
let currentUser = null; // { id, username, name, email, avatar, authProvider, friends }
let myUsername = '';

let localStream = null;
let screenStream = null;
let activeCallType = 'video'; // 'video' | 'audio'
let isAudioMuted = false;
let isVideoMuted = false;
let isSpeakerMuted = false;
let isSharingScreen = false;

// Friends & Feed State
let friendsList = [];
let pendingReceivedList = [];
let pendingSentList = [];

// WebRTC State
const peerConnections = new Map(); // peerUsername -> RTCPeerConnection
const pendingIceCandidates = new Map(); // peerUsername -> Array<RTCIceCandidate>
let currentCallId = null;
let pendingIncomingCall = null;
let callDurationTimer = null;
let callStartTime = null;

// Audio Ringtone Synthesis (Web Audio API)
let audioCtx = null;
let ringInterval = null;

function playRingtone() {
  try {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    stopRingtone();

    ringInterval = setInterval(() => {
      try {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(440, audioCtx.currentTime);
        osc.frequency.setValueAtTime(480, audioCtx.currentTime + 0.06);
        gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 1.2);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start();
        osc.stop(audioCtx.currentTime + 1.2);
      } catch (e) {}
    }, 2500);
  } catch (e) {}
}

function stopRingtone() {
  if (ringInterval) {
    clearInterval(ringInterval);
    ringInterval = null;
  }
}

function playNotificationChime() {
  try {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(587.33, audioCtx.currentTime);
    osc.frequency.setValueAtTime(880, audioCtx.currentTime + 0.1);
    gain.gain.setValueAtTime(0.25, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.4);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.4);
  } catch (e) {}
}

// Carrier-grade STUN & TURN Configuration
const rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    {
      urls: [
        'turn:openrelay.metered.ca:80',
        'turn:openrelay.metered.ca:443',
        'turn:openrelay.metered.ca:443?transport=tcp'
      ],
      username: 'openrelay',
      credential: 'openrelay'
    }
  ]
};

// ===================================================================
// DOM ELEMENTS REFERENCE
// ===================================================================
const userProfileCapsule = document.getElementById('userProfileCapsule');
const guestAuthActions = document.getElementById('guestAuthActions');
const headerUserName = document.getElementById('headerUserName');
const headerUserHandle = document.getElementById('headerUserHandle');
const headerUserAvatar = document.getElementById('headerUserAvatar');
const headerUserAvatarPlaceholder = document.getElementById('headerUserAvatarPlaceholder');
const logoutBtn = document.getElementById('logoutBtn');
const openAuthModalBtn = document.getElementById('openAuthModalBtn');

// Feed Elements
const friendSearchInput = document.getElementById('friendSearchInput');
const searchActionBtn = document.getElementById('searchActionBtn');
const activeFriendsStoryList = document.getElementById('activeFriendsStoryList');
const myStoryRing = document.getElementById('myStoryRing');

const tabFeedFriends = document.getElementById('tabFeedFriends');
const tabFeedRequests = document.getElementById('tabFeedRequests');
const tabFeedAdd = document.getElementById('tabFeedAdd');

const feedPaneFriends = document.getElementById('feedPaneFriends');
const feedPaneRequests = document.getElementById('feedPaneRequests');
const feedPaneAdd = document.getElementById('feedPaneAdd');

const friendsCountBadge = document.getElementById('friendsCountBadge');
const requestsCountBadge = document.getElementById('requestsCountBadge');
const receivedCountLabel = document.getElementById('receivedCountLabel');
const sentCountLabel = document.getElementById('sentCountLabel');

const friendsListContainer = document.getElementById('friendsListContainer');
const friendsEmptyState = document.getElementById('friendsEmptyState');
const btnEmptyAddFriends = document.getElementById('btnEmptyAddFriends');

const receivedRequestsList = document.getElementById('receivedRequestsList');
const sentRequestsList = document.getElementById('sentRequestsList');

const addFriendInput = document.getElementById('addFriendInput');
const sendAddSearchBtn = document.getElementById('sendAddSearchBtn');
const searchResultCard = document.getElementById('searchResultCard');
const resultAvatar = document.getElementById('resultAvatar');
const resultName = document.getElementById('resultName');
const resultUsername = document.getElementById('resultUsername');
const sendRequestBtn = document.getElementById('sendRequestBtn');
const resultStatusText = document.getElementById('resultStatusText');

// Video Stage Elements
const immersiveVideoFrame = document.getElementById('immersiveVideoFrame');
const remoteVideo = document.getElementById('remoteVideo');
const stageIdleCanvas = document.getElementById('stageIdleCanvas');
const remoteAudioOnlyAvatar = document.getElementById('remoteAudioOnlyAvatar');
const remoteAudioAvatar = document.getElementById('remoteAudioAvatar');
const remoteAudioName = document.getElementById('remoteAudioName');

const videoTopHud = document.getElementById('videoTopHud');
const hudFriendAvatar = document.getElementById('hudFriendAvatar');
const hudFriendName = document.getElementById('hudFriendName');
const callTimer = document.getElementById('callTimer');
const headerFullscreenBtn = document.getElementById('headerFullscreenBtn');

const pipLocalCamera = document.getElementById('pipLocalCamera');
const localVideo = document.getElementById('localVideo');
const localAvatarFallback = document.getElementById('localAvatarFallback');
const localAvatarLetter = document.getElementById('localAvatarLetter');

// Floating Snapchat Control Capsule
const snapControlCapsule = document.getElementById('snapControlCapsule');
const toggleMicBtn = document.getElementById('toggleMicBtn');
const micBtnIcon = document.getElementById('micBtnIcon');
const toggleCamBtn = document.getElementById('toggleCamBtn');
const camBtnIcon = document.getElementById('camBtnIcon');
const endCallBtn = document.getElementById('endCallBtn');
const toggleSpeakerBtn = document.getElementById('toggleSpeakerBtn');
const speakerBtnIcon = document.getElementById('speakerBtnIcon');
const shareScreenBtn = document.getElementById('shareScreenBtn');
const toggleFullscreenBtn = document.getElementById('toggleFullscreenBtn');

const debugLogs = document.getElementById('debugLogs');
const clearLogsBtn = document.getElementById('clearLogsBtn');

// Modals
const authModal = document.getElementById('authModal');
const authTabLogin = document.getElementById('authTabLogin');
const authTabRegister = document.getElementById('authTabRegister');
const authAlertBox = document.getElementById('authAlertBox');
const loginForm = document.getElementById('loginForm');
const registerForm = document.getElementById('registerForm');
const loginEmail = document.getElementById('loginEmail');
const loginPassword = document.getElementById('loginPassword');
const regName = document.getElementById('regName');
const regUsername = document.getElementById('regUsername');
const regEmail = document.getElementById('regEmail');
const regPassword = document.getElementById('regPassword');
const btnLoginSubmit = document.getElementById('btnLoginSubmit');
const btnRegisterSubmit = document.getElementById('btnRegisterSubmit');
const btnGoogleSignIn = document.getElementById('btnGoogleSignIn');
const btnQuickDemoLogin = document.getElementById('btnQuickDemoLogin');

const googleChooserModal = document.getElementById('googleChooserModal');
const googleCustomEmail = document.getElementById('googleCustomEmail');
const googleCustomName = document.getElementById('googleCustomName');
const googleConfirmBtn = document.getElementById('googleConfirmBtn');
const googleCancelBtn = document.getElementById('googleCancelBtn');

const notFriendsAlertModal = document.getElementById('notFriendsAlertModal');
const notFriendsAlertMsg = document.getElementById('notFriendsAlertMsg');
const alertSendRequestBtn = document.getElementById('alertSendRequestBtn');
const alertDismissBtn = document.getElementById('alertDismissBtn');
let alertTargetUsername = '';

const outgoingCallModal = document.getElementById('outgoingCallModal');
const outgoingTargetAvatar = document.getElementById('outgoingTargetAvatar');
const outgoingTargetName = document.getElementById('outgoingTargetName');
const outgoingTargetHandle = document.getElementById('outgoingTargetHandle');
const outgoingStatusText = document.getElementById('outgoingStatusText');
const cancelOutgoingCallBtn = document.getElementById('cancelOutgoingCallBtn');

const incomingCallModal = document.getElementById('incomingCallModal');
const incomingCallerAvatar = document.getElementById('incomingCallerAvatar');
const incomingCallerName = document.getElementById('incomingCallerName');
const incomingCallerHandle = document.getElementById('incomingCallerHandle');
const acceptCallStandardBtn = document.getElementById('acceptCallStandardBtn');
const declineCallBtn = document.getElementById('declineCallBtn');

// ===================================================================
// LOGGING UTILITY
// ===================================================================
function addLog(msg, type = 'info') {
  console.log(`[${type.toUpperCase()}] ${msg}`);
  if (!debugLogs) return;
  const entry = document.createElement('div');
  entry.className = `log-entry log-${type}`;
  const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  entry.textContent = `[${time}] ${msg}`;
  debugLogs.appendChild(entry);
  debugLogs.scrollTop = debugLogs.scrollHeight;
}

if (clearLogsBtn) {
  clearLogsBtn.addEventListener('click', () => {
    debugLogs.innerHTML = '<div class="log-entry log-system">[LOGS CLEARED]</div>';
  });
}

// ===================================================================
// AUTHENTICATION & SESSION MANAGEMENT
// ===================================================================
const AUTH_STORAGE_KEY = 'snapcall_auth_user';

function getStoredUser() {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return null;
}

function setStoredUser(user) {
  try {
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(user));
  } catch (e) {}
  currentUser = user;
}

function clearStoredUser() {
  try {
    localStorage.removeItem(AUTH_STORAGE_KEY);
  } catch (e) {}
  currentUser = null;
}

function showAuthAlert(msg) {
  if (!authAlertBox) return;
  authAlertBox.textContent = msg;
  authAlertBox.style.display = 'block';
}

function hideAuthAlert() {
  if (authAlertBox) authAlertBox.style.display = 'none';
}

function openAuthModal() {
  hideAuthAlert();
  if (authModal) authModal.style.display = 'flex';
}

function closeAuthModal() {
  if (authModal) authModal.style.display = 'none';
}

// Switch tabs between Login & Sign Up
if (authTabLogin && authTabRegister) {
  authTabLogin.addEventListener('click', () => {
    authTabLogin.classList.add('active');
    authTabRegister.classList.remove('active');
    loginForm.style.display = 'flex';
    registerForm.style.display = 'none';
    hideAuthAlert();
  });

  authTabRegister.addEventListener('click', () => {
    authTabRegister.classList.add('active');
    authTabLogin.classList.remove('active');
    registerForm.style.display = 'flex';
    loginForm.style.display = 'none';
    hideAuthAlert();
  });
}

// Email/Username Login
if (loginForm) {
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideAuthAlert();
    const emailOrUsername = loginEmail.value.trim();
    const password = loginPassword.value;

    if (!emailOrUsername || !password) {
      showAuthAlert('Please enter your username/email and password.');
      return;
    }

    try {
      btnLoginSubmit.disabled = true;
      btnLoginSubmit.textContent = 'Logging in...';

      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emailOrUsername, password })
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        showAuthAlert(data.error || 'Login failed.');
        return;
      }

      setStoredUser(data.user);
      closeAuthModal();
      initAppSession(data.user);
    } catch (err) {
      showAuthAlert('Network error: ' + err.message);
    } finally {
      btnLoginSubmit.disabled = false;
      btnLoginSubmit.textContent = 'Log In ➜';
    }
  });
}

// Sign Up
if (registerForm) {
  registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideAuthAlert();
    const name = regName.value.trim();
    const username = regUsername.value.trim().toLowerCase().replace(/^@+/, '');
    const email = regEmail.value.trim();
    const password = regPassword.value;

    if (!name || !username || !email || !password) {
      showAuthAlert('Please fill in all fields.');
      return;
    }

    try {
      btnRegisterSubmit.disabled = true;
      btnRegisterSubmit.textContent = 'Creating account...';

      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, username, email, password })
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        showAuthAlert(data.error || 'Registration failed.');
        return;
      }

      setStoredUser(data.user);
      closeAuthModal();
      initAppSession(data.user);
    } catch (err) {
      showAuthAlert('Network error: ' + err.message);
    } finally {
      btnRegisterSubmit.disabled = false;
      btnRegisterSubmit.textContent = 'Sign Up & Get Started ➜';
    }
  });
}

// Google Sign-In Actions
if (btnGoogleSignIn) {
  btnGoogleSignIn.addEventListener('click', () => {
    if (googleChooserModal) googleChooserModal.style.display = 'flex';
  });
}

if (btnQuickDemoLogin) {
  btnQuickDemoLogin.addEventListener('click', () => {
    const demoOptions = [
      { email: 'nitish@gmail.com', name: 'Nitish Singh', username: 'nitish' },
      { email: 'alex@gmail.com', name: 'Alex Kumar', username: 'alex' }
    ];
    const pick = demoOptions[Math.floor(Math.random() * demoOptions.length)];
    performGoogleAuth(pick.email, pick.name, pick.username);
  });
}

if (googleCancelBtn) {
  googleCancelBtn.addEventListener('click', () => {
    if (googleChooserModal) googleChooserModal.style.display = 'none';
  });
}

if (googleConfirmBtn) {
  googleConfirmBtn.addEventListener('click', () => {
    const email = (googleCustomEmail.value || '').trim();
    const name = (googleCustomName.value || '').trim() || email.split('@')[0];
    if (!email || !email.includes('@')) {
      alert('Please enter a valid Google email.');
      return;
    }
    if (googleChooserModal) googleChooserModal.style.display = 'none';
    performGoogleAuth(email, name);
  });
}

async function performGoogleAuth(email, name, username) {
  try {
    const res = await fetch('/api/auth/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        name,
        username,
        picture: `https://api.dicebear.com/7.x/adventurer/svg?seed=${encodeURIComponent(username || email.split('@')[0])}`
      })
    });
    const data = await res.json();

    if (!res.ok || !data.success) {
      showAuthAlert(data.error || 'Google login failed.');
      return;
    }

    setStoredUser(data.user);
    closeAuthModal();
    initAppSession(data.user);
  } catch (err) {
    showAuthAlert('Google auth error: ' + err.message);
  }
}

if (openAuthModalBtn) {
  openAuthModalBtn.addEventListener('click', openAuthModal);
}

if (logoutBtn) {
  logoutBtn.addEventListener('click', () => {
    if (confirm('Sign out of your SnapCall account?')) {
      clearStoredUser();
      if (socket) socket.disconnect();
      window.location.reload();
    }
  });
}

// ===================================================================
// FEED TABS SWITCHER (FRIENDS, ADDED ME, ADD)
// ===================================================================
function setupFeedTabs() {
  const tabs = [
    { btn: tabFeedFriends, pane: feedPaneFriends },
    { btn: tabFeedRequests, pane: feedPaneRequests },
    { btn: tabFeedAdd, pane: feedPaneAdd }
  ];

  tabs.forEach(t => {
    if (t.btn && t.pane) {
      t.btn.addEventListener('click', () => {
        tabs.forEach(item => {
          if (item.btn) item.btn.classList.remove('active');
          if (item.pane) item.pane.classList.remove('active');
        });
        t.btn.classList.add('active');
        t.pane.classList.add('active');
      });
    }
  });

  if (btnEmptyAddFriends && tabFeedAdd) {
    btnEmptyAddFriends.addEventListener('click', () => tabFeedAdd.click());
  }

  if (myStoryRing && tabFeedAdd) {
    myStoryRing.addEventListener('click', () => tabFeedAdd.click());
  }
}

// ===================================================================
// RENDER SNAPCHAT FRIENDS & STORIES FEED
// ===================================================================
function renderFriendsFeed() {
  if (!friendsListContainer) return;
  friendsListContainer.innerHTML = '';

  // Update Stories row
  if (activeFriendsStoryList) {
    activeFriendsStoryList.innerHTML = '';
    const onlineFriends = friendsList.filter(f => f.isOnline);
    onlineFriends.forEach(f => {
      const story = document.createElement('div');
      story.className = 'story-item';
      story.innerHTML = `
        <div class="story-ring active-ring" title="Call @${f.username}">
          <img src="${f.avatar || 'https://api.dicebear.com/7.x/adventurer/svg?seed=' + f.username}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">
        </div>
        <span class="story-label">${escapeHtml(f.name.split(' ')[0])}</span>
      `;
      story.addEventListener('click', () => {
        callFriend(f.username, 'video', f);
      });
      activeFriendsStoryList.appendChild(story);
    });
  }

  // Update Friends Count Badge
  if (friendsCountBadge) {
    const onlineCount = friendsList.filter(f => f.isOnline).length;
    friendsCountBadge.textContent = `${onlineCount}/${friendsList.length}`;
  }

  if (friendsList.length === 0) {
    if (friendsEmptyState) friendsEmptyState.style.display = 'block';
    friendsListContainer.appendChild(friendsEmptyState);
    return;
  }

  friendsList.forEach(friend => {
    const card = document.createElement('div');
    card.className = 'snap-friend-card';

    const onlineClass = friend.inCall ? 'incall' : (friend.isOnline ? 'online' : '');
    const statusText = friend.inCall ? '📞 In Call' : (friend.isOnline ? 'Active now 🟢' : 'Offline');

    card.innerHTML = `
      <div class="friend-main-info">
        <div class="friend-bitmoji-box">
          <img class="friend-bitmoji-img" src="${friend.avatar || 'https://api.dicebear.com/7.x/adventurer/svg?seed=' + friend.username}">
          <span class="friend-dot ${onlineClass}"></span>
        </div>
        <div class="friend-details">
          <span class="friend-name">${escapeHtml(friend.name)}</span>
          <span class="friend-handle">@${escapeHtml(friend.username)}</span>
          <span class="friend-status-text">${statusText}</span>
        </div>
      </div>
      <div class="friend-call-btns">
        <button class="btn-snap-call btn-call-cam" title="HD Video Call with @${friend.username}">
          📹
        </button>
        <button class="btn-snap-call btn-call-mic" title="Audio Call with @${friend.username}">
          📞
        </button>
      </div>
    `;

    card.querySelector('.btn-call-cam').addEventListener('click', () => {
      callFriend(friend.username, 'video', friend);
    });

    card.querySelector('.btn-call-mic').addEventListener('click', () => {
      callFriend(friend.username, 'audio', friend);
    });

    friendsListContainer.appendChild(card);
  });
}

// ===================================================================
// RENDER REQUESTS (ADDED ME & SENT)
// ===================================================================
function renderRequests() {
  if (receivedRequestsList) {
    receivedRequestsList.innerHTML = '';
    if (pendingReceivedList.length === 0) {
      receivedRequestsList.innerHTML = '<div class="empty-requests-notice">No pending requests.</div>';
    } else {
      pendingReceivedList.forEach(req => {
        const item = document.createElement('div');
        item.className = 'request-card';
        item.innerHTML = `
          <div class="req-user-meta">
            <img src="${req.avatar || 'https://api.dicebear.com/7.x/adventurer/svg?seed=' + req.username}" style="width:34px;height:34px;border-radius:50%;object-fit:cover;">
            <div>
              <div class="req-name">${escapeHtml(req.name)}</div>
              <div class="req-handle">@${escapeHtml(req.username)}</div>
            </div>
          </div>
          <div class="req-actions">
            <button class="btn-snap-accept">Accept</button>
            <button class="btn-snap-decline">✕</button>
          </div>
        `;

        item.querySelector('.btn-snap-accept').addEventListener('click', () => {
          if (socket) socket.emit('accept-friend-request', { senderUsername: req.username });
        });

        item.querySelector('.btn-snap-decline').addEventListener('click', () => {
          if (socket) socket.emit('reject-friend-request', { senderUsername: req.username });
        });

        receivedRequestsList.appendChild(item);
      });
    }
  }

  if (sentRequestsList) {
    sentRequestsList.innerHTML = '';
    if (pendingSentList.length === 0) {
      sentRequestsList.innerHTML = '<div class="empty-requests-notice">No sent requests.</div>';
    } else {
      pendingSentList.forEach(req => {
        const item = document.createElement('div');
        item.className = 'request-card';
        item.innerHTML = `
          <div class="req-user-meta">
            <div>
              <div class="req-name">${escapeHtml(req.name)}</div>
              <div class="req-handle">@${escapeHtml(req.username)} • Pending</div>
            </div>
          </div>
        `;
        sentRequestsList.appendChild(item);
      });
    }
  }

  // Count badges
  const totalPending = pendingReceivedList.length;
  if (requestsCountBadge) {
    if (totalPending > 0) {
      requestsCountBadge.textContent = totalPending;
      requestsCountBadge.style.display = 'inline-block';
    } else {
      requestsCountBadge.style.display = 'none';
    }
  }
  if (receivedCountLabel) receivedCountLabel.textContent = `${pendingReceivedList.length} pending`;
  if (sentCountLabel) sentCountLabel.textContent = `${pendingSentList.length} sent`;
}

// ===================================================================
// ADD FRIEND SEARCH & ACTION
// ===================================================================
if (sendAddSearchBtn && addFriendInput) {
  sendAddSearchBtn.addEventListener('click', executeFriendSearch);
  addFriendInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') executeFriendSearch();
  });
}

if (friendSearchInput && searchActionBtn) {
  searchActionBtn.addEventListener('click', () => {
    if (addFriendInput) addFriendInput.value = friendSearchInput.value;
    if (tabFeedAdd) tabFeedAdd.click();
    executeFriendSearch();
  });
}

async function executeFriendSearch() {
  const query = (addFriendInput.value || '').trim();
  if (!query) return;

  try {
    sendAddSearchBtn.disabled = true;
    sendAddSearchBtn.textContent = 'Searching...';

    const res = await fetch(`/api/user/search?q=${encodeURIComponent(query)}&requester=${encodeURIComponent(myUsername)}`);
    const data = await res.json();

    if (!data || !data.user) {
      if (searchResultCard) {
        searchResultCard.style.display = 'block';
        resultAvatar.textContent = '❓';
        resultName.textContent = 'User Not Found';
        resultUsername.textContent = 'No SnapCall account found';
        sendRequestBtn.style.display = 'none';
        resultStatusText.style.display = 'block';
        resultStatusText.textContent = 'Make sure the user has created an account on SnapCall!';
        resultStatusText.style.color = '#ef4444';
      }
      return;
    }

    renderSearchResult(data);
  } catch (err) {
    alert('Search error: ' + err.message);
  } finally {
    sendAddSearchBtn.disabled = false;
    sendAddSearchBtn.textContent = 'Add ➕';
  }
}

function renderSearchResult(data) {
  if (!searchResultCard) return;
  const user = data.user;
  const relation = data.relation;

  searchResultCard.style.display = 'block';
  resultAvatar.innerHTML = `<img src="${user.avatar || 'https://api.dicebear.com/7.x/adventurer/svg?seed=' + user.username}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">`;
  resultName.textContent = user.name;
  resultUsername.textContent = `@${user.username}`;

  resultStatusText.style.display = 'none';
  sendRequestBtn.style.display = 'block';
  sendRequestBtn.disabled = false;

  if (relation === 'self') {
    sendRequestBtn.disabled = true;
    sendRequestBtn.textContent = 'You';
  } else if (relation === 'friends') {
    sendRequestBtn.disabled = true;
    sendRequestBtn.textContent = '✔ Already Friends';
  } else if (relation === 'pending_sent') {
    sendRequestBtn.disabled = true;
    sendRequestBtn.textContent = '⏳ Request Pending';
  } else if (relation === 'pending_received') {
    sendRequestBtn.textContent = '✔ Accept Request';
    sendRequestBtn.onclick = () => {
      if (socket) socket.emit('accept-friend-request', { senderUsername: user.username });
      searchResultCard.style.display = 'none';
    };
    return;
  } else {
    sendRequestBtn.textContent = '➕ Add Friend';
  }

  sendRequestBtn.onclick = () => {
    if (!socket) return;
    sendRequestBtn.disabled = true;
    sendRequestBtn.textContent = 'Sending...';
    socket.emit('send-friend-request', { targetQuery: user.username });
  };
}

// ===================================================================
// NOT-FRIENDS ALERT
// ===================================================================
function showNotFriendsAlert(msg, targetUname) {
  alertTargetUsername = targetUname || '';
  if (notFriendsAlertMsg) notFriendsAlertMsg.textContent = msg || 'You must be friends to call on SnapCall.';
  if (notFriendsAlertModal) notFriendsAlertModal.style.display = 'flex';
}

if (alertDismissBtn) {
  alertDismissBtn.addEventListener('click', () => {
    if (notFriendsAlertModal) notFriendsAlertModal.style.display = 'none';
  });
}

if (alertSendRequestBtn) {
  alertSendRequestBtn.addEventListener('click', () => {
    if (notFriendsAlertModal) notFriendsAlertModal.style.display = 'none';
    if (alertTargetUsername && socket) {
      socket.emit('send-friend-request', { targetQuery: alertTargetUsername });
      if (tabFeedAdd) tabFeedAdd.click();
    }
  });
}

// ===================================================================
// SNAPCHAT-STYLE VIDEO CALLING ENGINE
// ===================================================================
function callFriend(targetUsername, type = 'video', friendObj = null) {
  const cleanTarget = targetUsername.trim().toLowerCase().replace(/^@+/, '');
  if (!cleanTarget) return;

  if (cleanTarget === myUsername.toLowerCase()) {
    alert('You cannot video call yourself.');
    return;
  }

  // Client-side Friend Verification
  const isFriend = friendsList.some(f => f.username.toLowerCase() === cleanTarget);
  if (!isFriend && !friendObj) {
    showNotFriendsAlert(
      `@${cleanTarget} is not on your friends list. You can only call friends! Add them first.`,
      cleanTarget
    );
    return;
  }

  activeCallType = type;
  addLog(`Starting ${type.toUpperCase()} call to @${cleanTarget}...`, 'signal');

  // Open Outgoing Call Overlay
  if (outgoingTargetName) {
    outgoingTargetName.textContent = friendObj ? friendObj.name : `Calling @${cleanTarget}`;
  }
  if (outgoingTargetHandle) {
    outgoingTargetHandle.textContent = `@${cleanTarget}`;
  }
  if (outgoingTargetAvatar) {
    if (friendObj && friendObj.avatar) {
      outgoingTargetAvatar.innerHTML = `<img src="${friendObj.avatar}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">`;
    } else {
      outgoingTargetAvatar.textContent = '👻';
    }
  }
  if (outgoingStatusText) outgoingStatusText.textContent = 'RINGING... 🔔';
  if (outgoingCallModal) outgoingCallModal.style.display = 'flex';

  playRingtone();

  if (socket) {
    socket.emit('initiate-call', {
      targetUsername: cleanTarget,
      callType: type
    });
  }
}

if (cancelOutgoingCallBtn) {
  cancelOutgoingCallBtn.addEventListener('click', () => {
    stopRingtone();
    if (outgoingCallModal) outgoingCallModal.style.display = 'none';
    if (socket && currentCallId) {
      socket.emit('end-call', { callId: currentCallId });
    }
  });
}

function closeOutgoingModal() {
  stopRingtone();
  if (outgoingCallModal) outgoingCallModal.style.display = 'none';
}

// ===================================================================
// INCOMING CALL HANDLING
// ===================================================================
function handleIncomingCall(data) {
  pendingIncomingCall = data;
  playRingtone();

  if (incomingCallerName) incomingCallerName.textContent = data.callerName || `@${data.callerUsername}`;
  if (incomingCallerHandle) incomingCallerHandle.textContent = `@${data.callerUsername}`;
  if (incomingCallerAvatar) {
    if (data.callerAvatar) {
      incomingCallerAvatar.innerHTML = `<img src="${data.callerAvatar}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">`;
    } else {
      incomingCallerAvatar.textContent = '👻';
    }
  }

  if (incomingCallModal) incomingCallModal.style.display = 'flex';
}

function closeIncomingModal() {
  stopRingtone();
  pendingIncomingCall = null;
  if (incomingCallModal) incomingCallModal.style.display = 'none';
}

if (acceptCallStandardBtn) {
  acceptCallStandardBtn.addEventListener('click', () => {
    if (!pendingIncomingCall || !socket) return;
    const callId = pendingIncomingCall.callId;
    closeIncomingModal();
    addLog('Connecting call...', 'signal');
    socket.emit('accept-call', { callId });
  });
}

if (declineCallBtn) {
  declineCallBtn.addEventListener('click', () => {
    if (!pendingIncomingCall || !socket) return;
    const callId = pendingIncomingCall.callId;
    closeIncomingModal();
    addLog('Call declined.', 'info');
    socket.emit('reject-call', { callId });
  });
}

// ===================================================================
// PHYSICAL CAMERA & PIP ACQUISITION
// ===================================================================
async function acquirePhysicalMedia(preferAudioOnly = false) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error('CAMERA_NOT_SUPPORTED');
  }

  if (preferAudioOnly) {
    return await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  }

  if (localStream) {
    try { localStream.getTracks().forEach(t => t.stop()); } catch (e) {}
    localStream = null;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    });
    if (stream && stream.getVideoTracks().length > 0) return stream;
  } catch (e1) {}

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    if (stream && stream.getVideoTracks().length > 0) return stream;
  } catch (e2) {}

  return await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
}

async function initLocalMedia(callType = 'video') {
  try {
    localStream = await acquirePhysicalMedia(callType === 'audio');
    if (localVideo) {
      localVideo.srcObject = localStream;
      localVideo.play().catch(() => {});
    }

    if (callType === 'audio' || localStream.getVideoTracks().length === 0) {
      if (localAvatarFallback) localAvatarFallback.style.display = 'flex';
      if (localVideo) localVideo.style.display = 'none';
    } else {
      if (localAvatarFallback) localAvatarFallback.style.display = 'none';
      if (localVideo) localVideo.style.display = 'block';
    }
  } catch (err) {
    addLog(`Media note: ${err.message}`, 'warning');
  }
}

// ===================================================================
// WEBRTC PEER CONNECTIONS
// ===================================================================
async function getOrCreatePeerConnection(peerUsername) {
  if (peerConnections.has(peerUsername)) {
    return peerConnections.get(peerUsername);
  }

  const pc = new RTCPeerConnection(rtcConfig);
  peerConnections.set(peerUsername, pc);

  if (localStream) {
    localStream.getTracks().forEach(track => {
      pc.addTrack(track, localStream);
    });
  }

  pc.ontrack = (event) => {
    addLog(`[WebRTC] Remote stream track connected: ${event.track.kind}`, 'signal');
    if (remoteVideo) {
      remoteVideo.srcObject = event.streams[0];
      remoteVideo.style.display = 'block';
      remoteVideo.play().catch(() => {});
    }
    if (stageIdleCanvas) stageIdleCanvas.style.display = 'none';

    if (activeCallType === 'audio') {
      if (remoteAudioOnlyAvatar) remoteAudioOnlyAvatar.style.display = 'flex';
      if (remoteVideo) remoteVideo.style.display = 'none';
    }
  };

  pc.onicecandidate = (event) => {
    if (event.candidate && socket) {
      socket.emit('ice-candidate', {
        targetUsername: peerUsername,
        candidate: event.candidate,
        callId: currentCallId
      });
    }
  };

  return pc;
}

async function initiatePeerConnection(peerUsername, isCaller = false) {
  const pc = await getOrCreatePeerConnection(peerUsername);

  if (isCaller) {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    if (socket) {
      socket.emit('webrtc-offer', {
        targetUsername: peerUsername,
        offer,
        callId: currentCallId
      });
    }
  }
}

async function processPendingIceCandidates(peerUname, pc) {
  if (!pendingIceCandidates.has(peerUname) || !pc || !pc.remoteDescription) return;
  const queue = pendingIceCandidates.get(peerUname);
  pendingIceCandidates.delete(peerUname);
  for (const candidate of queue) {
    try {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (e) {}
  }
}

// ===================================================================
// ACTIVE CALL UI & HUD
// ===================================================================
function startCallSessionUI(peerInfo, callType) {
  if (stageIdleCanvas) stageIdleCanvas.style.display = 'none';
  if (videoTopHud) videoTopHud.style.display = 'flex';
  if (hudFriendName) hudFriendName.textContent = peerInfo?.name || `@${peerInfo?.username}`;
  if (hudFriendAvatar) {
    if (peerInfo?.avatar) {
      hudFriendAvatar.innerHTML = `<img src="${peerInfo.avatar}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">`;
    } else {
      hudFriendAvatar.textContent = '👤';
    }
  }

  // Duration Timer
  callStartTime = Date.now();
  if (callDurationTimer) clearInterval(callDurationTimer);
  callDurationTimer = setInterval(() => {
    const sec = Math.floor((Date.now() - callStartTime) / 1000);
    const m = String(Math.floor(sec / 60)).padStart(2, '0');
    const s = String(sec % 60).padStart(2, '0');
    if (callTimer) callTimer.textContent = `${m}:${s}`;
  }, 1000);

  initLocalMedia(callType);
}

function endCurrentCallLocal(emitToServer = true) {
  if (callDurationTimer) {
    clearInterval(callDurationTimer);
    callDurationTimer = null;
  }

  peerConnections.forEach(pc => {
    try { pc.close(); } catch (e) {}
  });
  peerConnections.clear();
  pendingIceCandidates.clear();

  if (remoteVideo) {
    remoteVideo.srcObject = null;
    remoteVideo.style.display = 'none';
  }
  if (stageIdleCanvas) stageIdleCanvas.style.display = 'block';
  if (remoteAudioOnlyAvatar) remoteAudioOnlyAvatar.style.display = 'none';
  if (videoTopHud) videoTopHud.style.display = 'none';
  if (callTimer) callTimer.textContent = '00:00';

  if (emitToServer && socket && currentCallId) {
    socket.emit('end-call', { callId: currentCallId });
  }
  currentCallId = null;
  addLog('Video call ended.', 'info');
}

// Call Control Buttons
if (endCallBtn) {
  endCallBtn.addEventListener('click', () => endCurrentCallLocal(true));
}

if (toggleMicBtn) {
  toggleMicBtn.addEventListener('click', () => {
    if (!localStream) return;
    isAudioMuted = !isAudioMuted;
    localStream.getAudioTracks().forEach(t => { t.enabled = !isAudioMuted; });
    micBtnIcon.textContent = isAudioMuted ? '🔇' : '🎤';
    toggleMicBtn.style.background = isAudioMuted ? 'rgba(239, 68, 68, 0.4)' : '';
    if (socket) socket.emit('peer-media-state', { isAudioMuted, isVideoMuted });
  });
}

if (toggleCamBtn) {
  toggleCamBtn.addEventListener('click', () => {
    if (!localStream) return;
    isVideoMuted = !isVideoMuted;
    localStream.getVideoTracks().forEach(t => { t.enabled = !isVideoMuted; });
    camBtnIcon.textContent = isVideoMuted ? '🚫' : '📹';
    toggleCamBtn.style.background = isVideoMuted ? 'rgba(239, 68, 68, 0.4)' : '';
    if (localAvatarFallback) localAvatarFallback.style.display = isVideoMuted ? 'flex' : 'none';
    if (localVideo) localVideo.style.display = isVideoMuted ? 'none' : 'block';
  });
}

if (toggleSpeakerBtn) {
  toggleSpeakerBtn.addEventListener('click', () => {
    isSpeakerMuted = !isSpeakerMuted;
    if (remoteVideo) remoteVideo.muted = isSpeakerMuted;
    speakerBtnIcon.textContent = isSpeakerMuted ? '🔇' : '🔊';
    toggleSpeakerBtn.style.background = isSpeakerMuted ? 'rgba(239, 68, 68, 0.4)' : '';
  });
}

if (shareScreenBtn) {
  shareScreenBtn.addEventListener('click', async () => {
    if (!isSharingScreen) {
      try {
        screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        const screenTrack = screenStream.getVideoTracks()[0];
        peerConnections.forEach(pc => {
          const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
          if (sender) sender.replaceTrack(screenTrack);
        });
        if (localVideo) localVideo.srcObject = screenStream;
        shareScreenBtn.style.background = 'rgba(255, 252, 0, 0.3)';
        isSharingScreen = true;

        screenTrack.onended = () => stopScreenSharing();
      } catch (e) {}
    } else {
      stopScreenSharing();
    }
  });
}

function stopScreenSharing() {
  if (screenStream) {
    screenStream.getTracks().forEach(t => t.stop());
    screenStream = null;
  }
  if (localStream) {
    const videoTrack = localStream.getVideoTracks()[0];
    peerConnections.forEach(pc => {
      const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
      if (sender && videoTrack) sender.replaceTrack(videoTrack);
    });
    if (localVideo) localVideo.srcObject = localStream;
  }
  if (shareScreenBtn) shareScreenBtn.style.background = '';
  isSharingScreen = false;
}

if (toggleFullscreenBtn || headerFullscreenBtn) {
  const toggleFull = () => {
    const frame = document.getElementById('immersiveVideoFrame');
    if (!frame) return;
    if (!document.fullscreenElement) {
      frame.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };
  if (toggleFullscreenBtn) toggleFullscreenBtn.addEventListener('click', toggleFull);
  if (headerFullscreenBtn) headerFullscreenBtn.addEventListener('click', toggleFull);
}

// ===================================================================
// APPLICATION INIT & SOCKET CONNECTION
// ===================================================================
function initAppSession(user) {
  currentUser = user;
  myUsername = user.username;

  if (userProfileCapsule) userProfileCapsule.style.display = 'flex';
  if (guestAuthActions) guestAuthActions.style.display = 'none';
  if (headerUserName) headerUserName.textContent = user.name;
  if (headerUserHandle) headerUserHandle.textContent = `@${user.username}`;

  if (user.avatar) {
    if (headerUserAvatar) {
      headerUserAvatar.src = user.avatar;
      headerUserAvatar.style.display = 'block';
    }
    if (headerUserAvatarPlaceholder) headerUserAvatarPlaceholder.style.display = 'none';
  }

  connectSocketIO();
}

function connectSocketIO() {
  if (socket) socket.disconnect();

  socket = io({
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionAttempts: 25
  });

  socket.on('connect', () => {
    addLog(`Connected to SnapCall. Authenticated as @${myUsername}`, 'success');
    socket.emit('register-user', {
      username: myUsername,
      name: currentUser?.name,
      email: currentUser?.email,
      avatar: currentUser?.avatar
    });
  });

  socket.on('disconnect', () => {
    addLog('Disconnected from SnapCall server. Reconnecting...', 'warning');
  });

  // Real-time Friends Sync
  socket.on('friends-data-updated', (data) => {
    friendsList = data.friends || [];
    pendingReceivedList = data.pendingReceived || [];
    pendingSentList = data.pendingSent || [];
    renderFriendsFeed();
    renderRequests();
  });

  // Real-time Incoming Friend Request Alert
  socket.on('incoming-friend-request', ({ sender }) => {
    addLog(`[FRIEND REQUEST] Incoming request from @${sender.username} (${sender.name})`, 'signal');
    playNotificationChime();
    alert(`👻 Friend Request: @${sender.username} (${sender.name}) added you on SnapCall! Accept in the Added Me tab to video call.`);
  });

  socket.on('friend-request-sent-success', ({ message }) => {
    alert(message || 'Friend request sent!');
    if (addFriendInput) addFriendInput.value = '';
    if (searchResultCard) searchResultCard.style.display = 'none';
  });

  socket.on('friend-request-accepted-notice', ({ message }) => {
    addLog(`[FRIENDSHIP CONFIRMED] ${message}`, 'success');
    playNotificationChime();
    alert(message);
  });

  socket.on('friend-request-error', ({ message }) => {
    alert(message);
  });

  // Calling Events
  socket.on('call-ringing', (data) => {
    addLog(`[CALL RINGING] @${data.targetUsername} is ringing!`, 'success');
    if (outgoingStatusText) outgoingStatusText.textContent = 'RINGING... 🔔';
  });

  socket.on('incoming-call', (data) => {
    addLog(`[INCOMING CALL] From @${data.callerUsername} (${data.callerName})`, 'signal');
    handleIncomingCall(data);
  });

  socket.on('call-accepted', async (data) => {
    addLog(`[CALL CONNECTED] Video call active with @${data.peerUsername}`, 'success');
    closeOutgoingModal();
    currentCallId = data.callId;
    activeCallType = data.callType;
    const peer = { username: data.peerUsername, name: data.peerName, avatar: data.peerAvatar };
    startCallSessionUI(peer, data.callType);
    await initiatePeerConnection(data.peerUsername, true);
  });

  socket.on('call-connected', (data) => {
    addLog(`[CALL CONNECTED] Connected with @${data.peerUsername}`, 'success');
    currentCallId = data.callId;
    activeCallType = data.callType;
    const peer = { username: data.peerUsername, name: data.peerName, avatar: data.peerAvatar };
    startCallSessionUI(peer, data.callType);
  });

  socket.on('call-rejected', () => {
    closeOutgoingModal();
    alert('Friend declined the call.');
  });

  socket.on('call-failed', (data) => {
    closeOutgoingModal();
    if (data.reason === 'NOT_FRIENDS') {
      showNotFriendsAlert(data.message, data.targetUsername);
    } else {
      alert(`Call failed: ${data.message}`);
    }
  });

  socket.on('call-missed', () => {
    closeIncomingModal();
  });

  socket.on('call-ended', () => {
    endCurrentCallLocal(false);
  });

  // WebRTC Signals
  socket.on('webrtc-offer', async ({ fromUsername, offer, callId }) => {
    addLog(`[WebRTC] Received offer from @${fromUsername}`, 'signal');
    const pc = await getOrCreatePeerConnection(fromUsername);
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    await processPendingIceCandidates(fromUsername, pc);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    socket.emit('webrtc-answer', {
      targetUsername: fromUsername,
      answer,
      callId
    });
  });

  socket.on('webrtc-answer', async ({ fromUsername, answer }) => {
    addLog(`[WebRTC] Received answer from @${fromUsername}`, 'signal');
    const pc = peerConnections.get(fromUsername);
    if (pc) {
      await pc.setRemoteDescription(new RTCSessionDescription(answer));
      await processPendingIceCandidates(fromUsername, pc);
    }
  });

  socket.on('ice-candidate', async ({ fromUsername, candidate }) => {
    const pc = peerConnections.get(fromUsername);
    if (pc && pc.remoteDescription) {
      try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch (e) {}
    } else {
      if (!pendingIceCandidates.has(fromUsername)) pendingIceCandidates.set(fromUsername, []);
      pendingIceCandidates.get(fromUsername).push(candidate);
    }
  });
}

function escapeHtml(text) {
  if (!text) return '';
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ===================================================================
// APPLICATION BOOTSTRAP
// ===================================================================
window.addEventListener('DOMContentLoaded', () => {
  setupFeedTabs();

  const stored = getStoredUser();
  if (stored && stored.username) {
    initAppSession(stored);
  } else {
    openAuthModal();
  }
});

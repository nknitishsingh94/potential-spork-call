// ===================================================================
// CallPulse - Direct HD Audio & Video Calling with Friends Protection
// ===================================================================

// Global State
let socket = null;
let currentUser = null; // { id, callerId, normCallerId, name, email, avatar, authProvider, friends }
let myUniqueId = '';

let localStream = null;
let screenStream = null;
let activeCallType = 'video'; // 'video' | 'audio'
let isAudioMuted = false;
let isVideoMuted = false;
let isSpeakerMuted = false;
let isSharingScreen = false;
let isExternalInterrupted = false;

// Friends & Requests State
let friendsList = [];
let pendingReceivedList = [];
let pendingSentList = [];

// WebRTC State
const peerConnections = new Map(); // peerUserId -> RTCPeerConnection
const pendingIceCandidates = new Map(); // peerUserId -> Array<RTCIceCandidate>
let currentCallId = null;
let currentCallPeers = new Map();
let pendingIncomingCall = null;
let callDurationTimer = null;
let callStartTime = null;

// Ringing Tone Audio Synthesis (Web Audio API - guaranteed zero missing asset errors)
let audioCtx = null;
let ringOscillator = null;
let ringGain = null;
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
        osc.frequency.setValueAtTime(440, audioCtx.currentTime); // A4
        osc.frequency.setValueAtTime(480, audioCtx.currentTime + 0.05);
        gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 1.2);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start();
        osc.stop(audioCtx.currentTime + 1.2);
      } catch (e) {}
    }, 2500);
  } catch (e) {
    console.warn('Ringtone audio note:', e);
  }
}

function stopRingtone() {
  if (ringInterval) {
    clearInterval(ringInterval);
    ringInterval = null;
  }
}

// Play pleasant notification chime for friend request
function playNotificationChime() {
  try {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(587.33, audioCtx.currentTime); // D5
    osc.frequency.setValueAtTime(880, audioCtx.currentTime + 0.12); // A5
    gain.gain.setValueAtTime(0.25, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.45);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.45);
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
const headerUserEmail = document.getElementById('headerUserEmail');
const headerUserAvatar = document.getElementById('headerUserAvatar');
const headerUserAvatarPlaceholder = document.getElementById('headerUserAvatarPlaceholder');
const myDisplayId = document.getElementById('myDisplayId');
const copyIdBtn = document.getElementById('copyIdBtn');
const shareLinkBtn = document.getElementById('shareLinkBtn');
const logoutBtn = document.getElementById('logoutBtn');
const openAuthModalBtn = document.getElementById('openAuthModalBtn');

const networkStatusDot = document.getElementById('networkStatusDot');
const networkStatusText = document.getElementById('networkStatusText');

// Sidebar Tabs
const tabBtnFriends = document.getElementById('tabBtnFriends');
const tabBtnRequests = document.getElementById('tabBtnRequests');
const tabBtnAdd = document.getElementById('tabBtnAdd');
const tabBtnDial = document.getElementById('tabBtnDial');

const tabPaneFriends = document.getElementById('tabPaneFriends');
const tabPaneRequests = document.getElementById('tabPaneRequests');
const tabPaneAdd = document.getElementById('tabPaneAdd');
const tabPaneDial = document.getElementById('tabPaneDial');

const friendsCountBadge = document.getElementById('friendsCountBadge');
const requestsCountBadge = document.getElementById('requestsCountBadge');
const receivedCountBadge = document.getElementById('receivedCountBadge');
const sentCountBadge = document.getElementById('sentCountBadge');

// Friends List
const friendsListContainer = document.getElementById('friendsListContainer');
const friendsEmptyState = document.getElementById('friendsEmptyState');
const refreshFriendsBtn = document.getElementById('refreshFriendsBtn');
const emptyGoToAddFriendBtn = document.getElementById('emptyGoToAddFriendBtn');

// Requests Lists
const receivedRequestsList = document.getElementById('receivedRequestsList');
const sentRequestsList = document.getElementById('sentRequestsList');

// Add Friend Tab
const addFriendInput = document.getElementById('addFriendInput');
const searchFriendBtn = document.getElementById('searchFriendBtn');
const searchResultCard = document.getElementById('searchResultCard');
const resultAvatar = document.getElementById('resultAvatar');
const resultName = document.getElementById('resultName');
const resultEmail = document.getElementById('resultEmail');
const resultCallerId = document.getElementById('resultCallerId');
const sendRequestBtn = document.getElementById('sendRequestBtn');
const resultStatusText = document.getElementById('resultStatusText');

// Direct Dial
const targetIdInput = document.getElementById('targetIdInput');
const startVideoCallBtn = document.getElementById('startVideoCallBtn');
const startAudioCallBtn = document.getElementById('startAudioCallBtn');

// Sidebar Live Incoming Card
const sidebarIncomingCard = document.getElementById('sidebarIncomingCard');
const sidebarIncomingStatusBadge = document.getElementById('sidebarIncomingStatusBadge');
const sidebarIncomingIdleState = document.getElementById('sidebarIncomingIdleState');
const sidebarIncomingActiveState = document.getElementById('sidebarIncomingActiveState');
const sidebarIncomingMyIdBadge = document.getElementById('sidebarIncomingMyIdBadge');
const sidebarIncomingCallerId = document.getElementById('sidebarIncomingCallerId');
const sidebarIncomingCallerEmail = document.getElementById('sidebarIncomingCallerEmail');
const sidebarIncomingCallType = document.getElementById('sidebarIncomingCallType');
const sidebarAcceptCallBtn = document.getElementById('sidebarAcceptCallBtn');
const sidebarDeclineCallBtn = document.getElementById('sidebarDeclineCallBtn');

// Video Stage
const stageStatusTitle = document.getElementById('stageStatusTitle');
const stageStatusTag = document.getElementById('stageStatusTag');
const callTypeIndicator = document.getElementById('callTypeIndicator');
const callTypeBadge = document.getElementById('callTypeBadge');
const callTimer = document.getElementById('callTimer');
const headerFullscreenBtn = document.getElementById('headerFullscreenBtn');

const localVideo = document.getElementById('localVideo');
const localAudioOnlyAvatar = document.getElementById('localAudioOnlyAvatar');
const localAudioIdBadge = document.getElementById('localAudioIdBadge');
const localUserTag = document.getElementById('localUserTag');
const localMicBadge = document.getElementById('localMicBadge');
const localCamBadge = document.getElementById('localCamBadge');
const localInterruptionOverlay = document.getElementById('localInterruptionOverlay');
const cameraPromptOverlay = document.getElementById('cameraPromptOverlay');
const turnOnCameraBtn = document.getElementById('turnOnCameraBtn');
const dismissCameraPromptBtn = document.getElementById('dismissCameraPromptBtn');

const remotePlaceholder = document.getElementById('remotePlaceholder');
const remoteVideo = document.getElementById('remoteVideo');
const remoteEmptyPlaceholder = document.getElementById('remoteEmptyPlaceholder');
const remoteAudioOnlyAvatar = document.getElementById('remoteAudioOnlyAvatar');
const remoteAudioIdBadge = document.getElementById('remoteAudioIdBadge');
const remoteAudioName = document.getElementById('remoteAudioName');
const remoteVideoOverlay = document.getElementById('remoteVideoOverlay');
const remoteUserTag = document.getElementById('remoteUserTag');
const remoteMicBadge = document.getElementById('remoteMicBadge');
const remoteCamBadge = document.getElementById('remoteCamBadge');

// Call Controls
const callControlBar = document.getElementById('callControlBar');
const toggleMicBtn = document.getElementById('toggleMicBtn');
const micBtnIcon = document.getElementById('micBtnIcon');
const micBtnLabel = document.getElementById('micBtnLabel');
const toggleSpeakerBtn = document.getElementById('toggleSpeakerBtn');
const speakerBtnIcon = document.getElementById('speakerBtnIcon');
const speakerBtnLabel = document.getElementById('speakerBtnLabel');
const toggleCamBtn = document.getElementById('toggleCamBtn');
const camBtnIcon = document.getElementById('camBtnIcon');
const camBtnLabel = document.getElementById('camBtnLabel');
const shareScreenBtn = document.getElementById('shareScreenBtn');
const toggleFullscreenBtn = document.getElementById('toggleFullscreenBtn');
const endCallBtn = document.getElementById('endCallBtn');

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
let alertTargetUserQuery = '';

const outgoingCallModal = document.getElementById('outgoingCallModal');
const outgoingTargetAvatar = document.getElementById('outgoingTargetAvatar');
const outgoingTargetName = document.getElementById('outgoingTargetName');
const outgoingTargetEmail = document.getElementById('outgoingTargetEmail');
const outgoingStatusText = document.getElementById('outgoingStatusText');
const outgoingDialogNote = document.getElementById('outgoingDialogNote');
const cancelOutgoingCallBtn = document.getElementById('cancelOutgoingCallBtn');

const incomingToastBanner = document.getElementById('incomingToastBanner');
const toastCallerTitle = document.getElementById('toastCallerTitle');
const toastCallerType = document.getElementById('toastCallerType');
const toastAcceptBtn = document.getElementById('toastAcceptBtn');
const toastDeclineBtn = document.getElementById('toastDeclineBtn');

const incomingCallModal = document.getElementById('incomingCallModal');
const callWaitingNotice = document.getElementById('callWaitingNotice');
const incomingCallerAvatar = document.getElementById('incomingCallerAvatar');
const incomingCallerName = document.getElementById('incomingCallerName');
const incomingCallerSubtext = document.getElementById('incomingCallerSubtext');
const incomingCallTypeBadge = document.getElementById('incomingCallTypeBadge');
const incomingCallSubtitle = document.getElementById('incomingCallSubtitle');
const acceptCallStandardBtn = document.getElementById('acceptCallStandardBtn');
const callWaitingButtons = document.getElementById('callWaitingButtons');
const acceptAndMergeBtn = document.getElementById('acceptAndMergeBtn');
const acceptAndHoldBtn = document.getElementById('acceptAndHoldBtn');
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
// AUTHENTICATION MANAGEMENT
// ===================================================================
const AUTH_STORAGE_KEY = 'callpulse_auth_user';

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

function showAuthAlert(msg, type = 'error') {
  if (!authAlertBox) return;
  authAlertBox.textContent = msg;
  authAlertBox.className = `auth-alert ${type}`;
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

// Auth Tab Switching
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

// Handle Email Login
if (loginForm) {
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideAuthAlert();
    const email = loginEmail.value.trim();
    const password = loginPassword.value;

    if (!email || !password) {
      showAuthAlert('Please enter both email and password.');
      return;
    }

    try {
      btnLoginSubmit.disabled = true;
      btnLoginSubmit.textContent = 'Signing in...';

      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        showAuthAlert(data.error || 'Login failed. Please check credentials.');
        return;
      }

      setStoredUser(data.user);
      closeAuthModal();
      initAppSession(data.user);
    } catch (err) {
      showAuthAlert('Network error during login: ' + err.message);
    } finally {
      btnLoginSubmit.disabled = false;
      btnLoginSubmit.textContent = 'Sign In with Email ➜';
    }
  });
}

// Handle Account Registration
if (registerForm) {
  registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideAuthAlert();
    const name = regName.value.trim();
    const email = regEmail.value.trim();
    const password = regPassword.value;

    if (!name || !email || !password) {
      showAuthAlert('Please fill in all registration fields.');
      return;
    }

    try {
      btnRegisterSubmit.disabled = true;
      btnRegisterSubmit.textContent = 'Creating account...';

      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password })
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
      showAuthAlert('Network error during registration: ' + err.message);
    } finally {
      btnRegisterSubmit.disabled = false;
      btnRegisterSubmit.textContent = 'Create Account & Get Caller ID ➜';
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
    // Generate quick simulated Google test login
    const demoAccounts = [
      { name: 'Nitish Singh', email: 'nitish@gmail.com' },
      { name: 'Alex Kumar', email: 'alex@gmail.com' },
      { name: 'Sarah Jenkins', email: 'sarah@gmail.com' }
    ];
    const chosen = demoAccounts[Math.floor(Math.random() * demoAccounts.length)];
    performGoogleAuth(chosen.email, chosen.name);
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
      alert('Please enter a valid Google email address.');
      return;
    }
    if (googleChooserModal) googleChooserModal.style.display = 'none';
    performGoogleAuth(email, name);
  });
}

async function performGoogleAuth(email, name, picture) {
  try {
    const res = await fetch('/api/auth/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        name,
        picture: picture || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(name || email)}`
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

// Open Auth Modal from Header button
if (openAuthModalBtn) {
  openAuthModalBtn.addEventListener('click', () => {
    openAuthModal();
  });
}

// Logout handler
if (logoutBtn) {
  logoutBtn.addEventListener('click', () => {
    if (confirm('Are you sure you want to sign out?')) {
      clearStoredUser();
      if (socket) socket.disconnect();
      window.location.reload();
    }
  });
}

// ===================================================================
// SIDEBAR TABS SWITCHER
// ===================================================================
function setupTabs() {
  const tabs = [
    { btn: tabBtnFriends, pane: tabPaneFriends },
    { btn: tabBtnRequests, pane: tabPaneRequests },
    { btn: tabBtnAdd, pane: tabPaneAdd },
    { btn: tabBtnDial, pane: tabPaneDial }
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

  if (emptyGoToAddFriendBtn && tabBtnAdd) {
    emptyGoToAddFriendBtn.addEventListener('click', () => {
      tabBtnAdd.click();
    });
  }
}

// ===================================================================
// FRIENDS LIST RENDERING & ACTIONS
// ===================================================================
function renderFriendsList() {
  if (!friendsListContainer) return;
  friendsListContainer.innerHTML = '';

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
    const item = document.createElement('div');
    item.className = 'friend-item-card';

    const onlineClass = friend.inCall ? 'incall' : (friend.isOnline ? 'online' : '');
    const statusTitle = friend.inCall ? 'In Call' : (friend.isOnline ? 'Online' : 'Offline');

    item.innerHTML = `
      <div class="friend-left-wrap">
        <div class="friend-avatar-wrap">
          <div class="friend-avatar-circle">${(friend.name || 'U').charAt(0).toUpperCase()}</div>
          <span class="friend-online-dot ${onlineClass}" title="${statusTitle}"></span>
        </div>
        <div class="friend-meta-info">
          <span class="friend-name-text">${escapeHtml(friend.name)}</span>
          <span class="friend-email-text">${escapeHtml(friend.email || friend.callerId)}</span>
          <span class="friend-id-pill">ID: #${friend.callerId}</span>
        </div>
      </div>
      <div class="friend-action-buttons">
        <button class="btn-call-action btn-call-video" title="Start HD Video Call" ${!friend.isOnline ? 'title="Friend is offline (will ring when online)"' : ''}>
          📹
        </button>
        <button class="btn-call-action btn-call-audio" title="Start Audio Call" ${!friend.isOnline ? 'title="Friend is offline (will ring when online)"' : ''}>
          🎙️
        </button>
        <button class="btn-friend-more" title="Remove Friend">✕</button>
      </div>
    `;

    // Action listeners
    const videoBtn = item.querySelector('.btn-call-video');
    const audioBtn = item.querySelector('.btn-call-audio');
    const removeBtn = item.querySelector('.btn-friend-more');

    videoBtn.addEventListener('click', () => {
      callUser(friend.callerId, 'video', friend);
    });

    audioBtn.addEventListener('click', () => {
      callUser(friend.callerId, 'audio', friend);
    });

    removeBtn.addEventListener('click', () => {
      if (confirm(`Remove ${friend.name} from your friends list?`)) {
        if (socket) {
          socket.emit('remove-friend', { friendNormId: friend.normCallerId });
        }
      }
    });

    friendsListContainer.appendChild(item);
  });
}

// ===================================================================
// REQUESTS RENDERING & ACTIONS
// ===================================================================
function renderRequests() {
  // Received Requests
  if (receivedRequestsList) {
    receivedRequestsList.innerHTML = '';
    if (pendingReceivedList.length === 0) {
      receivedRequestsList.innerHTML = '<div class="empty-state-sm">No incoming friend requests right now.</div>';
    } else {
      pendingReceivedList.forEach(req => {
        const item = document.createElement('div');
        item.className = 'request-item-card';
        item.innerHTML = `
          <div class="req-meta">
            <span class="req-name">${escapeHtml(req.name)}</span>
            <span class="req-email">${escapeHtml(req.email || '#' + req.callerId)}</span>
          </div>
          <div class="request-actions-wrap">
            <button class="btn-accept-request">Accept</button>
            <button class="btn-reject-request">Decline</button>
          </div>
        `;

        item.querySelector('.btn-accept-request').addEventListener('click', () => {
          if (socket) {
            socket.emit('accept-friend-request', { senderNormId: req.normCallerId });
          }
        });

        item.querySelector('.btn-reject-request').addEventListener('click', () => {
          if (socket) {
            socket.emit('reject-friend-request', { senderNormId: req.normCallerId });
          }
        });

        receivedRequestsList.appendChild(item);
      });
    }
  }

  // Sent Requests
  if (sentRequestsList) {
    sentRequestsList.innerHTML = '';
    if (pendingSentList.length === 0) {
      sentRequestsList.innerHTML = '<div class="empty-state-sm">No pending sent requests.</div>';
    } else {
      pendingSentList.forEach(req => {
        const item = document.createElement('div');
        item.className = 'request-item-card';
        item.innerHTML = `
          <div class="req-meta">
            <span class="req-name">${escapeHtml(req.name)}</span>
            <span class="req-email">Awaiting response...</span>
          </div>
          <div class="request-actions-wrap">
            <button class="btn-reject-request" title="Cancel request">Cancel</button>
          </div>
        `;

        item.querySelector('.btn-reject-request').addEventListener('click', () => {
          if (socket) {
            socket.emit('cancel-friend-request', { targetNormId: req.normCallerId });
          }
        });

        sentRequestsList.appendChild(item);
      });
    }
  }

  // Update request count badges
  const totalPending = pendingReceivedList.length;
  if (requestsCountBadge) {
    if (totalPending > 0) {
      requestsCountBadge.textContent = totalPending;
      requestsCountBadge.style.display = 'inline-block';
    } else {
      requestsCountBadge.style.display = 'none';
    }
  }
  if (receivedCountBadge) receivedCountBadge.textContent = `${pendingReceivedList.length} Pending`;
  if (sentCountBadge) sentCountBadge.textContent = `${pendingSentList.length} Sent`;
}

// ===================================================================
// ADD FRIEND SEARCH & ACTIONS
// ===================================================================
let activeSearchResult = null;

if (searchFriendBtn && addFriendInput) {
  searchFriendBtn.addEventListener('click', executeFriendSearch);
  addFriendInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') executeFriendSearch();
  });
}

async function executeFriendSearch() {
  const query = addFriendInput.value.trim();
  if (!query) return;

  try {
    searchFriendBtn.disabled = true;
    searchFriendBtn.textContent = 'Searching...';

    const res = await fetch(`/api/user/search?q=${encodeURIComponent(query)}&requesterId=${encodeURIComponent(myUniqueId)}`);
    const data = await res.json();

    if (!data || !data.user) {
      if (searchResultCard) {
        searchResultCard.style.display = 'block';
        resultAvatar.textContent = '❓';
        resultName.textContent = 'User Not Found';
        resultEmail.textContent = 'No account exists with this email or ID.';
        resultCallerId.textContent = '';
        sendRequestBtn.style.display = 'none';
        resultStatusText.style.display = 'block';
        resultStatusText.textContent = 'Make sure the user has created an account on CallPulse!';
        resultStatusText.style.color = '#ef4444';
      }
      return;
    }

    activeSearchResult = data;
    renderSearchResultCard(data);
  } catch (err) {
    alert('Search error: ' + err.message);
  } finally {
    searchFriendBtn.disabled = false;
    searchFriendBtn.textContent = 'Search 🔍';
  }
}

function renderSearchResultCard(data) {
  if (!searchResultCard) return;
  const user = data.user;
  const relation = data.relation;

  searchResultCard.style.display = 'block';
  resultAvatar.textContent = (user.name || 'U').charAt(0).toUpperCase();
  resultName.textContent = user.name;
  resultEmail.textContent = user.email || 'No email provided';
  resultCallerId.textContent = `Caller ID: #${user.callerId}`;

  resultStatusText.style.display = 'none';
  sendRequestBtn.style.display = 'block';
  sendRequestBtn.disabled = false;

  if (relation === 'self') {
    sendRequestBtn.disabled = true;
    sendRequestBtn.textContent = 'This is your own account';
  } else if (relation === 'friends') {
    sendRequestBtn.disabled = true;
    sendRequestBtn.textContent = '✔ Already in Friends List';
  } else if (relation === 'pending_sent') {
    sendRequestBtn.disabled = true;
    sendRequestBtn.textContent = '⏳ Friend Request Pending';
  } else if (relation === 'pending_received') {
    sendRequestBtn.textContent = '✔ Accept Received Request';
    sendRequestBtn.onclick = () => {
      if (socket) socket.emit('accept-friend-request', { senderNormId: user.normCallerId });
      searchResultCard.style.display = 'none';
    };
    return;
  } else {
    sendRequestBtn.textContent = '➕ Send Friend Request';
  }

  sendRequestBtn.onclick = () => {
    if (!socket) return;
    sendRequestBtn.disabled = true;
    sendRequestBtn.textContent = 'Sending...';
    socket.emit('send-friend-request', { targetQuery: user.callerId });
  };
}

if (refreshFriendsBtn) {
  refreshFriendsBtn.addEventListener('click', () => {
    if (socket) socket.emit('get-friends-data');
  });
}

// ===================================================================
// NOT-FRIENDS BLOCK ALERT DIALOG
// ===================================================================
function showNotFriendsAlert(msg, query) {
  alertTargetUserQuery = query || '';
  if (notFriendsAlertMsg) notFriendsAlertMsg.textContent = msg || 'You can only call accepted friends.';
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
    if (alertTargetUserQuery) {
      if (socket) {
        socket.emit('send-friend-request', { targetQuery: alertTargetUserQuery });
      }
      if (tabBtnAdd) tabBtnAdd.click();
    }
  });
}

// ===================================================================
// WEBRTC CALLING ENGINE
// ===================================================================
function callUser(targetId, type = 'video', friendObj = null) {
  if (!targetId || targetId.trim().length === 0) {
    alert('Please enter a valid Caller ID.');
    return;
  }

  const cleanTarget = targetId.trim();
  const normTarget = cleanTarget.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
  const normSelf = myUniqueId.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();

  if (normTarget === normSelf) {
    alert('You cannot call your own Caller ID!');
    return;
  }

  // Client-side Friend Verification
  const isFriend = friendsList.some(f => f.normCallerId === normTarget);
  if (!isFriend && !friendObj) {
    showNotFriendsAlert(
      `ID #${cleanTarget} is not in your accepted friends list. Only accepted friends can call each other. Send a friend request first!`,
      cleanTarget
    );
    return;
  }

  activeCallType = type;
  addLog(`Initiating ${type.toUpperCase()} call to ID #${cleanTarget}...`, 'signal');

  // Open Outgoing Call Modal immediately
  if (outgoingTargetName) {
    outgoingTargetName.textContent = friendObj ? friendObj.name : `Calling ID #${cleanTarget}`;
  }
  if (outgoingTargetEmail) {
    outgoingTargetEmail.textContent = friendObj ? (friendObj.email || '#' + friendObj.callerId) : `#${cleanTarget}`;
  }
  if (outgoingStatusText) outgoingStatusText.textContent = 'CONNECTING...';
  if (outgoingCallModal) outgoingCallModal.style.display = 'flex';

  playRingtone();

  // Emit initiate-call to server
  if (socket) {
    socket.emit('initiate-call', {
      targetId: cleanTarget,
      callType: type
    });
  }
}

// Cancel Outgoing Call
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
function handleIncomingCallNotification(data) {
  pendingIncomingCall = data;
  playRingtone();

  const callerDisplayName = data.callerName || `Caller #${data.callerId}`;

  // Update Modal
  if (incomingCallerName) incomingCallerName.textContent = callerDisplayName.toUpperCase();
  if (incomingCallerSubtext) {
    incomingCallerSubtext.textContent = `${data.callerEmail ? data.callerEmail + ' • ' : ''}ID #${data.callerId}`;
  }
  if (incomingCallTypeBadge) {
    incomingCallTypeBadge.textContent = data.callType === 'video' ? '📹 VIDEO CALL' : '🎙️ AUDIO CALL';
  }

  if (data.isCallWaiting) {
    if (callWaitingNotice) callWaitingNotice.style.display = 'block';
    if (callWaitingButtons) callWaitingButtons.style.display = 'grid';
    if (acceptCallStandardBtn) acceptCallStandardBtn.style.display = 'none';
  } else {
    if (callWaitingNotice) callWaitingNotice.style.display = 'none';
    if (callWaitingButtons) callWaitingButtons.style.display = 'none';
    if (acceptCallStandardBtn) acceptCallStandardBtn.style.display = 'flex';
  }

  if (incomingCallModal) incomingCallModal.style.display = 'flex';

  // Update Floating Toast Banner
  if (toastCallerTitle) toastCallerTitle.textContent = `${callerDisplayName} is calling!`;
  if (toastCallerType) toastCallerType.textContent = `Incoming ${data.callType === 'video' ? 'Video' : 'Audio'} Call`;
  if (incomingToastBanner) incomingToastBanner.style.display = 'flex';

  // Update Sidebar Card
  if (sidebarIncomingCallerId) sidebarIncomingCallerId.textContent = callerDisplayName;
  if (sidebarIncomingCallerEmail) sidebarIncomingCallerEmail.textContent = data.callerEmail || `#${data.callerId}`;
  if (sidebarIncomingCallType) sidebarIncomingCallType.textContent = data.callType === 'video' ? '📹 Video Call' : '🎙️ Audio Call';
  if (sidebarIncomingIdleState) sidebarIncomingIdleState.style.display = 'none';
  if (sidebarIncomingActiveState) sidebarIncomingActiveState.style.display = 'block';
}

function closeIncomingModal() {
  stopRingtone();
  pendingIncomingCall = null;
  if (incomingCallModal) incomingCallModal.style.display = 'none';
  if (incomingToastBanner) incomingToastBanner.style.display = 'none';

  if (sidebarIncomingIdleState) sidebarIncomingIdleState.style.display = 'block';
  if (sidebarIncomingActiveState) sidebarIncomingActiveState.style.display = 'none';
}

// Accept & Decline Listeners
if (acceptCallStandardBtn) {
  acceptCallStandardBtn.addEventListener('click', () => acceptIncomingCall('standard'));
}
if (toastAcceptBtn) {
  toastAcceptBtn.addEventListener('click', () => acceptIncomingCall('standard'));
}
if (sidebarAcceptCallBtn) {
  sidebarAcceptCallBtn.addEventListener('click', () => acceptIncomingCall('standard'));
}

if (acceptAndMergeBtn) {
  acceptAndMergeBtn.addEventListener('click', () => acceptIncomingCall('merge'));
}
if (acceptAndHoldBtn) {
  acceptAndHoldBtn.addEventListener('click', () => acceptIncomingCall('hold'));
}

if (declineCallBtn) {
  declineCallBtn.addEventListener('click', declineIncomingCall);
}
if (toastDeclineBtn) {
  toastDeclineBtn.addEventListener('click', declineIncomingCall);
}
if (sidebarDeclineCallBtn) {
  sidebarDeclineCallBtn.addEventListener('click', declineIncomingCall);
}

function acceptIncomingCall(mode = 'standard') {
  if (!pendingIncomingCall || !socket) return;
  const callId = pendingIncomingCall.callId;
  const callType = pendingIncomingCall.callType;
  closeIncomingModal();

  addLog(`Answering incoming call (${mode.toUpperCase()})...`, 'signal');
  socket.emit('accept-call', { callId, mode });
}

function declineIncomingCall() {
  if (!pendingIncomingCall || !socket) return;
  const callId = pendingIncomingCall.callId;
  closeIncomingModal();

  addLog('Call declined by receiver.', 'info');
  socket.emit('reject-call', { callId });
}

// ===================================================================
// PHYSICAL CAMERA & AUDIO MEDIA CORE
// ===================================================================
async function acquirePhysicalMedia(preferAudioOnly = false) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error('CAMERA_NOT_SUPPORTED_OR_INSECURE_CONTEXT');
  }

  if (preferAudioOnly) {
    return await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  }

  // Release any existing stream tracks BEFORE acquiring new hardware access
  if (localStream) {
    try {
      localStream.getTracks().forEach(t => t.stop());
    } catch (e) {}
    localStream = null;
  }

  // Stage 1: Standard HD Camera + Audio
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    });
    if (stream && stream.getVideoTracks().length > 0) return stream;
  } catch (e1) {}

  // Stage 2: Basic Video + Audio
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    if (stream && stream.getVideoTracks().length > 0) return stream;
  } catch (e2) {}

  // Stage 3: Audio fallback
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
      if (localAudioOnlyAvatar) localAudioOnlyAvatar.style.display = 'flex';
      if (localVideo) localVideo.style.display = 'none';
    } else {
      if (localAudioOnlyAvatar) localAudioOnlyAvatar.style.display = 'none';
      if (localVideo) localVideo.style.display = 'block';
    }
  } catch (err) {
    addLog(`Media initialization note: ${err.message}`, 'warning');
  }
}

// ===================================================================
// WEBRTC PEER CONNECTION MANAGEMENT
// ===================================================================
async function getOrCreatePeerConnection(peerUserId) {
  if (peerConnections.has(peerUserId)) {
    return peerConnections.get(peerUserId);
  }

  const pc = new RTCPeerConnection(rtcConfig);
  peerConnections.set(peerUserId, pc);

  // Add local tracks to peer connection
  if (localStream) {
    localStream.getTracks().forEach(track => {
      pc.addTrack(track, localStream);
    });
  }

  // Remote stream received
  pc.ontrack = (event) => {
    addLog(`[WebRTC] Received remote stream track: ${event.track.kind}`, 'signal');
    if (remoteVideo) {
      remoteVideo.srcObject = event.streams[0];
      remoteVideo.style.display = 'block';
      remoteVideo.play().catch(() => {});
    }
    if (remoteEmptyPlaceholder) remoteEmptyPlaceholder.style.display = 'none';
    if (remoteVideoOverlay) remoteVideoOverlay.style.display = 'flex';

    if (activeCallType === 'audio') {
      if (remoteAudioOnlyAvatar) remoteAudioOnlyAvatar.style.display = 'flex';
      if (remoteVideo) remoteVideo.style.display = 'none';
    }
  };

  // ICE candidates
  pc.onicecandidate = (event) => {
    if (event.candidate && socket) {
      socket.emit('ice-candidate', {
        targetUserId: peerUserId,
        candidate: event.candidate,
        callId: currentCallId
      });
    }
  };

  return pc;
}

async function initiatePeerConnection(peerUserId, peerDisplayId, isCaller = false) {
  const pc = await getOrCreatePeerConnection(peerUserId);

  if (isCaller) {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    if (socket) {
      socket.emit('webrtc-offer', {
        targetUserId: peerUserId,
        offer,
        callId: currentCallId
      });
    }
  }
}

// Drain queued ICE candidates
async function processPendingIceCandidates(peerId, pc) {
  if (!pendingIceCandidates.has(peerId) || !pc || !pc.remoteDescription) return;
  const queue = pendingIceCandidates.get(peerId);
  pendingIceCandidates.delete(peerId);
  for (const candidate of queue) {
    try {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (e) {}
  }
}

// ===================================================================
// ACTIVE CALL WORKSPACE UI & TIMER
// ===================================================================
function startCallSessionUI(participants, callType) {
  if (stageStatusTitle) stageStatusTitle.textContent = 'Active Call';
  if (stageStatusTag) {
    stageStatusTag.textContent = 'In Call';
    stageStatusTag.style.background = '#dcfce7';
    stageStatusTag.style.color = '#15803d';
  }
  if (callTypeIndicator) callTypeIndicator.style.display = 'block';
  if (callTypeBadge) callTypeBadge.textContent = callType === 'video' ? '📹 VIDEO' : '🎙️ AUDIO';
  if (callTimer) callTimer.style.display = 'block';
  if (endCallBtn) endCallBtn.style.display = 'flex';

  // Start Duration Timer
  callStartTime = Date.now();
  if (callDurationTimer) clearInterval(callDurationTimer);
  callDurationTimer = setInterval(() => {
    const elapsedSec = Math.floor((Date.now() - callStartTime) / 1000);
    const m = String(Math.floor(elapsedSec / 60)).padStart(2, '0');
    const s = String(elapsedSec % 60).padStart(2, '0');
    if (callTimer) callTimer.textContent = `${m}:${s}`;
  }, 1000);

  initLocalMedia(callType);
}

function endCurrentCallLocal(emitToServer = true) {
  if (callDurationTimer) {
    clearInterval(callDurationTimer);
    callDurationTimer = null;
  }

  // Close peer connections
  peerConnections.forEach(pc => {
    try { pc.close(); } catch (e) {}
  });
  peerConnections.clear();
  pendingIceCandidates.clear();

  // Reset Video Stage
  if (remoteVideo) {
    remoteVideo.srcObject = null;
    remoteVideo.style.display = 'none';
  }
  if (remoteEmptyPlaceholder) remoteEmptyPlaceholder.style.display = 'flex';
  if (remoteAudioOnlyAvatar) remoteAudioOnlyAvatar.style.display = 'none';
  if (remoteVideoOverlay) remoteVideoOverlay.style.display = 'none';

  if (stageStatusTitle) stageStatusTitle.textContent = 'Ready to Call';
  if (stageStatusTag) {
    stageStatusTag.textContent = 'Idle';
    stageStatusTag.style.background = '';
    stageStatusTag.style.color = '';
  }
  if (callTypeIndicator) callTypeIndicator.style.display = 'none';
  if (callTimer) {
    callTimer.style.display = 'none';
    callTimer.textContent = '00:00';
  }
  if (endCallBtn) endCallBtn.style.display = 'none';

  if (emitToServer && socket && currentCallId) {
    socket.emit('end-call', { callId: currentCallId });
  }
  currentCallId = null;
  addLog('Call session ended.', 'info');
}

// Call Control Listeners
if (endCallBtn) {
  endCallBtn.addEventListener('click', () => {
    endCurrentCallLocal(true);
  });
}

// Mic Mute
if (toggleMicBtn) {
  toggleMicBtn.addEventListener('click', () => {
    if (!localStream) return;
    isAudioMuted = !isAudioMuted;
    localStream.getAudioTracks().forEach(t => { t.enabled = !isAudioMuted; });

    micBtnIcon.textContent = isAudioMuted ? '🔇' : '🎤';
    micBtnLabel.textContent = isAudioMuted ? 'Unmute' : 'Mute Mic';
    toggleMicBtn.style.background = isAudioMuted ? '#fee2e2' : '';
    localMicBadge.textContent = isAudioMuted ? '🔇 Mic Off' : '🎙️ Mic On';

    if (socket) {
      socket.emit('peer-media-state', { isAudioMuted, isVideoMuted });
    }
  });
}

// Camera Toggle
if (toggleCamBtn) {
  toggleCamBtn.addEventListener('click', () => {
    if (!localStream) return;
    isVideoMuted = !isVideoMuted;
    localStream.getVideoTracks().forEach(t => { t.enabled = !isVideoMuted; });

    camBtnIcon.textContent = isVideoMuted ? '🚫' : '📹';
    camBtnLabel.textContent = isVideoMuted ? 'Camera Off' : 'Video';
    localCamBadge.textContent = isVideoMuted ? '🚫 Cam Off' : '📹 Cam On';
    if (localAudioOnlyAvatar) localAudioOnlyAvatar.style.display = isVideoMuted ? 'flex' : 'none';
    if (localVideo) localVideo.style.display = isVideoMuted ? 'none' : 'block';
  });
}

// Speaker Mute
if (toggleSpeakerBtn) {
  toggleSpeakerBtn.addEventListener('click', () => {
    isSpeakerMuted = !isSpeakerMuted;
    if (remoteVideo) remoteVideo.muted = isSpeakerMuted;
    speakerBtnIcon.textContent = isSpeakerMuted ? '🔇' : '🔊';
    speakerBtnLabel.textContent = isSpeakerMuted ? 'Muted' : 'Sound On';
  });
}

// Screen Sharing
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
        shareScreenBtn.style.background = '#e0e7ff';
        isSharingScreen = true;

        screenTrack.onended = () => {
          stopScreenSharing();
        };
      } catch (err) {
        addLog(`Screen share note: ${err.message}`, 'warning');
      }
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

// Fullscreen
if (toggleFullscreenBtn) {
  toggleFullscreenBtn.addEventListener('click', () => {
    const stage = document.getElementById('videoGrid');
    if (!stage) return;
    if (!document.fullscreenElement) {
      stage.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  });
}

// Direct Dial Buttons
if (startVideoCallBtn && targetIdInput) {
  startVideoCallBtn.addEventListener('click', () => {
    callUser(targetIdInput.value, 'video');
  });
}
if (startAudioCallBtn && targetIdInput) {
  startAudioCallBtn.addEventListener('click', () => {
    callUser(targetIdInput.value, 'audio');
  });
}

// ===================================================================
// COPY & SHARE LINK ACTIONS
// ===================================================================
if (copyIdBtn) {
  copyIdBtn.addEventListener('click', () => {
    if (!myUniqueId) return;
    navigator.clipboard.writeText(myUniqueId).then(() => {
      copyIdBtn.innerHTML = '<span>✔</span> Copied!';
      setTimeout(() => { copyIdBtn.innerHTML = '<span>📋</span> Copy'; }, 2000);
    });
  });
}

if (shareLinkBtn) {
  shareLinkBtn.addEventListener('click', () => {
    if (!myUniqueId) return;
    const directUrl = `${window.location.origin}/?call=${encodeURIComponent(myUniqueId)}`;
    navigator.clipboard.writeText(directUrl).then(() => {
      shareLinkBtn.innerHTML = '<span>✔</span> Link Copied!';
      setTimeout(() => { shareLinkBtn.innerHTML = '<span>🔗</span> Share'; }, 2000);
    });
  });
}

// ===================================================================
// INITIALIZE APPLICATION SESSION & SOCKET
// ===================================================================
function initAppSession(user) {
  currentUser = user;
  myUniqueId = user.callerId;

  // Header Profile Updates
  if (userProfileCapsule) userProfileCapsule.style.display = 'flex';
  if (guestAuthActions) guestAuthActions.style.display = 'none';
  if (headerUserName) headerUserName.textContent = user.name;
  if (headerUserEmail) headerUserEmail.textContent = user.email || 'Caller';
  if (myDisplayId) myDisplayId.textContent = user.callerId;
  if (sidebarIncomingMyIdBadge) sidebarIncomingMyIdBadge.textContent = `#${user.callerId}`;
  if (localUserTag) localUserTag.textContent = `${user.name} (#${user.callerId})`;

  if (user.avatar) {
    if (headerUserAvatar) {
      headerUserAvatar.src = user.avatar;
      headerUserAvatar.style.display = 'block';
    }
    if (headerUserAvatarPlaceholder) headerUserAvatarPlaceholder.style.display = 'none';
  }

  // Connect Socket.io
  connectSocketIO();
}

function connectSocketIO() {
  if (socket) {
    socket.disconnect();
  }

  socket = io({
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionAttempts: 25
  });

  socket.on('connect', () => {
    addLog(`Connected to CallPulse server. Registering account #${myUniqueId}...`, 'success');
    if (networkStatusDot) networkStatusDot.style.background = '#22c55e';
    if (networkStatusText) networkStatusText.innerHTML = `<b>Connected as ${currentUser?.name}:</b> Ready for real-time calling`;

    socket.emit('register-user', {
      uniqueId: myUniqueId,
      email: currentUser?.email,
      name: currentUser?.name,
      avatar: currentUser?.avatar
    });
  });

  socket.on('disconnect', () => {
    addLog('Disconnected from server. Reconnecting...', 'warning');
    if (networkStatusDot) networkStatusDot.style.background = '#ef4444';
  });

  socket.on('registered-success', (data) => {
    addLog(`Caller ID registered with server: #${data.displayId}`, 'success');
  });

  // Real-time Friends Data Synchronization
  socket.on('friends-data-updated', (data) => {
    friendsList = data.friends || [];
    pendingReceivedList = data.pendingReceived || [];
    pendingSentList = data.pendingSent || [];
    renderFriendsList();
    renderRequests();
  });

  // Real-time Incoming Friend Request Alert
  socket.on('incoming-friend-request', ({ sender }) => {
    addLog(`[FRIEND REQUEST] Incoming request from ${sender.name} (${sender.email || sender.callerId})`, 'signal');
    playNotificationChime();
    alert(`👋 Friend Request: ${sender.name} (${sender.email || '#' + sender.callerId}) sent you a friend request! Go to the Requests tab to accept.`);
  });

  // Friend Request Sent Success
  socket.on('friend-request-sent-success', ({ message }) => {
    alert(message || 'Friend request sent!');
    if (addFriendInput) addFriendInput.value = '';
    if (searchResultCard) searchResultCard.style.display = 'none';
  });

  // Friend Request Accepted Notice
  socket.on('friend-request-accepted-notice', ({ message, friend }) => {
    addLog(`[FRIENDSHIP ACCEPTED] ${message}`, 'success');
    playNotificationChime();
    alert(message);
  });

  // Friend Request Error
  socket.on('friend-request-error', ({ message }) => {
    alert(message);
  });

  // ==========================================
  // CALLING SOCKET EVENTS
  // ==========================================
  socket.on('call-ringing', (data) => {
    addLog(`[CALL STATUS] Target friend #${data.targetId} is ringing -> STATUS: RINGING`, 'success');
    if (outgoingStatusText) outgoingStatusText.textContent = 'RINGING... 🔔';
    if (data.receiverHasExistingCall) {
      if (outgoingDialogNote) {
        outgoingDialogNote.innerHTML = `Friend is on another call, but <b>RINGING</b> was sent! (Call Waiting active)`;
      }
    }
  });

  socket.on('incoming-call', (data) => {
    addLog(`[INCOMING CALL] From ${data.callerName} (#${data.callerId}) [${data.callType.toUpperCase()}]`, 'signal');
    handleIncomingCallNotification(data);
  });

  socket.on('call-accepted', async (data) => {
    addLog(`[CALL ACCEPTED] Connected with #${data.peerDisplayId}`, 'success');
    closeOutgoingModal();
    currentCallId = data.callId;
    activeCallType = data.callType;
    startCallSessionUI(data.participants, data.callType);
    await initiatePeerConnection(data.peerId, data.peerDisplayId, true);
  });

  socket.on('call-connected', (data) => {
    addLog(`[CALL CONNECTED] Joined call with #${data.peerDisplayId}`, 'success');
    currentCallId = data.callId;
    activeCallType = data.callType;
    startCallSessionUI(data.participants, data.callType);
  });

  socket.on('call-rejected', () => {
    closeOutgoingModal();
    alert('Call was declined by receiver.');
  });

  socket.on('call-failed', (data) => {
    closeOutgoingModal();
    if (data.reason === 'NOT_FRIENDS') {
      showNotFriendsAlert(data.message, data.targetId);
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
  socket.on('webrtc-offer', async ({ fromUserId, offer, callId }) => {
    addLog(`[WebRTC] Received Offer from ID #${fromUserId}`, 'signal');
    const pc = await getOrCreatePeerConnection(fromUserId);
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    await processPendingIceCandidates(fromUserId, pc);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    socket.emit('webrtc-answer', {
      targetUserId: fromUserId,
      answer,
      callId
    });
  });

  socket.on('webrtc-answer', async ({ fromUserId, answer }) => {
    addLog(`[WebRTC] Received Answer from ID #${fromUserId}`, 'signal');
    const pc = peerConnections.get(fromUserId);
    if (pc) {
      await pc.setRemoteDescription(new RTCSessionDescription(answer));
      await processPendingIceCandidates(fromUserId, pc);
    }
  });

  socket.on('ice-candidate', async ({ fromUserId, candidate }) => {
    const pc = peerConnections.get(fromUserId);
    if (pc && pc.remoteDescription) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (e) {}
    } else {
      if (!pendingIceCandidates.has(fromUserId)) {
        pendingIceCandidates.set(fromUserId, []);
      }
      pendingIceCandidates.get(fromUserId).push(candidate);
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
  setupTabs();

  // Check stored user session
  const stored = getStoredUser();
  if (stored && stored.callerId) {
    initAppSession(stored);
  } else {
    // Show Auth Modal if user is not logged in
    openAuthModal();
  }

  // Pre-fill target ID from URL parameter (e.g. ?call=842-195)
  const urlParams = new URLSearchParams(window.location.search);
  const directCallId = urlParams.get('call');
  if (directCallId && targetIdInput) {
    targetIdInput.value = directCallId;
  }
});

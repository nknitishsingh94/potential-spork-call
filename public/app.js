/**
 * Unique ID Calling System (No-Busy Architecture)
 * - Automatic 6-digit Unique Caller ID (e.g. 842-195)
 * - Direct Dialing: Video Call (📹) & Audio Call (🎙️)
 * - Zero USER_BUSY responses (Always RINGING if online)
 * - Call Waiting & Group Merge
 * - WhatsApp & Audio Focus Interruption Handling
 */

// Generate random 6-digit Unique ID (e.g. "842-195")
function generateUniqueId() {
  const n1 = Math.floor(100 + Math.random() * 900);
  const n2 = Math.floor(100 + Math.random() * 900);
  return `${n1}-${n2}`;
}

// State variables
let socket = null;
let myUniqueId = sessionStorage.getItem('caller_unique_id') || generateUniqueId();
sessionStorage.setItem('caller_unique_id', myUniqueId);

let localStream = null;
let activeCallType = 'video'; // 'video' | 'audio'
let isAudioMuted = false;
let isVideoMuted = false;
let isExternalInterrupted = false;

// Active WebRTC connections: peerUserId -> RTCPeerConnection
const peerConnections = new Map();

// Active Call state
let currentCallId = null;
let currentCallPeers = new Map(); // peerId -> displayId
let pendingIncomingCall = null;
let callDurationTimer = null;
let callStartTime = null;

// Standard STUN servers
const rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

// UI Elements
const myDisplayId = document.getElementById('myDisplayId');
const copyIdBtn = document.getElementById('copyIdBtn');
const newIdBtn = document.getElementById('newIdBtn');
const targetIdInput = document.getElementById('targetIdInput');
const startVideoCallBtn = document.getElementById('startVideoCallBtn');
const startAudioCallBtn = document.getElementById('startAudioCallBtn');
const usersList = document.getElementById('usersList');
const onlineCountBadge = document.getElementById('onlineCountBadge');

// Video/Audio Stage elements
const localVideo = document.getElementById('localVideo');
const localAudioOnlyAvatar = document.getElementById('localAudioOnlyAvatar');
const localAudioIdBadge = document.getElementById('localAudioIdBadge');
const localUserTag = document.getElementById('localUserTag');
const localMicBadge = document.getElementById('localMicBadge');
const localCamBadge = document.getElementById('localCamBadge');
const videoGrid = document.getElementById('videoGrid');
const remotePlaceholder = document.getElementById('remotePlaceholder');

const callControlBar = document.getElementById('callControlBar');
const callStatusBar = document.getElementById('callStatusBar');
const callStatusMessage = document.getElementById('callStatusMessage');
const callTypeIndicator = document.getElementById('callTypeIndicator');
const callTypeBadge = document.getElementById('callTypeBadge');
const callTimer = document.getElementById('callTimer');
const toggleMicBtn = document.getElementById('toggleMicBtn');
const toggleCamBtn = document.getElementById('toggleCamBtn');
const endCallBtn = document.getElementById('endCallBtn');

// Outgoing / Incoming Modals
const outgoingCallModal = document.getElementById('outgoingCallModal');
const outgoingTargetAvatar = document.getElementById('outgoingTargetAvatar');
const outgoingTargetName = document.getElementById('outgoingTargetName');
const outgoingStatusText = document.getElementById('outgoingStatusText');
const outgoingDialogNote = document.getElementById('outgoingDialogNote');
const cancelOutgoingCallBtn = document.getElementById('cancelOutgoingCallBtn');

const incomingCallModal = document.getElementById('incomingCallModal');
const incomingCallerAvatar = document.getElementById('incomingCallerAvatar');
const incomingCallerName = document.getElementById('incomingCallerName');
const incomingCallTypeBadge = document.getElementById('incomingCallTypeBadge');
const incomingCallSubtitle = document.getElementById('incomingCallSubtitle');
const callWaitingNotice = document.getElementById('callWaitingNotice');
const acceptCallStandardBtn = document.getElementById('acceptCallStandardBtn');
const callWaitingButtons = document.getElementById('callWaitingButtons');
const acceptAndMergeBtn = document.getElementById('acceptAndMergeBtn');
const acceptAndHoldBtn = document.getElementById('acceptAndHoldBtn');
const declineCallBtn = document.getElementById('declineCallBtn');

// WhatsApp Interruption controls
const toggleInterruptionBtn = document.getElementById('toggleInterruptionBtn');
const interruptionBtnText = document.getElementById('interruptionBtnText');
const interruptionStateBanner = document.getElementById('interruptionStateBanner');
const localInterruptionOverlay = document.getElementById('localInterruptionOverlay');

// Logs
const debugLogs = document.getElementById('debugLogs');
const clearLogsBtn = document.getElementById('clearLogsBtn');

// -------------------------------------------------------------
// Logging Helper
// -------------------------------------------------------------
function addLog(message, type = 'info') {
  const el = document.createElement('div');
  const now = new Date().toLocaleTimeString();
  el.className = `log-entry log-${type}`;
  el.textContent = `[${now}] ${message}`;
  debugLogs.appendChild(el);
  debugLogs.scrollTop = debugLogs.scrollHeight;
}

// -------------------------------------------------------------
// Initialize Local Media Stream
// -------------------------------------------------------------
async function initMedia(preferAudioOnly = false) {
  // Stop existing tracks if any
  if (localStream) {
    localStream.getTracks().forEach(t => t.stop());
  }

  try {
    if (preferAudioOnly) {
      localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      addLog('Audio microphone stream acquired', 'success');
    } else {
      localStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: { width: { ideal: 640 }, height: { ideal: 480 } }
      });
      addLog('Camera & Microphone stream acquired', 'success');
    }
  } catch (err) {
    addLog(`Physical camera/mic not available (${err.name}). Using simulated fallback stream.`, 'warning');
    localStream = createSimulatedCanvasStream(myUniqueId);
  }

  // Enforce existing mute states on newly initialized tracks
  if (localStream) {
    if (isAudioMuted) {
      localStream.getAudioTracks().forEach(t => (t.enabled = false));
    }
    if (isVideoMuted) {
      localStream.getVideoTracks().forEach(t => (t.enabled = false));
    }
  }

  updateLocalMediaUI(preferAudioOnly);
  updateMuteUI();
}

function updateLocalMediaUI(isAudioOnly) {
  if (isAudioOnly) {
    localVideo.style.display = 'none';
    localAudioOnlyAvatar.style.display = 'flex';
    localAudioIdBadge.textContent = myUniqueId;
    localCamBadge.textContent = '📹 Off';
    localCamBadge.style.opacity = '0.5';
  } else {
    localVideo.style.display = 'block';
    localAudioOnlyAvatar.style.display = 'none';
    localVideo.srcObject = localStream;
    localCamBadge.textContent = '📹 Active';
    localCamBadge.style.opacity = '1';
  }
}

// Simulated fallback canvas stream for testing without physical webcam
function createSimulatedCanvasStream(idLabel) {
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 480;
  const ctx = canvas.getContext('2d');
  let angle = 0;

  function draw() {
    ctx.fillStyle = '#090d16';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const cx = canvas.width / 2;
    const cy = canvas.height / 2;

    // Pulse circle
    ctx.beginPath();
    ctx.arc(cx, cy, 75 + Math.sin(angle) * 6, 0, Math.PI * 2);
    ctx.strokeStyle = '#6366f1';
    ctx.lineWidth = 4;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(cx, cy, 65, 0, Math.PI * 2);
    ctx.fillStyle = '#1e1b4b';
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 22px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`ID #${idLabel}`, cx, cy - 8);

    ctx.font = '14px sans-serif';
    ctx.fillStyle = '#94a3b8';
    ctx.fillText('Simulated WebRTC Feed', cx, cy + 26);

    angle += 0.05;
    requestAnimationFrame(draw);
  }
  draw();

  const stream = canvas.captureStream(30);

  // Silent audio track fallback
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const dst = audioCtx.createMediaStreamDestination();
    osc.connect(dst);
    osc.start();
    const track = dst.stream.getAudioTracks()[0];
    if (track) {
      track.enabled = false;
      stream.addTrack(track);
    }
  } catch (e) {
    console.warn('AudioContext fallback unavailable', e);
  }

  return stream;
}

// -------------------------------------------------------------
// Socket Connection & Signaling
// -------------------------------------------------------------
function connectSocket() {
  if (socket) return;

  socket = io();

  socket.on('connect', () => {
    addLog(`Connected to Signaling Server [Socket: ${socket.id}]`, 'signal');
    // Register unique ID
    socket.emit('register-user', { uniqueId: myUniqueId });
  });

  socket.on('registered-success', (data) => {
    myDisplayId.textContent = data.displayId;
    localUserTag.textContent = `Your ID: #${data.displayId}`;
    addLog(`Caller ID registered: #${data.displayId}`, 'success');
  });

  socket.on('online-users-updated', (users) => {
    renderUsersList(users);
  });

  // Outgoing Call Result: Caller receives RINGING immediately (Never USER_BUSY!)
  socket.on('call-ringing', (data) => {
    addLog(`[CALL STATUS] Target ID #${data.targetId} is reachable -> STATUS: RINGING (No busy state sent!)`, 'success');
    outgoingStatusText.textContent = 'RINGING... 🔔';

    if (data.receiverHasExistingCall) {
      addLog(`[NOTE] Target ID #${data.targetId} is already in another call, but server sent RINGING (Call Waiting active)`, 'warning');
      outgoingDialogNote.innerHTML =
        `Receiver is already on another call, but <b>RINGING</b> was sent! They are receiving a <i>Call Waiting</i> alert.`;
    }
  });

  // Incoming Call received by receiver
  socket.on('incoming-call', (data) => {
    addLog(`[INCOMING CALL] Call from ID #${data.callerId} (${data.callType.toUpperCase()}) | isCallWaiting: ${data.isCallWaiting}`, 'signal');
    handleIncomingCallNotification(data);
  });

  // Call Accepted
  socket.on('call-accepted', async (data) => {
    addLog(`[CALL ACCEPTED] Call connected with ID #${data.peerDisplayId} (${data.callType.toUpperCase()})`, 'success');
    closeOutgoingModal();
    currentCallId = data.callId;
    activeCallType = data.callType;

    startCallSessionUI(data.participants, data.callType);
    await initiatePeerConnection(data.peerId, data.peerDisplayId, true);
  });

  // Call Connected (Receiver)
  socket.on('call-connected', (data) => {
    addLog(`[CALL CONNECTED] Joined Call with ID #${data.peerDisplayId}`, 'success');
    currentCallId = data.callId;
    activeCallType = data.callType;
    startCallSessionUI(data.participants, data.callType);
  });

  // Group Merge
  socket.on('participant-joined-room', async (data) => {
    addLog(`[ROOM MERGED] ID #${data.newDisplayId} joined group call!`, 'signal');
    renderCallParticipants(data.participants);

    const normMyId = myUniqueId.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    if (data.newUserId !== normMyId) {
      await initiatePeerConnection(data.newUserId, data.newDisplayId, true);
    }
  });

  // Peer Hold State (WhatsApp interruption or held)
  socket.on('peer-hold-state', (data) => {
    addLog(`[PEER STATE] ID #${data.displayId} held: ${data.isHeld} (${data.reason})`, 'warning');
    updatePeerHoldUI(data.userId, data.isHeld, data.reason);
  });

  // Peer Mute / Cam state updated by remote peer
  socket.on('peer-media-state-updated', (data) => {
    const badge = document.getElementById(`peer-status-${data.userId}`);
    if (badge) {
      if (data.isAudioMuted) {
        badge.textContent = '🔇 Peer Muted';
        badge.classList.add('muted-badge');
      } else {
        badge.textContent = '⚡ Live';
        badge.classList.remove('muted-badge');
      }
    }
    addLog(`Peer #${data.displayId} ${data.isAudioMuted ? 'muted their mic 🔇' : 'unmuted mic 🎙️'}`, 'info');
  });

  // Call Declined
  socket.on('call-rejected', (data) => {
    addLog(`[CALL DECLINED] Receiver declined call (${data.reason})`, 'danger');
    closeOutgoingModal();
    alert(`Call declined by user.`);
  });

  // Call Failed / Timed Out (UNAVAILABLE ONLY)
  socket.on('call-failed', (data) => {
    addLog(`[CALL FAILED] Reason: ${data.reason} - ${data.message}`, 'danger');
    closeOutgoingModal();
    alert(`Call could not connect: ${data.message} (${data.reason})`);
  });

  // Call Missed
  socket.on('call-missed', (data) => {
    addLog(`[CALL MISSED] Call from ID #${data.callerId} timed out`, 'warning');
    closeIncomingModal();
  });

  // Call Ended
  socket.on('call-ended', (data) => {
    addLog(`[CALL ENDED] Session closed`, 'signal');
    endCurrentCallLocal(false);
  });

  // WebRTC Signals
  socket.on('webrtc-offer', async ({ fromUserId, offer, callId }) => {
    addLog(`[WebRTC] Received Offer from ID #${fromUserId}`, 'signal');
    const pc = await getOrCreatePeerConnection(fromUserId);
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
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
    }
  });

  socket.on('ice-candidate', async ({ fromUserId, candidate }) => {
    const pc = peerConnections.get(fromUserId);
    if (pc && candidate) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (e) {
        console.warn('ICE candidate error', e);
      }
    }
  });
}

// -------------------------------------------------------------
// WebRTC Peer Connection Core
// -------------------------------------------------------------
async function initiatePeerConnection(targetUserId, targetDisplayId, isCaller = false) {
  const pc = await getOrCreatePeerConnection(targetUserId, targetDisplayId);

  if (isCaller) {
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      addLog(`[WebRTC] Sending Offer to ID #${targetDisplayId}`, 'signal');
      socket.emit('webrtc-offer', {
        targetUserId,
        offer,
        callId: currentCallId
      });
    } catch (err) {
      console.error('Failed to create offer:', err);
    }
  }
}

async function getOrCreatePeerConnection(peerId, peerDisplayId = peerId) {
  if (peerConnections.has(peerId)) {
    return peerConnections.get(peerId);
  }

  const pc = new RTCPeerConnection(rtcConfig);
  peerConnections.set(peerId, pc);

  if (localStream) {
    localStream.getTracks().forEach(track => {
      pc.addTrack(track, localStream);
    });
  }

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit('ice-candidate', {
        targetUserId: peerId,
        candidate: event.candidate,
        callId: currentCallId
      });
    }
  };

  pc.ontrack = (event) => {
    addLog(`[WebRTC] Remote media track received from ID #${peerDisplayId}`, 'success');
    attachRemoteStream(peerId, peerDisplayId, event.streams[0]);
  };

  return pc;
}

function attachRemoteStream(peerId, peerDisplayId, stream) {
  if (remotePlaceholder) {
    remotePlaceholder.style.display = 'none';
  }

  let card = document.getElementById(`remote-card-${peerId}`);
  if (!card) {
    card = document.createElement('div');
    card.id = `remote-card-${peerId}`;
    card.className = 'video-card remote-card';

    const isAudioOnly = activeCallType === 'audio';

    card.innerHTML = `
      <video id="remote-video-${peerId}" autoplay playsinline style="${isAudioOnly ? 'display:none;' : ''}"></video>
      <div class="audio-only-avatar" id="remote-audio-avatar-${peerId}" style="${isAudioOnly ? 'display:flex;' : 'display:none;'}">
        <div class="audio-ring-pulse"></div>
        <div class="audio-id-badge">#${peerDisplayId}</div>
        <span>Audio Call Active</span>
      </div>
      <div class="video-overlay">
        <span class="user-tag">ID: #${peerDisplayId}</span>
        <div class="stream-badges">
          <span class="stream-badge" id="peer-status-${peerId}">⚡ Live</span>
        </div>
      </div>
      <div class="interruption-overlay" id="peer-overlay-${peerId}" style="display: none;">
        <div class="interruption-content">
          <span class="interruption-icon">⏸️</span>
          <p id="peer-overlay-msg-${peerId}">On Hold / Interrupted</p>
          <small>Peer's microphone held by external app</small>
        </div>
      </div>
    `;
    videoGrid.appendChild(card);
  }

  const video = card.querySelector('video');
  if (video) {
    video.srcObject = stream;
  }
}

function updatePeerHoldUI(peerId, isHeld, reason) {
  const overlay = document.getElementById(`peer-overlay-${peerId}`);
  const msg = document.getElementById(`peer-overlay-msg-${peerId}`);
  const badge = document.getElementById(`peer-status-${peerId}`);

  if (overlay) {
    overlay.style.display = isHeld ? 'flex' : 'none';
    if (msg) msg.textContent = reason || 'Call is on Hold';
  }
  if (badge) {
    badge.textContent = isHeld ? '⏸️ Held' : '⚡ Live';
    badge.style.color = isHeld ? '#fbbf24' : '#34d399';
  }
}

// -------------------------------------------------------------
// Initiate Outgoing Call (by Unique ID)
// -------------------------------------------------------------
async function initiateCall(callType = 'video') {
  const targetId = targetIdInput.value.trim();
  if (!targetId) {
    alert('Please enter a 6-digit Unique ID to call.');
    targetIdInput.focus();
    return;
  }

  const normTarget = targetId.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
  const normMy = myUniqueId.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();

  if (normTarget === normMy) {
    alert('You cannot call your own Caller ID!');
    return;
  }

  activeCallType = callType;
  await initMedia(callType === 'audio');

  addLog(`[OUTGOING] Calling ID #${targetId} (${callType.toUpperCase()})...`, 'signal');

  outgoingTargetName.textContent = `Calling ID #${targetId}`;
  outgoingTargetAvatar.textContent = callType === 'video' ? '📹' : '🎙️';
  outgoingStatusText.textContent = 'CONNECTING...';
  outgoingDialogNote.innerHTML =
    `Connecting call. Even if receiver is already on another call, you get <b>RINGING</b> instead of Busy!`;

  outgoingCallModal.style.display = 'flex';

  socket.emit('initiate-call', {
    targetId,
    callType
  });
}

function cancelOutgoingCall() {
  closeOutgoingModal();
  if (currentCallId) {
    socket.emit('end-call', { callId: currentCallId });
  }
  addLog('Outgoing call cancelled by caller', 'info');
}

function closeOutgoingModal() {
  outgoingCallModal.style.display = 'none';
}

// -------------------------------------------------------------
// Audible Ringtone Synthesizer & Notification Alerts
// -------------------------------------------------------------
let ringtoneAudioContext = null;
let ringtoneInterval = null;
let originalPageTitle = document.title;
let titleFlashTimer = null;

function startRingtoneAlert(callerId) {
  // 1. Play realistic telephone ringing sound via Web Audio API
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (AudioCtx) {
      if (!ringtoneAudioContext) {
        ringtoneAudioContext = new AudioCtx();
      }
      if (ringtoneAudioContext.state === 'suspended') {
        ringtoneAudioContext.resume();
      }

      function playSingleBurst() {
        if (!ringtoneAudioContext) return;
        const now = ringtoneAudioContext.currentTime;

        const osc1 = ringtoneAudioContext.createOscillator();
        const osc2 = ringtoneAudioContext.createOscillator();
        const gain = ringtoneAudioContext.createGain();

        // Standard 440Hz + 480Hz dual-frequency telephone ring
        osc1.frequency.setValueAtTime(440, now);
        osc2.frequency.setValueAtTime(480, now);

        gain.gain.setValueAtTime(0.25, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 1.8);

        osc1.connect(gain);
        osc2.connect(gain);
        gain.connect(ringtoneAudioContext.destination);

        osc1.start(now);
        osc2.start(now);
        osc1.stop(now + 1.8);
        osc2.stop(now + 1.8);
      }

      playSingleBurst();
      clearInterval(ringtoneInterval);
      ringtoneInterval = setInterval(playSingleBurst, 3000);
    }
  } catch (err) {
    console.warn('Web Audio Ringtone not supported', err);
  }

  // 2. Mobile vibration pattern (500ms vibe, 250ms pause, 500ms vibe)
  if (navigator.vibrate) {
    navigator.vibrate([500, 250, 500, 250, 600]);
  }

  // 3. Tab Title Flashing (works even if user is in another tab!)
  clearInterval(titleFlashTimer);
  let isAlt = false;
  titleFlashTimer = setInterval(() => {
    document.title = isAlt ? `🔔 INCOMING CALL (#${callerId})` : `📞 Click to Answer!`;
    isAlt = !isAlt;
  }, 750);

  // 4. Desktop Notification (if user is in background)
  if ('Notification' in window && Notification.permission === 'granted') {
    try {
      new Notification(`Incoming Call from ID #${callerId}`, {
        body: 'Click here to answer the call!',
        icon: '📞'
      });
    } catch(e) {}
  }
}

function stopRingtoneAlert() {
  if (ringtoneInterval) {
    clearInterval(ringtoneInterval);
    ringtoneInterval = null;
  }
  if (ringtoneAudioContext) {
    try {
      ringtoneAudioContext.close();
    } catch (e) {}
    ringtoneAudioContext = null;
  }
  if (titleFlashTimer) {
    clearInterval(titleFlashTimer);
    titleFlashTimer = null;
  }
  document.title = originalPageTitle;
  if (navigator.vibrate) {
    navigator.vibrate(0); // stop vibration
  }
}

// Request notification permission once on user interaction
function requestNotificationPerm() {
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }
}
window.addEventListener('click', requestNotificationPerm, { once: true });

// -------------------------------------------------------------
// Incoming Call Handling (Receiver side - Zero Busy + Call Waiting)
// -------------------------------------------------------------
function handleIncomingCallNotification(data) {
  pendingIncomingCall = data;

  incomingCallerName.textContent = `Call from ID #${data.callerId}`;
  incomingCallerAvatar.textContent = data.callType === 'video' ? '📹' : '🎙️';
  incomingCallTypeBadge.textContent = data.callType === 'video' ? '📹 VIDEO CALL' : '🎙️ AUDIO CALL';

  if (data.isCallWaiting) {
    callWaitingNotice.style.display = 'block';
    incomingCallSubtitle.innerHTML =
      `You are currently talking in another call. <b>Caller is hearing RINGING (Never Busy)</b>. Choose how to answer:`;
    acceptCallStandardBtn.style.display = 'none';
    callWaitingButtons.style.display = 'grid';
  } else {
    callWaitingNotice.style.display = 'none';
    incomingCallSubtitle.textContent =
      `Incoming call request. Caller is hearing a normal Ringing tone.`;
    acceptCallStandardBtn.style.display = 'flex';
    callWaitingButtons.style.display = 'none';
  }

  incomingCallModal.style.display = 'flex';

  // Start sound and vibration!
  startRingtoneAlert(data.callerId);
}

async function acceptIncomingCall(mode = 'standard') {
  if (!pendingIncomingCall) return;

  stopRingtoneAlert();

  const callId = pendingIncomingCall.callId;
  const isAudioOnly = pendingIncomingCall.callType === 'audio';
  activeCallType = pendingIncomingCall.callType;

  addLog(`[ACCEPTING CALL] ID #${pendingIncomingCall.callerId} in mode: ${mode}`, 'success');

  await initMedia(isAudioOnly);

  socket.emit('accept-call', {
    callId,
    mode
  });

  closeIncomingModal();
}

function declineIncomingCall() {
  if (!pendingIncomingCall) return;

  stopRingtoneAlert();

  const callId = pendingIncomingCall.callId;
  addLog(`[DECLINING CALL] Call from ID #${pendingIncomingCall.callerId} declined`, 'warning');

  socket.emit('reject-call', { callId });
  closeIncomingModal();
}

function closeIncomingModal() {
  stopRingtoneAlert();
  incomingCallModal.style.display = 'none';
  pendingIncomingCall = null;
}

// -------------------------------------------------------------
// Call Active Session Management
// -------------------------------------------------------------
function startCallSessionUI(participants = [], callType = 'video') {
  endCallBtn.style.display = 'flex';
  callTimer.style.display = 'block';
  callTypeIndicator.style.display = 'block';
  callTypeBadge.textContent = callType === 'video' ? '📹 VIDEO' : '🎙️ AUDIO';
  callStatusBar.style.borderColor = 'rgba(16, 185, 129, 0.4)';

  startTimer();
  renderCallParticipants(participants);
  updateMuteUI();
}

function renderCallParticipants(participants) {
  currentCallPeers.clear();
  const normMyId = myUniqueId.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();

  participants.forEach(p => {
    if (p.userId !== normMyId) {
      currentCallPeers.set(p.userId, p.displayId);
    }
  });

  const ids = Array.from(currentCallPeers.values());
  if (ids.length > 0) {
    callStatusMessage.textContent = `Call Active with: #${ids.join(', #')}`;
  }
}

function startTimer() {
  clearInterval(callDurationTimer);
  callStartTime = Date.now();
  callDurationTimer = setInterval(() => {
    const elapsed = Math.floor((Date.now() - callStartTime) / 1000);
    const mins = String(Math.floor(elapsed / 60)).padStart(2, '0');
    const secs = String(elapsed % 60).padStart(2, '0');
    callTimer.textContent = `${mins}:${secs}`;
  }, 1000);
}

function stopTimer() {
  clearInterval(callDurationTimer);
  callTimer.style.display = 'none';
  callTimer.textContent = '00:00';
  callTypeIndicator.style.display = 'none';
}

function endCurrentCallLocal(emitToServer = true) {
  if (emitToServer && currentCallId) {
    socket.emit('end-call', { callId: currentCallId });
  }

  peerConnections.forEach(pc => pc.close());
  peerConnections.clear();
  currentCallPeers.clear();
  currentCallId = null;

  document.querySelectorAll('.remote-card:not(.empty-remote)').forEach(el => el.remove());
  if (remotePlaceholder) remotePlaceholder.style.display = 'flex';

  endCallBtn.style.display = 'none';
  callStatusBar.style.borderColor = 'var(--border-light)';
  callStatusMessage.textContent = 'Ready • Enter an ID or share your ID';
  stopTimer();

  addLog('Call session ended.', 'info');
}

// -------------------------------------------------------------
// WhatsApp / External Call Interruption Simulation
// -------------------------------------------------------------
function toggleExternalInterruption() {
  isExternalInterrupted = !isExternalInterrupted;

  if (toggleInterruptionBtn) toggleInterruptionBtn.classList.toggle('active', isExternalInterrupted);
  if (localInterruptionOverlay) localInterruptionOverlay.style.display = isExternalInterrupted ? 'flex' : 'none';

  if (localStream) {
    localStream.getTracks().forEach(t => (t.enabled = !isExternalInterrupted));
  }

  if (socket) {
    socket.emit('external-interruption', {
      isInterrupted: isExternalInterrupted,
      reason: isExternalInterrupted ? 'Audio focus held by system' : 'Resumed'
    });
  }
}

// -------------------------------------------------------------
// Online IDs Directory Rendering
// -------------------------------------------------------------
function renderUsersList(users) {
  onlineCountBadge.textContent = `${users.length} Online`;
  usersList.innerHTML = '';

  const normMyId = myUniqueId.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
  const others = users.filter(u => u.userId !== normMyId);

  if (others.length === 0) {
    usersList.innerHTML = `
      <div class="empty-state" style="text-align: center; color: #64748b; padding: 1rem 0.5rem; font-size: 0.75rem;">
        No other IDs connected right now.<br>
        <span style="color: #818cf8;">Open another tab or share your ID to test!</span>
      </div>
    `;
    return;
  }

  others.forEach(user => {
    const item = document.createElement('div');
    item.className = 'user-item';

    let statusPill = `<span class="user-status-pill idle">● Ready</span>`;
    if (user.inExternalCall) {
      statusPill = `<span class="user-status-pill" style="color:#d97706; background:#fffbeb;">⏸️ On Hold</span>`;
    } else if (user.inCall) {
      statusPill = `<span class="user-status-pill incall">📞 In Call</span>`;
    }

    item.innerHTML = `
      <div>
        <div class="user-item-id">#${user.displayId}</div>
        ${statusPill}
      </div>
      <div>
        <button class="btn-quick-call" data-id="${user.displayId}">
          Fill ID
        </button>
      </div>
    `;

    item.querySelector('.btn-quick-call').addEventListener('click', () => {
      targetIdInput.value = user.displayId;
      targetIdInput.focus();
    });

    usersList.appendChild(item);
  });
}

// -------------------------------------------------------------
// Formatting & Button Event Handlers
// -------------------------------------------------------------

// Auto-format input as XXX-XXX
targetIdInput.addEventListener('input', (e) => {
  let val = e.target.value.replace(/[^0-9]/g, '');
  if (val.length > 3) {
    val = `${val.slice(0, 3)}-${val.slice(3, 6)}`;
  }
  e.target.value = val;
});

// Call Buttons
startVideoCallBtn.addEventListener('click', () => initiateCall('video'));
startAudioCallBtn.addEventListener('click', () => initiateCall('audio'));

// Copy ID
copyIdBtn.addEventListener('click', () => {
  navigator.clipboard.writeText(myUniqueId).then(() => {
    copyIdBtn.innerHTML = '<span>✅</span> Copied!';
    setTimeout(() => {
      copyIdBtn.innerHTML = '<span>📋</span> Copy';
    }, 2000);
  });
});

// Generate New ID
newIdBtn.addEventListener('click', () => {
  myUniqueId = generateUniqueId();
  sessionStorage.setItem('caller_unique_id', myUniqueId);
  myDisplayId.textContent = myUniqueId;
  localUserTag.textContent = `Your ID: #${myUniqueId}`;
  if (socket && socket.connected) {
    socket.emit('register-user', { uniqueId: myUniqueId });
  }
  addLog(`Generated fresh ID: #${myUniqueId}`, 'info');
});

// Outgoing / Incoming Call Modal handlers
cancelOutgoingCallBtn.addEventListener('click', cancelOutgoingCall);
acceptCallStandardBtn.addEventListener('click', () => acceptIncomingCall('standard'));
acceptAndMergeBtn.addEventListener('click', () => acceptIncomingCall('merge'));
acceptAndHoldBtn.addEventListener('click', () => acceptIncomingCall('standard'));
declineCallBtn.addEventListener('click', declineIncomingCall);

// Floating Call Controls
endCallBtn.addEventListener('click', () => endCurrentCallLocal(true));

// -------------------------------------------------------------
// Comprehensive Mute Management (Microphone & Speaker)
// -------------------------------------------------------------
const micBtnIcon = document.getElementById('micBtnIcon');
const micBtnLabel = document.getElementById('micBtnLabel');
const speakerBtnIcon = document.getElementById('speakerBtnIcon');
const speakerBtnLabel = document.getElementById('speakerBtnLabel');
const toggleSpeakerBtn = document.getElementById('toggleSpeakerBtn');

let isSpeakerMuted = false;

// 1. Microphone Mute (Stop sending your voice)
function toggleMicrophoneMute(forced = null) {
  if (forced !== null) {
    isAudioMuted = forced;
  } else {
    isAudioMuted = !isAudioMuted;
  }

  // A. Mute local stream tracks
  if (localStream) {
    localStream.getAudioTracks().forEach(track => {
      track.enabled = !isAudioMuted;
    });
  }

  // B. Directly mute all WebRTC PeerConnection audio senders (Guarantees peer hears silence)
  peerConnections.forEach((pc) => {
    pc.getSenders().forEach((sender) => {
      if (sender.track && sender.track.kind === 'audio') {
        sender.track.enabled = !isAudioMuted;
      }
    });
  });

  // C. Update UI elements
  updateMuteUI();

  // D. Notify connected peers via socket so they see a mute badge
  if (socket && socket.connected && currentCallId) {
    socket.emit('peer-media-state', {
      isAudioMuted,
      isVideoMuted
    });
  }

  addLog(
    `Microphone ${isAudioMuted ? '🔇 MUTED (Your voice is blocked)' : '🎙️ UNMUTED (Voice active)'}`,
    isAudioMuted ? 'warning' : 'success'
  );
}

function updateMuteUI() {
  if (toggleMicBtn) {
    toggleMicBtn.classList.toggle('is-muted', isAudioMuted);
    if (micBtnIcon) micBtnIcon.textContent = isAudioMuted ? '🔇' : '🎤';
    if (micBtnLabel) micBtnLabel.textContent = isAudioMuted ? 'Unmute Mic' : 'Mute Mic';
  }

  if (localMicBadge) {
    localMicBadge.textContent = isAudioMuted ? '🔇 Muted' : '🎙️ Mic On';
    localMicBadge.classList.toggle('muted-badge', isAudioMuted);
  }
}

toggleMicBtn.addEventListener('click', () => toggleMicrophoneMute());

// Allow clicking the mic badge on the video card to mute as well!
if (localMicBadge) {
  localMicBadge.style.cursor = 'pointer';
  localMicBadge.title = 'Click to Mute / Unmute Mic';
  localMicBadge.addEventListener('click', () => toggleMicrophoneMute());
}

// 2. Speaker Mute (Stop hearing the other person's voice)
function toggleSpeakerMute() {
  isSpeakerMuted = !isSpeakerMuted;

  // Mute all remote incoming audio / video elements
  document.querySelectorAll('#videoGrid video:not(#localVideo), audio').forEach(el => {
    el.muted = isSpeakerMuted;
  });

  if (toggleSpeakerBtn) {
    toggleSpeakerBtn.classList.toggle('is-muted', isSpeakerMuted);
  }
  if (speakerBtnIcon) speakerBtnIcon.textContent = isSpeakerMuted ? '🔈' : '🔊';
  if (speakerBtnLabel) speakerBtnLabel.textContent = isSpeakerMuted ? 'Sound Muted' : 'Sound On';

  addLog(
    `Incoming Speaker ${isSpeakerMuted ? '🔈 MUTED (You will not hear others)' : '🔊 UNMUTED (Hearing others)'}`,
    isSpeakerMuted ? 'warning' : 'success'
  );
}

if (toggleSpeakerBtn) {
  toggleSpeakerBtn.addEventListener('click', toggleSpeakerMute);
}

// 3. Camera Toggle (Turn Video Off / On)
const camBtnIcon = document.getElementById('camBtnIcon');
const camBtnLabel = document.getElementById('camBtnLabel');

function toggleCamera() {
  isVideoMuted = !isVideoMuted;

  if (localStream) {
    localStream.getVideoTracks().forEach(t => (t.enabled = !isVideoMuted));
  }

  // Also toggle peer connection senders
  peerConnections.forEach((pc) => {
    pc.getSenders().forEach((sender) => {
      if (sender.track && sender.track.kind === 'video') {
        sender.track.enabled = !isVideoMuted;
      }
    });
  });

  if (toggleCamBtn) {
    toggleCamBtn.classList.toggle('is-muted', isVideoMuted);
  }
  if (camBtnIcon) camBtnIcon.textContent = isVideoMuted ? '🚫' : '📹';
  if (camBtnLabel) camBtnLabel.textContent = isVideoMuted ? 'Start Video' : 'Stop Video';

  if (localCamBadge) {
    localCamBadge.textContent = isVideoMuted ? '📹 Cam Off' : '📹 Cam On';
  }

  if (socket && socket.connected && currentCallId) {
    socket.emit('peer-media-state', {
      isAudioMuted,
      isVideoMuted
    });
  }

  addLog(`Camera ${isVideoMuted ? 'Turned Off' : 'Turned On'}`, isVideoMuted ? 'warning' : 'success');
}

toggleCamBtn.addEventListener('click', toggleCamera);

// -------------------------------------------------------------
// Fullscreen Control Handlers
// -------------------------------------------------------------
const videoStageArea = document.getElementById('videoStageArea');
const headerFullscreenBtn = document.getElementById('headerFullscreenBtn');
const headerFullscreenIcon = document.getElementById('headerFullscreenIcon');
const toggleFullscreenBtn = document.getElementById('toggleFullscreenBtn');
const fullscreenBtnIcon = document.getElementById('fullscreenBtnIcon');

function toggleFullscreenMode() {
  const stage = videoStageArea || document.documentElement;
  
  if (!document.fullscreenElement && !document.webkitFullscreenElement) {
    if (stage.requestFullscreen) {
      stage.requestFullscreen();
    } else if (stage.webkitRequestFullscreen) {
      stage.webkitRequestFullscreen();
    }
    stage.classList.add('is-fullscreen');
    if (headerFullscreenIcon) headerFullscreenIcon.textContent = '✕';
    if (fullscreenBtnIcon) fullscreenBtnIcon.textContent = '✕';
    addLog('Entered Full Screen view', 'info');
  } else {
    if (document.exitFullscreen) {
      document.exitFullscreen();
    } else if (document.webkitExitFullscreen) {
      document.webkitExitFullscreen();
    }
    stage.classList.remove('is-fullscreen');
    if (headerFullscreenIcon) headerFullscreenIcon.textContent = '⛶';
    if (fullscreenBtnIcon) fullscreenBtnIcon.textContent = '⛶';
    addLog('Exited Full Screen view', 'info');
  }
}

if (headerFullscreenBtn) {
  headerFullscreenBtn.addEventListener('click', toggleFullscreenMode);
}
if (toggleFullscreenBtn) {
  toggleFullscreenBtn.addEventListener('click', toggleFullscreenMode);
}

document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement) {
    if (videoStageArea) videoStageArea.classList.remove('is-fullscreen');
    if (headerFullscreenIcon) headerFullscreenIcon.textContent = '⛶';
    if (fullscreenBtnIcon) fullscreenBtnIcon.textContent = '⛶';
  }
});

toggleInterruptionBtn.addEventListener('click', toggleExternalInterruption);
clearLogsBtn.addEventListener('click', () => { debugLogs.innerHTML = ''; });

// Init on Load
window.addEventListener('DOMContentLoaded', () => {
  myDisplayId.textContent = myUniqueId;
  localUserTag.textContent = `Your ID: #${myUniqueId}`;

  // Check URL params for direct call (e.g. ?call=849210)
  const urlParams = new URLSearchParams(window.location.search);
  const callParam = urlParams.get('call');
  if (callParam) {
    targetIdInput.value = callParam;
  }

  connectSocket();
  initMedia(false);
});

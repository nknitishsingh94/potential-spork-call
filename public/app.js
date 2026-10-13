
// Generate random 6-digit Unique ID (e.g. "842-195")
function generateUniqueId() {
  const n1 = Math.floor(100 + Math.random() * 900);
  const n2 = Math.floor(100 + Math.random() * 900);
  return `${n1}-${n2}`;
}

// Get or generate valid permanent Caller ID with robust error handling
function getValidUniqueId() {
  try {
    let id = localStorage.getItem('permanent_caller_id');
    if (id && id !== 'null' && id !== 'undefined' && id.trim().length >= 3) {
      return id.trim();
    }
  } catch (e) {
    console.warn('localStorage read notice', e);
  }
  const newId = generateUniqueId();
  try {
    localStorage.setItem('permanent_caller_id', newId);
  } catch (e) {}
  return newId;
}

// State variables (PERMANENT ID via localStorage)
let socket = null;
let myUniqueId = getValidUniqueId();

let localStream = null;
let activeCallType = 'video'; // 'video' | 'audio'
let isAudioMuted = false;
let isVideoMuted = false;
let isSpeakerMuted = false;
let isExternalInterrupted = false;

// Active WebRTC connections: peerUserId -> RTCPeerConnection
const peerConnections = new Map();
const pendingIceCandidates = new Map(); // peerUserId -> Array<RTCIceCandidate>

// Active Call state
let currentCallId = null;
let currentCallPeers = new Map(); // peerId -> displayId
let pendingIncomingCall = null;
let callDurationTimer = null;
let callStartTime = null;

// STUN & TURN servers for carrier-grade NAT traversal (e.g. Jio, Airtel, Vodafone 4G/5G)
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

// UI Elements
const myDisplayId = document.getElementById('myDisplayId');
const sidebarCallerId = document.getElementById('sidebarCallerId');
const spotlightCopyBtn = document.getElementById('spotlightCopyBtn');
const spotlightShareBtn = document.getElementById('spotlightShareBtn');
const copyIdBtn = document.getElementById('copyIdBtn');
const editIdBtn = document.getElementById('editIdBtn');
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

// Live Dynamic Incoming Call Reception Card elements
const sidebarIncomingCard = document.getElementById('sidebarIncomingCard');
const sidebarIncomingStatusBadge = document.getElementById('sidebarIncomingStatusBadge');
const sidebarIncomingIdleState = document.getElementById('sidebarIncomingIdleState');
const sidebarIncomingActiveState = document.getElementById('sidebarIncomingActiveState');
const sidebarIncomingInCallState = document.getElementById('sidebarIncomingInCallState');
const sidebarIncomingMyIdBadge = document.getElementById('sidebarIncomingMyIdBadge');
const sidebarIncomingCallerId = document.getElementById('sidebarIncomingCallerId');
const sidebarIncomingCallType = document.getElementById('sidebarIncomingCallType');
const sidebarAcceptCallBtn = document.getElementById('sidebarAcceptCallBtn');
const sidebarDeclineCallBtn = document.getElementById('sidebarDeclineCallBtn');
const sidebarCallWaitingActions = document.getElementById('sidebarCallWaitingActions');
const sidebarMergeCallBtn = document.getElementById('sidebarMergeCallBtn');
const sidebarHoldCallBtn = document.getElementById('sidebarHoldCallBtn');
const sidebarInCallPeerName = document.getElementById('sidebarInCallPeerName');
const sidebarInCallTimer = document.getElementById('sidebarInCallTimer');

// WhatsApp Interruption controls
const toggleInterruptionBtn = document.getElementById('toggleInterruptionBtn');
const interruptionBtnText = document.getElementById('interruptionBtnText');
const interruptionStateBanner = document.getElementById('interruptionStateBanner');
const localInterruptionOverlay = document.getElementById('localInterruptionOverlay');

// Logs
const debugLogs = document.getElementById('debugLogs');
const clearLogsBtn = document.getElementById('clearLogsBtn');

// Synchronously sync all ID displays immediately on script execution
function updateAllIdDisplays(id) {
  if (myDisplayId) myDisplayId.textContent = id;
  if (sidebarCallerId) sidebarCallerId.textContent = id;
  if (localUserTag) localUserTag.textContent = `Your ID: #${id}`;
  if (sidebarIncomingMyIdBadge) sidebarIncomingMyIdBadge.textContent = `#${id}`;
  if (callStatusMessage && (!currentCallId || currentCallPeers.size === 0)) {
    callStatusMessage.textContent = `Your Permanent ID: #${id} • Ready to make & receive calls`;
  }
}
updateAllIdDisplays(myUniqueId);

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
// Real Physical Camera & Media Acquisition Core
// -------------------------------------------------------------
let isUsingSimulatedStream = false;
let lastMediaError = null;

const cameraPromptOverlay = document.getElementById('cameraPromptOverlay');
const cameraPromptTitle = document.getElementById('cameraPromptTitle');
const cameraPromptDesc = document.getElementById('cameraPromptDesc');
const turnOnCameraBtn = document.getElementById('turnOnCameraBtn');
const dismissCameraPromptBtn = document.getElementById('dismissCameraPromptBtn');

function showCameraPrompt(title, desc) {
  if (cameraPromptOverlay) {
    if (cameraPromptTitle) cameraPromptTitle.textContent = title;
    if (cameraPromptDesc) cameraPromptDesc.textContent = desc;
    cameraPromptOverlay.style.display = 'flex';
  }
}

function hideCameraPrompt() {
  if (cameraPromptOverlay) {
    cameraPromptOverlay.style.display = 'none';
  }
}

if (turnOnCameraBtn) {
  turnOnCameraBtn.addEventListener('click', () => {
    addLog('User clicked Turn On Real Camera button...', 'signal');
    initMedia(false, true);
  });
}

if (dismissCameraPromptBtn) {
  dismissCameraPromptBtn.addEventListener('click', () => {
    hideCameraPrompt();
    addLog('Camera prompt dismissed. Click "Start Video" or camera badge anytime to activate webcam.', 'info');
  });
}

// Clean & Highly Resilient Physical Media Acquisition Core
let mediaAcquisitionInProgress = false;

async function acquirePhysicalMedia(preferAudioOnly = false) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error('CAMERA_NOT_SUPPORTED_OR_INSECURE_CONTEXT');
  }

  if (preferAudioOnly) {
    return await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  }

  // Release any existing stream tracks BEFORE acquiring new hardware access
  // CRITICAL on Windows: prevents NotReadableError / TrackStartError device locking
  if (localStream) {
    try {
      localStream.getTracks().forEach(t => t.stop());
    } catch (e) {}
    localStream = null;
  }

  // Stage 1: Standard real camera + audio (no facingMode constraint to avoid Windows driver failures)
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 1280, max: 1920 },
        height: { ideal: 720, max: 1080 }
      },
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });
    if (stream && stream.getVideoTracks().length > 0) {
      return stream;
    }
  } catch (errStage1) {
    console.warn('Stage 1 (HD Video + Audio) note:', errStage1);
  }

  // Stage 2: Basic unconstrained video + audio
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true
    });
    if (stream && stream.getVideoTracks().length > 0) {
      return stream;
    }
  } catch (errStage2) {
    console.warn('Stage 2 (Basic Video + Audio) note:', errStage2);
  }

  // Stage 3: Video-only first (in case microphone is in use, missing, or blocked)
  let videoStream = null;
  let videoError = null;
  try {
    videoStream = await navigator.mediaDevices.getUserMedia({ video: true });
  } catch (errVideo) {
    videoError = errVideo;
    console.warn('Stage 3 (Video Only) note:', errVideo);
  }

  // Try acquiring audio separately
  let audioStream = null;
  try {
    audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (errAudio) {
    console.warn('Stage 3 (Audio Only) note:', errAudio);
  }

  // If physical video succeeded, attach microphone audio (if available) and return
  if (videoStream && videoStream.getVideoTracks().length > 0) {
    if (audioStream) {
      audioStream.getAudioTracks().forEach(t => videoStream.addTrack(t));
    }
    return videoStream;
  }

  // If video FAILED, but audio succeeded:
  // Throw specific error carrying audioStream so initMedia keeps real live microphone voice
  // and attaches a clean avatar video feed without leaving a dead black box
  if (audioStream && audioStream.getAudioTracks().length > 0) {
    const err = new Error('PHYSICAL_VIDEO_UNAVAILABLE');
    err.audioStream = audioStream;
    err.originalError = videoError;
    throw err;
  }

  // If both failed, rethrow the video error or generic error
  throw videoError || new Error('MEDIA_PERMISSION_OR_DEVICE_UNAVAILABLE');
}

async function initMedia(preferAudioOnly = false, forceRefresh = false) {
  // Guard against race conditions and concurrent hardware requests
  if (mediaAcquisitionInProgress) {
    return;
  }

  // If we already have live physical camera tracks and not forcing re-acquisition, keep them
  if (!forceRefresh && localStream && !isUsingSimulatedStream) {
    const vTracks = localStream.getVideoTracks();
    const aTracks = localStream.getAudioTracks();
    const hasLiveVideo = vTracks.length > 0 && vTracks[0].readyState === 'live';
    const hasLiveAudio = aTracks.length > 0 && aTracks[0].readyState === 'live';

    if (preferAudioOnly) {
      if (hasLiveAudio) {
        vTracks.forEach(t => (t.enabled = false));
        updateLocalMediaUI(true);
        return;
      }
    } else {
      if (hasLiveVideo) {
        vTracks.forEach(t => (t.enabled = !isVideoMuted));
        updateLocalMediaUI(false);
        return;
      }
    }
  }

  mediaAcquisitionInProgress = true;
  lastMediaError = null;

  if (localCamBadge) {
    localCamBadge.textContent = '⌛ Starting Camera...';
    localCamBadge.style.background = '#e0e7ff';
    localCamBadge.style.color = '#3730a3';
  }

  try {
    const stream = await acquirePhysicalMedia(preferAudioOnly);

    // Stop simulated fallback tracks if any
    if (localStream && isUsingSimulatedStream) {
      try { localStream.getTracks().forEach(t => t.stop()); } catch (e) {}
    }

    localStream = stream;
    isUsingSimulatedStream = false;
    hideCameraPrompt();

    // Respect existing mute states
    if (isAudioMuted) {
      localStream.getAudioTracks().forEach(t => (t.enabled = false));
    }
    if (isVideoMuted) {
      localStream.getVideoTracks().forEach(t => (t.enabled = false));
    }

    updateLocalMediaUI(preferAudioOnly);
    updateMuteUI();
    replaceLocalTracksInPeerConnections();
    addLog('Physical Webcam & Microphone are active!', 'success');
  } catch (err) {
    lastMediaError = err;
    console.warn('Camera acquisition note:', err);

    let errorTitle = 'Camera Blocked / Not Active';
    let errorDesc = 'Click below to allow browser access to your physical webcam:';

    const origErr = err.originalError || err;

    if (origErr.name === 'NotAllowedError' || origErr.name === 'PermissionDeniedError') {
      errorTitle = '🔒 Camera Permission Blocked';
      errorDesc = 'Browser blocked camera permission. Click the lock 🔒 icon in your browser address bar, set Camera to "Allow", then click below:';
      addLog('Camera permission blocked by browser. Please allow in address bar.', 'danger');
    } else if (origErr.name === 'NotReadableError' || origErr.name === 'TrackStartError') {
      errorTitle = '📷 Camera In Use by Another Tab or App';
      errorDesc = 'Another tab or application is currently using your camera. Close other video tabs or apps and click below:';
      addLog('Camera is currently in use by another tab or app.', 'warning');
    } else if (origErr.name === 'NotFoundError') {
      errorTitle = '🚫 No Webcam Detected';
      errorDesc = 'No physical webcam found on this device. Plug in a webcam and click below:';
      addLog('No webcam detected on this device.', 'warning');
    } else if (err.message === 'CAMERA_NOT_SUPPORTED_OR_INSECURE_CONTEXT') {
      errorTitle = '⚠️ Insecure Context (HTTP)';
      errorDesc = 'Camera requires HTTPS or localhost.';
      addLog('Camera requires a secure HTTPS connection or localhost.', 'danger');
    } else {
      addLog(`Camera notice: ${origErr.name || origErr.message}`, 'warning');
    }

    // If audio was acquired successfully, use it and attach canvas avatar for video
    let fallbackStream = null;
    if (err.audioStream) {
      fallbackStream = err.audioStream;
      const canvasStream = createSimulatedCanvasStream(myUniqueId);
      const canvasVideoTrack = canvasStream.getVideoTracks()[0];
      if (canvasVideoTrack) {
        fallbackStream.addTrack(canvasVideoTrack);
      }
    } else {
      fallbackStream = createSimulatedCanvasStream(myUniqueId);
    }

    if (localStream) {
      try { localStream.getTracks().forEach(t => t.stop()); } catch (e) {}
    }

    localStream = fallbackStream;
    isUsingSimulatedStream = true;

    // Respect existing mute states
    if (isAudioMuted) {
      localStream.getAudioTracks().forEach(t => (t.enabled = false));
    }
    if (isVideoMuted) {
      localStream.getVideoTracks().forEach(t => (t.enabled = false));
    }

    updateLocalMediaUI(preferAudioOnly);
    updateMuteUI();
    replaceLocalTracksInPeerConnections();

    // Show non-blocking toast so user can 1-click retry
    showCameraPrompt(errorTitle, errorDesc);
  } finally {
    mediaAcquisitionInProgress = false;
  }
}

function updateLocalMediaUI(isAudioOnly) {
  if (isAudioOnly) {
    localVideo.style.display = 'none';
    localAudioOnlyAvatar.style.display = 'flex';
    localAudioIdBadge.textContent = myUniqueId;
    localCamBadge.textContent = '📹 Off';
    localCamBadge.style.opacity = '0.5';
    localCamBadge.style.background = '#f1f5f9';
    localCamBadge.style.color = '#64748b';
  } else {
    localVideo.style.display = 'block';
    localAudioOnlyAvatar.style.display = 'none';
    if (localVideo.srcObject !== localStream) {
      localVideo.srcObject = localStream;
    }
    localVideo.muted = true;
    localVideo.setAttribute('playsinline', '');
    localVideo.setAttribute('muted', '');
    localVideo.autoplay = true;
    const playPromise = localVideo.play();
    if (playPromise !== undefined) {
      playPromise.catch(e => console.warn('Local video play notice', e));
    }

    if (isUsingSimulatedStream) {
      localCamBadge.textContent = '⚠️ Webcam In Use / Offline';
      localCamBadge.style.opacity = '1';
      localCamBadge.style.background = '#fef3c7';
      localCamBadge.style.color = '#92400e';
    } else {
      localCamBadge.textContent = isVideoMuted ? '📹 Cam Off' : '📹 Camera Live';
      localCamBadge.style.opacity = '1';
      localCamBadge.style.background = isVideoMuted ? '#f1f5f9' : '#dcfce7';
      localCamBadge.style.color = isVideoMuted ? '#64748b' : '#15803d';
    }
  }
}

// Auto-play on metadata load
if (localVideo) {
  localVideo.onloadedmetadata = () => {
    localVideo.play().catch(e => console.warn('Video loadedmetadata play notice', e));
  };
}

function replaceLocalTracksInPeerConnections() {
  if (!localStream) return;
  const videoTrack = localStream.getVideoTracks()[0];
  const audioTrack = localStream.getAudioTracks()[0];

  peerConnections.forEach((pc) => {
    let hasVideoSender = false;
    let hasAudioSender = false;

    pc.getSenders().forEach((sender) => {
      const kind = (sender.track && sender.track.kind) || null;
      if (kind === 'video') {
        hasVideoSender = true;
        if (videoTrack) {
          sender.replaceTrack(videoTrack).catch(e => console.warn('replaceTrack video error', e));
        }
      } else if (kind === 'audio') {
        hasAudioSender = true;
        if (audioTrack) {
          sender.replaceTrack(audioTrack).catch(e => console.warn('replaceTrack audio error', e));
        }
      }
    });

    if (!hasVideoSender && videoTrack) {
      try { pc.addTrack(videoTrack, localStream); } catch (e) {}
    }
    if (!hasAudioSender && audioTrack) {
      try { pc.addTrack(audioTrack, localStream); } catch (e) {}
    }
  });
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

    // Glowing outer ring
    ctx.beginPath();
    ctx.arc(cx, cy, 80 + Math.sin(angle) * 8, 0, Math.PI * 2);
    ctx.strokeStyle = '#4f46e5';
    ctx.lineWidth = 3;
    ctx.stroke();

    // Pulse circle
    ctx.beginPath();
    ctx.arc(cx, cy, 65, 0, Math.PI * 2);
    ctx.fillStyle = '#1e1b4b';
    ctx.fill();

    // ID text
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 24px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`ID #${idLabel}`, cx, cy - 8);

    ctx.font = '14px sans-serif';
    ctx.fillStyle = '#94a3b8';
    ctx.fillText('Simulated WebRTC Feed', cx, cy + 28);

    angle += 0.06;
  }
  draw();
  setInterval(draw, 1000 / 25);

  const stream = canvas.captureStream(25);

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

  socket = io({
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 4000,
    transports: ['websocket', 'polling']
  });

  socket.on('connect', () => {
    updateNetworkStatus(true);
    addLog(`Connected to Signaling Server [Socket: ${socket.id}]`, 'signal');
    // Register unique ID immediately
    socket.emit('register-user', { uniqueId: myUniqueId });
  });

  socket.on('disconnect', (reason) => {
    updateNetworkStatus(false, 'Disconnected');
    addLog(`Disconnected from server: ${reason}. Reconnecting automatically...`, 'warning');
  });

  if (socket.io) {
    socket.io.on('reconnect', (attempt) => {
      updateNetworkStatus(true);
      addLog(`Reconnected to server (Attempt ${attempt}). Re-registering ID #${myUniqueId}...`, 'success');
      socket.emit('register-user', { uniqueId: myUniqueId });
    });
  }

  socket.on('registered-success', (data) => {
    updateAllIdDisplays(data.displayId);
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

  // Helper to drain buffered ICE candidates once remoteDescription is set
  async function processPendingIceCandidates(peerId, pc) {
    if (!pendingIceCandidates.has(peerId) || !pc || !pc.remoteDescription) return;
    const queue = pendingIceCandidates.get(peerId);
    pendingIceCandidates.delete(peerId);
    for (const candidate of queue) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        console.warn(`Error adding queued ICE candidate for peer ${peerId}:`, err);
      }
    }
  }

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
    if (!candidate) return;
    const pc = peerConnections.get(fromUserId);
    if (pc && pc.remoteDescription && pc.remoteDescription.type) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (e) {
        console.warn('ICE candidate error', e);
      }
    } else {
      // Buffer until remoteDescription is set
      if (!pendingIceCandidates.has(fromUserId)) {
        pendingIceCandidates.set(fromUserId, []);
      }
      pendingIceCandidates.get(fromUserId).push(candidate);
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
    addLog(`[WebRTC] Remote media track (${event.track.kind}) received from ID #${peerDisplayId}`, 'success');
    let remoteStream;
    if (event.streams && event.streams[0]) {
      remoteStream = event.streams[0];
    } else {
      remoteStream = new MediaStream([event.track]);
    }
    attachRemoteStream(peerId, peerDisplayId, remoteStream);
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
    if (!video.srcObject) {
      video.srcObject = stream;
    } else if (stream && video.srcObject !== stream) {
      stream.getTracks().forEach(t => {
        if (!video.srcObject.getTracks().some(existing => existing.id === t.id)) {
          video.srcObject.addTrack(t);
        }
      });
    }
    video.muted = isSpeakerMuted;
    video.play().catch(e => console.warn('Remote video play notice', e));
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
    alert('Please enter an ID to call, or click one from the "Active Online IDs" list.');
    targetIdInput.focus();
    return;
  }

  const normTarget = targetId.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
  const normMy = myUniqueId.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();

  if (normTarget === normMy) {
    alert('You cannot call your own ID! Please enter the ID of another device or browser window.');
    return;
  }

  if (!socket || !socket.connected) {
    alert('Signaling server is connecting... Please try again in 2 seconds.');
    return;
  }

  activeCallType = callType;

  addLog(`[OUTGOING] Dialing ID #${targetId} (${callType.toUpperCase()})...`, 'signal');

  outgoingTargetName.textContent = `Calling ID #${targetId}`;
  outgoingTargetAvatar.textContent = callType === 'video' ? '📹' : '🎙️';
  outgoingStatusText.textContent = 'CONNECTING...';
  outgoingDialogNote.innerHTML =
    `Connecting call. Even if receiver is already on another call, you get <b>RINGING</b> instead of Busy!`;

  outgoingCallModal.style.display = 'flex';

  // 1. Send call initiation immediately to server
  socket.emit('initiate-call', {
    targetId,
    callType
  });

  // 2. Prepare local media in background if not ready
  if (!localStream) {
    initMedia(callType === 'audio').catch(e => console.warn('Media init notice', e));
  }
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
const incomingToastBanner = document.getElementById('incomingToastBanner');
const toastCallerTitle = document.getElementById('toastCallerTitle');
const toastCallerType = document.getElementById('toastCallerType');
const toastAcceptBtn = document.getElementById('toastAcceptBtn');
const toastDeclineBtn = document.getElementById('toastDeclineBtn');

if (toastAcceptBtn) {
  toastAcceptBtn.addEventListener('click', () => acceptIncomingCall('standard'));
}
if (toastDeclineBtn) {
  toastDeclineBtn.addEventListener('click', declineIncomingCall);
}

function resetSidebarIncomingCardIdle() {
  if (sidebarIncomingCard) {
    sidebarIncomingCard.classList.remove('is-ringing');
    if (sidebarIncomingIdleState) sidebarIncomingIdleState.style.display = 'block';
    if (sidebarIncomingActiveState) sidebarIncomingActiveState.style.display = 'none';
    if (sidebarIncomingInCallState) sidebarIncomingInCallState.style.display = 'none';
    if (sidebarIncomingStatusBadge) {
      sidebarIncomingStatusBadge.textContent = '🟢 Ready';
      sidebarIncomingStatusBadge.className = 'badge badge-success';
    }
    if (sidebarIncomingMyIdBadge) {
      sidebarIncomingMyIdBadge.textContent = `#${myUniqueId}`;
    }
  }
}

function handleIncomingCallNotification(data) {
  pendingIncomingCall = data;

  incomingCallerName.textContent = `ID #${data.callerId} IS CALLING`;
  incomingCallerAvatar.textContent = data.callType === 'video' ? '📹' : '🎙️';
  incomingCallTypeBadge.textContent = data.callType === 'video' ? '📹 VIDEO CALL' : '🎙️ AUDIO CALL';

  if (toastCallerTitle) toastCallerTitle.textContent = `ID #${data.callerId} is calling you!`;
  if (toastCallerType) toastCallerType.textContent = data.callType === 'video' ? '📹 Incoming Video Call' : '🎙️ Incoming Audio Call';
  if (incomingToastBanner) incomingToastBanner.style.display = 'flex';

  // Dynamic Sidebar Live Reception Card
  if (sidebarIncomingCard) {
    sidebarIncomingCard.classList.add('is-ringing');
    if (sidebarIncomingIdleState) sidebarIncomingIdleState.style.display = 'none';
    if (sidebarIncomingInCallState) sidebarIncomingInCallState.style.display = 'none';
    if (sidebarIncomingActiveState) sidebarIncomingActiveState.style.display = 'flex';
    if (sidebarIncomingStatusBadge) {
      sidebarIncomingStatusBadge.textContent = '🔔 RINGING!';
      sidebarIncomingStatusBadge.className = 'badge badge-danger badge-pulse';
    }
    if (sidebarIncomingCallerId) {
      sidebarIncomingCallerId.textContent = `ID #${data.callerId}`;
    }
    if (sidebarIncomingCallType) {
      sidebarIncomingCallType.textContent = data.callType === 'video' ? '📹 Video Call' : '🎙️ Audio Call';
    }
    if (sidebarCallWaitingActions) {
      sidebarCallWaitingActions.style.display = data.isCallWaiting ? 'grid' : 'none';
    }
  }

  if (data.isCallWaiting) {
    callWaitingNotice.style.display = 'block';
    incomingCallSubtitle.innerHTML =
      `You are currently talking in another call. <b>Caller is hearing RINGING (Never Busy)</b>. Choose how to answer:`;
    acceptCallStandardBtn.style.display = 'none';
    callWaitingButtons.style.display = 'grid';
  } else {
    callWaitingNotice.style.display = 'none';
    incomingCallSubtitle.textContent =
      `Caller is ringing on your ID. Click below to receive the call:`;
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
  if (incomingToastBanner) incomingToastBanner.style.display = 'none';
  pendingIncomingCall = null;

  if (!currentCallId || currentCallPeers.size === 0) {
    resetSidebarIncomingCardIdle();
  }
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

  if (sidebarIncomingCard) {
    sidebarIncomingCard.classList.remove('is-ringing');
    if (sidebarIncomingIdleState) sidebarIncomingIdleState.style.display = 'none';
    if (sidebarIncomingActiveState) sidebarIncomingActiveState.style.display = 'none';
    if (sidebarIncomingInCallState) sidebarIncomingInCallState.style.display = 'block';
    if (sidebarIncomingStatusBadge) {
      sidebarIncomingStatusBadge.textContent = '📞 In Call';
      sidebarIncomingStatusBadge.className = 'badge badge-accent';
    }
  }

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
    if (sidebarInCallPeerName) {
      sidebarInCallPeerName.textContent = `Connected with ID #${ids.join(', #')}`;
    }
  }
}

function startTimer() {
  clearInterval(callDurationTimer);
  callStartTime = Date.now();
  callDurationTimer = setInterval(() => {
    const elapsed = Math.floor((Date.now() - callStartTime) / 1000);
    const mins = String(Math.floor(elapsed / 60)).padStart(2, '0');
    const secs = String(elapsed % 60).padStart(2, '0');
    const timeStr = `${mins}:${secs}`;
    callTimer.textContent = timeStr;
    if (sidebarInCallTimer) {
      sidebarInCallTimer.textContent = `Active • ${timeStr}`;
    }
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
  pendingIceCandidates.clear();
  currentCallPeers.clear();
  currentCallId = null;

  document.querySelectorAll('.remote-card:not(.empty-remote)').forEach(el => el.remove());
  if (remotePlaceholder) remotePlaceholder.style.display = 'flex';

  endCallBtn.style.display = 'none';
  callStatusBar.style.borderColor = 'var(--border-light)';
  callStatusMessage.textContent = 'Ready • Enter an ID or share your ID';
  stopTimer();
  resetSidebarIncomingCardIdle();

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
      <div style="display: flex; gap: 0.35rem;">
        <button class="btn-dial btn-video btn-sm-quick" data-id="${user.displayId}" title="Video Call #${user.displayId}" style="padding: 0.4rem 0.65rem; font-size: 0.75rem;">
          📹 Video
        </button>
        <button class="btn-dial btn-audio btn-sm-quick" data-id="${user.displayId}" title="Audio Call #${user.displayId}" style="padding: 0.4rem 0.65rem; font-size: 0.75rem;">
          🎙️ Audio
        </button>
      </div>
    `;

    item.querySelector('.btn-video').addEventListener('click', () => {
      targetIdInput.value = user.displayId;
      initiateCall('video');
    });

    item.querySelector('.btn-audio').addEventListener('click', () => {
      targetIdInput.value = user.displayId;
      initiateCall('audio');
    });

    usersList.appendChild(item);
  });
}

// -------------------------------------------------------------
// Formatting & Button Event Handlers
// -------------------------------------------------------------

// Auto-format input as XXX-XXX
if (targetIdInput) {
  targetIdInput.addEventListener('input', (e) => {
    let val = e.target.value.replace(/[^0-9]/g, '');
    if (val.length > 3) {
      val = `${val.slice(0, 3)}-${val.slice(3, 6)}`;
    }
    e.target.value = val;
  });
}

// Call Buttons
if (startVideoCallBtn) startVideoCallBtn.addEventListener('click', () => initiateCall('video'));
if (startAudioCallBtn) startAudioCallBtn.addEventListener('click', () => initiateCall('audio'));

// Copy ID (Header & Spotlight)
if (copyIdBtn) {
  copyIdBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(myUniqueId).then(() => {
      copyIdBtn.innerHTML = '<span>✅</span> Copied!';
      setTimeout(() => {
        copyIdBtn.innerHTML = '<span>📋</span> Copy ID';
      }, 2000);
    });
  });
}

if (spotlightCopyBtn) {
  spotlightCopyBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(myUniqueId).then(() => {
      spotlightCopyBtn.innerHTML = '✅ Copied!';
      setTimeout(() => {
        spotlightCopyBtn.innerHTML = '📋 Copy ID';
      }, 2000);
    });
  });
}

// Share Direct Call Link (WhatsApp / Share API)
const shareLinkBtn = document.getElementById('shareLinkBtn');
function handleShareInvite() {
  const inviteUrl = `${window.location.origin}/?call=${encodeURIComponent(myUniqueId)}`;
  if (navigator.share) {
    navigator.share({
      title: 'Video Call Me',
      text: `Call me on my permanent ID #${myUniqueId}:`,
      url: inviteUrl
    }).catch(() => {});
  } else {
    navigator.clipboard.writeText(inviteUrl).then(() => {
      if (shareLinkBtn) shareLinkBtn.innerHTML = '<span>✅</span> Copied!';
      if (spotlightShareBtn) spotlightShareBtn.innerHTML = '✅ Copied!';
      setTimeout(() => {
        if (shareLinkBtn) shareLinkBtn.innerHTML = '<span>🔗</span> Share Link';
        if (spotlightShareBtn) spotlightShareBtn.innerHTML = '🔗 Share Link';
      }, 2000);
      alert(`Direct Call Link copied!\n\nSend this link to the other person on WhatsApp:\n${inviteUrl}\n\nWhen they open it, your ID will be auto-filled and ready to call!`);
    });
  }
}

if (shareLinkBtn) {
  shareLinkBtn.addEventListener('click', handleShareInvite);
}
if (spotlightShareBtn) {
  spotlightShareBtn.addEventListener('click', handleShareInvite);
}

// Edit / Customize Permanent Caller ID
if (editIdBtn) {
  editIdBtn.addEventListener('click', () => {
    const custom = prompt('Enter your preferred permanent Caller ID (e.g. 583-912 or any 6 digits):', myUniqueId);
    if (custom && custom.trim().length >= 3) {
      let cleaned = custom.trim().replace(/[^0-9]/g, '');
      let formatted = cleaned;
      if (cleaned.length >= 6) {
        formatted = `${cleaned.slice(0, 3)}-${cleaned.slice(3, 6)}`;
      } else {
        formatted = custom.trim();
      }
      myUniqueId = formatted;
      try {
        localStorage.setItem('permanent_caller_id', myUniqueId);
      } catch (e) {}
      updateAllIdDisplays(myUniqueId);
      if (socket && socket.connected) {
        socket.emit('register-user', { uniqueId: myUniqueId });
      }
      addLog(`Permanent Caller ID saved as: #${myUniqueId}`, 'success');
      alert(`Your permanent ID is saved as: ${myUniqueId}\nThis ID will now stay permanently saved on this device like a phone number!`);
    }
  });
}

// Outgoing / Incoming Call Modal handlers
if (cancelOutgoingCallBtn) cancelOutgoingCallBtn.addEventListener('click', cancelOutgoingCall);
if (acceptCallStandardBtn) acceptCallStandardBtn.addEventListener('click', () => acceptIncomingCall('standard'));
if (acceptAndMergeBtn) acceptAndMergeBtn.addEventListener('click', () => acceptIncomingCall('merge'));
if (acceptAndHoldBtn) acceptAndHoldBtn.addEventListener('click', () => acceptIncomingCall('standard'));
if (declineCallBtn) declineCallBtn.addEventListener('click', declineIncomingCall);

// Sidebar Live Incoming Call Card Handlers
if (sidebarAcceptCallBtn) sidebarAcceptCallBtn.addEventListener('click', () => acceptIncomingCall('standard'));
if (sidebarDeclineCallBtn) sidebarDeclineCallBtn.addEventListener('click', declineIncomingCall);
if (sidebarMergeCallBtn) sidebarMergeCallBtn.addEventListener('click', () => acceptIncomingCall('merge'));
if (sidebarHoldCallBtn) sidebarHoldCallBtn.addEventListener('click', () => acceptIncomingCall('standard'));

// Floating Call Controls
if (endCallBtn) endCallBtn.addEventListener('click', () => endCurrentCallLocal(true));

// -------------------------------------------------------------
// Comprehensive Mute Management (Microphone & Speaker)
// -------------------------------------------------------------
const micBtnIcon = document.getElementById('micBtnIcon');
const micBtnLabel = document.getElementById('micBtnLabel');
const speakerBtnIcon = document.getElementById('speakerBtnIcon');
const speakerBtnLabel = document.getElementById('speakerBtnLabel');
const toggleSpeakerBtn = document.getElementById('toggleSpeakerBtn');

// (isSpeakerMuted state is tracked in top-level variables)

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

if (toggleMicBtn) {
  toggleMicBtn.addEventListener('click', () => toggleMicrophoneMute());
}

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
  // If currently using simulated fallback stream or no physical camera, clicking turns on real camera
  if (isUsingSimulatedStream || !localStream || localStream.getVideoTracks().length === 0) {
    addLog('Requesting physical webcam access...', 'signal');
    hideCameraPrompt();
    initMedia(false, true);
    return;
  }

  const vTracks = localStream.getVideoTracks();
  if (vTracks.length === 0 || vTracks.some(t => t.readyState === 'ended')) {
    addLog('Webcam track ended, re-acquiring...', 'signal');
    hideCameraPrompt();
    initMedia(false, true);
    return;
  }

  isVideoMuted = !isVideoMuted;

  vTracks.forEach(t => (t.enabled = !isVideoMuted));

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
    localCamBadge.textContent = isVideoMuted ? '📹 Cam Off' : '📹 Camera Live';
    localCamBadge.style.background = isVideoMuted ? '#f1f5f9' : '#dcfce7';
    localCamBadge.style.color = isVideoMuted ? '#64748b' : '#15803d';
  }

  if (socket && socket.connected && currentCallId) {
    socket.emit('peer-media-state', {
      isAudioMuted,
      isVideoMuted
    });
  }

  addLog(`Camera ${isVideoMuted ? 'Turned Off' : 'Turned On'}`, isVideoMuted ? 'warning' : 'success');
}

if (toggleCamBtn) {
  toggleCamBtn.addEventListener('click', toggleCamera);
}

if (localCamBadge) {
  localCamBadge.style.cursor = 'pointer';
  localCamBadge.title = 'Click to activate or toggle camera';
  localCamBadge.addEventListener('click', toggleCamera);
}

// Auto-detect newly plugged in or unblocked camera devices
if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
  navigator.mediaDevices.addEventListener('devicechange', () => {
    addLog('Hardware media device change detected', 'info');
    if (isUsingSimulatedStream) {
      initMedia(false, true);
    }
  });
}

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

if (toggleInterruptionBtn) {
  toggleInterruptionBtn.addEventListener('click', toggleExternalInterruption);
}
if (clearLogsBtn) {
  clearLogsBtn.addEventListener('click', () => {
    if (debugLogs) debugLogs.innerHTML = '';
  });
}

// Network Status UI
const networkStatusDot = document.getElementById('networkStatusDot');
const networkStatusText = document.getElementById('networkStatusText');
const environmentHint = document.getElementById('environmentHint');

function updateNetworkStatus(isConnected, message = '') {
  if (networkStatusDot) {
    networkStatusDot.style.background = isConnected ? '#22c55e' : '#ef4444';
  }
  if (networkStatusText) {
    networkStatusText.innerHTML = isConnected 
      ? `<b>Server Connected:</b> Ready for real-time video & audio calls`
      : `<b>Server Disconnected:</b> ${message || 'Reconnecting...'}`;
  }
}

// AudioContext Unlocker for Mobile Browsers (Autoplay Policy)
function unlockAudioContext() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (AudioCtx) {
      if (!ringtoneAudioContext) {
        ringtoneAudioContext = new AudioCtx();
      }
      if (ringtoneAudioContext.state === 'suspended') {
        ringtoneAudioContext.resume();
      }
    }
  } catch (e) {}
}
window.addEventListener('click', unlockAudioContext);
window.addEventListener('touchstart', unlockAudioContext);

// Robust App Initializer
function initApp() {
  updateAllIdDisplays(myUniqueId);

  // Check URL params for direct call (e.g. ?call=849210)
  const urlParams = new URLSearchParams(window.location.search);
  const callParam = urlParams.get('call');
  if (callParam && targetIdInput) {
    targetIdInput.value = callParam;
    addLog(`Auto-filled caller ID #${callParam} from invite link! Click Video or Audio Call to connect.`, 'success');
  }

  // Check environment (localhost vs live deployment)
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    if (environmentHint) {
      environmentHint.innerHTML = '⚠️ <b>Testing on Localhost:</b> To call another phone, open your live Render link on both devices!';
      environmentHint.style.color = '#b45309';
    }
    addLog('Running on localhost. To call another phone or user, ensure both devices are on your live hosted URL.', 'warning');
  } else {
    if (environmentHint) {
      environmentHint.innerHTML = '🌐 <b>Live Hosted Server:</b> Ready for real-time calling';
      environmentHint.style.color = '#15803d';
    }
  }

  connectSocket();
  initMedia(false);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}

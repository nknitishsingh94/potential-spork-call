/* ==========================================================================
   MeetFlow / NonStop Video | Modern WebRTC Meeting Studio Controller
   Pure Luxury White Theme • Zero ID Clutter • 1-Click Meeting Link Mesh
   ========================================================================== */

(function() {
  'use strict';

  // -------------------------------------------------------------
  // 1. URL & Meeting Room Resolution
  // -------------------------------------------------------------
  function generateCleanMeetingSlug() {
    const adjectives = ['swift', 'focus', 'bright', 'clear', 'nexus', 'pulse', 'prime', 'wave'];
    const nouns = ['meet', 'room', 'space', 'huddle', 'sync', 'chat'];
    const randAdj = adjectives[Math.floor(Math.random() * adjectives.length)];
    const randNoun = nouns[Math.floor(Math.random() * nouns.length)];
    const randNum = Math.floor(100 + Math.random() * 900);
    return `${randAdj}-${randNoun}-${randNum}`;
  }

  const urlParams = new URLSearchParams(window.location.search);
  let currentRoom = (urlParams.get('room') || urlParams.get('call') || sessionStorage.getItem('current_meeting_room') || '').trim();
  
  if (!currentRoom) {
    currentRoom = generateCleanMeetingSlug();
    sessionStorage.setItem('current_meeting_room', currentRoom);
  }

  // Normalize URL to /app?room=...
  if (urlParams.get('room') !== currentRoom) {
    const newUrl = `${window.location.origin}/app?room=${encodeURIComponent(currentRoom)}`;
    window.history.replaceState({ room: currentRoom }, '', newUrl);
  }

  // -------------------------------------------------------------
  // 2. User Identity Resolution (No 6-digit ID)
  // -------------------------------------------------------------
  function getStoredUser() {
    try {
      const stored = localStorage.getItem('meetflow_user');
      if (stored) return JSON.parse(stored);
    } catch (e) {}
    return null;
  }

  let storedUser = getStoredUser();
  let myUserName = storedUser && storedUser.name ? storedUser.name : `Guest-${Math.floor(100 + Math.random() * 900)}`;

  // -------------------------------------------------------------
  // 3. DOM Elements
  // -------------------------------------------------------------
  const roomTitleDisplay = document.getElementById('roomTitleDisplay');
  const copyInviteLinkBtn = document.getElementById('copyInviteLinkBtn');
  const meetingDurationBadge = document.getElementById('meetingDurationBadge');
  const userDisplayName = document.getElementById('userDisplayName');
  const userAvatarCircle = document.getElementById('userAvatarCircle');
  const editDisplayNameBtn = document.getElementById('editDisplayNameBtn');
  const userProfilePill = document.getElementById('userProfilePill');

  const videoGrid = document.getElementById('videoGrid');
  const localVideoTile = document.getElementById('localVideoTile');
  const localVideo = document.getElementById('localVideo');
  const localAvatarFallback = document.getElementById('localAvatarFallback');
  const localAvatarLetter = document.getElementById('localAvatarLetter');
  const localAvatarName = document.getElementById('localAvatarName');
  const localTileName = document.getElementById('localTileName');
  const localMicIndicator = document.getElementById('localMicIndicator');
  const localCamIndicator = document.getElementById('localCamIndicator');

  const remoteVideoTile = document.getElementById('remoteVideoTile');
  const remoteVideo = document.getElementById('remoteVideo');
  const remoteAvatarFallback = document.getElementById('remoteAvatarFallback');
  const remoteAvatarLetter = document.getElementById('remoteAvatarLetter');
  const remoteAvatarName = document.getElementById('remoteAvatarName');
  const remoteTileName = document.getElementById('remoteTileName');
  const remoteMicIndicator = document.getElementById('remoteMicIndicator');

  const waitingNoticeCard = document.getElementById('waitingNoticeCard');
  const inviteUrlInput = document.getElementById('inviteUrlInput');
  const waitingCopyLinkBtn = document.getElementById('waitingCopyLinkBtn');
  const shareWhatsAppBtn = document.getElementById('shareWhatsAppBtn');
  const shareEmailBtn = document.getElementById('shareEmailBtn');

  const btnToggleMic = document.getElementById('btnToggleMic');
  const micIconSpan = document.getElementById('micIconSpan');
  const btnToggleCam = document.getElementById('btnToggleCam');
  const camIconSpan = document.getElementById('camIconSpan');
  const btnToggleScreen = document.getElementById('btnToggleScreen');
  const btnDockCopyLink = document.getElementById('btnDockCopyLink');
  const btnToggleChat = document.getElementById('btnToggleChat');
  const chatUnreadBadge = document.getElementById('chatUnreadBadge');
  const btnToggleParticipants = document.getElementById('btnToggleParticipants');
  const dockParticipantsCount = document.getElementById('dockParticipantsCount');
  const btnLeaveMeeting = document.getElementById('btnLeaveMeeting');

  const chatDrawer = document.getElementById('chatDrawer');
  const closeChatDrawerBtn = document.getElementById('closeChatDrawerBtn');
  const chatMessagesList = document.getElementById('chatMessagesList');
  const chatForm = document.getElementById('chatForm');
  const chatInput = document.getElementById('chatInput');

  const participantsDrawer = document.getElementById('participantsDrawer');
  const closeParticipantsDrawerBtn = document.getElementById('closeParticipantsDrawerBtn');
  const participantsCountNumber = document.getElementById('participantsCountNumber');
  const participantsList = document.getElementById('participantsList');
  const drawerCopyInviteBtn = document.getElementById('drawerCopyInviteBtn');

  const editNameModal = document.getElementById('editNameModal');
  const newDisplayNameInput = document.getElementById('newDisplayNameInput');
  const btnSaveDisplayName = document.getElementById('btnSaveDisplayName');
  const btnCancelDisplayName = document.getElementById('btnCancelDisplayName');
  const closeEditNameModalBtn = document.getElementById('closeEditNameModalBtn');

  const floatingToast = document.getElementById('floatingToast');
  const toastMessage = document.getElementById('toastMessage');

  // -------------------------------------------------------------
  // 4. State
  // -------------------------------------------------------------
  let localStream = null;
  let screenStream = null;
  let isMicMuted = false;
  let isCamOff = false;
  let isSharingScreen = false;
  let unreadChatCount = 0;
  let meetingStartTime = Date.now();
  let durationInterval = null;

  // WebRTC Mesh State: remoteSocketId -> RTCPeerConnection
  const peerConnections = new Map();
  const roomParticipants = new Map(); // socketId -> { socketId, userName }

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

  // -------------------------------------------------------------
  // 5. Toast Helper
  // -------------------------------------------------------------
  function showToast(text, duration = 2600) {
    if (!floatingToast || !toastMessage) return;
    toastMessage.textContent = text;
    floatingToast.classList.add('visible');
    setTimeout(() => {
      floatingToast.classList.remove('visible');
    }, duration);
  }

  // -------------------------------------------------------------
  // 6. Synchronize Profile & Header Displays
  // -------------------------------------------------------------
  function updateProfileDisplays() {
    const firstLetter = myUserName.charAt(0).toUpperCase() || 'U';
    if (roomTitleDisplay) roomTitleDisplay.textContent = currentRoom;
    if (userDisplayName) userDisplayName.textContent = myUserName;
    if (userAvatarCircle) userAvatarCircle.textContent = firstLetter;
    if (localTileName) localTileName.textContent = `${myUserName} (You)`;
    if (localAvatarName) localAvatarName.textContent = myUserName;
    if (localAvatarLetter) localAvatarLetter.textContent = firstLetter;

    const fullUrl = `${window.location.origin}/app?room=${encodeURIComponent(currentRoom)}`;
    if (inviteUrlInput) inviteUrlInput.value = fullUrl;
  }
  updateProfileDisplays();

  // -------------------------------------------------------------
  // 7. Clipboard Copy Helper
  // -------------------------------------------------------------
  function copyMeetingLink() {
    const fullUrl = `${window.location.origin}/app?room=${encodeURIComponent(currentRoom)}`;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(fullUrl).then(() => {
        showToast('✓ Meeting link copied to clipboard!');
      }).catch(() => {
        manualCopy(fullUrl);
      });
    } else {
      manualCopy(fullUrl);
    }
  }

  function manualCopy(text) {
    const temp = document.createElement('textarea');
    temp.value = text;
    document.body.appendChild(temp);
    temp.select();
    document.execCommand('copy');
    document.body.removeChild(temp);
    showToast('✓ Meeting link copied to clipboard!');
  }

  if (copyInviteLinkBtn) copyInviteLinkBtn.addEventListener('click', copyMeetingLink);
  if (waitingCopyLinkBtn) waitingCopyLinkBtn.addEventListener('click', copyMeetingLink);
  if (btnDockCopyLink) btnDockCopyLink.addEventListener('click', copyMeetingLink);
  if (drawerCopyInviteBtn) drawerCopyInviteBtn.addEventListener('click', copyMeetingLink);

  // Social Sharing
  if (shareWhatsAppBtn) {
    shareWhatsAppBtn.addEventListener('click', () => {
      const fullUrl = `${window.location.origin}/app?room=${encodeURIComponent(currentRoom)}`;
      const text = encodeURIComponent(`Join my MeetFlow HD video meeting here:\n${fullUrl}`);
      window.open(`https://api.whatsapp.com/send?text=${text}`, '_blank');
    });
  }

  if (shareEmailBtn) {
    shareEmailBtn.addEventListener('click', () => {
      const fullUrl = `${window.location.origin}/app?room=${encodeURIComponent(currentRoom)}`;
      const subject = encodeURIComponent(`MeetFlow Video Meeting: ${currentRoom}`);
      const body = encodeURIComponent(`Hi,\n\nPlease join our HD video meeting:\n${fullUrl}\n\nNo app download required - clicks open instantly in your browser!`);
      window.location.href = `mailto:?subject=${subject}&body=${body}`;
    });
  }

  // -------------------------------------------------------------
  // 8. Meeting Timer
  // -------------------------------------------------------------
  function startDurationTimer() {
    durationInterval = setInterval(() => {
      const diffSec = Math.floor((Date.now() - meetingStartTime) / 1000);
      const mins = String(Math.floor(diffSec / 60)).padStart(2, '0');
      const secs = String(diffSec % 60).padStart(2, '0');
      if (meetingDurationBadge) {
        meetingDurationBadge.textContent = `⏱️ ${mins}:${secs}`;
      }
    }, 1000);
  }
  startDurationTimer();

  // -------------------------------------------------------------
  // 9. Camera & Microphone Initialization
  // -------------------------------------------------------------
  async function initializeMedia() {
    try {
      localStream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: 'user'
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
      if (localVideo) {
        localVideo.srcObject = localStream;
      }
    } catch (err) {
      console.warn('Camera failed, trying audio-only fallback:', err);
      try {
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        isCamOff = true;
        updateCamUI();
      } catch (audioErr) {
        console.error('Microphone also failed:', audioErr);
        showToast('⚠️ Camera & Mic unavailable. Join as viewer.');
      }
    }
  }

  // -------------------------------------------------------------
  // 10. WebRTC & Socket.IO Signaling Engine
  // -------------------------------------------------------------
  const socket = io();

  socket.on('connect', () => {
    console.log('[Socket] Connected to signaling gateway:', socket.id);
    
    // Register self in room
    socket.emit('join-room', {
      roomId: currentRoom,
      userName: myUserName,
      callType: 'video'
    });
  });

  // Successfully joined room
  socket.on('room-joined-success', async ({ roomId, participants, self }) => {
    console.log(`[Room] Successfully joined "${roomId}". Existing participants:`, participants);

    // Track self
    roomParticipants.set(socket.id, { socketId: socket.id, userName: myUserName });

    if (participants && participants.length > 0) {
      // There are other participants in the room
      if (waitingNoticeCard) waitingNoticeCard.style.display = 'none';
      if (videoGrid) {
        videoGrid.classList.remove('single-user');
        videoGrid.classList.add('multi-user');
      }

      participants.forEach(p => {
        roomParticipants.set(p.socketId, p);
        // We create WebRTC offer to existing participants
        createPeerConnectionAndOffer(p.socketId, p.userName);
      });
    } else {
      // Solo in room -> Show invite card
      if (waitingNoticeCard) waitingNoticeCard.style.display = 'block';
      if (videoGrid) {
        videoGrid.classList.add('single-user');
        videoGrid.classList.remove('multi-user');
      }
    }

    updateParticipantsListUI();
  });

  // Another user joined the room
  socket.on('user-joined-room', async ({ roomId, user, totalParticipants }) => {
    console.log(`[Room] New user arrived:`, user);
    roomParticipants.set(user.socketId, user);
    showToast(`👋 ${user.userName} joined the meeting!`);

    // Hide waiting card and adjust grid
    if (waitingNoticeCard) waitingNoticeCard.style.display = 'none';
    if (videoGrid) {
      videoGrid.classList.remove('single-user');
      videoGrid.classList.add('multi-user');
    }

    updateParticipantsListUI();
  });

  // Participant left the room
  socket.on('user-left-room', ({ socketId, userName, remainingCount }) => {
    console.log(`[Room] User left:`, userName, socketId);
    showToast(`🚪 ${userName || 'Participant'} left the room`);

    // Close and remove peer connection
    const pc = peerConnections.get(socketId);
    if (pc) {
      pc.close();
      peerConnections.delete(socketId);
    }
    roomParticipants.delete(socketId);

    // If only self remains in room, show waiting card
    if (roomParticipants.size <= 1) {
      if (remoteVideoTile) remoteVideoTile.style.display = 'none';
      if (waitingNoticeCard) waitingNoticeCard.style.display = 'block';
      if (videoGrid) {
        videoGrid.classList.add('single-user');
        videoGrid.classList.remove('multi-user');
      }
    }

    updateParticipantsListUI();
  });

  // WebRTC Signal Relay Handler
  socket.on('room-signal', async ({ fromSocketId, fromUserName, signal, type }) => {
    let pc = peerConnections.get(fromSocketId);

    if (type === 'offer') {
      console.log(`[WebRTC] Received offer from ${fromUserName} (${fromSocketId})`);
      if (!pc) {
        pc = createPeerConnection(fromSocketId, fromUserName);
      }
      await pc.setRemoteDescription(new RTCSessionDescription(signal));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      socket.emit('room-signal', {
        targetSocketId: fromSocketId,
        signal: answer,
        type: 'answer'
      });
    } else if (type === 'answer') {
      console.log(`[WebRTC] Received answer from ${fromUserName} (${fromSocketId})`);
      if (pc) {
        await pc.setRemoteDescription(new RTCSessionDescription(signal));
      }
    } else if (type === 'ice-candidate') {
      if (pc && signal) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(signal));
        } catch (e) {
          console.warn('Error adding ICE candidate:', e);
        }
      }
    }
  });

  // -------------------------------------------------------------
  // 11. PeerConnection Creation & Track Relays
  // -------------------------------------------------------------
  function createPeerConnection(targetSocketId, targetUserName) {
    const pc = new RTCPeerConnection(rtcConfig);
    peerConnections.set(targetSocketId, pc);

    // Add local tracks
    if (localStream) {
      localStream.getTracks().forEach(track => {
        pc.addTrack(track, localStream);
      });
    }

    // ICE Candidates
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('room-signal', {
          targetSocketId,
          signal: event.candidate,
          type: 'ice-candidate'
        });
      }
    };

    // Remote Track Received
    pc.ontrack = (event) => {
      console.log(`[WebRTC] Remote stream track received from ${targetUserName}`);
      if (remoteVideo) {
        remoteVideo.srcObject = event.streams[0];
      }
      if (remoteVideoTile) {
        remoteVideoTile.style.display = 'flex';
      }
      if (remoteTileName) {
        remoteTileName.textContent = targetUserName || 'Participant';
      }
      if (remoteAvatarName) {
        remoteAvatarName.textContent = targetUserName || 'Participant';
      }
      if (remoteAvatarLetter) {
        remoteAvatarLetter.textContent = (targetUserName || 'P').charAt(0).toUpperCase();
      }
    };

    pc.onconnectionstatechange = () => {
      console.log(`[WebRTC] Connection state with ${targetUserName}:`, pc.connectionState);
      if (pc.connectionState === 'connected') {
        showToast(`⚡ HD Connection active with ${targetUserName}`);
      }
    };

    return pc;
  }

  async function createPeerConnectionAndOffer(targetSocketId, targetUserName) {
    const pc = createPeerConnection(targetSocketId, targetUserName);
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit('room-signal', {
        targetSocketId,
        signal: offer,
        type: 'offer'
      });
    } catch (err) {
      console.error('Failed to create offer:', err);
    }
  }

  // -------------------------------------------------------------
  // 12. Audio / Video Toggle Controls
  // -------------------------------------------------------------
  function toggleMic() {
    if (!localStream) return;
    const audioTrack = localStream.getAudioTracks()[0];
    if (audioTrack) {
      isMicMuted = !isMicMuted;
      audioTrack.enabled = !isMicMuted;
      updateMicUI();
    }
  }

  function updateMicUI() {
    if (isMicMuted) {
      btnToggleMic.classList.add('muted');
      if (micIconSpan) micIconSpan.textContent = '🔇';
      if (localMicIndicator) {
        localMicIndicator.textContent = '🔇';
        localMicIndicator.classList.add('muted');
      }
      showToast('Microphone muted');
    } else {
      btnToggleMic.classList.remove('muted');
      if (micIconSpan) micIconSpan.textContent = '🎙️';
      if (localMicIndicator) {
        localMicIndicator.textContent = '🎙️';
        localMicIndicator.classList.remove('muted');
      }
      showToast('Microphone unmuted');
    }
  }

  function toggleCam() {
    if (!localStream) return;
    const videoTrack = localStream.getVideoTracks()[0];
    if (videoTrack) {
      isCamOff = !isCamOff;
      videoTrack.enabled = !isCamOff;
      updateCamUI();
    }
  }

  function updateCamUI() {
    if (isCamOff) {
      btnToggleCam.classList.add('muted');
      if (camIconSpan) camIconSpan.textContent = '📷';
      if (localVideo) localVideo.style.display = 'none';
      if (localAvatarFallback) localAvatarFallback.style.display = 'flex';
      if (localCamIndicator) {
        localCamIndicator.textContent = '📷';
        localCamIndicator.classList.add('muted');
      }
      showToast('Camera turned off');
    } else {
      btnToggleCam.classList.remove('muted');
      if (camIconSpan) camIconSpan.textContent = '📹';
      if (localVideo) localVideo.style.display = 'block';
      if (localAvatarFallback) localAvatarFallback.style.display = 'none';
      if (localCamIndicator) {
        localCamIndicator.textContent = '📹';
        localCamIndicator.classList.remove('muted');
      }
      showToast('Camera turned on');
    }
  }

  if (btnToggleMic) btnToggleMic.addEventListener('click', toggleMic);
  if (btnToggleCam) btnToggleCam.addEventListener('click', toggleCam);

  // -------------------------------------------------------------
  // 13. Screen Sharing
  // -------------------------------------------------------------
  async function toggleScreenShare() {
    if (isSharingScreen) {
      stopScreenShare();
      return;
    }

    try {
      screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      const screenTrack = screenStream.getVideoTracks()[0];

      // Replace track on all peer connections
      peerConnections.forEach(pc => {
        const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
        if (sender) sender.replaceTrack(screenTrack);
      });

      if (localVideo) localVideo.srcObject = screenStream;
      isSharingScreen = true;
      btnToggleScreen.classList.add('active');
      showToast('🖥️ Screen sharing active');

      screenTrack.onended = () => {
        stopScreenShare();
      };
    } catch (err) {
      console.warn('Screen share canceled or denied:', err);
    }
  }

  function stopScreenShare() {
    if (screenStream) {
      screenStream.getTracks().forEach(t => t.stop());
      screenStream = null;
    }

    if (localStream) {
      const camTrack = localStream.getVideoTracks()[0];
      peerConnections.forEach(pc => {
        const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
        if (sender && camTrack) sender.replaceTrack(camTrack);
      });
      if (localVideo) localVideo.srcObject = localStream;
    }

    isSharingScreen = false;
    btnToggleScreen.classList.remove('active');
    showToast('Screen sharing stopped');
  }

  if (btnToggleScreen) btnToggleScreen.addEventListener('click', toggleScreenShare);

  // -------------------------------------------------------------
  // 14. In-Meeting Chat System
  // -------------------------------------------------------------
  function toggleChatDrawer() {
    if (!chatDrawer) return;
    const isVisible = chatDrawer.style.display === 'flex';
    if (isVisible) {
      chatDrawer.style.display = 'none';
    } else {
      chatDrawer.style.display = 'flex';
      if (participantsDrawer) participantsDrawer.style.display = 'none';
      unreadChatCount = 0;
      if (chatUnreadBadge) chatUnreadBadge.style.display = 'none';
      if (chatInput) chatInput.focus();
    }
  }

  if (btnToggleChat) btnToggleChat.addEventListener('click', toggleChatDrawer);
  if (closeChatDrawerBtn) closeChatDrawerBtn.addEventListener('click', toggleChatDrawer);

  if (chatForm) {
    chatForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = chatInput ? chatInput.value.trim() : '';
      if (!text) return;

      socket.emit('room-chat-message', { message: text });
      chatInput.value = '';
    });
  }

  socket.on('room-chat-message', ({ senderSocketId, senderName, message, timestamp }) => {
    const isSelf = senderSocketId === socket.id;
    appendChatMessage(senderName, message, timestamp, isSelf);

    if (!isSelf && chatDrawer && chatDrawer.style.display !== 'flex') {
      unreadChatCount++;
      if (chatUnreadBadge) {
        chatUnreadBadge.textContent = unreadChatCount;
        chatUnreadBadge.style.display = 'block';
      }
      showToast(`💬 ${senderName}: ${message.slice(0, 30)}...`);
    }
  });

  function appendChatMessage(name, text, time, isSelf) {
    if (!chatMessagesList) return;
    
    // Remove empty notice if present
    const emptyNotice = chatMessagesList.querySelector('.chat-empty-notice');
    if (emptyNotice) emptyNotice.remove();

    const bubble = document.createElement('div');
    bubble.className = `chat-bubble ${isSelf ? 'self' : 'remote'}`;
    bubble.innerHTML = `
      <div class="chat-meta"><b>${isSelf ? 'You' : name}</b> • ${time || 'Just now'}</div>
      <div class="chat-text">${escapeHtml(text)}</div>
    `;
    chatMessagesList.appendChild(bubble);
    chatMessagesList.scrollTop = chatMessagesList.scrollHeight;
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // -------------------------------------------------------------
  // 15. Participants Drawer
  // -------------------------------------------------------------
  function toggleParticipantsDrawer() {
    if (!participantsDrawer) return;
    const isVisible = participantsDrawer.style.display === 'flex';
    if (isVisible) {
      participantsDrawer.style.display = 'none';
    } else {
      participantsDrawer.style.display = 'flex';
      if (chatDrawer) chatDrawer.style.display = 'none';
      updateParticipantsListUI();
    }
  }

  if (btnToggleParticipants) btnToggleParticipants.addEventListener('click', toggleParticipantsDrawer);
  if (closeParticipantsDrawerBtn) closeParticipantsDrawerBtn.addEventListener('click', toggleParticipantsDrawer);

  function updateParticipantsListUI() {
    const totalCount = Math.max(1, roomParticipants.size);
    if (dockParticipantsCount) dockParticipantsCount.textContent = totalCount;
    if (participantsCountNumber) participantsCountNumber.textContent = totalCount;

    if (!participantsList) return;
    participantsList.innerHTML = '';

    roomParticipants.forEach(p => {
      const isSelf = p.socketId === socket.id;
      const initial = (p.userName || 'P').charAt(0).toUpperCase();

      const item = document.createElement('div');
      item.className = 'participant-item';
      item.innerHTML = `
        <div class="participant-info">
          <div class="participant-avatar-pill">${initial}</div>
          <span class="participant-item-name">${escapeHtml(p.userName || 'User')} ${isSelf ? '(You)' : ''}</span>
        </div>
        <span style="font-size: 0.8rem; color: #10b981;">🟢 Live</span>
      `;
      participantsList.appendChild(item);
    });
  }

  // -------------------------------------------------------------
  // 16. Edit Display Name Modal
  // -------------------------------------------------------------
  function openEditNameModal() {
    if (!editNameModal) return;
    if (newDisplayNameInput) newDisplayNameInput.value = myUserName;
    editNameModal.style.display = 'flex';
  }

  function closeEditNameModal() {
    if (editNameModal) editNameModal.style.display = 'none';
  }

  if (editDisplayNameBtn) editDisplayNameBtn.addEventListener('click', openEditNameModal);
  if (userProfilePill) userProfilePill.addEventListener('click', openEditNameModal);
  if (closeEditNameModalBtn) closeEditNameModalBtn.addEventListener('click', closeEditNameModal);
  if (btnCancelDisplayName) btnCancelDisplayName.addEventListener('click', closeEditNameModal);

  if (btnSaveDisplayName) {
    btnSaveDisplayName.addEventListener('click', () => {
      const val = newDisplayNameInput ? newDisplayNameInput.value.trim() : '';
      if (!val) return;

      myUserName = val;
      const user = getStoredUser() || {};
      user.name = val;
      localStorage.setItem('meetflow_user', JSON.stringify(user));

      updateProfileDisplays();
      closeEditNameModal();
      showToast(`✓ Name updated to "${val}"`);

      // Re-join room with updated name
      socket.emit('join-room', {
        roomId: currentRoom,
        userName: myUserName,
        callType: 'video'
      });
    });
  }

  // -------------------------------------------------------------
  // 17. Leave Meeting
  // -------------------------------------------------------------
  if (btnLeaveMeeting) {
    btnLeaveMeeting.addEventListener('click', () => {
      if (confirm('Leave this video meeting?')) {
        socket.emit('leave-room');
        if (localStream) {
          localStream.getTracks().forEach(t => t.stop());
        }
        if (screenStream) {
          screenStream.getTracks().forEach(t => t.stop());
        }
        window.location.href = '/';
      }
    });
  }

  // -------------------------------------------------------------
  // 18. Keyboard Shortcuts (Ctrl+D for mic, Ctrl+E for camera)
  // -------------------------------------------------------------
  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
      e.preventDefault();
      toggleMic();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'e') {
      e.preventDefault();
      toggleCam();
    }
  });

  // Start media immediately on load
  initializeMedia();

})();

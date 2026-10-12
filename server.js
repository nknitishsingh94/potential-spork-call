const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

// Helper to normalize Unique IDs (e.g. "849-210" -> "849210")
function normalizeId(id) {
  if (!id) return '';
  return String(id).replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
}

// In-Memory state management
// connectedUsers: normalizedId -> { socketId, uniqueId, displayId, activeCallId, currentCallType, inExternalCall }
const connectedUsers = new Map();

// socketToUserId: socketId -> normalizedId
const socketToUserId = new Map();

// activeCalls: callId -> { callId, initiatorId, participants: Set<normalizedId>, callType, status }
const activeCalls = new Map();

// pendingCallTimeouts: callId -> timeoutHandle (35s timeout before UNAVAILABLE)
const pendingCallTimeouts = new Map();

io.on('connection', (socket) => {
  console.log(`[Socket Connected] ID: ${socket.id}`);

  // 1. User Registration by Unique ID
  socket.on('register-user', ({ uniqueId }) => {
    if (!uniqueId) return;

    const normId = normalizeId(uniqueId);
    const existing = connectedUsers.get(normId) || {};

    connectedUsers.set(normId, {
      socketId: socket.id,
      uniqueId: normId,
      displayId: uniqueId,
      activeCallId: existing.activeCallId || null,
      inExternalCall: false
    });
    socketToUserId.set(socket.id, normId);

    console.log(`[User Registered] Unique ID: ${uniqueId} (Normalized: ${normId}) on socket ${socket.id}`);

    // Confirm registration to caller
    socket.emit('registered-success', {
      uniqueId: normId,
      displayId: uniqueId
    });

    broadcastOnlineUsers();
  });

  // 2. Fetch list of users
  socket.on('get-users', () => {
    emitOnlineUsersTo(socket);
  });

  // 3. Initiate Call by Unique ID (Video or Audio)
  /**
   * ZERO-BUSY REQUIREMENTS:
   * 1. Check if receiver ID is online and reachable.
   * 2. If reachable, show RINGING to caller immediately.
   * 3. NEVER reject call because receiver is on another call (NO USER_BUSY).
   * 4. Return UNAVAILABLE only when receiver cannot be reached or call request times out.
   */
  socket.on('initiate-call', ({ targetId, callType = 'video' }) => {
    const callerId = socketToUserId.get(socket.id);
    const caller = connectedUsers.get(callerId);

    if (!caller) {
      socket.emit('call-error', { message: 'You are not registered' });
      return;
    }

    const normTargetId = normalizeId(targetId);
    const receiver = connectedUsers.get(normTargetId);

    // Rule 1 & 5: Check whether receiver is online and reachable
    if (!receiver || !receiver.socketId) {
      console.log(`[Call Attempt] Target ID "${targetId}" not found or offline -> UNAVAILABLE`);
      socket.emit('call-failed', {
        targetId,
        reason: 'UNAVAILABLE',
        message: `ID "${targetId}" is offline or does not exist.`
      });
      return;
    }

    if (callerId === normTargetId) {
      socket.emit('call-error', { message: 'Cannot call your own ID' });
      return;
    }

    const callId = `call_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const isReceiverAlreadyInCall = Boolean(receiver.activeCallId);

    console.log(
      `[Call Initiated] ID #${caller.displayId} -> ID #${receiver.displayId} (${callType.toUpperCase()})` +
      (isReceiverAlreadyInCall ? ` [RECEIVER IN CALL - NO BUSY SENT, SENDING RINGING]` : '')
    );

    // Save pending call state
    activeCalls.set(callId, {
      callId,
      initiatorId: callerId,
      targetUserId: normTargetId,
      participants: new Set([callerId]),
      callType,
      status: 'pending'
    });

    // Rule 2 & 3: Tell caller immediately: RINGING (NEVER USER_BUSY!)
    socket.emit('call-ringing', {
      callId,
      targetId: receiver.displayId,
      status: 'RINGING',
      callType,
      receiverHasExistingCall: isReceiverAlreadyInCall
    });

    // Send incoming-call notification to receiver (Call Waiting HUD)
    io.to(receiver.socketId).emit('incoming-call', {
      callId,
      callerId: caller.displayId,
      callType,
      isCallWaiting: isReceiverAlreadyInCall,
      currentCallId: receiver.activeCallId
    });

    // Rule 5: 35-second timeout for UNAVAILABLE
    const timeoutHandle = setTimeout(() => {
      const call = activeCalls.get(callId);
      if (call && call.status === 'pending') {
        console.log(`[Call Timeout] Call ${callId} timed out -> UNAVAILABLE`);
        activeCalls.delete(callId);
        pendingCallTimeouts.delete(callId);

        // Notify caller
        io.to(caller.socketId).emit('call-failed', {
          callId,
          targetId: receiver.displayId,
          reason: 'UNAVAILABLE',
          message: 'No response. Call timed out (UNAVAILABLE).'
        });

        // Notify receiver to dismiss dialog
        io.to(receiver.socketId).emit('call-missed', {
          callId,
          callerId: caller.displayId
        });
      }
    }, 35000);

    pendingCallTimeouts.set(callId, timeoutHandle);
  });

  // 4. Accept Call
  socket.on('accept-call', ({ callId, mode = 'standard' }) => {
    const receiverId = socketToUserId.get(socket.id);
    const receiver = connectedUsers.get(receiverId);
    const pendingCall = activeCalls.get(callId);

    if (!pendingCall || !receiver) return;

    clearCallTimeout(callId);

    const callerId = pendingCall.initiatorId;
    const caller = connectedUsers.get(callerId);

    if (mode === 'merge' && receiver.activeCallId) {
      // MERGE MODE: Add caller to existing multi-person conference!
      const currentCallId = receiver.activeCallId;
      const currentCall = activeCalls.get(currentCallId);

      if (currentCall) {
        currentCall.participants.add(callerId);
        if (caller) caller.activeCallId = currentCallId;
        activeCalls.delete(callId);

        console.log(`[Call Merged] ID #${caller?.displayId} merged into Call ${currentCallId}`);

        const participantList = Array.from(currentCall.participants).map(id => {
          const u = connectedUsers.get(id);
          return { userId: id, displayId: u?.displayId || id };
        });

        currentCall.participants.forEach(pid => {
          const user = connectedUsers.get(pid);
          if (user?.socketId) {
            io.to(user.socketId).emit('participant-joined-room', {
              callId: currentCallId,
              newUserId: callerId,
              newDisplayId: caller?.displayId,
              callType: currentCall.callType,
              participants: participantList
            });
          }
        });

        if (caller?.socketId) {
          io.to(caller.socketId).emit('call-accepted', {
            callId: currentCallId,
            peerId: receiverId,
            peerDisplayId: receiver.displayId,
            callType: currentCall.callType,
            mode: 'merged',
            participants: participantList
          });
        }

        broadcastOnlineUsers();
        return;
      }
    }

    // STANDARD ACCEPT:
    if (receiver.activeCallId && receiver.activeCallId !== callId) {
      const oldCall = activeCalls.get(receiver.activeCallId);
      if (oldCall) {
        oldCall.participants.forEach(pid => {
          if (pid !== receiverId) {
            const peer = connectedUsers.get(pid);
            if (peer?.socketId) {
              io.to(peer.socketId).emit('peer-hold-state', {
                callId: receiver.activeCallId,
                userId: receiverId,
                displayId: receiver.displayId,
                isHeld: true,
                reason: 'Switched to new incoming call'
              });
            }
          }
        });
      }
    }

    pendingCall.status = 'active';
    pendingCall.participants.add(receiverId);
    receiver.activeCallId = callId;
    if (caller) caller.activeCallId = callId;

    console.log(`[Call Accepted] Call ${callId} active between ID #${caller?.displayId} and ID #${receiver.displayId}`);

    const participantList = [
      { userId: callerId, displayId: caller?.displayId },
      { userId: receiverId, displayId: receiver.displayId }
    ];

    if (caller?.socketId) {
      io.to(caller.socketId).emit('call-accepted', {
        callId,
        peerId: receiverId,
        peerDisplayId: receiver.displayId,
        callType: pendingCall.callType,
        mode: 'direct',
        participants: participantList
      });
    }

    socket.emit('call-connected', {
      callId,
      peerId: callerId,
      peerDisplayId: caller?.displayId,
      callType: pendingCall.callType,
      participants: participantList
    });

    broadcastOnlineUsers();
  });

  // 5. Reject Call
  socket.on('reject-call', ({ callId }) => {
    clearCallTimeout(callId);
    const call = activeCalls.get(callId);
    if (!call) return;

    const caller = connectedUsers.get(call.initiatorId);
    activeCalls.delete(callId);

    console.log(`[Call Rejected] Call ${callId} declined by receiver`);

    if (caller?.socketId) {
      io.to(caller.socketId).emit('call-rejected', {
        callId,
        reason: 'DECLINED',
        message: 'Receiver declined the call'
      });
    }
  });

  // 6. WebRTC Signaling Relays
  socket.on('webrtc-offer', ({ targetUserId, offer, callId }) => {
    const fromUserId = socketToUserId.get(socket.id);
    const normTarget = normalizeId(targetUserId);
    const target = connectedUsers.get(normTarget);
    if (target?.socketId) {
      io.to(target.socketId).emit('webrtc-offer', {
        fromUserId,
        offer,
        callId
      });
    }
  });

  socket.on('webrtc-answer', ({ targetUserId, answer, callId }) => {
    const fromUserId = socketToUserId.get(socket.id);
    const normTarget = normalizeId(targetUserId);
    const target = connectedUsers.get(normTarget);
    if (target?.socketId) {
      io.to(target.socketId).emit('webrtc-answer', {
        fromUserId,
        answer,
        callId
      });
    }
  });

  socket.on('ice-candidate', ({ targetUserId, candidate, callId }) => {
    const fromUserId = socketToUserId.get(socket.id);
    const normTarget = normalizeId(targetUserId);
    const target = connectedUsers.get(normTarget);
    if (target?.socketId) {
      io.to(target.socketId).emit('ice-candidate', {
        fromUserId,
        candidate,
        callId
      });
    }
  });

  // 7. External Interruption (WhatsApp call takes mic/cam)
  socket.on('external-interruption', ({ isInterrupted, reason }) => {
    const userId = socketToUserId.get(socket.id);
    const user = connectedUsers.get(userId);
    if (!user) return;

    user.inExternalCall = isInterrupted;
    console.log(`[Interruption] ID #${user.displayId} interrupted: ${isInterrupted} (${reason})`);

    if (user.activeCallId) {
      const call = activeCalls.get(user.activeCallId);
      if (call) {
        call.participants.forEach(pid => {
          if (pid !== userId) {
            const peer = connectedUsers.get(pid);
            if (peer?.socketId) {
              io.to(peer.socketId).emit('peer-hold-state', {
                callId: user.activeCallId,
                userId,
                displayId: user.displayId,
                isHeld: isInterrupted,
                reason: reason || 'WhatsApp call has audio focus'
              });
            }
          }
        });
      }
    }

    broadcastOnlineUsers();
  });

  // 8. End Call
  socket.on('end-call', ({ callId }) => {
    endCallSession(callId, socketToUserId.get(socket.id));
  });

  // 9. Disconnect
  socket.on('disconnect', () => {
    const userId = socketToUserId.get(socket.id);
    if (!userId) return;

    const user = connectedUsers.get(userId);
    console.log(`[Socket Disconnected] ID #${user?.displayId || userId}`);

    if (user?.activeCallId) {
      endCallSession(user.activeCallId, userId);
    }

    connectedUsers.delete(userId);
    socketToUserId.delete(socket.id);
    broadcastOnlineUsers();
  });
});

function clearCallTimeout(callId) {
  if (pendingCallTimeouts.has(callId)) {
    clearTimeout(pendingCallTimeouts.get(callId));
    pendingCallTimeouts.delete(callId);
  }
}

function endCallSession(callId, endedByUserId) {
  clearCallTimeout(callId);
  const call = activeCalls.get(callId);
  if (!call) return;

  console.log(`[Call Ended] Session ${callId} ended`);

  call.participants.forEach(pid => {
    const u = connectedUsers.get(pid);
    if (u) {
      if (u.activeCallId === callId) {
        u.activeCallId = null;
      }
      if (u.socketId) {
        io.to(u.socketId).emit('call-ended', {
          callId,
          endedBy: endedByUserId
        });
      }
    }
  });

  activeCalls.delete(callId);
  broadcastOnlineUsers();
}

function broadcastOnlineUsers() {
  const users = Array.from(connectedUsers.values()).map(u => ({
    userId: u.uniqueId,
    displayId: u.displayId,
    inCall: Boolean(u.activeCallId),
    activeCallId: u.activeCallId,
    inExternalCall: u.inExternalCall
  }));
  io.emit('online-users-updated', users);
}

function emitOnlineUsersTo(socket) {
  const users = Array.from(connectedUsers.values()).map(u => ({
    userId: u.uniqueId,
    displayId: u.displayId,
    inCall: Boolean(u.activeCallId),
    activeCallId: u.activeCallId,
    inExternalCall: u.inExternalCall
  }));
  socket.emit('online-users-updated', users);
}

server.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`🚀 Video & Audio Calling Server (Unique ID Architecture)`);
  console.log(`📍 URL: http://localhost:${PORT}`);
  console.log(`====================================================`);
});

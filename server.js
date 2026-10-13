const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const PORT = process.env.PORT || 3000;

// Prevent browser from caching old HTML/JS
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});

app.use(express.json());

app.use(express.static(path.join(__dirname, 'public'), {
  etag: false,
  lastModified: false,
  maxAge: 0,
  setHeaders: (res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
  }
}));

// Helper to normalize Unique IDs (e.g. "849-210" -> "849210")
function normalizeId(id) {
  if (!id) return '';
  return String(id).replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
}

// ==========================================
// PERSISTENT USER & FRIENDS DATA STORE
// ==========================================
const USERS_FILE = path.join(__dirname, 'users.json');

function loadUsersData() {
  try {
    if (fs.existsSync(USERS_FILE)) {
      const raw = fs.readFileSync(USERS_FILE, 'utf-8');
      return JSON.parse(raw);
    }
  } catch (err) {
    console.error('Error loading users.json:', err);
  }
  return [];
}

let usersStore = loadUsersData(); // Array of user objects

function saveUsersData() {
  try {
    fs.writeFileSync(USERS_FILE, JSON.stringify(usersStore, null, 2), 'utf-8');
  } catch (err) {
    console.error('Error saving users.json:', err);
  }
}

function generateUniqueCallerId() {
  for (let attempts = 0; attempts < 1000; attempts++) {
    const n1 = Math.floor(100 + Math.random() * 900);
    const n2 = Math.floor(100 + Math.random() * 900);
    const candidate = `${n1}-${n2}`;
    const norm = normalizeId(candidate);
    if (!usersStore.some(u => u.normCallerId === norm)) {
      return candidate;
    }
  }
  return `${Math.floor(100 + Math.random() * 900)}-${Math.floor(100 + Math.random() * 900)}`;
}

function findUserByEmail(email) {
  if (!email) return null;
  const clean = email.trim().toLowerCase();
  return usersStore.find(u => u.email && u.email.toLowerCase() === clean) || null;
}

function findUserByNormId(normId) {
  if (!normId) return null;
  const target = normalizeId(normId);
  return usersStore.find(u => u.normCallerId === target) || null;
}

function findUserByQuery(query) {
  if (!query) return null;
  const clean = query.trim().toLowerCase();
  const byEmail = usersStore.find(u => u.email && u.email.toLowerCase() === clean);
  if (byEmail) return byEmail;
  const norm = normalizeId(query);
  return usersStore.find(u => u.normCallerId === norm) || null;
}

function sanitizeUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    callerId: user.callerId,
    normCallerId: user.normCallerId,
    name: user.name,
    email: user.email,
    avatar: user.avatar,
    authProvider: user.authProvider || 'email',
    friends: user.friends || [],
    pendingSent: user.pendingSent || [],
    pendingReceived: user.pendingReceived || []
  };
}

function getPopulatedFriendsData(normCallerId) {
  const user = findUserByNormId(normCallerId);
  if (!user) {
    return { friends: [], pendingReceived: [], pendingSent: [] };
  }

  const friendsList = (user.friends || []).map(fNormId => {
    const fUser = findUserByNormId(fNormId);
    const isOnline = connectedUsers.has(fNormId);
    const connectedObj = connectedUsers.get(fNormId);
    return {
      callerId: fUser ? fUser.callerId : fNormId,
      normCallerId: fNormId,
      name: fUser ? fUser.name : `User #${fNormId}`,
      email: fUser ? fUser.email : '',
      avatar: fUser ? fUser.avatar : '',
      isOnline,
      inCall: Boolean(connectedObj && connectedObj.activeCallId)
    };
  });

  const pendingReceivedList = (user.pendingReceived || []).map(rNormId => {
    const rUser = findUserByNormId(rNormId);
    return {
      callerId: rUser ? rUser.callerId : rNormId,
      normCallerId: rNormId,
      name: rUser ? rUser.name : `User #${rNormId}`,
      email: rUser ? rUser.email : '',
      avatar: rUser ? rUser.avatar : ''
    };
  });

  const pendingSentList = (user.pendingSent || []).map(sNormId => {
    const sUser = findUserByNormId(sNormId);
    return {
      callerId: sUser ? sUser.callerId : sNormId,
      normCallerId: sNormId,
      name: sUser ? sUser.name : `User #${sNormId}`,
      email: sUser ? sUser.email : '',
      avatar: sUser ? sUser.avatar : ''
    };
  });

  return {
    friends: friendsList,
    pendingReceived: pendingReceivedList,
    pendingSent: pendingSentList
  };
}

// ==========================================
// AUTHENTICATION & USERS REST APIS
// ==========================================

// 1. Email Register
app.post('/api/auth/register', (req, res) => {
  const { name, email, password } = req.body || {};
  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Valid email address is required' });
  }
  if (!password || password.length < 4) {
    return res.status(400).json({ error: 'Password must be at least 4 characters' });
  }

  const cleanEmail = email.trim().toLowerCase();
  const existing = findUserByEmail(cleanEmail);
  if (existing) {
    return res.status(400).json({ error: 'An account with this email already exists. Please login.' });
  }

  const callerId = generateUniqueCallerId();
  const normCallerId = normalizeId(callerId);
  const displayName = (name || '').trim() || cleanEmail.split('@')[0];

  const newUser = {
    id: `u_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    callerId,
    normCallerId,
    name: displayName,
    email: cleanEmail,
    password: password,
    avatar: `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(displayName)}`,
    authProvider: 'email',
    friends: [],
    pendingSent: [],
    pendingReceived: [],
    createdAt: new Date().toISOString()
  };

  usersStore.push(newUser);
  saveUsersData();

  console.log(`[Auth Register] User registered: ${newUser.name} (${newUser.email}) -> ID #${newUser.callerId}`);
  return res.json({ success: true, user: sanitizeUser(newUser) });
});

// 2. Email Login
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const cleanEmail = email.trim().toLowerCase();
  const user = findUserByEmail(cleanEmail);
  if (!user) {
    return res.status(400).json({ error: 'No account found with this email. Please create an account.' });
  }

  if (user.password && user.password !== password) {
    return res.status(400).json({ error: 'Incorrect password. Please try again.' });
  }

  console.log(`[Auth Login] User logged in: ${user.name} (${user.email}) -> ID #${user.callerId}`);
  return res.json({ success: true, user: sanitizeUser(user) });
});

// 3. Google Sign-In / Login
app.post('/api/auth/google', (req, res) => {
  const { email, name, picture, googleId } = req.body || {};
  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Valid Google email is required' });
  }

  const cleanEmail = email.trim().toLowerCase();
  let user = findUserByEmail(cleanEmail);

  if (user) {
    // Existing user logging in with Google
    if (picture) user.avatar = picture;
    if (name && (!user.name || user.name === 'User')) user.name = name;
    user.authProvider = 'google';
    saveUsersData();
    console.log(`[Google Auth] Existing user logged in: ${user.name} (${user.email}) -> ID #${user.callerId}`);
    return res.json({ success: true, user: sanitizeUser(user) });
  }

  // Create new user via Google
  const callerId = generateUniqueCallerId();
  const normCallerId = normalizeId(callerId);
  const displayName = (name || '').trim() || cleanEmail.split('@')[0];

  user = {
    id: `u_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    callerId,
    normCallerId,
    name: displayName,
    email: cleanEmail,
    password: '',
    avatar: picture || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(displayName)}`,
    authProvider: 'google',
    friends: [],
    pendingSent: [],
    pendingReceived: [],
    createdAt: new Date().toISOString()
  };

  usersStore.push(user);
  saveUsersData();

  console.log(`[Google Auth] New user registered via Google: ${user.name} (${user.email}) -> ID #${user.callerId}`);
  return res.json({ success: true, user: sanitizeUser(user) });
});

// 4. Get Friends & Requests Data
app.get('/api/user/friends-data/:normCallerId', (req, res) => {
  const data = getPopulatedFriendsData(req.params.normCallerId);
  return res.json(data);
});

// 5. Search User for Friend Request
app.get('/api/user/search', (req, res) => {
  const query = req.query.q;
  const requesterNormId = normalizeId(req.query.requesterId);
  if (!query) return res.json({ user: null });

  const target = findUserByQuery(query);
  if (!target) return res.json({ user: null });

  const requester = findUserByNormId(requesterNormId);
  let relation = 'none'; // 'none' | 'self' | 'friends' | 'pending_sent' | 'pending_received'

  if (target.normCallerId === requesterNormId) {
    relation = 'self';
  } else if (requester && requester.friends.includes(target.normCallerId)) {
    relation = 'friends';
  } else if (requester && requester.pendingSent.includes(target.normCallerId)) {
    relation = 'pending_sent';
  } else if (requester && requester.pendingReceived.includes(target.normCallerId)) {
    relation = 'pending_received';
  }

  return res.json({
    user: {
      callerId: target.callerId,
      normCallerId: target.normCallerId,
      name: target.name,
      email: target.email,
      avatar: target.avatar,
      isOnline: connectedUsers.has(target.normCallerId)
    },
    relation
  });
});

// In-Memory state management for Active WebRTC Calls
// connectedUsers: normalizedId -> { socketId, uniqueId, displayId, name, email, avatar, activeCallId, currentCallType, inExternalCall }
const connectedUsers = new Map();

// socketToUserId: socketId -> normalizedId
const socketToUserId = new Map();

// activeCalls: callId -> { callId, initiatorId, participants: Set<normalizedId>, callType, status }
const activeCalls = new Map();

// pendingCallTimeouts: callId -> timeoutHandle (35s timeout before UNAVAILABLE)
const pendingCallTimeouts = new Map();

io.on('connection', (socket) => {
  console.log(`[Socket Connected] ID: ${socket.id}`);

  // 1. User Registration by Unique ID / Account
  socket.on('register-user', ({ uniqueId, email, name, avatar }) => {
    if (!uniqueId) return;

    const normId = normalizeId(uniqueId);
    const existing = connectedUsers.get(normId) || {};
    const userInDb = findUserByNormId(normId);

    // Join room for this normalized unique ID
    socket.join(normId);

    connectedUsers.set(normId, {
      socketId: socket.id,
      uniqueId: normId,
      displayId: userInDb ? userInDb.callerId : uniqueId,
      name: userInDb ? userInDb.name : (name || 'User'),
      email: userInDb ? userInDb.email : (email || ''),
      avatar: userInDb ? userInDb.avatar : (avatar || ''),
      activeCallId: existing.activeCallId || null,
      inExternalCall: false
    });
    socketToUserId.set(socket.id, normId);

    console.log(`[User Registered] ID: #${uniqueId} (${userInDb?.name || name || 'User'}) on socket ${socket.id}`);

    // Confirm registration to caller
    socket.emit('registered-success', {
      uniqueId: normId,
      displayId: userInDb ? userInDb.callerId : uniqueId,
      user: sanitizeUser(userInDb)
    });

    // Send initial friends data to user
    socket.emit('friends-data-updated', getPopulatedFriendsData(normId));

    // Notify user's friends that they are now online
    broadcastFriendsStatusUpdate(normId);
    broadcastOnlineUsers();
  });

  // 2. Fetch list of users
  socket.on('get-users', () => {
    emitOnlineUsersTo(socket);
  });

  // 3. FRIENDS: Send Friend Request
  socket.on('send-friend-request', ({ targetQuery }) => {
    const senderNormId = socketToUserId.get(socket.id);
    const sender = findUserByNormId(senderNormId);

    if (!sender) {
      socket.emit('friend-request-error', { message: 'You must be logged in to send a friend request.' });
      return;
    }

    const target = findUserByQuery(targetQuery);
    if (!target) {
      socket.emit('friend-request-error', { message: `No registered user found with "${targetQuery}". They must create an account first!` });
      return;
    }

    if (target.normCallerId === senderNormId) {
      socket.emit('friend-request-error', { message: 'You cannot send a friend request to yourself.' });
      return;
    }

    if (sender.friends.includes(target.normCallerId)) {
      socket.emit('friend-request-error', { message: `${target.name} is already in your friends list!` });
      return;
    }

    if (sender.pendingSent.includes(target.normCallerId)) {
      socket.emit('friend-request-error', { message: `Friend request already sent to ${target.name}. Awaiting acceptance.` });
      return;
    }

    // If target already sent a request to sender, auto-accept it!
    if (sender.pendingReceived.includes(target.normCallerId)) {
      sender.friends.push(target.normCallerId);
      target.friends.push(sender.normCallerId);
      sender.pendingReceived = sender.pendingReceived.filter(id => id !== target.normCallerId);
      target.pendingSent = target.pendingSent.filter(id => id !== sender.normCallerId);
      saveUsersData();

      socket.emit('friend-request-accepted-notice', {
        message: `You and ${target.name} are now friends! You can now call each other.`,
        friend: sanitizeUser(target)
      });
      io.to(target.normCallerId).emit('friend-request-accepted-notice', {
        message: `${sender.name} accepted your friend request! You can now call each other.`,
        friend: sanitizeUser(sender)
      });

      socket.emit('friends-data-updated', getPopulatedFriendsData(senderNormId));
      io.to(target.normCallerId).emit('friends-data-updated', getPopulatedFriendsData(target.normCallerId));
      return;
    }

    // Normal Request Send
    sender.pendingSent.push(target.normCallerId);
    target.pendingReceived.push(sender.normCallerId);
    saveUsersData();

    socket.emit('friend-request-sent-success', {
      message: `Friend request sent to ${target.name} (${target.email || target.callerId})!`,
      target: sanitizeUser(target)
    });

    // Notify target in real-time if online
    io.to(target.normCallerId).emit('incoming-friend-request', {
      sender: {
        callerId: sender.callerId,
        normCallerId: sender.normCallerId,
        name: sender.name,
        email: sender.email,
        avatar: sender.avatar
      }
    });

    // Refresh friends data for both
    socket.emit('friends-data-updated', getPopulatedFriendsData(senderNormId));
    io.to(target.normCallerId).emit('friends-data-updated', getPopulatedFriendsData(target.normCallerId));
  });

  // 4. FRIENDS: Accept Friend Request
  socket.on('accept-friend-request', ({ senderNormId }) => {
    const receiverNormId = socketToUserId.get(socket.id);
    const receiver = findUserByNormId(receiverNormId);
    const sender = findUserByNormId(senderNormId);

    if (!receiver || !sender) return;

    if (!receiver.friends.includes(senderNormId)) {
      receiver.friends.push(senderNormId);
    }
    if (!sender.friends.includes(receiverNormId)) {
      sender.friends.push(receiverNormId);
    }

    receiver.pendingReceived = receiver.pendingReceived.filter(id => id !== senderNormId);
    sender.pendingSent = sender.pendingSent.filter(id => id !== receiverNormId);
    saveUsersData();

    console.log(`[Friendship Created] ${receiver.name} and ${sender.name} are now friends!`);

    socket.emit('friend-request-accepted-notice', {
      message: `You and ${sender.name} are now friends! You can now call each other.`,
      friend: sanitizeUser(sender)
    });
    io.to(senderNormId).emit('friend-request-accepted-notice', {
      message: `${receiver.name} accepted your friend request! You can now call each other.`,
      friend: sanitizeUser(receiver)
    });

    socket.emit('friends-data-updated', getPopulatedFriendsData(receiverNormId));
    io.to(senderNormId).emit('friends-data-updated', getPopulatedFriendsData(senderNormId));
  });

  // 5. FRIENDS: Reject Friend Request
  socket.on('reject-friend-request', ({ senderNormId }) => {
    const receiverNormId = socketToUserId.get(socket.id);
    const receiver = findUserByNormId(receiverNormId);
    const sender = findUserByNormId(senderNormId);

    if (!receiver) return;

    receiver.pendingReceived = receiver.pendingReceived.filter(id => id !== senderNormId);
    if (sender) {
      sender.pendingSent = sender.pendingSent.filter(id => id !== receiverNormId);
    }
    saveUsersData();

    socket.emit('friends-data-updated', getPopulatedFriendsData(receiverNormId));
    if (sender) {
      io.to(senderNormId).emit('friends-data-updated', getPopulatedFriendsData(senderNormId));
    }
  });

  // 6. FRIENDS: Cancel Sent Request
  socket.on('cancel-friend-request', ({ targetNormId }) => {
    const senderNormId = socketToUserId.get(socket.id);
    const sender = findUserByNormId(senderNormId);
    const target = findUserByNormId(targetNormId);

    if (!sender) return;

    sender.pendingSent = sender.pendingSent.filter(id => id !== targetNormId);
    if (target) {
      target.pendingReceived = target.pendingReceived.filter(id => id !== senderNormId);
    }
    saveUsersData();

    socket.emit('friends-data-updated', getPopulatedFriendsData(senderNormId));
    if (target) {
      io.to(targetNormId).emit('friends-data-updated', getPopulatedFriendsData(targetNormId));
    }
  });

  // 7. FRIENDS: Remove Friend
  socket.on('remove-friend', ({ friendNormId }) => {
    const userNormId = socketToUserId.get(socket.id);
    const user = findUserByNormId(userNormId);
    const friend = findUserByNormId(friendNormId);

    if (!user) return;

    user.friends = user.friends.filter(id => id !== friendNormId);
    if (friend) {
      friend.friends = friend.friends.filter(id => id !== userNormId);
    }
    saveUsersData();

    socket.emit('friends-data-updated', getPopulatedFriendsData(userNormId));
    if (friend) {
      io.to(friendNormId).emit('friends-data-updated', getPopulatedFriendsData(friendNormId));
    }
  });

  // 8. FRIENDS: Get Fresh Data
  socket.on('get-friends-data', () => {
    const userNormId = socketToUserId.get(socket.id);
    if (userNormId) {
      socket.emit('friends-data-updated', getPopulatedFriendsData(userNormId));
    }
  });

  // ==========================================
  // WEBRTC CALLING ENGINE (PROTECTED: FRIENDS ONLY)
  // ==========================================
  socket.on('initiate-call', ({ targetId, callType = 'video' }) => {
    const callerId = socketToUserId.get(socket.id);
    const caller = connectedUsers.get(callerId);

    if (!caller) {
      socket.emit('call-error', { message: 'You must be registered/logged in to make a call.' });
      return;
    }

    const normTargetId = normalizeId(targetId);
    const callerUser = findUserByNormId(callerId);
    const targetUser = findUserByNormId(normTargetId);

    if (callerId === normTargetId) {
      socket.emit('call-error', { message: 'You cannot call your own ID! Enter the ID of another user.' });
      return;
    }

    // 🔒 CORE ENFORCEMENT: Only accepted friends can call each other!
    const isFriend = callerUser && callerUser.friends && callerUser.friends.includes(normTargetId);
    if (!isFriend) {
      console.log(`[Call Blocked] Caller #${caller.displayId} is NOT friends with target #${targetId}`);
      socket.emit('call-failed', {
        targetId,
        reason: 'NOT_FRIENDS',
        message: `You can only call accepted friends! Send a friend request to ${targetUser ? targetUser.name : targetId} first.`,
        targetUser: targetUser ? {
          name: targetUser.name,
          email: targetUser.email,
          callerId: targetUser.callerId,
          normCallerId: targetUser.normCallerId
        } : null
      });
      return;
    }

    const receiver = connectedUsers.get(normTargetId);

    // Check whether receiver is online and reachable
    if (!receiver || !receiver.socketId) {
      console.log(`[Call Attempt] Target Friend ID "${targetId}" is offline -> UNAVAILABLE`);
      socket.emit('call-failed', {
        targetId,
        reason: 'UNAVAILABLE',
        message: `${targetUser ? targetUser.name : targetId} is currently offline. They will receive your call when online.`
      });
      return;
    }

    const callId = `call_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const isReceiverAlreadyInCall = Boolean(receiver.activeCallId);

    console.log(
      `[Call Initiated] Friend Call: #${caller.displayId} (${callerUser?.name}) -> #${receiver.displayId} (${targetUser?.name}) [${callType.toUpperCase()}]` +
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
      targetName: targetUser?.name || receiver.displayId,
      targetEmail: targetUser?.email || '',
      targetAvatar: targetUser?.avatar || '',
      status: 'RINGING',
      callType,
      receiverHasExistingCall: isReceiverAlreadyInCall
    });

    // Send incoming-call notification to receiver room (Call Waiting HUD)
    const incomingPayload = {
      callId,
      callerId: caller.displayId,
      callerNormId: callerId,
      callerName: callerUser?.name || caller.displayId,
      callerEmail: callerUser?.email || '',
      callerAvatar: callerUser?.avatar || '',
      callType,
      isCallWaiting: isReceiverAlreadyInCall,
      currentCallId: receiver.activeCallId
    };

    io.to(normTargetId).emit('incoming-call', incomingPayload);

    // 35-second timeout for UNAVAILABLE
    const timeoutHandle = setTimeout(() => {
      const call = activeCalls.get(callId);
      if (call && call.status === 'pending') {
        console.log(`[Call Timeout] Call ${callId} timed out -> UNAVAILABLE`);
        activeCalls.delete(callId);
        pendingCallTimeouts.delete(callId);

        // Notify caller
        io.to(callerId).emit('call-failed', {
          callId,
          targetId: receiver.displayId,
          reason: 'UNAVAILABLE',
          message: 'No response. Call timed out (UNAVAILABLE).'
        });
        if (caller.socketId) {
          io.to(caller.socketId).emit('call-failed', {
            callId,
            targetId: receiver.displayId,
            reason: 'UNAVAILABLE',
            message: 'No response. Call timed out (UNAVAILABLE).'
          });
        }

        // Notify receiver to dismiss dialog
        io.to(normTargetId).emit('call-missed', {
          callId,
          callerId: caller.displayId
        });
      }
    }, 35000);

    pendingCallTimeouts.set(callId, timeoutHandle);
  });

  // Accept Call
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
          return { userId: id, displayId: u?.displayId || id, name: u?.name || id };
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
        broadcastFriendsStatusUpdate(receiverId);
        broadcastFriendsStatusUpdate(callerId);
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
      { userId: callerId, displayId: caller?.displayId, name: caller?.name },
      { userId: receiverId, displayId: receiver.displayId, name: receiver.name }
    ];

    io.to(callerId).emit('call-accepted', {
      callId,
      peerId: receiverId,
      peerDisplayId: receiver.displayId,
      callType: pendingCall.callType,
      mode: 'direct',
      participants: participantList
    });

    socket.emit('call-connected', {
      callId,
      peerId: callerId,
      peerDisplayId: caller?.displayId,
      callType: pendingCall.callType,
      participants: participantList
    });

    broadcastOnlineUsers();
    broadcastFriendsStatusUpdate(receiverId);
    broadcastFriendsStatusUpdate(callerId);
  });

  // Reject Call
  socket.on('reject-call', ({ callId }) => {
    clearCallTimeout(callId);
    const call = activeCalls.get(callId);
    if (!call) return;

    activeCalls.delete(callId);
    console.log(`[Call Rejected] Call ${callId} declined by receiver`);

    const rejectPayload = {
      callId,
      reason: 'DECLINED',
      message: 'Receiver declined the call'
    };

    io.to(call.initiatorId).emit('call-rejected', rejectPayload);
  });

  // WebRTC Signaling Relays
  socket.on('webrtc-offer', ({ targetUserId, offer, callId }) => {
    const fromUserId = socketToUserId.get(socket.id);
    const normTarget = normalizeId(targetUserId);
    io.to(normTarget).emit('webrtc-offer', { fromUserId, offer, callId });
  });

  socket.on('webrtc-answer', ({ targetUserId, answer, callId }) => {
    const fromUserId = socketToUserId.get(socket.id);
    const normTarget = normalizeId(targetUserId);
    io.to(normTarget).emit('webrtc-answer', { fromUserId, answer, callId });
  });

  socket.on('ice-candidate', ({ targetUserId, candidate, callId }) => {
    const fromUserId = socketToUserId.get(socket.id);
    const normTarget = normalizeId(targetUserId);
    io.to(normTarget).emit('ice-candidate', { fromUserId, candidate, callId });
  });

  // Relay Mute / Camera state
  socket.on('peer-media-state', ({ isAudioMuted, isVideoMuted }) => {
    const fromUserId = socketToUserId.get(socket.id);
    const user = connectedUsers.get(fromUserId);
    if (!user || !user.activeCallId) return;

    const call = activeCalls.get(user.activeCallId);
    if (call) {
      call.participants.forEach(pid => {
        if (pid !== fromUserId) {
          const peer = connectedUsers.get(pid);
          const payload = {
            userId: fromUserId,
            displayId: user.displayId,
            isAudioMuted,
            isVideoMuted
          };
          io.to(pid).emit('peer-media-state-updated', payload);
          if (peer?.socketId) {
            io.to(peer.socketId).emit('peer-media-state-updated', payload);
          }
        }
      });
    }
  });

  // External Interruption
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
            const payload = {
              callId: user.activeCallId,
              userId,
              displayId: user.displayId,
              isHeld: isInterrupted,
              reason: reason || 'External app has audio focus'
            };
            io.to(pid).emit('peer-hold-state', payload);
            if (peer?.socketId) {
              io.to(peer.socketId).emit('peer-hold-state', payload);
            }
          }
        });
      }
    }

    broadcastOnlineUsers();
  });

  // End Call
  socket.on('end-call', ({ callId }) => {
    endCallSession(callId, socketToUserId.get(socket.id));
  });

  // Disconnect
  socket.on('disconnect', (reason) => {
    const userId = socketToUserId.get(socket.id);
    socketToUserId.delete(socket.id);
    if (!userId) return;

    console.log(`[Socket Disconnected] Socket ${socket.id} for ID #${userId}. Reason: ${reason}`);

    const user = connectedUsers.get(userId);
    if (user && user.socketId === socket.id) {
      const room = io.sockets.adapter.rooms.get(userId);
      if (!room || room.size === 0) {
        console.log(`[User Offline] ID #${user.displayId || userId} has left.`);
        if (user.activeCallId) {
          endCallSession(user.activeCallId, userId);
        }
        connectedUsers.delete(userId);
        broadcastOnlineUsers();
        broadcastFriendsStatusUpdate(userId);
      } else {
        const activeSockets = Array.from(room);
        if (activeSockets.length > 0) {
          user.socketId = activeSockets[0];
          socketToUserId.set(user.socketId, userId);
        }
      }
    }
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
    io.to(pid).emit('call-ended', {
      callId,
      endedBy: endedByUserId
    });
    broadcastFriendsStatusUpdate(pid);
  });

  activeCalls.delete(callId);
  broadcastOnlineUsers();
}

function broadcastFriendsStatusUpdate(userNormId) {
  const user = findUserByNormId(userNormId);
  if (!user || !user.friends) return;

  user.friends.forEach(friendNormId => {
    if (connectedUsers.has(friendNormId)) {
      io.to(friendNormId).emit('friends-data-updated', getPopulatedFriendsData(friendNormId));
    }
  });
}

function broadcastOnlineUsers() {
  const users = Array.from(connectedUsers.values()).map(u => ({
    userId: u.uniqueId,
    displayId: u.displayId,
    name: u.name,
    email: u.email,
    avatar: u.avatar,
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
    name: u.name,
    email: u.email,
    avatar: u.avatar,
    inCall: Boolean(u.activeCallId),
    activeCallId: u.activeCallId,
    inExternalCall: u.inExternalCall
  }));
  socket.emit('online-users-updated', users);
}

server.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`🚀 CallPulse Server: Email & Google Login + Friends Calling`);
  console.log(`📍 URL: http://localhost:${PORT}`);
  console.log(`====================================================`);
});

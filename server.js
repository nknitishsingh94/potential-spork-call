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

// Clean Username helper (e.g. "@Nitish_1" -> "nitish_1")
function cleanUsername(str) {
  if (!str) return '';
  return String(str).trim().toLowerCase().replace(/^@+/, '').replace(/[^a-z0-9_.-]/g, '');
}

// ==========================================
// PERSISTENT USER & FRIENDS DATA STORE (SNAPCHAT-STYLE)
// ==========================================
const USERS_FILE = path.join(__dirname, 'users.json');

function loadUsersData() {
  try {
    if (fs.existsSync(USERS_FILE)) {
      const raw = fs.readFileSync(USERS_FILE, 'utf-8');
      const list = JSON.parse(raw);
      // Migrate any legacy users to username format
      return list.map(u => {
        const uName = cleanUsername(u.username || (u.email ? u.email.split('@')[0] : u.name || 'user_' + Math.floor(Math.random() * 900)));
        return {
          id: u.id || `u_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          username: uName,
          name: u.name || uName,
          email: u.email || '',
          password: u.password || '',
          avatar: u.avatar || `https://api.dicebear.com/7.x/adventurer/svg?seed=${encodeURIComponent(uName)}`,
          authProvider: u.authProvider || 'email',
          friends: Array.isArray(u.friends) ? u.friends.map(f => cleanUsername(f)) : [],
          pendingSent: Array.isArray(u.pendingSent) ? u.pendingSent.map(f => cleanUsername(f)) : [],
          pendingReceived: Array.isArray(u.pendingReceived) ? u.pendingReceived.map(f => cleanUsername(f)) : [],
          createdAt: u.createdAt || new Date().toISOString()
        };
      });
    }
  } catch (err) {
    console.error('Error loading users.json:', err);
  }
  return [];
}

let usersStore = loadUsersData();

function saveUsersData() {
  try {
    fs.writeFileSync(USERS_FILE, JSON.stringify(usersStore, null, 2), 'utf-8');
  } catch (err) {
    console.error('Error saving users.json:', err);
  }
}

function findUserByUsername(uname) {
  if (!uname) return null;
  const target = cleanUsername(uname);
  return usersStore.find(u => u.username === target) || null;
}

function findUserByEmail(email) {
  if (!email) return null;
  const clean = email.trim().toLowerCase();
  return usersStore.find(u => u.email && u.email.toLowerCase() === clean) || null;
}

function findUserByQuery(query) {
  if (!query) return null;
  const clean = query.trim().toLowerCase().replace(/^@+/, '');
  const byUsername = usersStore.find(u => u.username === clean);
  if (byUsername) return byUsername;
  const byEmail = usersStore.find(u => u.email && u.email.toLowerCase() === clean);
  if (byEmail) return byEmail;
  return usersStore.find(u => u.name && u.name.toLowerCase() === clean) || null;
}

function generateUniqueUsername(preferred) {
  let base = cleanUsername(preferred) || 'user';
  if (base.length < 3) base = 'user_' + base;
  let candidate = base;
  let counter = 1;
  while (usersStore.some(u => u.username === candidate)) {
    candidate = `${base}_${Math.floor(10 + Math.random() * 89)}`;
    counter++;
    if (counter > 200) {
      candidate = `${base}_${Date.now().toString().slice(-4)}`;
      break;
    }
  }
  return candidate;
}

function sanitizeUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    name: user.name,
    email: user.email,
    avatar: user.avatar,
    authProvider: user.authProvider || 'email',
    friends: user.friends || [],
    pendingSent: user.pendingSent || [],
    pendingReceived: user.pendingReceived || []
  };
}

function getPopulatedFriendsData(username) {
  const user = findUserByUsername(username);
  if (!user) {
    return { friends: [], pendingReceived: [], pendingSent: [] };
  }

  const friendsList = (user.friends || []).map(fUname => {
    const fUser = findUserByUsername(fUname);
    const isOnline = connectedUsers.has(fUname);
    const connectedObj = connectedUsers.get(fUname);
    return {
      username: fUname,
      name: fUser ? fUser.name : `@${fUname}`,
      email: fUser ? fUser.email : '',
      avatar: fUser ? fUser.avatar : `https://api.dicebear.com/7.x/adventurer/svg?seed=${fUname}`,
      isOnline,
      inCall: Boolean(connectedObj && connectedObj.activeCallId)
    };
  });

  const pendingReceivedList = (user.pendingReceived || []).map(rUname => {
    const rUser = findUserByUsername(rUname);
    return {
      username: rUname,
      name: rUser ? rUser.name : `@${rUname}`,
      email: rUser ? rUser.email : '',
      avatar: rUser ? rUser.avatar : `https://api.dicebear.com/7.x/adventurer/svg?seed=${rUname}`
    };
  });

  const pendingSentList = (user.pendingSent || []).map(sUname => {
    const sUser = findUserByUsername(sUname);
    return {
      username: sUname,
      name: sUser ? sUser.name : `@${sUname}`,
      email: sUser ? sUser.email : '',
      avatar: sUser ? sUser.avatar : `https://api.dicebear.com/7.x/adventurer/svg?seed=${sUname}`
    };
  });

  return {
    friends: friendsList,
    pendingReceived: pendingReceivedList,
    pendingSent: pendingSentList
  };
}

// ==========================================
// REST APIS (EMAIL & GOOGLE AUTHENTICATION)
// ==========================================

// 1. Email Register
app.post('/api/auth/register', (req, res) => {
  const { name, email, username, password } = req.body || {};
  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Valid email address is required' });
  }
  if (!password || password.length < 4) {
    return res.status(400).json({ error: 'Password must be at least 4 characters' });
  }

  const cleanEmail = email.trim().toLowerCase();
  if (findUserByEmail(cleanEmail)) {
    return res.status(400).json({ error: 'An account with this email already exists. Please sign in.' });
  }

  const desiredUsername = cleanUsername(username || cleanEmail.split('@')[0]);
  if (findUserByUsername(desiredUsername)) {
    return res.status(400).json({ error: `@${desiredUsername} is already taken. Please choose another username.` });
  }

  const finalUsername = generateUniqueUsername(desiredUsername);
  const displayName = (name || '').trim() || finalUsername;

  const newUser = {
    id: `u_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    username: finalUsername,
    name: displayName,
    email: cleanEmail,
    password: password,
    avatar: `https://api.dicebear.com/7.x/adventurer/svg?seed=${encodeURIComponent(finalUsername)}`,
    authProvider: 'email',
    friends: [],
    pendingSent: [],
    pendingReceived: [],
    createdAt: new Date().toISOString()
  };

  usersStore.push(newUser);
  saveUsersData();

  console.log(`[SnapCall Register] User registered: ${newUser.name} (@${newUser.username})`);
  return res.json({ success: true, user: sanitizeUser(newUser) });
});

// 2. Email / Username Login
app.post('/api/auth/login', (req, res) => {
  const { emailOrUsername, password } = req.body || {};
  if (!emailOrUsername || !password) {
    return res.status(400).json({ error: 'Username or Email and password are required' });
  }

  const clean = emailOrUsername.trim().toLowerCase().replace(/^@+/, '');
  const user = findUserByEmail(clean) || findUserByUsername(clean);
  if (!user) {
    return res.status(400).json({ error: 'No account found with this email or @username.' });
  }

  if (user.password && user.password !== password) {
    return res.status(400).json({ error: 'Incorrect password. Please try again.' });
  }

  console.log(`[SnapCall Login] Logged in: ${user.name} (@${user.username})`);
  return res.json({ success: true, user: sanitizeUser(user) });
});

// 3. Google Sign-In
app.post('/api/auth/google', (req, res) => {
  const { email, name, picture, username } = req.body || {};
  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Valid Google email is required' });
  }

  const cleanEmail = email.trim().toLowerCase();
  let user = findUserByEmail(cleanEmail);

  if (user) {
    if (picture) user.avatar = picture;
    if (name && (!user.name || user.name === 'User')) user.name = name;
    user.authProvider = 'google';
    saveUsersData();
    console.log(`[Google Auth] Logged in existing user: ${user.name} (@${user.username})`);
    return res.json({ success: true, user: sanitizeUser(user) });
  }

  const baseUname = cleanUsername(username || cleanEmail.split('@')[0]);
  const finalUsername = generateUniqueUsername(baseUname);
  const displayName = (name || '').trim() || finalUsername;

  user = {
    id: `u_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    username: finalUsername,
    name: displayName,
    email: cleanEmail,
    password: '',
    avatar: picture || `https://api.dicebear.com/7.x/adventurer/svg?seed=${encodeURIComponent(finalUsername)}`,
    authProvider: 'google',
    friends: [],
    pendingSent: [],
    pendingReceived: [],
    createdAt: new Date().toISOString()
  };

  usersStore.push(user);
  saveUsersData();

  console.log(`[Google Auth] New user registered via Google: ${user.name} (@${user.username})`);
  return res.json({ success: true, user: sanitizeUser(user) });
});

// 4. Get Friends Data
app.get('/api/user/friends-data/:username', (req, res) => {
  const data = getPopulatedFriendsData(cleanUsername(req.params.username));
  return res.json(data);
});

// 5. Search User by Username, Name, or Email
app.get('/api/user/search', (req, res) => {
  const query = req.query.q;
  const requesterUsername = cleanUsername(req.query.requester);
  if (!query) return res.json({ user: null });

  const target = findUserByQuery(query);
  if (!target) return res.json({ user: null });

  const requester = findUserByUsername(requesterUsername);
  let relation = 'none';

  if (target.username === requesterUsername) {
    relation = 'self';
  } else if (requester && requester.friends.includes(target.username)) {
    relation = 'friends';
  } else if (requester && requester.pendingSent.includes(target.username)) {
    relation = 'pending_sent';
  } else if (requester && requester.pendingReceived.includes(target.username)) {
    relation = 'pending_received';
  }

  return res.json({
    user: {
      username: target.username,
      name: target.name,
      email: target.email,
      avatar: target.avatar,
      isOnline: connectedUsers.has(target.username)
    },
    relation
  });
});

// In-Memory state management for Active WebRTC Calls
// connectedUsers: username -> { socketId, username, name, email, avatar, activeCallId, currentCallType, inExternalCall }
const connectedUsers = new Map();

// socketToUser: socketId -> username
const socketToUser = new Map();

// activeCalls: callId -> { callId, initiatorUsername, participants: Set<username>, callType, status }
const activeCalls = new Map();

// pendingCallTimeouts: callId -> timeoutHandle (35s timeout before UNAVAILABLE)
const pendingCallTimeouts = new Map();

io.on('connection', (socket) => {
  console.log(`[Socket Connected] ID: ${socket.id}`);

  // 1. Register User Socket
  socket.on('register-user', ({ username, name, email, avatar }) => {
    if (!username) return;

    const uName = cleanUsername(username);
    const existing = connectedUsers.get(uName) || {};
    const userInDb = findUserByUsername(uName);

    // Join room for this username
    socket.join(`user:${uName}`);

    connectedUsers.set(uName, {
      socketId: socket.id,
      username: uName,
      name: userInDb ? userInDb.name : (name || uName),
      email: userInDb ? userInDb.email : (email || ''),
      avatar: userInDb ? userInDb.avatar : (avatar || ''),
      activeCallId: existing.activeCallId || null,
      inExternalCall: false
    });
    socketToUser.set(socket.id, uName);

    console.log(`[User Active] @${uName} (${userInDb?.name || name}) on socket ${socket.id}`);

    socket.emit('registered-success', {
      user: sanitizeUser(userInDb)
    });

    socket.emit('friends-data-updated', getPopulatedFriendsData(uName));
    broadcastFriendsStatusUpdate(uName);
    broadcastOnlineUsers();
  });

  // 2. Fetch list of users
  socket.on('get-users', () => {
    emitOnlineUsersTo(socket);
  });

  // 3. FRIENDS: Send Friend Request
  socket.on('send-friend-request', ({ targetQuery }) => {
    const senderUsername = socketToUser.get(socket.id);
    const sender = findUserByUsername(senderUsername);

    if (!sender) {
      socket.emit('friend-request-error', { message: 'You must be signed in to add friends.' });
      return;
    }

    const target = findUserByQuery(targetQuery);
    if (!target) {
      socket.emit('friend-request-error', { message: `No user found with "${targetQuery}". Make sure they have a SnapCall account!` });
      return;
    }

    if (target.username === senderUsername) {
      socket.emit('friend-request-error', { message: 'You cannot add yourself as a friend.' });
      return;
    }

    if (sender.friends.includes(target.username)) {
      socket.emit('friend-request-error', { message: `@${target.username} is already on your friends list!` });
      return;
    }

    if (sender.pendingSent.includes(target.username)) {
      socket.emit('friend-request-error', { message: `Friend request already sent to @${target.username}. Awaiting acceptance.` });
      return;
    }

    // Auto-accept if target already sent a request to sender
    if (sender.pendingReceived.includes(target.username)) {
      sender.friends.push(target.username);
      target.friends.push(sender.username);
      sender.pendingReceived = sender.pendingReceived.filter(u => u !== target.username);
      target.pendingSent = target.pendingSent.filter(u => u !== sender.username);
      saveUsersData();

      socket.emit('friend-request-accepted-notice', {
        message: `You and @${target.username} are now friends on SnapCall! You can now video call.`,
        friend: sanitizeUser(target)
      });
      io.to(`user:${target.username}`).emit('friend-request-accepted-notice', {
        message: `@${sender.username} accepted your friend request! You can now video call.`,
        friend: sanitizeUser(sender)
      });

      socket.emit('friends-data-updated', getPopulatedFriendsData(senderUsername));
      io.to(`user:${target.username}`).emit('friends-data-updated', getPopulatedFriendsData(target.username));
      return;
    }

    // Normal Request
    sender.pendingSent.push(target.username);
    target.pendingReceived.push(sender.username);
    saveUsersData();

    socket.emit('friend-request-sent-success', {
      message: `Friend request sent to @${target.username} (${target.name})!`,
      target: sanitizeUser(target)
    });

    // Notify target in real-time
    io.to(`user:${target.username}`).emit('incoming-friend-request', {
      sender: {
        username: sender.username,
        name: sender.name,
        email: sender.email,
        avatar: sender.avatar
      }
    });

    socket.emit('friends-data-updated', getPopulatedFriendsData(senderUsername));
    io.to(`user:${target.username}`).emit('friends-data-updated', getPopulatedFriendsData(target.username));
  });

  // 4. FRIENDS: Accept Friend Request
  socket.on('accept-friend-request', ({ senderUsername }) => {
    const receiverUsername = socketToUser.get(socket.id);
    const receiver = findUserByUsername(receiverUsername);
    const sender = findUserByUsername(cleanUsername(senderUsername));

    if (!receiver || !sender) return;

    if (!receiver.friends.includes(sender.username)) {
      receiver.friends.push(sender.username);
    }
    if (!sender.friends.includes(receiver.username)) {
      sender.friends.push(receiver.username);
    }

    receiver.pendingReceived = receiver.pendingReceived.filter(u => u !== sender.username);
    sender.pendingSent = sender.pendingSent.filter(u => u !== receiver.username);
    saveUsersData();

    console.log(`[Snapchat Friends] @${receiver.username} and @${sender.username} are now friends!`);

    socket.emit('friend-request-accepted-notice', {
      message: `You and @${sender.username} are now friends! You can now start video calls.`,
      friend: sanitizeUser(sender)
    });
    io.to(`user:${sender.username}`).emit('friend-request-accepted-notice', {
      message: `@${receiver.username} accepted your friend request! You can now start video calls.`,
      friend: sanitizeUser(receiver)
    });

    socket.emit('friends-data-updated', getPopulatedFriendsData(receiverUsername));
    io.to(`user:${sender.username}`).emit('friends-data-updated', getPopulatedFriendsData(sender.username));
  });

  // 5. FRIENDS: Reject Friend Request
  socket.on('reject-friend-request', ({ senderUsername }) => {
    const receiverUsername = socketToUser.get(socket.id);
    const receiver = findUserByUsername(receiverUsername);
    const sender = findUserByUsername(cleanUsername(senderUsername));

    if (!receiver) return;

    receiver.pendingReceived = receiver.pendingReceived.filter(u => u !== cleanUsername(senderUsername));
    if (sender) {
      sender.pendingSent = sender.pendingSent.filter(u => u !== receiverUsername);
    }
    saveUsersData();

    socket.emit('friends-data-updated', getPopulatedFriendsData(receiverUsername));
    if (sender) {
      io.to(`user:${sender.username}`).emit('friends-data-updated', getPopulatedFriendsData(sender.username));
    }
  });

  // 6. FRIENDS: Remove Friend
  socket.on('remove-friend', ({ friendUsername }) => {
    const userUsername = socketToUser.get(socket.id);
    const user = findUserByUsername(userUsername);
    const friend = findUserByUsername(cleanUsername(friendUsername));

    if (!user) return;

    user.friends = user.friends.filter(u => u !== cleanUsername(friendUsername));
    if (friend) {
      friend.friends = friend.friends.filter(u => u !== userUsername);
    }
    saveUsersData();

    socket.emit('friends-data-updated', getPopulatedFriendsData(userUsername));
    if (friend) {
      io.to(`user:${friend.username}`).emit('friends-data-updated', getPopulatedFriendsData(friend.username));
    }
  });

  // 7. FRIENDS: Get Fresh Data
  socket.on('get-friends-data', () => {
    const uName = socketToUser.get(socket.id);
    if (uName) {
      socket.emit('friends-data-updated', getPopulatedFriendsData(uName));
    }
  });

  // ==========================================
  // SNAPCHAT-STYLE HD VIDEO CALLING ENGINE
  // ==========================================
  socket.on('initiate-call', ({ targetUsername, callType = 'video' }) => {
    const callerUname = socketToUser.get(socket.id);
    const caller = connectedUsers.get(callerUname);

    if (!caller) {
      socket.emit('call-error', { message: 'You must be signed in to video call.' });
      return;
    }

    const cleanTarget = cleanUsername(targetUsername);
    const callerUser = findUserByUsername(callerUname);
    const targetUser = findUserByUsername(cleanTarget);

    if (callerUname === cleanTarget) {
      socket.emit('call-error', { message: 'You cannot call yourself.' });
      return;
    }

    // 🔒 SNAPCHAT FRIEND ENFORCEMENT: Only accepted friends can call each other!
    const isFriend = callerUser && callerUser.friends && callerUser.friends.includes(cleanTarget);
    if (!isFriend) {
      console.log(`[Snapchat Call Blocked] @${callerUname} tried to call non-friend @${cleanTarget}`);
      socket.emit('call-failed', {
        targetUsername: cleanTarget,
        reason: 'NOT_FRIENDS',
        message: `You can only call friends on SnapCall! Add @${targetUser ? targetUser.username : cleanTarget} as a friend first.`,
        targetUser: targetUser ? {
          username: targetUser.username,
          name: targetUser.name,
          email: targetUser.email,
          avatar: targetUser.avatar
        } : null
      });
      return;
    }

    const receiver = connectedUsers.get(cleanTarget);

    if (!receiver || !receiver.socketId) {
      console.log(`[Call Attempt] Friend @${cleanTarget} is offline -> UNAVAILABLE`);
      socket.emit('call-failed', {
        targetUsername: cleanTarget,
        reason: 'UNAVAILABLE',
        message: `@${targetUser ? targetUser.username : cleanTarget} is currently offline.`
      });
      return;
    }

    const callId = `call_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const isReceiverAlreadyInCall = Boolean(receiver.activeCallId);

    console.log(
      `[Snapchat Call Initiated] @${callerUname} (${callerUser?.name}) -> @${cleanTarget} (${targetUser?.name}) [${callType.toUpperCase()}]` +
      (isReceiverAlreadyInCall ? ` [RECEIVER IN CALL - ZERO BUSY ACTIVE]` : '')
    );

    activeCalls.set(callId, {
      callId,
      initiatorUsername: callerUname,
      targetUsername: cleanTarget,
      participants: new Set([callerUname]),
      callType,
      status: 'pending'
    });

    // Zero-busy: caller gets RINGING immediately
    socket.emit('call-ringing', {
      callId,
      targetUsername: cleanTarget,
      targetName: targetUser?.name || cleanTarget,
      targetAvatar: targetUser?.avatar || '',
      status: 'RINGING',
      callType,
      receiverHasExistingCall: isReceiverAlreadyInCall
    });

    // Send incoming-call notification to receiver
    const incomingPayload = {
      callId,
      callerUsername: callerUname,
      callerName: callerUser?.name || callerUname,
      callerEmail: callerUser?.email || '',
      callerAvatar: callerUser?.avatar || '',
      callType,
      isCallWaiting: isReceiverAlreadyInCall,
      currentCallId: receiver.activeCallId
    };

    io.to(`user:${cleanTarget}`).emit('incoming-call', incomingPayload);

    // 35-second timeout
    const timeoutHandle = setTimeout(() => {
      const call = activeCalls.get(callId);
      if (call && call.status === 'pending') {
        console.log(`[Call Timeout] Call ${callId} timed out`);
        activeCalls.delete(callId);
        pendingCallTimeouts.delete(callId);

        io.to(`user:${callerUname}`).emit('call-failed', {
          callId,
          targetUsername: cleanTarget,
          reason: 'UNAVAILABLE',
          message: 'No response. Call timed out.'
        });

        io.to(`user:${cleanTarget}`).emit('call-missed', {
          callId,
          callerUsername: callerUname
        });
      }
    }, 35000);

    pendingCallTimeouts.set(callId, timeoutHandle);
  });

  // Accept Call
  socket.on('accept-call', ({ callId, mode = 'standard' }) => {
    const receiverUname = socketToUser.get(socket.id);
    const receiver = connectedUsers.get(receiverUname);
    const pendingCall = activeCalls.get(callId);

    if (!pendingCall || !receiver) return;

    clearCallTimeout(callId);

    const callerUname = pendingCall.initiatorUsername;
    const caller = connectedUsers.get(callerUname);

    pendingCall.status = 'active';
    pendingCall.participants.add(receiverUname);
    receiver.activeCallId = callId;
    if (caller) caller.activeCallId = callId;

    console.log(`[Call Connected] Call ${callId} active between @${callerUname} and @${receiverUname}`);

    const participantList = [
      { username: callerUname, name: caller?.name, avatar: caller?.avatar },
      { username: receiverUname, name: receiver.name, avatar: receiver.avatar }
    ];

    io.to(`user:${callerUname}`).emit('call-accepted', {
      callId,
      peerUsername: receiverUname,
      peerName: receiver.name,
      peerAvatar: receiver.avatar,
      callType: pendingCall.callType,
      participants: participantList
    });

    socket.emit('call-connected', {
      callId,
      peerUsername: callerUname,
      peerName: caller?.name,
      peerAvatar: caller?.avatar,
      callType: pendingCall.callType,
      participants: participantList
    });

    broadcastOnlineUsers();
    broadcastFriendsStatusUpdate(receiverUname);
    broadcastFriendsStatusUpdate(callerUname);
  });

  // Reject Call
  socket.on('reject-call', ({ callId }) => {
    clearCallTimeout(callId);
    const call = activeCalls.get(callId);
    if (!call) return;

    activeCalls.delete(callId);
    console.log(`[Call Declined] Call ${callId} rejected by receiver`);

    io.to(`user:${call.initiatorUsername}`).emit('call-rejected', {
      callId,
      reason: 'DECLINED',
      message: 'Friend declined the call'
    });
  });

  // WebRTC Relays
  socket.on('webrtc-offer', ({ targetUsername, offer, callId }) => {
    const fromUsername = socketToUser.get(socket.id);
    io.to(`user:${cleanUsername(targetUsername)}`).emit('webrtc-offer', { fromUsername, offer, callId });
  });

  socket.on('webrtc-answer', ({ targetUsername, answer, callId }) => {
    const fromUsername = socketToUser.get(socket.id);
    io.to(`user:${cleanUsername(targetUsername)}`).emit('webrtc-answer', { fromUsername, answer, callId });
  });

  socket.on('ice-candidate', ({ targetUsername, candidate, callId }) => {
    const fromUsername = socketToUser.get(socket.id);
    io.to(`user:${cleanUsername(targetUsername)}`).emit('ice-candidate', { fromUsername, candidate, callId });
  });

  // Media Mute / Cam Relay
  socket.on('peer-media-state', ({ isAudioMuted, isVideoMuted }) => {
    const fromUsername = socketToUser.get(socket.id);
    const user = connectedUsers.get(fromUsername);
    if (!user || !user.activeCallId) return;

    const call = activeCalls.get(user.activeCallId);
    if (call) {
      call.participants.forEach(pUname => {
        if (pUname !== fromUsername) {
          io.to(`user:${pUname}`).emit('peer-media-state-updated', {
            username: fromUsername,
            isAudioMuted,
            isVideoMuted
          });
        }
      });
    }
  });

  // End Call
  socket.on('end-call', ({ callId }) => {
    endCallSession(callId, socketToUser.get(socket.id));
  });

  // Disconnect
  socket.on('disconnect', (reason) => {
    const uName = socketToUser.get(socket.id);
    socketToUser.delete(socket.id);
    if (!uName) return;

    console.log(`[Socket Disconnected] @${uName}. Reason: ${reason}`);

    const user = connectedUsers.get(uName);
    if (user && user.socketId === socket.id) {
      const room = io.sockets.adapter.rooms.get(`user:${uName}`);
      if (!room || room.size === 0) {
        if (user.activeCallId) {
          endCallSession(user.activeCallId, uName);
        }
        connectedUsers.delete(uName);
        broadcastOnlineUsers();
        broadcastFriendsStatusUpdate(uName);
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

function endCallSession(callId, endedByUsername) {
  clearCallTimeout(callId);
  const call = activeCalls.get(callId);
  if (!call) return;

  console.log(`[Call Ended] Session ${callId} ended`);

  call.participants.forEach(pUname => {
    const u = connectedUsers.get(pUname);
    if (u && u.activeCallId === callId) {
      u.activeCallId = null;
    }
    io.to(`user:${pUname}`).emit('call-ended', {
      callId,
      endedBy: endedByUsername
    });
    broadcastFriendsStatusUpdate(pUname);
  });

  activeCalls.delete(callId);
  broadcastOnlineUsers();
}

function broadcastFriendsStatusUpdate(username) {
  const user = findUserByUsername(username);
  if (!user || !user.friends) return;

  user.friends.forEach(fUname => {
    if (connectedUsers.has(fUname)) {
      io.to(`user:${fUname}`).emit('friends-data-updated', getPopulatedFriendsData(fUname));
    }
  });
}

function broadcastOnlineUsers() {
  const users = Array.from(connectedUsers.values()).map(u => ({
    username: u.username,
    name: u.name,
    email: u.email,
    avatar: u.avatar,
    inCall: Boolean(u.activeCallId)
  }));
  io.emit('online-users-updated', users);
}

function emitOnlineUsersTo(socket) {
  const users = Array.from(connectedUsers.values()).map(u => ({
    username: u.username,
    name: u.name,
    email: u.email,
    avatar: u.avatar,
    inCall: Boolean(u.activeCallId)
  }));
  socket.emit('online-users-updated', users);
}

server.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`👻 SnapCall Server: Snapchat-Style HD Video Calling`);
  console.log(`📍 URL: http://localhost:${PORT}`);
  console.log(`====================================================`);
});

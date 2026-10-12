# Android & WebRTC Implementation Guide: Zero-Busy Calling System

## 1. Problem Statement & Architecture Summary
Standard calling apps often mistakenly reject incoming calls with `USER_BUSY` when:
1. The user is in an active call inside the app.
2. The user is on a WhatsApp call, phone call, or external app.

### Correct Behavior:
* **Never send `USER_BUSY` from the server:**
  * When Caller A calls Receiver B:
    1. Server checks if Receiver B's socket is connected and reachable.
    2. If reachable, server **immediately emits `call-ringing`** to Caller A.
    3. Server delivers `incoming-call` to Receiver B.
    4. If Receiver B is already talking, they receive a **Call Waiting** alert with options to **Hold & Switch** or **Merge** into a multi-party call.
    5. Return `UNAVAILABLE` **only** if Receiver B is offline or if the call times out (35 seconds).

---

## 2. Server Logic (Node.js + Socket.IO)

```javascript
// Server NEVER rejects because of activeCallId or external calls
socket.on('initiate-call', ({ targetUserId, callType }) => {
  const callerId = socketToUserId.get(socket.id);
  const receiver = connectedUsers.get(targetUserId);

  // 1. Check if receiver is online & reachable
  if (!receiver || !receiver.socketId) {
    return socket.emit('call-failed', {
      reason: 'UNAVAILABLE',
      message: 'Receiver is offline or unreachable'
    });
  }

  const isReceiverAlreadyInCall = Boolean(receiver.activeCallId);

  // 2. ALWAYS emit RINGING to caller immediately (NEVER USER_BUSY)
  socket.emit('call-ringing', {
    callId,
    targetUserId,
    status: 'RINGING',
    receiverHasExistingCall: isReceiverAlreadyInCall
  });

  // 3. Deliver incoming call notification to receiver
  io.to(receiver.socketId).emit('incoming-call', {
    callId,
    callerId,
    callerUsername: caller.username,
    isCallWaiting: isReceiverAlreadyInCall
  });

  // 4. Timeout after 35s -> UNAVAILABLE
  setTimeout(() => {
    if (callIsStillPending(callId)) {
      emitToCaller('call-failed', { reason: 'UNAVAILABLE', message: 'Timed out' });
    }
  }, 35000);
});
```

---

## 3. Android Native / Flutter / React Native Integration

### A. Android Audio Focus Handling (WhatsApp / Phone Call Interruption)
When a user is on your app's video call and a WhatsApp call arrives:
1. Android OS requests Audio Focus for WhatsApp.
2. Your app receives `AudioManager.AUDIOFOCUS_LOSS_TRANSIENT`.
3. **Action:** Do **NOT** disconnect the call session or tell the server you are busy. Instead:
   * Pause/mute local audio track: `audioTrack.setEnabled(false);`
   * Keep WebRTC peer connection and Socket.IO alive.
   * Send an event `external-interruption` to let peers know the user is temporarily held.
4. When the WhatsApp call finishes, your app receives `AUDIOFOCUS_GAIN`:
   * Resume local audio track: `audioTrack.setEnabled(true);`
   * Resume normal voice flow.

#### Java / Kotlin Sample:
```kotlin
val audioFocusChangeListener = AudioManager.OnAudioFocusChangeListener { focusChange ->
    when (focusChange) {
        AudioManager.AUDIOFOCUS_LOSS_TRANSIENT,
        AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK -> {
            // WhatsApp or Phone call has taken microphone
            localAudioTrack?.setEnabled(false)
            socket.emit("external-interruption", JSONObject().apply {
                put("isInterrupted", true)
                put("reason", "External call active")
            })
        }
        AudioManager.AUDIOFOCUS_GAIN -> {
            // WhatsApp call ended, resume audio
            localAudioTrack?.setEnabled(true)
            socket.emit("external-interruption", JSONObject().apply {
                put("isInterrupted", false)
                put("reason", "Resumed")
            })
        }
        AudioManager.AUDIOFOCUS_LOSS -> {
            // Permanent loss (user picked up cellular call)
            localAudioTrack?.setEnabled(false)
        }
    }
}
```

---

### B. Handling Incoming Calls while on WhatsApp
When user is actively talking on WhatsApp and someone calls via your app:
1. **Firebase Cloud Messaging (FCM) / High Priority Push:**
   * Your app receives the incoming call push notification.
2. **Android TelecomManager / ConnectionService:**
   * Register a `ConnectionService`.
   * Android OS will show the incoming call UI (Heads-Up Banner) over WhatsApp.
3. **Caller experience:**
   * The caller's app is connected to Socket.IO and sees **`RINGING...`** (Never "User Busy").
4. **When user accepts your app's call:**
   * Android will switch audio focus to your app (putting WhatsApp on hold or letting the user choose which call to keep).

---

### C. Android Camera Conflict (Camera2 API)
* On Android 10 (API 29) and below, only one app can access the physical camera at a time.
* If WhatsApp is using the camera and the user answers your app's video call:
  * Capture `CameraDevice.StateCallback.onError`: error code `ERROR_CAMERA_IN_USE`.
  * Fall back to audio-only or display an avatar until the camera is released.
* On Android 11+ (Multi-camera / Concurrent capture):
  * Priority is given to the foreground app. When your app comes to the foreground, camera access is granted.

---

## 4. Summary Matrix

| Scenario | Naive System (Wrong) | Your New System (Correct) |
| :--- | :--- | :--- |
| **User on WhatsApp, someone calls via app** | Returns `USER_BUSY` ❌ | Returns `RINGING` 🔔, shows banner to user |
| **User in App call, 2nd user calls** | Returns `USER_BUSY` ❌ | Returns `RINGING` 🔔, shows Call Waiting & Merge option |
| **WhatsApp takes Mic during call** | App crashes / Drops call ❌ | Mutes mic temporarily, keeps session alive |
| **Receiver offline / no answer** | `UNAVAILABLE` | `UNAVAILABLE` (After 35s timeout or offline check) |

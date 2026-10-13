/* ==========================================================================
   MeetFlow / NonStop Video | Modern Client Logic & Room Controller
   Zero ID Clutter • 1-Click Instant Meetings • Clean Authentication
   ========================================================================== */

(function() {
  'use strict';

  // DOM Elements
  const authPopupBackdrop = document.getElementById('authPopupBackdrop');
  const authDismissBtn = document.getElementById('authDismissBtn');
  const tabChoiceSignIn = document.getElementById('tabChoiceSignIn');
  const tabChoiceSignUp = document.getElementById('tabChoiceSignUp');
  const formSignIn = document.getElementById('formSignIn');
  const formSignUp = document.getElementById('formSignUp');

  const navAuthButtonGroup = document.getElementById('navAuthButtonGroup');
  const navUserCapsule = document.getElementById('navUserCapsule');
  const navUserDisplayName = document.getElementById('navUserDisplayName');
  const navUserLogoutBtn = document.getElementById('navUserLogoutBtn');

  const btnNavSignIn = document.getElementById('btnNavSignIn');
  const btnNavSignUp = document.getElementById('btnNavSignUp');
  const btnNavNewMeeting = document.getElementById('btnNavNewMeeting');
  const btnHeroNewMeeting = document.getElementById('btnHeroNewMeeting');
  const btnCtaNewMeeting = document.getElementById('btnCtaNewMeeting');
  const btnCtaSignUp = document.getElementById('btnCtaSignUp');
  const btnGuestPassSignIn = document.getElementById('btnGuestPassSignIn');
  const btnGuestPassSignUp = document.getElementById('btnGuestPassSignUp');

  const heroMeetingInput = document.getElementById('heroMeetingInput');
  const btnHeroJoinMeeting = document.getElementById('btnHeroJoinMeeting');

  const floatingStatusToast = document.getElementById('floatingStatusToast');
  const statusToastText = document.getElementById('statusToastText');

  // Helper: Toast notification
  function notify(message, duration = 3000) {
    if (!floatingStatusToast || !statusToastText) return;
    statusToastText.textContent = message;
    floatingStatusToast.classList.add('visible');
    setTimeout(() => {
      floatingStatusToast.classList.remove('visible');
    }, duration);
  }

  // Helper: Clean Room Slug Generator (e.g. "focus-room-482")
  function generateCleanMeetingSlug() {
    const adjectives = ['swift', 'focus', 'bright', 'clear', 'nexus', 'pulse', 'prime', 'wave'];
    const nouns = ['meet', 'room', 'space', 'huddle', 'sync', 'chat'];
    const randAdj = adjectives[Math.floor(Math.random() * adjectives.length)];
    const randNoun = nouns[Math.floor(Math.random() * nouns.length)];
    const randNum = Math.floor(100 + Math.random() * 900);
    return `${randAdj}-${randNoun}-${randNum}`;
  }

  // Synchronize Nav & User State
  function syncUserSession() {
    let user = null;
    try {
      const stored = localStorage.getItem('meetflow_user');
      if (stored) user = JSON.parse(stored);
    } catch (e) {}

    if (user && user.name) {
      if (navAuthButtonGroup) navAuthButtonGroup.style.display = 'none';
      if (navUserCapsule) navUserCapsule.style.display = 'flex';
      if (navUserDisplayName) navUserDisplayName.textContent = user.name;
    } else {
      if (navAuthButtonGroup) navAuthButtonGroup.style.display = 'flex';
      if (navUserCapsule) navUserCapsule.style.display = 'none';
    }
  }

  // Modal Open & Close
  function openAuthPopup(mode = 'signin') {
    if (!authPopupBackdrop) return;
    authPopupBackdrop.classList.add('active');
    selectAuthMode(mode);
  }

  function closeAuthPopup() {
    if (!authPopupBackdrop) return;
    authPopupBackdrop.classList.remove('active');
  }

  function selectAuthMode(mode) {
    if (mode === 'signup') {
      if (tabChoiceSignUp) tabChoiceSignUp.classList.add('selected');
      if (tabChoiceSignIn) tabChoiceSignIn.classList.remove('selected');
      if (formSignUp) formSignUp.style.display = 'flex';
      if (formSignIn) formSignIn.style.display = 'none';
    } else {
      if (tabChoiceSignIn) tabChoiceSignIn.classList.add('selected');
      if (tabChoiceSignUp) tabChoiceSignUp.classList.remove('selected');
      if (formSignIn) formSignIn.style.display = 'flex';
      if (formSignUp) formSignUp.style.display = 'none';
    }
  }

  // Launch New Instant Meeting
  function launchInstantMeeting() {
    const roomCode = generateCleanMeetingSlug();
    notify(`🚀 Creating instant meeting "${roomCode}"...`, 1500);

    // Save temporary meeting name
    sessionStorage.setItem('current_meeting_room', roomCode);

    setTimeout(() => {
      window.location.href = `/app?call=${encodeURIComponent(roomCode)}`;
    }, 700);
  }

  // Join Existing Meeting Link / Code
  function joinMeetingByCode() {
    const raw = heroMeetingInput ? heroMeetingInput.value.trim() : '';
    if (!raw) {
      notify('⚠️ Please enter a meeting link or code to join.');
      if (heroMeetingInput) heroMeetingInput.focus();
      return;
    }

    // Clean code if user pasted a full URL
    let code = raw;
    try {
      if (raw.includes('http://') || raw.includes('https://')) {
        const url = new URL(raw);
        code = url.searchParams.get('call') || url.pathname.replace(/^\//, '');
      }
    } catch (e) {}

    notify(`Connecting to meeting "${code}"...`, 1500);
    setTimeout(() => {
      window.location.href = `/app?call=${encodeURIComponent(code)}`;
    }, 600);
  }

  // One-Click Guest Entry
  function handleGuestQuickEntry() {
    const guestUser = {
      name: 'Guest Participant',
      email: 'guest@meetflow.live'
    };
    localStorage.setItem('meetflow_user', JSON.stringify(guestUser));
    notify('⚡ Entering as Guest Participant...', 1200);

    setTimeout(() => {
      window.location.href = '/app';
    }, 700);
  }

  // Event Listeners for Nav & Buttons
  if (btnNavSignIn) btnNavSignIn.addEventListener('click', () => openAuthPopup('signin'));
  if (btnNavSignUp) btnNavSignUp.addEventListener('click', () => openAuthPopup('signup'));
  if (btnCtaSignUp) btnCtaSignUp.addEventListener('click', () => openAuthPopup('signup'));

  if (btnNavNewMeeting) btnNavNewMeeting.addEventListener('click', launchInstantMeeting);
  if (btnHeroNewMeeting) btnHeroNewMeeting.addEventListener('click', launchInstantMeeting);
  if (btnCtaNewMeeting) btnCtaNewMeeting.addEventListener('click', launchInstantMeeting);

  if (btnHeroJoinMeeting) btnHeroJoinMeeting.addEventListener('click', joinMeetingByCode);
  if (heroMeetingInput) {
    heroMeetingInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') joinMeetingByCode();
    });
  }

  if (authDismissBtn) authDismissBtn.addEventListener('click', closeAuthPopup);
  if (authPopupBackdrop) {
    authPopupBackdrop.addEventListener('click', (e) => {
      if (e.target === authPopupBackdrop) closeAuthPopup();
    });
  }

  if (tabChoiceSignIn) tabChoiceSignIn.addEventListener('click', () => selectAuthMode('signin'));
  if (tabChoiceSignUp) tabChoiceSignUp.addEventListener('click', () => selectAuthMode('signup'));

  if (btnGuestPassSignIn) btnGuestPassSignIn.addEventListener('click', handleGuestQuickEntry);
  if (btnGuestPassSignUp) btnGuestPassSignUp.addEventListener('click', handleGuestQuickEntry);

  // Form: Sign In
  if (formSignIn) {
    formSignIn.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('loginEmailInput').value.trim();
      const password = document.getElementById('loginPasswordInput').value.trim();

      if (!email || !password) {
        notify('⚠️ Please provide your email and password.');
        return;
      }

      const user = {
        name: email.split('@')[0],
        email: email
      };

      localStorage.setItem('meetflow_user', JSON.stringify(user));

      // Sync backend
      try {
        await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ identifier: email, password })
        });
      } catch (err) {}

      notify(`✅ Welcome back, ${user.name}! Entering meeting console...`, 1500);
      syncUserSession();
      closeAuthPopup();

      setTimeout(() => {
        window.location.href = '/app';
      }, 800);
    });
  }

  // Form: Sign Up
  if (formSignUp) {
    formSignUp.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = document.getElementById('signupNameInput').value.trim();
      const email = document.getElementById('signupEmailInput').value.trim();
      const password = document.getElementById('signupPasswordInput').value.trim();

      if (!name || !email || !password) {
        notify('⚠️ Please fill in all fields.');
        return;
      }

      const user = {
        name,
        email
      };

      localStorage.setItem('meetflow_user', JSON.stringify(user));

      // Sync backend
      try {
        await fetch('/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, email, password, callerId: name.toLowerCase().replace(/[^a-z0-9]/g, '') })
        });
      } catch (err) {}

      notify(`🎉 Account created! Welcome, ${name}. Launching meetings...`, 1500);
      syncUserSession();
      closeAuthPopup();

      setTimeout(() => {
        window.location.href = '/app';
      }, 900);
    });
  }

  // Logout
  if (navUserLogoutBtn) {
    navUserLogoutBtn.addEventListener('click', () => {
      localStorage.removeItem('meetflow_user');
      syncUserSession();
      notify('👋 Logged out successfully.');
    });
  }

  // FAQ Accordion
  document.querySelectorAll('.faq-toggle-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const card = btn.parentElement;
      const isOpen = card.classList.contains('open');
      document.querySelectorAll('.faq-card-unit').forEach(c => c.classList.remove('open'));
      if (!isOpen) {
        card.classList.add('open');
      }
    });
  });

  // Init
  syncUserSession();
})();

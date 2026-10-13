/* ==========================================================================
   Non-Stop Call | Landing Page Logic & Authentication Controller
   ========================================================================== */

(function() {
  'use strict';

  // DOM Elements
  const authModal = document.getElementById('authModal');
  const closeAuthModalBtn = document.getElementById('closeAuthModalBtn');
  const tabSignInBtn = document.getElementById('tabSignInBtn');
  const tabSignUpBtn = document.getElementById('tabSignUpBtn');
  const signInForm = document.getElementById('signInForm');
  const signUpForm = document.getElementById('signUpForm');

  const navAuthActions = document.getElementById('navAuthActions');
  const navUserCapsule = document.getElementById('navUserCapsule');
  const navUserName = document.getElementById('navUserName');
  const navUserCallerId = document.getElementById('navUserCallerId');
  const navLogoutBtn = document.getElementById('navLogoutBtn');

  const btnOpenSignIn = document.getElementById('btnOpenSignIn');
  const btnOpenSignUp = document.getElementById('btnOpenSignUp');
  const btnHeroSignUp = document.getElementById('btnHeroSignUp');
  const btnCtaSignUp = document.getElementById('btnCtaSignUp');
  const btnGuestPass1 = document.getElementById('btnGuestPass1');
  const btnGuestPass2 = document.getElementById('btnGuestPass2');
  const btnHeroGuest = document.getElementById('btnHeroGuest');

  const rollNumberBtn = document.getElementById('rollNumberBtn');
  const regCallerIdInput = document.getElementById('regCallerIdInput');

  const simDialInput = document.getElementById('simDialInput');
  const simDialBtn = document.getElementById('simDialBtn');
  const simAnswerBtn = document.getElementById('simAnswerBtn');
  const simDeclineBtn = document.getElementById('simDeclineBtn');

  const landingToast = document.getElementById('landingToast');
  const toastMessage = document.getElementById('toastMessage');

  // Helper: Toast notification
  function showToast(msg, duration = 3000) {
    if (!landingToast || !toastMessage) return;
    toastMessage.textContent = msg;
    landingToast.classList.add('show');
    setTimeout(() => {
      landingToast.classList.remove('show');
    }, duration);
  }

  // Helper: Generate clean 6-digit ID (e.g. "849-210")
  function generateRandomId() {
    const p1 = Math.floor(100 + Math.random() * 900);
    const p2 = Math.floor(100 + Math.random() * 900);
    return `${p1}-${p2}`;
  }

  // Format ID as XXX-XXX on input
  function formatCallerIdString(val) {
    let cleaned = val.replace(/[^0-9]/g, '');
    if (cleaned.length > 3) {
      cleaned = `${cleaned.slice(0, 3)}-${cleaned.slice(3, 6)}`;
    }
    return cleaned;
  }

  // Check Login State
  function syncUserState() {
    let user = null;
    try {
      const stored = localStorage.getItem('logged_user');
      if (stored) user = JSON.parse(stored);
    } catch (e) {}

    const permId = localStorage.getItem('permanent_caller_id');

    if (user && user.callerId) {
      if (navAuthActions) navAuthActions.style.display = 'none';
      if (navUserCapsule) navUserCapsule.style.display = 'flex';
      if (navUserName) navUserName.textContent = user.name || 'Caller';
      if (navUserCallerId) navUserCallerId.textContent = `#${user.callerId}`;
    } else {
      if (navAuthActions) navAuthActions.style.display = 'flex';
      if (navUserCapsule) navUserCapsule.style.display = 'none';
    }

    // Set simulator default ID
    const simMyIdDisplay = document.getElementById('simMyIdDisplay');
    if (simMyIdDisplay) {
      simMyIdDisplay.textContent = permId ? `#${permId}` : '#583-912';
    }
  }

  // Open & Close Auth Modal
  function openModal(tab = 'signin') {
    if (!authModal) return;
    authModal.classList.add('open');
    switchTab(tab);
  }

  function closeModal() {
    if (!authModal) return;
    authModal.classList.remove('open');
  }

  function switchTab(tab) {
    if (tab === 'signup') {
      if (tabSignUpBtn) tabSignUpBtn.classList.add('active');
      if (tabSignInBtn) tabSignInBtn.classList.remove('active');
      if (signUpForm) signUpForm.style.display = 'flex';
      if (signInForm) signInForm.style.display = 'none';
      // Auto-populate random ID if empty
      if (regCallerIdInput && !regCallerIdInput.value) {
        regCallerIdInput.value = generateRandomId();
      }
    } else {
      if (tabSignInBtn) tabSignInBtn.classList.add('active');
      if (tabSignUpBtn) tabSignUpBtn.classList.remove('active');
      if (signInForm) signInForm.style.display = 'flex';
      if (signUpForm) signUpForm.style.display = 'none';
    }
  }

  // Event Listeners for Modal
  if (btnOpenSignIn) btnOpenSignIn.addEventListener('click', () => openModal('signin'));
  if (btnOpenSignUp) btnOpenSignUp.addEventListener('click', () => openModal('signup'));
  if (btnHeroSignUp) btnHeroSignUp.addEventListener('click', () => openModal('signup'));
  if (btnCtaSignUp) btnCtaSignUp.addEventListener('click', () => openModal('signup'));

  if (closeAuthModalBtn) closeAuthModalBtn.addEventListener('click', closeModal);
  if (authModal) {
    authModal.addEventListener('click', (e) => {
      if (e.target === authModal) closeModal();
    });
  }

  if (tabSignInBtn) tabSignInBtn.addEventListener('click', () => switchTab('signin'));
  if (tabSignUpBtn) tabSignUpBtn.addEventListener('click', () => switchTab('signup'));

  // Roll new number button
  if (rollNumberBtn) {
    rollNumberBtn.addEventListener('click', () => {
      if (regCallerIdInput) {
        regCallerIdInput.value = generateRandomId();
        showToast('🎲 New 6-Digit ID Generated!');
      }
    });
  }

  if (regCallerIdInput) {
    regCallerIdInput.addEventListener('input', (e) => {
      e.target.value = formatCallerIdString(e.target.value);
    });
  }

  // Guest Pass Handlers
  function handleGuestPass() {
    let id = localStorage.getItem('permanent_caller_id');
    if (!id || id.trim().length < 3) {
      id = generateRandomId();
      localStorage.setItem('permanent_caller_id', id);
    }
    showToast(`⚡ Instant Guest Access Granted (#${id})! Redirecting...`, 1500);
    setTimeout(() => {
      window.location.href = '/app';
    }, 900);
  }

  if (btnGuestPass1) btnGuestPass1.addEventListener('click', handleGuestPass);
  if (btnGuestPass2) btnGuestPass2.addEventListener('click', handleGuestPass);
  if (btnHeroGuest) btnHeroGuest.addEventListener('click', handleGuestPass);

  // Sign Up Submission
  if (signUpForm) {
    signUpForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = document.getElementById('regNameInput').value.trim();
      const email = document.getElementById('regEmailInput').value.trim();
      const callerId = regCallerIdInput.value.trim();
      const password = document.getElementById('regPassInput').value.trim();

      if (!name || !email || !callerId || !password) {
        showToast('⚠️ Please fill in all fields.');
        return;
      }

      if (callerId.replace(/[^0-9]/g, '').length < 6) {
        showToast('⚠️ Caller ID must contain at least 6 digits (e.g. 583-912).');
        return;
      }

      const userData = {
        name,
        email,
        callerId,
        password
      };

      // Persist in localStorage
      localStorage.setItem('logged_user', JSON.stringify({ name, email, callerId }));
      localStorage.setItem('permanent_caller_id', callerId);

      // Attempt to save to backend API
      try {
        await fetch('/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(userData)
        });
      } catch (err) {
        console.warn('Backend auth sync note (using local persistence):', err);
      }

      showToast(`🎉 Welcome ${name}! Number #${callerId} registered. Launching app...`, 2000);
      syncUserState();
      closeModal();

      setTimeout(() => {
        window.location.href = '/app';
      }, 1200);
    });
  }

  // Sign In Submission
  if (signInForm) {
    signInForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const identifier = document.getElementById('loginIdInput').value.trim();
      const password = document.getElementById('loginPassInput').value.trim();

      if (!identifier || !password) {
        showToast('⚠️ Please enter your ID or Email and Password.');
        return;
      }

      let callerId = identifier;
      // If entered plain digits or format
      if (/^[0-9-]+$/.test(identifier)) {
        callerId = formatCallerIdString(identifier);
      }

      const userData = {
        name: 'Caller',
        callerId: callerId,
        email: identifier.includes('@') ? identifier : `${callerId}@nonstop.call`
      };

      // Persist in localStorage
      localStorage.setItem('logged_user', JSON.stringify(userData));
      localStorage.setItem('permanent_caller_id', callerId);

      // Attempt to login to backend API
      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ identifier, password })
        });
        const data = await res.json();
        if (data && data.user) {
          localStorage.setItem('logged_user', JSON.stringify(data.user));
          if (data.user.callerId) {
            localStorage.setItem('permanent_caller_id', data.user.callerId);
          }
        }
      } catch (err) {
        console.warn('Backend login sync note:', err);
      }

      showToast(`✅ Welcome back! Launching Calling Console (#${callerId})...`, 1500);
      syncUserState();
      closeModal();

      setTimeout(() => {
        window.location.href = '/app';
      }, 1000);
    });
  }

  // Logout Handler
  if (navLogoutBtn) {
    navLogoutBtn.addEventListener('click', () => {
      localStorage.removeItem('logged_user');
      syncUserState();
      showToast('👋 You have been logged out.');
    });
  }

  // Simulator Dial Handler
  if (simDialInput) {
    simDialInput.addEventListener('input', (e) => {
      e.target.value = formatCallerIdString(e.target.value);
    });
  }

  if (simDialBtn) {
    simDialBtn.addEventListener('click', () => {
      const target = simDialInput ? simDialInput.value.trim() : '';
      if (target) {
        window.location.href = `/app?call=${encodeURIComponent(target)}`;
      } else {
        window.location.href = '/app';
      }
    });
  }

  if (simAnswerBtn) {
    simAnswerBtn.addEventListener('click', () => {
      window.location.href = '/app';
    });
  }

  if (simDeclineBtn) {
    simDeclineBtn.addEventListener('click', () => {
      const card = document.querySelector('.sim-call-card');
      if (card) {
        card.style.opacity = '0.5';
        setTimeout(() => { card.style.opacity = '1'; }, 1000);
      }
      showToast('Call declined in preview');
    });
  }

  // FAQ Accordion
  document.querySelectorAll('.faq-question').forEach((btn) => {
    btn.addEventListener('click', () => {
      const item = btn.parentElement;
      const isOpen = item.classList.contains('active');
      document.querySelectorAll('.faq-item').forEach(i => i.classList.remove('active'));
      if (!isOpen) {
        item.classList.add('active');
      }
    });
  });

  // Initialize
  syncUserState();
})();

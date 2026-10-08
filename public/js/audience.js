/**
 * Audience Client JavaScript — KUP Live Poll
 * Manages participant registration, synchronized countdown timer,
 * single-choice option voting, response locking, and reconnection handling.
 */

document.addEventListener('DOMContentLoaded', () => {
  const socket = io();

  // Participant State
  let participantId = localStorage.getItem('kup_participant_id');
  if (!participantId) {
    participantId = 'p_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
    localStorage.setItem('kup_participant_id', participantId);
  }

  let currentPollId = null;
  let audienceName = localStorage.getItem('kup_audience_name') || '';
  let selectedOptionId = null;
  let hasSubmitted = false;
  let currentOptions = [];
  let pollStatus = 'draft';

  // DOM Screens
  const joinScreen = document.getElementById('joinScreen');
  const waitingScreen = document.getElementById('waitingScreen');
  const activePollScreen = document.getElementById('activePollScreen');
  const pollEndedScreen = document.getElementById('pollEndedScreen');

  // DOM Elements
  const connectionStatus = document.getElementById('connectionStatus');
  const joinForm = document.getElementById('joinForm');
  const pollIdField = document.getElementById('pollIdField');
  const nameField = document.getElementById('nameField');
  const btnJoinPoll = document.getElementById('btnJoinPoll');

  const welcomeAudienceName = document.getElementById('welcomeAudienceName');
  const waitingPollId = document.getElementById('waitingPollId');

  const audienceTimerDisplay = document.getElementById('audienceTimerDisplay');
  const audienceQuestionText = document.getElementById('audienceQuestionText');
  const audienceOptionsGrid = document.getElementById('audienceOptionsGrid');
  const submissionAlert = document.getElementById('submissionAlert');
  const btnSubmitAnswer = document.getElementById('btnSubmitAnswer');
  const userParticipationSummary = document.getElementById('userParticipationSummary');

  // 1. Detect Poll ID from URL Path or Query parameter
  // Example path: /audience/KUP-4821
  const pathSegments = window.location.pathname.split('/').filter(Boolean);
  if (pathSegments.length >= 2 && pathSegments[0] === 'audience') {
    currentPollId = pathSegments[1].toUpperCase();
    pollIdField.value = currentPollId;
  } else {
    const urlParams = new URLSearchParams(window.location.search);
    const queryPollId = urlParams.get('pollId');
    if (queryPollId) {
      currentPollId = queryPollId.toUpperCase();
      pollIdField.value = currentPollId;
    }
  }

  // Pre-fill name if known
  if (audienceName) {
    nameField.value = audienceName;
  }

  // If we already know pollId and name from previous session, attempt auto-join
  const savedPollId = localStorage.getItem('kup_last_poll_id');
  if (currentPollId && audienceName && savedPollId === currentPollId) {
    autoJoinPoll();
  }

  // ==================== Socket Connection Status ====================

  socket.on('connect', () => {
    connectionStatus.className = 'status-badge status-live';
    connectionStatus.textContent = 'Connected';
    console.log('[Socket] Connected to server.');

    // If already joined previously and reconnected, resend join
    if (currentPollId && audienceName) {
      socket.emit('joinPoll', {
        pollId: currentPollId,
        participantId,
        name: audienceName
      });
    }
  });

  socket.on('disconnect', () => {
    connectionStatus.className = 'status-badge status-draft';
    connectionStatus.textContent = 'Disconnected';
  });

  socket.on('connect_error', () => {
    connectionStatus.className = 'status-badge status-ended';
    connectionStatus.textContent = 'Connection Error';
  });

  // ==================== Join Form Submission ====================

  joinForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const pollId = pollIdField.value.trim().toUpperCase();
    const name = nameField.value.trim();

    if (!pollId) {
      showToast('Please enter the Poll Session Code!', 'error');
      pollIdField.focus();
      return;
    }

    if (!name) {
      showToast('Please enter your Name!', 'error');
      nameField.focus();
      return;
    }

    currentPollId = pollId;
    audienceName = name;
    localStorage.setItem('kup_audience_name', name);
    localStorage.setItem('kup_last_poll_id', pollId);

    btnJoinPoll.disabled = true;
    btnJoinPoll.textContent = 'Joining...';

    socket.emit('joinPoll', {
      pollId: currentPollId,
      participantId,
      name: audienceName
    });
  });

  function autoJoinPoll() {
    socket.emit('joinPoll', {
      pollId: currentPollId,
      participantId,
      name: audienceName
    });
  }

  // ==================== Socket Events ====================

  socket.on('joinError', (data) => {
    btnJoinPoll.disabled = false;
    btnJoinPoll.textContent = '🚀 JOIN LIVE POLL';
    showToast(data.message || 'Could not join poll', 'error');
  });

  socket.on('audienceJoined', (data) => {
    btnJoinPoll.disabled = false;
    btnJoinPoll.textContent = '🚀 JOIN LIVE POLL';

    currentPollId = data.pollId;
    pollStatus = data.status;
    currentOptions = data.options || [];

    if (data.participant) {
      hasSubmitted = Boolean(data.participant.submitted);
      selectedOptionId = data.participant.selectedOption;
    }

    welcomeAudienceName.textContent = audienceName;
    waitingPollId.textContent = currentPollId;

    if (data.status === 'active') {
      showActivePollScreen(data.question, data.options, data.remainingSeconds, data.formattedTime);
    } else if (data.status === 'ended') {
      showPollEndedScreen();
    } else {
      // Draft mode
      const waitDurEl = document.getElementById('waitingDurationLabel');
      if (waitDurEl && data.duration) {
        waitDurEl.textContent = data.duration >= 60 ? `${data.duration / 60} minute(s)` : `${data.duration} seconds`;
      }
      showWaitingScreen();
    }
  });

  socket.on('pollStarted', (data) => {
    currentPollId = data.pollId;
    pollStatus = 'active';
    currentOptions = data.options;
    hasSubmitted = false;
    selectedOptionId = null;

    showActivePollScreen(data.question, data.options, data.remainingSeconds, data.formattedTime);
    const durLabel = data.duration >= 60 ? `${data.duration / 60} minute(s)` : `${data.duration} seconds`;
    showToast(`Poll has started! You have ${durLabel} to submit your vote.`, 'success');
  });

  socket.on('pollDetailsUpdated', (data) => {
    if (pollStatus === 'draft') {
      currentOptions = data.options;
      if (data.duration) {
        const waitDurEl = document.getElementById('waitingDurationLabel');
        if (waitDurEl) {
          waitDurEl.textContent = data.duration >= 60 ? `${data.duration / 60} minute(s)` : `${data.duration} seconds`;
        }
      }
    }
  });

  socket.on('timerUpdate', (data) => {
    updateTimer(data.remainingSeconds, data.formattedTime);
  });

  socket.on('responseSubmitted', (data) => {
    hasSubmitted = true;
    lockOptionsAfterSubmission();
    showSubmissionSuccessMessage(data.message || 'Your response has been submitted successfully.');
    showToast('Vote submitted successfully!', 'success');
  });

  socket.on('responseError', (data) => {
    btnSubmitAnswer.disabled = false;
    btnSubmitAnswer.textContent = 'SUBMIT ANSWER';
    showToast(data.message || 'Submission error', 'error');
  });

  socket.on('pollEnded', (data) => {
    pollStatus = 'ended';
    updateTimer(0, '00:00');
    showPollEndedScreen();
  });

  // ==================== Screen Transition Handlers ====================

  function showWaitingScreen() {
    joinScreen.style.display = 'none';
    waitingScreen.style.display = 'block';
    activePollScreen.style.display = 'none';
    pollEndedScreen.style.display = 'none';
  }

  function showActivePollScreen(question, options, remainingSeconds, formattedTime) {
    joinScreen.style.display = 'none';
    waitingScreen.style.display = 'none';
    activePollScreen.style.display = 'block';
    pollEndedScreen.style.display = 'none';

    audienceQuestionText.textContent = question;
    renderOptionCards(options);
    updateTimer(remainingSeconds, formattedTime);

    if (hasSubmitted) {
      lockOptionsAfterSubmission();
      showSubmissionSuccessMessage('Your response has been submitted successfully.');
    } else {
      btnSubmitAnswer.disabled = (selectedOptionId === null);
      btnSubmitAnswer.textContent = selectedOptionId ? `SUBMIT ANSWER (OPTION ${selectedOptionId})` : 'SELECT AN OPTION';
      submissionAlert.style.display = 'none';
    }
  }

  function showPollEndedScreen() {
    joinScreen.style.display = 'none';
    waitingScreen.style.display = 'none';
    activePollScreen.style.display = 'none';
    pollEndedScreen.style.display = 'block';

    if (hasSubmitted && selectedOptionId) {
      const chosenOpt = currentOptions.find(o => o.id === selectedOptionId);
      const chosenText = chosenOpt ? chosenOpt.text : '';
      userParticipationSummary.innerHTML = `
        <div style="font-size: 0.85rem; color: var(--text-muted); text-transform: uppercase; margin-bottom: 0.25rem;">Your Submitted Answer:</div>
        <div style="font-size: 1.25rem; font-weight: 700; color: var(--accent-gold);">
          Option ${selectedOptionId}: ${escapeHtml(chosenText)}
        </div>
      `;
    } else {
      userParticipationSummary.innerHTML = `
        <div style="font-size: 0.95rem; color: #ef4444; font-weight: 600;">
          ⚠️ You did not submit an answer before the timer ended.
        </div>
        <div style="font-size: 0.8rem; color: var(--text-dim); margin-top: 0.25rem;">
          Recorded as "Unanswered"
        </div>
      `;
    }
  }

  // ==================== Option Selection & Submission ====================

  function renderOptionCards(options) {
    currentOptions = options;
    audienceOptionsGrid.innerHTML = '';

    options.forEach(opt => {
      const card = document.createElement('div');
      card.className = `kbc-option-card ${selectedOptionId === opt.id ? 'selected' : ''} ${hasSubmitted ? 'disabled' : ''}`;
      card.dataset.optionId = opt.id;

      card.innerHTML = `
        <div class="kbc-option-letter">${opt.id}</div>
        <div class="kbc-option-content">${escapeHtml(opt.text)}</div>
      `;

      card.addEventListener('click', () => {
        if (hasSubmitted || pollStatus !== 'active') return;
        selectOption(opt.id);
      });

      audienceOptionsGrid.appendChild(card);
    });
  }

  function selectOption(optionId) {
    selectedOptionId = optionId;

    // Highlight selected card visually
    document.querySelectorAll('.kbc-option-card').forEach(c => {
      if (c.dataset.optionId === optionId) {
        c.classList.add('selected');
      } else {
        c.classList.remove('selected');
      }
    });

    // Enable submit button
    btnSubmitAnswer.disabled = false;
    btnSubmitAnswer.textContent = `SUBMIT OPTION ${optionId}`;
  }

  btnSubmitAnswer.addEventListener('click', () => {
    if (!selectedOptionId || hasSubmitted || pollStatus !== 'active') return;

    btnSubmitAnswer.disabled = true;
    btnSubmitAnswer.textContent = 'Submitting...';

    socket.emit('submitResponse', {
      pollId: currentPollId,
      participantId,
      optionId: selectedOptionId
    });
  });

  function lockOptionsAfterSubmission() {
    // Disable cards
    document.querySelectorAll('.kbc-option-card').forEach(c => {
      c.classList.add('disabled');
    });

    btnSubmitAnswer.disabled = true;
    btnSubmitAnswer.textContent = '✅ ANSWER SUBMITTED';
    btnSubmitAnswer.className = 'btn btn-secondary btn-lg btn-block';
  }

  function showSubmissionSuccessMessage(msg) {
    submissionAlert.style.display = 'block';
    submissionAlert.style.background = 'rgba(16, 185, 129, 0.15)';
    submissionAlert.style.border = '1px solid rgba(16, 185, 129, 0.4)';
    submissionAlert.innerHTML = `
      <div style="font-size: 1.5rem; margin-bottom: 0.35rem;">🎉</div>
      <div style="font-weight: 700; color: #10b981; font-size: 1.1rem; margin-bottom: 0.25rem;">
        ${escapeHtml(msg)}
      </div>
      <div style="color: var(--text-muted); font-size: 0.9rem;">
        Your selection: <strong style="color: var(--accent-gold);">Option ${selectedOptionId}</strong>.
        Please wait until the 2-minute timer finishes for final results!
      </div>
    `;
  }

  // ==================== Timer Rendering ====================

  function updateTimer(seconds, formatted) {
    if (formatted) {
      audienceTimerDisplay.textContent = formatted;
    } else {
      const mins = Math.floor(seconds / 60);
      const secs = seconds % 60;
      audienceTimerDisplay.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }

    if (seconds <= 10) {
      audienceTimerDisplay.className = 'timer-display timer-danger';
    } else if (seconds <= 30) {
      audienceTimerDisplay.className = 'timer-display timer-warning';
    } else {
      audienceTimerDisplay.className = 'timer-display';
    }
  }

  // ==================== Utilities ====================

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function showToast(message, type = 'info') {
    const toastContainer = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `<span>${type === 'success' ? '✅' : type === 'error' ? '❌' : 'ℹ️'}</span><span>${message}</span>`;
    toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  }
});

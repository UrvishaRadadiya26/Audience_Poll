/**
 * Admin Panel JavaScript — KUP Live Poll
 * Handles socket communication, question editing (2-4 options), timer updates,
 * real-time responses, and Chart.js bar chart rendering.
 */

document.addEventListener('DOMContentLoaded', () => {
  const socket = io();

  // State
  let currentPoll = null;
  let currentResults = null;
  let chartInstance = null;
  let optionsList = [
    { id: 'A', text: 'Java' },
    { id: 'B', text: 'Python' },
    { id: 'C', text: 'JavaScript' },
    { id: 'D', text: 'C++' }
  ];

  // DOM Elements
  const activePollIdEl = document.getElementById('activePollId');
  const pollStatusBadgeEl = document.getElementById('pollStatusBadge');
  const audienceShareUrlEl = document.getElementById('audienceShareUrl');
  const btnCopyId = document.getElementById('btnCopyId');
  const btnCopyLink = document.getElementById('btnCopyLink');
  const btnToggleQR = document.getElementById('btnToggleQR');
  const qrDrawer = document.getElementById('qrDrawer');
  const qrCodeImg = document.getElementById('qrCodeImg');

  const questionInput = document.getElementById('questionInput');
  const optionsContainer = document.getElementById('optionsContainer');
  const btnAddOption = document.getElementById('btnAddOption');
  const btnSaveDraft = document.getElementById('btnSaveDraft');
  const btnStartPoll = document.getElementById('btnStartPoll');
  const btnEndPollLive = document.getElementById('btnEndPollLive');
  const btnCreateNewPoll = document.getElementById('btnCreateNewPoll');
  const btnCreateNewPollFromResults = document.getElementById('btnCreateNewPollFromResults');
  const durationSelect = document.getElementById('durationSelect');
  const editorLockNotice = document.getElementById('editorLockNotice');

  // Timer & Stats
  const adminTimerDisplay = document.getElementById('adminTimerDisplay');
  const statTotalAudience = document.getElementById('statTotalAudience');
  const statTotalResponses = document.getElementById('statTotalResponses');
  const statUnanswered = document.getElementById('statUnanswered');
  const statResponseRate = document.getElementById('statResponseRate');
  const liveOptionsBarsContainer = document.getElementById('liveOptionsBarsContainer');

  // Results & Chart
  const resultsCard = document.getElementById('resultsCard');
  const resultQuestionText = document.getElementById('resultQuestionText');
  const finalTotalAudience = document.getElementById('finalTotalAudience');
  const finalTotalResponses = document.getElementById('finalTotalResponses');
  const finalUnanswered = document.getElementById('finalUnanswered');
  const breakdownCardsGrid = document.getElementById('breakdownCardsGrid');

  // Modal
  const endPollModal = document.getElementById('endPollModal');
  const btnCancelEndPoll = document.getElementById('btnCancelEndPoll');
  const btnConfirmEndPoll = document.getElementById('btnConfirmEndPoll');

  // Initialize
  renderOptionInputs();

  // Socket Connect
  socket.emit('adminConnect');

  // ==================== Socket Listeners ====================

  socket.on('adminState', (data) => {
    applyPollState(data.poll, data.results);
    if (data.poll && data.poll.status === 'active' && data.remainingSeconds !== undefined) {
      updateTimerDisplay(data.remainingSeconds);
    } else if (data.poll && data.poll.duration) {
      updateTimerDisplay(data.poll.duration);
    }
  });

  socket.on('pollStatusUpdate', (data) => {
    applyPollState(data.poll, data.results);
  });

  socket.on('pollUpdated', (data) => {
    applyPollState(data.poll, data.results);
    showToast('Question and options saved!', 'success');
  });

  socket.on('pollStarted', (data) => {
    currentPoll = currentPoll || {};
    currentPoll.status = 'active';
    currentPoll.question = data.question;
    currentPoll.options = data.options;
    currentPoll.duration = data.duration;
    updateStatusBadge('active');
    updateTimerDisplay(data.remainingSeconds);
    lockEditor(true);
    btnStartPoll.style.display = 'none';
    btnEndPollLive.style.display = 'inline-flex';
    resultsCard.style.display = 'none';
    const durLabel = data.duration >= 60 ? `${data.duration / 60} minute(s)` : `${data.duration} seconds`;
    showToast(`Live poll started! Audience has ${durLabel} to answer.`, 'success');
  });

  socket.on('timerUpdate', (data) => {
    updateTimerDisplay(data.remainingSeconds, data.formattedTime);
  });

  socket.on('updateAudienceCount', (data) => {
    statTotalAudience.textContent = data.totalAudience;
    recalcUnansweredAndRate();
  });

  socket.on('updateResponseCount', (data) => {
    statTotalResponses.textContent = data.totalResponses;
    if (data.totalAudience !== undefined) {
      statTotalAudience.textContent = data.totalAudience;
    }
    recalcUnansweredAndRate();
    renderLiveBars(data.breakdown || []);
  });

  socket.on('pollEnded', (data) => {
    updateStatusBadge('ended');
    adminTimerDisplay.textContent = '00:00';
    adminTimerDisplay.className = 'timer-display';
    btnEndPollLive.style.display = 'none';
    btnStartPoll.style.display = 'inline-flex';
    btnStartPoll.disabled = true;
    btnStartPoll.textContent = 'Poll Ended';
    lockEditor(true);
    showToast('Poll has closed! Calculating final results...', 'success');
  });

  socket.on('pollResult', (results) => {
    currentResults = results;
    renderFinalResults(results);
  });

  socket.on('newPollCreated', (data) => {
    applyPollState(data.poll, data.results);
    lockEditor(false);
    btnStartPoll.disabled = false;
    btnStartPoll.textContent = '▶️ START POLL';
    btnStartPoll.style.display = 'inline-flex';
    btnEndPollLive.style.display = 'none';
    resultsCard.style.display = 'none';
    showToast('New Poll Session created! Enter your question.', 'success');
  });

  socket.on('error', (err) => {
    showToast(err.message || 'An error occurred', 'error');
  });

  // ==================== UI State Handlers ====================

  function applyPollState(poll, results) {
    if (!poll) return;
    currentPoll = poll;
    currentResults = results;

    activePollIdEl.textContent = poll.pollId;

    // Audience Join link
    const host = window.location.origin;
    const shareUrl = `${host}/audience/${poll.pollId}`;
    audienceShareUrlEl.value = shareUrl;

    // Load QR Code
    loadQRCode(shareUrl);

    // Question & options
    if (poll.question) {
      questionInput.value = poll.question;
    }
    if (Array.isArray(poll.options) && poll.options.length >= 2) {
      optionsList = poll.options.map(opt => ({ id: opt.id, text: opt.text }));
      renderOptionInputs();
    }

    // Status
    updateStatusBadge(poll.status);

    // Duration dropdown sync
    if (poll.duration && durationSelect) {
      durationSelect.value = String(poll.duration);
    }

    if (poll.status === 'active') {
      lockEditor(true);
      btnStartPoll.style.display = 'none';
      btnEndPollLive.style.display = 'inline-flex';
      resultsCard.style.display = 'none';
    } else if (poll.status === 'ended') {
      lockEditor(true);
      btnStartPoll.style.display = 'none';
      btnEndPollLive.style.display = 'none';
      if (results) {
        renderFinalResults(results);
      }
    } else {
      // draft
      lockEditor(false);
      btnStartPoll.style.display = 'inline-flex';
      btnStartPoll.disabled = false;
      btnStartPoll.textContent = '▶️ START POLL';
      btnEndPollLive.style.display = 'none';
      resultsCard.style.display = 'none';
      const chosenDuration = poll.duration || parseInt(durationSelect.value, 10) || 120;
      updateTimerDisplay(chosenDuration);
    }

    if (results) {
      statTotalAudience.textContent = results.totalAudience || 0;
      statTotalResponses.textContent = results.totalResponses || 0;
      statUnanswered.textContent = results.unanswered || 0;
      recalcUnansweredAndRate();
      renderLiveBars(results.breakdown || []);
    }
  }

  function updateStatusBadge(status) {
    pollStatusBadgeEl.className = 'status-badge';
    if (status === 'active') {
      pollStatusBadgeEl.classList.add('status-live');
      pollStatusBadgeEl.textContent = 'LIVE NOW';
    } else if (status === 'ended') {
      pollStatusBadgeEl.classList.add('status-ended');
      pollStatusBadgeEl.textContent = 'CONCLUDED';
    } else {
      pollStatusBadgeEl.classList.add('status-draft');
      pollStatusBadgeEl.textContent = 'DRAFT MODE';
    }
  }

  function lockEditor(locked) {
    questionInput.disabled = locked;
    btnAddOption.disabled = locked;
    btnSaveDraft.disabled = locked;
    durationSelect.disabled = locked;
    editorLockNotice.style.display = locked ? 'inline' : 'none';

    document.querySelectorAll('.option-text-input').forEach(input => {
      input.disabled = locked;
    });
    document.querySelectorAll('.btn-icon-del').forEach(btn => {
      btn.disabled = locked;
    });
  }

  function updateTimerDisplay(seconds, formatted) {
    if (formatted) {
      adminTimerDisplay.textContent = formatted;
    } else {
      const mins = Math.floor(seconds / 60);
      const secs = seconds % 60;
      adminTimerDisplay.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }

    // Color pulse
    if (seconds <= 10) {
      adminTimerDisplay.className = 'timer-display timer-danger';
    } else if (seconds <= 30) {
      adminTimerDisplay.className = 'timer-display timer-warning';
    } else {
      adminTimerDisplay.className = 'timer-display';
    }
  }

  function recalcUnansweredAndRate() {
    const total = parseInt(statTotalAudience.textContent, 10) || 0;
    const answered = parseInt(statTotalResponses.textContent, 10) || 0;
    const unanswered = Math.max(0, total - answered);
    statUnanswered.textContent = unanswered;

    const rate = total > 0 ? Math.round((answered / total) * 100) : 0;
    statResponseRate.textContent = `${rate}%`;
  }

  function renderLiveBars(breakdown) {
    if (!breakdown || breakdown.length === 0) {
      // Build dummy zero breakdown from options
      breakdown = optionsList.map(opt => ({
        id: opt.id,
        text: opt.text,
        count: 0,
        percentOfResponses: 0
      }));
    }

    liveOptionsBarsContainer.innerHTML = '';
    breakdown.forEach(item => {
      const row = document.createElement('div');
      row.className = 'response-bar-item';
      row.innerHTML = `
        <div class="response-bar-header">
          <span><strong>Option ${item.id}:</strong> ${escapeHtml(item.text)}</span>
          <span style="font-family: monospace; font-size: 1rem; color: var(--accent-gold);">
            ${item.count} votes (${item.percentOfResponses || 0}%)
          </span>
        </div>
        <div class="response-bar-track">
          <div class="response-bar-fill fill-${item.id}" style="width: ${item.percentOfResponses || 0}%;"></div>
        </div>
      `;
      liveOptionsBarsContainer.appendChild(row);
    });
  }

  // ==================== Dynamic 2-4 Options Management ====================

  function renderOptionInputs() {
    optionsContainer.innerHTML = '';
    const letters = ['A', 'B', 'C', 'D'];

    optionsList.forEach((opt, index) => {
      opt.id = letters[index];
      const row = document.createElement('div');
      row.className = 'option-input-row';
      row.innerHTML = `
        <div class="option-badge-label">${opt.id}</div>
        <input type="text" class="form-input option-text-input" data-index="${index}" value="${escapeHtml(opt.text)}" placeholder="Enter Option ${opt.id}" required>
        ${optionsList.length > 2 ? `<button type="button" class="btn-icon-del" data-index="${index}" title="Remove Option">✕</button>` : ''}
      `;
      optionsContainer.appendChild(row);
    });

    // Attach listeners
    document.querySelectorAll('.option-text-input').forEach(input => {
      input.addEventListener('input', (e) => {
        const idx = parseInt(e.target.dataset.index, 10);
        optionsList[idx].text = e.target.value;
      });
    });

    document.querySelectorAll('.btn-icon-del').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const idx = parseInt(e.target.dataset.index, 10);
        if (optionsList.length > 2) {
          optionsList.splice(idx, 1);
          renderOptionInputs();
        }
      });
    });

    // Control add button visibility (max 4 options)
    btnAddOption.style.display = optionsList.length < 4 ? 'inline-flex' : 'none';
  }

  btnAddOption.addEventListener('click', () => {
    if (optionsList.length < 4) {
      const letters = ['A', 'B', 'C', 'D'];
      const nextLetter = letters[optionsList.length];
      optionsList.push({ id: nextLetter, text: `Option ${nextLetter}` });
      renderOptionInputs();
    }
  });

  // Duration selector change listener
  durationSelect.addEventListener('change', () => {
    const chosenSeconds = parseInt(durationSelect.value, 10) || 120;
    updateTimerDisplay(chosenSeconds);
    if (currentPoll && currentPoll.status === 'draft') {
      currentPoll.duration = chosenSeconds;
      socket.emit('adminUpdatePoll', {
        question: questionInput.value.trim(),
        options: optionsList.map(opt => opt.text.trim()),
        duration: chosenSeconds
      });
      showToast(`Duration set to ${chosenSeconds} seconds`, 'info');
    }
  });

  // Save Draft
  btnSaveDraft.addEventListener('click', () => {
    savePollDraft();
  });

  function savePollDraft() {
    const question = questionInput.value.trim();
    if (!question) {
      showToast('Please enter a question text!', 'error');
      questionInput.focus();
      return false;
    }

    const options = optionsList.map(opt => opt.text.trim());
    if (options.some(t => !t)) {
      showToast('All options must have non-empty text!', 'error');
      return false;
    }

    const duration = parseInt(durationSelect.value, 10) || 120;

    socket.emit('adminUpdatePoll', {
      question,
      options,
      duration
    });
    return true;
  }

  // Start Poll
  btnStartPoll.addEventListener('click', () => {
    if (savePollDraft()) {
      const duration = parseInt(durationSelect.value, 10) || 120;
      socket.emit('startPoll', { duration });
    }
  });

  // End Poll Early Modal
  btnEndPollLive.addEventListener('click', () => {
    endPollModal.classList.add('active');
  });

  btnCancelEndPoll.addEventListener('click', () => {
    endPollModal.classList.remove('active');
  });

  btnConfirmEndPoll.addEventListener('click', () => {
    endPollModal.classList.remove('active');
    if (currentPoll && currentPoll.pollId) {
      socket.emit('endPoll', { pollId: currentPoll.pollId });
    }
  });

  // Create New Poll
  btnCreateNewPoll.addEventListener('click', () => {
    handleCreateNewPoll();
  });

  btnCreateNewPollFromResults.addEventListener('click', () => {
    handleCreateNewPoll();
  });

  function handleCreateNewPoll() {
    optionsList = [
      { id: 'A', text: '' },
      { id: 'B', text: '' },
      { id: 'C', text: '' },
      { id: 'D', text: '' }
    ];
    questionInput.value = '';
    renderOptionInputs();
    socket.emit('createNewPoll', {
      question: '',
      options: ['Option A', 'Option B', 'Option C', 'Option D'],
      duration: parseInt(durationSelect.value, 10) || 120
    });
  }

  // ==================== Chart.js Bar Chart ====================

  function renderFinalResults(results) {
    resultsCard.style.display = 'block';
    resultQuestionText.textContent = results.question || questionInput.value;
    finalTotalAudience.textContent = results.totalAudience;
    finalTotalResponses.textContent = results.totalResponses;
    finalUnanswered.textContent = results.unanswered;

    // Breakdown Cards
    breakdownCardsGrid.innerHTML = '';
    (results.breakdown || []).forEach(item => {
      const card = document.createElement('div');
      card.className = 'stat-card';
      card.innerHTML = `
        <div class="stat-label">Option ${item.id} (${escapeHtml(item.text)})</div>
        <div class="stat-value" style="color: var(--accent-gold); font-size: 1.8rem;">
          ${item.count} <span style="font-size: 1rem; color: var(--text-muted);">(${item.percentOfResponses}%)</span>
        </div>
      `;
      breakdownCardsGrid.appendChild(card);
    });

    // Unanswered card
    const unCard = document.createElement('div');
    unCard.className = 'stat-card';
    unCard.innerHTML = `
      <div class="stat-label">Unanswered</div>
      <div class="stat-value" style="color: #ef4444; font-size: 1.8rem;">
        ${results.unanswered} <span style="font-size: 1rem; color: var(--text-muted);">(${results.unansweredPercent}%)</span>
      </div>
    `;
    breakdownCardsGrid.appendChild(unCard);

    // Build Chart.js Bar Chart
    const ctx = document.getElementById('audienceResultsChart').getContext('2d');
    const labels = (results.breakdown || []).map(b => `Option ${b.id}: ${b.text}`);
    const dataCounts = (results.breakdown || []).map(b => b.count);
    const dataPercents = (results.breakdown || []).map(b => b.percentOfResponses);

    const colors = [
      'rgba(255, 190, 11, 0.85)',
      'rgba(0, 245, 212, 0.85)',
      'rgba(58, 134, 255, 0.85)',
      'rgba(255, 0, 110, 0.85)'
    ];

    const borderColors = [
      '#ffbe0b',
      '#00f5d4',
      '#3a86ff',
      '#ff006e'
    ];

    if (chartInstance) {
      chartInstance.destroy();
    }

    chartInstance = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [{
          label: 'Audience Votes',
          data: dataCounts,
          backgroundColor: colors.slice(0, labels.length),
          borderColor: borderColors.slice(0, labels.length),
          borderWidth: 2,
          borderRadius: 8,
          maxBarThickness: 70
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: false
          },
          tooltip: {
            callbacks: {
              label: function(context) {
                const idx = context.dataIndex;
                const count = context.raw;
                const pct = dataPercents[idx] || 0;
                return ` Votes: ${count} (${pct}%)`;
              }
            }
          }
        },
        scales: {
          x: {
            grid: {
              color: 'rgba(255, 255, 255, 0.05)'
            },
            ticks: {
              color: '#f8fafc',
              font: {
                family: 'Outfit',
                size: 13,
                weight: '600'
              }
            }
          },
          y: {
            beginAtZero: true,
            ticks: {
              precision: 0,
              color: '#94a3b8',
              font: {
                family: 'Outfit',
                size: 12
              }
            },
            grid: {
              color: 'rgba(255, 255, 255, 0.08)'
            }
          }
        },
        animation: {
          duration: 1200,
          easing: 'easeOutQuart'
        }
      }
    });

    // Smooth scroll to results
    resultsCard.scrollIntoView({ behavior: 'smooth' });
  }

  // ==================== QR Code & Sharing ====================

  async function loadQRCode(url) {
    try {
      const res = await fetch(`/api/qrcode?url=${encodeURIComponent(url)}`);
      const data = await res.json();
      if (data.success && data.qrDataUrl) {
        qrCodeImg.src = data.qrDataUrl;
      }
    } catch (err) {
      console.warn('QR Code generation failed:', err);
    }
  }

  btnToggleQR.addEventListener('click', () => {
    qrDrawer.style.display = qrDrawer.style.display === 'none' ? 'block' : 'none';
  });

  btnCopyLink.addEventListener('click', () => {
    navigator.clipboard.writeText(audienceShareUrlEl.value).then(() => {
      showToast('Audience join link copied to clipboard!', 'success');
    }).catch(() => {
      audienceShareUrlEl.select();
      document.execCommand('copy');
      showToast('Link copied!', 'success');
    });
  });

  btnCopyId.addEventListener('click', () => {
    navigator.clipboard.writeText(activePollIdEl.textContent).then(() => {
      showToast('Poll ID copied!', 'success');
    });
  });

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

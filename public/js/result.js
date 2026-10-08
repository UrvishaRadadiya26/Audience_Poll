/**
 * Big Screen Studio Result JavaScript — KUP Live Poll
 * Displays full-screen KBC-style live bar chart and statistics with animations.
 */

document.addEventListener('DOMContentLoaded', () => {
  const socket = io();

  let targetPollId = null;
  let chartInstance = null;
  let hasCelebrated = false;

  // DOM Elements
  const displayPollId = document.getElementById('displayPollId');
  const resultStatusBadge = document.getElementById('resultStatusBadge');
  const presentationQuestion = document.getElementById('presentationQuestion');
  const activeTimerBadge = document.getElementById('activeTimerBadge');
  const displayTimer = document.getElementById('displayTimer');
  const percentageGrid = document.getElementById('percentageGrid');

  const metricTotalAudience = document.getElementById('metricTotalAudience');
  const metricTotalResponses = document.getElementById('metricTotalResponses');
  const metricUnanswered = document.getElementById('metricUnanswered');

  // Check URL path for pollId (/result/KUP-4821)
  const pathParts = window.location.pathname.split('/').filter(Boolean);
  if (pathParts.length >= 2 && pathParts[0] === 'result') {
    targetPollId = pathParts[1].toUpperCase();
  }

  // Socket Connect
  socket.on('connect', () => {
    socket.emit('joinResultScreen', { pollId: targetPollId });
  });

  // Fetch initial state via REST API as fallback / immediate render
  const apiUrl = targetPollId ? `/api/poll/${targetPollId}` : '/api/poll/current';
  fetch(apiUrl)
    .then(r => r.json())
    .then(data => {
      if (data.results) {
        targetPollId = data.results.pollId;
        displayPollId.textContent = targetPollId;
        renderResults(data.results);
      }
    })
    .catch(() => {});

  // Socket Events
  socket.on('pollResult', (results) => {
    renderResults(results);
    if (results.status === 'ended' && !hasCelebrated) {
      hasCelebrated = true;
      triggerConfetti();
    }
  });

  socket.on('updateResponseCount', (data) => {
    metricTotalResponses.textContent = data.totalResponses || 0;
    if (data.totalAudience !== undefined) {
      metricTotalAudience.textContent = data.totalAudience;
    }
    if (data.unanswered !== undefined) {
      metricUnanswered.textContent = data.unanswered;
    }
    if (data.breakdown) {
      updateChartData(data.breakdown);
      renderPercentageGrid(data.breakdown);
    }
  });

  socket.on('updateAudienceCount', (data) => {
    metricTotalAudience.textContent = data.totalAudience || 0;
    const answered = parseInt(metricTotalResponses.textContent, 10) || 0;
    metricUnanswered.textContent = Math.max(0, data.totalAudience - answered);
  });

  socket.on('timerUpdate', (data) => {
    displayTimer.textContent = data.formattedTime;
    if (data.remainingSeconds <= 10) {
      activeTimerBadge.className = 'status-badge status-ended';
    } else if (data.remainingSeconds <= 30) {
      activeTimerBadge.className = 'status-badge status-draft';
    } else {
      activeTimerBadge.className = 'status-badge status-live';
    }
  });

  socket.on('pollEnded', (data) => {
    resultStatusBadge.className = 'status-badge status-ended';
    resultStatusBadge.textContent = 'Poll Closed';
    displayTimer.textContent = '00:00';
    if (data.results) {
      renderResults(data.results);
    }
    if (!hasCelebrated) {
      hasCelebrated = true;
      triggerConfetti();
    }
  });

  function renderResults(results) {
    if (!results) return;

    targetPollId = results.pollId;
    displayPollId.textContent = targetPollId;
    presentationQuestion.textContent = results.question;

    metricTotalAudience.textContent = results.totalAudience || 0;
    metricTotalResponses.textContent = results.totalResponses || 0;
    metricUnanswered.textContent = results.unanswered || 0;

    if (results.status === 'active') {
      resultStatusBadge.className = 'status-badge status-live';
      resultStatusBadge.textContent = 'Live Voting';
    } else if (results.status === 'ended') {
      resultStatusBadge.className = 'status-badge status-ended';
      resultStatusBadge.textContent = 'Concluded';
      displayTimer.textContent = '00:00';
    } else {
      // draft
      resultStatusBadge.className = 'status-badge status-draft';
      resultStatusBadge.textContent = 'Waiting';
      const dur = results.duration || 120;
      const mins = Math.floor(dur / 60);
      const secs = dur % 60;
      displayTimer.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }

    if (results.breakdown) {
      updateChartData(results.breakdown);
      renderPercentageGrid(results.breakdown);
    }
  }

  function updateChartData(breakdown) {
    const ctx = document.getElementById('bigScreenChart').getContext('2d');
    const labels = breakdown.map(b => `Option ${b.id}: ${b.text}`);
    const dataCounts = breakdown.map(b => b.count);
    const dataPercents = breakdown.map(b => b.percentOfResponses);

    const colors = [
      'rgba(255, 190, 11, 0.9)',
      'rgba(0, 245, 212, 0.9)',
      'rgba(58, 134, 255, 0.9)',
      'rgba(255, 0, 110, 0.9)'
    ];

    const borderColors = [
      '#ffbe0b',
      '#00f5d4',
      '#3a86ff',
      '#ff006e'
    ];

    if (chartInstance) {
      chartInstance.data.labels = labels;
      chartInstance.data.datasets[0].data = dataCounts;
      chartInstance.data.datasets[0].backgroundColor = colors.slice(0, labels.length);
      chartInstance.data.datasets[0].borderColor = borderColors.slice(0, labels.length);
      chartInstance.options.plugins.tooltip.callbacks.label = function(context) {
        const idx = context.dataIndex;
        const count = context.raw;
        const pct = dataPercents[idx] || 0;
        return ` Votes: ${count} (${pct}%)`;
      };
      chartInstance.update();
      return;
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
          borderRadius: 12,
          maxBarThickness: 90
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            padding: 12,
            titleFont: { size: 14, family: 'Outfit' },
            bodyFont: { size: 14, family: 'Outfit', weight: 'bold' },
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
            grid: { color: 'rgba(255, 255, 255, 0.05)' },
            ticks: {
              color: '#f8fafc',
              font: { family: 'Outfit', size: 14, weight: '700' }
            }
          },
          y: {
            beginAtZero: true,
            ticks: {
              precision: 0,
              color: '#94a3b8',
              font: { family: 'Outfit', size: 13 }
            },
            grid: { color: 'rgba(255, 255, 255, 0.08)' }
          }
        },
        animation: {
          duration: 800,
          easing: 'easeOutQuart'
        }
      }
    });
  }

  function renderPercentageGrid(breakdown) {
    percentageGrid.innerHTML = '';
    breakdown.forEach(item => {
      const card = document.createElement('div');
      card.className = 'stat-card';
      card.innerHTML = `
        <div class="stat-label">Option ${item.id}</div>
        <div style="font-size: 1rem; color: #fff; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin: 0.25rem 0;">
          ${escapeHtml(item.text)}
        </div>
        <div class="stat-value" style="color: var(--accent-gold); font-size: 2rem;">
          ${item.percentOfResponses}%
        </div>
        <div style="font-size: 0.8rem; color: var(--text-muted);">
          ${item.count} votes
        </div>
      `;
      percentageGrid.appendChild(card);
    });
  }

  function triggerConfetti() {
    if (typeof confetti === 'function') {
      confetti({
        particleCount: 120,
        spread: 80,
        origin: { y: 0.6 }
      });
    }
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
});

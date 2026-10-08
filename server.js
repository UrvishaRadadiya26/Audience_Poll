const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const QRCode = require('qrcode');
const pollStore = require('./data/pollData');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Global timer interval reference
let activeTimerInterval = null;

/**
 * Helper to start server-side 2-minute countdown timer
 */
function startServerTimer(poll) {
  if (activeTimerInterval) {
    clearInterval(activeTimerInterval);
    activeTimerInterval = null;
  }

  activeTimerInterval = setInterval(() => {
    const remainingSeconds = pollStore.getRemainingSeconds(poll.pollId);
    const formattedTime = pollStore.formatTime(remainingSeconds);

    // Broadcast timer tick to all connected clients in the poll room
    io.to(poll.pollId).emit('timerUpdate', {
      pollId: poll.pollId,
      remainingSeconds,
      formattedTime
    });

    // When timer expires (0 seconds left)
    if (remainingSeconds <= 0) {
      clearInterval(activeTimerInterval);
      activeTimerInterval = null;

      pollStore.endPoll(poll.pollId);
      const results = pollStore.getResults(poll.pollId);

      // Notify audience that poll ended
      io.to(poll.pollId).emit('pollEnded', {
        pollId: poll.pollId,
        message: 'Poll Closed. Thank you for participating!',
        results
      });

      // Send final results to admin and results screens
      io.to('admin').emit('pollResult', results);
      io.to(`results_${poll.pollId}`).emit('pollResult', results);
      console.log(`[Timer Ended] Poll ${poll.pollId} closed automatically.`);
    }
  }, 1000);
}

/**
 * Helper to stop server timer manually
 */
function stopServerTimer() {
  if (activeTimerInterval) {
    clearInterval(activeTimerInterval);
    activeTimerInterval = null;
  }
}

// ==================== REST ROUTES ====================

// Audience direct link: /audience/:pollId
app.get('/audience/:pollId', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'audience.html'));
});

// Audience general link: /audience
app.get('/audience', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'audience.html'));
});

// Admin panel: /admin
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Big-Screen KBC Result display: /result or /result/:pollId
app.get('/result/:pollId', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'result.html'));
});

app.get('/result', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'result.html'));
});

// API: Get current active poll info
app.get('/api/poll/current', (req, res) => {
  const poll = pollStore.getActivePoll();
  const results = pollStore.getResults(poll.pollId);
  res.json({ success: true, poll, results });
});

// API: Get specific poll info
app.get('/api/poll/:pollId', (req, res) => {
  const poll = pollStore.getPollById(req.params.pollId);
  if (!poll) {
    return res.status(404).json({ success: false, message: 'Poll not found' });
  }
  const results = pollStore.getResults(poll.pollId);
  res.json({ success: true, poll, results });
});

// API: Generate QR Code for Join URL
app.get('/api/qrcode', async (req, res) => {
  try {
    const text = req.query.url || req.query.text;
    if (!text) {
      return res.status(400).json({ error: 'url parameter required' });
    }
    const qrDataUrl = await QRCode.toDataURL(text, {
      width: 280,
      margin: 2,
      color: {
        dark: '#0a0e27',
        light: '#ffffff'
      }
    });
    res.json({ success: true, qrDataUrl });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==================== SOCKET.IO EVENTS ====================

io.on('connection', (socket) => {
  console.log(`[Socket Connected] ID: ${socket.id}`);

  // 1. Admin connects
  socket.on('adminConnect', async () => {
    socket.join('admin');
    const poll = pollStore.getActivePoll();
    socket.join(poll.pollId);

    const results = pollStore.getResults(poll.pollId);
    socket.emit('adminState', {
      poll,
      results,
      remainingSeconds: pollStore.getRemainingSeconds(poll.pollId)
    });
  });

  // 2. Admin creates / updates poll question & options (in draft mode)
  socket.on('adminCreatePoll', ({ question, options, duration }) => {
    try {
      const poll = pollStore.createNewPoll(question, options, duration || 120);
      socket.join(poll.pollId);

      io.emit('pollCreated', {
        pollId: poll.pollId,
        question: poll.question,
        options: poll.options,
        status: poll.status,
        duration: poll.duration
      });

      const results = pollStore.getResults(poll.pollId);
      io.to('admin').emit('pollStatusUpdate', { poll, results });
    } catch (err) {
      socket.emit('error', { message: err.message });
    }
  });

  // 3. Admin updates question/options/duration before starting
  socket.on('adminUpdatePoll', ({ question, options, duration }) => {
    try {
      const poll = pollStore.updatePoll(question, options, duration);
      const results = pollStore.getResults(poll.pollId);

      io.to('admin').emit('pollUpdated', { poll, results });
      io.to(poll.pollId).emit('pollDetailsUpdated', {
        pollId: poll.pollId,
        question: poll.question,
        options: poll.options,
        duration: poll.duration
      });
    } catch (err) {
      socket.emit('error', { message: err.message });
    }
  });

  // 4. Admin starts live poll (Countdown starts with chosen duration)
  socket.on('startPoll', (data = {}) => {
    try {
      const duration = data && data.duration ? data.duration : undefined;
      const poll = pollStore.startPoll(duration);
      startServerTimer(poll);

      const remainingSeconds = pollStore.getRemainingSeconds(poll.pollId);
      const formattedTime = pollStore.formatTime(remainingSeconds);

      // Notify audience & admin
      io.to(poll.pollId).emit('pollStarted', {
        pollId: poll.pollId,
        question: poll.question,
        options: poll.options,
        duration: poll.duration,
        startTime: poll.startTime,
        endTime: poll.endTime,
        remainingSeconds,
        formattedTime
      });

      const results = pollStore.getResults(poll.pollId);
      io.to('admin').emit('pollStatusUpdate', { poll, results });
      console.log(`[Poll Started] ${poll.pollId} - Duration: ${poll.duration}s`);
    } catch (err) {
      socket.emit('error', { message: err.message });
    }
  });

  // 5. Admin ends poll manually
  socket.on('endPoll', ({ pollId }) => {
    try {
      stopServerTimer();
      const poll = pollStore.endPoll(pollId);
      if (!poll) return;

      const results = pollStore.getResults(poll.pollId);

      // Broadcast poll ended to audience
      io.to(poll.pollId).emit('pollEnded', {
        pollId: poll.pollId,
        message: 'Poll ended by Admin. Thank you for participating!',
        results
      });

      // Send results to admin & display screens
      io.to('admin').emit('pollResult', results);
      io.to(`results_${poll.pollId}`).emit('pollResult', results);
      console.log(`[Poll Ended Manually] ${poll.pollId}`);
    } catch (err) {
      socket.emit('error', { message: err.message });
    }
  });

  // 6. Admin creates a new poll session
  socket.on('createNewPoll', ({ question, options, duration }) => {
    stopServerTimer();
    const newPoll = pollStore.createNewPoll(question, options, duration || 120);
    socket.join(newPoll.pollId);

    const results = pollStore.getResults(newPoll.pollId);
    io.to('admin').emit('newPollCreated', { poll: newPoll, results });
    io.emit('pollStatusUpdate', { poll: newPoll, results });
    console.log(`[New Poll Created] Session: ${newPoll.pollId}`);
  });

  // 7. Admin requests current poll results
  socket.on('requestPollResults', ({ pollId }) => {
    const results = pollStore.getResults(pollId);
    if (results) {
      socket.emit('pollResult', results);
    }
  });

  // 8. Audience joins poll
  socket.on('joinPoll', ({ pollId, participantId, name }) => {
    try {
      const targetPollId = pollId || (pollStore.getActivePoll() ? pollStore.getActivePoll().pollId : null);
      if (!targetPollId) {
        return socket.emit('joinError', { message: 'No active poll found' });
      }

      const poll = pollStore.getPollById(targetPollId) || pollStore.getActivePoll();
      if (!poll) {
        return socket.emit('joinError', { message: `Poll ${targetPollId} does not exist.` });
      }

      const { participant } = pollStore.registerParticipant(poll.pollId, participantId, name, socket.id);
      socket.join(poll.pollId);

      const remainingSeconds = pollStore.getRemainingSeconds(poll.pollId);
      const formattedTime = pollStore.formatTime(remainingSeconds);

      // Send initial state back to the joining audience member
      socket.emit('audienceJoined', {
        success: true,
        pollId: poll.pollId,
        question: poll.question,
        options: poll.options,
        status: poll.status,
        duration: poll.duration,
        remainingSeconds,
        formattedTime,
        participant: {
          participantId: participant.participantId,
          name: participant.name,
          selectedOption: participant.selectedOption,
          submitted: participant.submitted
        }
      });

      // Update audience count for Admin and all participants
      const totalAudience = Object.keys(poll.audience).length;
      io.to('admin').emit('updateAudienceCount', {
        pollId: poll.pollId,
        totalAudience
      });
      io.to(poll.pollId).emit('updateAudienceCount', {
        pollId: poll.pollId,
        totalAudience
      });

      console.log(`[Audience Joined] ${participant.name} (${participant.participantId}) -> ${poll.pollId}`);
    } catch (err) {
      socket.emit('joinError', { message: err.message });
    }
  });

  // 9. Audience submits response
  socket.on('submitResponse', ({ pollId, participantId, optionId }) => {
    try {
      const result = pollStore.recordResponse(pollId, participantId, optionId);

      if (!result.success) {
        return socket.emit('responseError', { message: result.message });
      }

      // Confirm to the audience user
      socket.emit('responseSubmitted', {
        success: true,
        optionId,
        message: 'Your response has been submitted successfully.'
      });

      // Send real-time response count updates to Admin and results screens
      const poll = result.poll;
      const results = pollStore.getResults(poll.pollId);

      io.to('admin').emit('updateResponseCount', {
        pollId: poll.pollId,
        responses: poll.responses,
        totalResponses: results.totalResponses,
        totalAudience: results.totalAudience,
        unanswered: results.unanswered,
        breakdown: results.breakdown
      });

      io.to(`results_${poll.pollId}`).emit('updateResponseCount', {
        pollId: poll.pollId,
        responses: poll.responses,
        totalResponses: results.totalResponses,
        totalAudience: results.totalAudience,
        unanswered: results.unanswered,
        breakdown: results.breakdown
      });

      console.log(`[Response Recorded] Poll: ${poll.pollId}, Option: ${optionId}, Total: ${results.totalResponses}`);
    } catch (err) {
      socket.emit('responseError', { message: err.message });
    }
  });

  // 10. Result presentation screen connection
  socket.on('joinResultScreen', ({ pollId }) => {
    const targetPollId = pollId || (pollStore.getActivePoll() ? pollStore.getActivePoll().pollId : null);
    if (targetPollId) {
      socket.join(`results_${targetPollId}`);
      const results = pollStore.getResults(targetPollId);
      if (results) {
        socket.emit('pollResult', results);
      }
    }
  });

  // Disconnection handling
  socket.on('disconnect', () => {
    console.log(`[Socket Disconnected] ID: ${socket.id}`);
  });
});

// Start listening with port fallback resilience
let currentPort = PORT;

function startServer(portToTry) {
  server.listen(portToTry, () => {
    console.log(`====================================================`);
    console.log(`  KUP LIVE POLL SERVER RUNNING SUCCESSFULLY!`);
    console.log(`  --------------------------------------------------`);
    console.log(`  Admin Panel:    http://localhost:${portToTry}/admin`);
    console.log(`  Audience Join:  http://localhost:${portToTry}/audience`);
    console.log(`  Big Screen TV:  http://localhost:${portToTry}/result`);
    console.log(`====================================================`);
  });
}

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.warn(`[Port Busy] Port ${currentPort} is already in use. Retrying on port ${Number(currentPort) + 1}...`);
    currentPort = Number(currentPort) + 1;
    setTimeout(() => {
      startServer(currentPort);
    }, 1000);
  } else {
    console.error('Server error:', err);
  }
});

startServer(currentPort);

// Graceful shutdown
process.on('SIGINT', () => {
  stopServerTimer();
  process.exit(0);
});

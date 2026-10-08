/**
 * In-Memory Data Store for KUP Live Poll
 * Handles Poll lifecycle, Options, Participants, Real-time responses, and Results.
 */

class PollStore {
  constructor() {
    this.activePoll = null;
    this.pollHistory = new Map(); // pollId -> poll archive
    this.timerInterval = null;
  }

  /**
   * Generate a unique Poll ID in the format KUP-XXXX
   */
  generatePollId() {
    const randomDigits = Math.floor(1000 + Math.random() * 9000);
    return `KUP-${randomDigits}`;
  }

  /**
   * Create or initialize a new draft poll
   */
  createPoll(question = '', options = [], duration = 120) {
    const pollId = this.generatePollId();

    // Standardize options into [{ id: 'A', text: '...' }, ...]
    const optionLabels = ['A', 'B', 'C', 'D'];
    const formattedOptions = (options.length > 0 ? options : [
      'Java',
      'Python',
      'JavaScript',
      'C++'
    ]).slice(0, 4).map((optText, index) => ({
      id: optionLabels[index],
      text: typeof optText === 'object' && optText.text ? optText.text.trim() : String(optText).trim()
    }));

    const responsesInit = {};
    formattedOptions.forEach(opt => {
      responsesInit[opt.id] = 0;
    });

    const newPoll = {
      pollId,
      question: question.trim() || 'Which programming language is used with Node.js?',
      options: formattedOptions,
      status: 'draft', // 'draft' | 'active' | 'ended'
      startTime: null,
      endTime: null,
      duration: Math.max(10, parseInt(duration, 10) || 120),
      audience: {}, // participantId -> { participantId, name, socketId, selectedOption, submitted, joinTime }
      responses: responsesInit,
      createdAt: new Date().toISOString()
    };

    this.activePoll = newPoll;
    this.pollHistory.set(pollId, newPoll);
    return newPoll;
  }

  /**
   * Get the current active poll (or draft/ended poll)
   */
  getActivePoll() {
    if (!this.activePoll) {
      // Create a default initial poll so admin always has one ready
      return this.createPoll();
    }
    return this.activePoll;
  }

  /**
   * Find a poll by its pollId
   */
  getPollById(pollId) {
    if (this.activePoll && this.activePoll.pollId === pollId) {
      return this.activePoll;
    }
    return this.pollHistory.get(pollId) || null;
  }

  /**
   * Update question, options, and duration while in 'draft' mode
   */
  updatePoll(question, options, duration) {
    const poll = this.getActivePoll();
    if (poll.status === 'active') {
      throw new Error('Cannot edit question while poll is actively running');
    }

    if (duration !== undefined && duration !== null) {
      poll.duration = Math.max(5, parseInt(duration, 10) || 120);
    }

    if (question && question.trim()) {
      poll.question = question.trim();
    }

    if (Array.isArray(options) && options.length >= 2 && options.length <= 4) {
      const optionLabels = ['A', 'B', 'C', 'D'];
      poll.options = options.slice(0, 4).map((opt, index) => ({
        id: optionLabels[index],
        text: typeof opt === 'object' && opt.text ? opt.text.trim() : String(opt).trim()
      }));

      // Reset response counts for the updated options
      const newResponses = {};
      poll.options.forEach(opt => {
        newResponses[opt.id] = 0;
      });
      poll.responses = newResponses;
    }

    return poll;
  }

  /**
   * Start the live poll session
   */
  startPoll(duration) {
    const poll = this.getActivePoll();
    if (poll.status === 'active') {
      return poll; // Already active
    }

    if (!poll.question || !poll.options || poll.options.length < 2) {
      throw new Error('Poll must have a question and at least 2 options');
    }

    if (duration !== undefined && duration !== null) {
      poll.duration = Math.max(5, parseInt(duration, 10) || poll.duration || 120);
    }

    poll.status = 'active';
    poll.startTime = Date.now();
    poll.endTime = poll.startTime + (poll.duration * 1000);

    return poll;
  }

  /**
   * End the poll session
   */
  endPoll(pollId) {
    const poll = pollId ? this.getPollById(pollId) : this.getActivePoll();
    if (!poll) return null;

    poll.status = 'ended';
    if (!poll.endTime || Date.now() < poll.endTime) {
      poll.endTime = Date.now();
    }

    return poll;
  }

  /**
   * Calculate remaining seconds for the active poll
   */
  getRemainingSeconds(pollId) {
    const poll = pollId ? this.getPollById(pollId) : this.getActivePoll();
    if (!poll || poll.status !== 'active' || !poll.endTime) {
      return 0;
    }
    const remaining = Math.max(0, Math.round((poll.endTime - Date.now()) / 1000));
    return remaining;
  }

  /**
   * Format seconds into MM:SS
   */
  formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  /**
   * Register or reconnect an audience participant
   */
  registerParticipant(pollId, participantId, name, socketId) {
    const poll = this.getPollById(pollId) || this.getActivePoll();
    if (!poll) return null;

    if (!participantId) {
      participantId = 'p_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
    }

    const trimmedName = (name || 'Audience Member').trim();

    if (poll.audience[participantId]) {
      // Existing participant reconnecting
      poll.audience[participantId].socketId = socketId;
      if (trimmedName && poll.audience[participantId].name !== trimmedName) {
        poll.audience[participantId].name = trimmedName;
      }
    } else {
      // New participant
      poll.audience[participantId] = {
        participantId,
        name: trimmedName,
        socketId,
        selectedOption: null,
        submitted: false,
        joinTime: new Date().toISOString()
      };
    }

    return {
      poll,
      participant: poll.audience[participantId]
    };
  }

  /**
   * Submit response from an audience member
   */
  recordResponse(pollId, participantId, optionId) {
    const poll = this.getPollById(pollId) || this.getActivePoll();
    if (!poll) {
      return { success: false, message: 'Poll not found' };
    }

    if (poll.status !== 'active') {
      return { success: false, message: 'Poll is not currently active' };
    }

    if (this.getRemainingSeconds(poll.pollId) <= 0) {
      return { success: false, message: 'Time limit has expired' };
    }

    const participant = poll.audience[participantId];
    if (!participant) {
      return { success: false, message: 'Participant not recognized' };
    }

    if (participant.submitted) {
      return { success: false, message: 'You have already submitted your response' };
    }

    // Verify option exists
    const validOption = poll.options.find(opt => opt.id === optionId);
    if (!validOption) {
      return { success: false, message: 'Invalid option selected' };
    }

    // Record submission
    participant.selectedOption = optionId;
    participant.submitted = true;
    participant.submittedAt = new Date().toISOString();

    if (poll.responses[optionId] === undefined) {
      poll.responses[optionId] = 0;
    }
    poll.responses[optionId] += 1;

    return {
      success: true,
      participant,
      poll
    };
  }

  /**
   * Get full statistical results for admin and results screen
   */
  getResults(pollId) {
    const poll = pollId ? this.getPollById(pollId) : this.getActivePoll();
    if (!poll) return null;

    const totalAudience = Object.keys(poll.audience).length;
    let totalResponses = 0;
    Object.values(poll.responses).forEach(count => {
      totalResponses += count;
    });

    const unanswered = Math.max(0, totalAudience - totalResponses);

    // Option breakdown with counts and percentages
    const breakdown = poll.options.map(opt => {
      const count = poll.responses[opt.id] || 0;
      const percentOfResponses = totalResponses > 0 ? ((count / totalResponses) * 100).toFixed(1) : '0.0';
      const percentOfAudience = totalAudience > 0 ? ((count / totalAudience) * 100).toFixed(1) : '0.0';
      return {
        id: opt.id,
        text: opt.text,
        count,
        percentOfResponses: parseFloat(percentOfResponses),
        percentOfAudience: parseFloat(percentOfAudience)
      };
    });

    const unansweredPercent = totalAudience > 0 ? ((unanswered / totalAudience) * 100).toFixed(1) : '0.0';

    return {
      pollId: poll.pollId,
      question: poll.question,
      status: poll.status,
      options: poll.options,
      responses: poll.responses,
      totalAudience,
      totalResponses,
      unanswered,
      unansweredPercent: parseFloat(unansweredPercent),
      breakdown,
      duration: poll.duration,
      remainingSeconds: this.getRemainingSeconds(poll.pollId),
      formattedTime: this.formatTime(this.getRemainingSeconds(poll.pollId))
    };
  }

  /**
   * Reset / Create a fresh poll
   */
  createNewPoll(question = '', options = [], duration = 120) {
    // If active poll exists, mark it as ended before creating new
    if (this.activePoll && this.activePoll.status === 'active') {
      this.activePoll.status = 'ended';
    }
    return this.createPoll(question, options, duration);
  }
}

// Export singleton instance
const pollStore = new PollStore();
module.exports = pollStore;

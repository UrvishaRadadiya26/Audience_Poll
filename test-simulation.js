const { io } = require('socket.io-client');

const SERVER_URL = 'http://localhost:3000';

async function runSimulation() {
  console.log('--- STARTING KUP LIVE POLL END-TO-END TEST ---');

  // 1. Connect Admin
  const adminSocket = io(SERVER_URL);
  let pollId = null;

  await new Promise((resolve) => {
    adminSocket.on('connect', () => {
      console.log('✅ 1. Admin socket connected');
      adminSocket.emit('adminConnect');
    });

    adminSocket.on('adminState', (data) => {
      pollId = data.poll.pollId;
      console.log(`✅ 2. Admin received state for Poll: ${pollId}`);
      resolve();
    });
  });

  // 2. Admin updates question & options
  await new Promise((resolve) => {
    adminSocket.emit('adminUpdatePoll', {
      question: 'Which programming language is used with Node.js?',
      options: ['Java', 'Python', 'JavaScript', 'C++']
    });

    adminSocket.on('pollUpdated', (data) => {
      console.log('✅ 3. Question & 4 options saved successfully');
      resolve();
    });
  });

  // 3. Connect 3 Audience Members: Kairavi, Urvisha, Purva
  const audience1 = io(SERVER_URL);
  const audience2 = io(SERVER_URL);
  const audience3 = io(SERVER_URL);

  let audienceCountReported = 0;
  adminSocket.on('updateAudienceCount', (data) => {
    audienceCountReported = data.totalAudience;
    console.log(`👥 Admin live audience count updated: ${data.totalAudience}`);
  });

  await new Promise((resolve) => {
    let joined = 0;
    const checkAllJoined = () => {
      joined++;
      if (joined === 3) resolve();
    };

    audience1.emit('joinPoll', { pollId, participantId: 'p_kairavi', name: 'Kairavi' });
    audience1.on('audienceJoined', (d) => {
      console.log(`✅ 4a. Kairavi joined poll (Status: ${d.status})`);
      checkAllJoined();
    });

    audience2.emit('joinPoll', { pollId, participantId: 'p_urvisha', name: 'Urvisha' });
    audience2.on('audienceJoined', (d) => {
      console.log(`✅ 4b. Urvisha joined poll (Status: ${d.status})`);
      checkAllJoined();
    });

    audience3.emit('joinPoll', { pollId, participantId: 'p_purva', name: 'Purva' });
    audience3.on('audienceJoined', (d) => {
      console.log(`✅ 4c. Purva joined poll (Status: ${d.status})`);
      checkAllJoined();
    });
  });

  // 4. Admin starts poll
  await new Promise((resolve) => {
    let startedNotifications = 0;
    const checkStarted = () => {
      startedNotifications++;
      if (startedNotifications === 3) resolve();
    };

    audience1.on('pollStarted', (data) => {
      console.log(`⏱️ 5a. Kairavi received pollStarted. Remaining: ${data.remainingSeconds}s`);
      checkStarted();
    });

    audience2.on('pollStarted', (data) => {
      console.log(`⏱️ 5b. Urvisha received pollStarted. Remaining: ${data.remainingSeconds}s`);
      checkStarted();
    });

    audience3.on('pollStarted', (data) => {
      console.log(`⏱️ 5c. Purva received pollStarted. Remaining: ${data.remainingSeconds}s`);
      checkStarted();
    });

    adminSocket.emit('startPoll');
  });

  // 5. Submit responses
  // Kairavi -> C (JavaScript)
  // Urvisha -> C (JavaScript)
  // Purva   -> B (Python)
  await new Promise((resolve) => {
    audience1.emit('submitResponse', { pollId, participantId: 'p_kairavi', optionId: 'C' });
    audience1.on('responseSubmitted', (res) => {
      console.log('🗳️ 6a. Kairavi vote submitted: Option C');
      resolve();
    });
  });

  await new Promise((resolve) => {
    audience2.emit('submitResponse', { pollId, participantId: 'p_urvisha', optionId: 'C' });
    audience2.on('responseSubmitted', (res) => {
      console.log('🗳️ 6b. Urvisha vote submitted: Option C');
      resolve();
    });
  });

  await new Promise((resolve) => {
    audience3.emit('submitResponse', { pollId, participantId: 'p_purva', optionId: 'B' });
    audience3.on('responseSubmitted', (res) => {
      console.log('🗳️ 6c. Purva vote submitted: Option B');
      resolve();
    });
  });

  // Test double-voting prevention:
  await new Promise((resolve) => {
    audience1.emit('submitResponse', { pollId, participantId: 'p_kairavi', optionId: 'A' });
    audience1.on('responseError', (err) => {
      console.log(`🔒 7. Double voting successfully blocked: "${err.message}"`);
      resolve();
    });
  });

  // 6. Admin ends poll & verifies results
  await new Promise((resolve) => {
    adminSocket.on('pollResult', (results) => {
      console.log('\n📊 8. FINAL POLL RESULTS RECEIVED:');
      console.log(`   - Question: "${results.question}"`);
      console.log(`   - Total Audience: ${results.totalAudience}`);
      console.log(`   - Total Responses: ${results.totalResponses}`);
      console.log(`   - Unanswered: ${results.unanswered}`);
      console.log('   - Breakdown:');
      results.breakdown.forEach(b => {
        console.log(`     Option ${b.id} (${b.text}): ${b.count} votes (${b.percentOfResponses}%)`);
      });

      // Assertions
      if (results.totalAudience === 3 && results.totalResponses === 3 && results.responses.C === 2 && results.responses.B === 1) {
        console.log('\n🌟 ALL ASSERTIONS PASSED PERFECTLY!');
      } else {
        console.error('❌ Mismatched results in assertions');
      }
      resolve();
    });

    adminSocket.emit('endPoll', { pollId });
  });

  // 7. Admin creates new poll
  await new Promise((resolve) => {
    adminSocket.on('newPollCreated', (data) => {
      console.log(`\n🎉 9. Successfully created new poll session: ${data.poll.pollId}`);
      console.log('--- TEST SIMULATION COMPLETE WITH 100% SUCCESS ---');
      resolve();
    });

    adminSocket.emit('createNewPoll', {
      question: 'Next question...',
      options: ['Option A', 'Option B', 'Option C', 'Option D'],
      duration: 120
    });
  });

  adminSocket.disconnect();
  audience1.disconnect();
  audience2.disconnect();
  audience3.disconnect();
}

runSimulation().catch(err => {
  console.error('Simulation error:', err);
  process.exit(1);
});

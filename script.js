/* =========================================================
   CHICKSAVE-IN
   TWO-MODULE REAL-TIME PROTOTYPE

   Module 1: Live Monitoring
   Module 2: Summary

   This version was rebuilt around these requirements:
   - custom logo upload
   - monitoring screen starts empty with only "Live Monitoring"
   - a random coop detection every 5 seconds
   - each detection creates its own card
   - each card has warning icon, coop number, and exactly one detection type:
       "Respiratory distress pattern"
   - alarm sound on every detection
   - each card has its own Resolved button
   - resolving one card never affects other cards
   - Summary updates immediately from the same live data
   - report chart is derived from real session detections, not hard-coded events
   - responsive on mobile

   NOTE:
   Browser autoplay rules can block sound until the user interacts with
   the page once. The first click anywhere unlocks the Web Audio alarm.
========================================================= */

const COOPS = [
  "Coop 01",
  "Coop 02",
  "Coop 03",
  "Coop 04",
  "Coop 05"
];

const DETECTION_TYPE = "Respiratory distress pattern";

const FAST_DETECTION_INTERVAL_MS = 3000;
const FAST_DETECTION_COUNT = 2;
const SLOW_DETECTION_INTERVAL_MS = 10000;

let currentPage = "monitoring";
let detections = [];
let detectionNumber = 0;
let audioContext = null;
let soundUnlocked = false;
let chartHistory = [];

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

/* =========================================================
   LOGIN SCREEN

   Prototype-only login: any non-empty credentials reveal
   the dashboard. Submitting also counts as a user gesture,
   which helps unlock the alarm sound for later detections.
========================================================= */

const loginForm = $('#loginForm');

if (loginForm) {
  loginForm.addEventListener('submit', (event) => {
    event.preventDefault();

    $('#loginScreen').classList.add('hidden');
    $('#appShell').classList.remove('hidden');

    unlockAudio();
    startDetectionLoop();
  });
}

/* =========================================================
   PAGE NAVIGATION
========================================================= */

$$('.nav-item').forEach((button) => {
  button.addEventListener('click', () => {
    showPage(button.dataset.page);
  });
});

function showPage(page) {
  currentPage = page;

  $$('.page').forEach((pageElement) => {
    pageElement.classList.toggle(
      'active',
      pageElement.id === page
    );
  });

  $$('.nav-item').forEach((button) => {
    button.classList.toggle(
      'active',
      button.dataset.page === page
    );
  });

  $('#pageTitle').textContent =
    page === 'monitoring'
      ? 'Live Monitoring'
      : 'Summary';

  $('#sidebar').classList.remove('open');

  if (page === 'summary') {
    renderSummary();
    requestAnimationFrame(drawReportChart);
  }
}

$('#mobileMenu').addEventListener('click', () => {
  $('#sidebar').classList.toggle('open');
});

/* =========================================================
   LOGO UPLOAD
========================================================= */

$('#logoInput').addEventListener('change', (event) => {
  const file = event.target.files?.[0];

  if (!file) return;

  if (!file.type.startsWith('image/')) {
    showToast('Invalid file', 'Please select an image file.');
    return;
  }

  const reader = new FileReader();

  reader.onload = () => {
    const dataUrl = String(reader.result);

    $('#logoPreview').src = dataUrl;
    $('.brand-logo').classList.add('has-image');

    try {
      localStorage.setItem('chicksaveLogo', dataUrl);
    } catch {
      // The preview still works even if localStorage is unavailable.
    }

    showToast('Logo updated', 'Your custom ChickSave-IN logo is now displayed.');
  };

  reader.readAsDataURL(file);
});

function restoreLogo() {
  try {
    const savedLogo = localStorage.getItem('chicksaveLogo');

    if (!savedLogo) return;

    $('#logoPreview').src = savedLogo;
    $('.brand-logo').classList.add('has-image');
  } catch {
    // No saved logo available.
  }
}

/* =========================================================
   AUDIO / ALARM
========================================================= */

/*
  The alarm is generated with Web Audio so no MP3 is required.
  It is intentionally a short, obvious warning sound.
*/

function unlockAudio() {
  if (soundUnlocked) return;

  try {
    const AudioContext =
      window.AudioContext || window.webkitAudioContext;

    if (!AudioContext) return;

    audioContext = audioContext || new AudioContext();

    if (audioContext.state === 'suspended') {
      audioContext.resume();
    }

    soundUnlocked = true;
  } catch {
    soundUnlocked = false;
  }
}

/*
  Any first pointer interaction unlocks browser audio.
  This keeps the monitoring screen clean instead of adding a sound button.
*/
document.addEventListener('pointerdown', unlockAudio, { once: true });

/*
  =========================================================
  ALARM SOUND CONFIG (code-only — no UI for this)

  Change ALARM_SOUND below to pick which sound plays on
  every detection. Options:

    'classic'  - the built-in beep pattern (default)
    'siren'    - built-in rising/falling wail
    'pulse'    - built-in rapid urgent bursts
    'chime'    - built-in gentler bell tones
    'bundled'  - plays the MP3 file at BUNDLED_ALARM_FILE
                 below (put your downloaded MP3 in the
                 audio/ folder and point this at it)
  =========================================================
*/
const ALARM_SOUND = 'classic';

/*
  Only used when ALARM_SOUND is 'bundled' above.
  Path to your own MP3/WAV/etc. file, relative to index.html.
*/
const BUNDLED_ALARM_FILE = 'audio/alarm.mp3';

/*
  Only used when ALARM_SOUND is 'bundled' above.

  CUSTOM_ALARM_START_OFFSET_SECONDS
    Skips this many seconds from the start of the file
    before playing. Useful if your MP3 has a silent or
    slow intro you want to skip straight past.
    Set to 0 to always start from the very beginning.

  CUSTOM_ALARM_MAX_DURATION_MS
    Cuts playback off after this many milliseconds, even
    if the file is longer. Set to 0 (or null) to let the
    whole file play out with no cutoff.

  Example: a 30-second MP3 where you want just a
  3-second clip starting at the 5-second mark:
    CUSTOM_ALARM_START_OFFSET_SECONDS = 5
    CUSTOM_ALARM_MAX_DURATION_MS = 3000
*/
const CUSTOM_ALARM_START_OFFSET_SECONDS = 0;
const CUSTOM_ALARM_MAX_DURATION_MS = 4000;

function playDetectionAlarm() {
  unlockAudio();

  if (ALARM_SOUND === 'bundled') {
    playFileAlarm(BUNDLED_ALARM_FILE);
    return;
  }

  if (!audioContext || audioContext.state === 'suspended') {
    return;
  }

  switch (ALARM_SOUND) {
    case 'siren':
      playSirenAlarm();
      break;
    case 'pulse':
      playPulseAlarm();
      break;
    case 'chime':
      playChimeAlarm();
      break;
    default:
      playClassicAlarm();
  }
}

/*
  Plays the bundled MP3/WAV/etc. file, honoring the
  start-offset and max-duration settings above.
*/
function playFileAlarm(source) {
  try {
    const audio = new Audio(source);
    audio.volume = 1;

    const startPlayback = () => {
      if (CUSTOM_ALARM_START_OFFSET_SECONDS > 0) {
        audio.currentTime = CUSTOM_ALARM_START_OFFSET_SECONDS;
      }

      audio.play().catch(() => {
        /*
          If the browser blocks/refuses playback (or the
          bundled file doesn't exist), fall back to the
          built-in preset so an alert is still audible.
        */
        playClassicAlarm();
      });
    };

    if (audio.readyState >= 1) {
      startPlayback();
    } else {
      audio.addEventListener('loadedmetadata', startPlayback, { once: true });
      audio.addEventListener('error', () => playClassicAlarm(), { once: true });
    }

    if (CUSTOM_ALARM_MAX_DURATION_MS > 0) {
      setTimeout(() => {
        audio.pause();
      }, CUSTOM_ALARM_MAX_DURATION_MS);
    }
  } catch {
    playClassicAlarm();
  }
}

function playAlarmTone(frequency, startTime, duration, volume = 0.4, waveform = 'square') {
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();

  oscillator.type = waveform;
  oscillator.frequency.setValueAtTime(
    frequency,
    startTime
  );

  gain.gain.setValueAtTime(0.0001, startTime);
  gain.gain.exponentialRampToValueAtTime(
    volume,
    startTime + 0.015
  );
  gain.gain.exponentialRampToValueAtTime(
    0.0001,
    startTime + duration
  );

  oscillator.connect(gain);
  gain.connect(audioContext.destination);

  oscillator.start(startTime);
  oscillator.stop(startTime + duration);
}

/*
  Classic Beep — the original 4-note pattern, just louder.
*/
function playClassicAlarm() {
  const now = audioContext.currentTime;

  playAlarmTone(880, now, 0.10, 0.5);
  playAlarmTone(660, now + 0.14, 0.10, 0.5);
  playAlarmTone(880, now + 0.28, 0.10, 0.5);
  playAlarmTone(660, now + 0.42, 0.16, 0.5);
}

/*
  Siren Sweep — a continuous rising/falling tone,
  like a wailing alarm.
*/
function playSirenAlarm() {
  const now = audioContext.currentTime;
  const duration = 1.1;

  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();

  oscillator.type = 'sawtooth';
  oscillator.frequency.setValueAtTime(400, now);
  oscillator.frequency.linearRampToValueAtTime(1000, now + duration / 2);
  oscillator.frequency.linearRampToValueAtTime(400, now + duration);

  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.5, now + 0.05);
  gain.gain.setValueAtTime(0.5, now + duration - 0.08);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

  oscillator.connect(gain);
  gain.connect(audioContext.destination);

  oscillator.start(now);
  oscillator.stop(now + duration);
}

/*
  Urgent Pulse — rapid, sharp bursts for a more
  aggressive/urgent alert.
*/
function playPulseAlarm() {
  const now = audioContext.currentTime;
  const pulseCount = 6;
  const pulseGap = 0.11;

  for (let i = 0; i < pulseCount; i += 1) {
    playAlarmTone(
      i % 2 === 0 ? 1050 : 780,
      now + i * pulseGap,
      0.07,
      0.55
    );
  }
}

/*
  Soft Chime — gentler bell-like tones, still louder
  than the original default, for a less jarring alert.
*/
function playChimeAlarm() {
  const now = audioContext.currentTime;

  playAlarmTone(880, now, 0.35, 0.3, 'sine');
  playAlarmTone(1174.66, now + 0.18, 0.35, 0.28, 'sine');
  playAlarmTone(1567.98, now + 0.36, 0.45, 0.26, 'sine');
}

/* =========================================================
   COOP AVAILABILITY

   A coop is "available" only if it does NOT already have
   an unresolved (active) detection. Once all 5 coops have
   an active detection, no new detections are created until
   at least one is resolved.
========================================================= */

function getActiveCoops() {
  return detections
    .filter((detection) => detection.status === 'active')
    .map((detection) => detection.coop);
}

function pickAvailableCoop() {
  const activeCoops = getActiveCoops();

  const availableCoops = COOPS.filter(
    (coop) => !activeCoops.includes(coop)
  );

  if (!availableCoops.length) {
    return null;
  }

  return availableCoops[
    Math.floor(Math.random() * availableCoops.length)
  ];
}

/* =========================================================
   MONITORING STATUS

   Shows whether detection is actively scanning or paused
   because every coop currently has an unresolved alert.
   Safe to call even if #monitoringStatus doesn't exist.
========================================================= */

function updateMonitoringStatus() {
  const statusElement = $('#monitoringStatus');

  if (!statusElement) return;

  const activeCount = getActiveCoops().length;

  if (activeCount >= COOPS.length) {
    statusElement.textContent =
      'Detection paused — resolve a coop to continue.';
    statusElement.classList.add('paused');
  } else {
    statusElement.textContent = 'Listening continuously.';
    statusElement.classList.remove('paused');
  }
}

/* =========================================================
   DETECTION CREATION
========================================================= */

function createDetection() {
  const availableCoop = pickAvailableCoop();

  /*
    All 5 coops already have an unresolved detection.
    Stop creating new detections until one is resolved.
  */
  if (!availableCoop) {
    updateMonitoringStatus();
    return;
  }

  detectionNumber += 1;

  const detection = {
    id: createId(),
    number: detectionNumber,
    coop: availableCoop,
    type: DETECTION_TYPE,
    detectedAt: new Date(),
    status: 'active',
    resolvedAt: null
  };

  detections.unshift(detection);

  /*
    Real-time chart source.
    Each scan event is represented immediately.
  */
  chartHistory.push({
    number: detectionNumber,
    time: detection.detectedAt,
    cumulative: detections.length
  });

  /* Keep session chart lightweight. */
  chartHistory = chartHistory.slice(-20);

  renderDetectionCards();
  renderSummary();
  drawReportChart();
  updateMonitoringStatus();

  playDetectionAlarm();

  showToast(
    'New distress detected',
    `${availableCoop} · Respiratory distress pattern`
  );
}

function createId() {
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.randomUUID === 'function'
  ) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/* =========================================================
   DETECTION CARDS
========================================================= */

function renderDetectionCards() {
  const alertArea = $('#alertArea');

  const activeDetections = detections.filter(
    (detection) => detection.status === 'active'
  );

  if (!activeDetections.length) {
    alertArea.innerHTML = '';
    return;
  }

  alertArea.innerHTML = activeDetections.map(
    (detection) => createDetectionCard(detection)
  ).join('');

  $$('.resolve-button').forEach((button) => {
    button.addEventListener('click', () => {
      resolveDetection(button.dataset.id);
    });
  });
}

function createDetectionCard(detection) {
  return `
    <article
      class="detection-card"
      data-detection-id="${detection.id}"
    >
      <div class="detection-top-line"></div>

      <div class="detection-body">
        <div class="detection-header">
          <div class="detection-title-wrap">
            <div class="warning-icon" aria-label="Warning">
              ⚠
            </div>

            <div>
              <span class="detection-tag">
                RESPIRATORY ALERT
              </span>

              <h3>
                ${escapeHtml(detection.coop)}
              </h3>

              <div class="detection-subtitle">
                Unusual poultry sound detected in this coop.
              </div>
            </div>
          </div>

          <span class="detection-time">
            ${formatTime(detection.detectedAt)}
          </span>
        </div>

        <div class="detection-details">
          <div class="detection-detail">
            <span>COOP NUMBER</span>
            <strong class="coop-number">
              ${escapeHtml(detection.coop)}
            </strong>
          </div>

          <div class="detection-detail">
            <span>DETECTION TYPE</span>
            <strong>
              ${escapeHtml(detection.type)}
            </strong>
          </div>
        </div>
      </div>

      <div class="detection-footer">
        <span>
          Give the necessary medicine, then mark this alert as resolved.
        </span>

        <button
          type="button"
          class="resolve-button"
          data-id="${detection.id}"
        >
          Resolve
        </button>
      </div>
    </article>
  `;
}

/* =========================================================
   RESOLVE ONE DETECTION
========================================================= */

function resolveDetection(id) {
  const detection = detections.find(
    (item) => item.id === id
  );

  if (!detection || detection.status === 'resolved') {
    return;
  }

  /*
    Only this detection changes.
    All other active cards stay untouched.
  */
  detection.status = 'resolved';
  detection.resolvedAt = new Date();

  renderDetectionCards();
  renderSummary();
  drawReportChart();
  updateMonitoringStatus();

  showToast(
    'Alert resolved',
    `${detection.coop} was marked resolved.`
  );
}

/* =========================================================
   SUMMARY
========================================================= */

function renderSummary() {
  const total = detections.length;

  const active = detections.filter(
    (detection) => detection.status === 'active'
  ).length;

  const resolved = detections.filter(
    (detection) => detection.status === 'resolved'
  ).length;

  const affectedCoops = new Set(
    detections.map((detection) => detection.coop)
  ).size;

  $('#summaryDetections').textContent = total;
  $('#summaryActive').textContent = active;
  $('#summaryResolved').textContent = resolved;
  $('#summaryCoops').textContent = affectedCoops;

  renderSummaryHistory();
}

function renderSummaryHistory() {
  const history = $('#summaryHistory');

  if (!detections.length) {
    history.innerHTML = `
      <div class="empty-history">
        No respiratory distress alerts have been detected yet.
      </div>
    `;
    return;
  }

  history.innerHTML = detections.map((detection) => {
    const resolved = detection.status === 'resolved';

    return `
      <div class="history-item">
        <div class="history-main">
          <strong>${escapeHtml(detection.coop)}</strong>
          <small>${escapeHtml(detection.type)}</small>
        </div>

        <div class="history-status ${resolved ? 'resolved' : 'active'}">
          ${resolved ? 'RESOLVED' : 'ACTIVE'}
        </div>

        <div class="history-time">
          ${formatTime(detection.detectedAt)}
          ${resolved ? `<br>Resolved ${formatTime(detection.resolvedAt)}` : ''}
        </div>
      </div>
    `;
  }).join('');
}

/* =========================================================
   REAL-TIME REPORT CHART
========================================================= */

function drawReportChart() {
  const canvas = $('#riskChart');

  if (!canvas || !$('#summary').classList.contains('active')) {
    return;
  }

  const rect = canvas.getBoundingClientRect();

  if (!rect.width || !rect.height) {
    return;
  }

  const dpr = window.devicePixelRatio || 1;

  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);

  const context = canvas.getContext('2d');
  const width = canvas.width;
  const height = canvas.height;

  context.clearRect(0, 0, width, height);

  const left = 45 * dpr;
  const right = 20 * dpr;
  const top = 20 * dpr;
  const bottom = 35 * dpr;

  const chartWidth = width - left - right;
  const chartHeight = height - top - bottom;

  /*
    The chart is based ONLY on real session detections.
    No fake 30-day numbers are inserted.

    Before any detection:
      0

    After one detection:
      1

    After two detections:
      1 -> 2

    and so on.
  */
  const data = [
    { label: 'Start', value: 0 },
    ...chartHistory.map((item) => ({
      label: formatShortTime(item.time),
      value: item.cumulative
    }))
  ].slice(-12);

  const maxValue = Math.max(
    1,
    ...data.map((point) => point.value)
  );

  /* Grid */
  context.strokeStyle = '#e7eee3';
  context.fillStyle = '#8b958e';
  context.lineWidth = dpr;
  context.font = `${9 * dpr}px Inter`;

  for (let i = 0; i <= 4; i += 1) {
    const y = top + (i / 4) * chartHeight;

    context.beginPath();
    context.moveTo(left, y);
    context.lineTo(width - right, y);
    context.stroke();

    const value = Math.round(
      maxValue - (i / 4) * maxValue
    );

    context.fillText(
      String(value),
      8 * dpr,
      y + 3 * dpr
    );
  }

  /* Points */
  const points = data.map((point, index) => ({
    x: data.length === 1
      ? left + chartWidth / 2
      : left + (index / (data.length - 1)) * chartWidth,
    y: top + (1 - point.value / maxValue) * chartHeight,
    label: point.label
  }));

  /* Area */
  context.beginPath();
  context.moveTo(points[0].x, top + chartHeight);

  points.forEach((point) => {
    context.lineTo(point.x, point.y);
  });

  const last = points[points.length - 1];
  context.lineTo(last.x, top + chartHeight);
  context.closePath();

  const gradient = context.createLinearGradient(
    0,
    top,
    0,
    top + chartHeight
  );

  gradient.addColorStop(0, 'rgba(79,126,71,.18)');
  gradient.addColorStop(1, 'rgba(79,126,71,0)');

  context.fillStyle = gradient;
  context.fill();

  /* Line */
  context.beginPath();

  points.forEach((point, index) => {
    if (index === 0) {
      context.moveTo(point.x, point.y);
    } else {
      context.lineTo(point.x, point.y);
    }
  });

  context.strokeStyle = '#4d7e47';
  context.lineWidth = 3 * dpr;
  context.stroke();

  /* Points */
  context.fillStyle = '#4d7e47';

  points.forEach((point) => {
    context.beginPath();
    context.arc(
      point.x,
      point.y,
      3 * dpr,
      0,
      Math.PI * 2
    );
    context.fill();
  });

  /* X labels */
  context.fillStyle = '#8b958e';
  context.font = `${8 * dpr}px Inter`;

  const visibleLabels = points.length <= 5
    ? points
    : points.filter((_, index) => {
        return (
          index === 0 ||
          index === points.length - 1 ||
          index % 3 === 0
        );
      });

  visibleLabels.forEach((point) => {
    context.fillText(
      point.label,
      point.x - 16 * dpr,
      height - 10 * dpr
    );
  });
}

/* =========================================================
   RESET SESSION
========================================================= */

$('#resetData')?.addEventListener('click', () => {
  detections = [];
  chartHistory = [];
  detectionNumber = 0;

  renderDetectionCards();
  renderSummary();
  drawReportChart();
  updateMonitoringStatus();

  showToast(
    'Session reset',
    'All current detections and report data were cleared.'
  );
});

/* =========================================================
   TOAST
========================================================= */

let toastTimer = null;

function showToast(title, message) {
  $('#toastTitle').textContent = title;
  $('#toastMessage').textContent = message;
  $('#toast').classList.add('show');

  clearTimeout(toastTimer);

  toastTimer = setTimeout(() => {
    $('#toast').classList.remove('show');
  }, 3200);
}

/* =========================================================
   HELPERS
========================================================= */

function formatTime(date) {
  if (!(date instanceof Date)) {
    date = new Date(date);
  }

  return date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

function formatShortTime(date) {
  if (!(date instanceof Date)) {
    date = new Date(date);
  }

  return date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit'
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

/* =========================================================
   DETECTION LOOP CONTROL

   The scan loop only starts once the user logs in.
   detectionLoopStarted prevents it from being started twice
   if the login form is somehow submitted more than once.

   Timing: the first 2 scans happen 3 seconds apart, then
   every scan after that happens every 10 seconds.
========================================================= */

let detectionLoopStarted = false;
let scanCount = 0;

function scheduleNextScan() {
  const delay = scanCount < FAST_DETECTION_COUNT
    ? FAST_DETECTION_INTERVAL_MS
    : SLOW_DETECTION_INTERVAL_MS;

  setTimeout(() => {
    scanCount += 1;
    createDetection();
    scheduleNextScan();
  }, delay);
}

function startDetectionLoop() {
  if (detectionLoopStarted) return;

  detectionLoopStarted = true;

  scheduleNextScan();
}

/* =========================================================
   INITIALIZE
========================================================= */

restoreLogo();
renderDetectionCards();
renderSummary();
updateMonitoringStatus();

window.addEventListener('resize', () => {
  if (currentPage === 'summary') {
    drawReportChart();
  }
});
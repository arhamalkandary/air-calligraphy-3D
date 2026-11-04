const video = document.getElementById('webcam');
const canvas = document.getElementById('output-canvas');
const ctx = canvas.getContext('2d');

const btnStart = document.getElementById('btn-start');
const startOverlay = document.getElementById('start-overlay');
const btnToggleCam = document.getElementById('btn-toggle-cam');
const camModeText = document.getElementById('cam-mode-text');
const btnRecord = document.getElementById('btn-record');
const recText = document.getElementById('rec-text');

let currentFacingMode = "environment";
let currentStream = null;
let animationFrameId = null;

// Struktur Kerangka Sendi
const CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [0, 9], [9, 10], [10, 11], [11, 12],
  [0, 13], [13, 14], [14, 15], [15, 16],
  [0, 17], [17, 18], [18, 19], [19, 20],
  [5, 9], [9, 13], [13, 17]
];

const LANDMARK_LABELS = {
  4: "jempol.exe",
  8: "telunjuk[2]",
  12: "tengah.exe",
  16: "manis.exe (sudah nikah)",
  20: "kelingking.exe -> janji()",
  2: "jempol[1]",
  6: "telunjuk[1]",
  10: "tengah[1]",
  14: "manis[1]",
  18: "kelingking[1]"
};

// ------------------------------------------------------------------
// Web Audio API: Suara Ketikan Keyboard Mekanikal (Tactile Click)
// ------------------------------------------------------------------
let audioCtx = null;

function initAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
}

function playMechanicalKeyClick() {
  if (!audioCtx) return;
  if (audioCtx.state === 'suspended') audioCtx.resume();

  const now = audioCtx.currentTime;

  // Klik frekuensi tinggi tajam
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(2200 + Math.random() * 400, now);
  osc.frequency.exponentialRampToValueAtTime(300, now + 0.04);

  gain.gain.setValueAtTime(0.2, now);
  gain.gain.exponentialRampToValueAtTime(0.01, now + 0.04);

  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start(now);
  osc.stop(now + 0.045);
}

// ------------------------------------------------------------------
// State Typewriter & Deteksi Gestur
// ------------------------------------------------------------------
let targetCodeString = "const jari = 5; // udah dicek 3x";
let currentCodeTypewritten = "";
let lastTypeTime = 0;
let lastWristPos = { x: 0, y: 0, time: 0 };
let dynamicErrors = [];

function updateTypewriter() {
  const now = performance.now();
  if (currentCodeTypewritten !== targetCodeString && now - lastTypeTime > 32) {
    if (targetCodeString.startsWith(currentCodeTypewritten)) {
      currentCodeTypewritten = targetCodeString.substring(0, currentCodeTypewritten.length + 1);
    } else {
      // Hapus cepat mundur jika teks berganti total
      currentCodeTypewritten = currentCodeTypewritten.substring(0, currentCodeTypewritten.length - 2);
    }
    lastTypeTime = now;
    playMechanicalKeyClick();
  }
}

function analyzeGestures(lm, pts) {
  // Status Tiap Jari
  const isIndexOpen  = lm[8].y  < lm[6].y;
  const isMiddleOpen = lm[12].y < lm[10].y;
  const isRingOpen   = lm[16].y < lm[14].y;
  const isPinkyOpen  = lm[20].y < lm[18].y;

  // Jempol Naik
  const isThumbUp = lm[4].y < lm[3].y && lm[3].y < lm[2].y && (lm[2].y < lm[9].y);
  const otherFingersClosed = !isIndexOpen && !isMiddleOpen && !isRingOpen && !isPinkyOpen;

  // Jarak tangan ke kamera
  const span = Math.hypot(pts[9].x - pts[0].x, pts[9].y - pts[0].y);
  const isNear = span > (canvas.width * 0.38);

  // 1. Goyangan Tangan Cepat (Speed/Jitter Detection)
  const now = performance.now();
  if (lastWristPos.time > 0) {
    const dt = (now - lastWristPos.time) / 1000;
    const dist = Math.hypot(pts[0].x - lastWristPos.x, pts[0].y - lastWristPos.y);
    const speed = dist / dt;

    if (speed > 1600) {
      if (dynamicErrors.length === 0 || now - dynamicErrors[dynamicErrors.length - 1].time > 700) {
        dynamicErrors.push({
          msg: `Warning: Tangan goyang terlalu cepat (${Math.round(speed)}px/s)!`,
          time: now
        });
        if (dynamicErrors.length > 3) dynamicErrors.shift();
      }
    }
  }
  lastWristPos = { x: pts[0].x, y: pts[0].y, time: now };

  // 2. Pemilihan Target Teks Berdasarkan Gestur
  if (isThumbUp && otherFingersClosed) {
    targetCodeString = "// HTTP 200 OK: Skripsi Approved";
  } else if (isIndexOpen && otherFingersClosed) {
    targetCodeString = "const tauhid = true; while(true) tawakkal();";
  } else if (otherFingersClosed && !isThumbUp) {
    targetCodeString = 'throw new Error("tangan emosi: capek revisi skripsi");';
  } else if (isNear) {
    targetCodeString = "tangan.mendekat(); // jangan panik";
  } else {
    targetCodeString = "const jari = 5; // udah dicek 3x";
  }
}

// ------------------------------------------------------------------
// MediaPipe Setup
// ------------------------------------------------------------------
const hands = new Hands({
  locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
});

hands.setOptions({
  maxNumHands: 1,
  modelComplexity: 1,
  minDetectionConfidence: 0.65,
  minTrackingConfidence: 0.65
});

hands.onResults(onHandResults);

function onHandResults(results) {
  canvas.width = canvas.clientWidth;
  canvas.height = canvas.clientHeight;

  ctx.save();
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const isFront = (currentFacingMode === "user");
  if (isFront) {
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(results.image, 0, 0, canvas.width, canvas.height);
  ctx.restore();

  drawLineNumbers();
  updateTypewriter();

  const isHandDetected = results.multiHandLandmarks && results.multiHandLandmarks.length > 0;
  drawErrorConsole(isHandDetected);

  if (isHandDetected) {
    const rawLm = results.multiHandLandmarks[0];
    const points = rawLm.map(pt => {
      let px = pt.x * canvas.width;
      if (isFront) px = (1.0 - pt.x) * canvas.width;
      return { x: px, y: pt.y * canvas.height };
    });

    analyzeGestures(rawLm, points);
    drawSkeleton(points);
    drawJointLabels(points);
    drawDynamicCodeBadge(points);
  }
}

// ------------------------------------------------------------------
// Gambar Elemen Grafis Kanvas
// ------------------------------------------------------------------
function drawLineNumbers() {
  ctx.save();
  ctx.font = "12px Consolas, monospace";
  ctx.fillStyle = "rgba(133, 133, 133, 0.45)";
  ctx.textAlign = "right";

  let startLine = 108;
  for (let y = 30; y < canvas.height; y += 22) {
    ctx.fillText(startLine.toString(), 34, y);
    startLine++;
  }
  ctx.restore();
}

function drawSkeleton(pts) {
  ctx.save();
  ctx.strokeStyle = "rgba(255, 175, 120, 0.85)";
  ctx.lineWidth = 2.2;
  ctx.shadowColor = "rgba(255, 120, 50, 0.6)";
  ctx.shadowBlur = 6;

  for (const [i, j] of CONNECTIONS) {
    ctx.beginPath();
    ctx.moveTo(pts[i].x, pts[i].y);
    ctx.lineTo(pts[j].x, pts[j].y);
    ctx.stroke();
  }

  for (let i = 0; i < pts.length; i++) {
    ctx.beginPath();
    ctx.arc(pts[i].x, pts[i].y, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
  }
  ctx.restore();
}

function drawJointLabels(pts) {
  ctx.save();
  ctx.font = "11px Consolas, monospace";

  for (const [idxStr, label] of Object.entries(LANDMARK_LABELS)) {
    const idx = parseInt(idxStr);
    const p = pts[idx];

    ctx.fillStyle = "rgba(25, 25, 25, 0.78)";
    const textWidth = ctx.measureText(label).width;
    ctx.fillRect(p.x + 8, p.y - 12, textWidth + 8, 16);

    ctx.fillStyle = "#e0e0e0";
    ctx.fillText(label, p.x + 12, p.y);
  }
  ctx.restore();
}

function drawDynamicCodeBadge(pts) {
  const wrist = pts[0];
  let badgeX = wrist.x - 70;
  let badgeY = Math.max(wrist.y - 140, 50);

  // Kursor kedip |
  const showCursor = Math.floor(performance.now() / 320) % 2 === 0;
  const fullTextToRender = currentCodeTypewritten + (showCursor ? "|" : "");

  ctx.save();
  ctx.font = "bold 14px Consolas, monospace";
  const w = ctx.measureText(fullTextToRender).width + 24;

  ctx.fillStyle = "rgba(18, 18, 18, 0.88)";
  ctx.lineWidth = 1.5;

  // Warna border badge adaptif
  if (targetCodeString.includes("Approved")) {
    ctx.strokeStyle = "rgba(76, 175, 80, 0.85)"; // Hijau Approved
  } else if (targetCodeString.includes("emosi")) {
    ctx.strokeStyle = "rgba(244, 67, 54, 0.85)"; // Merah Emosi
  } else {
    ctx.strokeStyle = "rgba(0, 180, 216, 0.6)"; // Biru Normal
  }

  ctx.fillRect(badgeX, badgeY - 24, w, 34);
  ctx.strokeRect(badgeX, badgeY - 24, w, 34);

  // Warna Teks
  if (targetCodeString.includes("Approved")) {
    ctx.fillStyle = "#4caf50";
  } else if (targetCodeString.includes("emosi")) {
    ctx.fillStyle = "#ff6b6b";
  } else {
    ctx.fillStyle = "#9cdcfe";
  }

  ctx.fillText(fullTextToRender, badgeX + 12, badgeY);
  ctx.restore();
}

function drawErrorConsole(isHandDetected) {
  ctx.save();
  const boxWidth = Math.min(canvas.width * 0.78, 350);
  const startX = canvas.width - boxWidth - 12;
  const startY = 15;

  ctx.fillStyle = "rgba(120, 20, 20, 0.72)";
  ctx.strokeStyle = "rgba(240, 60, 60, 0.85)";
  ctx.lineWidth = 1.5;
  ctx.fillRect(startX, startY, boxWidth, 85);
  ctx.strokeRect(startX, startY, boxWidth, 85);

  ctx.font = "10.5px Consolas, monospace";
  ctx.fillStyle = "#ffd2d2";

  if (isHandDetected) {
    ctx.fillText("RangeError: tangan terdeteksi di kamera", startX + 8, startY + 18);
    ctx.fillStyle = "#ff8585";
    ctx.fillText("  at tangan.track (tangan.js:48)", startX + 14, startY + 34);

    // Tampilkan Peringatan Goyangan Dinamis jika ada
    if (dynamicErrors.length > 0) {
      ctx.fillStyle = "#ffff76";
      ctx.fillText(dynamicErrors[dynamicErrors.length - 1].msg, startX + 8, startY + 52);
    } else {
      ctx.fillStyle = "#ffd2d2";
      ctx.fillText("Warning: 5 jari terdeteksi, normal kan.", startX + 8, startY + 52);
    }

    ctx.fillStyle = "#ffb0b0";
    ctx.fillText("UnhandledPromiseRejection: waktu habis", startX + 8, startY + 70);
  } else {
    ctx.fillText("Scanning: Mencari objek tangan...", startX + 8, startY + 25);
    ctx.fillStyle = "#ff9999";
    ctx.fillText("Arahkan tangan ke depan kamera", startX + 8, startY + 45);
  }
  ctx.restore();
}

// ------------------------------------------------------------------
// Perekam Layar AR Otomatis (MediaRecorder API)
// ------------------------------------------------------------------
let mediaRecorder = null;
let recordedChunks = [];
let isRecording = false;

function setupScreenRecorder() {
  btnRecord.addEventListener('click', () => {
    if (!isRecording) {
      startRecording();
    } else {
      stopRecording();
    }
  });
}

function startRecording() {
  recordedChunks = [];
  const stream = canvas.captureStream(30); // Rekam kanvas 30fps

  const options = { mimeType: 'video/webm;codecs=vp9' };
  try {
    mediaRecorder = new MediaRecorder(stream, options);
  } catch (e) {
    mediaRecorder = new MediaRecorder(stream);
  }

  mediaRecorder.ondataavailable = (e) => {
    if (e.data.size > 0) recordedChunks.push(e.data);
  };

  mediaRecorder.onstop = () => {
    const blob = new Blob(recordedChunks, { type: 'video/webm' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    a.download = `vscode-ar-${Date.now()}.webm`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    }, 100);
  };

  mediaRecorder.start();
  isRecording = true;
  btnRecord.classList.add('recording');
  recText.innerText = "STOP";
}

function stopRecording() {
  if (mediaRecorder && isRecording) {
    mediaRecorder.stop();
    isRecording = false;
    btnRecord.classList.remove('recording');
    recText.innerText = "REC";
  }
}

// ------------------------------------------------------------------
// Manajemen Kamera & Start
// ------------------------------------------------------------------
async function startCamera() {
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }

  if (currentStream) {
    currentStream.getTracks().forEach(track => track.stop());
    currentStream = null;
  }
  video.srcObject = null;

  const constraints = {
    video: {
      facingMode: currentFacingMode,
      width: { ideal: 1280 },
      height: { ideal: 720 }
    },
    audio: false
  };

  try {
    currentStream = await navigator.mediaDevices.getUserMedia(constraints);
    video.srcObject = currentStream;
    await video.play();

    startOverlay.style.display = 'none';
    camModeText.innerText = (currentFacingMode === "user") ? "Kamera: Depan" : "Kamera: Belakang";

    const processFrame = async () => {
      if (video.readyState >= 2) {
        await hands.send({ image: video });
      }
      animationFrameId = requestAnimationFrame(processFrame);
    };

    animationFrameId = requestAnimationFrame(processFrame);
  } catch (err) {
    console.warn("Gagal membuka kamera spesifik: ", err);
    try {
      currentStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      video.srcObject = currentStream;
      await video.play();
      startOverlay.style.display = 'none';
    } catch (finalErr) {
      alert("Izin kamera gagal: " + finalErr.message);
    }
  }
}

btnToggleCam.addEventListener('click', () => {
  currentFacingMode = (currentFacingMode === "environment") ? "user" : "environment";
  startCamera();
});

btnStart.addEventListener('click', () => {
  initAudio();
  startCamera();
  setupScreenRecorder();
});
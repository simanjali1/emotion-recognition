// ============================================================
// CONFIGURATION
// ============================================================

const EMOTIONS = ['angry', 'disgust', 'fear', 'happy', 'neutral', 'sad', 'surprise'];
const MODEL_PATH       = 'model/model.json';
const MODEL_PART1_PATH = 'model_part1/model.json';
const MODEL_PART2_PATH = 'model_part2/model.json';
const IMG_SIZE = 224;

// ============================================================
// STATE
// ============================================================

let model      = null;
let modelPart1 = null;
let modelPart2 = null;
let stream         = null;
let webcamActive   = false;
let liveFeedActive = false;
let videoEl        = null;

// ============================================================
// DOM ELEMENTS
// ============================================================

const imageUpload    = document.getElementById('imageUpload');
const webcamBtn      = document.getElementById('webcamBtn');
const captureBtn     = document.getElementById('captureBtn');
const analyzeBtn     = document.getElementById('analyzeBtn');
const clearBtn       = document.getElementById('clearBtn');
const statusEl       = document.getElementById('status');
const previewSection = document.getElementById('previewSection');
const resultsSection = document.getElementById('resultsSection');
const inputCanvas    = document.getElementById('inputCanvas');
const gradcamCanvas  = document.getElementById('gradcamCanvas');
const predLabel      = document.getElementById('predictionLabel');
const predConf       = document.getElementById('predictionConfidence');
const barChart       = document.getElementById('barChart');

const ctx     = inputCanvas.getContext('2d');
const gradCtx = gradcamCanvas.getContext('2d', {willReadFrequently: true});

// ============================================================
// STATUS HELPER — updates the topbar and triggers transitions
// ============================================================

function setStatus(msg) {
  // Update topbar text
  if (statusEl) statusEl.textContent = msg;

  // Update status dot
  const dot = document.getElementById('statusDot');
  if (dot) {
    dot.className = 'status-dot ' + (
      msg.startsWith('❌') ? 'dot--error' :
      (msg.includes('Loading') || msg.includes('Detecting') ||
       msg.includes('Analyzing') || msg.includes('…') || msg.includes('please wait')) ?
      'dot--loading' : 'dot--ok'
    );
  }

  // Trigger screen transition when model is ready
  if (msg === 'Model ready. Upload an image or start webcam.') {
    _onModelReady();
  }
}

function _onModelReady() {
  if (window._stopFakeBar) window._stopFakeBar();
  const bar = document.getElementById('loadBar');
  const lbl = document.getElementById('loadStatus');
  if (bar) { bar.style.transition = 'width 0.4s ease'; bar.style.width = '100%'; }
  if (lbl) lbl.textContent = 'Model loaded successfully.';
  // Show the two CTA buttons
  setTimeout(() => {
    const cta = document.getElementById('lsCta');
    if (cta) cta.classList.add('ls-cta--visible');
  }, 500);
}

function _doTransition() {
  const ls = document.getElementById('loadingScreen');
  const as = document.getElementById('appScreen');
  if (!ls || !as) return;
  ls.classList.add('fade-out');
  setTimeout(() => {
    ls.style.display = 'none';
    as.classList.remove('hidden');
    as.classList.add('fade-in');
  }, 650);
}

// ============================================================
// LOAD MODELS
// ============================================================

async function loadModel() {
  try {
    setStatus('Loading model, please wait…');
    model      = await tf.loadLayersModel(MODEL_PATH);
    modelPart1 = await tf.loadGraphModel(MODEL_PART1_PATH);
    modelPart2 = await tf.loadGraphModel(MODEL_PART2_PATH);
    setStatus('Model ready. Upload an image or start webcam.');
    console.log('✅ All models loaded');
  } catch (err) {
    setStatus('❌ Failed to load model. Check console.');
    console.error(err);
  }
}

// ============================================================
// IMAGE UPLOAD
// ============================================================

imageUpload.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'image/bmp'];
  if (!allowedTypes.includes(file.type)) {
    setStatus('❌ Unsupported file format. Please upload a JPG, PNG, WEBP, or BMP image.');
    imageUpload.value = '';
    return;
  }

  if (file.size > 10 * 1024 * 1024) {
    setStatus('❌ File too large. Please upload an image under 10MB.');
    imageUpload.value = '';
    return;
  }

  stopWebcam();
  const reader = new FileReader();
  reader.onload = (ev) => {
    const img = new Image();
    img.onload = () => {
      drawImageToCanvas(img);
      analyzeBtn.disabled = false;
      setStatus('Image loaded. Click Analyze.');
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
});

// ============================================================
// PASTE FROM CLIPBOARD
// ============================================================

document.addEventListener('paste', (e) => {
  const items = e.clipboardData?.items;
  if (!items) return;
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      const file = item.getAsFile();
      if (!file) return;
      stopWebcam();
      const reader = new FileReader();
      reader.onload = (ev) => {
        const img = new Image();
        img.onload = () => {
          drawImageToCanvas(img);
          analyzeBtn.disabled = false;
          setStatus('Image pasted. Click Analyze.');
        };
        img.src = ev.target.result;
      };
      reader.readAsDataURL(file);
      break;
    }
  }
});

document.getElementById('pasteBtn').addEventListener('click', async () => {
  try {
    const clipboardItems = await navigator.clipboard.read();
    for (const clipboardItem of clipboardItems) {
      for (const type of clipboardItem.types) {
        if (type.startsWith('image/')) {
          const blob = await clipboardItem.getType(type);
          const reader = new FileReader();
          reader.onload = (ev) => {
            const img = new Image();
            img.onload = () => {
              drawImageToCanvas(img);
              analyzeBtn.disabled = false;
              setStatus('Image pasted. Click Analyze.');
            };
            img.src = ev.target.result;
          };
          reader.readAsDataURL(blob);
          return;
        }
      }
    }
    setStatus('❌ No image found in clipboard. Copy an image first.');
  } catch (err) {
    setStatus('❌ Could not access clipboard. Try Ctrl+V instead.');
  }
});

// ============================================================
// WEBCAM
// ============================================================

webcamBtn.addEventListener('click', async () => {
  if (webcamActive) { stopWebcam(); return; }
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: true });
    webcamActive = true;
    webcamBtn.textContent = 'Stop Webcam';
    setStatus('Webcam active. Position yourself then click Capture.');

    videoEl = document.createElement('video');
    videoEl.srcObject = stream;
    videoEl.play();

    videoEl.addEventListener('loadeddata', () => {
      previewSection.style.display = 'flex';
      liveFeedActive = true;
      drawLiveFeed();
    });

    captureBtn.style.display = 'inline-flex';
    analyzeBtn.disabled = true;

  } catch (err) {
    setStatus('❌ Could not access webcam.');
    console.error(err);
  }
});

function drawLiveFeed() {
  if (!liveFeedActive || !videoEl) return;
  inputCanvas.width  = IMG_SIZE;
  inputCanvas.height = IMG_SIZE;
  ctx.drawImage(videoEl, 0, 0, IMG_SIZE, IMG_SIZE);
  requestAnimationFrame(drawLiveFeed);
}

captureBtn.addEventListener('click', () => {
  if (!videoEl) return;
  liveFeedActive = false;
  drawImageToCanvas(videoEl);
  if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
  webcamActive = false;
  webcamBtn.textContent    = 'Start Webcam';
  captureBtn.style.display = 'none';
  setStatus('Photo captured. Click Analyze.');
  analyzeBtn.disabled = false;
});

function stopWebcam() {
  if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
  webcamActive             = false;
  liveFeedActive           = false;
  videoEl                  = null;
  webcamBtn.textContent    = 'Start Webcam';
  captureBtn.style.display = 'none';
  analyzeBtn.disabled      = true;
  previewSection.style.display = 'none';
  setStatus('Model ready. Upload an image or start webcam.');
}

// ============================================================
// DRAW IMAGE TO CANVAS
// ============================================================

function drawImageToCanvas(source) {
  inputCanvas.width  = IMG_SIZE;
  inputCanvas.height = IMG_SIZE;
  ctx.drawImage(source, 0, 0, IMG_SIZE, IMG_SIZE);
  previewSection.style.display = 'flex';
}

// ============================================================
// FACE DETECTION
// ============================================================

async function detectFace() {
  return new Promise((resolve) => {
    const faceDetection = new FaceDetection({
      locateFile: (file) =>
        `https://cdn.jsdelivr.net/npm/@mediapipe/face_detection/${file}`
    });

    faceDetection.setOptions({ model: 'short', minDetectionConfidence: 0.5 });

    faceDetection.onResults((results) => {
      faceDetection.close();
      if (results.detections.length === 0) resolve(null);
      else resolve(results.detections[0].boundingBox);
    });

    const imgEl = new Image();
    imgEl.onload = async () => { await faceDetection.send({image: imgEl}); };
    imgEl.src = inputCanvas.toDataURL();
  });
}

// ============================================================
// ANALYZE
// ============================================================

analyzeBtn.addEventListener('click', async () => {
  if (!model || !modelPart1 || !modelPart2) { setStatus('Model not loaded yet.'); return; }

  setStatus('Detecting face…');
  analyzeBtn.disabled = true;

  try {
    const box = await detectFace();
    if (!box) {
      setStatus('❌ No face detected. Please upload a clear face image.');
      analyzeBtn.disabled = false;
      return;
    }

    const x = Math.max(0, box.xCenter * IMG_SIZE - (box.width  * IMG_SIZE) / 2);
    const y = Math.max(0, box.yCenter * IMG_SIZE - (box.height * IMG_SIZE) / 2);
    const w = Math.min(box.width  * IMG_SIZE, IMG_SIZE - x);
    const h = Math.min(box.height * IMG_SIZE, IMG_SIZE - y);

    const faceCanvas  = document.createElement('canvas');
    faceCanvas.width  = IMG_SIZE;
    faceCanvas.height = IMG_SIZE;
    const faceCtx     = faceCanvas.getContext('2d');
    faceCtx.drawImage(inputCanvas, x, y, w, h, 0, 0, IMG_SIZE, IMG_SIZE);

    ctx.clearRect(0, 0, IMG_SIZE, IMG_SIZE);
    ctx.drawImage(faceCanvas, 0, 0);

    setStatus('Analyzing…');

    const tensor = tf.tidy(() => {
      return tf.browser.fromPixels(faceCanvas)
        .resizeBilinear([IMG_SIZE, IMG_SIZE])
        .toFloat().div(255.0).expandDims(0);
    });

    const predictions = model.predict(tensor);
    const scores      = await predictions.data();
    predictions.dispose();

    const maxIdx     = scores.indexOf(Math.max(...scores));
    const emotion    = EMOTIONS[maxIdx];
    const confidence = (scores[maxIdx] * 100).toFixed(1);

    predLabel.textContent = emotion;
    predConf.textContent  = `Confidence: ${confidence}%`;
    renderBarChart(scores, maxIdx);
    await renderGradCAM(tensor, maxIdx);

    tensor.dispose();
    resultsSection.style.display = 'flex';
    setStatus('Done.');

  } catch (err) {
    setStatus('❌ Analysis failed. Check console.');
    console.error(err);
  }

  analyzeBtn.disabled = false;
});

// ============================================================
// BAR CHART
// ============================================================

function renderBarChart(scores, topIdx) {
  barChart.innerHTML = '';
  EMOTIONS.forEach((emotion, i) => {
    const pct = (scores[i] * 100).toFixed(1);
    const row = document.createElement('div');
    row.className = 'bar-row';
    row.innerHTML = `
      <span class="bar-label">${emotion}</span>
      <div class="bar-track">
        <div class="bar-fill ${i === topIdx ? 'top' : ''}" style="width:${pct}%"></div>
      </div>
      <span class="bar-value">${pct}%</span>
    `;
    barChart.appendChild(row);
  });
}

// ============================================================
// GRAD-CAM
// ============================================================

async function renderGradCAM(inputTensor, classIdx) {
  gradcamCanvas.width  = IMG_SIZE;
  gradcamCanvas.height = IMG_SIZE;
  gradCtx.drawImage(inputCanvas, 0, 0);

  try {
    const convOutputs = modelPart1.predict(inputTensor);

    const gradFn = tf.grad((convOut) => {
      const preds = modelPart2.predict(convOut);
      return preds.gather([classIdx], 1).squeeze();
    });

    const grads = gradFn(convOutputs);

    const cam = tf.tidy(() => {
      const squeezed = convOutputs.squeeze([0]);
      const gradsSq  = grads.squeeze([0]);
      const pooled   = gradsSq.mean([0, 1]);
      const weighted = squeezed.mul(pooled);
      const summed   = weighted.sum(-1);
      const relu     = tf.relu(summed);
      const reluMax  = relu.max();
      const useAbs   = reluMax.less(tf.scalar(1e-6));
      const absSum   = summed.abs();
      const final    = tf.where(useAbs, absSum, relu);
      const min      = final.min();
      const max      = final.max();
      const norm     = final.sub(min).div(max.sub(min).add(1e-8));
      return norm.expandDims(-1).resizeBilinear([IMG_SIZE, IMG_SIZE]).squeeze();
    });

    const heatmapArr = await cam.data();
    convOutputs.dispose();
    grads.dispose();
    cam.dispose();

    const imageData = gradCtx.getImageData(0, 0, IMG_SIZE, IMG_SIZE);
    for (let i = 0; i < IMG_SIZE * IMG_SIZE; i++) {
      const heat = heatmapArr[i];
      if (heat > 0.2) {
        const intensity = (heat - 0.2) / 0.8;
        let r, g, b;
        if (intensity < 0.25) {
          r = 0;   g = Math.round(intensity * 4 * 255); b = 255;
        } else if (intensity < 0.5) {
          r = 0;   g = 255; b = Math.round((0.5 - intensity) * 4 * 255);
        } else if (intensity < 0.75) {
          r = Math.round((intensity - 0.5) * 4 * 255); g = 255; b = 0;
        } else {
          r = 255; g = Math.round((1 - intensity) * 4 * 255); b = 0;
        }
        const alpha = 0.55;
        imageData.data[i * 4]     = Math.round(imageData.data[i * 4]     * (1 - alpha) + r * alpha);
        imageData.data[i * 4 + 1] = Math.round(imageData.data[i * 4 + 1] * (1 - alpha) + g * alpha);
        imageData.data[i * 4 + 2] = Math.round(imageData.data[i * 4 + 2] * (1 - alpha) + b * alpha);
      }
    }
    gradCtx.putImageData(imageData, 0, 0);

  } catch (err) {
    console.error('Grad-CAM error:', err);
    gradCtx.drawImage(inputCanvas, 0, 0);
  }
}

// ============================================================
// CLEAR
// ============================================================

clearBtn.addEventListener('click', () => {
  stopWebcam();
  imageUpload.value            = '';
  previewSection.style.display = 'none';
  resultsSection.style.display = 'none';
  predLabel.textContent        = '—';
  predConf.textContent         = '';
  barChart.innerHTML           = '';
  analyzeBtn.disabled          = true;
  setStatus('Model ready. Upload an image or start webcam.');
});

// ============================================================
// INIT
// ============================================================

loadModel();
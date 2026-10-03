import { FaceDetector, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/+esm";

const cameraButton = document.querySelector("#cameraButton");
const cameraFeed = document.querySelector("#cameraFeed");
const cameraView = document.querySelector("#cameraView");
const faceOverlay = document.querySelector("#faceOverlay");
const visionState = document.querySelector("#visionState");
const overlayContext = faceOverlay.getContext("2d");

let detector;
let mediaStream;
let animationFrame;
let lastVideoTime = -1;

async function getDetector() {
  if (detector) return detector;
  visionState.textContent = "Modell wird geladen";
  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm",
  );
  detector = await FaceDetector.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite",
      delegate: "GPU",
    },
    runningMode: "VIDEO",
    minDetectionConfidence: 0.65,
  });
  return detector;
}

function drawFaces(detections) {
  faceOverlay.width = cameraFeed.videoWidth;
  faceOverlay.height = cameraFeed.videoHeight;
  overlayContext.clearRect(0, 0, faceOverlay.width, faceOverlay.height);
  overlayContext.strokeStyle = "#52e0c4";
  overlayContext.fillStyle = "#a0f1de";
  overlayContext.lineWidth = Math.max(3, cameraFeed.videoWidth / 350);
  overlayContext.font = `${Math.max(18, cameraFeed.videoWidth / 36)}px Consolas`;

  detections.forEach((detection) => {
    const { originX, originY, width, height } = detection.boundingBox;
    overlayContext.strokeRect(originX, originY, width, height);
    overlayContext.fillText("GESICHT ERKANNT", originX, Math.max(24, originY - 12));
  });
}

function detectFaces() {
  if (!mediaStream || cameraFeed.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
    animationFrame = requestAnimationFrame(detectFaces);
    return;
  }
  if (cameraFeed.currentTime !== lastVideoTime) {
    const result = detector.detectForVideo(cameraFeed, performance.now());
    lastVideoTime = cameraFeed.currentTime;
    drawFaces(result.detections);
    visionState.textContent = result.detections.length ? "Gesicht erkannt" : "Suche nach Gesicht";
  }
  animationFrame = requestAnimationFrame(detectFaces);
}

function stopCamera() {
  cancelAnimationFrame(animationFrame);
  mediaStream?.getTracks().forEach((track) => track.stop());
  mediaStream = undefined;
  cameraFeed.srcObject = null;
  overlayContext.clearRect(0, 0, faceOverlay.width, faceOverlay.height);
  cameraView.classList.remove("active");
  cameraButton.textContent = "Kamera starten";
  visionState.textContent = "Bereit";
}

async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    visionState.textContent = "Kamera nicht verfügbar";
    return;
  }

  cameraButton.disabled = true;
  try {
    await getDetector();
    mediaStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
    cameraFeed.srcObject = mediaStream;
    await cameraFeed.play();
    lastVideoTime = -1;
    cameraView.classList.add("active");
    cameraButton.textContent = "Kamera stoppen";
    detectFaces();
  } catch (error) {
    visionState.textContent = "Kamerazugriff abgelehnt";
    console.error("Kamera oder Gesichtserkennung konnte nicht gestartet werden.", error);
  } finally {
    cameraButton.disabled = false;
  }
}

cameraButton.addEventListener("click", () => {
  if (mediaStream) {
    stopCamera();
  } else {
    startCamera();
  }
});

window.addEventListener("beforeunload", stopCamera);
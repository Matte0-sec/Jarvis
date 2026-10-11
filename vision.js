import { FilesetResolver, ObjectDetector } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/+esm";

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
let lastDetection;

const germanLabels = {
  airplane: "ein Flugzeug", backpack: "einen Rucksack", banana: "eine Banane", baseball_bat: "einen Baseballschläger",
  baseball_glove: "einen Baseballhandschuh", bear: "einen Bären", bed: "ein Bett", bench: "eine Bank", bicycle: "ein Fahrrad",
  bird: "einen Vogel", boat: "ein Boot", book: "ein Buch", bottle: "eine Flasche", bowl: "eine Schüssel", bus: "einen Bus",
  car: "ein Auto", cat: "eine Katze", cell_phone: "ein Handy", chair: "einen Stuhl", clock: "eine Uhr", couch: "ein Sofa",
  cow: "eine Kuh", cup: "eine Tasse", dining_table: "einen Tisch", dog: "einen Hund", elephant: "einen Elefanten",
  fire_hydrant: "einen Hydranten", fork: "eine Gabel", frisbee: "eine Frisbee", giraffe: "eine Giraffe", handbag: "eine Handtasche",
  horse: "ein Pferd", keyboard: "eine Tastatur", kite: "einen Drachen", knife: "ein Messer", laptop: "einen Laptop",
  microwave: "eine Mikrowelle", motorcycle: "ein Motorrad", mouse: "eine Computermaus", orange: "eine Orange", oven: "einen Ofen",
  parking_meter: "eine Parkuhr", person: "eine Person", pizza: "eine Pizza", potted_plant: "eine Zimmerpflanze", refrigerator: "einen Kühlschrank",
  remote: "eine Fernbedienung", sandwich: "ein Sandwich", scissors: "eine Schere", sheep: "ein Schaf", sink: "ein Waschbecken",
  skateboard: "ein Skateboard", skis: "Ski", snowboard: "ein Snowboard", spoon: "einen Löffel", sports_ball: "einen Ball",
  stop_sign: "ein Stoppschild", suitcase: "einen Koffer", surfboard: "ein Surfbrett", teddy_bear: "einen Teddybären", tennis_racket: "einen Tennisschläger",
  tie: "eine Krawatte", toaster: "einen Toaster", toilet: "eine Toilette", toothbrush: "eine Zahnbürste", traffic_light: "eine Ampel",
  train: "einen Zug", truck: "einen Lastwagen", tv: "einen Fernseher", umbrella: "einen Regenschirm", vase: "eine Vase", wine_glass: "ein Weinglas", zebra: "ein Zebra",
};

async function getDetector() {
  if (detector) return detector;
  visionState.textContent = "Modell wird geladen";
  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm",
  );
  const options = {
    baseOptions: {
      modelAssetPath: "https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float32/1/efficientdet_lite0.tflite",
    },
    runningMode: "VIDEO",
    scoreThreshold: 0.3,
  };
  try {
    detector = await ObjectDetector.createFromOptions(vision, {
      ...options,
      baseOptions: { ...options.baseOptions, delegate: "GPU" },
    });
  } catch {
    detector = await ObjectDetector.createFromOptions(vision, {
      ...options,
      baseOptions: { ...options.baseOptions, delegate: "CPU" },
    });
  }
  return detector;
}

function drawObjects(detections) {
  faceOverlay.width = cameraFeed.videoWidth;
  faceOverlay.height = cameraFeed.videoHeight;
  overlayContext.clearRect(0, 0, faceOverlay.width, faceOverlay.height);
  overlayContext.strokeStyle = "#52e0c4";
  overlayContext.fillStyle = "#a0f1de";
  overlayContext.lineWidth = Math.max(3, cameraFeed.videoWidth / 350);
  overlayContext.font = `${Math.max(18, cameraFeed.videoWidth / 36)}px Consolas`;

  detections.forEach((detection) => {
    const { originX, originY, width, height } = detection.boundingBox;
    const category = detection.categories[0];
    const className = category.categoryName.replace(/ /g, "_");
    const label = germanLabels[className] || category.categoryName;
    overlayContext.strokeRect(originX, originY, width, height);
    overlayContext.fillText(`${label.toUpperCase()} ${Math.round(category.score * 100)}%`, originX, Math.max(24, originY - 12));
  });
}

async function detectObjects() {
  if (!mediaStream || cameraFeed.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
    animationFrame = requestAnimationFrame(detectObjects);
    return;
  }
  if (cameraFeed.currentTime !== lastVideoTime) {
    const result = detector.detectForVideo(cameraFeed, performance.now());
    lastVideoTime = cameraFeed.currentTime;
    lastDetection = result.detections[0];
    drawObjects(lastDetection ? [lastDetection] : []);
    visionState.textContent = lastDetection ? "Objekt erkannt" : "Suche nach Objekt - Gegenstand näher zeigen";
  }
  animationFrame = requestAnimationFrame(detectObjects);
}

function stopCamera() {
  cancelAnimationFrame(animationFrame);
  mediaStream?.getTracks().forEach((track) => track.stop());
  mediaStream = undefined;
  cameraFeed.srcObject = null;
  overlayContext.clearRect(0, 0, faceOverlay.width, faceOverlay.height);
  lastDetection = undefined;
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
    mediaStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
    cameraFeed.srcObject = mediaStream;
    await cameraFeed.play();
    cameraView.classList.add("active");
    cameraButton.textContent = "Kamera stoppen";
    await getDetector();
    lastVideoTime = -1;
    detectObjects();
  } catch (error) {
    if (mediaStream) {
      visionState.textContent = "Kamera aktiv, Objekterkennung konnte nicht geladen werden";
      console.error("Objekterkennung konnte nicht geladen werden.", error);
      return;
    }
    const errorMessages = {
      NotAllowedError: location.protocol === "file:"
        ? "Kamera braucht eine sichere Adresse: GitHub Page oder localhost verwenden"
        : "Kameraberechtigung im Browser oder in Windows erlauben",
      NotFoundError: "Keine verwendbare Kamera gefunden",
      NotReadableError: "Kamera wird bereits von einer anderen App verwendet",
      OverconstrainedError: "Diese Kameraeinstellung wird nicht unterstützt",
      SecurityError: "Kamera wird vom Browser aus Sicherheitsgründen blockiert",
      TypeError: "Kamera braucht eine sichere Adresse: GitHub Page oder localhost verwenden",
    };
    visionState.textContent = errorMessages[error.name] || `Kamera-Fehler: ${error.name || "unbekannt"}`;
    console.error("Kamera oder Objekterkennung konnte nicht gestartet werden.", error);
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

window.jarvisObjectVision = {
  describe() {
    if (!mediaStream) return null;
    if (!lastDetection) return "Ich erkenne noch kein Objekt zuverlässig. Halten Sie es näher an die Kamera und sorgen Sie für gutes Licht.";
    const className = lastDetection.categories[0].categoryName.replace(/ /g, "_");
    const object = germanLabels[className] || `ein Objekt der Kategorie ${lastDetection.categories[0].categoryName}`;
    return `Ich erkenne wahrscheinlich ${object}.`;
  },
};
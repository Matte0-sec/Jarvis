import * as cocoSsd from "https://cdn.jsdelivr.net/npm/@tensorflow-models/coco-ssd@2.2.3/+esm";

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
  detector = await cocoSsd.load({ base: "lite_mobilenet_v2" });
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
    const [originX, originY, width, height] = detection.bbox;
    const label = germanLabels[detection.class] || detection.class;
    overlayContext.strokeRect(originX, originY, width, height);
    overlayContext.fillText(label.toUpperCase(), originX, Math.max(24, originY - 12));
  });
}

async function detectObjects() {
  if (!mediaStream || cameraFeed.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
    animationFrame = requestAnimationFrame(detectObjects);
    return;
  }
  if (cameraFeed.currentTime !== lastVideoTime) {
    const result = await detector.detect(cameraFeed);
    lastVideoTime = cameraFeed.currentTime;
    lastDetection = result.filter((detection) => detection.score >= 0.55).sort((first, second) => second.score - first.score)[0];
    drawObjects(lastDetection ? [lastDetection] : []);
    visionState.textContent = lastDetection ? "Objekt erkannt" : "Suche nach Objekt";
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
    detectObjects();
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

window.jarvisObjectVision = {
  describe() {
    if (!mediaStream) return null;
    if (!lastDetection) return "Ich erkenne noch kein Objekt zuverlässig. Halten Sie es näher an die Kamera und sorgen Sie für gutes Licht.";
    const object = germanLabels[lastDetection.class] || `ein Objekt der Kategorie ${lastDetection.class}`;
    return `Ich erkenne wahrscheinlich ${object}.`;
  },
};
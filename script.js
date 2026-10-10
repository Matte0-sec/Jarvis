const chatForm = document.querySelector("#chatForm");
const promptInput = document.querySelector("#prompt");
const chatLog = document.querySelector("#chatLog");
const assistantStatus = document.querySelector("#assistantStatus");
const notesList = document.querySelector("#notesList");
const voiceState = document.querySelector("#voiceState");
const micButton = document.querySelector("#micButton");
const modelState = document.querySelector("#modelState");
const desktopState = document.querySelector("#desktopState");
const wakeScreen = document.querySelector("#wakeScreen");
const wakeStatus = document.querySelector("#wakeStatus");
const wakeRetry = document.querySelector("#wakeRetry");
const ollamaUrl = "http://127.0.0.1:11434/api/chat";
const ollamaModel = "gemma3:1b";
const desktopUrl = "http://127.0.0.1:3210";

let notes = JSON.parse(localStorage.getItem("jarvis-notes") || "[]");
let appointments = JSON.parse(localStorage.getItem("jarvis-appointments") || "[]");
let alternateTheme = false;
let germanVoice;
let wakeStream;
let wakeAudioContext;
let wakeAnimationFrame;
let clapTimes = [];
let lastClapTime = 0;

function stopWakeListener() {
  cancelAnimationFrame(wakeAnimationFrame);
  wakeStream?.getTracks().forEach((track) => track.stop());
  wakeStream = undefined;
  wakeAudioContext?.close();
  wakeAudioContext = undefined;
  clapTimes = [];
}

function activateJarvis() {
  stopWakeListener();
  wakeScreen.classList.add("awake");
  assistantStatus.textContent = "Aktiviert. Wie darf ich Sie unterstützen?";
  speak("Jarvis aktiviert. Wie darf ich Sie unterstützen?");
  promptInput.focus();
}

function listenForClaps(analyser, samples) {
  if (!wakeStream) return;
  analyser.getByteTimeDomainData(samples);
  let squaredTotal = 0;
  let peak = 0;
  for (const sample of samples) {
    const offset = Math.abs(sample - 128);
    squaredTotal += offset ** 2;
    peak = Math.max(peak, offset);
  }
  const volume = Math.sqrt(squaredTotal / samples.length);
  const now = performance.now();

  if ((volume > 8 || peak > 55) && now - lastClapTime > 130) {
    lastClapTime = now;
    clapTimes = [...clapTimes, now].filter((time) => now - time < 1200);
    if (clapTimes.length >= 2) {
      activateJarvis();
      return;
    }
  }
  wakeAnimationFrame = requestAnimationFrame(() => listenForClaps(analyser, samples));
}

async function startWakeListener() {
  if (!navigator.mediaDevices?.getUserMedia) {
    wakeStatus.textContent = "Mikrofon wird von diesem Browser nicht unterstützt";
    wakeRetry.disabled = false;
    return;
  }

  wakeRetry.disabled = true;
  wakeStatus.textContent = "Mikrofon wird aktiviert ...";
  try {
    wakeStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: false },
      video: false,
    });
    wakeAudioContext = new AudioContext();
    const source = wakeAudioContext.createMediaStreamSource(wakeStream);
    const analyser = wakeAudioContext.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser);
    await wakeAudioContext.resume();
    if (wakeAudioContext.state !== "running") {
      wakeStatus.textContent = "Einmal klicken, um das Mikrofon zu aktivieren";
      wakeRetry.disabled = false;
      return;
    }
    wakeStatus.textContent = "Warte auf zwei Klatscher";
    wakeScreen.classList.add("listening");
    listenForClaps(analyser, new Uint8Array(analyser.fftSize));
  } catch {
    wakeStatus.textContent = "Mikrofonberechtigung erforderlich";
    wakeRetry.disabled = false;
  }
}

function updateVoice() {
  const voices = speechSynthesis.getVoices();
  const preferredNames = ["Microsoft Katja", "Microsoft Conrad", "Google Deutsch", "German"];
  germanVoice = voices.find((voice) => preferredNames.some((name) => voice.name.includes(name)))
    || voices.find((voice) => voice.lang.toLowerCase().startsWith("de"));
  voiceState.textContent = germanVoice ? "Deutsch bereit" : "deutsches Sprachpaket fehlt";
}

function updateClock() {
  const now = new Date();
  document.querySelector("#time").textContent = now.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  document.querySelector("#date").textContent = now.toLocaleDateString("de-DE", { weekday: "long", day: "2-digit", month: "long" });
}

function addMessage(text, sender = "assistant") {
  const message = document.createElement("article");
  message.className = `message ${sender}-message`;
  const label = sender === "assistant" ? "JARVIS" : "DU";
  message.innerHTML = `<span class="message-label">${label}</span><p></p>`;
  message.querySelector("p").textContent = text;
  chatLog.append(message);
  chatLog.scrollTop = chatLog.scrollHeight;
}

function renderNotes() {
  notesList.replaceChildren();
  if (!notes.length) {
    const empty = document.createElement("li");
    empty.className = "empty-state";
    empty.textContent = "Noch keine Notizen gespeichert.";
    notesList.append(empty);
    return;
  }
  notes.slice(0, 5).forEach((note) => {
    const item = document.createElement("li");
    item.textContent = note;
    notesList.append(item);
  });
}

function saveNote(note) {
  notes.unshift(note);
  notes = notes.slice(0, 10);
  localStorage.setItem("jarvis-notes", JSON.stringify(notes));
  renderNotes();
}

function formatAppointmentDate(date) {
  return date.toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" })
    + ` um ${date.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })} Uhr`;
}

function parseAppointment(command) {
  const match = command.match(/\b(heute|morgen)\b.*?\bum\s+(\d{1,2})(?:[:.](\d{2}))?\s*uhr\b/i);
  if (!match) return null;

  const date = new Date();
  if (match[1].toLocaleLowerCase("de-DE") === "morgen") date.setDate(date.getDate() + 1);
  date.setHours(Number(match[2]), Number(match[3] || 0), 0, 0);
  if (Number.isNaN(date.getTime()) || match[2] > 23 || Number(match[3] || 0) > 59) return null;

  const description = command
    .replace(/^(ich\s+)?habe\s+/i, "")
    .replace(/\b(heute|morgen)\b.*?\bum\s+\d{1,2}(?:[:.]\d{2})?\s*uhr\s*/i, "")
    .replace(/^einen?\s+termin\s*/i, "")
    .trim() || "Termin";
  return { date: date.toISOString(), description };
}

function saveAppointment(appointment) {
  appointments.push(appointment);
  appointments.sort((first, second) => new Date(first.date) - new Date(second.date));
  localStorage.setItem("jarvis-appointments", JSON.stringify(appointments));
  saveNote(`Termin: ${appointment.description} - ${formatAppointmentDate(new Date(appointment.date))}`);
}

function getUpcomingAppointments() {
  const now = new Date();
  return appointments.filter((appointment) => new Date(appointment.date) >= now);
}

function speak(text) {
  if (!("speechSynthesis" in window) || !germanVoice) return;
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = germanVoice.lang;
  utterance.voice = germanVoice;
  utterance.rate = 0.9;
  utterance.pitch = 0.96;
  speechSynthesis.speak(utterance);
}

async function askLocalModel(input) {
  const response = await fetch(ollamaUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: ollamaModel,
      stream: false,
      messages: [
        {
          role: "system",
          content: "Du bist JARVIS, ein hilfreicher persönlicher Assistent. Antworte immer auf natürlichem Deutsch, freundlich, präzise und eher kurz. Erfinde keine ausgeführten Aktionen oder Fakten.",
        },
        { role: "user", content: input },
      ],
    }),
  });

  if (!response.ok) throw new Error("Lokales Modell antwortet nicht.");
  const result = await response.json();
  return result.message?.content?.trim() || "Dazu habe ich keine Antwort erhalten.";
}

async function runDesktopAction(action, target) {
  const response = await fetch(`${desktopUrl}/desktop/action`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, target }),
  });
  if (!response.ok) throw new Error("Desktop-Dienst antwortet nicht.");
  return response.json();
}

function getWebsiteTarget(command) {
  const sites = {
    youtube: "https://www.youtube.com",
    google: "https://www.google.com",
    github: "https://github.com",
    spotify: "https://open.spotify.com",
    netflix: "https://www.netflix.com",
  };
  const knownSite = Object.keys(sites).find((site) => command.includes(site));
  if (knownSite) return sites[knownSite];

    const target = command.replace(/^(öffne|starte)\s+(die|den|das)?\s*/i, "").trim();
  const domainPattern = /^(https?:\/\/)?(www\.)?[a-z0-9-]+\.[a-z]{2,}(\/[^\s]*)?$/i;
  if (!domainPattern.test(target)) return null;
  return target.startsWith("http") ? target : `https://${target}`;
}

async function respond(input) {
  const command = input.trim();
  const normalized = command.toLocaleLowerCase("de-DE");
  let response;

  if (/^(hallo|hi|guten)/.test(normalized)) {
    response = "Guten Tag. Es freut mich, Ihnen behilflich sein zu dürfen. Alle Systeme sind betriebsbereit.";
  } else if (/(habe ich|welche|meine|zeige).*termine|termine.*(habe ich|welche|meine|zeigen)/.test(normalized)) {
    const upcomingAppointments = getUpcomingAppointments();
    if (!upcomingAppointments.length) {
      response = "Sie haben keine kommenden Termine gespeichert.";
    } else {
      response = `Sie haben ${upcomingAppointments.length} kommenden ${upcomingAppointments.length === 1 ? "Termin" : "Termine"}: ${upcomingAppointments.map((appointment) => `${appointment.description}, ${formatAppointmentDate(new Date(appointment.date))}`).join(". ")}.`;
    }
  } else if (normalized.includes("termin")) {
    const appointment = parseAppointment(command);
    if (!appointment) {
      response = "Nennen Sie bitte einen Termin mit Tag und Uhrzeit, zum Beispiel: Ich habe morgen um 13 Uhr einen Termin beim Arzt.";
    } else {
      saveAppointment(appointment);
      response = `Vermerkt. ${appointment.description} ist für ${formatAppointmentDate(new Date(appointment.date))} gespeichert.`;
    }
  } else if (normalized.includes("uhr") || normalized.includes("zeit") || normalized.includes("wie spät")) {
    response = `Gewiss. Es ist ${new Date().toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })} Uhr.`;
  } else if (normalized.includes("datum") || normalized.includes("welcher tag")) {
    response = `Heute ist ${new Date().toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}.`;
  } else if (normalized.startsWith("notiz")) {
    const note = command.replace(/^notiz\s*:?\s*/i, "").trim();
    if (!note) {
      response = "Sehr gern. Was darf ich für Sie notieren?";
    } else {
      saveNote(note);
      response = "Vermerkt. Die Notiz wurde gespeichert.";
    }
  } else if (normalized.startsWith("suche") || normalized.startsWith("search")) {
    const query = command.replace(/^(suche( nach)?|search)\s*/i, "").trim();
    if (!query) {
      response = "Selbstverständlich. Wonach soll ich für Sie suchen?";
    } else {
      window.open(`https://www.google.com/search?q=${encodeURIComponent(query)}`, "_blank", "noopener");
      response = `Selbstverständlich. Ich suche nach ${query}.`;
    }
  } else if (/^(öffne|starte)\b/.test(normalized) && getWebsiteTarget(command)) {
    const website = getWebsiteTarget(command);
    try {
      await runDesktopAction("website", website);
      response = "Die Webseite wurde im Standardbrowser geöffnet.";
    } catch {
      desktopState.textContent = "nicht verbunden";
      response = "Der Desktop-Modus ist nicht gestartet. Führen Sie zuerst desktop-server.ps1 auf diesem PC aus.";
    }
  } else if (/(öffne|starte)/.test(normalized) && /(rechner|taschenrechner|calculator)/.test(normalized)) {
    try {
      await runDesktopAction("calculator");
      response = "Der Rechner wurde geöffnet.";
    } catch {
      desktopState.textContent = "nicht verbunden";
      response = "Der Desktop-Modus ist nicht gestartet. Führen Sie zuerst desktop-server.ps1 auf diesem PC aus.";
    }
  } else if (/(öffne|starte)/.test(normalized) && /(editor|notepad|texteditor)/.test(normalized)) {
    try {
      await runDesktopAction("editor");
      response = "Der Texteditor wurde geöffnet.";
    } catch {
      desktopState.textContent = "nicht verbunden";
      response = "Der Desktop-Modus ist nicht gestartet. Führen Sie zuerst desktop-server.ps1 auf diesem PC aus.";
    }
  } else if (/(öffne|zeige)/.test(normalized) && /(dateien|explorer|ordner)/.test(normalized)) {
    try {
      await runDesktopAction("files");
      response = "Ihr Benutzerordner wurde geöffnet.";
    } catch {
      desktopState.textContent = "nicht verbunden";
      response = "Der Desktop-Modus ist nicht gestartet. Führen Sie zuerst desktop-server.ps1 auf diesem PC aus.";
    }
  } else if (/(öffne|starte)/.test(normalized) && /(einstellungen|settings)/.test(normalized)) {
    try {
      await runDesktopAction("settings");
      response = "Die Windows-Einstellungen wurden geöffnet.";
    } catch {
      desktopState.textContent = "nicht verbunden";
      response = "Der Desktop-Modus ist nicht gestartet. Führen Sie zuerst desktop-server.ps1 auf diesem PC aus.";
    }
  } else if (normalized.includes("thema") || normalized.includes("ansicht")) {
    alternateTheme = !alternateTheme;
    document.documentElement.style.setProperty("--accent", alternateTheme ? "#f1bf75" : "#52e0c4");
    document.documentElement.style.setProperty("--accent-soft", alternateTheme ? "#ffe2ad" : "#a0f1de");
    response = "Die Darstellung wurde angepasst.";
  } else if (normalized.includes("hilfe") || normalized.includes("was kannst")) {
    response = "Ich kann Ihnen die Uhrzeit und das Datum nennen, Notizen sichern, eine Websuche öffnen und die Darstellung anpassen. Geben Sie einfach eine Anweisung ein oder verwenden Sie das Mikrofon.";
  } else {
    assistantStatus.textContent = "Die lokale KI verarbeitet Ihre Anfrage. Das kann einen Moment dauern ...";
    try {
      response = await askLocalModel(command);
    } catch {
      modelState.textContent = "nicht erreichbar";
      response = "Die lokale KI ist im Moment nicht erreichbar. Bitte starten Sie Ollama und versuchen Sie es erneut.";
    }
  }

  assistantStatus.textContent = response;
  addMessage(response);
  speak(response);
  return response;
}

async function checkLocalModel() {
  try {
    const response = await fetch("http://127.0.0.1:11434/api/tags");
    const result = await response.json();
    const isInstalled = result.models?.some((model) => model.name === ollamaModel);
    modelState.textContent = isInstalled ? "lokal bereit" : "Modell fehlt";
  } catch {
    modelState.textContent = "nicht erreichbar";
  }
}

async function checkDesktopService() {
  try {
    const response = await fetch(`${desktopUrl}/desktop/status`);
    desktopState.textContent = response.ok ? "lokal bereit" : "nicht verbunden";
  } catch {
    desktopState.textContent = "nicht verbunden";
  }
}

chatForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const input = promptInput.value.trim();
  if (!input) return;
  addMessage(input, "user");
  promptInput.value = "";
  respond(input);
});

document.querySelectorAll(".quick-action").forEach((button) => {
  button.addEventListener("click", () => {
    const command = button.dataset.command;
    if (command.endsWith(": ") || command.endsWith("nach ")) {
      promptInput.value = command;
      promptInput.focus();
      return;
    }
    addMessage(command, "user");
    respond(command);
  });
});

document.querySelector("#clearNotes").addEventListener("click", () => {
  notes = [];
  appointments = [];
  localStorage.removeItem("jarvis-notes");
  localStorage.removeItem("jarvis-appointments");
  renderNotes();
  assistantStatus.textContent = "Notizen wurden gelöscht.";
});

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
if (SpeechRecognition) {
  const recognition = new SpeechRecognition();
  recognition.lang = "de-DE";
  recognition.interimResults = false;
  recognition.addEventListener("start", () => {
    micButton.classList.add("listening");
    voiceState.textContent = "hört zu";
    assistantStatus.textContent = "Ich höre zu ...";
  });
  recognition.addEventListener("end", () => {
    micButton.classList.remove("listening");
    voiceState.textContent = "bereit";
  });
  recognition.addEventListener("result", (event) => {
    const input = event.results[0][0].transcript;
    addMessage(input, "user");
    respond(input);
  });
  micButton.addEventListener("click", () => recognition.start());
} else {
  micButton.disabled = true;
  micButton.title = "Spracheingabe wird von diesem Browser nicht unterstützt";
}

if ("speechSynthesis" in window) {
  updateVoice();
  speechSynthesis.addEventListener("voiceschanged", updateVoice);
} else {
  voiceState.textContent = "Sprachausgabe nicht verfügbar";
}

updateClock();
setInterval(updateClock, 1000);
renderNotes();
checkLocalModel();
setInterval(checkLocalModel, 15000);
checkDesktopService();
setInterval(checkDesktopService, 15000);
wakeRetry.addEventListener("click", (event) => {
  event.stopPropagation();
  startWakeListener();
});
window.addEventListener("beforeunload", stopWakeListener);
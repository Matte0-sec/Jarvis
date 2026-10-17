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
const orbMode = document.querySelector("#orbMode");
const jarvisOrb = document.querySelector("#jarvisOrb");
const orbStatus = document.querySelector("#orbStatus");
const preferencesButton = document.querySelector("#preferencesButton");
const preferencesDialog = document.querySelector("#preferencesDialog");
const preferencesForm = document.querySelector("#preferencesForm");
const voiceSelect = document.querySelector("#voiceSelect");
const speechRate = document.querySelector("#speechRate");
const speechRateValue = document.querySelector("#speechRateValue");
const toneSelect = document.querySelector("#toneSelect");
const testVoiceButton = document.querySelector("#testVoiceButton");
const refreshWebsitesButton = document.querySelector("#refreshWebsitesButton");
const openJarvisWebsiteButton = document.querySelector("#openJarvisWebsiteButton");
const jarvisWebsiteStatus = document.querySelector("#jarvisWebsiteStatus");
const jarvisWebsiteLight = document.querySelector("#jarvisWebsiteLight");
const jarvisWebsiteRepo = document.querySelector("#jarvisWebsiteRepo");
const jarvisRepositoryLink = document.querySelector("#jarvisRepositoryLink");
const openScienceWebsiteButton = document.querySelector("#openScienceWebsiteButton");
const scienceWebsiteStatus = document.querySelector("#scienceWebsiteStatus");
const scienceWebsiteLight = document.querySelector("#scienceWebsiteLight");
const scienceWebsiteRepo = document.querySelector("#scienceWebsiteRepo");
const scienceRepositoryLink = document.querySelector("#scienceRepositoryLink");
const omegaCodeDialog = document.querySelector("#omegaCodeDialog");
const omegaCodeForm = document.querySelector("#omegaCodeForm");
const omegaCodeInput = document.querySelector("#omegaCodeInput");
const omegaCodeError = document.querySelector("#omegaCodeError");
const desktopUrl = "http://127.0.0.1:51827";

let notes = JSON.parse(localStorage.getItem("jarvis-notes") || "[]");
let appointments = JSON.parse(localStorage.getItem("jarvis-appointments") || "[]");
let alternateTheme = false;
let germanVoice;
let wakeStream;
let wakeAudioContext;
let wakeAnimationFrame;
let clapTimes = [];
let lastClapTime = 0;
let interfaceMode = "voice";
let preferences = JSON.parse(localStorage.getItem("jarvis-preferences") || "{}");
let ghostProtocol = sessionStorage.getItem("jarvis-ghost-protocol") === "true";
let omegaProtocol = false;
const omegaPasscode = "1100";

function choose(options) {
  return options[Math.floor(Math.random() * options.length)];
}

function withJarvisTone(message, kind = "neutral") {
  const intros = {
    neutral: ["Natürlich. ", "Gern. ", "Sehr wohl. "],
    ready: ["Alles klar. ", "Sehr gut. ", "Erledigt. "],
    curious: ["Interessant. ", "Ich sehe nach. ", "Eine Sekunde. "],
  };
  return `${choose(intros[kind])}${message}`;
}

function stopWakeListener() {
  cancelAnimationFrame(wakeAnimationFrame);
  wakeStream?.getTracks().forEach((track) => track.stop());
  wakeStream = undefined;
  wakeAudioContext?.close();
  wakeAudioContext = undefined;
  clapTimes = [];
}

function activateJarvis() {
  if (ghostProtocol) return;
  stopWakeListener();
  wakeScreen.classList.add("awake");
  setInterfaceMode("voice");
  assistantStatus.textContent = choose(["Sprachmodus bereit.", "Ich höre zu. Was steht an?", "Systeme online. Womit beginnen wir?"]);
}

function setInterfaceMode(mode) {
  interfaceMode = mode;
  const isVoiceMode = mode === "voice";
  orbMode.hidden = !isVoiceMode;
  document.querySelector(".app-shell").hidden = isVoiceMode;
  if (isVoiceMode) {
    orbStatus.textContent = "Sprachmodus bereit";
  } else {
    orbMode.classList.remove("listening", "speaking");
    promptInput.focus();
  }
}

function setGhostProtocol(enabled) {
  if (enabled) setOmegaProtocol(false);
  ghostProtocol = enabled;
  sessionStorage.setItem("jarvis-ghost-protocol", String(enabled));
  document.body.classList.toggle("ghost-protocol", enabled);
  if (!enabled) setOmegaProtocol(false);
  speechSynthesis.cancel();
  stopWakeListener();
  setInterfaceMode("text");
  wakeScreen.classList.toggle("awake", enabled);
  promptInput.focus();
}

function setOmegaProtocol(enabled) {
  omegaProtocol = enabled;
  document.body.classList.toggle("omega-protocol", enabled);
  if (enabled) {
    stopWakeListener();
    setInterfaceMode("text");
    wakeScreen.classList.add("awake");
    loadWebsiteStatus();
  }
}

function isGhostProtocolCommand(command) {
  const normalized = command.toLocaleLowerCase("de-DE");
  return normalized.startsWith("suche")
    || (/^(öffne|starte)\b/.test(normalized) && (Boolean(getWebsiteTarget(command)) || /(dateien|explorer|ordner)/.test(normalized)));
}

function listenForClaps(analyser, samples) {
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
  if (ghostProtocol || wakeStream) return;
  if (!navigator.mediaDevices?.getUserMedia) {
    wakeStatus.textContent = "Mikrofon wird von diesem Browser nicht unterstützt";
    wakeRetry.hidden = false;
    return;
  }

  wakeRetry.hidden = true;
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
      stopWakeListener();
      wakeStatus.textContent = "Einmal klicken, um das Mikrofon zu aktivieren";
      wakeRetry.hidden = false;
      wakeRetry.disabled = false;
      return;
    }
    wakeStatus.textContent = "Warte auf zwei Klatscher";
    wakeScreen.classList.add("listening");
    listenForClaps(analyser, new Uint8Array(analyser.fftSize));
  } catch {
    stopWakeListener();
    wakeStatus.textContent = "Mikrofonberechtigung erforderlich";
    wakeRetry.hidden = false;
    wakeRetry.disabled = false;
  }
}

function updateVoice() {
  const voices = speechSynthesis.getVoices();
  const preferredNames = ["Microsoft Katja", "Microsoft Conrad", "Google Deutsch", "German"];
  germanVoice = voices.find((voice) => voice.voiceURI === preferences.voiceURI)
    || voices.find((voice) => preferredNames.some((name) => voice.name.includes(name)))
    || voices.find((voice) => voice.lang.toLowerCase().startsWith("de"));
  voiceSelect.replaceChildren();
  voices.filter((voice) => voice.lang.toLowerCase().startsWith("de")).forEach((voice) => {
    const option = document.createElement("option");
    option.value = voice.voiceURI;
    option.textContent = `${voice.name} (${voice.lang})`;
    option.selected = voice.voiceURI === germanVoice?.voiceURI;
    voiceSelect.append(option);
  });
  voiceState.textContent = germanVoice ? "Deutsch bereit" : "deutsches Sprachpaket fehlt";
}

function syncPreferenceControls() {
  speechRate.value = String(preferences.rate || 0.9);
  speechRateValue.value = speechRate.value;
  toneSelect.value = preferences.tone || "warm";
  if (preferences.voiceURI && voiceSelect.querySelector(`option[value="${CSS.escape(preferences.voiceURI)}"]`)) {
    voiceSelect.value = preferences.voiceURI;
  }
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
  if (ghostProtocol || !("speechSynthesis" in window) || !germanVoice) return;
  const voiceProfiles = {
    warm: { pitch: 1, rateMultiplier: 1 },
    humorous: { pitch: 1.08, rateMultiplier: 1.04 },
    calm: { pitch: 0.88, rateMultiplier: 0.9 },
  };
  const profile = voiceProfiles[preferences.tone || "warm"];
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = germanVoice.lang;
  utterance.voice = germanVoice;
  utterance.rate = Math.min(1.3, Number(preferences.rate || 0.9) * profile.rateMultiplier);
  utterance.pitch = profile.pitch;
  utterance.addEventListener("start", () => {
    if (interfaceMode === "voice") {
      orbMode.classList.add("speaking");
      orbStatus.textContent = "Jarvis spricht";
    }
  });
  utterance.addEventListener("end", () => {
    orbMode.classList.remove("speaking");
    if (interfaceMode === "voice") orbStatus.textContent = "Sprachmodus bereit";
  });
  speechSynthesis.speak(utterance);
}

async function askGroq(input) {
  const toneInstructions = {
    warm: "Sei warm, aufmerksam und natürlich. Nutze gelegentlich leichten trockenen Humor.",
    humorous: "Sei freundlich und spürbar trocken-humorig, aber bleibe bei Fakten und werde nie beleidigend.",
    calm: "Sei ruhig, sachlich, präzise und ohne Witze.",
  };
  const response = await fetch(`${desktopUrl}/ai/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: [
        {
          role: "system",
          content: `Du bist JARVIS, ein aufmerksamer persönlicher Assistent mit eigener Stimme. Antworte auf natürlichem Deutsch, klar und eher kurz. ${toneInstructions[preferences.tone || "warm"]} Bei ernsten Themen, Fehlern oder Sicherheitsfragen bleibst du stets sachlich. Variiere Begrüßungen und Satzanfänge. Bleibe bei Fakten ehrlich: Erfinde keine ausgeführten Aktionen, Quellen oder technischen Details.`,
        },
        { role: "user", content: input },
      ],
    }),
  });

  if (!response.ok) throw new Error("Groq antwortet nicht.");
  const result = await response.json();
  return result.content?.trim() || "Dazu habe ich keine Antwort erhalten.";
}

async function askQwenCoder(input) {
  const response = await fetch(`${desktopUrl}/code/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: input }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Qwen Coder antwortet nicht.");
  return result.content?.trim() || "Qwen Coder hat keine Antwort geliefert.";
}

async function askWritingAssistant(input, type) {
  const typeInstructions = {
    essay: "einen klar gegliederten Aufsatz mit Einleitung, Hauptteil und Schluss",
    report: "einen sachlichen Bericht mit passenden Überschriften und nachvollziehbarer Reihenfolge",
    application: "eine individuelle, professionelle und höfliche Bewerbung",
  };
  const response = await fetch(`${desktopUrl}/ai/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: [
        {
          role: "system",
          content: `Du bist ein sorgfältiger deutscher Schreibassistent. Erstelle oder überarbeite ${typeInstructions[type]}. Schreibe verständlich, grammatikalisch korrekt und passend zur angeforderten Länge. Wenn wichtige Angaben fehlen, verwende [Platzhalter] statt Fakten zu erfinden. Gib bei einer Überarbeitung zuerst die überarbeitete Fassung aus.`,
        },
        { role: "user", content: input },
      ],
    }),
  });
  if (!response.ok) throw new Error("Der Schreibassistent antwortet nicht.");
  const result = await response.json();
  return result.content?.trim() || "Der Schreibassistent hat keinen Text geliefert.";
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

async function loadWebsiteStatus() {
  if (!omegaProtocol) return;
  jarvisWebsiteStatus.textContent = "Status wird geprüft ...";
  scienceWebsiteStatus.textContent = "Status wird geprüft ...";
  jarvisWebsiteLight.classList.remove("offline");
  scienceWebsiteLight.classList.remove("offline");
  try {
    const response = await fetch(`${desktopUrl}/websites/status`);
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    const websites = {
      Jarvis: { status: jarvisWebsiteStatus, light: jarvisWebsiteLight, repo: jarvisWebsiteRepo, link: jarvisRepositoryLink, button: openJarvisWebsiteButton },
      Naturwissenschaften: { status: scienceWebsiteStatus, light: scienceWebsiteLight, repo: scienceWebsiteRepo, link: scienceRepositoryLink, button: openScienceWebsiteButton },
    };
    result.websites.forEach((website) => {
      const card = websites[website.name];
      if (!card) return;
      const timestamp = new Date(website.updatedAt).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" });
      card.repo.textContent = website.repository;
      card.link.href = website.repositoryUrl;
      card.button.dataset.url = website.websiteUrl;
      card.status.textContent = `Deployment ${website.deployment} · zuletzt geprüft: ${timestamp}`;
      card.light.classList.toggle("offline", website.deployment === "fehlgeschlagen");
    });
  } catch {
    jarvisWebsiteLight.classList.add("offline");
    scienceWebsiteLight.classList.add("offline");
    jarvisWebsiteStatus.textContent = "Status nicht erreichbar. Prüfen Sie den lokalen Desktop-Dienst.";
    scienceWebsiteStatus.textContent = "Status nicht erreichbar. Prüfen Sie den lokalen Desktop-Dienst.";
  }
}

async function getLiveNews(topic) {
  const response = await fetch(`${desktopUrl}/news?topic=${encodeURIComponent(topic)}`);
  if (!response.ok) throw new Error("News-Dienst antwortet nicht.");
  return response.json();
}

async function getPlaceContext(query) {
  const response = await fetch(`${desktopUrl}/places?query=${encodeURIComponent(query)}`);
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Ortsdienst antwortet nicht.");
  return result;
}

async function getWeather(city) {
  const response = await fetch(`${desktopUrl}/weather?city=${encodeURIComponent(city)}`);
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Wetterdienst antwortet nicht.");
  return result;
}

async function analyzeCameraImage(image) {
  const response = await fetch(`${desktopUrl}/vision/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Bildanalyse antwortet nicht.");
  return result;
}

function getNewsTopic(command) {
  if (/\b(elon musk|musk)\b/.test(command)) return "elon-musk";
  if (/\b(news|neuigkeiten|nachrichten|passiert|weltgeschehen)\b/.test(command)) return "world";
  return null;
}

function getCodeRequest(command) {
  const match = command.match(/^(?:programmiermodus|code(?:modus)?|qwen)(?:\s*:\s*|\s+)(.+)$/i);
  return match?.[1].trim() || null;
}

function getWritingRequest(command) {
  const match = command.match(/^(?:schreib(?:e)?|verfasse|textmodus|aufsatz|bericht|bewerbung)(?:\s*:\s*|\s+)(.+)$/i);
  return match?.[1].trim() || null;
}

function getWritingType(command) {
  const normalized = command.toLocaleLowerCase("de-DE");
  if (/\bbewerbung|anschreiben|lebenslauf\b/.test(normalized)) return "application";
  if (/\bbericht|protokoll|report\b/.test(normalized)) return "report";
  return "essay";
}

function getPlaceQuestion(command) {
  const patterns = [
    /^ist\s+(.+?)\s+(?:schön|gut|interessant|lebenswert)\??$/i,
    /^wo\s+(?:ist|liegt)\s+(.+?)\??$/i,
    /^(?:erzähle?|sag)\s+(?:mir\s+)?(?:etwas\s+)?(?:über|zu)\s+(.+?)\??$/i,
    /^was\s+(?:weißt|weisst)\s+du\s+(?:über|von)\s+(.+?)\??$/i,
  ];
  const match = patterns.map((pattern) => command.match(pattern)).find(Boolean);
  return match?.[1].trim().replace(/[?.!]+$/, "") || null;
}

function getWeatherCity(command) {
  const match = command.match(/^(?:wie (?:ist|wird) das wetter|wetter)(?:.*?)?(?:in|für)\s+(.+?)[?.!]*$/i);
  return match?.[1].trim() || null;
}

function isObjectQuestion(command) {
  return /\b(was ist das|was siehst du|was ist in der kamera|erkenn(?:e|st) du)\b/.test(command);
}

function getImageSearchQuery(command) {
  const match = command.match(/^(?:suche|zeig(?:e)?|finde)\s+(?:mir\s+)?(?:ein|eine|das|den)?\s*(?:gutes?\s+)?bild(?:er)?\s+(?:von|zu)?\s*(.+)$/i);
  return match?.[1].trim().replace(/[?.!]+$/, "") || null;
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

  const target = command
    .replace(/^(öffne|starte)\s+(die|den|das)?\s*/i, "")
    .replace(/^(webseite|website|seite)(\s+von)?\s*/i, "")
    .trim();
  const localTarget = /^(rechner|taschenrechner|calculator|editor|notepad|texteditor|dateien|explorer|ordner|einstellungen|settings|vs ?code|visual studio code|teams|microsoft teams|whats ?app)$/i;
  if (!target || localTarget.test(target)) return null;
  const domainPattern = /^(https?:\/\/)?(www\.)?[a-z0-9-]+\.[a-z]{2,}(\/[^\s]*)?$/i;
  if (domainPattern.test(target)) return target.startsWith("http") ? target : `https://${target}`;
  return `https://www.google.com/search?btnI=1&q=${encodeURIComponent(target)}`;
}

function getDesktopApp(command) {
  const apps = [
    { action: "vscode", name: "Visual Studio Code", pattern: /\b(vs ?code|visual studio code)\b/ },
    { action: "teams", name: "Microsoft Teams", pattern: /\b(microsoft )?teams\b/ },
    { action: "whatsapp", name: "WhatsApp", pattern: /\bwhats ?app\b/ },
  ];
  return apps.find((app) => app.pattern.test(command));
}

async function respond(input) {
  const command = input.trim();
  const normalized = command.toLocaleLowerCase("de-DE");
  let response;

  if (/^(?:aktiviere|aktivire) ghost protocol\.?$/i.test(command)) {
    setGhostProtocol(true);
    response = "Ghost Protocol aktiv. Textmodus aktiv; Zugriff ist auf Dateien und Webseiten begrenzt.";
  } else if (/^(?:deaktiviere|beende) ghost protocol\.?$/i.test(command)) {
    setGhostProtocol(false);
    response = "Ghost Protocol beendet. Textmodus bleibt aktiv; Sprachmodus kann wieder gewählt werden.";
  } else if (/^(?:aktiviere|aktivire) omega (?:modus|mode)\.?$/i.test(command)) {
    if (!ghostProtocol) {
      response = "Omega Modus kann nur innerhalb von Ghost Protocol aktiviert werden.";
    } else {
      omegaCodeError.textContent = "";
      omegaCodeInput.value = "";
      omegaCodeDialog.showModal();
      response = "Omega Freigabe wartet auf den Binärcode.";
    }
  } else if (/^(?:deaktiviere|beende) omega (?:modus|mode)\.?$/i.test(command)) {
    setOmegaProtocol(false);
    response = "Omega Modus beendet. Ghost Protocol bleibt aktiv.";
  } else if (ghostProtocol && !omegaProtocol && !isGhostProtocolCommand(command)) {
    response = "Ghost Protocol beschränkt Befehle auf Dateien und Webseiten.";
  } else if (/^(hallo|hi|guten)/.test(normalized)) {
    response = choose([
      "Guten Tag. Alle Systeme sind bereit - erstaunlich kooperativ für Technik.",
      "Hallo. Ich bin bereit. Was soll ich für Sie erledigen?",
      "Guten Tag. Die Systeme laufen, der Kaffee leider nicht automatisch.",
    ]);
  } else if (getCodeRequest(command)) {
    const codeRequest = getCodeRequest(command);
    assistantStatus.textContent = "Qwen Coder analysiert den Code ...";
    try {
      response = await askQwenCoder(codeRequest);
    } catch (error) {
      response = error.message || "Qwen Coder ist nicht bereit.";
    }
  } else if (getWritingRequest(command)) {
    const writingRequest = getWritingRequest(command);
    assistantStatus.textContent = "Schreibassistent erstellt den Entwurf ...";
    try {
      response = await askWritingAssistant(writingRequest, getWritingType(command));
    } catch (error) {
      response = error.message || "Der Schreibassistent ist nicht bereit.";
    }
  } else if (getWeatherCity(command)) {
    const city = getWeatherCity(command);
    assistantStatus.textContent = "Aktuelles Wetter wird abgerufen ...";
    try {
      const weather = await getWeather(city);
      response = `In ${weather.place} ist es aktuell ${weather.condition} bei ${Math.round(weather.temperature)} Grad. Gefühlt sind es ${Math.round(weather.apparentTemperature)} Grad, der Wind weht mit ${Math.round(weather.windSpeed)} km/h und es fallen ${weather.precipitation} Millimeter Niederschlag.`;
    } catch {
      response = `Ich konnte das Wetter für ${city} gerade nicht abrufen.`;
    }
  } else if (normalized.includes("modus wechseln") || normalized.includes("wechsel den modus")) {
    const nextMode = interfaceMode === "voice" ? "text" : "voice";
    setInterfaceMode(nextMode);
    response = nextMode === "text" ? "Textmodus aktiviert." : "Sprachmodus aktiviert.";
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
    response = withJarvisTone(`Es ist ${new Date().toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })} Uhr.`);
  } else if (normalized.includes("datum") || normalized.includes("welcher tag")) {
    response = withJarvisTone(`Heute ist ${new Date().toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}.`);
  } else if (normalized.startsWith("notiz")) {
    const note = command.replace(/^notiz\s*:?\s*/i, "").trim();
    if (!note) {
      response = choose(["Gern. Was soll ich notieren?", "Mein Gedächtnis steht bereit. Was soll hinein?", "Natürlich. Diktieren Sie einfach die Notiz."]);
    } else {
      saveNote(note);
      response = choose(["Vermerkt. Die Notiz ist gespeichert.", "Ist notiert. Selbst mein digitales Gedächtnis kann das nicht verlieren.", "Gespeichert. Ein Punkt weniger, an den Sie später denken müssen."]);
    }
  } else if (normalized.startsWith("suche") || normalized.startsWith("search")) {
    const query = command.replace(/^(suche( nach)?|search)\s*/i, "").trim();
    if (!query) {
      response = "Selbstverständlich. Wonach soll ich für Sie suchen?";
    } else {
      window.open(`https://www.google.com/search?q=${encodeURIComponent(query)}`, "_blank", "noopener");
      response = `Selbstverständlich. Ich suche nach ${query}.`;
    }
  } else if (isObjectQuestion(normalized)) {
    const image = window.jarvisObjectVision?.capture();
    if (!image) {
      response = "Der Objektscanner ist nicht bereit. Starten Sie zuerst die Kamera und zeigen Sie den Gegenstand deutlich in die Bildmitte.";
    } else {
      assistantStatus.textContent = "Kameraaufnahme wird analysiert ...";
      try {
        const analysis = await analyzeCameraImage(image);
        response = analysis.content;
      } catch (error) {
        response = error.message || "Die Bildanalyse ist gerade nicht erreichbar.";
      }
    }
  } else if (getImageSearchQuery(command)) {
    const query = getImageSearchQuery(command);
    const imageSearch = `https://www.bing.com/images/search?q=${encodeURIComponent(query)}`;
    try {
      await runDesktopAction("website", imageSearch);
      response = `Ich zeige Bildsuchergebnisse für ${query}.`;
    } catch {
      desktopState.textContent = "nicht verbunden";
      response = "Der Desktop-Modus ist nicht gestartet. Führen Sie zuerst desktop-server.ps1 auf diesem PC aus.";
    }
  } else if (getPlaceQuestion(command)) {
    const placeQuery = getPlaceQuestion(command);
    assistantStatus.textContent = "Ort wird auf der Karte gesucht ...";
    try {
      const place = await getPlaceContext(placeQuery);
      const context = `Beantworte die Frage "${command}" anhand dieser verifizierten Ortsdaten. Antworte auf Deutsch in zwei bis vier Sätzen. Erkläre bei Wertungen wie "schön" ausgewogen, dass es subjektiv ist. Erfinde keine Sehenswürdigkeiten oder Fakten.\n\nOrt: ${place.displayName}\nKoordinaten: ${place.latitude}, ${place.longitude}\nBeschreibung: ${place.summary || "Keine enzyklopädische Kurzbeschreibung verfügbar."}`;
      response = await askGroq(context);
    } catch {
      response = `Ich konnte ${placeQuery} gerade nicht zuverlässig auf der Karte finden.`;
    }
  } else if (getNewsTopic(normalized)) {
    const topic = getNewsTopic(normalized);
    assistantStatus.textContent = "Live-News werden abgerufen ...";
    try {
      const news = await getLiveNews(topic);
      const headlines = news.items.map((item) => `- ${item.title} (Quelle: ${item.source})`).join("\n");
      response = await askGroq(`Beantworte diese Frage anhand ausschließlich der aktuellen Schlagzeilen unten: "${command}". Erkläre in zwei bis drei kurzen deutschen Sätzen, was passiert ist und warum es relevant sein könnte. Erfinde keine Details. Nenne am Ende die Quellen kurz.

    ${news.label}:
    ${headlines}`);
    } catch {
      response = "Die Live-News sind gerade nicht erreichbar. Prüfen Sie bitte Ihre Internetverbindung und den lokalen Desktop-Dienst.";
    }
  } else if (/^(öffne|starte)\b/.test(normalized) && getWebsiteTarget(command)) {
    const website = getWebsiteTarget(command);
    try {
      await runDesktopAction("website", website);
      response = website.includes("google.com/search")
        ? "Ich suche nach der passenden Webseite und öffne den besten Treffer."
        : "Die Webseite wurde im Standardbrowser geöffnet.";
    } catch {
      desktopState.textContent = "nicht verbunden";
      response = "Der Desktop-Modus ist nicht gestartet. Führen Sie zuerst desktop-server.ps1 auf diesem PC aus.";
    }
  } else if (/^(öffne|starte)\b/.test(normalized) && getDesktopApp(normalized)) {
    const app = getDesktopApp(normalized);
    try {
      await runDesktopAction(app.action);
      response = `${app.name} wurde geöffnet.`;
    } catch {
      desktopState.textContent = "nicht verbunden";
      response = `Ich konnte ${app.name} nicht öffnen. Prüfen Sie, ob die App installiert ist und der Desktop-Modus läuft.`;
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
    assistantStatus.textContent = "Groq verarbeitet Ihre Anfrage ...";
    try {
      response = await askGroq(command);
    } catch {
      modelState.textContent = "nicht erreichbar";
      response = "Groq ist nicht bereit. Prüfen Sie den lokalen Desktop-Dienst und den Groq-API-Schlüssel.";
    }
  }

  assistantStatus.textContent = response;
  addMessage(response);
  speak(response);
  return response;
}

async function checkAiService() {
  try {
    const response = await fetch(`${desktopUrl}/ai/status`);
    const result = await response.json();
    modelState.textContent = result.ready ? "Groq bereit" : "API-Schlüssel fehlt";
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
    if (interfaceMode === "voice") {
      orbMode.classList.add("listening");
      orbStatus.textContent = "Jarvis hört zu";
    }
  });
  recognition.addEventListener("end", () => {
    micButton.classList.remove("listening");
    voiceState.textContent = "bereit";
    orbMode.classList.remove("listening");
    if (interfaceMode === "voice" && !orbMode.classList.contains("speaking")) orbStatus.textContent = "Sprachmodus bereit";
  });
  recognition.addEventListener("result", (event) => {
    const input = event.results[0][0].transcript;
    addMessage(input, "user");
    respond(input);
  });
  micButton.addEventListener("click", () => recognition.start());
  jarvisOrb.addEventListener("click", () => recognition.start());
} else {
  micButton.disabled = true;
  jarvisOrb.disabled = true;
  micButton.title = "Spracheingabe wird von diesem Browser nicht unterstützt";
}

if ("speechSynthesis" in window) {
  updateVoice();
  speechSynthesis.addEventListener("voiceschanged", updateVoice);
} else {
  voiceState.textContent = "Sprachausgabe nicht verfügbar";
}

preferencesButton.addEventListener("click", () => {
  syncPreferenceControls();
  preferencesDialog.showModal();
});

speechRate.addEventListener("input", () => {
  speechRateValue.value = speechRate.value;
});

testVoiceButton.addEventListener("click", () => {
  const selectedVoice = speechSynthesis.getVoices().find((voice) => voice.voiceURI === voiceSelect.value);
  if (!selectedVoice) return;
  germanVoice = selectedVoice;
  preferences.rate = Number(speechRate.value);
  speak("Systemtest abgeschlossen. Diese Stimme ist für Jarvis ausgewählt.");
});

preferencesForm.addEventListener("submit", (event) => {
  if (event.submitter?.value !== "save") return;
  preferences = {
    voiceURI: voiceSelect.value,
    rate: Number(speechRate.value),
    tone: toneSelect.value,
  };
  localStorage.setItem("jarvis-preferences", JSON.stringify(preferences));
  updateVoice();
  assistantStatus.textContent = "Sprach- und Tonpräferenzen wurden gespeichert.";
});

omegaCodeForm.addEventListener("submit", (event) => {
  if (event.submitter?.value === "cancel") return;
  event.preventDefault();
  const submittedCode = omegaCodeInput.value.replace(/\s/g, "");
  if (submittedCode !== omegaPasscode) {
    omegaCodeError.textContent = "Code ungültig. Zugang verweigert.";
    omegaCodeInput.select();
    return;
  }
  setOmegaProtocol(true);
  omegaCodeDialog.close();
  assistantStatus.textContent = "Omega Modus aktiv. Volle Jarvis-Funktionalität ist verfügbar.";
  addMessage("Omega Freigabe bestätigt. Volle Jarvis-Funktionalität ist verfügbar.");
});

omegaCodeInput.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  omegaCodeForm.requestSubmit(omegaCodeForm.querySelector('button[value="confirm"]'));
});

refreshWebsitesButton.addEventListener("click", loadWebsiteStatus);
openJarvisWebsiteButton.addEventListener("click", () => {
  if (!omegaProtocol) return;
  const websiteUrl = openJarvisWebsiteButton.dataset.url || "https://matte0-sec.github.io/Jarvis/";
  window.open(websiteUrl, "_blank", "noopener");
});
openScienceWebsiteButton.addEventListener("click", () => {
  if (!omegaProtocol) return;
  const websiteUrl = openScienceWebsiteButton.dataset.url || "https://matte0-sec.github.io/Naturwissenschaften/";
  window.open(websiteUrl, "_blank", "noopener");
});

updateClock();
setInterval(updateClock, 1000);
renderNotes();
checkAiService();
setInterval(checkAiService, 15000);
checkDesktopService();
setInterval(checkDesktopService, 15000);
wakeRetry.addEventListener("click", (event) => {
  event.stopPropagation();
  startWakeListener();
});
window.addEventListener("load", startWakeListener, { once: true });
window.addEventListener("beforeunload", stopWakeListener);

if (ghostProtocol) {
  setGhostProtocol(true);
}

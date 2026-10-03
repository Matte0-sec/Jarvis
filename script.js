const chatForm = document.querySelector("#chatForm");
const promptInput = document.querySelector("#prompt");
const chatLog = document.querySelector("#chatLog");
const assistantStatus = document.querySelector("#assistantStatus");
const notesList = document.querySelector("#notesList");
const voiceState = document.querySelector("#voiceState");
const micButton = document.querySelector("#micButton");
const modelState = document.querySelector("#modelState");
const ollamaUrl = "http://127.0.0.1:11434/api/chat";
const ollamaModel = "gemma3:1b";

let notes = JSON.parse(localStorage.getItem("jarvis-notes") || "[]");
let alternateTheme = false;
let germanVoice;
let hasGreeted = false;

function updateVoice() {
  const voices = speechSynthesis.getVoices();
  const preferredNames = ["Microsoft Katja", "Microsoft Conrad", "Google Deutsch", "German"];
  germanVoice = voices.find((voice) => preferredNames.some((name) => voice.name.includes(name)))
    || voices.find((voice) => voice.lang.toLowerCase().startsWith("de"));
  voiceState.textContent = germanVoice ? "Deutsch bereit" : "deutsches Sprachpaket fehlt";
  if (germanVoice && !hasGreeted) {
    hasGreeted = true;
    speak("Guten Tag. Alle Systeme sind betriebsbereit.");
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

async function respond(input) {
  const command = input.trim();
  const normalized = command.toLocaleLowerCase("de-DE");
  let response;

  if (/^(hallo|hi|guten)/.test(normalized)) {
    response = "Guten Tag. Es freut mich, Ihnen behilflich sein zu dürfen. Alle Systeme sind betriebsbereit.";
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
  } else if (normalized.includes("thema") || normalized.includes("ansicht")) {
    alternateTheme = !alternateTheme;
    document.documentElement.style.setProperty("--accent", alternateTheme ? "#f1bf75" : "#52e0c4");
    document.documentElement.style.setProperty("--accent-soft", alternateTheme ? "#ffe2ad" : "#a0f1de");
    response = "Die Darstellung wurde angepasst.";
  } else if (normalized.includes("hilfe") || normalized.includes("was kannst")) {
    response = "Ich kann Ihnen die Uhrzeit und das Datum nennen, Notizen sichern, eine Websuche öffnen und die Darstellung anpassen. Geben Sie einfach eine Anweisung ein oder verwenden Sie das Mikrofon.";
  } else {
    assistantStatus.textContent = "Ich denke nach ...";
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
  localStorage.removeItem("jarvis-notes");
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
const fields = [
  { label: "作業時間(分) 推奨25-90", value: 25 },
  { label: "短い休憩(分) 推奨5-20", value: 5 },
  { label: "長い休憩(分) 推奨20-60", value: 20 },
  { label: "追加休憩(分) 推奨60-90", value: 60 },
  { label: "セッション数 推奨4-12", value: 4 },
  { label: "長休憩の間隔(セッション) 推奨2-5", value: 4 },
  { label: "リマインダー間隔(分)", value: 23 },
];

const phaseLabels = {
  work: "作業中",
  shortBreak: "休憩",
  longBreak: "長い休憩",
  additionalBreak: "追加休憩",
  finished: "完了!お疲れさまでした",
};

const setupScreen = document.querySelector("#setup-screen");
const timerScreen = document.querySelector("#timer-screen");
const settingsFields = document.querySelector("#settings-fields");
const settingsForm = document.querySelector("#settings-form");
const formError = document.querySelector("#form-error");
const phaseLabel = document.querySelector("#phase-label");
const sessionLabel = document.querySelector("#session-label");
const countdown = document.querySelector("#countdown");
const progressTrack = document.querySelector("#progress-track");
const progressFill = document.querySelector("#progress-fill");
const progressLabel = document.querySelector("#progress-label");
const breakButton = document.querySelector("#break-button");
const resetButton = document.querySelector("#reset-button");
const reminderDialog = document.querySelector("#reminder-dialog");

let config;
let phase = "idle";
let session = 0;
let additionalCount = 0;
let longBreakCounter = 0;
let phaseStartedAt = 0;
let nextReminderAt = 0;
let phaseDurationSeconds = 0;
let ticker;
let audioContext;

fields.forEach(({ label, value }, index) => {
  const wrapper = document.createElement("div");
  wrapper.className = "setting-field";

  const input = document.createElement("input");
  input.id = `setting-${index}`;
  input.name = `setting-${index}`;
  input.type = "number";
  input.inputMode = "numeric";
  input.min = "1";
  input.max = "9999";
  input.step = "1";
  input.value = String(value);
  input.required = true;

  const labelElement = document.createElement("label");
  labelElement.htmlFor = input.id;
  labelElement.textContent = label;

  wrapper.append(labelElement, input);
  settingsFields.append(wrapper);
});

settingsForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const inputs = [...settingsFields.querySelectorAll("input")];
  const values = inputs.map((input) => Number(input.value));
  const isValid = values.every(
    (value) => Number.isSafeInteger(value) && value >= 1 && value <= 9999,
  );

  formError.hidden = isValid;
  inputs.forEach((input, index) => {
    input.setAttribute("aria-invalid", String(!Number.isSafeInteger(values[index]) || values[index] < 1 || values[index] > 9999));
  });
  if (!isValid) {
    inputs.find((input) => input.getAttribute("aria-invalid") === "true")?.focus();
    return;
  }

  config = {
    workSeconds: values[0] * 60,
    shortBreakSeconds: values[1] * 60,
    longBreakSeconds: values[2] * 60,
    additionalBreakSeconds: values[3] * 60,
    sessions: values[4],
    longInterval: values[5],
    reminderSeconds: values[6] * 60,
  };
  startTimer();
});

resetButton.addEventListener("click", resetTimer);

function startTimer() {
  setupScreen.hidden = true;
  timerScreen.hidden = false;
  session = 1;
  additionalCount = 0;
  longBreakCounter = 0;
  try {
    audioContext = new AudioContext();
    audioContext.resume();
  } catch {
    audioContext = undefined;
  }
  enterPhase("work");
  render();
  clearInterval(ticker);
  ticker = window.setInterval(tick, 250);
}

function resetTimer() {
  clearInterval(ticker);
  ticker = undefined;
  phase = "idle";
  config = undefined;
  if (reminderDialog.open) reminderDialog.close();
  fields.forEach(({ value }, index) => {
    const input = settingsFields.querySelector(`#setting-${index}`);
    input.value = String(value);
    input.setAttribute("aria-invalid", "false");
  });
  formError.hidden = true;
  timerScreen.hidden = true;
  setupScreen.hidden = false;
}

function enterPhase(nextPhase) {
  phase = nextPhase;
  phaseStartedAt = performance.now();
  phaseDurationSeconds = durationFor(nextPhase);
  nextReminderAt = config.reminderSeconds;
}

function durationFor(currentPhase) {
  switch (currentPhase) {
    case "work":
      return config.workSeconds;
    case "shortBreak":
      return config.shortBreakSeconds;
    case "longBreak":
      return config.longBreakSeconds;
    case "additionalBreak":
      return config.additionalBreakSeconds;
    default:
      return 0;
  }
}

function tick() {
  if (phase === "idle" || phase === "finished") return;
  const elapsed = Math.max(0, Math.floor((performance.now() - phaseStartedAt) / 1000));

  if (elapsed >= phaseDurationSeconds) {
    advancePhase();
    return;
  }

  if (phase === "work" && elapsed >= nextReminderAt) {
    nextReminderAt = (Math.floor(elapsed / config.reminderSeconds) + 1) * config.reminderSeconds;
    playNotification();
    showReminder();
  }
  render(elapsed);
}

function advancePhase() {
  if (phase === "work") {
    longBreakCounter += 1;
    if (longBreakCounter >= config.longInterval) {
      longBreakCounter = 0;
      enterPhase("longBreak");
    } else {
      enterPhase("shortBreak");
    }
    playNotification();
    showReminder();
  } else if (phase === "additionalBreak") {
    enterPhase("work");
    playNotification();
  } else if (session >= config.sessions) {
    phase = "finished";
    clearInterval(ticker);
    ticker = undefined;
    playNotification();
  } else {
    session += 1;
    enterPhase("work");
    playNotification();
  }
  render();
}

function skipBreak() {
  if (phase === "additionalBreak") {
    enterPhase("work");
  } else if (session >= config.sessions) {
    phase = "finished";
    clearInterval(ticker);
    ticker = undefined;
  } else {
    session += 1;
    enterPhase("work");
  }
  playNotification();
  render();
}

function render(elapsed = Math.max(0, Math.floor((performance.now() - phaseStartedAt) / 1000))) {
  const finished = phase === "finished";
  phaseLabel.textContent = phaseLabels[phase] ?? "";
  sessionLabel.textContent = `セッション ${session}/${config.sessions}(追加休憩 ${additionalCount}回)`;
  sessionLabel.hidden = finished;

  if (finished) {
    countdown.hidden = true;
    progressTrack.hidden = true;
    progressLabel.hidden = true;
    breakButton.hidden = true;
    resetButton.textContent = "最初に戻る";
    return;
  }

  countdown.hidden = false;
  progressTrack.hidden = false;
  progressLabel.hidden = false;
  const remaining = Math.max(0, phaseDurationSeconds - elapsed);
  const percent = Math.min(100, Math.floor((elapsed * 100) / phaseDurationSeconds));
  countdown.textContent = `${String(Math.floor(remaining / 60)).padStart(2, "0")}:${String(remaining % 60).padStart(2, "0")}`;
  progressFill.style.width = `${percent}%`;
  progressTrack.setAttribute("aria-valuenow", String(percent));
  progressLabel.textContent = `${percent}%`;
  breakButton.hidden = false;
  breakButton.textContent = phase === "work" ? "今すぐ休憩(追加休憩)" : "作業に戻る";
  breakButton.onclick = phase === "work" ? startAdditionalBreak : skipBreak;
  resetButton.textContent = "中止";
}

function startAdditionalBreak() {
  if (phase !== "work") return;
  additionalCount += 1;
  enterPhase("additionalBreak");
  playNotification();
  render();
  showReminder();
}

function showReminder() {
  if (!reminderDialog.open) reminderDialog.showModal();
}

function playNotification() {
  if (!audioContext || audioContext.state !== "running") return;
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  oscillator.type = "sine";
  oscillator.frequency.value = 880;
  gain.gain.setValueAtTime(0.0001, audioContext.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.12, audioContext.currentTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + 0.28);
  oscillator.connect(gain);
  gain.connect(audioContext.destination);
  oscillator.start();
  oscillator.stop(audioContext.currentTime + 0.3);
}

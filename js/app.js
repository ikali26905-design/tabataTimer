/* =========================================================
   TABATA TIMER — app.js
   Toute la logique de l'application, en JavaScript vanilla.

   Sommaire :
    1. Constantes & valeurs par défaut   ← réglages faciles à modifier
    2. État de l'application
    3. Stockage (localStorage)
    4. Construction de la séance (liste de phases)
    5. Audio (Web Audio API)
    6. Voix (speechSynthesis)
    7. Wake Lock (écran toujours allumé)
    8. Moteur du timer
    9. Affichage de la séance
   10. Écrans : accueil, séances, édition, historique
   11. Événements & démarrage
   12. PWA (service worker)
   ========================================================= */

'use strict';

/* =========================================================
   1. CONSTANTES & VALEURS PAR DÉFAUT
   ========================================================= */

const STORAGE_KEYS = {
  presets: 'tabata.presets',
  lastPresetId: 'tabata.lastPresetId',
  settings: 'tabata.settings',
  history: 'tabata.history',
};

const TICK_MS = 100;        // fréquence de rafraîchissement (le temps, lui, vient des horodatages)
const HISTORY_MAX = 100;    // nombre max de séances gardées dans l'historique
const VOICE_DELAY_MS = 600; // la voix parle juste après le son de changement de phase

const DEFAULT_SETTINGS = {
  volume: 0.8,   // 0 à 1
  muted: false,
  voice: true,   // annonces vocales
};

/* Séance fournie par défaut. Un préréglage contient les réglages des DEUX modes
   (tabata et emom) : on peut basculer de l'un à l'autre sans rien perdre. */
const DEFAULT_PRESET = {
  id: 'tabata-classique',
  name: 'Tabata classique',
  mode: 'tabata',         // 'tabata' ou 'emom'
  prep: 10,               // préparation (s)
  // --- Mode Tabata ---
  work: 20,               // effort commun (s)
  rest: 10,               // repos après chaque exercice (s)
  rounds: 2,              // nombre de rounds
  roundRest: 60,          // repos entre rounds (s) : remplace le dernier repos du round
  exercises: [            // work: null = utilise l'effort commun
    { name: 'Burpees', work: null },
    { name: 'Squats sautés', work: null },
    { name: 'Pompes', work: null },
    { name: 'Mountain climbers', work: null },
  ],
  // --- Mode EMOM ---
  emomMinutes: 10,        // nombre d'intervalles
  emomInterval: 60,       // durée d'un intervalle (s)
  emomExercises: [
    { name: 'Burpees', reps: 10 },
    { name: 'Squats', reps: 15 },
  ],
};

const PHASE_LABELS = {
  prep: 'PRÉPARATION',
  work: 'EFFORT',
  rest: 'REPOS',
  roundRest: 'REPOS LONG',
  done: 'TERMINÉ',
};

/* Configuration des steppers (– valeur +) de l'écran d'édition.
   min/max/step en secondes pour les durées. */
const STEPPERS = {
  tabata: [
    { key: 'prep',      label: 'Préparation',        min: 0, max: 60,  step: 5,  unit: 'time' },
    { key: 'work',      label: 'Effort',             min: 5, max: 600, step: 5,  unit: 'time' },
    { key: 'rest',      label: 'Repos',              min: 0, max: 300, step: 5,  unit: 'time' },
    { key: 'rounds',    label: 'Rounds',             min: 1, max: 30,  step: 1,  unit: 'count' },
    { key: 'roundRest', label: 'Repos entre rounds', min: 0, max: 600, step: 15, unit: 'time' },
  ],
  emom: [
    { key: 'prep',         label: 'Préparation',  min: 0,  max: 60,  step: 5,  unit: 'time' },
    { key: 'emomMinutes',  label: 'Intervalles',  min: 1,  max: 60,  step: 1,  unit: 'count' },
    { key: 'emomInterval', label: 'Durée d\'un intervalle', min: 15, max: 300, step: 15, unit: 'time' },
  ],
};


/* =========================================================
   2. ÉTAT DE L'APPLICATION
   Un seul objet contient tout ce qui peut changer.
   ========================================================= */

const state = {
  presets: [],                 // liste des séances enregistrées
  currentId: null,             // id de la séance affichée sur l'accueil
  settings: { ...DEFAULT_SETTINGS },
  history: [],

  draft: null,                 // copie de la séance en cours d'édition
  draftIsNew: false,
  editReturnTo: 'screen-home', // écran où revenir en quittant l'édition

  workout: null,               // séance en cours (voir startWorkout)
};


/* =========================================================
   3. STOCKAGE (localStorage)
   localStorage ne stocke que du texte : on passe par JSON.
   try/catch car il peut être plein ou désactivé (navigation privée).
   ========================================================= */

function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    console.warn('Sauvegarde impossible :', err);
  }
}

/* Complète un préréglage avec les champs par défaut manquants
   (utile si on ajoute un réglage dans une future version). */
function normalizePreset(preset) {
  return { ...structuredClone(DEFAULT_PRESET), ...preset };
}

function loadAll() {
  const presets = load(STORAGE_KEYS.presets, null);
  state.presets = Array.isArray(presets) && presets.length > 0
    ? presets.map(normalizePreset)
    : [structuredClone(DEFAULT_PRESET)];

  const lastId = load(STORAGE_KEYS.lastPresetId, null);
  state.currentId = state.presets.some(p => p.id === lastId) ? lastId : state.presets[0].id;

  state.settings = { ...DEFAULT_SETTINGS, ...load(STORAGE_KEYS.settings, {}) };
  state.history = load(STORAGE_KEYS.history, []);
}

const savePresets = () => save(STORAGE_KEYS.presets, state.presets);
const saveSettings = () => save(STORAGE_KEYS.settings, state.settings);
const saveHistory = () => save(STORAGE_KEYS.history, state.history);
const saveCurrentId = () => save(STORAGE_KEYS.lastPresetId, state.currentId);

function currentPreset() {
  return state.presets.find(p => p.id === state.currentId) || state.presets[0];
}

function newId() {
  return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function addHistoryEntry(workout, elapsedMs, completed) {
  state.history.unshift({
    date: new Date().toISOString(),
    name: workout.preset.name,
    mode: workout.preset.mode,
    durationSec: Math.round(elapsedMs / 1000),
    completed,
  });
  state.history = state.history.slice(0, HISTORY_MAX);
  saveHistory();
}


/* =========================================================
   4. CONSTRUCTION DE LA SÉANCE
   Idée clé : avant de démarrer, on transforme les réglages en une
   LISTE PLATE de phases. Exemple :
     [ {type:'prep', duration:10}, {type:'work', exercise:'Burpees', duration:20},
       {type:'rest', duration:10}, ... ]
   Le moteur du timer n'a plus qu'à parcourir cette liste.
   Tabata et EMOM utilisent donc exactement le même moteur.
   ========================================================= */

function exerciseName(ex, index) {
  return (ex.name || '').trim() || `Exercice ${index + 1}`;
}

function emomLabel(ex, index) {
  const name = exerciseName(ex, index);
  return ex.reps ? `${ex.reps} × ${name}` : name;
}

function buildPhases(preset) {
  const phases = [];

  if (preset.mode === 'emom') {
    const exos = preset.emomExercises.length ? preset.emomExercises : [{ name: 'Effort', reps: null }];
    const total = preset.emomMinutes;
    for (let m = 1; m <= total; m++) {
      const i = (m - 1) % exos.length;   // les exercices alternent chaque intervalle
      const label = emomLabel(exos[i], i);
      phases.push({
        type: 'work',
        duration: preset.emomInterval,
        exercise: label,
        counter: `Minute ${m} / ${total}`,
        speech: `Minute ${m}. ${label}`,
      });
    }
  } else {
    const exos = preset.exercises.length ? preset.exercises : [{ name: 'Effort', work: null }];
    const rounds = preset.rounds;
    for (let r = 1; r <= rounds; r++) {
      exos.forEach((ex, i) => {
        const name = exerciseName(ex, i);
        phases.push({
          type: 'work',
          duration: ex.work || preset.work,     // durée perso, sinon effort commun
          exercise: name,
          round: r,
          counter: `Round ${r} / ${rounds} · Exo ${i + 1} / ${exos.length}`,
          speech: `Effort ! ${name}`,
        });

        const lastInRound = i === exos.length - 1;
        if (lastInRound && r === rounds) return;          // fin de séance : pas de repos

        if (lastInRound && preset.roundRest > 0) {
          // Le repos long remplace le dernier repos du round
          phases.push({ type: 'roundRest', duration: preset.roundRest, round: r,
                        counter: `Fin du round ${r} / ${rounds}` });
        } else if (preset.rest > 0) {
          phases.push({ type: 'rest', duration: preset.rest, round: r,
                        counter: `Round ${r} / ${rounds}` });
        }
      });
    }
  }

  if (preset.prep > 0) {
    phases.unshift({ type: 'prep', duration: preset.prep, round: phases[0].round, counter: phases[0].counter });
  }

  // Pour chaque phase : texte "Prochain : …" et temps restant APRÈS elle
  // (sert à calculer le temps total restant sans tout additionner à chaque tick).
  let after = 0;
  for (let i = phases.length - 1; i >= 0; i--) {
    const phase = phases[i];
    phase.afterMs = after;
    after += phase.duration * 1000;

    const nextWork = phases.slice(i + 1).find(p => p.type === 'work');
    if (!nextWork) {
      phase.nextText = phase.type === 'work' ? 'Dernier effort !' : '';
    } else if (preset.mode === 'emom') {
      phase.nextText = `Ensuite : ${nextWork.exercise}`;
    } else {
      const roundInfo = nextWork.round !== phase.round ? ` · Round ${nextWork.round}` : '';
      phase.nextText = `Prochain : ${nextWork.exercise}${roundInfo}`;
    }
    phase.nextExercise = nextWork ? nextWork.exercise : '';
  }

  return phases;
}

function totalSeconds(preset) {
  return buildPhases(preset).reduce((sum, p) => sum + p.duration, 0);
}


/* =========================================================
   5. AUDIO (Web Audio API)
   Aucun fichier son : on génère des "bips" avec un oscillateur.
   Chaîne audio : oscillateur → enveloppe (gain) → volume général → haut-parleur
   ========================================================= */

let audioCtx = null;
let masterGain = null;

/* Le navigateur n'autorise le son qu'après un geste de l'utilisateur :
   on appelle donc initAudio() dans les gestionnaires de clic. */
function initAudio() {
  if (!audioCtx) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    audioCtx = new AudioCtx();
    masterGain = audioCtx.createGain();
    masterGain.connect(audioCtx.destination);
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
  applyVolume();
}

function applyVolume() {
  if (masterGain) masterGain.gain.value = state.settings.muted ? 0 : state.settings.volume;
}

/**
 * Joue une note.
 * @param {number} freq      fréquence en Hz (440 = la)
 * @param {number} start     décalage en secondes par rapport à maintenant
 * @param {number} duration  durée en secondes
 * @param {object} options   type d'onde ('sine', 'square', 'triangle'…) et volume
 */
function tone(freq, start, duration, { type = 'triangle', gain = 0.8 } = {}) {
  if (!audioCtx) return;
  const t0 = audioCtx.currentTime + start;
  const osc = audioCtx.createOscillator();
  const env = audioCtx.createGain();

  osc.type = type;
  osc.frequency.value = freq;

  // Enveloppe : montée rapide, tenue, puis descente douce (évite les "clics")
  env.gain.setValueAtTime(0.0001, t0);
  env.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
  env.gain.setValueAtTime(gain, t0 + duration * 0.7);
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);

  osc.connect(env).connect(masterGain);
  osc.start(t0);
  osc.stop(t0 + duration + 0.05);
}

/* La "bibliothèque" de sons. Modifie les fréquences pour changer les sons. */
const SOUNDS = {
  // Bip court et aigu pour 3, 2, 1 (onde carrée = perce bien le bruit de la salle)
  countdown: () => tone(1046, 0, 0.12, { type: 'square', gain: 0.35 }),
  // Deux tons MONTANTS : début d'effort
  work: () => { tone(440, 0, 0.2); tone(880, 0.22, 0.45); },
  // Deux tons DESCENDANTS : début de repos
  rest: () => { tone(880, 0, 0.2); tone(440, 0.22, 0.45); },
  // Trois notes rapides : mi-parcours
  halfway: () => { tone(659, 0, 0.1); tone(659, 0.15, 0.1); tone(988, 0.3, 0.3); },
  // Petite mélodie de victoire (do-mi-sol-do)
  victory: () => {
    [[523, 0, 0.15], [659, 0.16, 0.15], [784, 0.32, 0.15], [1047, 0.48, 0.7]]
      .forEach(([freq, start, dur]) => tone(freq, start, dur));
  },
};


/* =========================================================
   6. VOIX (speechSynthesis)
   Synthèse vocale intégrée au téléphone : rien à télécharger.
   ========================================================= */

let frenchVoice;   // undefined = pas encore cherchée
let voiceTimer = null;

function findFrenchVoice() {
  if (frenchVoice === undefined && 'speechSynthesis' in window) {
    const voices = speechSynthesis.getVoices();
    if (voices.length) frenchVoice = voices.find(v => v.lang.toLowerCase().startsWith('fr')) || null;
  }
  return frenchVoice || null;
}

if ('speechSynthesis' in window) {
  // La liste des voix se charge parfois après le démarrage
  speechSynthesis.addEventListener?.('voiceschanged', () => { frenchVoice = undefined; });
}

function speak(text) {
  if (!text || !state.settings.voice || state.settings.muted || !('speechSynthesis' in window)) return;
  speechSynthesis.cancel();                       // coupe l'annonce précédente
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'fr-FR';
  utterance.rate = 1.05;
  utterance.volume = state.settings.volume;
  const voice = findFrenchVoice();
  if (voice) utterance.voice = voice;
  speechSynthesis.speak(utterance);
}

/* Parle après un court délai (pour ne pas couvrir le son de changement de phase) */
function speakLater(text) {
  clearTimeout(voiceTimer);
  voiceTimer = setTimeout(() => speak(text), VOICE_DELAY_MS);
}

function stopSpeech() {
  clearTimeout(voiceTimer);
  if ('speechSynthesis' in window) speechSynthesis.cancel();
}


/* =========================================================
   7. WAKE LOCK : empêche l'écran de se mettre en veille
   Le verrou est relâché automatiquement si on quitte l'appli :
   on le redemande quand elle redevient visible.
   ========================================================= */

let wakeLock = null;

async function requestWakeLock() {
  if (!('wakeLock' in navigator) || wakeLock) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; });
  } catch (err) {
    console.warn('Wake Lock refusé :', err.message);
  }
}

async function releaseWakeLock() {
  if (!wakeLock) return;
  try { await wakeLock.release(); } catch { /* déjà relâché */ }
  wakeLock = null;
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.workout && !state.workout.finished) {
    requestWakeLock();
  }
});


/* =========================================================
   8. MOTEUR DU TIMER
   Principe anti-dérive : on ne compte PAS les ticks.
   On mémorise l'instant de fin de la phase (phaseEnd) et, à chaque tick,
   temps restant = phaseEnd - maintenant.
   setInterval sert seulement à "réveiller" l'affichage ; s'il prend du
   retard, le temps affiché reste juste.
   performance.now() est une horloge monotone : elle ne saute pas si
   l'heure du téléphone change.
   ========================================================= */

function startWorkout(preset) {
  initAudio();
  stopWorkoutTimer();

  const phases = buildPhases(preset);
  state.workout = {
    preset: structuredClone(preset),
    phases,
    totalMs: phases.reduce((sum, p) => sum + p.duration * 1000, 0),
    index: 0,
    phaseEnd: 0,             // horodatage (performance.now) de fin de la phase en cours
    paused: false,
    remainingAtPause: 0,     // temps restant figé pendant la pause
    finished: false,
    lastBeep: null,          // dernière seconde "bipée" (évite de biper 2 fois)
    halfwayDone: false,
    timerId: null,
  };

  showScreen('screen-workout');
  enterPhase(0, performance.now());
  state.workout.timerId = setInterval(tick, TICK_MS);
  requestWakeLock();
}

/* Démarre la phase n° index, qui commence à l'instant startTime */
function enterPhase(index, startTime) {
  const w = state.workout;
  w.index = index;
  w.lastBeep = null;
  const phase = w.phases[index];
  w.phaseEnd = startTime + phase.duration * 1000;
  if (w.paused) w.remainingAtPause = phase.duration * 1000;
  announcePhase(phase);
  updatePhaseColor();
  render();
}

function announcePhase(phase) {
  switch (phase.type) {
    case 'prep':
      // Pas de délai ici : sur iPhone, la 1re annonce doit partir pendant le clic
      speak(`Préparez-vous. Premier exercice : ${phase.nextExercise}`);
      break;
    case 'work':
      SOUNDS.work();
      speakLater(phase.speech);
      break;
    case 'rest':
      SOUNDS.rest();
      speakLater(phase.nextExercise ? `Repos. Prochain : ${phase.nextExercise}` : 'Repos');
      break;
    case 'roundRest':
      SOUNDS.rest();
      speakLater('Fin du round. Repos.');
      break;
  }
}

function tick() {
  const w = state.workout;
  if (!w || w.paused || w.finished) return;
  const now = performance.now();

  // Rattrapage : si le téléphone a "dormi", plusieurs phases ont pu s'écouler.
  // Chaque nouvelle phase commence EXACTEMENT à la fin de la précédente (pas de dérive).
  while (now >= w.phaseEnd) {
    if (w.index >= w.phases.length - 1) {
      finishWorkout(true);
      return;
    }
    enterPhase(w.index + 1, w.phaseEnd);
  }

  // Bips 3, 2, 1 : Math.ceil(2.4 s) = 3, donc le bip "3" sonne quand l'écran affiche 00:03
  const secondsLeft = Math.ceil((w.phaseEnd - now) / 1000);
  const phase = w.phases[w.index];
  if (secondsLeft <= 3 && secondsLeft >= 1 && secondsLeft !== w.lastBeep && phase.duration > 3) {
    w.lastBeep = secondsLeft;
    SOUNDS.countdown();
  }

  // Signal de mi-parcours (seulement pour les séances de plus d'une minute)
  if (!w.halfwayDone && w.totalMs >= 60000 && elapsedMs() >= w.totalMs / 2) {
    w.halfwayDone = true;
    SOUNDS.halfway();
    speakLater('Mi-parcours, courage !');
  }

  render();
}

/* Temps restant dans la phase en cours (ms) */
function phaseRemainingMs() {
  const w = state.workout;
  return w.paused ? w.remainingAtPause : Math.max(0, w.phaseEnd - performance.now());
}

/* Temps restant sur toute la séance (ms) */
function totalRemainingMs() {
  const w = state.workout;
  return phaseRemainingMs() + w.phases[w.index].afterMs;
}

/* Temps d'effort réellement écoulé (les pauses ne comptent pas) */
function elapsedMs() {
  return state.workout.totalMs - totalRemainingMs();
}

function togglePause() {
  const w = state.workout;
  if (!w || w.finished) return;
  if (w.paused) {
    initAudio();
    w.phaseEnd = performance.now() + w.remainingAtPause;  // on recale la fin de phase
    w.paused = false;
  } else {
    w.remainingAtPause = Math.max(0, w.phaseEnd - performance.now());
    w.paused = true;
    stopSpeech();
  }
  render();
}

function skipPhase() {
  const w = state.workout;
  if (!w || w.finished) return;
  initAudio();
  if (w.index >= w.phases.length - 1) {
    finishWorkout(true);
  } else {
    enterPhase(w.index + 1, performance.now());
  }
}

function finishWorkout(completed) {
  const w = state.workout;
  const elapsed = elapsedMs();
  stopWorkoutTimer();
  w.finished = true;
  w.paused = false;
  w.elapsedMs = elapsed;
  addHistoryEntry(w, elapsed, completed);
  SOUNDS.victory();
  stopSpeech();
  speakLater('Séance terminée. Bravo !');
  releaseWakeLock();
  updatePhaseColor();
  render();
}

/* Bouton Stop : on abandonne la séance (enregistrée comme interrompue si > 10 s) */
function stopWorkout() {
  const w = state.workout;
  if (!w) return;
  if (!w.finished && elapsedMs() >= 10000) addHistoryEntry(w, elapsedMs(), false);
  leaveWorkout();
}

function leaveWorkout() {
  stopWorkoutTimer();
  stopSpeech();
  releaseWakeLock();
  state.workout = null;
  setThemeColor(getComputedStyle(document.documentElement).getPropertyValue('--bg').trim());
  goTo('screen-home');
}

function stopWorkoutTimer() {
  if (state.workout && state.workout.timerId) {
    clearInterval(state.workout.timerId);
    state.workout.timerId = null;
  }
}


/* =========================================================
   9. AFFICHAGE DE LA SÉANCE
   ========================================================= */

const $ = (id) => document.getElementById(id);

/* Ne touche au DOM que si le texte change (évite du travail inutile 10×/s) */
function setText(el, text) {
  if (el.textContent !== text) el.textContent = text;
}

/* 75 → "01:15" */
function formatClock(totalSec) {
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/* 75 → "1 min 15", 45 → "45 s" */
function formatDuration(totalSec) {
  if (totalSec < 60) return `${totalSec} s`;
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return s ? `${m} min ${String(s).padStart(2, '0')}` : `${m} min`;
}

/* Colore aussi la barre d'état du téléphone avec la couleur de la phase */
function setThemeColor(color) {
  document.querySelector('meta[name="theme-color"]').setAttribute('content', color);
}

function updatePhaseColor() {
  const w = state.workout;
  const screen = $('screen-workout');
  screen.dataset.phase = w.finished ? 'done' : w.phases[w.index].type;
  const varName = {
    prep: '--phase-prep', work: '--phase-work', rest: '--phase-rest',
    roundRest: '--phase-round-rest', done: '--phase-done',
  }[screen.dataset.phase];
  setThemeColor(getComputedStyle(document.documentElement).getPropertyValue(varName).trim());
}

function render() {
  const w = state.workout;
  if (!w) return;
  const screen = $('screen-workout');
  screen.classList.toggle('is-paused', w.paused);
  $('wo-controls').hidden = w.finished;
  $('wo-done-actions').hidden = !w.finished;

  if (w.finished) {
    setText($('wo-phase'), PHASE_LABELS.done);
    setText($('wo-exercise'), w.preset.name);
    setText($('wo-time'), formatClock(Math.round(w.elapsedMs / 1000)));
    $('wo-ring').style.strokeDashoffset = 0;
    setText($('wo-round'), 'Bravo !');
    setText($('wo-next'), `Durée d'effort : ${formatDuration(Math.round(w.elapsedMs / 1000))}`);
    setText($('wo-total'), '00:00');
    return;
  }

  const phase = w.phases[w.index];
  const remaining = phaseRemainingMs();

  setText($('wo-phase'), w.paused ? 'PAUSE' : PHASE_LABELS[phase.type]);
  setText($('wo-exercise'), phase.type === 'work' ? phase.exercise : '');
  setText($('wo-time'), formatClock(Math.ceil(remaining / 1000)));
  // Anneau : plein au début de la phase, vide à la fin
  $('wo-ring').style.strokeDashoffset = 1 - remaining / (phase.duration * 1000);
  setText($('wo-round'), phase.counter);
  setText($('wo-next'), phase.type !== 'work' || w.preset.mode === 'emom' ? phase.nextText : '');
  setText($('wo-total'), formatClock(Math.ceil(totalRemainingMs() / 1000)));

  const pauseBtn = $('btn-pause');
  const pauseLabel = w.paused ? '▶<span>Reprendre</span>' : '⏸<span>Pause</span>';
  if (pauseBtn.innerHTML !== pauseLabel) pauseBtn.innerHTML = pauseLabel;
}


/* =========================================================
   10. ÉCRANS : ACCUEIL, SÉANCES, ÉDITION, HISTORIQUE
   ========================================================= */

/* Échappe le texte saisi par l'utilisateur avant de l'insérer en HTML */
function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => { s.hidden = s.id !== id; });
  window.scrollTo(0, 0);
}

/* Affiche un écran après l'avoir mis à jour */
function goTo(id) {
  const renderers = {
    'screen-home': renderHome,
    'screen-presets': renderPresets,
    'screen-history': renderHistory,
  };
  renderers[id]?.();
  showScreen(id);
}

/* Bouton à double appui : 1er appui = "Confirmer ?", 2e appui (dans les 3 s) = action.
   Plus sûr qu'une boîte de dialogue quand on a les mains moites. */
function confirmTap(button, action, label = 'Confirmer ?') {
  if (button.classList.contains('is-armed')) {
    clearTimeout(button._confirmTimer);
    button.classList.remove('is-armed');
    button.innerHTML = button._originalHtml;
    action();
    return;
  }
  button._originalHtml = button.innerHTML;
  button.innerHTML = label;
  button.classList.add('is-armed');
  button._confirmTimer = setTimeout(() => {
    button.classList.remove('is-armed');
    button.innerHTML = button._originalHtml;
  }, 3000);
}

function describePreset(p) {
  const total = formatDuration(totalSeconds(p));
  if (p.mode === 'emom') {
    return `EMOM · ${p.emomMinutes} × ${formatDuration(p.emomInterval)} · ${total}`;
  }
  const n = p.exercises.length || 1;
  return `${p.rounds} round${p.rounds > 1 ? 's' : ''} × ${n} exo${n > 1 ? 's' : ''}`
       + ` · ${p.work} s / ${p.rest} s · ${total}`;
}

function updateMuteButtons() {
  document.querySelectorAll('.js-mute').forEach(btn => {
    btn.textContent = state.settings.muted ? '🔇' : '🔊';
    btn.setAttribute('aria-label', state.settings.muted ? 'Réactiver le son' : 'Couper le son');
  });
}

/* ---------- Accueil ---------- */
function renderHome() {
  const p = currentPreset();
  $('home-preset-name').textContent = p.name;
  $('home-summary').textContent = describePreset(p);
  const items = p.mode === 'emom'
    ? p.emomExercises.map(emomLabel)
    : p.exercises.map(exerciseName);
  $('home-exercises').innerHTML = items.map(t => `<li>${escapeHtml(t)}</li>`).join('');
}

/* ---------- Liste des séances ---------- */
function renderPresets() {
  const canDelete = state.presets.length > 1;
  $('preset-list').innerHTML = state.presets.map(p => `
    <li class="card ${p.id === state.currentId ? 'is-current' : ''}">
      <button class="card-main" type="button" data-action="select" data-id="${p.id}">
        <span class="card-title">${escapeHtml(p.name)}</span>
        <span class="card-sub">${escapeHtml(describePreset(p))}</span>
      </button>
      <div class="card-actions">
        <button class="btn" type="button" data-action="edit" data-id="${p.id}">Modifier</button>
        <button class="btn" type="button" data-action="delete" data-id="${p.id}" ${canDelete ? '' : 'disabled'}>Supprimer</button>
      </div>
    </li>`).join('');
}

function onPresetListClick(event) {
  const btn = event.target.closest('[data-action]');
  if (!btn) return;
  const preset = state.presets.find(p => p.id === btn.dataset.id);
  if (!preset) return;

  if (btn.dataset.action === 'select') {
    state.currentId = preset.id;
    saveCurrentId();
    goTo('screen-home');
  } else if (btn.dataset.action === 'edit') {
    openEditor(preset, false, 'screen-presets');
  } else if (btn.dataset.action === 'delete') {
    confirmTap(btn, () => {
      state.presets = state.presets.filter(p => p.id !== preset.id);
      if (state.currentId === preset.id) state.currentId = state.presets[0].id;
      savePresets();
      saveCurrentId();
      renderPresets();
    });
  }
}

/* ---------- Édition ---------- */
function openEditor(preset, isNew, returnTo) {
  state.draft = structuredClone(preset);
  state.draftIsNew = isNew;
  state.editReturnTo = returnTo;
  $('edit-title').textContent = isNew ? 'Nouvelle séance' : 'Modifier la séance';
  renderEditor();
  showScreen('screen-edit');
}

function renderEditor() {
  const d = state.draft;
  $('edit-name').value = d.name;
  document.querySelectorAll('.segmented [data-mode]').forEach(b => {
    b.setAttribute('aria-pressed', String(b.dataset.mode === d.mode));
  });
  $('edit-tabata').hidden = d.mode !== 'tabata';
  $('edit-emom').hidden = d.mode !== 'emom';
  renderSteppers();
  renderExerciseLists();
  $('opt-volume').value = state.settings.volume;
  $('opt-voice').checked = state.settings.voice;
  renderEditTotal();
}

function formatStepperValue(cfg, value) {
  return cfg.unit === 'time' ? formatDuration(value) : String(value);
}

function renderSteppers() {
  document.querySelectorAll('.steppers').forEach(container => {
    container.innerHTML = STEPPERS[container.dataset.group].map(cfg => `
      <div class="stepper">
        <span class="stepper-label">${cfg.label}</span>
        <button type="button" data-step="-1" data-key="${cfg.key}" aria-label="Diminuer ${cfg.label}">–</button>
        <output>${formatStepperValue(cfg, state.draft[cfg.key])}</output>
        <button type="button" data-step="1" data-key="${cfg.key}" aria-label="Augmenter ${cfg.label}">+</button>
      </div>`).join('');
  });
}

function renderExerciseLists() {
  const d = state.draft;

  // Tabata : nom + durée perso (vide = effort commun)
  $('edit-exercises').innerHTML = d.exercises.map((ex, i) => `
    <li class="ex-row" data-index="${i}">
      <input class="ex-name" type="text" maxlength="30" data-field="name"
             value="${escapeHtml(ex.name)}" placeholder="Exercice ${i + 1}" aria-label="Nom de l'exercice ${i + 1}">
      <label class="ex-num">Durée
        <input type="number" inputmode="numeric" min="1" max="3600" data-field="work"
               value="${ex.work ?? ''}" placeholder="${d.work}" aria-label="Durée personnalisée en secondes">s
      </label>
      ${rowButtons(i, d.exercises.length)}
    </li>`).join('');

  // EMOM : nom + répétitions
  $('edit-emom-exercises').innerHTML = d.emomExercises.map((ex, i) => `
    <li class="ex-row" data-index="${i}">
      <input class="ex-name" type="text" maxlength="30" data-field="name"
             value="${escapeHtml(ex.name)}" placeholder="Exercice ${i + 1}" aria-label="Nom de l'exercice ${i + 1}">
      <label class="ex-num">Reps
        <input type="number" inputmode="numeric" min="1" max="999" data-field="reps"
               value="${ex.reps ?? ''}" placeholder="–" aria-label="Nombre de répétitions">
      </label>
      ${rowButtons(i, d.emomExercises.length)}
    </li>`).join('');
}

function rowButtons(i, length) {
  return `
    <button type="button" data-row="up" ${i === 0 ? 'disabled' : ''} aria-label="Monter">↑</button>
    <button type="button" data-row="down" ${i === length - 1 ? 'disabled' : ''} aria-label="Descendre">↓</button>
    <button type="button" data-row="delete" aria-label="Supprimer">✕</button>`;
}

function renderEditTotal() {
  $('edit-total').textContent = describePreset(state.draft);
}

function onEditorClick(event) {
  const d = state.draft;

  // Choix du mode
  const modeBtn = event.target.closest('[data-mode]');
  if (modeBtn) {
    d.mode = modeBtn.dataset.mode;
    renderEditor();
    return;
  }

  // Steppers – / +
  const stepBtn = event.target.closest('[data-step]');
  if (stepBtn) {
    const cfg = Object.values(STEPPERS).flat().find(c => c.key === stepBtn.dataset.key);
    const next = d[cfg.key] + Number(stepBtn.dataset.step) * cfg.step;
    d[cfg.key] = Math.min(cfg.max, Math.max(cfg.min, next));
    renderSteppers();
    renderExerciseLists();   // met à jour les placeholders "durée" (effort commun)
    renderEditTotal();
    return;
  }

  // Ajouter un exercice
  const addBtn = event.target.closest('[data-add]');
  if (addBtn) {
    const list = addBtn.dataset.add;
    d[list].push(list === 'exercises' ? { name: '', work: null } : { name: '', reps: null });
    renderExerciseLists();
    renderEditTotal();
    // Place le curseur dans le nouveau champ
    const inputs = document.querySelectorAll(`[data-list="${list}"] .ex-name`);
    inputs[inputs.length - 1]?.focus();
    return;
  }

  // Monter / descendre / supprimer un exercice
  const rowBtn = event.target.closest('[data-row]');
  if (rowBtn) {
    const list = rowBtn.closest('[data-list]').dataset.list;
    const i = Number(rowBtn.closest('[data-index]').dataset.index);
    const arr = d[list];
    if (rowBtn.dataset.row === 'up') [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]];
    if (rowBtn.dataset.row === 'down') [arr[i + 1], arr[i]] = [arr[i], arr[i + 1]];
    if (rowBtn.dataset.row === 'delete') arr.splice(i, 1);
    renderExerciseLists();
    renderEditTotal();
  }
}

/* Saisie dans les champs d'exercice : on met à jour le brouillon sans tout
   ré-afficher (sinon le champ perdrait le focus à chaque lettre). */
function onEditorInput(event) {
  const input = event.target;
  const listEl = input.closest('[data-list]');
  if (!listEl || !input.dataset.field) return;
  const item = state.draft[listEl.dataset.list][Number(input.closest('[data-index]').dataset.index)];
  if (input.dataset.field === 'name') {
    item.name = input.value;
  } else {
    const n = parseInt(input.value, 10);
    item[input.dataset.field] = Number.isFinite(n) && n > 0 ? Math.min(n, 3600) : null;
  }
  renderEditTotal();
}

/* Nettoie le brouillon avant de l'enregistrer */
function cleanDraft() {
  const d = state.draft;
  d.name = $('edit-name').value.trim() || 'Séance sans nom';
  d.exercises = d.exercises.map(ex => ({ ...ex, name: ex.name.trim() }));
  d.emomExercises = d.emomExercises.map(ex => ({ ...ex, name: ex.name.trim() }));
  return d;
}

function saveDraft(asNew) {
  const d = cleanDraft();
  if (asNew || state.draftIsNew) {
    d.id = newId();
    if (state.presets.some(p => p.name === d.name)) d.name += ' (copie)';
    state.presets.push(d);
  } else {
    const i = state.presets.findIndex(p => p.id === d.id);
    if (i >= 0) state.presets[i] = d; else state.presets.push(d);
  }
  state.currentId = d.id;
  savePresets();
  saveCurrentId();
  state.draft = null;
  goTo('screen-home');
}

/* ---------- Historique ---------- */
function renderHistory() {
  const list = $('history-list');
  $('btn-clear-history').disabled = state.history.length === 0;
  if (state.history.length === 0) {
    list.innerHTML = '<li class="empty">Aucune séance pour l\'instant. À toi de jouer !</li>';
    return;
  }
  const dateFormat = new Intl.DateTimeFormat('fr-FR', {
    weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
  list.innerHTML = state.history.map(h => `
    <li class="card history-item">
      <span class="history-status" title="${h.completed ? 'Terminée' : 'Interrompue'}">${h.completed ? '✅' : '⏹'}</span>
      <span class="history-text">
        <span class="card-title">${escapeHtml(h.name)}</span>
        <span class="card-sub">${dateFormat.format(new Date(h.date))}${h.completed ? '' : ' · interrompue'}</span>
      </span>
      <span class="history-duration">${formatClock(h.durationSec)}</span>
    </li>`).join('');
}


/* =========================================================
   11. ÉVÉNEMENTS & DÉMARRAGE
   ========================================================= */

function bindEvents() {
  // Navigation générique : tout bouton avec data-goto="id-de-l-ecran"
  document.addEventListener('click', (event) => {
    const link = event.target.closest('[data-goto]');
    if (link) goTo(link.dataset.goto);
  });

  // Son coupé / activé (boutons présents sur l'accueil et pendant la séance)
  document.querySelectorAll('.js-mute').forEach(btn => btn.addEventListener('click', () => {
    initAudio();
    state.settings.muted = !state.settings.muted;
    if (state.settings.muted) stopSpeech();
    applyVolume();
    saveSettings();
    updateMuteButtons();
  }));

  // Accueil
  $('btn-start').addEventListener('click', () => startWorkout(currentPreset()));
  $('btn-edit-current').addEventListener('click', () => openEditor(currentPreset(), false, 'screen-home'));

  // Liste des séances
  $('preset-list').addEventListener('click', onPresetListClick);
  $('btn-new-preset').addEventListener('click', () => {
    const fresh = { ...structuredClone(DEFAULT_PRESET), id: newId(), name: 'Nouvelle séance' };
    openEditor(fresh, true, 'screen-presets');
  });

  // Édition
  $('screen-edit').addEventListener('click', onEditorClick);
  $('screen-edit').addEventListener('input', onEditorInput);
  $('edit-name').addEventListener('input', (e) => { state.draft.name = e.target.value; });
  $('btn-edit-cancel').addEventListener('click', () => { state.draft = null; goTo(state.editReturnTo); });
  $('btn-save').addEventListener('click', () => saveDraft(false));
  $('btn-save-as').addEventListener('click', () => saveDraft(true));
  $('opt-volume').addEventListener('input', (e) => {
    state.settings.volume = Number(e.target.value);
    applyVolume();
    saveSettings();
  });
  $('opt-voice').addEventListener('change', (e) => {
    state.settings.voice = e.target.checked;
    saveSettings();
  });
  $('btn-test-sound').addEventListener('click', () => {
    initAudio();
    SOUNDS.work();
    speakLater('Effort ! Burpees');
  });

  // Historique
  $('btn-clear-history').addEventListener('click', (e) => confirmTap(e.currentTarget, () => {
    state.history = [];
    saveHistory();
    renderHistory();
  }));

  // Séance
  $('btn-pause').addEventListener('click', togglePause);
  $('btn-skip').addEventListener('click', skipPhase);
  $('btn-stop').addEventListener('click', (e) => confirmTap(e.currentTarget, stopWorkout, 'Sûr ?'));
  $('btn-restart').addEventListener('click', () => startWorkout(state.workout.preset));
  $('btn-home').addEventListener('click', leaveWorkout);

  // Raccourcis clavier sur ordinateur : Espace = pause, → = passer
  document.addEventListener('keydown', (event) => {
    if ($('screen-workout').hidden || !state.workout) return;
    if (event.code === 'Space') { event.preventDefault(); togglePause(); }
    if (event.code === 'ArrowRight') skipPhase();
  });
}

function init() {
  loadAll();
  bindEvents();
  updateMuteButtons();
  goTo('screen-home');
}

init();


/* =========================================================
   12. PWA : enregistrement du service worker (sw.js)
   Le service worker met les fichiers en cache : l'appli marche hors ligne.
   Nécessite HTTPS (ou http://localhost pour les tests).
   ========================================================= */

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js')
      .catch(err => console.warn('Service worker non enregistré :', err));
  });
}

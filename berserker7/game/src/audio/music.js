// Title music wiring: the only place that touches audio and listens for the unlock gesture.
// One streamed HTMLAudioElement (a media element with `src`, never fetch + decode), created on
// the first play(url) or preload(url).
// Browsers block playback until a user gesture, so play() is only called after one, and
// while the tab is visible.

// The one volume value for music (0 to 1).
export const MUSIC_VOLUME = 0.35;

// preload() resolves without buffering after this long, and the music then streams on play.
// Some mobile browsers ignore preload until a user gesture.
export const MUSIC_PRELOAD_TIMEOUT_MS = 15000;

const GESTURES = ['pointerdown', 'pointerup', 'keydown', 'touchend', 'click'];
const HAVE_ENOUGH_DATA = 4;

export function createMusic({
  window,
  createAudio = () => new window.Audio(),
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
  log = console,
}) {
  let element = null;
  let created = 0;
  let wanted = null;
  let sourceUrl = null;
  let gestured = false;
  let listening = true;

  function update() {
    if (!element) return;
    const shouldPlay = wanted !== null && gestured && window.document.visibilityState !== 'hidden';
    if (shouldPlay) {
      // A blocked or aborted play() must not log an error; a later gesture retries.
      const result = element.play();
      if (result && typeof result.then === 'function') {
        result.then(stopListening, () => {});
      }
    } else if (!element.paused) {
      element.pause();
    }
  }

  // Playback is allowed now, so the unlock listeners are no longer needed.
  function stopListening() {
    if (!listening) return;
    listening = false;
    for (const type of GESTURES) window.removeEventListener(type, onGesture, { capture: true });
  }

  // Runs inside the user activation, so play() is allowed here.
  function onGesture() {
    gestured = true;
    update();
  }

  for (const type of GESTURES) window.addEventListener(type, onGesture, { capture: true, passive: true });
  window.document.addEventListener('visibilitychange', update);

  function ensureElement() {
    if (element) return;
    element = createAudio();
    created += 1;
    element.loop = true;
    element.preload = 'auto';
    element.volume = MUSIC_VOLUME;
  }

  // The element's own `src` is resolved to an absolute URL, so compare with the url we set.
  function setSource(url) {
    if (url === sourceUrl) return;
    element.src = url;
    sourceUrl = url;
  }

  // Buffers `url` without playing it (still streamed: the element loads it, no fetch + decode).
  // Resolves once the element can play it through, or after MUSIC_PRELOAD_TIMEOUT_MS with a
  // warning; rejects on the element's error event.
  function preload(url) {
    ensureElement();
    setSource(url);
    const audio = element;
    return new Promise((resolve, reject) => {
      if (audio.readyState >= HAVE_ENOUGH_DATA) {
        resolve();
        return;
      }
      let timer = null;
      const finish = () => {
        clearTimer(timer);
        audio.removeEventListener('canplaythrough', onReady);
        audio.removeEventListener('error', onError);
      };
      const onReady = () => {
        finish();
        resolve();
      };
      const onError = () => {
        finish();
        reject(new Error(`music: could not load ${url}`));
      };
      audio.addEventListener('canplaythrough', onReady);
      audio.addEventListener('error', onError);
      timer = setTimer(() => {
        finish();
        log.warn(`music: ${url} was not buffered within ${MUSIC_PRELOAD_TIMEOUT_MS} ms; it will stream when played`);
        resolve();
      }, MUSIC_PRELOAD_TIMEOUT_MS);
    });
  }

  return {
    play(url) {
      ensureElement();
      wanted = url;
      setSource(url);
      update();
    },
    preload,
    stop() {
      wanted = null;
      if (!element) return;
      element.pause();
      element.currentTime = 0;
    },
    debug: {
      get element() {
        return element;
      },
      get created() {
        return created;
      },
      get wanted() {
        return wanted;
      },
    },
  };
}

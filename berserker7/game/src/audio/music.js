// Title music wiring: the only place that touches audio and listens for the unlock gesture.
// One streamed HTMLAudioElement (a media element with `src`, never fetch + decode).
// Browsers block playback until a user gesture, so play() is only called after one, and
// while the tab is visible.

// The one volume value for music (0 to 1).
export const MUSIC_VOLUME = 0.35;

const GESTURES = ['pointerdown', 'pointerup', 'keydown', 'touchend', 'click'];

export function createMusic({ window, createAudio = () => new window.Audio() }) {
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

  return {
    play(url) {
      if (!element) {
        element = createAudio();
        created += 1;
        element.loop = true;
        element.preload = 'auto';
        element.volume = MUSIC_VOLUME;
      }
      wanted = url;
      // The element's own `src` is resolved to an absolute URL, so compare with the url we set.
      if (url !== sourceUrl) {
        element.src = url;
        sourceUrl = url;
      }
      update();
    },
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

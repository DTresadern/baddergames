// The Join screen's DOM form: a room code field, Join and Back, and a message line. Shown and
// hidden by the `join` overlay scene (scenes/join.js); main.js wires onJoin and onBack to the net
// session. Text only (textContent), never innerHTML with anything typed or received.
//
// Hooks: #b7-join (the form), #b7-join-code (field), #b7-join-submit, #b7-join-back,
// #b7-join-message.
//
// Keys typed in the field do not reach the game: dom.js ignores keydown in text fields (so no
// action, no pause toggle and no activation), and a keyup there only releases. Enter joins and
// Escape goes back; both stop there.

import { ROOM_CODE_LENGTH } from '../net/room-code.js';

// One message per reason a join ends (net/session.js), and while connecting.
export const JOIN_MESSAGES = Object.freeze({
  connecting: 'Connecting…',
  invalid: `Room codes are ${ROOM_CODE_LENGTH} letters and digits.`,
  'not-found': 'No game found with that code.',
  full: 'That game is full.',
  version: 'That game runs a different version.',
  dropped: 'The connection dropped.',
  'host-left': 'The host left the game.',
  server: 'Could not reach the connection server.',
  timeout: 'The host did not answer in time.',
  unsupported: 'This browser cannot connect to games.',
  failed: 'Could not connect.',
});

export function joinMessage(reason) {
  return JOIN_MESSAGES[reason] ?? JOIN_MESSAGES.failed;
}

const STYLE = `
#b7-join { position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%); z-index: 3;
  width: min(340px, calc(100vw - 32px)); box-sizing: border-box; padding: 16px;
  font: 14px/1.4 monospace; color: #eee; background: rgba(10, 12, 18, 0.92); border: 1px solid #556;
  border-radius: 4px; }
#b7-join[hidden] { display: none; }
#b7-join h2 { margin: 0 0 10px; font-size: 16px; font-weight: bold; }
#b7-join label { display: block; margin-bottom: 4px; color: #aaa; }
#b7-join-code { width: 100%; box-sizing: border-box; padding: 6px 8px; font: 20px monospace; letter-spacing: 4px;
  text-transform: uppercase; color: #fff; background: #1b1f2a; border: 1px solid #667; border-radius: 3px; }
#b7-join .b7-join-buttons { display: flex; gap: 8px; margin-top: 10px; }
#b7-join button { flex: 1; padding: 6px; font: inherit; color: #eee; background: #333b50; border: 1px solid #556;
  border-radius: 3px; cursor: pointer; }
#b7-join-message { min-height: 1.4em; margin: 10px 0 0; color: #f2c14e; }
`;

export function createJoinForm({ document: doc, parent = doc.body, onJoin = () => {}, onBack = () => {} }) {
  const style = doc.createElement('style');
  style.textContent = STYLE;
  doc.head.append(style);

  const form = doc.createElement('form');
  form.id = 'b7-join';
  form.hidden = true;
  form.noValidate = true;
  const title = doc.createElement('h2');
  title.textContent = 'Join a game';
  const label = doc.createElement('label');
  label.htmlFor = 'b7-join-code';
  label.textContent = 'Room code';
  const field = doc.createElement('input');
  field.id = 'b7-join-code';
  field.type = 'text';
  field.autocomplete = 'off';
  field.spellcheck = false;
  field.maxLength = 8;
  field.setAttribute('autocapitalize', 'characters');
  const buttons = doc.createElement('div');
  buttons.className = 'b7-join-buttons';
  const submit = doc.createElement('button');
  submit.id = 'b7-join-submit';
  submit.type = 'submit';
  submit.textContent = 'Join';
  const back = doc.createElement('button');
  back.id = 'b7-join-back';
  back.type = 'button';
  back.textContent = 'Back';
  buttons.append(submit, back);
  const message = doc.createElement('p');
  message.id = 'b7-join-message';
  message.setAttribute('aria-live', 'polite');
  form.append(title, label, field, buttons, message);
  parent.append(form);

  let pending = null; // a code to fill in and join at the next show (invite link)

  // Enter in the field submits the form.
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    onJoin(field.value);
  });
  back.addEventListener('click', () => onBack());
  field.addEventListener('input', () => {
    const start = field.selectionStart;
    const end = field.selectionEnd;
    field.value = field.value.toUpperCase();
    field.setSelectionRange?.(start, end);
  });
  field.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onBack();
    }
  });

  return {
    element: form,
    visible: () => !form.hidden,
    // The next show fills in `code` and joins at once.
    prefill(code) {
      pending = code;
    },
    show() {
      form.hidden = false;
      message.textContent = '';
      if (pending !== null) {
        field.value = String(pending).toUpperCase().slice(0, field.maxLength);
        pending = null;
        onJoin(field.value);
      }
      field.focus();
    },
    hide() {
      if (form.contains(doc.activeElement)) doc.activeElement.blur();
      form.hidden = true;
    },
    setMessage(text) {
      message.textContent = text;
    },
  };
}

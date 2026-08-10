/*
 * Ygeia — lock screen.
 *
 * A numeric keypad rendered into a full-screen overlay. Used both to unlock on launch and
 * to set or change a passcode from Settings.
 */
(function (V) {
  'use strict';

  const MIN_LENGTH = 4;
  const MAX_LENGTH = 8;

  /**
   * Show the keypad.
   *
   * @param {object} o
   * @param {string} o.title
   * @param {string} [o.subtitle]
   * @param {boolean} [o.cancellable]
   * @param {function} o.onSubmit  async (code) => ({ ok, message }) — returning
   *                               { ok: false, message } keeps the keypad open and shows it
   * @returns {Promise<boolean>} resolves true on success, false if cancelled
   */
  function prompt(o) {
    return new Promise((resolve) => {
      const host = V.$('#lock-screen');
      let code = '';
      let busy = false;

      host.hidden = false;
      host.innerHTML = '';

      const dots = V.el('div', { className: 'lock-dots' });
      const message = V.el('div', { className: 'lock-message' });

      function renderDots() {
        dots.innerHTML = '';
        const shown = Math.max(code.length, MIN_LENGTH);
        for (let i = 0; i < shown; i++) {
          dots.appendChild(V.el('div', { className: 'lock-dot' + (i < code.length ? ' on' : '') }));
        }
      }

      async function submit() {
        if (busy || code.length < MIN_LENGTH) return;
        busy = true;
        message.textContent = '';
        message.classList.remove('error');

        try {
          const result = await o.onSubmit(code);
          if (result && result.ok) {
            host.hidden = true;
            host.innerHTML = '';
            resolve(true);
            return;
          }
          message.textContent = (result && result.message) || 'Incorrect passcode.';
          message.classList.add('error');
          code = '';
          renderDots();
          host.firstChild.classList.remove('shake');
          // Force reflow so the animation replays on consecutive failures.
          void host.firstChild.offsetWidth;
          host.firstChild.classList.add('shake');
          V.haptic(30);
        } catch (err) {
          message.textContent = err.message;
          message.classList.add('error');
          code = '';
          renderDots();
        } finally {
          busy = false;
        }
      }

      function press(digit) {
        if (busy || code.length >= MAX_LENGTH) return;
        code += digit;
        renderDots();
        V.haptic(6);
        // Auto-submit at 6 digits, the length most people choose, so the common case
        // needs no confirm tap.
        if (code.length === 6) submit();
      }

      const keypad = V.el('div', { className: 'lock-keypad' });
      for (const n of ['1', '2', '3', '4', '5', '6', '7', '8', '9']) {
        keypad.appendChild(V.el('button', { className: 'lock-key', type: 'button', text: n, on: { click: () => press(n) } }));
      }
      keypad.appendChild(
        o.cancellable
          ? V.el('button', { className: 'lock-key lock-key-alt', type: 'button', text: 'Cancel',
              on: { click: () => { host.hidden = true; host.innerHTML = ''; resolve(false); } } })
          : V.el('div'),
      );
      keypad.appendChild(V.el('button', { className: 'lock-key', type: 'button', text: '0', on: { click: () => press('0') } }));
      keypad.appendChild(
        V.el('button', {
          className: 'lock-key lock-key-alt', type: 'button', text: '⌫', 'aria-label': 'Delete',
          on: { click: () => { code = code.slice(0, -1); renderDots(); } },
        }),
      );

      const panel = V.el('div', { className: 'lock-panel' }, [
        V.el('div', { className: 'lock-mark', html:
          '<svg viewBox="0 0 512 512" width="64" height="64" aria-hidden="true">' +
          '<circle cx="256" cy="256" r="150" fill="none" stroke="currentColor" stroke-width="34" opacity="0.18"/>' +
          '<circle cx="256" cy="256" r="150" fill="none" stroke="currentColor" stroke-width="34" ' +
          'stroke-linecap="round" stroke-dasharray="707 942" transform="rotate(-90 256 256)"/>' +
          '<path d="M164 262 h44 l22 -44 l30 88 l26 -60 l18 26 h44" fill="none" stroke="currentColor" ' +
          'stroke-width="20" stroke-linecap="round" stroke-linejoin="round"/></svg>' }),
        V.el('h1', { className: 'lock-title', text: o.title }),
        o.subtitle ? V.el('div', { className: 'lock-subtitle', text: o.subtitle }) : null,
        dots,
        message,
        keypad,
        V.el('button', {
          className: 'btn btn-primary lock-confirm', type: 'button', text: 'Continue',
          on: { click: submit },
        }),
      ]);

      host.appendChild(panel);
      renderDots();

      // Physical keyboards are the common case on desktop; typing should just work.
      function onKey(e) {
        if (host.hidden) { document.removeEventListener('keydown', onKey); return; }
        if (/^[0-9]$/.test(e.key)) press(e.key);
        else if (e.key === 'Backspace') { code = code.slice(0, -1); renderDots(); }
        else if (e.key === 'Enter') submit();
        else if (e.key === 'Escape' && o.cancellable) {
          host.hidden = true; host.innerHTML = ''; resolve(false);
        }
      }
      document.addEventListener('keydown', onKey);
    });
  }

  /** Block until the correct passcode is entered. Cannot be cancelled. */
  async function requireUnlock() {
    return prompt({
      title: 'Ygeia',
      subtitle: 'Enter your passcode',
      cancellable: false,
      onSubmit: async (code) => {
        const result = await V.auth.verify(code);
        if (result.ok) {
          V.auth.markUnlocked();
          return { ok: true };
        }
        if (result.lockedFor) {
          return { ok: false, message: `Too many attempts. Try again in ${result.lockedFor}s.` };
        }
        const left = Math.max(0, 6 - (result.failures || 0));
        return {
          ok: false,
          message: left > 0 && left <= 3 ? `Incorrect. ${left} attempt(s) before a delay.` : 'Incorrect passcode.',
        };
      },
    });
  }

  /** Ask for a new passcode twice, then store it. Resolves true when set. */
  async function setNewPasscode(currentPasscode) {
    let first = null;

    const gotFirst = await prompt({
      title: 'New passcode',
      subtitle: '4 to 8 digits',
      cancellable: true,
      onSubmit: async (code) => { first = code; return { ok: true }; },
    });
    if (!gotFirst) return false;

    return prompt({
      title: 'Confirm passcode',
      subtitle: 'Enter it again',
      cancellable: true,
      onSubmit: async (code) => {
        if (code !== first) return { ok: false, message: 'They do not match. Start again.' };
        try {
          await V.auth.setPasscode(code, currentPasscode);
          V.auth.markUnlocked();
          return { ok: true };
        } catch (err) {
          return { ok: false, message: err.message };
        }
      },
    });
  }

  /** Ask for the existing passcode, for changing or removing it. Resolves the code or null. */
  async function confirmExisting(title) {
    let entered = null;
    const ok = await prompt({
      title: title || 'Confirm passcode',
      subtitle: 'Enter your current passcode',
      cancellable: true,
      onSubmit: async (code) => {
        const result = await V.auth.verify(code);
        if (result.ok) { entered = code; return { ok: true }; }
        if (result.lockedFor) return { ok: false, message: `Too many attempts. Try again in ${result.lockedFor}s.` };
        return { ok: false, message: 'Incorrect passcode.' };
      },
    });
    return ok ? entered : null;
  }

  V.lockScreen = { prompt, requireUnlock, setNewPasscode, confirmExisting, MIN_LENGTH, MAX_LENGTH };
})(window.V);

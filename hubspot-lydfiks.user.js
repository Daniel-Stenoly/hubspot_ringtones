// ==UserScript==
// @name         HubSpot lydfiks
// @namespace    dvalencia
// @version      1.1
// @description  Bytter Twilio-ringelyder og jevner ut samtalelyden (kompressor + limiter) i HubSpot calling
// @match        https://app.hubspot.com/*
// @match        https://app-eu1.hubspot.com/*
// @run-at       document-start
// @grant        none
// @updateURL    https://raw.githubusercontent.com/Daniel-Stenoly/hubspot_ringtones/main/hubspot-lydfiks.user.js
// @downloadURL  https://raw.githubusercontent.com/Daniel-Stenoly/hubspot_ringtones/main/hubspot-lydfiks.user.js
// ==/UserScript==

(() => {
  'use strict';

  // ---------- Innstillinger ----------
  const RINGTONE = 'https://cdn.jsdelivr.net/gh/Daniel-Stenoly/hubspot_ringtones@main/ringtone-soft.mp3';
  const REPLACE = /sdk\.twilio\.com\/js\/client\/sounds\/releases\/[^/]+\/(incoming|outgoing)\.mp3/;

  const COMPRESSOR = { threshold: -30, knee: 10, ratio: 4, attack: 0.005, release: 0.15 };
  const MAKEUP_GAIN = 2.0;   // 2.0 ≈ +6 dB (løfter kundene)
  const LIMITER = { threshold: -6, knee: 0, ratio: 20, attack: 0.001, release: 0.1 };
  const ENABLE_COMPRESSOR = true;
  // -----------------------------------

  const log = (...a) => console.log('[HubSpot lydfiks]', ...a);

  // 1) Bytt ringelydene (Twilio henter dem via XHR)
  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    if (typeof url === 'string' && REPLACE.test(url)) {
      log('Bytter', url);
      url = RINGTONE;
    }
    return origOpen.call(this, method, url, ...rest);
  };

  const origFetch = window.fetch;
  window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : input && input.url;
    if (url && REPLACE.test(url)) {
      log('Bytter', url);
      input = RINGTONE;
    }
    return origFetch.call(this, input, init);
  };

  // 2) Kompressor + limiter på samtalelyden (WebRTC-strømmen)
  if (!ENABLE_COMPRESSOR) return;

  let ctx;
  const processed = new WeakSet();

  const getCtx = () => (ctx = ctx || new AudioContext());

  // Lås opp lydmotoren ved første klikk/tastetrykk (nettleserne krever en brukerhandling)
  const unlock = () => {
    const c = getCtx();
    if (c.state !== 'running') c.resume().catch(() => {});
  };
  ['pointerdown', 'keydown'].forEach((ev) =>
    window.addEventListener(ev, unlock, { capture: true, passive: true })
  );

  const apply = (node, params) => {
    for (const [k, v] of Object.entries(params)) node[k].value = v;
    return node;
  };

  function route(el, stream) {
    if (!stream || processed.has(stream) || stream.getAudioTracks().length === 0) return;
    processed.add(stream);

    const c = getCtx();
    const src = c.createMediaStreamSource(stream);
    const comp = apply(c.createDynamicsCompressor(), COMPRESSOR);
    const gain = c.createGain();
    gain.gain.value = MAKEUP_GAIN;
    const lim = apply(c.createDynamicsCompressor(), LIMITER);
    src.connect(comp).connect(gain).connect(lim).connect(c.destination);

    // Demp originalen KUN når kompressoren faktisk spiller – ellers blir det stille
    const activate = () => {
      if (c.state === 'running') {
        el.muted = true;
        log('Kompressor aktiv på samtalelyd');
        return true;
      }
      return false;
    };

    if (!activate()) {
      log('Lydmotor i pause – spiller vanlig lyd til den starter');
      c.resume().catch(() => {});
      c.addEventListener('statechange', function handler() {
        if (activate()) c.removeEventListener('statechange', handler);
      });
    }
  }

  const desc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'srcObject');
  Object.defineProperty(HTMLMediaElement.prototype, 'srcObject', {
    configurable: true,
    enumerable: desc.enumerable,
    get() {
      return desc.get.call(this);
    },
    set(value) {
      desc.set.call(this, value);
      try {
        if (value instanceof MediaStream) route(this, value);
      } catch (e) {
        console.warn('[HubSpot lydfiks] Feil:', e);
      }
    },
  });

  log('Lastet');
})();

/**
 * SwiftStyle Widget v0.2.0
 * Embeddable size-recommendation widget for e-commerce.
 *
 * Pipeline:
 *   webcam -> TensorFlow.js MoveNet (pose) -> OpenCV.js GrabCut (silhouette)
 *   -> anthropometric estimation -> size chart match -> recommendation
 */
(function () {
  'use strict';

  const VERSION = '0.2.0';
  const CDN = {
    tf: 'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.20.0/dist/tf.min.js',
    pose: 'https://cdn.jsdelivr.net/npm/@tensorflow-models/pose-detection@2.1.3/dist/pose-detection.min.js',
    opencv: 'https://docs.opencv.org/4.10.0/opencv.js',
  };

  const DEFAULT_CONFIG = {
    mountSelector: null,
    productId: null,
    sizeChart: null,
    sizeChartUrl: null,
    apiBase: null,
    brand: 'SwiftStyle',
    cameraFacing: 'user',
    onAddToCart: null,
    captureMode: 'silhouette', // 'silhouette' | 'keypoints'
  };

  // Anthropometric ratios: circumference = width * ratio
  const ANTHRO = {
    male:   { chest: 2.65, waist: 2.20, hip: 2.75 },
    female: { chest: 2.70, waist: 2.22, hip: 2.85 },
  };

  const DEFAULT_SIZE_CHART = {
    unit: 'cm',
    sizes: [
      { label: 'XS',  chest: [80, 86],   waist: [62, 68],   hip: [84, 90] },
      { label: 'S',   chest: [86, 92],   waist: [68, 74],   hip: [90, 96] },
      { label: 'M',   chest: [92, 98],   waist: [74, 80],   hip: [96, 102] },
      { label: 'L',   chest: [98, 104],  waist: [80, 86],   hip: [102, 108] },
      { label: 'XL',  chest: [104, 112], waist: [86, 94],   hip: [108, 116] },
      { label: 'XXL', chest: [112, 122], waist: [94, 104],  hip: [116, 126] },
    ],
  };

  const state = {
    config: null,
    step: 'idle',
    heightCm: 175,
    gender: 'female',
    measurements: null,
    recommendedSize: null,
    selectedSize: null,
    tf: null,
    poseDetection: null,
    detector: null,
    detectorPromise: null,
    cv: null,
    cvPromise: null,
    stream: null,
    overlayEl: null,
    shadow: null,
    host: null,
    rafId: null,
    fullBodyDetected: false,
  };

  // ---------- UTILS ----------
  const round = (n, d = 1) => Math.round(n * 10 ** d) / 10 ** d;
  const $  = (sel, root) => (root || state.shadow || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || state.shadow || document).querySelectorAll(sel));

  function loadScript(src, globalName) {
    return new Promise((resolve, reject) => {
      if (window[globalName]) return resolve(window[globalName]);
      const existing = document.querySelector(`script[src="${src}"]`);
      if (existing) {
        existing.addEventListener('load', () => resolve(window[globalName]));
        existing.addEventListener('error', () => reject(new Error('load failed: ' + src)));
        return;
      }
      const s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.onload = () => resolve(window[globalName]);
      s.onerror = () => reject(new Error('load failed: ' + src));
      document.head.appendChild(s);
    });
  }

  // ---------- CONFIG ----------
  function readConfig() {
    const fromGlobal = window.SwiftStyleConfig || {};
    const fromScript = document.currentScript?.dataset || {};
    const cfg = { ...DEFAULT_CONFIG, ...fromGlobal };
    if (fromScript.mountSelector) cfg.mountSelector = fromScript.mountSelector;
    if (fromScript.productId) cfg.productId = fromScript.productId;
    return cfg;
  }

  // ---------- STYLES ----------
  const WIDGET_CSS = `
    :host { all: initial; display: block; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
    * { box-sizing: border-box; }

    .ss-trigger {
      display: inline-flex; align-items: center; justify-content: center; gap: 10px;
      width: 100%; padding: 13px 20px;
      background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
      color: #f8fafc;
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 12px;
      font-size: 14px; font-weight: 600; letter-spacing: -0.01em;
      cursor: pointer;
      box-shadow: 0 4px 14px rgba(15, 23, 42, 0.18);
      transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
    }
    .ss-trigger:hover {
      transform: translateY(-1px);
      box-shadow: 0 6px 20px rgba(15, 23, 42, 0.26);
      background: linear-gradient(135deg, #1e293b 0%, #334155 100%);
      color: #ffffff;
    }
    .ss-trigger svg { width: 18px; height: 18px; flex-shrink: 0; }
    .ss-trigger .ss-sparkle {
      display: inline-block;
      background: linear-gradient(135deg, #a855f7, #6366f1);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      font-weight: 700;
    }

    .ss-overlay {
      position: fixed; inset: 0; z-index: 2147483647;
      background: rgba(15, 23, 42, 0.78);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      display: flex; align-items: center; justify-content: center;
      padding: 16px;
      animation: ss-fade-in 0.25s ease-out;
    }
    @keyframes ss-fade-in {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    .ss-modal {
      background: #ffffff;
      border-radius: 20px;
      width: 100%; max-width: 460px; max-height: 94vh;
      display: flex; flex-direction: column;
      color: #0f172a;
      box-shadow: 0 25px 60px -15px rgba(0, 0, 0, 0.35), 0 0 1px 1px rgba(0,0,0,0.06);
      overflow: hidden;
      animation: ss-slide-up 0.25s cubic-bezier(0.16, 1, 0.3, 1);
    }
    @keyframes ss-slide-up {
      from { transform: translateY(16px) scale(0.98); opacity: 0; }
      to { transform: translateY(0) scale(1); opacity: 1; }
    }

    .ss-header {
      display: flex; justify-content: space-between; align-items: center;
      padding: 18px 22px;
      border-bottom: 1px solid #f1f5f9;
      background: #ffffff;
    }
    .ss-brand-row { display: flex; align-items: center; gap: 8px; }
    .ss-brand-badge {
      background: #eef2ff; color: #4f46e5;
      font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;
      padding: 4px 8px; border-radius: 6px;
    }
    .ss-modal-title { margin: 0; font-size: 16px; font-weight: 700; color: #0f172a; }
    .ss-close-btn {
      background: #f1f5f9; border: none; cursor: pointer;
      color: #64748b; font-size: 18px; line-height: 1;
      width: 32px; height: 32px; border-radius: 50%;
      display: grid; place-items: center;
      transition: all 0.15s ease;
    }
    .ss-close-btn:hover { background: #e2e8f0; color: #0f172a; }

    /* Steps breadcrumbs */
    .ss-steps-bar {
      display: flex; background: #f8fafc; border-bottom: 1px solid #e2e8f0;
      padding: 8px 20px; font-size: 11px; font-weight: 600; color: #94a3b8;
      justify-content: space-between;
    }
    .ss-step-item { display: flex; align-items: center; gap: 6px; }
    .ss-step-item.active { color: #4f46e5; }
    .ss-step-item.done { color: #10b981; }
    .ss-step-num {
      width: 18px; height: 18px; border-radius: 50%;
      background: #e2e8f0; color: #64748b;
      display: grid; place-items: center; font-size: 10px; font-weight: 700;
    }
    .ss-step-item.active .ss-step-num { background: #4f46e5; color: #ffffff; }
    .ss-step-item.done .ss-step-num { background: #10b981; color: #ffffff; }

    .ss-body { padding: 22px; overflow-y: auto; }
    .ss-subtitle { margin: 0 0 16px; color: #64748b; font-size: 13.5px; line-height: 1.5; }

    /* Form Inputs */
    .ss-label { display: block; font-size: 12px; font-weight: 600; color: #334155; margin-bottom: 6px; }
    .ss-input-wrap { position: relative; margin-bottom: 14px; }
    .ss-input {
      width: 100%; padding: 13px 14px;
      border: 1px solid #cbd5e1; border-radius: 10px;
      font: inherit; font-size: 15px; outline: none;
      background: #ffffff; color: #0f172a;
      transition: border-color 0.15s, box-shadow 0.15s;
    }
    .ss-input:focus { border-color: #4f46e5; box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.15); }
    .ss-unit {
      position: absolute; right: 14px; top: 50%; transform: translateY(-50%);
      font-size: 13px; font-weight: 600; color: #94a3b8; pointer-events: none;
    }

    .ss-gender-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 16px; }
    .ss-gender-btn {
      padding: 12px; border: 1.5px solid #e2e8f0; border-radius: 10px;
      background: #ffffff; color: #475569; font-weight: 600; font-size: 14px;
      cursor: pointer; transition: all 0.15s ease; text-align: center;
    }
    .ss-gender-btn:hover { border-color: #cbd5e1; background: #f8fafc; }
    .ss-gender-btn.selected { border-color: #4f46e5; background: #eef2ff; color: #4f46e5; font-weight: 700; }

    .ss-primary-btn {
      width: 100%; padding: 14px 20px;
      background: #0f172a; color: #ffffff;
      border: none; border-radius: 12px;
      font: 600 15px/1 inherit; cursor: pointer;
      display: flex; align-items: center; justify-content: center; gap: 8px;
      transition: all 0.15s ease;
      box-shadow: 0 4px 12px rgba(15, 23, 42, 0.15);
    }
    .ss-primary-btn:hover:not(:disabled) { background: #1e293b; transform: translateY(-1px); }
    .ss-primary-btn:disabled { opacity: 0.45; cursor: not-allowed; box-shadow: none; transform: none; }

    /* Video & Capture */
    .ss-video-wrap {
      position: relative; width: 100%; aspect-ratio: 3/4; max-height: 400px;
      background: #090d16; border-radius: 16px; overflow: hidden;
      margin-bottom: 14px; box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.08);
    }
    .ss-video-wrap video {
      width: 100%; height: 100%; object-fit: contain;
      transform: scaleX(-1);
    }
    .ss-video-wrap canvas {
      position: absolute; inset: 0; width: 100%; height: 100%;
      pointer-events: none;
      transform: scaleX(-1);
    }
    .ss-guide-box {
      position: absolute; inset: 12px;
      border: 1.5px dashed rgba(255, 255, 255, 0.25);
      border-radius: 12px; pointer-events: none;
    }
    .ss-video-status {
      position: absolute; left: 12px; bottom: 12px; right: 12px;
      background: rgba(15, 23, 42, 0.85); backdrop-filter: blur(6px);
      color: #e2e8f0; padding: 8px 14px; border-radius: 10px;
      font-size: 12px; font-weight: 600;
      display: flex; align-items: center; justify-content: space-between;
      border: 1px solid rgba(255, 255, 255, 0.1);
    }
    .ss-status-dot {
      width: 8px; height: 8px; border-radius: 50%;
      background: #eab308; display: inline-block; margin-right: 6px;
    }
    .ss-status-dot.ok { background: #22c55e; box-shadow: 0 0 8px #22c55e; }

    /* Loading Spinner */
    .ss-loading-box {
      text-align: center; padding: 40px 10px;
    }
    .ss-spinner {
      width: 44px; height: 44px; margin: 0 auto 18px;
      border: 3.5px solid #e2e8f0; border-top-color: #4f46e5;
      border-radius: 50%;
      animation: ss-spin 0.75s linear infinite;
    }
    @keyframes ss-spin { to { transform: rotate(360deg); } }

    /* Results */
    .ss-badge-recommended {
      display: inline-block; font-size: 11px; font-weight: 700;
      text-transform: uppercase; letter-spacing: 0.06em;
      background: #ecfdf5; color: #059669; border: 1px solid #a7f3d0;
      padding: 4px 10px; border-radius: 999px; margin-bottom: 6px;
    }
    .ss-size-hero {
      text-align: center; padding: 12px 0 18px; border-bottom: 1px solid #f1f5f9;
      margin-bottom: 16px;
    }
    .ss-size-val {
      font-size: 56px; font-weight: 800; color: #0f172a;
      line-height: 1; letter-spacing: -0.03em; margin: 4px 0 6px;
    }
    .ss-fit-sub { font-size: 13px; color: #64748b; font-weight: 500; }

    .ss-size-selector-row {
      display: flex; gap: 6px; margin-bottom: 18px; justify-content: center;
    }
    .ss-size-chip {
      flex: 1; padding: 8px 0; border: 1px solid #e2e8f0; border-radius: 8px;
      background: #f8fafc; font-size: 13px; font-weight: 600; cursor: pointer;
      color: #475569; transition: all 0.15s ease;
    }
    .ss-size-chip:hover { border-color: #cbd5e1; background: #ffffff; }
    .ss-size-chip.active {
      background: #0f172a; color: #ffffff; border-color: #0f172a;
    }
    .ss-size-chip.recommended-chip {
      position: relative;
    }
    .ss-size-chip.recommended-chip::after {
      content: ''; position: absolute; top: -3px; right: -3px;
      width: 7px; height: 7px; border-radius: 50%; background: #10b981;
    }

    /* Measurements Grid */
    .ss-measurements-grid {
      display: grid; grid-template-columns: 1fr 1fr; gap: 10px;
      margin-bottom: 18px;
    }
    .ss-m-card {
      background: #f8fafc; border: 1px solid #f1f5f9;
      padding: 12px; border-radius: 12px;
    }
    .ss-m-label { font-size: 11px; font-weight: 600; color: #64748b; text-transform: uppercase; letter-spacing: 0.03em; }
    .ss-m-val { font-size: 17px; font-weight: 700; color: #0f172a; margin-top: 2px; }
    .ss-m-detail { font-size: 11px; color: #94a3b8; margin-top: 2px; }

    .ss-actions-row { display: flex; flex-direction: column; gap: 8px; }
    .ss-secondary-btn {
      width: 100%; padding: 11px;
      background: transparent; color: #64748b;
      border: 1px solid transparent; border-radius: 10px;
      font-size: 13px; font-weight: 600; cursor: pointer;
      transition: all 0.15s;
    }
    .ss-secondary-btn:hover { background: #f1f5f9; color: #0f172a; }

    .ss-privacy-note {
      display: flex; align-items: center; justify-content: center; gap: 6px;
      font-size: 11px; color: #94a3b8; margin-top: 14px; text-align: center;
    }
    .ss-err {
      background: #fef2f2; border: 1px solid #fecaca; color: #991b1b;
      padding: 12px 14px; border-radius: 10px; font-size: 12.5px;
      margin-bottom: 14px; line-height: 1.4;
    }
  `;

  // ---------- MOUNT ----------
  function mount() {
    state.config = readConfig();
    if ($('#swiftstyle-widget-root', document)) return;

    const host = document.createElement('div');
    host.id = 'swiftstyle-widget-root';
    const target = state.config.mountSelector
      ? document.querySelector(state.config.mountSelector)
      : null;
    if (target && target.parentNode) {
      target.insertAdjacentElement('afterend', host);
    } else {
      document.body.appendChild(host);
    }

    const shadow = host.attachShadow({ mode: 'open' });
    state.host = host;
    state.shadow = shadow;

    shadow.innerHTML = `
      <style>${WIDGET_CSS}</style>
      <button class="ss-trigger" data-action="open" type="button">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M20.24 12.24a6 6 0 0 0-8.49-8.49L5 10.5V19h8.5z"/>
          <line x1="16" y1="8" x2="2" y2="22"/>
          <line x1="17.5" y1="15" x2="9" y2="15"/>
        </svg>
        <span>Trouver ma taille avec <span class="ss-sparkle">${state.config.brand || 'SwiftStyle'}</span></span>
      </button>
    `;

    shadow.addEventListener('click', handleClick);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && state.step !== 'idle') closeModal();
    });
  }

  // ---------- EVENT HANDLER ----------
  function handleClick(e) {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const action = el.dataset.action;
    if (action === 'open') return openModal();
    if (action === 'close') return closeModal();
    if (action === 'next-height') return handleHeightNext();
    if (action === 'capture') return handleCapture();
    if (action === 'add-to-cart') return handleAddToCart();
    if (action === 'retake') return handleRetake();
    if (action === 'select-gender') {
      state.gender = el.dataset.gender;
      $$('.ss-gender-btn', state.shadow).forEach(b => {
        b.classList.toggle('selected', b.dataset.gender === state.gender);
      });
    }
    if (action === 'select-size') {
      const size = el.dataset.size;
      state.selectedSize = size;
      renderResult(state.measurements, size);
    }
  }

  // ---------- MODAL OPEN / CLOSE ----------
  function openModal() {
    if (state.overlayEl) state.overlayEl.remove();

    const overlay = document.createElement('div');
    overlay.className = 'ss-overlay';
    overlay.innerHTML = `
      <div class="ss-modal" role="dialog" aria-modal="true">
        <header class="ss-header">
          <div class="ss-brand-row">
            <span class="ss-brand-badge">${state.config.brand || 'SwiftStyle'}</span>
            <h2 class="ss-modal-title">Recommandation de taille</h2>
          </div>
          <button class="ss-close-btn" data-action="close" aria-label="Fermer">✕</button>
        </header>

        <div class="ss-steps-bar">
          <div class="ss-step-item active" data-step-indicator="height">
            <span class="ss-step-num">1</span> Profil
          </div>
          <div class="ss-step-item" data-step-indicator="capture">
            <span class="ss-step-num">2</span> Scan silhouette
          </div>
          <div class="ss-step-item" data-step-indicator="result">
            <span class="ss-step-num">3</span> Recommandation
          </div>
        </div>

        <!-- STEP 1: HEIGHT & GENDER -->
        <div class="ss-body" data-step="height">
          <p class="ss-subtitle">Indiquez votre taille et morphologie pour calibrer le capteur avec précision.</p>
          
          <label class="ss-label">Votre taille en centimètres</label>
          <div class="ss-input-wrap">
            <input type="number" class="ss-input" data-field="height"
                   placeholder="ex: 175" value="${state.heightCm || 175}"
                   min="120" max="220" inputmode="numeric" />
            <span class="ss-unit">cm</span>
          </div>

          <label class="ss-label">Morphologie de référence</label>
          <div class="ss-gender-grid">
            <button type="button" class="ss-gender-btn ${state.gender === 'female' ? 'selected' : ''}"
                    data-action="select-gender" data-gender="female">Femme</button>
            <button type="button" class="ss-gender-btn ${state.gender === 'male' ? 'selected' : ''}"
                    data-action="select-gender" data-gender="male">Homme</button>
          </div>

          <div class="ss-err" data-field="err" hidden></div>
          <button class="ss-primary-btn" data-action="next-height" type="button">
            Activer la caméra et continuer ➔
          </button>

          <div class="ss-privacy-note">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
            </svg>
            Traitement 100% sur votre appareil. Aucune image n'est stockée ni transmise.
          </div>
        </div>

        <!-- STEP 2: CAMERA CAPTURE -->
        <div class="ss-body" data-step="capture" hidden>
          <p class="ss-subtitle" style="margin-bottom: 10px;">
            Placez-vous debout à 2 mètres, face à la caméra. Cadrez le corps entier (de la tête aux pieds).
          </p>

          <div class="ss-video-wrap">
            <video data-field="video" autoplay playsinline muted></video>
            <canvas data-field="overlay"></canvas>
            <div class="ss-guide-box"></div>
            <div class="ss-video-status">
              <span><span class="ss-status-dot" data-field="status-dot"></span><span data-field="status-txt">Initialisation...</span></span>
              <span data-field="status-hint" style="color: #94a3b8; font-size: 11px;">Reculez</span>
            </div>
          </div>

          <button class="ss-primary-btn" data-action="capture" data-field="capture-btn" disabled type="button">
            Prendre la mesure
          </button>
        </div>

        <!-- STEP 3: LOADING SCAN -->
        <div class="ss-body" data-step="loading" hidden>
          <div class="ss-loading-box">
            <div class="ss-spinner"></div>
            <h3 style="margin: 0 0 6px; font-size: 16px;">Analyse de votre silhouette en cours</h3>
            <p style="margin: 0; color: #64748b; font-size: 13px;">Extraction des contours et calcul des circonférences...</p>
          </div>
        </div>

        <!-- STEP 4: RESULT -->
        <div class="ss-body" data-step="result" hidden>
          <div class="ss-size-hero">
            <span class="ss-badge-recommended">Taille idéale calculée</span>
            <div class="ss-size-val" data-field="size">—</div>
            <div class="ss-fit-sub" data-field="fit-desc">Ajustement parfait selon votre morphologie</div>
          </div>

          <label class="ss-label" style="text-align: center; margin-bottom: 8px;">Choisir ou changer de taille :</label>
          <div class="ss-size-selector-row" data-field="sizes-list"></div>

          <label class="ss-label" style="margin-bottom: 8px;">Vos mensurations estimées :</label>
          <div class="ss-measurements-grid" data-field="measurements"></div>

          <div class="ss-actions-row">
            <button class="ss-primary-btn" data-action="add-to-cart" data-field="cart" type="button">
              Ajouter au panier
            </button>
            <button class="ss-secondary-btn" data-action="retake" type="button">
              ↺ Reprendre la mesure
            </button>
          </div>
        </div>
      </div>
    `;

    // ATTACH DIRECTLY TO SHADOW ROOT SO ALL CSS APPLIES!
    state.shadow.appendChild(overlay);
    state.overlayEl = overlay;
    state.step = 'height';
    updateBreadcrumbs('height');

    // Click on overlay outside modal to close
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeModal();
    });
  }

  function closeModal() {
    if (state.rafId) {
      cancelAnimationFrame(state.rafId);
      state.rafId = null;
    }
    if (state.stream) {
      state.stream.getTracks().forEach(t => t.stop());
      state.stream = null;
    }
    if (state.overlayEl) {
      state.overlayEl.remove();
      state.overlayEl = null;
    }
    state.step = 'idle';
  }

  function showStep(step) {
    state.step = step;
    if (!state.overlayEl) return;
    $$('[data-step]', state.overlayEl).forEach(el => {
      el.hidden = el.dataset.step !== step;
    });
    updateBreadcrumbs(step);
  }

  function updateBreadcrumbs(step) {
    const map = { height: 1, capture: 2, loading: 2, result: 3 };
    const currentIdx = map[step] || 1;
    $$('[data-step-indicator]', state.overlayEl).forEach(el => {
      const stepName = el.dataset.stepIndicator;
      const stepIdx = map[stepName];
      el.classList.toggle('active', stepIdx === currentIdx);
      el.classList.toggle('done', stepIdx < currentIdx);
    });
  }

  // ---------- STEP 1: HEIGHT ----------
  async function handleHeightNext() {
    const input = $('[data-field="height"]', state.overlayEl);
    const height = parseFloat(input.value);
    const err = $('[data-field="err"]', state.overlayEl);

    if (!Number.isFinite(height) || height < 120 || height > 220) {
      err.textContent = 'Veuillez saisir une taille réaliste entre 120 et 220 cm.';
      err.hidden = false;
      return;
    }
    err.hidden = true;
    state.heightCm = height;
    showStep('capture');

    // Preload models in background while starting camera
    ensureDetector().catch(e => console.warn('[SwiftStyle] MoveNet preload:', e.message));
    ensureOpenCV().catch(e => console.warn('[SwiftStyle] OpenCV preload:', e.message));

    await startCamera();
  }

  // ---------- STEP 2: CAMERA & LIVE POSE ----------
  async function startCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: state.config.cameraFacing || 'user',
          width: { ideal: 720 },
          height: { ideal: 1280 },
        },
        audio: false,
      });
      state.stream = stream;
      const video = $('[data-field="video"]', state.overlayEl);
      if (!video) return;
      video.srcObject = stream;
      await video.play();
      startLiveDetection();
    } catch (e) {
      const captureBox = $('[data-step="capture"]', state.overlayEl);
      if (captureBox) {
        const err = document.createElement('div');
        err.className = 'ss-err';
        err.textContent = 'Accès à la caméra refusé ou indisponible (' + e.message + '). Veuillez autoriser la webcam.';
        captureBox.prepend(err);
      }
    }
  }

  async function startLiveDetection() {
    let detector;
    try {
      detector = await ensureDetector();
    } catch (e) {
      console.warn('[SwiftStyle] Detector failed:', e);
      return;
    }

    const video = $('[data-field="video"]', state.overlayEl);
    const canvas = $('[data-field="overlay"]', state.overlayEl);
    if (!video || !canvas) return;

    const ctx = canvas.getContext('2d');
    const statusTxt = $('[data-field="status-txt"]', state.overlayEl);
    const statusDot = $('[data-field="status-dot"]', state.overlayEl);
    const statusHint = $('[data-field="status-hint"]', state.overlayEl);
    const captureBtn = $('[data-field="capture-btn"]', state.overlayEl);

    const SKELETON_PAIRS = [
      ['left_shoulder','right_shoulder'],
      ['left_shoulder','left_hip'],
      ['right_shoulder','right_hip'],
      ['left_hip','right_hip'],
      ['left_shoulder','left_elbow'],
      ['right_shoulder','right_elbow'],
      ['left_elbow','left_wrist'],
      ['right_elbow','right_wrist'],
      ['left_hip','left_knee'],
      ['right_hip','right_knee'],
      ['left_knee','left_ankle'],
      ['right_knee','right_ankle'],
    ];

    const loop = async () => {
      if (state.step !== 'capture' || !state.overlayEl || !state.stream) return;

      if (video.readyState >= 2 && video.videoWidth > 0) {
        if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
        }

        try {
          const poses = await detector.estimatePoses(video, { maxPoses: 1 });
          ctx.clearRect(0, 0, canvas.width, canvas.height);

          if (poses && poses.length > 0) {
            const kp = poses[0].keypoints;
            const get = name => kp.find(k => k.name === name);

            // Draw skeleton lines
            ctx.lineWidth = 4;
            ctx.strokeStyle = 'rgba(99, 102, 241, 0.85)';
            SKELETON_PAIRS.forEach(([p1, p2]) => {
              const k1 = get(p1), k2 = get(p2);
              if (k1 && k2 && k1.score > 0.3 && k2.score > 0.3) {
                ctx.beginPath();
                ctx.moveTo(k1.x, k1.y);
                ctx.lineTo(k2.x, k2.y);
                ctx.stroke();
              }
            });

            // Draw joint dots
            kp.forEach(k => {
              if (k.score > 0.3) {
                ctx.beginPath();
                ctx.arc(k.x, k.y, 5, 0, 2 * Math.PI);
                ctx.fillStyle = k.score > 0.5 ? '#22c55e' : '#eab308';
                ctx.fill();
              }
            });

            // Check full-body visibility
            const shoulders = (get('left_shoulder')?.score || 0) > 0.35 && (get('right_shoulder')?.score || 0) > 0.35;
            const hips = (get('left_hip')?.score || 0) > 0.35 && (get('right_hip')?.score || 0) > 0.35;
            const ankles = (get('left_ankle')?.score || 0) > 0.25 || (get('right_ankle')?.score || 0) > 0.25;
            const knees = (get('left_knee')?.score || 0) > 0.3 && (get('right_knee')?.score || 0) > 0.3;
            const head = (get('nose')?.score || 0) > 0.35 || (get('left_ear')?.score || 0) > 0.35 || (get('right_ear')?.score || 0) > 0.35;

            if (shoulders && hips && (ankles || knees) && head) {
              state.fullBodyDetected = true;
              statusTxt.textContent = 'Silhouette prête ✓';
              statusHint.textContent = 'Parfait, restez stable';
              statusDot.className = 'ss-status-dot ok';
              captureBtn.disabled = false;
            } else if (!head) {
              statusTxt.textContent = 'Tête non visible';
              statusHint.textContent = 'Levez la caméra';
              statusDot.className = 'ss-status-dot';
              captureBtn.disabled = true;
            } else if (!ankles && !knees) {
              statusTxt.textContent = 'Pieds non visibles';
              statusHint.textContent = 'Reculez de 2-3 mètres';
              statusDot.className = 'ss-status-dot';
              captureBtn.disabled = true;
            } else {
              statusTxt.textContent = 'Ajustez votre position';
              statusHint.textContent = 'Face à la caméra';
              statusDot.className = 'ss-status-dot';
              captureBtn.disabled = true;
            }
          } else {
            statusTxt.textContent = 'Recherche silhouette...';
            statusHint.textContent = 'Placez-vous devant';
            statusDot.className = 'ss-status-dot';
            captureBtn.disabled = true;
          }
        } catch (_) {}
      }

      state.rafId = requestAnimationFrame(loop);
    };

    loop();
  }

  // ---------- ML ENGINES ----------
  function ensureDetector() {
    if (state.detector) return Promise.resolve(state.detector);
    if (state.detectorPromise) return state.detectorPromise;

    state.detectorPromise = (async () => {
      const tf = await loadScript(CDN.tf, 'tf');
      const pd = await loadScript(CDN.pose, 'poseDetection');
      try {
        await tf.setBackend('webgl');
      } catch (_) {
        await tf.setBackend('cpu');
      }
      await tf.ready();
      state.tf = tf;
      state.poseDetection = pd;

      const detector = await pd.createDetector(
        pd.SupportedModels.MoveNet,
        { modelType: pd.movenet.modelType.SINGLEPOSE_THUNDER }
      );
      state.detector = detector;
      return detector;
    })();

    return state.detectorPromise;
  }

  function ensureOpenCV() {
    if (state.cv && state.cv.Mat) return Promise.resolve(state.cv);
    if (state.cvPromise) return state.cvPromise;

    state.cvPromise = new Promise((resolve, reject) => {
      if (window.cv && window.cv.Mat) {
        state.cv = window.cv;
        return resolve(window.cv);
      }

      const s = document.createElement('script');
      s.src = CDN.opencv;
      s.async = true;

      let timer = null;
      const checkCV = () => {
        if (window.cv && window.cv.Mat) {
          clearTimeout(timer);
          state.cv = window.cv;
          return resolve(window.cv);
        }
      };

      s.onload = () => {
        if (window.cv && window.cv.Mat) {
          state.cv = window.cv;
          return resolve(window.cv);
        }
        if (window.cv) {
          window.cv.onRuntimeInitialized = () => {
            state.cv = window.cv;
            resolve(window.cv);
          };
        }
        let attempts = 0;
        timer = setInterval(() => {
          attempts++;
          if (window.cv && window.cv.Mat) {
            clearInterval(timer);
            state.cv = window.cv;
            return resolve(window.cv);
          }
          if (attempts > 100) {
            clearInterval(timer);
            reject(new Error('OpenCV initialization timeout'));
          }
        }, 100);
      };

      s.onerror = () => reject(new Error('Failed to load OpenCV script'));
      document.head.appendChild(s);
    });

    return state.cvPromise;
  }

  // ---------- CAPTURE & ANTHROPOMETRIC PIPELINE ----------
  async function handleCapture() {
    showStep('loading');

    try {
      const video = $('[data-field="video"]', state.overlayEl);
      if (!video || !video.videoWidth) throw new Error('Caméra non prête');

      // Create snapshot canvas
      const snap = document.createElement('canvas');
      snap.width = video.videoWidth;
      snap.height = video.videoHeight;
      const snapCtx = snap.getContext('2d');
      snapCtx.drawImage(video, 0, 0);

      // Stop camera video stream now that snapshot is taken
      if (state.stream) {
        state.stream.getTracks().forEach(t => t.stop());
        state.stream = null;
      }
      if (state.rafId) {
        cancelAnimationFrame(state.rafId);
        state.rafId = null;
      }

      const detector = await ensureDetector();
      const poses = await detector.estimatePoses(snap, { maxPoses: 1 });
      if (!poses || poses.length === 0) throw new Error('Aucun profil humain détecté sur la photo.');
      const kp = poses[0].keypoints;

      // Calibration: Pixels per cm using height & anthropometric skull/ankle proportions
      const calib = calibrateBody(kp, state.heightCm, snap.height);

      // Try OpenCV GrabCut silhouette segmentation; fallback gracefully to keypoints
      let widths = null;
      try {
        widths = await measureSilhouetteDownscaled(snap, kp, calib.pxPerCm);
      } catch (err) {
        console.warn('[SwiftStyle] Silhouette fallback to keypoints:', err.message);
      }

      // Biacromial breadth & hip width estimation:
      // Shoulder joint-to-joint is ~82% of total outer shoulder breadth
      const shoulderJointDist = kpDistance(kp, 'left_shoulder', 'right_shoulder') / calib.pxPerCm;
      const hipJointDist = kpDistance(kp, 'left_hip', 'right_hip') / calib.pxPerCm;

      const shoulderWidthCm = widths?.shoulderWidthCm ?? (shoulderJointDist * 1.22);
      const hipWidthCm = widths?.hipWidthCm ?? (hipJointDist * 1.25);
      const chestWidthCm = widths?.chestWidthCm ?? (shoulderWidthCm * 0.88);
      const waistWidthCm = widths?.waistWidthCm ?? (hipWidthCm * 0.80);

      const ratios = ANTHRO[state.gender] || ANTHRO.female;
      const chestCm = round(chestWidthCm * ratios.chest, 1);
      const waistCm = round(waistWidthCm * ratios.waist, 1);
      const hipCm = round(hipWidthCm * ratios.hip, 1);

      const confidence = round(kp.reduce((s, k) => s + (k.score || 0), 0) / kp.length, 2);

      const measurements = {
        shoulderWidthCm: round(shoulderWidthCm, 1),
        chestCm,
        waistCm,
        hipCm,
        confidence,
        method: widths ? 'Silhouette OpenCV' : 'MoveNet Estimé',
      };
      state.measurements = measurements;

      const chart = state.config.sizeChart || DEFAULT_SIZE_CHART;
      const recommended = recommendSize(measurements, chart);
      state.recommendedSize = recommended;
      state.selectedSize = recommended;

      renderResult(measurements, recommended);
      showStep('result');
    } catch (e) {
      console.error('[SwiftStyle] Error:', e);
      showStep('capture');
      const captureBox = $('[data-step="capture"]', state.overlayEl);
      if (captureBox) {
        const err = document.createElement('div');
        err.className = 'ss-err';
        err.textContent = 'Erreur d’analyse : ' + e.message + '. Veuillez réessayer.';
        captureBox.prepend(err);
      }
      await startCamera();
    }
  }

  function calibrateBody(kp, heightCm, canvasHeight) {
    const get = n => kp.find(k => k.name === n && k.score > 0.25);

    const lEar = get('left_ear'), rEar = get('right_ear');
    const nose = get('nose');
    const lA = get('left_ankle'), rA = get('right_ankle');
    const lK = get('left_knee'), rK = get('right_knee');

    // Head reference point
    let headRefY = null;
    if (lEar && rEar) headRefY = (lEar.y + rEar.y) / 2;
    else if (nose) headRefY = nose.y;
    else {
      const lS = get('left_shoulder'), rS = get('right_shoulder');
      if (lS && rS) headRefY = (lS.y + rS.y) / 2 - 40;
    }

    // Foot / floor reference point
    let groundY = null;
    if (lA && rA) {
      groundY = (lA.y + rA.y) / 2 + 15; // +15px for foot sole
    } else if (lA || rA) {
      groundY = (lA ? lA.y : rA.y) + 15;
    } else if (lK && rK) {
      // Anthropometry: knee is at approx 28.5% total height from floor
      const kneeY = (lK.y + rK.y) / 2;
      const torsoSpan = kneeY - (headRefY || 0);
      groundY = kneeY + torsoSpan * 0.38;
    } else {
      groundY = canvasHeight - 20;
    }

    // Anthropometry: distance from ear/eye line to top of skull is ~7.5% of total height
    // Ear to ankle is approx 88% of total stature
    const earAnkleDistance = Math.max(100, groundY - (headRefY || 0));
    const fullHeightPixels = earAnkleDistance / 0.92;
    const pxPerCm = fullHeightPixels / heightCm;

    return { pxPerCm, groundY };
  }

  function kpDistance(kp, a, b) {
    const ka = kp.find(k => k.name === a);
    const kb = kp.find(k => k.name === b);
    if (!ka || !kb) return 30;
    return Math.hypot(ka.x - kb.x, ka.y - kb.y);
  }

  // ---------- HIGH-PERFORMANCE DOWNSCALED OPENCV GRABCUT ----------
  async function measureSilhouetteDownscaled(canvas, kp, pxPerCm) {
    const cv = await ensureOpenCV();
    if (!cv || !cv.Mat) throw new Error('OpenCV non disponible');

    const vis = kp.filter(k => k.score > 0.25);
    if (vis.length < 6) throw new Error('Points clés insuffisants');

    // Downscale canvas to max dimension ~360px for ultra-fast GrabCut (80ms vs 6000ms)
    const scale = Math.min(1.0, 360 / Math.max(canvas.width, canvas.height));
    const scaledW = Math.round(canvas.width * scale);
    const scaledH = Math.round(canvas.height * scale);

    const smallCanvas = document.createElement('canvas');
    smallCanvas.width = scaledW;
    smallCanvas.height = scaledH;
    const sCtx = smallCanvas.getContext('2d');
    sCtx.drawImage(canvas, 0, 0, scaledW, scaledH);

    const scaledKp = kp.map(k => ({ ...k, x: k.x * scale, y: k.y * scale }));
    const xs = scaledKp.filter(k => k.score > 0.25).map(k => k.x);
    const ys = scaledKp.filter(k => k.score > 0.25).map(k => k.y);

    const margin = 20;
    const x0 = Math.max(0, Math.floor(Math.min(...xs)) - margin);
    const y0 = Math.max(0, Math.floor(Math.min(...ys)) - margin);
    const x1 = Math.min(scaledW, Math.ceil(Math.max(...xs)) + margin);
    const y1 = Math.min(scaledH, Math.ceil(Math.max(...ys)) + margin);
    const w = x1 - x0, h = y1 - y0;

    if (w < 30 || h < 60) throw new Error('Zone de découpe trop petite');

    let src = null, mask = null, bgd = null, fgd = null, fg = null;
    try {
      src = cv.imread(smallCanvas);
      mask = new cv.Mat();
      bgd = new cv.Mat();
      fgd = new cv.Mat();

      // 2 iterations of GrabCut on downscaled image is lightning fast and precise
      cv.grabCut(src, mask, new cv.Rect(x0, y0, w, h), bgd, fgd, 2, cv.GC_INIT_WITH_RECT);

      fg = new cv.Mat(mask.rows, mask.cols, cv.CV_8UC1, new cv.Scalar(0));
      const maskData = mask.data;
      const fgData = fg.data;
      for (let i = 0; i < maskData.length; i++) {
        const v = maskData[i];
        fgData[i] = (v === cv.GC_FGD || v === cv.GC_PR_FGD) ? 255 : 0;
      }

      const widthAtY = (row) => {
        const r = Math.round(row);
        if (r < 0 || r >= fg.rows) return 0;
        const off = r * fg.cols;
        let left = -1, right = -1;
        for (let x = 0; x < fg.cols; x++) {
          if (fgData[off + x] > 128) {
            if (left === -1) left = x;
            right = x;
          }
        }
        return left === -1 ? 0 : (right - left);
      };

      const get = n => scaledKp.find(k => k.name === n && k.score > 0.25);
      const lS = get('left_shoulder'), rS = get('right_shoulder');
      const lH = get('left_hip'), rH = get('right_hip');

      if (!lS || !rS || !lH || !rH) throw new Error('Repères épaules/hanches manquants');

      const shoulderY = (lS.y + rS.y) / 2;
      const hipY = (lH.y + rH.y) / 2;
      const chestY = shoulderY + (hipY - shoulderY) * 0.30;
      const waistY = shoulderY + (hipY - shoulderY) * 0.65;

      const shoulderW = widthAtY(shoulderY) / scale;
      const chestW = widthAtY(chestY) / scale;
      const waistW = widthAtY(waistY) / scale;
      const hipW = widthAtY(hipY) / scale;

      if (shoulderW < 20 || hipW < 20) throw new Error('Largeurs anormalement faibles');

      return {
        shoulderWidthCm: shoulderW / pxPerCm,
        chestWidthCm: chestW / pxPerCm,
        waistWidthCm: waistW / pxPerCm,
        hipWidthCm: hipW / pxPerCm,
      };
    } finally {
      if (src) src.delete();
      if (mask) mask.delete();
      if (bgd) bgd.delete();
      if (fgd) fgd.delete();
      if (fg) fg.delete();
    }
  }

  // ---------- SIZE MATCHING ENGINE ----------
  function recommendSize(m, chart) {
    const sizes = chart.sizes || DEFAULT_SIZE_CHART.sizes;
    let best = null;

    for (const s of sizes) {
      const c = scoreFit(m.chestCm, s.chest);
      const w = scoreFit(m.waistCm, s.waist);
      const h = scoreFit(m.hipCm, s.hip);
      const totalScore = c * 0.45 + w * 0.25 + h * 0.30;
      if (!best || totalScore > best.score) {
        best = { label: s.label, score: totalScore };
      }
    }

    return best ? best.label : 'M';
  }

  function scoreFit(val, range) {
    if (!range) return 0.5;
    const [min, max] = range;
    const mid = (min + max) / 2;
    const span = Math.max(1, max - min);
    // Gaussian peak at center of size range
    const dist = Math.abs(val - mid);
    return Math.max(0, 1 - (dist / (span * 1.2)) ** 2);
  }

  // ---------- RESULT DISPLAY & INTERACTION ----------
  function renderResult(m, activeSize) {
    if (!state.overlayEl) return;

    $('[data-field="size"]', state.overlayEl).textContent = activeSize;

    const chart = state.config.sizeChart || DEFAULT_SIZE_CHART;
    const currentSizeData = chart.sizes.find(s => s.label === activeSize);

    // Render interactive size chips
    const sizesWrap = $('[data-field="sizes-list"]', state.overlayEl);
    sizesWrap.innerHTML = chart.sizes.map(s => {
      const isRec = s.label === state.recommendedSize;
      const isSel = s.label === activeSize;
      return `
        <button type="button" class="ss-size-chip ${isSel ? 'active' : ''} ${isRec ? 'recommended-chip' : ''}"
                data-action="select-size" data-size="${s.label}">
          ${s.label}
        </button>
      `;
    }).join('');

    // Render measurements cards with comparison
    const mGrid = $('[data-field="measurements"]', state.overlayEl);
    const chestRange = currentSizeData?.chest ? `${currentSizeData.chest[0]}–${currentSizeData.chest[1]} cm` : '';
    const waistRange = currentSizeData?.waist ? `${currentSizeData.waist[0]}–${currentSizeData.waist[1]} cm` : '';
    const hipRange = currentSizeData?.hip ? `${currentSizeData.hip[0]}–${currentSizeData.hip[1]} cm` : '';

    mGrid.innerHTML = `
      <div class="ss-m-card">
        <div class="ss-m-label">Tour de poitrine</div>
        <div class="ss-m-val">${m.chestCm} cm</div>
        <div class="ss-m-detail">Taille ${activeSize}: ${chestRange}</div>
      </div>
      <div class="ss-m-card">
        <div class="ss-m-label">Tour de taille</div>
        <div class="ss-m-val">${m.waistCm} cm</div>
        <div class="ss-m-detail">Taille ${activeSize}: ${waistRange}</div>
      </div>
      <div class="ss-m-card">
        <div class="ss-m-label">Tour de hanches</div>
        <div class="ss-m-val">${m.hipCm} cm</div>
        <div class="ss-m-detail">Taille ${activeSize}: ${hipRange}</div>
      </div>
      <div class="ss-m-card">
        <div class="ss-m-label">Largeur d'épaules</div>
        <div class="ss-m-val">${m.shoulderWidthCm} cm</div>
        <div class="ss-m-detail">Indice confiance ${Math.round(m.confidence * 100)}%</div>
      </div>
    `;

    // Cart button update
    const cartBtn = $('[data-field="cart"]', state.overlayEl);
    cartBtn.textContent = `Ajouter la taille ${activeSize} au panier`;
    cartBtn.dataset.size = activeSize;
  }

  function handleRetake() {
    showStep('capture');
    startCamera();
  }

  // ---------- ADD TO CART ----------
  function handleAddToCart() {
    const size = state.selectedSize || state.recommendedSize;
    if (!size) return;

    const detail = {
      size,
      recommendedSize: state.recommendedSize,
      measurements: state.measurements,
      productId: state.config.productId,
    };

    if (typeof state.config.onAddToCart === 'function') {
      try {
        state.config.onAddToCart(size, state.measurements);
      } catch (err) {
        console.error('[SwiftStyle] onAddToCart error:', err);
      }
    }

    // Dispatch event with composed: true so it crosses shadow DOM boundary!
    window.dispatchEvent(new CustomEvent('swiftstyle:add-to-cart', {
      bubbles: true,
      composed: true,
      detail,
    }));

    closeModal();
  }

  // ---------- INITIALIZATION ----------
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }

  // Global public API
  window.SwiftStyleWidget = {
    version: VERSION,
    mount,
    open: openModal,
    close: closeModal,
    getState: () => state,
  };
})();

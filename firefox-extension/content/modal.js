(function () {
  "use strict";

  const CHECK_EVERY_MS = 300;
  const CHECK_SIDE = 640;
  const PHOTO_SIDE = 1280;
  const STEADY_CHECKS = 2;
  const MAX_MOVE = 0.05;
  const COUNTDOWN_MS = 3000;
  const STALE_MS = 1500;
  const SKIP_SIDE_AFTER_MS = 20000;
  const PREFS_KEY = "swiftstyle.prefs";

  const FITS = [
    ["ajustee", "Ajusté"],
    ["normale", "Normal"],
    ["ample", "Ample"],
  ];

  const MEASURE_LABELS = { chest: "Poitrine", waist: "Taille", hips: "Hanches", thigh: "Cuisse", inseam: "Entrejambe" };

  const PHOTO_ZONES = ["chest", "waist", "hips", "thigh"];
  const ZONE_COLORS = { chest: "#e11d48", waist: "#f59e0b", hips: "#2563eb", thigh: "#16a34a", inseam: "#9333ea" };
  const MIN_SPAN = 0.01;

  const BONES = [
    [0, 1], [1, 2], [2, 3], [3, 7], [0, 4], [4, 5], [5, 6], [6, 8], [9, 10],
    [11, 12], [11, 13], [13, 15], [15, 17], [15, 19], [15, 21], [17, 19],
    [12, 14], [14, 16], [16, 18], [16, 20], [16, 22], [18, 20],
    [11, 23], [12, 24], [23, 24],
    [23, 25], [24, 26], [25, 27], [26, 28], [27, 29], [28, 30], [29, 31], [30, 32], [27, 31], [28, 32],
  ];
  const LEFT_POINTS = new Set([1, 2, 3, 7, 9, 11, 13, 15, 17, 19, 21, 23, 25, 27, 29, 31]);
  const pointColor = (i) => (i === 0 ? "#ffffff" : LEFT_POINTS.has(i) ? "#ff8a00" : "#00d9e7");

  const TARGET_POSES = {
    front: [
      [50, 16], [47, 12], [45, 12], [43, 12], [53, 12], [55, 12], [57, 12], [40, 14], [60, 14], [47, 21], [53, 21],
      [36, 40], [64, 40], [27, 76], [73, 76], [21, 108], [79, 108],
      [18, 116], [82, 116], [21, 118], [79, 118], [24, 114], [76, 114],
      [42, 116], [58, 116], [38, 170], [62, 170], [35, 222], [65, 222], [36, 230], [64, 230], [30, 234], [70, 234],
    ],
    side: [
      [60, 16], [57, 12], [58, 12], [58.5, 12], [57, 12.5], [58, 12.5], [58.5, 12.5], [48, 14], [49, 14], [57, 21], [57.5, 21],
      [49, 40], [51, 40], [48, 76], [50, 76], [51, 106], [53, 106],
      [52, 113], [54, 113], [54, 115], [56, 115], [54, 110], [56, 110],
      [49, 116], [51, 116], [50, 170], [52, 170], [48, 222], [50, 222], [45, 230], [47, 230], [57, 232], [59, 232],
    ],
  };

  function poseGuideSvg(view) {
    const pts = TARGET_POSES[view];
    const lines = BONES.map(([a, b]) => `<line x1="${pts[a][0]}" y1="${pts[a][1]}" x2="${pts[b][0]}" y2="${pts[b][1]}"/>`).join("");
    const dots = pts.map((pt, i) => `<circle cx="${pt[0]}" cy="${pt[1]}" r="${i <= 10 ? 1.5 : 2.8}" fill="${pointColor(i)}"/>`).join("");
    return `<svg viewBox="8 -4 84 248" aria-hidden="true"><g stroke="#e0e0e0" stroke-width="2.2" stroke-linecap="round">${lines}</g>${dots}</svg>`;
  }

  const ICONS = {
    close: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    check: '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  };

  function h(tag, props, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "text") el.textContent = v;
      else if (k === "html") el.innerHTML = v;
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? "" : String(v));
    }
    for (const c of children.flat()) {
      if (c === null || c === undefined || c === false) continue;
      el.append(c instanceof Node ? c : String(c));
    }
    return el;
  }

  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function callApi(type, payload) {
    return new Promise((resolve) => {
      const broken = (message) => resolve({ ok: false, status: 0, data: { error: "extension", message } });
      try {
        chrome.runtime.sendMessage(Object.assign({ source: "swiftstyle", type }, payload), (res) => {
          if (chrome.runtime.lastError || !res) broken("L'extension SwiftStyle ne répond pas : rechargez la page.");
          else resolve(res);
        });
      } catch (e) {
        broken("L'extension SwiftStyle a été mise à jour : rechargez la page.");
      }
    });
  }

  function errorMessage(res, fallback) {
    const d = (res && res.data) || {};
    if (typeof d.message === "string" && d.message) return d.message;
    if (Array.isArray(d.detail) && d.detail[0] && d.detail[0].msg) return d.detail[0].msg;
    return fallback + (res && res.status ? " (erreur " + res.status + ")" : "");
  }

  function loadPrefs() {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get([PREFS_KEY], (v) => resolve((v && v[PREFS_KEY]) || {}));
      } catch (e) {
        resolve({});
      }
    });
  }

  function savePrefs(prefs) {
    try {
      chrome.storage.local.set({ [PREFS_KEY]: prefs });
    } catch (e) {
    }
  }

  function grabFrame(source, maxSide, quality, box) {
    const vw = source.videoWidth || source.width;
    const vh = source.videoHeight || source.height;
    let sx = 0;
    let sw = vw;
    if (box) {
      const x1 = box.x1 * vw;
      const x2 = box.x2 * vw;
      const width = Math.max((x2 - x1) * 1.5, vh * 0.75);
      if (width < vw) {
        sw = Math.round(width);
        sx = Math.round(clamp((x1 + x2) / 2 - sw / 2, 0, vw - sw));
      }
    }
    const scale = Math.min(1, maxSide / Math.max(sw, vh));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(sw * scale);
    canvas.height = Math.round(vh * scale);
    canvas.getContext("2d").drawImage(source, sx, 0, sw, vh, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", quality);
  }

  async function fileToJpeg(file, maxSide) {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    if (bitmap.close) bitmap.close();
    return canvas.toDataURL("image/jpeg", 0.92);
  }

  function ellipsePerimeter(a, b) {
    return Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)));
  }

  function copyLines(measure) {
    const copy = (lines) => Object.fromEntries(PHOTO_ZONES.map((k) => [k, Object.assign({}, lines[k])]));
    return {
      front: copy(measure.front.lines),
      side: measure.side ? copy(measure.side.lines) : null,
      inseam: measure.front.inseam ? Object.assign({}, measure.front.inseam) : null,
    };
  }

  function adjustFromLines(measure, lines) {
    const span = (l) => l.x2 - l.x1;
    const moved = (a, b) => a.x1 !== b.x1 || a.x2 !== b.x2;
    const rescale = (cm, before, after) => (span(before) > 0 ? (cm * span(after)) / span(before) : cm);
    const measurements = {};
    const edited = {};
    for (const k of PHOTO_ZONES) {
      const api = measure.zones[k];
      const frontMoved = moved(measure.front.lines[k], lines.front[k]);
      const sideMoved = Boolean(measure.side && lines.side && moved(measure.side.lines[k], lines.side[k]));
      edited[k] = frontMoved || sideMoved;
      if (!edited[k]) {
        measurements[k] = measure.measurements[k];
        continue;
      }
      const width = rescale(api.width, measure.front.lines[k], lines.front[k]);
      const depth =
        measure.depthSource === "profile" && measure.side && lines.side
          ? rescale(api.depth, measure.side.lines[k], lines.side[k])
          : api.width > 0
            ? (width * api.depth) / api.width
            : api.depth;
      measurements[k] = Math.round(ellipsePerimeter(width / 2, depth / 2));
    }
    const o = measure.front.inseam;
    const l = lines.inseam;
    edited.inseam = Boolean(o && l && (o.y1 !== l.y1 || o.y2 !== l.y2));
    measurements.inseam =
      edited.inseam && o.y2 - o.y1 > 0 ? Math.round((measure.measurements.inseam * (l.y2 - l.y1)) / (o.y2 - o.y1)) : measure.measurements.inseam;
    return { measurements, edited, any: Object.values(edited).some(Boolean) };
  }

  function cameraError(err) {
    const name = err && err.name;
    if (name === "NotAllowedError" || name === "SecurityError") {
      return "L'accès à la caméra a été refusé (par vous ou par ce site). Autorisez-le depuis la barre d'adresse, ou importez deux photos.";
    }
    if (name === "NotFoundError" || name === "OverconstrainedError") return "Aucune caméra n'a été trouvée sur cet appareil.";
    if (name === "NotReadableError") return "La caméra est déjà utilisée par une autre application.";
    return "Impossible d'ouvrir la caméra" + (err && err.message ? " : " + err.message : ".");
  }

  let current = null;

  async function open(options) {
    if (current) return;
    const opts = options || {};
    const garment = opts.garment || {};
    const prefs = Object.assign({ fit: "normale" }, await loadPrefs());

    const host = document.createElement("swiftstyle-modal");
    host.setAttribute("data-swiftstyle-modal", "");
    host.style.cssText = "all:initial;position:fixed;inset:0;z-index:2147483647;display:block;";
    const root = host.attachShadow({ mode: "closed" });
    if (opts.font) host.style.setProperty("--ss-font", opts.font);

    const body = h("div", { class: "body" });
    const dialog = h(
      "div",
      { class: "dialog", role: "dialog", "aria-modal": "true", "aria-label": "Trouver ma taille avec SwiftStyle" },
      h(
        "header",
        null,
        h("span", { class: "brand", text: "SwiftStyle" }),
        h("span", { class: "title", text: "Trouver ma taille" }),
        h("button", { type: "button", class: "icon", "aria-label": "Fermer", html: ICONS.close, onclick: close }),
      ),
      body,
    );
    root.append(h("style", { text: CSS }), h("div", { class: "backdrop", onclick: close }), dialog);

    for (const type of ["click", "mousedown", "mouseup", "pointerdown", "pointerup", "touchstart", "touchend", "keydown", "keyup", "keypress", "input", "change", "focusin", "focusout", "wheel"]) {
      host.addEventListener(type, (e) => e.stopPropagation());
    }
    dialog.addEventListener("keydown", (e) => {
      if (e.key === "Escape") close();
    });

    const prevOverflow = document.documentElement.style.overflow;
    const prevFocus = document.activeElement;
    document.documentElement.style.overflow = "hidden";
    (document.body || document.documentElement).appendChild(host);

    let camera = null;
    let shots = { front: null, side: null };

    current = { close };
    showIntro();

    function screen(...children) {
      body.replaceChildren(...children.flat().filter((c) => c !== null && c !== undefined && c !== false));
      dialog.classList.remove("wide", "result");
      body.scrollTop = 0;
    }

    function validHeight() {
      const v = Number(prefs.heightCm);
      return Number.isFinite(v) && v >= 140 && v <= 210;
    }

    function showIntro(notice) {
      stopCamera();
      const heightInput = h("input", {
        type: "number",
        min: 140,
        max: 210,
        step: 1,
        inputmode: "numeric",
        placeholder: "175",
        value: prefs.heightCm || "",
        "aria-label": "Votre taille en centimètres",
      });
      const consent = h("input", { type: "checkbox" });
      const startBtn = h("button", { type: "button", class: "primary", text: "Activer la caméra" });
      const uploadBtn = h("button", { type: "button", class: "link", text: "Je préfère importer deux photos" });
      const error = h("p", { class: "error", role: "alert", hidden: !notice, text: notice || "" });

      function update() {
        prefs.heightCm = heightInput.value ? Math.round(Number(heightInput.value)) : undefined;
        const ok = validHeight() && consent.checked;
        startBtn.disabled = !ok;
        uploadBtn.disabled = !ok;
      }
      function go(next) {
        update();
        if (!validHeight()) return showError("Indiquez votre taille, entre 140 et 210 cm.");
        if (!consent.checked) return showError("Cochez la case pour accepter l'envoi des photos.");
        savePrefs(prefs);
        next();
      }
      function showError(text) {
        error.textContent = text;
        error.hidden = false;
      }
      heightInput.addEventListener("input", update);
      consent.addEventListener("change", update);
      startBtn.addEventListener("click", () => go(startCamera));
      uploadBtn.addEventListener("click", () => go(showUpload));

      screen(
        h("h2", { text: "Votre taille en 30 secondes" }),
        h("p", {
          class: "muted",
          text: "La caméra prend deux photos toute seule, de face puis de profil. On en déduit vos mensurations et la taille qui vous va pour cet article. Vous choisirez ensuite votre coupe, et pourrez corriger vos mesures.",
        }),
        h("label", { class: "field" }, h("span", { text: "Votre taille" }), h("span", { class: "unit" }, heightInput, " cm")),
        h(
          "ol",
          { class: "steps" },
          h("li", { text: "Posez l'appareil à hauteur des hanches, puis reculez de 2 à 3 m." }),
          h("li", { text: "De face : bras un peu écartés, pieds écartés de la largeur des hanches." }),
          h("li", { text: "Quand la photo de face est prise, tournez-vous de profil. Des vêtements près du corps donnent une mesure plus juste." }),
        ),
        h(
          "label",
          { class: "consent" },
          consent,
          h("span", {
            text: "J'accepte que mes deux photos soient envoyées à SwiftStyle pour mesurer mon corps. Elles sont analysées puis oubliées : rien n'est enregistré.",
          }),
        ),
        error,
        h("div", { class: "actions" }, startBtn),
        h("div", { class: "center" }, uploadBtn),
      );
      update();
      if (!validHeight()) heightInput.focus();
    }

    async function startCamera() {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        return showCameraError("La caméra n'est pas disponible sur cette page (site non sécurisé ou navigateur incompatible).");
      }

      const video = h("video", { playsinline: true, muted: true, autoplay: true });
      video.muted = true;
      const overlay = h("canvas", { class: "overlay" });
      const message = h("p", { class: "msg", "aria-live": "polite", text: "Ouverture de la caméra…" });
      const tip = h("p", { class: "tip", hidden: true });
      const flash = h("div", { class: "flash" });
      const count = h("div", { class: "count", hidden: true, "aria-live": "assertive" }, h("span"));
      const guideSvg = h("div", { class: "pose-svg", html: poseGuideSvg("front") });
      const guideLabel = h("span", { text: "Pose : de face" });
      const guide = h("div", { class: "pose-guide" }, guideSvg, guideLabel);
      const chips = {
        front: h("span", { class: "chip active" }, h("span", { class: "dot", text: "1" }), "Face"),
        side: h("span", { class: "chip" }, h("span", { class: "dot", text: "2" }), "Profil"),
      };
      const skipBtn = h("button", { type: "button", class: "secondary", hidden: true, text: "Continuer sans profil" });
      const cancelBtn = h("button", { type: "button", class: "secondary", text: "Annuler", onclick: () => showIntro() });

      screen(
        h(
          "div",
          { class: "stage" },
          h("div", { class: "mirror" }, video, overlay),
          h("div", { class: "hud-top" }, chips.front, chips.side),
          guide,
          count,
          flash,
          h("div", { class: "hud-bottom" }, message, tip),
        ),
        h("div", { class: "actions row" }, skipBtn, cancelBtn),
      );
      dialog.classList.add("wide");

      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        });
      } catch (err) {
        return showCameraError(cameraError(err));
      }
      if (!current || !body.contains(video)) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }

      shots = { front: null, side: null };
      const s = {
        running: true,
        stream,
        video,
        overlay,
        phase: "front",
        pose: null,
        poseAt: 0,
        prevBox: null,
        steady: 0,
        still: document.createElement("canvas"),
        readyStill: document.createElement("canvas"),
        readyBox: null,
        countdownAt: 0,
        phaseAt: performance.now(),
        failures: 0,
        skipTimer: 0,
      };
      camera = s;
      video.srcObject = stream;
      try {
        await video.play();
      } catch (e) {
      }

      skipBtn.addEventListener("click", () => {
        if (camera !== s) return;
        stopCamera();
        analyze();
      });

      setMessage("Placez-vous devant la caméra, de la tête aux pieds.");
      requestAnimationFrame(tick);
      checkLoop();

      function setMessage(text) {
        if (message.textContent !== text) message.textContent = text;
      }

      function setTip(text) {
        tip.textContent = text || "";
        tip.hidden = !text;
      }

      async function checkLoop() {
        while (s.running) {
          const started = performance.now();
          if (video.readyState >= 2 && video.videoWidth) {
            s.still.width = video.videoWidth;
            s.still.height = video.videoHeight;
            s.still.getContext("2d").drawImage(video, 0, 0);
            const frame = grabFrame(s.still, CHECK_SIDE, 0.7, null);
            const res = await callApi("pose", { frame, expect: s.phase });
            if (!s.running) return;
            if (res.ok && res.data) {
              s.failures = 0;
              onPose(res.data);
            } else if (res.status === 0 && ++s.failures >= 3) {
              stopCamera();
              return showError(errorMessage(res, "Le service SwiftStyle est injoignable."), startCamera);
            }
          }
          await sleep(Math.max(50, CHECK_EVERY_MS - (performance.now() - started)));
        }
      }

      function onPose(pose) {
        const moved = pose.box && s.prevBox
          ? Math.max(
            Math.abs(pose.box.x1 - s.prevBox.x1),
            Math.abs(pose.box.y1 - s.prevBox.y1),
            Math.abs(pose.box.x2 - s.prevBox.x2),
            Math.abs(pose.box.y2 - s.prevBox.y2),
          )
          : 1;
        s.pose = pose;
        s.poseAt = performance.now();
        s.prevBox = pose.box;

        if (!pose.ready) {
          s.steady = 0;
          cancelCountdown();
          setMessage(pose.message);
          setTip("");
          return;
        }
        s.readyStill.width = s.still.width;
        s.readyStill.height = s.still.height;
        s.readyStill.getContext("2d").drawImage(s.still, 0, 0);
        s.readyBox = pose.box;
        s.steady = moved <= MAX_MOVE ? s.steady + 1 : 1;
        setTip((pose.tips && pose.tips[0]) || "");
        if (s.steady < STEADY_CHECKS) {
          cancelCountdown();
          setMessage(pose.message);
        } else if (!s.countdownAt) {
          s.countdownAt = performance.now();
          setMessage("Ne bougez plus…");
        }
      }

      function cancelCountdown() {
        s.countdownAt = 0;
        count.hidden = true;
      }

      function tick() {
        if (!s.running) return;
        drawOverlay();
        if (s.countdownAt) {
          const now = performance.now();
          const left = COUNTDOWN_MS - (now - s.countdownAt);
          if (now - s.poseAt > STALE_MS) {
            cancelCountdown();
          } else if (left <= 0) {
            capture();
          } else {
            const n = String(Math.ceil(left / 1000));
            if (count.firstChild.textContent !== n) count.firstChild.textContent = n;
            count.style.setProperty("--p", String(1 - left / COUNTDOWN_MS));
            count.hidden = false;
          }
        }
        if (s.running) requestAnimationFrame(tick);
      }

      function capture() {
        const phase = s.phase;
        shots[phase] = grabFrame(s.readyStill, PHOTO_SIDE, 0.92, s.readyBox);
        cancelCountdown();
        s.steady = 0;
        s.prevBox = null;
        s.readyBox = null;
        flash.classList.remove("on");
        void flash.offsetWidth;
        flash.classList.add("on");

        chips[phase].classList.remove("active");
        chips[phase].classList.add("done");
        chips[phase].replaceChildren(h("img", { src: shots[phase], alt: "" }), h("span", { class: "dot", html: ICONS.check }), phase === "front" ? "Face" : "Profil");

        if (phase === "front") {
          s.phase = "side";
          s.phaseAt = performance.now();
          chips.side.classList.add("active");
          guideSvg.innerHTML = poseGuideSvg("side");
          guideLabel.textContent = "Pose : de profil";
          setMessage("Photo de face prise. Tournez-vous de profil.");
          setTip("");
          s.skipTimer = setTimeout(() => {
            if (camera === s && s.phase === "side") skipBtn.hidden = false;
          }, SKIP_SIDE_AFTER_MS);
        } else {
          stopCamera();
          analyze();
        }
      }

      function drawOverlay() {
        const rect = overlay.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        const cw = Math.round(rect.width * dpr);
        const ch = Math.round(rect.height * dpr);
        if (!cw || !ch) return;
        if (overlay.width !== cw || overlay.height !== ch) {
          overlay.width = cw;
          overlay.height = ch;
        }
        const g = overlay.getContext("2d");
        g.clearRect(0, 0, cw, ch);
        const vw = video.videoWidth;
        const vh = video.videoHeight;
        if (!vw || !vh) return;
        const scale = Math.min(cw / vw, ch / vh);
        const ox = (cw - vw * scale) / 2;
        const oy = (ch - vh * scale) / 2;
        const X = (x) => ox + x * vw * scale;
        const Y = (y) => oy + y * vh * scale;

        const fresh = s.pose && performance.now() - s.poseAt < STALE_MS;
        const ready = fresh && s.pose.ready;

        const lm = fresh ? s.pose.landmarks : null;
        if (!lm || lm.length < 33) return;
        const visible = (i) => lm[i].visibility >= 0.5;
        g.globalAlpha = 0.95;
        g.lineCap = "round";
        g.lineWidth = 3 * dpr;
        g.strokeStyle = ready ? "#22c55e" : "#e0e0e0";
        for (const [a, b] of BONES) {
          if (!visible(a) || !visible(b)) continue;
          g.beginPath();
          g.moveTo(X(lm[a].x), Y(lm[a].y));
          g.lineTo(X(lm[b].x), Y(lm[b].y));
          g.stroke();
        }
        g.lineWidth = 1.5 * dpr;
        g.strokeStyle = "rgba(0, 0, 0, 0.6)";
        for (let i = 0; i < 33; i++) {
          if (!visible(i)) continue;
          g.fillStyle = pointColor(i);
          g.beginPath();
          g.arc(X(lm[i].x), Y(lm[i].y), (i <= 10 ? 3 : 5) * dpr, 0, Math.PI * 2);
          g.fill();
          g.stroke();
        }
        g.globalAlpha = 1;
      }
    }

    function stopCamera() {
      if (!camera) return;
      camera.running = false;
      clearTimeout(camera.skipTimer);
      camera.stream.getTracks().forEach((t) => t.stop());
      camera.video.srcObject = null;
      camera = null;
    }

    function showCameraError(text) {
      stopCamera();
      screen(
        h("h2", { text: "Caméra indisponible" }),
        h("p", { class: "error", role: "alert", text }),
        h(
          "div",
          { class: "actions" },
          h("button", { type: "button", class: "primary", text: "Importer deux photos", onclick: showUpload }),
          h("button", { type: "button", class: "secondary", text: "Réessayer", onclick: startCamera }),
        ),
      );
    }

    function showUpload() {
      stopCamera();
      const files = { front: null, side: null };
      const analyzeBtn = h("button", { type: "button", class: "primary", text: "Analyser", disabled: true });
      const error = h("p", { class: "error", role: "alert", hidden: true });

      function picker(key, label, hint) {
        const preview = h("img", { alt: "", hidden: true });
        const input = h("input", { type: "file", accept: "image/*" });
        input.addEventListener("change", async () => {
          const file = input.files && input.files[0];
          if (!file) return;
          try {
            files[key] = await fileToJpeg(file, PHOTO_SIDE);
            preview.src = files[key];
            preview.hidden = false;
            error.hidden = true;
          } catch (e) {
            files[key] = null;
            preview.hidden = true;
            error.textContent = "Cette image n'a pas pu être lue. Choisissez une photo JPEG, PNG ou WebP.";
            error.hidden = false;
          }
          analyzeBtn.disabled = !files.front;
        });
        return h("label", { class: "drop" }, input, preview, h("strong", { text: label }), h("small", { text: hint }));
      }

      analyzeBtn.addEventListener("click", () => {
        shots = { front: files.front, side: files.side };
        analyze();
      });

      screen(
        h("h2", { text: "Importer deux photos" }),
        h("p", { class: "muted", text: "Debout, de la tête aux pieds, bras un peu écartés, vêtements près du corps. La photo de profil est facultative mais conseillée." }),
        h("div", { class: "drops" }, picker("front", "Photo de face", "obligatoire"), picker("side", "Photo de profil", "conseillée")),
        error,
        h(
          "div",
          { class: "actions" },
          analyzeBtn,
          h("button", { type: "button", class: "secondary", text: "Retour", onclick: () => showIntro() }),
        ),
      );
    }

    async function analyze() {
      screen(
        h("div", { class: "thumbs" }, [shots.front, shots.side].filter(Boolean).map((src) => h("img", { src, alt: "" }))),
        h("div", { class: "spinner", "aria-hidden": "true" }),
        h("p", { class: "center strong", "aria-live": "polite", text: "Analyse de vos mensurations…" }),
      );

      const measured = await callApi("measure", { heightCm: prefs.heightCm, front: shots.front, side: shots.side });
      if (!current) return;
      if (!measured.ok) {
        return showError(errorMessage(measured, "La mesure a échoué."), startCamera, "Reprendre les photos");
      }
      firstResult({
        measure: measured.data,
        photos: { front: shots.front, side: shots.side },
        measurements: Object.assign({}, measured.data.measurements),
      });
    }

    async function recommend(measurements) {
      const res = await callApi("recommend", { body: { measurements, fit: prefs.fit, garment } });
      if (res.ok && res.data && res.data.ok) return { ok: true, data: res.data };
      return { ok: false, message: errorMessage(res, "La recommandation de taille a échoué.") };
    }

    async function firstResult(result) {
      const r = await recommend(result.measurements);
      if (!current) return;
      if (!r.ok) return showError(r.message, () => firstResult(result), "Réessayer");
      showResult(result, r.data);
    }

    function showResult(result, reco) {
      const measure = result.measure;
      const lines = copyLines(measure);
      let latest = reco;
      let seq = 0;
      let timer = 0;

      const sizeEl = h("div", { class: "size" });
      const absentEl = h("p", { class: "warn", text: "Cette taille ne figure pas parmi celles proposées sur la page." });
      const reasonEl = h("p", { class: "reason" });
      const feelsEl = h("ul", { class: "feels" });
      const altsEl = h("p", { class: "muted small" });
      const statusEl = h("p", { class: "status", "aria-live": "polite" });
      const note = h("p", { class: "error", role: "status", hidden: true });
      const garmentEl = h("p", { class: "fineprint" });
      const selectBtn = h("button", {
        type: "button",
        class: "primary",
        onclick: () => {
          if (!latest.pageSize) return close();
          const done = typeof opts.onSelect === "function" && opts.onSelect(latest.pageSize);
          if (done) return close();
          note.textContent = "La taille n'a pas pu être sélectionnée automatiquement : choisissez " + latest.pageSize + " sur la page.";
          note.hidden = false;
        },
      });

      const fits = h(
        "div",
        { class: "segmented", role: "radiogroup", "aria-label": "Coupe préférée" },
        FITS.map(([value, label]) =>
          h(
            "label",
            { class: prefs.fit === value ? "on" : null },
            h("input", {
              type: "radio",
              name: "ss-fit",
              value,
              checked: prefs.fit === value,
              onchange: (e) => {
                prefs.fit = value;
                savePrefs(prefs);
                fits.querySelectorAll("label").forEach((l) => l.classList.toggle("on", l.contains(e.target)));
                schedule(0);
              },
            }),
            label,
          ),
        ),
      );

      const placers = [];
      const zoneEls = { chest: [], waist: [], hips: [], thigh: [], inseam: [] };

      const pct = (v) => v * 100 + "%";
      const color = (el, k) => {
        el.style.setProperty("--c", ZONE_COLORS[k]);
        zoneEls[k].push(el);
        return el;
      };
      const placeH = (el, l) => {
        el.style.left = pct(l.x1);
        el.style.width = pct(l.x2 - l.x1);
        el.style.top = pct(l.y);
      };
      const placeV = (el, l) => {
        el.style.left = pct(l.x);
        el.style.top = pct(l.y1);
        el.style.height = pct(l.y2 - l.y1);
      };
      const placeP = (el, x, y) => {
        el.style.left = pct(x);
        el.style.top = pct(y);
      };

      function handle(frame, axis, k, label, read, write) {
        const el = color(h("button", { type: "button", class: axis === "x" ? "handle hx" : "handle hy", "aria-label": label }), k);
        const moveTo = (v) => {
          write(clamp(v, 0, 1));
          changed();
        };
        el.addEventListener("pointerdown", (e) => {
          e.preventDefault();
          el.setPointerCapture(e.pointerId);
          el.classList.add("drag");
        });
        el.addEventListener("pointermove", (e) => {
          if (!el.hasPointerCapture(e.pointerId)) return;
          const r = frame.getBoundingClientRect();
          moveTo(axis === "x" ? (e.clientX - r.left) / r.width : (e.clientY - r.top) / r.height);
        });
        const release = (e) => {
          if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
          el.classList.remove("drag");
        };
        el.addEventListener("pointerup", release);
        el.addEventListener("pointercancel", release);
        el.addEventListener("keydown", (e) => {
          const keys = axis === "x" ? { ArrowLeft: -1, ArrowRight: 1 } : { ArrowUp: -1, ArrowDown: 1 };
          if (!(e.key in keys)) return;
          e.preventDefault();
          moveTo(read() + keys[e.key] * (e.shiftKey ? 0.02 : 0.004));
        });
        return el;
      }

      function photoEditor(view, src, caption) {
        const frame = h("div", { class: "frame" }, h("img", { src, alt: caption, draggable: "false" }));
        const where = view === "front" ? "photo de face" : "photo de profil";
        for (const k of PHOTO_ZONES) {
          const l = lines[view][k];
          const orig = h("div", { class: "line orig" });
          placeH(orig, measure[view].lines[k]);
          const line = color(h("div", { class: "line" }), k);
          const name = MEASURE_LABELS[k] + ", " + where;
          const left = handle(frame, "x", k, name + " : bord gauche", () => l.x1, (v) => (l.x1 = Math.min(v, l.x2 - MIN_SPAN)));
          const right = handle(frame, "x", k, name + " : bord droit", () => l.x2, (v) => (l.x2 = Math.max(v, l.x1 + MIN_SPAN)));
          zoneEls[k].push(orig);
          frame.append(orig, line, left, right);
          placers.push(() => {
            placeH(line, l);
            placeP(left, l.x1, l.y);
            placeP(right, l.x2, l.y);
          });
        }
        if (view === "front" && lines.inseam) {
          const l = lines.inseam;
          const orig = h("div", { class: "vline orig" });
          placeV(orig, measure.front.inseam);
          const line = color(h("div", { class: "vline" }), "inseam");
          const top = handle(frame, "y", "inseam", "Entrejambe : haut de la ligne", () => l.y1, (v) => (l.y1 = Math.min(v, l.y2 - MIN_SPAN)));
          const bottom = handle(frame, "y", "inseam", "Entrejambe : sol, sous les pieds", () => l.y2, (v) => (l.y2 = Math.max(v, l.y1 + MIN_SPAN)));
          zoneEls.inseam.push(orig);
          frame.append(orig, line, top, bottom);
          placers.push(() => {
            placeV(line, l);
            placeP(top, l.x, l.y1);
            placeP(bottom, l.x, l.y2);
          });
        }
        return h("figure", { class: "photo" }, frame, h("figcaption", { text: view === "front" ? "Face" : "Profil" }));
      }

      const photos = h(
        "div",
        { class: "photos" },
        photoEditor("front", result.photos.front, "Votre photo de face"),
        measure.side && result.photos.side ? photoEditor("side", result.photos.side, "Votre photo de profil") : null,
      );

      const rows = {};
      const values = {};
      const badges = {};
      for (const k of Object.keys(MEASURE_LABELS)) {
        if (typeof measure.measurements[k] !== "number") continue;
        values[k] = h("span", { class: "mvalue" });
        badges[k] = h("span", { class: "badge", hidden: true, text: "corrigé" });
        const swatch = h("span", { class: "swatch" });
        swatch.style.setProperty("--c", ZONE_COLORS[k]);
        rows[k] = h("div", { class: "mrow" }, h("span", { class: "mlabel" }, swatch, MEASURE_LABELS[k], badges[k]), values[k]);
      }
      const resetBtn = h("button", {
        type: "button",
        class: "link small",
        hidden: true,
        text: "Revenir aux lignes d'origine",
        onclick: () => {
          for (const k of PHOTO_ZONES) {
            Object.assign(lines.front[k], measure.front.lines[k]);
            if (lines.side) Object.assign(lines.side[k], measure.side.lines[k]);
          }
          if (lines.inseam) Object.assign(lines.inseam, measure.front.inseam);
          changed();
        },
      });

      function renderMeasures() {
        const adj = adjustFromLines(measure, lines);
        result.measurements = adj.measurements;
        for (const k of Object.keys(values)) {
          values[k].textContent = adj.measurements[k] + " cm";
          badges[k].hidden = !adj.edited[k];
        }
        resetBtn.hidden = !adj.any;
      }

      function changed() {
        for (const place of placers) place();
        renderMeasures();
        schedule();
      }

      function schedule(delay) {
        clearTimeout(timer);
        statusEl.textContent = "Mise à jour de la taille…";
        selectBtn.disabled = true;
        timer = setTimeout(update, delay === undefined ? 350 : delay);
      }

      async function update() {
        const mine = ++seq;
        const r = await recommend(Object.assign({}, result.measurements));
        if (!current || mine !== seq) return;
        selectBtn.disabled = false;
        if (!r.ok) {
          statusEl.textContent = r.message;
          return;
        }
        statusEl.textContent = "";
        latest = r.data;
        render();
      }

      function render() {
        const r = latest;
        sizeEl.textContent = r.size;
        absentEl.hidden = Boolean(r.pageSize);
        reasonEl.textContent = r.reason;
        feelsEl.replaceChildren(
          ...(r.details || []).map((d) => h("li", null, h("span", { text: MEASURE_LABELS[d.key] || d.key }), h("strong", { text: d.feel }))),
        );
        const alts = r.alternatives || [];
        altsEl.textContent = alts.length ? "Autres tailles : " + alts.map((a) => a.size + " (" + a.note + ")").join(" · ") : "";
        altsEl.hidden = !alts.length;
        selectBtn.textContent = r.pageSize ? "Sélectionner la taille " + r.pageSize : "Fermer";
        const used = new Set((r.details || []).map((d) => d.key));
        for (const k of Object.keys(zoneEls)) {
          const off = !used.has(k);
          if (rows[k]) rows[k].classList.toggle("unused", off);
          for (const el of zoneEls[k]) el.classList.toggle("unused", off);
        }
        const g = r.garment || {};
        garmentEl.textContent =
          (g.source === "catalog"
            ? "Guide des tailles du vêtement : " + g.name + "."
            : "Vêtement absent du catalogue SwiftStyle : guide des tailles de démonstration (" + (g.name || "article") + "), choisi d'après le nom du produit.");
      }

      const warnings = measure.warnings || [];
      screen(
        h(
          "div",
          { class: "result-grid" },
          h(
            "section",
            { class: "panel summary" },
            h("p", { class: "eyebrow", text: "Votre taille pour cet article" }),
            sizeEl,
            absentEl,
            reasonEl,
            feelsEl,
            altsEl,
            statusEl,
            note,
            h(
              "div",
              { class: "actions" },
              selectBtn,
              h("button", { type: "button", class: "secondary", text: "Reprendre les photos", onclick: startCamera }),
            ),
          ),
          h(
            "section",
            { class: "panel adjust" },
            h("h3", { text: "Votre coupe préférée" }),
            fits,
            h("h3", { text: "Ajustez les lignes sur vos photos" }),
            h("p", {
              class: "hint",
              text: "Une ligne dépasse du corps (vêtement ample, bras) ? Faites glisser ses extrémités jusqu'aux bords du corps : en largeur pour les tours, en hauteur pour l'entrejambe. Pas besoin de mètre ruban.",
            }),
            photos,
            h("div", { class: "mlist" }, Object.values(rows)),
            h("p", { class: "legend" }, h("span", { text: "En gris : non utilisées pour ce vêtement." }), resetBtn),
            h("p", {
              class: "muted small",
              text: measure.depthSource === "profile" ? "Profondeur du corps lue sur la photo de profil." : "Sans photo de profil, la profondeur du corps est estimée.",
            }),
            warnings.length ? h("ul", { class: "warnings" }, warnings.map((w) => h("li", { text: w }))) : null,
          ),
        ),
        garmentEl,
      );
      dialog.classList.add("result");
      for (const place of placers) place();
      renderMeasures();
      render();
    }

    function showError(text, retry, retryLabel) {
      stopCamera();
      screen(
        h("h2", { text: "Un problème est survenu" }),
        h("p", { class: "error", role: "alert", text }),
        h(
          "div",
          { class: "actions" },
          h("button", { type: "button", class: "primary", text: retryLabel || "Réessayer", onclick: retry }),
          h("button", { type: "button", class: "secondary", text: "Retour", onclick: () => showIntro() }),
        ),
      );
    }

    function close() {
      if (current === null) return;
      stopCamera();
      current = null;
      host.remove();
      document.documentElement.style.overflow = prevOverflow;
      if (prevFocus && typeof prevFocus.focus === "function") prevFocus.focus();
    }
  }

  const CSS = `
:host { all: initial; }
* { box-sizing: border-box; }
[hidden] { display: none !important; }
.backdrop { position: fixed; inset: 0; background: rgba(10, 10, 10, 0.55); backdrop-filter: blur(2px); }
.dialog {
  position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%);
  width: min(460px, calc(100vw - 24px)); max-height: calc(100vh - 24px);
  display: flex; flex-direction: column; overflow: hidden;
  background: #fff; color: #111; border-radius: 10px; box-shadow: 0 24px 60px rgba(0, 0, 0, 0.3);
  font: 15px/1.45 var(--ss-font, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif);
}
.dialog.wide { width: min(980px, calc(100vw - 24px)); }
header { display: flex; align-items: center; gap: 8px; padding: 12px 12px 12px 18px; border-bottom: 1px solid #eee; }
.brand { font-weight: 700; letter-spacing: 0.02em; }
.title { color: #666; flex: 1; }
.body { padding: 18px; overflow-y: auto; }
h2 { margin: 0 0 6px; font-size: 20px; line-height: 1.25; }
p { margin: 0 0 12px; }
button { font: inherit; cursor: pointer; }
button:disabled { cursor: not-allowed; opacity: 0.45; }
button:focus-visible, input:focus-visible, summary:focus-visible { outline: 2px solid #2563eb; outline-offset: 2px; }
.icon { display: inline-flex; align-items: center; justify-content: center; width: 34px; height: 34px; border: 0; border-radius: 6px; background: none; color: #444; }
.icon:hover { background: #f2f2f2; }
.primary { flex: 1; padding: 12px 16px; border: 1px solid #111; border-radius: 6px; background: #111; color: #fff; font-weight: 600; }
.primary:hover:not(:disabled) { background: #333; }
.secondary { flex: 1; padding: 12px 16px; border: 1px solid #ccc; border-radius: 6px; background: #fff; color: #111; font-weight: 600; }
.secondary:hover { border-color: #111; }
.link { border: 0; background: none; color: #444; text-decoration: underline; padding: 6px; }
.actions { display: flex; flex-direction: column; gap: 8px; margin-top: 16px; }
.actions.row { flex-direction: row; justify-content: flex-end; margin-top: 12px; }
.actions.row .secondary { flex: 0 0 auto; }
.center { text-align: center; }
.strong { font-weight: 600; }
.muted { color: #555; }
.small { font-size: 13px; }
.error { color: #b42318; background: #fef3f2; border: 1px solid #fecdca; border-radius: 6px; padding: 10px 12px; }
.warn { color: #93370d; font-size: 14px; }
.field { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin: 14px 0; font-weight: 600; flex-wrap: wrap; }
.unit { display: inline-flex; align-items: center; gap: 6px; font-weight: 400; }
.unit input { width: 90px; padding: 9px 10px; border: 1px solid #ccc; border-radius: 6px; font: inherit; font-size: 16px; text-align: right; }
.segmented { display: inline-flex; border: 1px solid #ccc; border-radius: 6px; overflow: hidden; font-weight: 400; }
.segmented label { padding: 7px 12px; cursor: pointer; border-left: 1px solid #ccc; }
.segmented label:first-child { border-left: 0; }
.segmented label.on { background: #111; color: #fff; }
.segmented input { position: absolute; opacity: 0; pointer-events: none; }
.steps { margin: 6px 0 14px; padding-left: 20px; color: #333; font-size: 14px; }
.steps li { margin: 4px 0; }
.consent { display: flex; gap: 10px; align-items: flex-start; font-size: 13px; color: #444; cursor: pointer; }
.consent input { margin-top: 2px; width: 16px; height: 16px; flex: none; }

.stage { position: relative; height: min(68vh, 640px); background: #000; border-radius: 8px; overflow: hidden; }
.mirror { position: absolute; inset: 0; transform: scaleX(-1); }
video, .overlay { position: absolute; inset: 0; width: 100%; height: 100%; }
video { object-fit: contain; }
.hud-top { position: absolute; top: 12px; left: 12px; right: 12px; display: flex; gap: 8px; }
.chip { display: inline-flex; align-items: center; gap: 6px; padding: 5px 12px 5px 5px; border-radius: 999px; background: rgba(0, 0, 0, 0.55); color: #fff; font-size: 14px; font-weight: 600; }
.chip.active { background: #fff; color: #111; }
.chip.done { background: #16a34a; color: #fff; }
.chip img { width: 26px; height: 26px; object-fit: cover; border-radius: 999px; }
.dot { display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; border-radius: 999px; background: rgba(255, 255, 255, 0.2); font-size: 12px; }
.chip.active .dot { background: #111; color: #fff; }
.chip.done img + .dot { display: none; }
.hud-bottom { position: absolute; left: 0; right: 0; bottom: 0; padding: 40px 20px 18px; background: linear-gradient(transparent, rgba(0, 0, 0, 0.75)); color: #fff; text-align: center; }
.msg { margin: 0; font-size: clamp(20px, 3.2vw, 32px); font-weight: 700; line-height: 1.2; text-shadow: 0 1px 3px rgba(0, 0, 0, 0.6); }
.tip { margin: 8px 0 0; font-size: clamp(15px, 2vw, 20px); color: #fde68a; }
.pose-guide { position: absolute; top: 12px; right: 12px; display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 8px 10px 6px; border-radius: 10px; background: rgba(0, 0, 0, 0.55); color: #fff; font-size: 12px; font-weight: 600; pointer-events: none; }
.pose-svg svg { display: block; height: min(32vh, 210px); width: auto; }
.count {
  --p: 0; position: absolute; left: 50%; top: 42%; transform: translate(-50%, -50%); pointer-events: none;
  width: 136px; height: 136px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
  background: conic-gradient(#22c55e calc(var(--p) * 360deg), rgba(255, 255, 255, 0.3) 0);
}
.count span { width: 116px; height: 116px; border-radius: 50%; background: rgba(0, 0, 0, 0.55); color: #fff; display: flex; align-items: center; justify-content: center; font-size: 68px; font-weight: 800; }
.flash { position: absolute; inset: 0; background: #fff; opacity: 0; pointer-events: none; }
.flash.on { animation: ss-flash 0.45s ease-out; }
@keyframes ss-flash { from { opacity: 0.9; } to { opacity: 0; } }

.drops { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin: 12px 0; }
.drop { position: relative; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; gap: 2px; min-height: 180px; padding: 10px; border: 1px dashed #bbb; border-radius: 8px; cursor: pointer; text-align: center; overflow: hidden; }
.drop:hover { border-color: #111; }
.drop input { position: absolute; inset: 0; opacity: 0; cursor: pointer; }
.drop img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; background: #f6f6f6; }
.drop strong, .drop small { position: relative; background: rgba(255, 255, 255, 0.85); padding: 0 6px; border-radius: 4px; }
.drop small { color: #666; }

.thumbs { display: flex; justify-content: center; gap: 10px; margin: 6px 0 18px; }
.thumbs img { height: 150px; border-radius: 8px; object-fit: cover; }
.spinner { width: 36px; height: 36px; margin: 0 auto 12px; border: 3px solid #e5e5e5; border-top-color: #111; border-radius: 50%; animation: ss-spin 0.8s linear infinite; }
@keyframes ss-spin { to { transform: rotate(360deg); } }

.eyebrow { margin: 0; text-align: center; color: #555; font-size: 14px; }
.size { text-align: center; font-size: 64px; font-weight: 800; line-height: 1.1; margin: 4px 0; }
.reason { text-align: center; }
.feels { list-style: none; margin: 0 0 12px; padding: 0; border-top: 1px solid #eee; }
.feels li { display: flex; justify-content: space-between; padding: 8px 2px; border-bottom: 1px solid #eee; }
.dialog.result { width: min(1100px, calc(100vw - 24px)); }
.result-grid { display: grid; grid-template-columns: minmax(240px, 300px) minmax(0, 1fr); gap: 28px; align-items: start; }
.summary { position: sticky; top: 0; }
.panel h3 { margin: 0 0 8px; font-size: 15px; }
.panel h3 + .segmented { margin-bottom: 18px; }
.adjust { border-left: 1px solid #eee; padding-left: 24px; }
.status { min-height: 18px; margin: 4px 0 0; font-size: 13px; color: #555; text-align: center; }
.hint { margin: 0 0 10px; font-size: 13px; color: #555; }
.photos { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); justify-items: center; gap: 14px; margin-bottom: 10px; }
.photo { margin: 0; text-align: center; max-width: 100%; min-width: 0; }
.photo figcaption { margin-top: 4px; font-size: 12px; color: #555; }
.frame { position: relative; display: inline-block; max-width: 100%; line-height: 0; touch-action: none; user-select: none; -webkit-user-select: none; }
.frame img { display: block; max-width: 100%; max-height: min(52vh, 440px); border-radius: 6px; -webkit-user-drag: none; pointer-events: none; }
.line { position: absolute; height: 0; border-top: 3px solid var(--c); margin-top: -1.5px; box-shadow: 0 1px 2px rgba(0, 0, 0, 0.45); pointer-events: none; }
.vline { position: absolute; width: 0; border-left: 3px solid var(--c); margin-left: -1.5px; box-shadow: 1px 0 2px rgba(0, 0, 0, 0.45); pointer-events: none; }
.line.orig, .vline.orig { border-color: rgba(255, 255, 255, 0.95); border-style: dashed; border-width: 2px 0 0 0; box-shadow: none; filter: drop-shadow(0 0 1px rgba(0, 0, 0, 0.9)); }
.vline.orig { border-width: 0 0 0 2px; }
.handle { position: absolute; width: 28px; height: 28px; margin: -14px 0 0 -14px; padding: 0; border: 0; background: transparent; touch-action: none; z-index: 1; }
.handle::after { content: ""; position: absolute; inset: 7px; border-radius: 50%; background: var(--c); border: 2px solid #fff; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.55); }
.handle.hx { cursor: ew-resize; }
.handle.hy { cursor: ns-resize; }
.handle.drag::after, .handle:hover::after, .handle:focus-visible::after { inset: 4px; }
.handle:focus-visible { outline: none; }
.frame .unused { opacity: 0.3; }
.mlist { margin-top: 4px; }
.mrow { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 6px 0; border-bottom: 1px solid #eee; }
.mrow.unused { color: #9a9a9a; }
.mlabel { display: inline-flex; align-items: center; gap: 8px; }
.swatch { width: 10px; height: 10px; border-radius: 50%; background: var(--c); }
.mvalue { font-weight: 700; }
.mrow.unused .mvalue { font-weight: 400; }
.badge { font-size: 11px; font-weight: 700; color: #b54708; background: #fffaeb; border: 1px solid #fedf89; border-radius: 999px; padding: 1px 7px; }
.legend { display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap; margin: 8px 0; font-size: 12px; color: #777; }
.link.small { font-size: 13px; padding: 0; }
@media (max-width: 760px) {
  .result-grid { grid-template-columns: 1fr; }
  .summary { position: static; }
  .adjust { border-left: 0; padding-left: 0; border-top: 1px solid #eee; padding-top: 16px; }
}
.warnings { margin: 8px 0; padding: 10px 12px 10px 28px; background: #fffaeb; border: 1px solid #fedf89; border-radius: 6px; color: #93370d; font-size: 13px; }
.fineprint { margin-top: 14px; font-size: 12px; color: #777; text-align: center; }

@media (max-width: 560px) {
  .dialog, .dialog.wide { left: 0; top: 0; transform: none; width: 100vw; height: 100vh; max-height: none; border-radius: 0; }
  .body { flex: 1; }
  .stage { height: calc(100vh - 170px); }
}
@media (prefers-reduced-motion: reduce) {
  .flash.on, .spinner { animation: none; }
}
`;

  globalThis.SwiftStyleModal = { open };
})();

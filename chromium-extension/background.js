const CONFIG = {
  appUrl: "https://swiftstyle.jesololido2004.workers.dev",
  photoApiUrl: "http://localhost:8000",
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.source !== "swiftstyle" || sender.id !== chrome.runtime.id) return false;
  handle(msg).then(sendResponse, (err) => sendResponse(unreachable(String(err && err.message ? err.message : err))));
  return true;
});

async function handle(msg) {
  switch (msg.type) {
    case "pose": {
      const body = new FormData();
      body.append("frame", await toBlob(msg.frame), "image.jpg");
      body.append("expect", msg.expect === "side" ? "side" : "front");
      return send(CONFIG.photoApiUrl + "/v1/photo/pose", { method: "POST", body }, "API photo");
    }
    case "measure": {
      const body = new FormData();
      body.append("heightCm", String(msg.heightCm));
      body.append("front", await toBlob(msg.front), "face.jpg");
      if (msg.side) body.append("side", await toBlob(msg.side), "profil.jpg");
      return send(CONFIG.photoApiUrl + "/v1/photo/measure", { method: "POST", body }, "API photo");
    }
    case "recommend":
      return send(
        CONFIG.appUrl + "/api/v1/recommend",
        { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(msg.body) },
        "site SwiftStyle",
      );
    default:
      return { ok: false, status: 0, data: { error: "unknown_message", message: "Demande inconnue : " + msg.type } };
  }
}

async function send(url, init, label) {
  let res;
  try {
    res = await fetch(url, init);
  } catch (err) {
    return unreachable(`Le service SwiftStyle est injoignable (${label} : ${new URL(url).origin}). Est-il lancé ?`);
  }
  const data = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, data };
}

function unreachable(message) {
  return { ok: false, status: 0, data: { error: "unreachable", message } };
}

async function toBlob(dataUrl) {
  if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/")) throw new Error("image invalide");
  return (await fetch(dataUrl)).blob();
}

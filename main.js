const statusIconWrapper = document.getElementById("statusIconWrapper");
const statusIcon = document.getElementById("statusIcon");
const statusLabel = document.getElementById("statusLabel");
const statusText = document.getElementById("statusText");
const lastCheckedText = document.getElementById("lastCheckedText");
const refreshButton = document.getElementById("refreshButton");

const TARGET_URL = "https://www.waifu2x.net/index.html";
const PROXY_PREFIX = "https://api.allorigins.win/raw?url=";
const WAIFU_URL = PROXY_PREFIX + TARGET_URL;

// webhook parts concatenated to reduce simple scraping
const WEBHOOK_PART1 = "https://discord.com/api/webhooks/1447052066479407164/";
const WEBHOOK_PART2 = "SpC1MECoLsQvsjC8rviwF3vURG40gR1lgNz0oZ5osWw0Yq8-Rs0zb8CCNSc0tb2IUiTF";
const DISCORD_WEBHOOK = WEBHOOK_PART1 + WEBHOOK_PART2;

// how often to auto check in milliseconds
const CHECK_INTERVAL_MS = 60 * 1000;

function setCheckingState() {
  statusIconWrapper.className =
    "h-9 w-9 rounded-full flex items-center justify-center bg-neutral-800 text-neutral-300";
  statusIcon.className = "fa-solid fa-circle-notch fa-spin text-sm";

  statusLabel.textContent = "checking";
  statusText.textContent = "waiting for response from waifu2x";
}

function setUpState() {
  statusIconWrapper.className =
    "h-9 w-9 rounded-full flex items-center justify-center bg-emerald-500/10 text-emerald-300";
  statusIcon.className = "fa-solid fa-circle-check text-sm";

  statusLabel.textContent = "online";
  statusText.textContent = "title does not say waifu2x is down";
}

function setDownState() {
  statusIconWrapper.className =
    "h-9 w-9 rounded-full flex items-center justify-center bg-rose-500/10 text-rose-300";
  statusIcon.className = "fa-solid fa-circle-xmark text-sm";

  statusLabel.textContent = "likely down";
  statusText.textContent = "title says waifu2x is down";
}

function setUnknownState(message) {
  statusIconWrapper.className =
    "h-9 w-9 rounded-full flex items-center justify-center bg-amber-500/10 text-amber-300";
  statusIcon.className = "fa-solid fa-circle-question text-sm";

  statusLabel.textContent = "unknown";
  statusText.textContent = message;
}

function updateLastChecked() {
  const now = new Date();
  const time = now.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
  lastCheckedText.textContent = "last check " + time;
}

async function checkStatus() {
  setCheckingState();
  refreshButton.disabled = true;
  refreshButton.classList.add("opacity-60", "cursor-not-allowed");

  try {
    const response = await fetch(WAIFU_URL, {
      method: "GET",
      cache: "no-store"
    });

    if (!response.ok) {
      await handleStateChange("unknown", "could not load page from waifu2x");
      return;
    }

    const html = await response.text();

    // detect proxy or CORS error pages or generic error responses
    const lower = html.toLowerCase();
    const looksLikeProxyError =
      lower.includes("allorigins") ||
      lower.includes("error") ||
      lower.includes("not found") ||
      lower.includes("blocked by") ||
      lower.includes("cors") ||
      lower.includes("access denied") ||
      lower.includes("forbidden");

    // attempt to parse title
    const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim().toLowerCase() : "";

    // if the response looks like an error or title is missing treat as unknown
    if (looksLikeProxyError || title === "") {
      await handleStateChange("unknown", "response appears to be an error or blocked");
      return;
    }

    if (title.includes("waifu2x is down")) {
      await handleStateChange("down");
    } else {
      await handleStateChange("up");
    }
  } catch (err) {
    // network or CORS failure
    await handleStateChange("unknown", "browser blocked direct check from this site");
  } finally {
    updateLastChecked();
    refreshButton.disabled = false;
    refreshButton.classList.remove("opacity-60", "cursor-not-allowed");
  }
}

// keep last known state so we only notify on changes
let lastState = null;

async function sendDiscordEmbed(state) {
  if (!DISCORD_WEBHOOK) return;
  const embed = {
    title: state === "down" ? "waifu2x is down" : "waifu2x is operational",
    description: state === "down" ? "The main site title contains waifu2x is down" : "Site title does not indicate downtime",
    color: state === "down" ? 15158332 : 3066993,
    timestamp: new Date().toISOString(),
    footer: { text: "waifu2x status monitor" }
  };

  // try a couple times then fallback to a no-cors attempt
  const payload = JSON.stringify({ embeds: [embed] });
  const attempts = [
    // normal request
    { opts: { method: "POST", headers: { "Content-Type": "application/json" }, body: payload } },
    // retry normal with keepalive
    { opts: { method: "POST", headers: { "Content-Type": "application/json" }, body: payload, keepalive: true } },
    // last resort try no-cors opaque request which may still reach the webhook
    { opts: { method: "POST", body: payload, mode: "no-cors" } }
  ];

  for (let i = 0; i < attempts.length; i++) {
    try {
      await fetch(DISCORD_WEBHOOK, attempts[i].opts);
      // do not await response for no-cors opaque, assume success if no exception
      return;
    } catch (e) {
      // small delay before next attempt
      await new Promise(r => setTimeout(r, 500 * (i + 1)));
    }
  }
  console.warn("discord webhook send failed after retries");
}

// wrapper to handle state change actions
async function handleStateChange(state, message) {
  if (state === "up") {
    setUpState();
    document.title = "waifu2x is operational";
  } else if (state === "down") {
    setDownState();
    document.title = "waifu2x is down";
  } else {
    setUnknownState(message);
    document.title = "waifu2x status unknown";
  }

  // always attempt to notify webhook each check to improve delivery consistency
  if (state === "down") {
    sendDiscordEmbed("down");
  } else if (state === "up") {
    sendDiscordEmbed("up");
  } else {
    // still try to notify unknowns
    sendDiscordEmbed("unknown");
  }

  // keep lastState for potential UI logic but do not gate notifications
  lastState = state;
}

// adjust checkStatus to use handleStateChange
async function checkStatus() {
  setCheckingState();
  refreshButton.disabled = true;
  refreshButton.classList.add("opacity-60", "cursor-not-allowed");

  try {
    const response = await fetch(WAIFU_URL, {
      method: "GET",
      cache: "no-store"
    });

    if (!response.ok) {
      await handleStateChange("unknown", "could not load page from waifu2x");
      return;
    }

    const html = await response.text();

    // detect proxy or CORS error pages or generic error responses
    const lower = html.toLowerCase();
    const looksLikeProxyError =
      lower.includes("allorigins") ||
      lower.includes("error") ||
      lower.includes("not found") ||
      lower.includes("blocked by") ||
      lower.includes("cors") ||
      lower.includes("access denied") ||
      lower.includes("forbidden");

    // attempt to parse title
    const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim().toLowerCase() : "";

    // if the response looks like an error or title is missing treat as unknown
    if (looksLikeProxyError || title === "") {
      await handleStateChange("unknown", "response appears to be an error or blocked");
      return;
    }

    if (title.includes("waifu2x is down")) {
      await handleStateChange("down");
    } else {
      await handleStateChange("up");
    }
  } catch (err) {
    // network or CORS failure
    await handleStateChange("unknown", "browser blocked direct check from this site");
  } finally {
    updateLastChecked();
    refreshButton.disabled = false;
    refreshButton.classList.remove("opacity-60", "cursor-not-allowed");
  }
}

refreshButton.addEventListener("click", () => {
  checkStatus();
});

window.addEventListener("load", () => {
  checkStatus();
  // start automatic periodic checks
  setInterval(() => {
    checkStatus();
  }, CHECK_INTERVAL_MS);
});

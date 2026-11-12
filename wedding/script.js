// Mobile menu
const toggle = document.querySelector(".nav__toggle");
const menu = document.getElementById("menu");
toggle.addEventListener("click", () => {
  const open = menu.classList.toggle("is-open");
  toggle.setAttribute("aria-expanded", String(open));
});
menu.addEventListener("click", (e) => {
  if (e.target.closest("a")) {
    menu.classList.remove("is-open");
    toggle.setAttribute("aria-expanded", "false");
  }
});

// Countdown (whole days until the date in data-date)
const countdown = document.getElementById("countdown");
if (countdown) {
  const target = new Date(countdown.dataset.date);
  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const days = Math.round((startOfDay(target) - startOfDay(new Date())) / 86400000);
  if (days > 1) countdown.textContent = `${days} days to go`;
  else if (days === 1) countdown.textContent = "Tomorrow";
  else if (days === 0) countdown.textContent = "Today";
  else countdown.textContent = "Married";
}

// RSVP form
const form = document.getElementById("rsvp-form");
const statusEl = document.getElementById("rsvp-status");
const attendingOnly = form.querySelectorAll("[data-if-attending]");

function syncAttending() {
  const declined = form.elements.attending.value === "no";
  attendingOnly.forEach((el) => {
    el.hidden = declined;
    el.querySelectorAll("input, select").forEach((c) => (c.disabled = declined));
  });
}
form.addEventListener("change", syncAttending);

// Until an endpoint is set, show "coming soon" rather than a form that can't send.
if (!form.dataset.endpoint) {
  form.hidden = true;
  document.getElementById("rsvp-soon").hidden = false;
}

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("is-error", isError);
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  let firstInvalid = null;
  for (const el of form.querySelectorAll("[required]")) {
    const ok = el.checkValidity();
    el.setAttribute("aria-invalid", String(!ok));
    if (!ok && !firstInvalid) firstInvalid = el;
  }
  if (firstInvalid) {
    setStatus("Please fill in your name, email and whether you can attend.", true);
    firstInvalid.focus();
    return;
  }

  const data = Object.fromEntries(new FormData(form));
  if (data.company) return; // honeypot tripped
  delete data.company;

  const endpoint = form.dataset.endpoint;
  if (!endpoint) {
    setStatus("The RSVP form isn't connected yet. Please check back soon.", true);
    return;
  }

  const button = form.querySelector("button[type=submit]");
  button.disabled = true;
  setStatus("Sending…");
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    form.reset();
    syncAttending();
    setStatus(data.attending === "yes" ? "Thank you. We'll see you there." : "Thank you for letting us know. You'll be missed.");
  } catch {
    setStatus("Something went wrong sending your reply. Please try again, or email us.", true);
  } finally {
    button.disabled = false;
  }
});

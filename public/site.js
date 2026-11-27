const statusNames = {
  operational: "Operational",
  degraded: "Degraded performance",
  maintenance: "Maintenance",
  offline: "Offline",
};

const categoryNames = {
  development: "Development",
  maintenance: "Maintenance",
  release: "Release",
};

const statusBadge = document.querySelector("#status-badge");
const statusLabel = document.querySelector("#status-label");
const statusMessage = document.querySelector("#status-message");
const statusUpdated = document.querySelector("#status-updated");
const updatesList = document.querySelector("#updates-list");
const updateCount = document.querySelector("#update-count");

function formatDate(value) {
  const date = new Date(`${value.replace(" ", "T")}Z`);
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function renderUpdate(update) {
  const article = document.createElement("article");
  article.className = "update-card";

  const header = document.createElement("div");
  header.className = "update-card-header";

  const title = document.createElement("h3");
  title.textContent = update.title;

  const category = document.createElement("span");
  category.className = "update-category";
  category.textContent = categoryNames[update.category] ?? "Update";

  const content = document.createElement("p");
  content.className = "update-body";
  content.textContent = update.content;

  const date = document.createElement("p");
  date.className = "update-date";
  date.textContent = `Posted ${formatDate(update.created_at)}`;

  header.append(title, category);
  article.append(header, content, date);
  return article;
}

function renderUpdates(updates) {
  updatesList.replaceChildren();
  updateCount.textContent = `${updates.length} ${updates.length === 1 ? "update" : "updates"}`;
  if (updates.length === 0) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "No development updates have been posted yet.";
    updatesList.append(empty);
    return;
  }
  updates.forEach((update) => updatesList.append(renderUpdate(update)));
}

async function refreshStatus() {
  try {
    const response = await fetch("/api/status", { cache: "no-store" });
    if (!response.ok) throw new Error("Status is temporarily unavailable.");
    const data = await response.json();

    const status = statusNames[data.status.status] ? data.status.status : "offline";
    statusBadge.dataset.status = status;
    statusLabel.textContent = statusNames[status];
    statusMessage.textContent = data.status.message || "No status message has been posted.";
    statusUpdated.textContent = `Last updated ${formatDate(data.status.updated_at)}`;
    renderUpdates(data.updates);
  } catch {
    statusBadge.dataset.status = "offline";
    statusLabel.textContent = "Unavailable";
    statusMessage.textContent = "The status page could not reach the bot server. Please try again shortly.";
    statusUpdated.textContent = "";
    updateCount.textContent = "";
    const error = document.createElement("p");
    error.className = "muted";
    error.textContent = "Development updates could not be loaded.";
    updatesList.replaceChildren(error);
  }
}

refreshStatus();
window.setInterval(refreshStatus, 60_000);

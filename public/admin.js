const notice = document.querySelector("#notice");
const loginPanel = document.querySelector("#login-panel");
const loginForm = document.querySelector("#login-form");
const editor = document.querySelector("#editor");
const statusForm = document.querySelector("#status-form");
const statusSelect = document.querySelector("#status-select");
const statusMessageInput = document.querySelector("#status-message-input");
const updateForm = document.querySelector("#update-form");
const updateIdInput = document.querySelector("#update-id");
const updateCategory = document.querySelector("#update-category");
const updateTitle = document.querySelector("#update-title");
const updateContent = document.querySelector("#update-content");
const saveUpdateButton = document.querySelector("#save-update-button");
const cancelEditButton = document.querySelector("#cancel-edit-button");
const adminUpdatesList = document.querySelector("#admin-updates-list");

const categoryNames = {
  development: "Development",
  maintenance: "Maintenance",
  release: "Release",
};

function showNotice(message, kind = "success") {
  notice.textContent = message;
  notice.dataset.kind = kind;
}

function formatDate(value) {
  const date = new Date(`${value.replace(" ", "T")}Z`);
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

async function requestJson(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    ...options,
  });
  let data;
  try {
    data = await response.json();
  } catch {
    data = {};
  }
  if (!response.ok) throw new Error(data.error || "The request could not be completed.");
  return data;
}

function jsonOptions(method, body) {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

function showEditor() {
  loginPanel.hidden = true;
  editor.hidden = false;
}

function showLogin() {
  editor.hidden = true;
  loginPanel.hidden = false;
}

function renderAdminUpdate(update) {
  const article = document.createElement("article");
  article.className = "update-card admin-update-card";

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
  date.textContent = `Posted ${formatDate(update.created_at)}${update.updated_at !== update.created_at ? ` · Edited ${formatDate(update.updated_at)}` : ""}`;

  const actions = document.createElement("div");
  actions.className = "admin-card-actions";

  const editButton = document.createElement("button");
  editButton.className = "button button-quiet";
  editButton.type = "button";
  editButton.textContent = "Edit";
  editButton.addEventListener("click", () => beginEdit(update));

  const deleteButton = document.createElement("button");
  deleteButton.className = "button button-quiet";
  deleteButton.type = "button";
  deleteButton.textContent = "Delete";
  deleteButton.addEventListener("click", () => deleteUpdate(update));

  header.append(title, category);
  actions.append(editButton, deleteButton);
  article.append(header, content, date, actions);
  return article;
}

function renderAdminUpdates(updates) {
  adminUpdatesList.replaceChildren();
  if (updates.length === 0) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "No development updates have been posted yet.";
    adminUpdatesList.append(empty);
    return;
  }
  updates.forEach((update) => adminUpdatesList.append(renderAdminUpdate(update)));
}

async function refreshEditor() {
  const data = await requestJson("/api/status", { cache: "no-store" });
  statusSelect.value = data.status.status;
  statusMessageInput.value = data.status.message;
  renderAdminUpdates(data.updates);
}

function resetUpdateForm() {
  updateForm.reset();
  updateIdInput.value = "";
  updateCategory.value = "development";
  saveUpdateButton.textContent = "Publish update";
  cancelEditButton.hidden = true;
}

function beginEdit(update) {
  updateIdInput.value = String(update.id);
  updateCategory.value = update.category;
  updateTitle.value = update.title;
  updateContent.value = update.content;
  saveUpdateButton.textContent = "Save changes";
  cancelEditButton.hidden = false;
  updateForm.scrollIntoView({ behavior: "smooth", block: "center" });
  updateTitle.focus();
}

async function deleteUpdate(update) {
  if (!window.confirm(`Delete "${update.title}"? This cannot be undone.`)) return;
  try {
    await requestJson(`/api/admin/updates/${update.id}`, { method: "DELETE" });
    showNotice("Development update deleted.");
    await refreshEditor();
  } catch (error) {
    showNotice(error.message, "error");
  }
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submitButton = loginForm.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  try {
    await requestJson("/api/admin/login", jsonOptions("POST", {
      password: document.querySelector("#login-password").value,
    }));
    loginForm.reset();
    showEditor();
    await refreshEditor();
    showNotice("Signed in. Changes are saved to the bot database.");
  } catch (error) {
    showNotice(error.message, "error");
  } finally {
    submitButton.disabled = false;
  }
});

statusForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submitButton = statusForm.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  try {
    await requestJson("/api/admin/status", jsonOptions("PUT", {
      status: statusSelect.value,
      message: statusMessageInput.value,
    }));
    showNotice("Status saved and published.");
    await refreshEditor();
  } catch (error) {
    showNotice(error.message, "error");
  } finally {
    submitButton.disabled = false;
  }
});

updateForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const updateId = updateIdInput.value;
  const path = updateId ? `/api/admin/updates/${updateId}` : "/api/admin/updates";
  const method = updateId ? "PUT" : "POST";
  const submitButton = updateForm.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  try {
    await requestJson(path, jsonOptions(method, {
      title: updateTitle.value,
      content: updateContent.value,
      category: updateCategory.value,
    }));
    showNotice(updateId ? "Development update saved." : "Development update published.");
    resetUpdateForm();
    await refreshEditor();
  } catch (error) {
    showNotice(error.message, "error");
  } finally {
    submitButton.disabled = false;
  }
});

cancelEditButton.addEventListener("click", resetUpdateForm);

document.querySelector("#logout-button").addEventListener("click", async () => {
  try {
    await requestJson("/api/admin/logout", jsonOptions("POST", {}));
    showLogin();
    showNotice("Signed out.");
  } catch (error) {
    showNotice(error.message, "error");
  }
});

async function initializeEditor() {
  try {
    const session = await requestJson("/api/admin/session", { cache: "no-store" });
    if (!session.authenticated) return;
    showEditor();
    await refreshEditor();
  } catch (error) {
    showNotice(error.message, "error");
  }
}

initializeEditor();

import { demoEvents, type EventListing } from "./events";
import "./style.css";

const config = {
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL?.replace(/\/+$/, ""),
  anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY,
};

const eventGrid = document.querySelector<HTMLDivElement>("#event-grid");
const eventStatus = document.querySelector<HTMLParagraphElement>("#events-status");
const demoNotice = document.querySelector<HTMLParagraphElement>("#demo-notice");
const dialog = document.querySelector<HTMLDialogElement>("#signup-dialog");
const form = document.querySelector<HTMLFormElement>("#guest-list-form");
const guestRows = document.querySelector<HTMLDivElement>("#guest-rows");
const dialogEvent = document.querySelector<HTMLParagraphElement>("#dialog-event");
const formStatus = document.querySelector<HTMLParagraphElement>("#form-status");
const submitButton = document.querySelector<HTMLButtonElement>("#submit-button");
const addGuestButton = document.querySelector<HTMLButtonElement>("#add-guest");
const success = document.querySelector<HTMLElement>("#signup-success");
const successImage = document.querySelector<HTMLImageElement>("#success-image");
const successEvent = document.querySelector<HTMLElement>("#success-event");
const successNames = document.querySelector<HTMLElement>("#success-names");
const successMessage = document.querySelector<HTMLElement>("#success-message");
const emailInput = document.querySelector<HTMLInputElement>("#email");

if (
  !eventGrid ||
  !eventStatus ||
  !demoNotice ||
  !dialog ||
  !form ||
  !guestRows ||
  !dialogEvent ||
  !formStatus ||
  !submitButton ||
  !addGuestButton || !success || !successImage || !successEvent || !successNames || !successMessage || !emailInput
) {
  throw new Error("A estrutura da página StartFest está incompleta.");
}

const ticketTypes = [
  { value: "man", label: "Homem" },
  { value: "woman", label: "Mulher" },
  { value: "couple", label: "Casal" },
] as const;

let selectedEvent: EventListing | null = null;
let requestId = "";
let requestFingerprint = "";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatEventDate(value: string): string {
  const date = new Date(value);
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
    timeZone: "America/Sao_Paulo",
  })
    .format(date)
    .replace(".", "")
    .toUpperCase();
}

function formatEventTime(value: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  }).format(new Date(value));
}

function createTextElement<K extends keyof HTMLElementTagNameMap>(
  tagName: K,
  className: string,
  text: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tagName);
  element.className = className;
  element.textContent = text;
  return element;
}

function createEventCard(event: EventListing, index: number): HTMLElement {
  const card = document.createElement("article");
  card.className = `event-card event-card--${(index % 3) + 1}`;

  const poster = document.createElement("div");
  poster.className = "event-poster";
  const renderFallbackPoster = () => {
    poster.classList.remove("event-poster--image");
    poster.setAttribute("aria-label", `Arte abstrata para ${event.title}`);
    poster.setAttribute("role", "img");
    poster.replaceChildren(
      createTextElement("span", "poster-kicker", event.category.toUpperCase()),
      createTextElement("span", "poster-title", event.title),
      createTextElement("span", "poster-brand", "STARTFEST ✳"),
    );
    poster.append(createTextElement("span", "poster-date", formatEventDate(event.startsAt)));
  };
  if (event.imageUrl) {
    const image = document.createElement("img");
    image.className = "event-poster-image";
    image.alt = `Cartaz de ${event.title}`;
    image.loading = "lazy";
    image.addEventListener("error", renderFallbackPoster, { once: true });
    image.src = event.imageUrl.startsWith("https://")
      ? event.imageUrl
      : `${import.meta.env.BASE_URL}${event.imageUrl.replace(/^\/+/, "")}`;
    poster.classList.add("event-poster--image");
    poster.append(image);
  } else {
    renderFallbackPoster();
  }

  const details = document.createElement("div");
  details.className = "event-details";
  const meta = document.createElement("div");
  meta.className = "event-meta";
  meta.append(
    createTextElement("span", "event-category", event.category),
    createTextElement("span", "event-time", `${formatEventDate(event.startsAt)} · ${formatEventTime(event.startsAt)}`),
  );
  const title = createTextElement("h3", "event-title", event.title);
  const location = createTextElement("p", "event-location", [event.venue, event.neighborhood].filter(Boolean).join(" · "));
  const description = createTextElement("p", "event-description", event.description);
  const action = document.createElement("button");
  action.className = "event-action";
  action.type = "button";
  action.setAttribute("aria-label", `Entrar na lista para ${event.title}`);
  action.append(
    document.createTextNode("Entrar na lista"),
    createTextElement("span", "event-action-arrow", "↗"),
  );
  action.addEventListener("click", () => openSignupDialog(event));
  details.append(meta, title, location, description, action);
  card.append(poster, details);
  return card;
}

function renderEvents(events: EventListing[]): void {
  if (!eventGrid || !eventStatus) return;
  eventGrid.replaceChildren();

  if (events.length === 0) {
    eventStatus.textContent = "Ainda não há eventos publicados. Volte em breve.";
    return;
  }

  eventStatus.textContent = "";
  eventGrid.append(...events.map(createEventCard));
}

function createGuestRow(index: number): HTMLDivElement {
  const row = document.createElement("div");
  row.className = "guest-row";
  row.dataset.guestRow = "true";

  const nameLabel = document.createElement("label");
  nameLabel.className = "guest-name-field";
  nameLabel.append(document.createTextNode(`Nome da pessoa ${index + 1}`));
  const nameInput = document.createElement("input");
  nameInput.name = "guestName";
  nameInput.type = "text";
  nameInput.required = true;
  nameInput.minLength = 2;
  nameInput.maxLength = 80;
  nameInput.autocomplete = "name";
  nameInput.placeholder = "Nome completo";
  nameLabel.append(nameInput);

  const typeLabel = document.createElement("label");
  typeLabel.className = "guest-type-field";
  typeLabel.append(document.createTextNode("Entrada"));
  const typeSelect = document.createElement("select");
  typeSelect.name = "ticketType";
  typeSelect.required = true;
  for (const ticketType of ticketTypes) {
    const option = document.createElement("option");
    option.value = ticketType.value;
    option.textContent = ticketType.label;
    typeSelect.append(option);
  }
  typeLabel.append(typeSelect);

  const removeButton = document.createElement("button");
  removeButton.className = "remove-guest-button";
  removeButton.type = "button";
  removeButton.textContent = "×";
  removeButton.setAttribute("aria-label", `Remover pessoa ${index + 1}`);
  removeButton.addEventListener("click", () => {
    row.remove();
    updateGuestRowLabels();
  });

  row.append(nameLabel, typeLabel, removeButton);
  return row;
}

function updateGuestRowLabels(): void {
  if (!guestRows || !addGuestButton) return;
  const rows = [...guestRows.querySelectorAll<HTMLDivElement>("[data-guest-row]")];
  rows.forEach((row, index) => {
    const nameLabel = row.querySelector<HTMLLabelElement>(".guest-name-field");
    const nameInput = row.querySelector<HTMLInputElement>('input[name="guestName"]');
    const removeButton = row.querySelector<HTMLButtonElement>(".remove-guest-button");
    if (nameLabel && nameInput && removeButton) {
      const labelText = nameLabel.firstChild;
      if (labelText) labelText.textContent = `Nome da pessoa ${index + 1}`;
      nameInput.setAttribute("aria-label", `Nome da pessoa ${index + 1}`);
      removeButton.setAttribute("aria-label", `Remover pessoa ${index + 1}`);
      removeButton.disabled = rows.length === 1;
    }
  });
  addGuestButton.disabled = rows.length >= 10;
}

function openSignupDialog(event: EventListing): void {
  if (!dialog || !form || !guestRows || !dialogEvent || !formStatus || !submitButton) return;
  selectedEvent = event;
  form.reset();
  form.hidden = false;
  if (success) success.hidden = true;
  requestId = "";
  requestFingerprint = "";
  guestRows.replaceChildren(createGuestRow(0));
  updateGuestRowLabels();
  dialogEvent.textContent = `${event.title} · ${formatEventDate(event.startsAt)} às ${formatEventTime(event.startsAt)} · ${event.venue}`;
  formStatus.textContent = "";
  submitButton.disabled = !config.supabaseUrl || !config.anonKey;
  if (submitButton.disabled) {
    formStatus.textContent = "As inscrições online serão abertas em breve.";
  }
  dialog.showModal();
  emailInput?.focus();
}

async function loadEvents(): Promise<void> {
  if (!eventGrid || !eventStatus || !demoNotice) return;
  if (!config.supabaseUrl || !config.anonKey) {
    demoNotice.hidden = false;
    renderEvents(demoEvents.filter((event) => new Date(event.startsAt).getTime() > Date.now()));
    return;
  }

  eventStatus.textContent = "Carregando eventos...";
  try {
    const query = new URLSearchParams({
      select: "id,slug,title,venue,neighborhood,starts_at,ends_at,description,category,image_url",
      status: "eq.published",
      starts_at: `gt.${new Date().toISOString()}`,
      order: "starts_at.asc",
    });
    const response = await fetch(`${config.supabaseUrl}/rest/v1/events?${query}`, {
      headers: {
        apikey: config.anonKey,
        Authorization: `Bearer ${config.anonKey}`,
      },
    });
    if (!response.ok) {
      throw new Error(`O Supabase respondeu com status ${response.status}.`);
    }

    const data: unknown = await response.json();
    if (!Array.isArray(data)) {
      throw new Error("O Supabase retornou uma programação inválida.");
    }
    const events = data.map((item): EventListing => {
      if (
        !isRecord(item) ||
        typeof item.id !== "string" ||
        typeof item.slug !== "string" ||
        typeof item.title !== "string" ||
        typeof item.venue !== "string" ||
        (item.neighborhood !== null && typeof item.neighborhood !== "string") ||
        typeof item.starts_at !== "string" ||
        typeof item.description !== "string" ||
        typeof item.category !== "string"
      ) {
        throw new Error("O Supabase retornou um evento incompleto.");
      }
      return {
        id: item.id,
        slug: item.slug,
        title: item.title,
        venue: item.venue,
        neighborhood: item.neighborhood,
        startsAt: item.starts_at,
        endsAt: typeof item.ends_at === "string" ? item.ends_at : null,
        description: item.description,
        category: item.category,
        imageUrl: typeof item.image_url === "string" ? item.image_url : null,
      };
    });
    renderEvents(events);
  } catch (error) {
    console.error("Não foi possível carregar a programação.", error);
    eventGrid.replaceChildren();
    eventStatus.textContent = "Não foi possível carregar os eventos agora. Tente novamente mais tarde.";
  }
}

async function submitGuestList(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  if (!form || !guestRows || !formStatus || !submitButton || !selectedEvent ||
      !emailInput || !success || !successEvent || !successNames || !successImage || !successMessage) return;
  if (!form.reportValidity()) return;

  const formData = new FormData(form);
  const guests = [...guestRows.querySelectorAll<HTMLDivElement>("[data-guest-row]")].map((row) => ({
    name: row.querySelector<HTMLInputElement>('input[name="guestName"]')?.value.trim() ?? "",
    ticketType: row.querySelector<HTMLSelectElement>('select[name="ticketType"]')?.value ?? "",
  }));
  const website = String(formData.get("website") ?? "");
  const email = String(formData.get("email") ?? "").trim().toLowerCase();

  if (!config.supabaseUrl || !config.anonKey) {
    formStatus.textContent = "As inscrições online serão abertas em breve.";
    return;
  }

  submitButton.disabled = true;
  formStatus.textContent = "Enviando sua lista...";
  const fingerprint = JSON.stringify({ eventId: selectedEvent.id, email, guests });
  if (requestFingerprint !== fingerprint) {
    requestFingerprint = fingerprint;
    requestId = crypto.randomUUID();
  }
  try {
    const response = await fetch(`${config.supabaseUrl}/functions/v1/submit-guest-list`, {
      method: "POST",
      headers: {
        apikey: config.anonKey,
        Authorization: `Bearer ${config.anonKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        eventId: selectedEvent.id,
        guests,
        email,
        consent: formData.get("consent") === "on",
        consentVersion: "guest-list-v2",
        website,
        requestId,
      }),
    });
    const result: unknown = await response.json();
    if (!response.ok) {
      const message =
        typeof result === "object" && result !== null && "error" in result && typeof result.error === "string"
          ? result.error
          : "Não foi possível enviar sua lista.";
      throw new Error(message);
    }
    if (!isRecord(result) || result.ok !== true) throw new Error("Não foi possível confirmar a inscrição. Tente novamente.");
    successEvent.textContent = selectedEvent.title;
    successNames.replaceChildren(...guests.map((guest) => {
      const item = document.createElement("li");
      item.textContent = guest.name;
      return item;
    }));
    if (selectedEvent.imageUrl) {
      successImage.src = selectedEvent.imageUrl.startsWith("https://")
        ? selectedEvent.imageUrl : `${import.meta.env.BASE_URL}${selectedEvent.imageUrl.replace(/^\/+/, "")}`;
      successImage.alt = `Cartaz de ${selectedEvent.title}`;
      successImage.hidden = false;
    } else {
      successImage.hidden = true;
      successImage.removeAttribute("src");
    }
    successMessage.textContent = result.email === "accepted"
      ? "Confirmação encaminhada por e-mail. Confira também sua caixa de spam."
      : "Seu cadastro está confirmado. Não foi possível confirmar o envio do e-mail.";
    form.hidden = true;
    success.hidden = false;
    document.querySelector<HTMLButtonElement>("#success-close")?.focus();
  } catch (error) {
    console.error("Não foi possível enviar a lista do evento.", error);
    formStatus.textContent =
      error instanceof Error ? error.message : "Não foi possível enviar sua lista. Tente novamente.";
    submitButton.disabled = false;
  }
}

document.querySelector<HTMLButtonElement>(".dialog-close")?.addEventListener("click", () => dialog?.close());
document.querySelector<HTMLButtonElement>("#success-close")?.addEventListener("click", () => dialog?.close());
dialog.addEventListener("click", (event) => {
  if (event.target === dialog) dialog.close();
});
addGuestButton.addEventListener("click", () => {
  if (!guestRows) return;
  const rows = guestRows.querySelectorAll("[data-guest-row]");
  if (rows.length >= 10) return;
  const newIndex = rows.length;
  guestRows.append(createGuestRow(rows.length));
  updateGuestRowLabels();
  guestRows.querySelectorAll<HTMLDivElement>("[data-guest-row]")
    .item(newIndex)
    ?.querySelector<HTMLInputElement>('input[name="guestName"]')
    ?.focus();
});
form.addEventListener("submit", (event) => void submitGuestList(event));

const currentYear = document.querySelector<HTMLSpanElement>("#current-year");
if (currentYear) currentYear.textContent = String(new Date().getFullYear());

void loadEvents();

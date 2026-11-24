import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import "./admin.css";

type EventRecord = {
  id: string;
  slug: string;
  title: string;
  venue: string;
  neighborhood: string;
  starts_at: string;
  ends_at: string | null;
  description: string;
  category: string;
  status: "draft" | "published" | "cancelled";
  image_url: string | null;
};
type Guest = { id: string; guest_name: string; ticket_type: string; created_at: string; email: string | null };
type Submission = { email: string | null; guest_list_entries: Omit<Guest, "email">[] };

const ticketLabels: Record<string, string> = {
  man: "Homem", woman: "Mulher", couple: "Casal", standard: "Pista (antigo)", vip: "VIP (antigo)",
};

function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Elemento ausente: ${selector}`);
  return element;
}

const loginSection = required<HTMLElement>("#login-section");
const loginForm = required<HTMLFormElement>("#login-form");
const dashboard = required<HTMLElement>("#dashboard");
const logout = required<HTMLButtonElement>("#logout");
const status = required<HTMLElement>("#status");
const eventsContainer = required<HTMLElement>("#events");
const editor = required<HTMLElement>("#editor");
const editorTitle = required<HTMLElement>("#editor-title");
const eventForm = required<HTMLFormElement>("#event-form");
const guestsPanel = required<HTMLElement>("#guests-panel");
const guestsTitle = required<HTMLElement>("#guests-title");
const guestsContainer = required<HTMLElement>("#guests");

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
const client: SupabaseClient | null = url && key ? createClient(url, key) : null;
let events: EventRecord[] = [];
let editing: EventRecord | null = null;
let selectedEvent: EventRecord | null = null;
let guests: Guest[] = [];
let busy = false;

function showStatus(message: string): void {
  status.textContent = message;
}

function showError(error: unknown): void {
  console.error("Erro na administração:", error);
  const message = error && typeof error === "object" && "message" in error && typeof error.message === "string"
    ? error.message : "Não foi possível concluir a operação.";
  showStatus(message);
}

function button(text: string, action: () => void): HTMLButtonElement {
  const element = document.createElement("button");
  element.type = "button";
  element.className = "secondary";
  element.textContent = text;
  element.addEventListener("click", action);
  return element;
}

function input(name: string): HTMLInputElement {
  const field = eventForm.elements.namedItem(name);
  if (!(field instanceof HTMLInputElement)) throw new Error(`Campo ausente: ${name}`);
  return field;
}

function fieldValue(data: FormData, name: string): string {
  const value = data.get(name);
  if (typeof value !== "string") throw new Error(`Campo inválido: ${name}`);
  return value.trim();
}

function localDate(value: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(value));
  const part = (name: string) => parts.find((item) => item.type === name)?.value;
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}

function displayDate(value: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short",
  }).format(new Date(value));
}

async function authorize(): Promise<boolean> {
  if (!client) {
    showStatus("Configure a URL e a chave pública do Supabase para usar a administração.");
    return false;
  }
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) return false;
  if (data.user.app_metadata.role !== "admin") {
    const { error: signOutError } = await client.auth.signOut();
    if (signOutError) throw signOutError;
    showStatus("Esta conta não possui permissão de administrador.");
    return false;
  }
  return true;
}

async function refreshSession(): Promise<void> {
  const authorized = await authorize();
  loginSection.hidden = authorized;
  dashboard.hidden = !authorized;
  logout.hidden = !authorized;
  if (authorized) await loadEvents();
}

async function loadEvents(): Promise<void> {
  if (!client) return;
  const allEvents: EventRecord[] = [];
  const pageSize = 100;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await client.from("events").select("*")
      .order("starts_at", { ascending: false }).order("id", { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    allEvents.push(...((data ?? []) as EventRecord[]));
    if (!data || data.length < pageSize) break;
  }
  events = allEvents;
  eventsContainer.replaceChildren();
  if (!events.length) eventsContainer.textContent = "Nenhum evento cadastrado.";
  for (const event of events) {
    const card = document.createElement("article");
    card.className = "event-admin-card";
    const heading = document.createElement("h3");
    heading.textContent = event.title;
    const details = document.createElement("p");
    details.textContent = `${displayDate(event.starts_at)} · ${event.venue} · ${event.status}`;
    const actions = document.createElement("div");
    actions.className = "actions";
    actions.append(
      button("Editar", () => openEditor(event)),
      button("Ver lista", () => void openGuests(event).catch(showError)),
      button("Retirar da agenda", () => void archiveEvent(event).catch(showError)),
    );
    card.append(heading, details, actions);
    eventsContainer.append(card);
  }
}

function openEditor(event: EventRecord | null): void {
  editing = event;
  eventForm.reset();
  editorTitle.textContent = event ? "Editar evento" : "Novo evento";
  if (event) {
    input("title").value = event.title;
    input("slug").value = event.slug;
    input("venue").value = event.venue;
    input("neighborhood").value = event.neighborhood;
    input("startsAt").value = localDate(event.starts_at);
    input("endsAt").value = event.ends_at ? localDate(event.ends_at) : "";
    input("category").value = event.category;
    const statusField = eventForm.elements.namedItem("status");
    const descriptionField = eventForm.elements.namedItem("description");
    if (!(statusField instanceof HTMLSelectElement) || !(descriptionField instanceof HTMLTextAreaElement)) throw new Error("Formulário incompleto.");
    statusField.value = event.status;
    descriptionField.value = event.description;
  }
  editor.hidden = false;
  editor.scrollIntoView({ behavior: "smooth" });
}

async function saveEvent(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  if (!client || busy || !eventForm.reportValidity()) return;
  busy = true;
  const submit = eventForm.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (submit) submit.disabled = true;
  let uploadedPath: string | null = null;
  let saved = false;
  try {
    const data = new FormData(eventForm);
    const startsAt = fieldValue(data, "startsAt");
    const endsAt = fieldValue(data, "endsAt");
    const start = new Date(`${startsAt}:00-03:00`);
    const end = endsAt ? new Date(`${endsAt}:00-03:00`) : null;
    if (!Number.isFinite(start.getTime()) || (end && (!Number.isFinite(end.getTime()) || end <= start))) {
      throw new Error("Informe datas válidas; o término deve ser posterior ao início.");
    }
    const file = input("image").files?.[0];
    let imageUrl = editing?.image_url ?? null;
    if (file) {
      const extensions: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
      if (!extensions[file.type] || file.size === 0 || file.size > 5 * 1024 * 1024) throw new Error("Escolha uma imagem JPEG, PNG ou WebP de até 5 MB.");
      uploadedPath = `${crypto.randomUUID()}.${extensions[file.type]}`;
      const { error } = await client.storage.from("event-posters").upload(uploadedPath, file, { contentType: file.type });
      if (error) throw error;
      imageUrl = client.storage.from("event-posters").getPublicUrl(uploadedPath).data.publicUrl;
    }
    const values = {
      title: fieldValue(data, "title"), slug: fieldValue(data, "slug"), venue: fieldValue(data, "venue"),
      neighborhood: fieldValue(data, "neighborhood"), category: fieldValue(data, "category"),
      description: fieldValue(data, "description"), status: fieldValue(data, "status"), image_url: imageUrl,
      starts_at: start.toISOString(), ends_at: end?.toISOString() ?? null, updated_at: new Date().toISOString(),
    };
    const result = editing
      ? await client.from("events").update(values).eq("id", editing.id).select("id").single()
      : await client.from("events").insert(values).select("id").single();
    if (result.error) throw result.error;
    saved = true;
    editor.hidden = true;
    await loadEvents();
    showStatus("Evento salvo.");
  } catch (error) {
    if (uploadedPath && !saved) {
      const { error: cleanupError } = await client.storage.from("event-posters").remove([uploadedPath]);
      if (cleanupError) console.error("Não foi possível remover a imagem não utilizada:", cleanupError);
    }
    showError(error);
  } finally {
    busy = false;
    if (submit) submit.disabled = false;
  }
}

async function archiveEvent(event: EventRecord): Promise<void> {
  if (!client || !window.confirm(`Retirar "${event.title}" da agenda? As inscrições serão preservadas.`)) return;
  const { error } = await client.from("events").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("id", event.id).select("id").single();
  if (error) throw error;
  await loadEvents();
  showStatus("Evento retirado da agenda; os dados foram preservados.");
}

async function openGuests(event: EventRecord): Promise<void> {
  if (!client) return;
  const submissions: Submission[] = [];
  const pageSize = 100;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await client.from("guest_list_submissions")
      .select("email,guest_list_entries(id,guest_name,ticket_type,created_at)")
      .eq("event_id", event.id).order("created_at", { ascending: true }).order("id", { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    submissions.push(...((data ?? []) as Submission[]));
    if (!data || data.length < pageSize) break;
  }
  selectedEvent = event;
  guests = submissions.flatMap((submission) => submission.guest_list_entries.map((guest) => ({
    ...guest, email: submission.email,
  })));
  guestsTitle.textContent = `Lista: ${event.title} (${guests.length})`;
  guestsContainer.replaceChildren();
  if (!guests.length) guestsContainer.textContent = "Ainda não há convidados.";
  for (const guest of guests) {
    const row = document.createElement("div");
    row.className = "guest-row-admin";
    const text = document.createElement("span");
    text.textContent = `${guest.guest_name} · ${ticketLabels[guest.ticket_type] ?? guest.ticket_type} · E-mail: ${guest.email ?? "não informado (cadastro antigo)"}`;
    row.append(text, button("Editar nome", () => void editGuest(guest).catch(showError)), button("Editar entrada", () => void editTicket(guest).catch(showError)), button("Excluir", () => void deleteGuest(guest).catch(showError)));
    guestsContainer.append(row);
  }
  guestsPanel.hidden = false;
  guestsPanel.scrollIntoView({ behavior: "smooth" });
}

async function editTicket(guest: Guest): Promise<void> {
  if (!client || !selectedEvent) return;
  const value = window.prompt("Tipo de entrada: Homem, Mulher ou Casal:", ticketLabels[guest.ticket_type] ?? "");
  if (value === null) return;
  const ticket = ({ homem: "man", mulher: "woman", casal: "couple" } as Record<string, string>)[value.trim().toLowerCase()];
  if (!ticket) throw new Error("Escolha Homem, Mulher ou Casal.");
  const { error } = await client.from("guest_list_entries").update({ ticket_type: ticket }).eq("id", guest.id).select("id").single();
  if (error) throw error;
  await openGuests(selectedEvent);
  showStatus("Entrada atualizada.");
}

async function editGuest(guest: Guest): Promise<void> {
  if (!client || !selectedEvent) return;
  const value = window.prompt("Novo nome do convidado:", guest.guest_name);
  if (value === null) return;
  const name = value.trim();
  if (name.length < 2 || name.length > 80 || /[\u0000-\u001f\u007f]/u.test(name)) throw new Error("Informe um nome válido de 2 a 80 caracteres.");
  const { error } = await client.from("guest_list_entries").update({ guest_name: name }).eq("id", guest.id).select("id").single();
  if (error) throw error;
  await openGuests(selectedEvent);
  showStatus("Nome atualizado.");
}

async function deleteGuest(guest: Guest): Promise<void> {
  if (!client || !selectedEvent || !window.confirm(`Excluir "${guest.guest_name}" da lista? Esta ação não pode ser desfeita.`)) return;
  const { error } = await client.from("guest_list_entries").delete().eq("id", guest.id).select("id").single();
  if (error) throw error;
  await openGuests(selectedEvent);
  showStatus("Convidado excluído.");
}

function downloadList(): void {
  if (!selectedEvent) return;
  const csvCell = (value: string) => `"${(/^[\s]*[=+\-@\t\r]/u.test(value) ? "'" : "") + value.replace(/"/g, '""')}"`;
  const lines = [["Nome", "Entrada", "E-mail do responsável", "Inscrição"], ...guests.map((guest) => [guest.guest_name, ticketLabels[guest.ticket_type] ?? guest.ticket_type, guest.email ?? "", displayDate(guest.created_at)])];
  const blob = new Blob(["\ufeff", lines.map((row) => row.map(csvCell).join(";")).join("\r\n")], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  const objectUrl = URL.createObjectURL(blob);
  link.href = objectUrl;
  link.download = `lista-${selectedEvent.slug}.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

loginForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!client || busy || !loginForm.reportValidity()) return;
  void (async () => {
    busy = true;
    try {
      const data = new FormData(loginForm);
      const { error } = await client.auth.signInWithPassword({ email: fieldValue(data, "email"), password: fieldValue(data, "password") });
      if (error) throw error;
      loginForm.reset();
      await refreshSession();
    } finally { busy = false; }
  })().catch(showError);
});
logout.addEventListener("click", () => {
  if (!client) return;
  void (async () => {
    const { error } = await client.auth.signOut();
    if (error) throw error;
    editor.hidden = true;
    guestsPanel.hidden = true;
    guests = [];
    events = [];
    selectedEvent = null;
    guestsContainer.replaceChildren();
    eventsContainer.replaceChildren();
    dashboard.hidden = true;
    loginSection.hidden = false;
    logout.hidden = true;
    showStatus("Sessão encerrada.");
  })().catch(showError);
});
required<HTMLButtonElement>("#new-event").addEventListener("click", () => openEditor(null));
required<HTMLButtonElement>("#cancel-edit").addEventListener("click", () => { editor.hidden = true; });
required<HTMLButtonElement>("#close-guests").addEventListener("click", () => { guestsPanel.hidden = true; });
required<HTMLButtonElement>("#download-list").addEventListener("click", downloadList);
required<HTMLButtonElement>("#email-list").addEventListener("click", () => {
  if (!selectedEvent) return;
  const email = window.prompt("E-mail de destino:");
  if (email === null) return;
  if (!/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/u.test(email.trim())) {
    showStatus("Informe um endereço de e-mail válido.");
    return;
  }
  downloadList();
  const subject = encodeURIComponent(`Lista de convidados: ${selectedEvent.title}`);
  const body = encodeURIComponent("Olá, segue a lista de convidados em anexo.");
  window.location.href = `mailto:${encodeURIComponent(email.trim())}?subject=${subject}&body=${body}`;
  showStatus("Anexe o CSV baixado ao e-mail antes de enviá-lo.");
});
eventForm.addEventListener("submit", (event) => void saveEvent(event));
client?.auth.onAuthStateChange((event) => {
  if (event === "SIGNED_OUT") {
    editor.hidden = true;
    guestsPanel.hidden = true;
    guests = [];
    events = [];
    selectedEvent = null;
    guestsContainer.replaceChildren();
    eventsContainer.replaceChildren();
    dashboard.hidden = true;
    loginSection.hidden = false;
    logout.hidden = true;
  }
});
void refreshSession().catch(showError);

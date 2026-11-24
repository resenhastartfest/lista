import { createClient } from "npm:@supabase/supabase-js@2";

const allowedOrigins = (Deno.env.get("ALLOWED_ORIGINS") ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const corsHeaders = (origin: string) => ({
  "Access-Control-Allow-Origin": origin,
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
});

function jsonResponse(body: Record<string, unknown>, status: number, origin: string): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(origin),
      "Content-Type": "application/json",
    },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character] ?? character);
}

function base64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function mimeBody(value: string): string {
  return base64(value).match(/.{1,76}/g)?.join("\r\n") ?? "";
}

async function hashAddress(address: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(address));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (request: Request): Promise<Response> => {
  const origin = request.headers.get("origin") ?? "";
  if (!origin || !allowedOrigins.includes(origin)) {
    return jsonResponse({ error: "Origem não autorizada." }, 403, origin || "null");
  }
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(origin) });
  }
  if (request.method !== "POST") {
    return jsonResponse({ error: "Método não permitido." }, 405, origin);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const rateLimitSecret = Deno.env.get("RATE_LIMIT_SECRET");
  if (!supabaseUrl || !serviceRoleKey || !rateLimitSecret || allowedOrigins.length === 0) {
    console.error("Guest-list function is missing required server configuration.");
    return jsonResponse({ error: "O serviço de inscrições está temporariamente indisponível." }, 503, origin);
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ error: "Envie os dados da lista em formato JSON." }, 400, origin);
  }

  if (!isRecord(payload)) {
    return jsonResponse({ error: "Os dados enviados são inválidos." }, 400, origin);
  }
  const eventId = payload.eventId;
  const requestId = payload.requestId;
  const consentVersion = payload.consentVersion;
  const guests = payload.guests;
  const consent = payload.consent;
  const website = payload.website;
  const emailInput = payload.email;

  if (typeof website === "string" && website.trim() !== "") {
    return jsonResponse({ error: "Não foi possível validar o envio." }, 400, origin);
  }
  if (!isUuid(eventId) || !isUuid(requestId)) {
    return jsonResponse({ error: "Evento ou identificador da lista inválido." }, 400, origin);
  }
  if (consent !== true || consentVersion !== "guest-list-v2") {
    return jsonResponse({ error: "É necessário aceitar o uso dos dados para este evento." }, 400, origin);
  }
  if (typeof emailInput !== "string") {
    return jsonResponse({ error: "Informe um e-mail válido." }, 400, origin);
  }
  const email = emailInput.trim().toLowerCase();
  const [localPart, domain] = email.split("@");
  if (email.length > 254 || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i.test(email) ||
      localPart.length > 64 || localPart.startsWith(".") || localPart.endsWith(".") || localPart.includes("..") ||
      domain.split(".").some((label) => label.length > 63)) {
    return jsonResponse({ error: "Informe um e-mail válido." }, 400, origin);
  }
  if (!Array.isArray(guests) || guests.length < 1 || guests.length > 10) {
    return jsonResponse({ error: "A lista deve conter de 1 a 10 pessoas." }, 400, origin);
  }

  const normalizedGuests: Array<{ name: string; ticketType: string }> = [];
  for (const guest of guests) {
    if (!isRecord(guest) || typeof guest.name !== "string" || typeof guest.ticketType !== "string") {
      return jsonResponse({ error: "Confira os dados de cada pessoa da lista." }, 400, origin);
    }
    const name = guest.name.trim();
    if (
      name.length < 2 ||
      name.length > 80 ||
      /[\u0000-\u001f\u007f]/u.test(name) ||
      !["standard", "vip", "man", "woman", "couple"].includes(guest.ticketType)
    ) {
      return jsonResponse({ error: "Confira os nomes e tipos de entrada informados." }, 400, origin);
    }
    normalizedGuests.push({ name, ticketType: guest.ticketType });
  }

  const clientAddress =
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-real-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (!clientAddress) {
    return jsonResponse({ error: "Não foi possível validar a solicitação. Tente novamente." }, 400, origin);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  try {
    const rateLimitKey = await hashAddress(clientAddress, rateLimitSecret);
    const { data: allowed, error: rateLimitError } = await supabase.rpc("consume_guest_list_rate_limit", {
      p_key: rateLimitKey,
    });
    if (rateLimitError) {
      console.error("Guest-list rate-limit check failed.", rateLimitError.message);
      return jsonResponse({ error: "Não foi possível validar o envio. Tente novamente mais tarde." }, 503, origin);
    }
    if (allowed !== true) {
      return jsonResponse({ error: "Muitas tentativas. Aguarde alguns minutos e tente novamente." }, 429, origin);
    }

    const { data: registration, error } = await supabase.rpc("register_email_guest_list", {
      p_event_id: eventId,
      p_request_id: requestId,
      p_email: email,
      p_guests: normalizedGuests.map((guest) => ({
        name: guest.name,
        ticketType: guest.ticketType,
      })),
    });
    if (error) {
      if (error.code === "23505") {
        return jsonResponse({ error: "Já existe um cadastro com este e-mail para este evento." }, 409, origin);
      }
      console.error("Guest-list submission failed.", error.code);
      if (error.code === "22023") {
        return jsonResponse({ error: "Este evento não está aceitando inscrições ou os dados precisam ser revisados." }, 400, origin);
      }
      return jsonResponse({ error: "Não foi possível salvar sua lista. Tente novamente." }, 500, origin);
    }

    const record = Array.isArray(registration) ? registration[0] : null;
    if (!record || typeof record.submission_id !== "string" || typeof record.event_title !== "string") {
      console.error("Registration returned an invalid result.");
      return jsonResponse({ error: "Não foi possível confirmar o resultado. Tente novamente." }, 503, origin);
    }

    if (record.created === true) {
      const clientId = Deno.env.get("GMAIL_CLIENT_ID");
      const clientSecret = Deno.env.get("GMAIL_CLIENT_SECRET");
      const refreshToken = Deno.env.get("GMAIL_REFRESH_TOKEN");
      const sender = Deno.env.get("EMAIL_FROM");
      let messageStatus = "failed";
      if (clientId && clientSecret && refreshToken && sender && /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@gmail\.com$/i.test(sender)) {
        try {
          const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              client_id: clientId,
              client_secret: clientSecret,
              refresh_token: refreshToken,
              grant_type: "refresh_token",
            }),
            signal: AbortSignal.timeout(10000),
          });
          if (!tokenResponse.ok) {
            console.error("Gmail token request failed:", tokenResponse.status);
          } else {
            const tokenData: unknown = await tokenResponse.json();
            if (!isRecord(tokenData) || typeof tokenData.access_token !== "string" || !tokenData.access_token) {
              console.error("Gmail token response was invalid.");
            } else {
              const title = escapeHtml(record.event_title);
              const text = `Sua inscrição na lista do evento ${record.event_title} está confirmada.`;
              const html = `<div style="background:#0a0a0a;padding:32px 16px;font-family:Arial,sans-serif;color:#f4f1ec"><div style="max-width:520px;margin:auto;background:#111b13;border:1px solid #49583e;border-radius:16px;padding:32px"><p style="color:#e9b142;font-size:13px;font-weight:bold;letter-spacing:2px">STARTFEST · PRESENÇA CONFIRMADA</p><h1 style="font-size:30px;line-height:1.2">Você está na lista!</h1><p style="color:#c3cbc3;font-size:16px;line-height:1.5">Seu cadastro foi confirmado para o evento:</p><p style="color:#e9b142;font-size:24px;font-weight:bold">${title}</p><p style="color:#c3cbc3;font-size:14px;line-height:1.5">Esperamos você para viver esse momento com a gente.</p></div></div>`;
              const boundary = `startfest-${crypto.randomUUID()}`;
              const mime = [
                `From: ${sender}`, `To: ${email}`,
                `Subject: =?UTF-8?B?${base64("Sua presença está confirmada | StartFest")}?=`,
                "MIME-Version: 1.0", `Content-Type: multipart/alternative; boundary="${boundary}"`, "",
                `--${boundary}`, 'Content-Type: text/plain; charset="UTF-8"', "Content-Transfer-Encoding: base64", "", mimeBody(text),
                `--${boundary}`, 'Content-Type: text/html; charset="UTF-8"', "Content-Transfer-Encoding: base64", "", mimeBody(html),
                `--${boundary}--`, "",
              ].join("\r\n");
              const raw = base64(mime).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
              const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
                method: "POST",
                headers: { Authorization: `Bearer ${tokenData.access_token}`, "Content-Type": "application/json" },
                body: JSON.stringify({ raw }),
                signal: AbortSignal.timeout(10000),
              });
              if (response.ok) messageStatus = "accepted";
              else console.error("Gmail rejected notification:", response.status);
            }
          }
        } catch {
          console.error("Email notification request failed or timed out.");
        }
      } else {
        console.error("Email integration is not configured.");
      }
      const { error: updateError } = await supabase.from("guest_list_submissions")
        .update({ email_status: messageStatus }).eq("id", record.submission_id);
      if (updateError) console.error("Failed to record email notification status.", updateError.code);
      return jsonResponse({ ok: true, email: messageStatus }, 201, origin);
    }
    const { data: existing, error: lookupError } = await supabase.from("guest_list_submissions")
      .select("email_status").eq("id", record.submission_id).single();
    if (lookupError) console.error("Failed to read email notification status.", lookupError.code);
    return jsonResponse({ ok: true, email: existing?.email_status ?? "pending" }, 200, origin);
  } catch (error) {
    console.error("Guest-list request failed.", error instanceof Error ? error.message : "Unknown error");
    return jsonResponse({ error: "Não foi possível concluir o envio. Tente novamente." }, 500, origin);
  }
});

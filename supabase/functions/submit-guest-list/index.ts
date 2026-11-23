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

  if (typeof website === "string" && website.trim() !== "") {
    return jsonResponse({ error: "Não foi possível validar o envio." }, 400, origin);
  }
  if (!isUuid(eventId) || !isUuid(requestId)) {
    return jsonResponse({ error: "Evento ou identificador da lista inválido." }, 400, origin);
  }
  if (consent !== true || consentVersion !== "guest-list-v1") {
    return jsonResponse({ error: "É necessário aceitar o uso dos dados para este evento." }, 400, origin);
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

    const { error } = await supabase.rpc("create_guest_list_submission", {
      p_event_id: eventId,
      p_request_id: requestId,
      p_consent_version: consentVersion,
      p_guests: normalizedGuests.map((guest) => ({
        name: guest.name,
        ticketType: guest.ticketType,
      })),
    });
    if (error) {
      console.error("Guest-list submission failed.", error.message);
      if (error.code === "22023") {
        return jsonResponse({ error: "Este evento não está aceitando inscrições ou os dados precisam ser revisados." }, 400, origin);
      }
      return jsonResponse({ error: "Não foi possível salvar sua lista. Tente novamente." }, 500, origin);
    }

    return jsonResponse({ ok: true }, 201, origin);
  } catch (error) {
    console.error("Guest-list request failed.", error instanceof Error ? error.message : "Unknown error");
    return jsonResponse({ error: "Não foi possível concluir o envio. Tente novamente." }, 500, origin);
  }
});

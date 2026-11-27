import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { webcrypto } from "node:crypto";

const source = await readFile(new URL("../supabase/functions/submit-guest-list/index.ts", import.meta.url), "utf8");
const executable = ts.transpile(source.replace(/^import .+;\s*/u, ""), {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.None,
});
const eventId = "8a9b4701-5d62-40de-8b2f-94a605103a01";
const requestId = "8a9b4701-5d62-40de-8b2f-94a605103a02";
const payload = {
  eventId,
  requestId,
  email: " Teste@Example.com ",
  consent: true,
  consentVersion: "guest-list-v2",
  guests: [{ name: "Pessoa teste", ticketType: "man" }],
};

function setup({ registrationError, configured = true, provider = "resend", tokenStatus = 200, tokenData = { access_token: "access-token" }, sendStatus = 200, sender = "StartFest <listas@startfest.com.br>", created = true } = {}) {
  const secrets = {
    ALLOWED_ORIGINS: "https://example.test",
    SUPABASE_URL: "https://supabase.test",
    SUPABASE_SERVICE_ROLE_KEY: "test-key",
    RATE_LIMIT_SECRET: "test-secret",
    ...(configured && provider === "resend" && {
      RESEND_API_KEY: "test-resend-key",
      RESEND_EMAIL_FROM: sender,
    }),
    ...(configured && provider === "gmail" && {
      GMAIL_CLIENT_ID: "test-client",
      GMAIL_CLIENT_SECRET: "test-secret",
      GMAIL_REFRESH_TOKEN: "test-refresh-token",
      EMAIL_FROM: sender,
    }),
  };
  const calls = { sends: [], updates: [], registrations: [] };
  const client = {
    async rpc(name, data) {
      if (name === "consume_guest_list_rate_limit") return { data: true, error: null };
      calls.registrations.push(data);
      return registrationError
        ? { data: null, error: registrationError }
        : { data: [{ submission_id: requestId, event_title: "Festa <Teste>", created }], error: null };
    },
    from() {
      return {
        update(value) {
          return { async eq() { calls.updates.push(value); return { error: null }; } };
        },
        select() {
          return { eq() { return { async single() { return { data: { email_status: "accepted" }, error: null }; } }; } };
        },
      };
    },
  };
  let handler;
  const context = {
    Deno: { env: { get: (name) => secrets[name] }, serve: (fn) => { handler = fn; } },
    createClient: () => client,
    fetch: async (url, options) => {
      calls.sends.push({ url, options });
      if (url === "https://api.resend.com/emails") {
        return new Response(JSON.stringify({ id: "resend-message-id" }), { status: sendStatus });
      }
      if (url === "https://oauth2.googleapis.com/token") {
        return new Response(JSON.stringify(tokenData), { status: tokenStatus });
      }
      return new Response(null, { status: sendStatus });
    },
    console: { error() {} },
    crypto: webcrypto,
    TextEncoder,
    URLSearchParams,
    btoa,
    AbortSignal,
    Request,
    Response,
  };
  vm.runInNewContext(executable, context);
  return {
    calls,
    async request(body = payload) {
      const request = new Request("https://supabase.test/functions/v1/submit-guest-list", {
        method: "POST",
        headers: { origin: "https://example.test", "cf-connecting-ip": "192.0.2.1", "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const response = await handler(request);
      return { status: response.status, body: await response.json() };
    },
  };
}

test("normalizes the email and sends escaped styled confirmation after registration", async () => {
  const app = setup();
  const result = await app.request();
  assert.equal(result.status, 201);
  assert.equal(result.body.email, "accepted");
  assert.equal(app.calls.registrations[0].p_email, "teste@example.com");
  assert.equal(app.calls.sends.length, 1);
  assert.equal(app.calls.sends[0].url, "https://api.resend.com/emails");
  assert.equal(app.calls.sends[0].options.headers.Authorization, "Bearer test-resend-key");
  const message = JSON.parse(app.calls.sends[0].options.body);
  assert.equal(message.from, "StartFest <listas@startfest.com.br>");
  assert.deepEqual(message.to, ["teste@example.com"]);
  assert.match(message.text, /Festa <Teste>/);
  assert.match(message.html, /Festa &lt;Teste&gt;/);
  assert.match(message.html, /<img src="https:\/\/lista-15w\.pages\.dev\/startfest-logo\.jpeg" alt="StartFest"/);
  assert.equal(app.calls.updates[0].email_status, "accepted");
});

test("keeps Gmail available as a fallback until Resend is configured", async () => {
  const app = setup({ provider: "gmail", sender: "startfest@gmail.com" });
  const result = await app.request();
  assert.equal(result.status, 201);
  assert.equal(result.body.email, "accepted");
  assert.equal(app.calls.sends.length, 2);
  assert.equal(app.calls.sends[0].url, "https://oauth2.googleapis.com/token");
  assert.equal(app.calls.sends[0].options.body.get("grant_type"), "refresh_token");
  assert.equal(app.calls.sends[1].url, "https://gmail.googleapis.com/gmail/v1/users/me/messages/send");
  assert.equal(app.calls.sends[1].options.headers.Authorization, "Bearer access-token");
});

test("rejects invalid emails and duplicate registrations without sending messages", async () => {
  const app = setup();
  assert.equal((await app.request({ ...payload, email: "invalid" })).status, 400);
  assert.equal((await app.request({ ...payload, email: "a..b@example.com" })).status, 400);
  assert.equal(app.calls.registrations.length, 0);
  const duplicate = setup({ registrationError: { code: "23505" } });
  assert.equal((await duplicate.request()).status, 409);
  assert.equal(duplicate.calls.sends.length, 0);
});

test("reports notification failure without undoing a successful registration", async () => {
  for (const options of [
    { configured: false }, { sender: "StartFest <attacker@example.net>" },
    { sender: "bad\r\nBcc: victim@gmail.com" }, { sendStatus: 401 }, { sendStatus: 500 },
  ]) {
    const app = setup(options);
    const result = await app.request();
    assert.equal(result.status, 201);
    assert.equal(result.body.email, "failed");
    assert.equal(app.calls.updates[0].email_status, "failed");
  }
});

test("does not send another message for an idempotent retry", async () => {
  const app = setup({ created: false });
  const result = await app.request();
  assert.equal(result.status, 200);
  assert.equal(result.body.email, "accepted");
  assert.equal(app.calls.sends.length, 0);
});

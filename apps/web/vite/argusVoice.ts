import type { IncomingMessage, ServerResponse } from "node:http";

import type { Plugin } from "vite-plus";

const VOICE_NAME = "vesper";

const VOICE_INSTRUCTIONS = [
  "You are Argus, the owner's personal aide.",
  "Speak with a measured British cadence: unhurried, precise, and quietly confident.",
  "Reply in one short sentence. No preamble.",
  "The panes stay on screen. You do not send messages, open pull requests, or merge code.",
  "When a session starts, before they speak, say exactly: How can I help you, sir?",
  "If they ask you to open or show the panel, say that you are opening it.",
  "If they give an order, acknowledge that exact order, then carry it out.",
  "If the space is unclear, ask which one: Tether, DoorDash, Motley Fool, or Personal.",
].join(" ");

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

/**
 * Mints a spoken session for this window. The API key stays in the server
 * process. The browser only sends its WebRTC offer.
 */
export function argusVoicePlugin(): Plugin {
  return {
    name: "argus-voice",
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const url = request.url?.split("?")[0];
        if (
          request.method !== "POST" ||
          (url !== "/argus-voice/session" &&
            url !== "/argus-voice/chat" &&
            url !== "/argus-voice/decide")
        ) {
          next();
          return;
        }
        if (url === "/argus-voice/decide") {
          await handleDecide(request, response);
          return;
        }
        if (url === "/argus-voice/chat") {
          await handleChat(request, response);
          return;
        }
        await handleVoiceSession(request, response);
      });
    },
  };
}

async function handleVoiceSession(request: IncomingMessage, response: ServerResponse) {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) {
    respond(response, 503, { error: "voice_unconfigured" });
    return;
  }

  let sdp = "";
  try {
    const body = JSON.parse(await readBody(request)) as { sdp?: unknown };
    sdp = typeof body.sdp === "string" ? body.sdp : "";
  } catch {
    sdp = "";
  }
  if (!sdp.trim()) {
    respond(response, 400, { error: "sdp_required" });
    return;
  }

  try {
    const upstream = await fetch("https://api.openai.com/v1/live/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        session: {
          model: "gpt-live-1",
          instructions: VOICE_INSTRUCTIONS,
          audio: { output: { voice: VOICE_NAME } },
        },
        transport: { type: "webrtc", sdp },
      }),
    });
    const text = await upstream.text();
    response.statusCode = upstream.status;
    response.setHeader("content-type", "application/json");
    response.end(text);
  } catch {
    respond(response, 502, { error: "voice_unavailable" });
  }
}

const ACTIONS = ["open_panel", "list_missions", "save_task", "end", "speak"] as const;
type VoiceAction = (typeof ACTIONS)[number];

function localAction(text: string): VoiceAction | null {
  const said = text.trim().toLowerCase();
  if (!said) return null;
  if (/\b(open|show|pull up|bring up)( the| your)? panel\b/.test(said)) return "open_panel";
  if (/\b(missions|reviews|what(?:'s| is) waiting|on my plate)\b/.test(said))
    return "list_missions";
  if (/\b(remind me|save this|add a task|capture this|hold this)\b/.test(said)) return "save_task";
  if (/^(stop|goodbye|that(?:'s| is) all|never mind|hang up)\b/.test(said)) return "end";
  return null;
}

async function handleDecide(request: IncomingMessage, response: ServerResponse) {
  let text = "";
  try {
    const body = JSON.parse(await readBody(request)) as { text?: unknown };
    text = typeof body.text === "string" ? body.text.slice(0, 500) : "";
  } catch {
    text = "";
  }
  const immediate = localAction(text);
  if (immediate) {
    respond(response, 200, { action: immediate, via: "local" });
    return;
  }
  const decided = await decisionAction(text);
  respond(response, 200, decided);
}

async function decisionAction(text: string): Promise<{ action: VoiceAction; via: string }> {
  const key = process.env.JEV_API_KEY?.trim();
  if (!key || !text.trim()) return { action: "speak", via: "voice" };
  const model = process.env.JEV_DECISION_MODEL?.trim() || "clef-flash";
  try {
    const upstream = await fetch("https://jevtypesafeai.com/api/v1/decisions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(450),
      body: JSON.stringify({
        model,
        state: text,
        questions: {
          action: {
            type: "choice",
            instructions: "What should happen immediately?",
            criteria: {
              open_panel: "they want the panel or details on screen",
              list_missions: "they want missions, reviews, or what is waiting",
              save_task: "they are giving an order or a reminder to keep",
              end: "they are done talking",
              speak: "just answer in conversation",
            },
          },
        },
      }),
    });
    const payload = (await upstream.json().catch(() => null)) as {
      answers?: { action?: { choice?: string; confidence?: number } };
    } | null;
    const choice = payload?.answers?.action?.choice;
    const confidence = payload?.answers?.action?.confidence ?? 0;
    if (choice && (ACTIONS as readonly string[]).includes(choice) && confidence >= 0.55) {
      return { action: choice as VoiceAction, via: "decision" };
    }
  } catch {
    return { action: "speak", via: "voice" };
  }
  return { action: "speak", via: "voice" };
}

const CHAT_MODELS = ["gpt-4.1-mini", "gpt-4o-mini"];
const PROMPT_TTL_MS = 2 * 60_000;
let cachedPrompt: { at: number; value: string } | null = null;

async function handleChat(request: IncomingMessage, response: ServerResponse) {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) {
    respond(response, 503, { error: "voice_unconfigured" });
    return;
  }

  let messages: { role: "user" | "assistant"; content: string }[] = [];
  let desktop: unknown = null;
  try {
    const body = JSON.parse(await readBody(request)) as { messages?: unknown; desktop?: unknown };
    desktop = body.desktop ?? null;
    if (!Array.isArray(body.messages)) throw new Error("invalid");
    messages = body.messages.slice(-20).flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const record = item as { role?: unknown; text?: unknown };
      const text = typeof record.text === "string" ? record.text.trim().slice(0, 4000) : "";
      if (!text) return [];
      return [
        {
          role: record.role === "argus" ? ("assistant" as const) : ("user" as const),
          content: text,
        },
      ];
    });
  } catch {
    respond(response, 400, { error: "invalid_input" });
    return;
  }
  if (!messages.some((message) => message.role === "user")) {
    respond(response, 400, { error: "invalid_input" });
    return;
  }

  const instructions = await instructionsFor(desktop);
  for (const model of CHAT_MODELS) {
    try {
      const upstream = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        signal: AbortSignal.timeout(20_000),
        body: JSON.stringify({
          model,
          stream: true,
          max_completion_tokens: 280,
          messages: [{ role: "system", content: instructions }, ...messages],
        }),
      });
      if (upstream.status === 404) continue;
      if (!upstream.ok || !upstream.body) {
        respond(response, upstream.status || 502, { error: "voice_unavailable" });
        return;
      }
      const opened = await writeChatStream(response, upstream.body);
      if (opened === "model_missing") continue;
      return;
    } catch {
      respond(response, 502, { error: "voice_unavailable" });
      return;
    }
  }
  respond(response, 502, { error: "voice_unavailable" });
}

async function writeChatStream(
  response: ServerResponse,
  body: ReadableStream<Uint8Array>,
): Promise<"done" | "model_missing"> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let started = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      let payload: { error?: { code?: string }; choices?: { delta?: { content?: string } }[] };
      try {
        payload = JSON.parse(data) as typeof payload;
      } catch {
        continue;
      }
      if (payload.error?.code === "model_not_found") return "model_missing";
      const text = payload.choices?.[0]?.delta?.content ?? "";
      if (!text) continue;
      if (!started) {
        response.statusCode = 200;
        response.setHeader("content-type", "text/plain; charset=utf-8");
        started = true;
      }
      response.write(text);
    }
  }
  if (!started) {
    respond(response, 502, { error: "voice_unavailable" });
  } else {
    response.end();
  }
  return "done";
}

async function instructionsFor(desktop: unknown): Promise<string> {
  if (cachedPrompt && Date.now() - cachedPrompt.at < PROMPT_TTL_MS) {
    void refreshPrompt(desktop);
    return cachedPrompt.value;
  }
  return refreshPrompt(desktop);
}

async function refreshPrompt(desktop: unknown): Promise<string> {
  const fallback = cachedPrompt?.value ?? VOICE_INSTRUCTIONS;
  try {
    const response = await fetch("http://127.0.0.1:3100/api/assistant/context", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "t3code-dev://app",
        "x-argus-desktop": "1",
      },
      body: JSON.stringify({
        chats:
          desktop &&
          typeof desktop === "object" &&
          Array.isArray((desktop as { chats?: unknown }).chats)
            ? (desktop as { chats: unknown[] }).chats.slice(0, 12)
            : [],
      }),
      signal: AbortSignal.timeout(2000),
    });
    if (!response.ok) return fallback;
    const payload = (await response.json()) as { prompt?: unknown };
    const prompt = typeof payload.prompt === "string" ? payload.prompt.trim() : "";
    if (!prompt) return fallback;
    const value = `${VOICE_INSTRUCTIONS}\n\n${prompt}`.slice(0, 12_000);
    cachedPrompt = { at: Date.now(), value };
    return value;
  } catch {
    return fallback;
  }
}

function respond(response: ServerResponse, status: number, body: unknown) {
  response.statusCode = status;
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify(body));
}

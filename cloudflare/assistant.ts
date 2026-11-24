import type { CloudflareEnv } from "./db.ts";
import { dbFirst } from "./db.ts";
import { readSessionToken, hashToken } from "./security.ts";

interface AssistantEnv extends CloudflareEnv {
  SESSION_SECRET?: string;
  GEMINI_API_KEY?: string;
}

function getFallbackAnswer(question: string): { answer: string; suggestedRoute: string } {
  const q = question.toLowerCase();
  if (q.includes("group") && (q.includes("create") || q.includes("make") || q.includes("new"))) return { answer: 'Go to My Groups and click "New Group". Choose a name and category, then optionally add members.', suggestedRoute: "/groups" };
  if (q.includes("invite") || q.includes("qr")) return { answer: 'Open a group workspace and select Members & Invites to manage invitations. For payments, open Settlements to create a UPI payment and submit its reference.', suggestedRoute: "/groups" };
  if (["item", "split", "tea", "coffee", "expense"].some(word => q.includes(word))) return { answer: 'Open Add Expense, choose your group and payer, then select a split method. For item-wise bills, assign consumers to each item and include shared tax or discounts.', suggestedRoute: "/add-expense" };
  if (["owe", "balance", "why"].some(word => q.includes(word))) return { answer: 'Your net balance is based on what you paid, what you owe, and confirmed settlements. Open Balances to see who owes whom and suggested transfers.', suggestedRoute: "/balances" };
  if (q.includes("settle") || q.includes("pay")) return { answer: 'Open Settlements to see suggested transfers. Record your payment reference and wait for the recipient to confirm receipt.', suggestedRoute: "/settlements" };
  return { answer: "SettleUp helps you create groups, record shared expenses, calculate balances, and confirm settlements. Use the sidebar to open Dashboard, Groups, Add Expense, Balances, Settlements, or Analytics.", suggestedRoute: "/dashboard" };
}

async function getUser(request: Request, env: AssistantEnv): Promise<{ id: number; fullName: string } | null> {
  const token = readSessionToken(request);
  if (!token || !env.SESSION_SECRET) return null;
  const tokenHash = await hashToken(token, env.SESSION_SECRET);
  return await dbFirst(env.DB,
    `SELECT u.id, u.full_name AS fullName FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND datetime(s.expires_at) > datetime('now')`,
    [tokenHash]);
}

export async function handleAssistant(request: Request, env: AssistantEnv): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== "/api/assistant" && url.pathname !== "/api/assistant/") return null;
  if (request.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });
  const user = await getUser(request, env);
  if (!user) return Response.json({ error: "Authentication required. Please sign in." }, { status: 401 });
  let body: { question?: string };
  try { body = await request.json() as { question?: string }; }
  catch { return Response.json({ error: "Invalid request body." }, { status: 400 }); }
  const question = (body.question ?? "").trim();
  if (!question || question.length > 500) return Response.json({ error: "Please ask a concise question (1–500 characters)." }, { status: 400 });
  const fallback = getFallbackAnswer(question);
  if (!env.GEMINI_API_KEY || env.GEMINI_API_KEY === "MY_GEMINI_API_KEY") return Response.json({ ...fallback, source: "help-centre" });
  try {
    const systemInstruction = `You are SettleUp's in-app help assistant for ${user.fullName}. Answer in 2-4 concise, beginner-friendly sentences. Explain groups, invitations, expense split methods, balances, settlements and UPI QR. Never invent financial numbers or expose private data.`;
    const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: systemInstruction }] }, contents: [{ parts: [{ text: question }] }] })
    });
    if (!response.ok) return Response.json({ ...fallback, source: "help-centre" });
    const result = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    const answer = result.candidates?.[0]?.content?.parts?.map(part => part.text ?? "").join("").trim();
    return Response.json({ answer: answer || fallback.answer, suggestedRoute: fallback.suggestedRoute, source: answer ? "gemini" : "help-centre" });
  } catch {
    return Response.json({ ...fallback, source: "help-centre" });
  }
}

import type { CloudflareEnv } from "./cloudflare/db.ts";
import { handleAuth } from "./cloudflare/auth.ts";
import { handleExpenses } from "./cloudflare/expenses.ts";
import { handleBalances } from "./cloudflare/balance.ts";
import { handleGroups } from "./cloudflare/group.ts";
import { handleManualBalances } from "./cloudflare/manualBalances.ts";
import { handleNotifications } from "./cloudflare/notifications.ts";
import { handleProfile } from "./cloudflare/profile.ts";
import { handlePersonal } from "./cloudflare/personal.ts";
import { handleAnalytics } from "./cloudflare/analytics.ts";
import { handleAssistant } from "./cloudflare/assistant.ts";
import { handleTripLedger } from "./cloudflare/tripLedger.ts";

interface Env extends CloudflareEnv {
  SESSION_SECRET: string;
  GEMINI_API_KEY?: string;
  CANONICAL_APP_URL?: string;
  APPS_SCRIPT_URL?: string;
  EMAIL_INTEGRATION_SECRET?: string;
  ASSETS?: { fetch(request: Request): Promise<Response> };
}

type RouteHandler = (request: Request, env: Env) => Promise<Response | null>;

const handlers: RouteHandler[] = [
  handleExpenses as RouteHandler,
  handleBalances as RouteHandler,
  handleGroups as RouteHandler,
  handleManualBalances as RouteHandler,
  handleNotifications as RouteHandler,
  handleProfile as RouteHandler,
  handlePersonal as RouteHandler,
  handleAnalytics as RouteHandler,
  handleAssistant as RouteHandler,
  handleTripLedger as RouteHandler
];

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    try {

    if (url.pathname === "/" && request.method === "GET") {
      if (env.ASSETS) return env.ASSETS.fetch(request);
      return Response.json({
        success: true,
        message: "SettleUp Worker is running"
      });
    }

    if (url.pathname === "/api/health" && request.method === "GET") {
      try {
        const result = await env.DB
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
          .all();

        return Response.json({
          success: true,
          message: "SettleUp D1 database connected",
          tables: result.results?.length ?? 0
        });
      } catch {
        return Response.json({
          success: false,
          message: "D1 database connection failed"
        }, { status: 500 });
      }
    }

    if (url.pathname.startsWith("/api/auth/")) {
      return handleAuth(request, env);
    }

    if (url.pathname.startsWith("/api/")) {
      for (const handler of handlers) {
        const response = await handler(request, env);
        if (response) return response;
      }
      return Response.json(
        { success: false, message: "API route not found" },
        { status: 404 }
      );
    }

    if (env.ASSETS) return env.ASSETS.fetch(request);

    return Response.json(
      { success: false, message: "Route not found" },
      { status: 404 }
    );
    } catch (error) {
      const safeRoute = url.pathname.replace(/\/[a-f0-9]{32,}(?=\/|$)/ig, "/[token]");
      console.error("SettleUp Worker request failed", {
        method: request.method,
        route: safeRoute,
        errorType: error instanceof Error ? error.name : "UnknownError"
      });
      return Response.json({ error: "SettleUp could not complete the request. Try again; if it continues, contact the group administrator." }, {
        status: 500,
        headers: { "Cache-Control": "no-store" }
      });
    }
  }
};

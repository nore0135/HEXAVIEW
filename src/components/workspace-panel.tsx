"use client";
import { useEffect, useRef, useState } from "react";
import {hashLocalPassword,verifyLocalPassword} from "@/lib/local-password";
import { parseHexaScript } from "@/lib/hexascript";
import { Interval, isInterval } from "@/lib/market";

export type AlertDirection = "crosses_above" | "crosses_below";

export interface ChartState {
  schemaVersion: 1;
  symbol: "BTCUSDT";
  interval: Interval;
  showSma: boolean;
  script?: string;
}

export interface AlertItem {
  id: string;
  symbol: "BTCUSDT";
  direction: AlertDirection;
  threshold: number;
  status: "active" | "triggered" | "cancelled";
  created_at: string;
  triggered_at?: string | null;
}

export interface TriggeredNotification {
  id: string;
  alertId: string;
  symbol: string;
  direction: AlertDirection;
  threshold: number;
  price: number;
  triggeredAt: string;
}

interface SavedWorkspace {
  id: string;
  name: string;
  version: number;
  state?: ChartState;
}

interface LocalAccount {
  email: string;
  handle: string;
  passwordHash: string;
}

const ENV_API = (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/$/, "");
const STORAGE_KEYS = {
  apiUrl: "hexaview.api_url.v1",
  session: "hexaview.session.v1",
  localUsers: "hexaview.local.users.v1",
  localWorkspaces: "hexaview.local.workspaces.v1",
  localAlerts: "hexaview.local.alerts.v1",
};

function safeRead<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function safeWrite(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

function playAlertTone(): void {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.setValueAtTime(1174.66, ctx.currentTime + 0.12);
    gain.gain.setValueAtTime(0.12, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.45);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.45);
  } catch {}
}

export function WorkspacePanel({
  state,
  onLoad,
  currentPrice,
  onAlertsChange,
}: {
  state: ChartState;
  onLoad: (state: ChartState) => void;
  currentPrice?: number;
  onAlertsChange?: (alerts: AlertItem[]) => void;
}) {
  const [customApi, setCustomApi] = useState("");
  const [apiDraft, setApiDraft] = useState("");
  const [showApiConfig, setShowApiConfig] = useState(false);

  const [token, setToken] = useState("");
  const [userEmail, setUserEmail] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [handle, setHandle] = useState("");
  const [register, setRegister] = useState(false);

  const [name, setName] = useState("My workspace");
  const [saved, setSaved] = useState<SavedWorkspace[]>([]);
  const [selected, setSelected] = useState<SavedWorkspace | null>(null);

  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [alertDirection, setAlertDirection] = useState<AlertDirection>("crosses_above");
  const [alertThreshold, setAlertThreshold] = useState("");
  const [notifications, setNotifications] = useState<TriggeredNotification[]>([]);

  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const prevPriceRef = useRef<number | undefined>(undefined);

  const activeApi = (customApi || ENV_API).replace(/\/$/, "");
  const isBackendMode = Boolean(activeApi);

  useEffect(() => {
    const storedApi = safeRead<string>(STORAGE_KEYS.apiUrl, "");
    if (storedApi) {
      setCustomApi(storedApi);
      setApiDraft(storedApi);
    } else {
      setApiDraft(ENV_API);
    }
    const session = safeRead<{ token: string; email: string; mode: "backend" | "local" } | null>(
      STORAGE_KEYS.session,
      null,
    );
    if (session) {
      const targetBackend = Boolean(storedApi || ENV_API);
      if ((targetBackend && session.mode === "backend") || (!targetBackend && session.mode === "local")) {
        setToken(session.token);
        setUserEmail(session.email);
      }
    }
  }, []);

  useEffect(() => {
    onAlertsChange?.(alerts.filter((a) => a.status === "active"));
  }, [alerts, onAlertsChange]);

  async function request(path: string, method = "GET", body?: unknown, session = token): Promise<unknown> {
    const response = await fetch(`${activeApi}${path}`, {
      method,
      headers: {
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(session ? { Authorization: `Bearer ${session}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
    });
    if (response.status === 401) {
      setToken("");
      setUserEmail("");
      setSaved([]);
      setSelected(null);
      setAlerts([]);
      safeWrite(STORAGE_KEYS.session, null);
    }
    if (!response.ok) {
      const data = await response.json().catch(() => ({ error: "API unavailable" }));
      throw new Error(data.error ?? "Request failed");
    }
    return response.status === 204 ? null : response.json();
  }

  async function refreshUserData(session = token, accountEmail = userEmail) {
    if (!session) return;
    if (isBackendMode) {
      const [wsList, alertList] = await Promise.all([
        request("/workspaces", "GET", undefined, session) as Promise<SavedWorkspace[]>,
        request("/alerts", "GET", undefined, session).catch(() => []) as Promise<AlertItem[]>,
      ]);
      setSaved(wsList);
      setAlerts(alertList);
    } else {
      const allWs = safeRead<Record<string, (SavedWorkspace & { state: ChartState })[]>>(
        STORAGE_KEYS.localWorkspaces,
        {},
      );
      const allAlerts = safeRead<Record<string, AlertItem[]>>(STORAGE_KEYS.localAlerts, {});
      setSaved(allWs[accountEmail] ?? []);
      setAlerts(allAlerts[accountEmail] ?? []);
    }
  }

  useEffect(() => {
    if (token) {
      void refreshUserData(token, userEmail).catch(() => {});
    }
  }, [token, isBackendMode]);

  useEffect(() => {
    if (!isBackendMode || !token) return;
    const timer = setInterval(async () => {
      try {
        const items = (await request("/alerts/outbox", "GET", undefined, token)) as {
          id: number;
          alert_id: string;
          payload: {
            symbol: string;
            direction: AlertDirection;
            threshold: number;
            price: number;
            triggeredAt: string;
          };
        }[];
        if (!items?.length) return;
        for (const item of items) {
          await request(`/alerts/outbox/${item.id}/ack`, "POST", undefined, token);
          setNotifications((prev) => [
            {
              id: String(item.id),
              alertId: item.alert_id,
              symbol: item.payload.symbol,
              direction: item.payload.direction,
              threshold: item.payload.threshold,
              price: item.payload.price,
              triggeredAt: item.payload.triggeredAt,
            },
            ...prev.slice(0, 9),
          ]);
        }
        playAlertTone();
        await refreshUserData(token, userEmail);
      } catch {}
    }, 5000);
    return () => clearInterval(timer);
  }, [isBackendMode, token, userEmail]);

  useEffect(() => {
    if (!currentPrice || !Number.isFinite(currentPrice)) return;
    const prev = prevPriceRef.current;
    prevPriceRef.current = currentPrice;
    if (prev === undefined || prev === currentPrice || !token) return;

    const active = alerts.filter((a) => a.status === "active");
    if (!active.length) return;

    const triggeredIds = new Set<string>();
    const newlyTriggered: TriggeredNotification[] = [];

    for (const alert of active) {
      const crossedAbove =
        alert.direction === "crosses_above" && prev <= alert.threshold && currentPrice > alert.threshold;
      const crossedBelow =
        alert.direction === "crosses_below" && prev >= alert.threshold && currentPrice < alert.threshold;
      if (crossedAbove || crossedBelow) {
        triggeredIds.add(alert.id);
        newlyTriggered.push({
          id: `${alert.id}-${Date.now()}`,
          alertId: alert.id,
          symbol: alert.symbol,
          direction: alert.direction,
          threshold: alert.threshold,
          price: currentPrice,
          triggeredAt: new Date().toISOString(),
        });
      }
    }

    if (triggeredIds.size > 0) {
      const nowIso = new Date().toISOString();
      const updated = alerts.map((a) =>
        triggeredIds.has(a.id) ? { ...a, status: "triggered" as const, triggered_at: nowIso } : a,
      );
      setAlerts(updated);
      setNotifications((prevList) => [...newlyTriggered, ...prevList].slice(0, 10));
      playAlertTone();
      if (!isBackendMode && userEmail) {
        const allAlerts = safeRead<Record<string, AlertItem[]>>(STORAGE_KEYS.localAlerts, {});
        allAlerts[userEmail] = updated;
        safeWrite(STORAGE_KEYS.localAlerts, allAlerts);
      }
    }
  }, [currentPrice, alerts, token, isBackendMode, userEmail]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setMessage("");
    try {
      await action();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mb-4 rounded-2xl border border-slate-800 bg-[#10151e] p-4" aria-label="Saved workspaces and alerts">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 pb-3 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 font-medium ${
              isBackendMode
                ? "border border-emerald-500/40 bg-emerald-950/60 text-emerald-300"
                : "border border-violet-500/40 bg-violet-950/60 text-violet-300"
            }`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${isBackendMode ? "bg-emerald-400" : "bg-violet-400"}`} />
            {isBackendMode ? `Cloud Backend (${activeApi})` : "Browser Storage Mode (GitHub Pages Fallback)"}
          </span>
          <span className="text-slate-400">
            {isBackendMode
              ? "Always-on 24/7 PostgreSQL alerts, accounts & workspaces active."
              : "Local profiles and layouts stay on this device. Alerts run only while this tab is active; browser profiles are not secure cloud accounts."}
          </span>
        </div>
        <button
          type="button"
          onClick={() => setShowApiConfig((v) => !v)}
          className="rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1 text-xs text-slate-300 hover:border-slate-600 hover:text-white"
        >
          {showApiConfig ? "Hide Backend Settings" : "Configure Backend Host"}
        </button>
      </div>

      {showApiConfig && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-slate-800 bg-[#090e16] p-3 text-xs">
          <label htmlFor="backend-api-url" className="font-medium text-slate-300">
            Backend API URL:
          </label>
          <input
            id="backend-api-url"
            type="url"
            placeholder="https://hexaview-api.onrender.com (leave empty for Browser Mode)"
            value={apiDraft}
            onChange={(e) => setApiDraft(e.target.value)}
            className="min-w-[260px] flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-slate-100"
          />
          <button
            type="button"
            onClick={() => {
              const cleaned = apiDraft.trim().replace(/\/$/, "");
              setCustomApi(cleaned);
              safeWrite(STORAGE_KEYS.apiUrl, cleaned);
              setToken("");
              setUserEmail("");
              safeWrite(STORAGE_KEYS.session, null);
              setShowApiConfig(false);
              setMessage(
                cleaned
                  ? `Connected to backend ${cleaned}. Please sign in.`
                  : "Switched to Browser Storage Mode.",
              );
            }}
            className="rounded-lg bg-violet-600 px-3 py-1.5 font-medium text-white hover:bg-violet-500"
          >
            Save Connection
          </button>
        </div>
      )}

      {notifications.length > 0 && (
        <div className="mb-3 space-y-1.5" role="region" aria-label="Triggered alert notifications">
          {notifications.map((n) => (
            <div
              key={n.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-500/40 bg-amber-950/40 px-3 py-2 text-xs text-amber-200"
            >
              <span>
                <strong>ALERT TRIGGERED:</strong> {n.symbol}{" "}
                {n.direction === "crosses_above" ? "crossed above" : "crossed below"}{" "}
                <strong>${n.threshold.toLocaleString("en-US", { minimumFractionDigits: 2 })}</strong> (fill price $
                {n.price.toLocaleString("en-US", { minimumFractionDigits: 2 })})
              </span>
              <button
                type="button"
                onClick={() => setNotifications((list) => list.filter((item) => item.id !== n.id))}
                className="rounded border border-amber-500/40 px-2 py-0.5 text-[11px] hover:bg-amber-900/50"
              >
                Dismiss
              </button>
            </div>
          ))}
        </div>
      )}

      <fieldset disabled={busy} className="space-y-3">
        {!token ? (
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                const normalizedEmail = email.trim().toLowerCase();
                if (isBackendMode) {
                  const result = (await request(
                    register ? "/auth/register" : "/auth/login",
                    "POST",
                    {
                      email: normalizedEmail,
                      password,
                      ...(register ? { handle, displayName: handle } : {}),
                    },
                  )) as { token: string };
                  setToken(result.token);
                  setUserEmail(normalizedEmail);
                  setPassword("");
                  safeWrite(STORAGE_KEYS.session, {
                    token: result.token,
                    email: normalizedEmail,
                    mode: "backend",
                  });
                  await refreshUserData(result.token, normalizedEmail);
                  setMessage(`Signed in as ${normalizedEmail} (Cloud Backend).`);
                } else {
                  const users = safeRead<Record<string, LocalAccount>>(STORAGE_KEYS.localUsers, {});
                  if (register) {
                    if (users[normalizedEmail]) throw new Error("Account already exists in browser storage");
                    users[normalizedEmail] = {
                      email: normalizedEmail,
                      handle: handle || normalizedEmail.split("@")[0],
                      passwordHash: await hashLocalPassword(password),
                    };
                    safeWrite(STORAGE_KEYS.localUsers, users);
                  } else {
                    const existing = users[normalizedEmail];
                    const checked = existing ? await verifyLocalPassword(password, existing.passwordHash) : {valid:false,upgrade:false};
                    if (!checked.valid) {
                      throw new Error("Invalid email or password (or click Register to create an account)");
                    }
                  }
                  if (!register) {
                    const account = users[normalizedEmail];
                    if (!account.passwordHash.startsWith("pbkdf2-sha256$")) {
                      account.passwordHash = await hashLocalPassword(password);
                      safeWrite(STORAGE_KEYS.localUsers, users);
                    }
                  }
                  const localToken = `local_${btoa(normalizedEmail).replace(/=/g, "")}`;
                  setToken(localToken);
                  setUserEmail(normalizedEmail);
                  setPassword("");
                  safeWrite(STORAGE_KEYS.session, {
                    token: localToken,
                    email: normalizedEmail,
                    mode: "local",
                  });
                  await refreshUserData(localToken, normalizedEmail);
                  setMessage(`Signed in as ${normalizedEmail}.`);
                }
              });
            }}
          >
            <input
              aria-label="Email"
              type="email"
              placeholder="trader@example.com"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="rounded-lg border border-slate-700 bg-[#090e16] px-3 py-1.5 text-sm text-slate-100"
            />
            <input
              aria-label="Password"
              type="password"
              placeholder="Password (12+ chars)"
              autoComplete={register ? "new-password" : "current-password"}
              minLength={12}
              maxLength={128}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="rounded-lg border border-slate-700 bg-[#090e16] px-3 py-1.5 text-sm text-slate-100"
            />
            {register && (
              <input
                aria-label="Handle"
                placeholder="handle"
                pattern="[a-z0-9_]{3,30}"
                required
                value={handle}
                onChange={(e) => setHandle(e.target.value)}
                className="rounded-lg border border-slate-700 bg-[#090e16] px-3 py-1.5 text-sm text-slate-100"
              />
            )}
            <button
              type="submit"
              className="rounded-lg bg-violet-600 px-3.5 py-1.5 text-sm font-medium text-white hover:bg-violet-500"
            >
              {register ? "Create account" : "Sign in"}
            </button>
            <button
              type="button"
              onClick={() => setRegister((v) => !v)}
              className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800"
            >
              {register ? "Use existing account" : "Register"}
            </button>
          </form>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Layouts:</span>
              <input
                aria-label="Workspace name"
                maxLength={80}
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="rounded-lg border border-slate-700 bg-[#090e16] px-3 py-1.5 text-sm text-slate-100"
              />
              <button
                type="button"
                onClick={() =>
                  void run(async () => {
                    if (isBackendMode) {
                      const result = (await request("/workspaces", "POST", { name, state })) as SavedWorkspace;
                      setSelected(result);
                      await refreshUserData();
                    } else {
                      const allWs = safeRead<Record<string, (SavedWorkspace & { state: ChartState })[]>>(
                        STORAGE_KEYS.localWorkspaces,
                        {},
                      );
                      const userList = allWs[userEmail] ?? [];
                      const item = {
                        id: crypto.randomUUID(),
                        name: name.trim() || "Untitled workspace",
                        version: 1,
                        state,
                      };
                      allWs[userEmail] = [item, ...userList];
                      safeWrite(STORAGE_KEYS.localWorkspaces, allWs);
                      setSelected(item);
                      setSaved(allWs[userEmail]);
                    }
                    setMessage("Saved as new workspace.");
                  })
                }
                className="rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-500"
              >
                Save new
              </button>
              <button
                type="button"
                disabled={!selected}
                onClick={() =>
                  void run(async () => {
                    if (!selected) return;
                    if (isBackendMode) {
                      const result = (await request(`/workspaces/${selected.id}`, "PUT", {
                        name,
                        state,
                        version: selected.version,
                      })) as SavedWorkspace;
                      setSelected(result);
                      await refreshUserData();
                    } else {
                      const allWs = safeRead<Record<string, (SavedWorkspace & { state: ChartState })[]>>(
                        STORAGE_KEYS.localWorkspaces,
                        {},
                      );
                      const userList = allWs[userEmail] ?? [];
                      const updatedList = userList.map((w) =>
                        w.id === selected.id ? { ...w, name, state, version: w.version + 1 } : w,
                      );
                      allWs[userEmail] = updatedList;
                      safeWrite(STORAGE_KEYS.localWorkspaces, allWs);
                      const updatedItem = updatedList.find((w) => w.id === selected.id) ?? null;
                      setSelected(updatedItem);
                      setSaved(updatedList);
                    }
                    setMessage("Workspace updated.");
                  })
                }
                className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-800 disabled:opacity-40"
              >
                Update loaded
              </button>
              <select
                aria-label="Load workspace"
                value={selected?.id ?? ""}
                onChange={(e) => {
                  const id = e.target.value;
                  if (!id) {
                    setSelected(null);
                    return;
                  }
                  void run(async () => {
                    let item: (SavedWorkspace & { state: ChartState }) | undefined;
                    if (isBackendMode) {
                      item = (await request(`/workspaces/${id}`)) as SavedWorkspace & { state: ChartState };
                    } else {
                      const allWs = safeRead<Record<string, (SavedWorkspace & { state: ChartState })[]>>(
                        STORAGE_KEYS.localWorkspaces,
                        {},
                      );
                      item = (allWs[userEmail] ?? []).find((w) => w.id === id);
                    }
                    if (
                      !item ||
                      item.state.schemaVersion !== 1 ||
                      item.state.symbol !== "BTCUSDT" ||
                      !isInterval(item.state.interval) ||
                      typeof item.state.showSma !== "boolean"
                    ) {
                      throw new Error("Unsupported saved layout");
                    }
                    if (item.state.script) {
                      parseHexaScript(item.state.script);
                    }
                    setSelected(item);
                    setName(item.name);
                    onLoad(item.state);
                    setMessage(`Loaded workspace "${item.name}".`);
                  });
                }}
                className="rounded-lg border border-slate-700 bg-[#090e16] px-3 py-1.5 text-xs text-slate-200"
              >
                <option value="">Load workspace ({saved.length})...</option>
                {saved.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} (v{item.version})
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() =>
                  void run(async () => {
                    if (isBackendMode) {
                      await request("/auth/logout", "POST").catch(() => {});
                    }
                    setToken("");
                    setUserEmail("");
                    setSelected(null);
                    setSaved([]);
                    setAlerts([]);
                    safeWrite(STORAGE_KEYS.session, null);
                    setMessage("Signed out.");
                  })
                }
                className="ml-auto rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
              >
                Sign out ({userEmail || "user"})
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2 border-t border-slate-800/80 pt-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Price Alerts:</span>
              <select
                aria-label="Alert direction"
                value={alertDirection}
                onChange={(e) => setAlertDirection(e.target.value as AlertDirection)}
                className="rounded-lg border border-slate-700 bg-[#090e16] px-2.5 py-1.5 text-xs text-slate-200"
              >
                <option value="crosses_above">BTCUSDT Crosses Above ↑</option>
                <option value="crosses_below">BTCUSDT Crosses Below ↓</option>
              </select>
              <input
                aria-label="Alert price threshold"
                type="number"
                step="0.01"
                min="1"
                placeholder={currentPrice ? `e.g. ${Math.round(currentPrice + 250)}` : "Price (USDT)"}
                value={alertThreshold}
                onChange={(e) => setAlertThreshold(e.target.value)}
                className="w-40 rounded-lg border border-slate-700 bg-[#090e16] px-3 py-1.5 text-xs text-slate-100 tabular-nums"
              />
              <button
                type="button"
                onClick={() =>
                  void run(async () => {
                    const threshold = Number(alertThreshold);
                    if (!Number.isFinite(threshold) || threshold <= 0) {
                      throw new Error("Enter a valid positive price threshold");
                    }
                    if (isBackendMode) {
                      await request("/alerts", "POST", {
                        venue: "BINANCE",
                        symbol: "BTCUSDT",
                        direction: alertDirection,
                        threshold,
                      });
                      await refreshUserData();
                    } else {
                      const allAlerts = safeRead<Record<string, AlertItem[]>>(STORAGE_KEYS.localAlerts, {});
                      const userAlerts = allAlerts[userEmail] ?? [];
                      const created: AlertItem = {
                        id: crypto.randomUUID(),
                        symbol: "BTCUSDT",
                        direction: alertDirection,
                        threshold,
                        status: "active",
                        created_at: new Date().toISOString(),
                      };
                      allAlerts[userEmail] = [created, ...userAlerts];
                      safeWrite(STORAGE_KEYS.localAlerts, allAlerts);
                      setAlerts(allAlerts[userEmail]);
                    }
                    setAlertThreshold("");
                    setMessage(
                      `Alert set: BTCUSDT ${
                        alertDirection === "crosses_above" ? "crosses above" : "crosses below"
                      } $${threshold.toLocaleString("en-US", { minimumFractionDigits: 2 })}`,
                    );
                  })
                }
                className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500"
              >
                + Add Alert
              </button>
              <div className="flex flex-wrap items-center gap-1.5">
                {alerts.slice(0, 8).map((item) => (
                  <span
                    key={item.id}
                    className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs tabular-nums ${
                      item.status === "triggered"
                        ? "border-amber-500/40 bg-amber-950/40 text-amber-300"
                        : item.direction === "crosses_above"
                          ? "border-emerald-500/30 bg-emerald-950/30 text-emerald-300"
                          : "border-rose-500/30 bg-rose-950/30 text-rose-300"
                    }`}
                  >
                    <span>
                      {item.direction === "crosses_above" ? "↑" : "↓"} $
                      {Number(item.threshold).toLocaleString("en-US", { minimumFractionDigits: 2 })}
                    </span>
                    <span className="text-[10px] uppercase opacity-75">({item.status})</span>
                    <button
                      type="button"
                      onClick={() =>
                        void run(async () => {
                          if (isBackendMode) {
                            await request(`/alerts/${item.id}`, "DELETE");
                            await refreshUserData();
                          } else {
                            const allAlerts = safeRead<Record<string, AlertItem[]>>(STORAGE_KEYS.localAlerts, {});
                            allAlerts[userEmail] = (allAlerts[userEmail] ?? []).filter((a) => a.id !== item.id);
                            safeWrite(STORAGE_KEYS.localAlerts, allAlerts);
                            setAlerts(allAlerts[userEmail]);
                          }
                          setMessage("Alert removed.");
                        })
                      }
                      className="ml-0.5 text-slate-400 hover:text-white"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}
      </fieldset>
      <p role="status" className="mt-2 text-xs text-slate-400">
        {busy ? "Working..." : message}
      </p>
    </section>
  );
}

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

/**
 * Resilience layer for the local Prisma dev server (PGlite/WASM): its port is
 * dynamic and it restarts independently from `next dev`, so pooled sockets die
 * and queries fail with P1017 ("Server has closed the connection"). Instead of
 * wrapping every call site, the client itself is proxied: every model delegate
 * method and $-method automatically retries on a fresh pool when the connection
 * was dropped. Non-connection errors always propagate unchanged.
 */

const RETRYABLE_CODES = new Set(["P1001", "P1002", "P1008", "P1017", "P2024"]);
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 150;

function createClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set. Copy .env.example to .env and configure it.");
  }
  // Small pool with short idle/lifetime so stale sockets are recycled quickly.
  return new PrismaClient({
    adapter: new PrismaPg({
      connectionString,
      max: 5,
      idleTimeoutMillis: 30_000,
      maxUses: 500,
      connectionTimeoutMillis: 5_000,
    }),
  });
}

type ClientState = { client: PrismaClient };

const globalForPrisma = globalThis as unknown as { prismaState?: ClientState };

// One pool per process: Next.js dev hot-reload would otherwise leak connections.
const state: ClientState = globalForPrisma.prismaState ?? { client: createClient() };
globalForPrisma.prismaState = state;

let lastResetAt = 0;

function resetClient() {
  // Single-flight: concurrent retries share the fresh pool instead of each
  // creating (and disconnecting) pools under each other.
  const now = Date.now();
  if (now - lastResetAt < 1_000) return;
  lastResetAt = now;
  const stale = state.client;
  state.client = createClient();
  // Delayed disconnect: in-flight queries may still use the stale pool.
  // Ending it immediately makes siblings fail with "Cannot use a pool after
  // calling end on the pool".
  setTimeout(() => {
    stale.$disconnect().catch(() => undefined);
  }, 10_000);
}

function isRetryable(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  if (typeof code === "string" && RETRYABLE_CODES.has(code)) return true;
  // Driver-level connection loss sometimes surfaces without a Prisma code
  // (e.g. pool ended by a sibling retry, or raw ConnectionClosed).
  const message = (error as { message?: unknown } | null)?.message;
  if (typeof message === "string") {
    if (message.includes("Cannot use a pool after calling end")) return true;
    if (message.includes("Server has closed the connection")) return true;
    if (message.includes("ConnectionClosed") || message.includes("connection closed")) return true;
  }
  return false;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// $transaction must never auto-retry: the callback may have partially executed.
const NO_RETRY_METHODS = new Set(["$transaction", "$extends"]);

async function invokeWithRetry(getMethod: () => (...args: never[]) => Promise<unknown>, args: unknown[]): Promise<unknown> {
  let attempt = 0;
  for (;;) {
    try {
      return await getMethod()(...(args as never[]));
    } catch (error) {
      attempt += 1;
      if (attempt > MAX_RETRIES || !isRetryable(error)) throw error;
      resetClient();
      await sleep(RETRY_DELAY_MS * attempt);
    }
  }
}

/** Proxy for a model delegate (e.g. prisma.product): resolves the delegate fresh on every call. */
function wrapDelegate(delegateKey: PropertyKey): unknown {
  return new Proxy(Object.create(null), {
    get(_target, methodProp) {
      const freshDelegate = (state.client as unknown as Record<PropertyKey, unknown>)[delegateKey] as Record<
        PropertyKey,
        unknown
      >;
      const value = freshDelegate?.[methodProp];
      if (typeof value !== "function") return value;
      return (...args: unknown[]) =>
        invokeWithRetry(
          () =>
            (
              (state.client as unknown as Record<PropertyKey, Record<PropertyKey, (...a: never[]) => Promise<unknown>>>)[delegateKey][
                methodProp
              ] as (...a: never[]) => Promise<unknown>
            ).bind(
              (state.client as unknown as Record<PropertyKey, unknown>)[delegateKey],
            ),
          args,
        );
    },
  });
}

/**
 * Transparent wrapper: every method resolves against `state.client` at call
 * time, so `resetClient()` actually swaps the pool. Model delegates
 * (plain objects like `prisma.product`) are wrapped one level deep so
 * `prisma.product.findMany()` retries as well.
 */
function resilient(): PrismaClient {
  const delegateCache = new Map<PropertyKey, unknown>();
  return new Proxy(Object.create(null), {
    get(_target, prop) {
      if (prop === "then" || prop === "catch" || prop === "finally") return undefined;
      if (typeof prop !== "string") {
        return (state.client as unknown as Record<PropertyKey, unknown>)[prop];
      }
      if (NO_RETRY_METHODS.has(prop)) {
        const value = (state.client as unknown as Record<PropertyKey, unknown>)[prop];
        return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(state.client) : value;
      }
      const freshValue = (state.client as unknown as Record<PropertyKey, unknown>)[prop];
      if (freshValue !== null && typeof freshValue === "object") {
        if (!delegateCache.has(prop)) delegateCache.set(prop, wrapDelegate(prop));
        return delegateCache.get(prop);
      }
      if (typeof freshValue === "function") {
        return (...args: unknown[]) =>
          invokeWithRetry(
            () =>
              ((state.client as unknown as Record<PropertyKey, unknown>)[prop] as (...a: never[]) => Promise<unknown>).bind(
                state.client,
              ),
            args,
          );
      }
      return freshValue;
    },
    has(_target, prop) {
      return prop in state.client;
    },
  }) as PrismaClient;
}

export const prisma = resilient();

export type { PrismaClient };

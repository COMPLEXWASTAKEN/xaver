export type ToastTone = "ok" | "info" | "warn" | "error";

export type Toast = {
  id: number;
  tone: ToastTone;
  title: string;
  body?: string;
  ttl: number;
  count: number;
  action?: { label: string; run: () => void };
};

type ToastInput = Omit<Toast, "id" | "ttl" | "count"> & { ttl?: number };

const MAX = 4;
const subs = new Set<(list: Toast[]) => void>();
let list: Toast[] = [];
let seq = 0;

function publish(): void {
  const snap = [...list];
  subs.forEach((fn) => fn(snap));
}

export function toast(input: ToastInput): number {
  const same = list.find((t) => t.title === input.title && t.body === input.body && t.tone === input.tone);
  if (same) {
    list = list.map((t) => (t === same ? { ...t, id: ++seq, count: t.count + 1 } : t));
    publish();
    return seq;
  }
  const ttl = input.ttl ?? (input.tone === "error" ? 8000 : 5000);
  list = [...list, { ...input, id: ++seq, ttl, count: 1 }].slice(-MAX);
  publish();
  return seq;
}

export function dismissToast(id: number): void {
  const next = list.filter((t) => t.id !== id);
  if (next.length === list.length) return;
  list = next;
  publish();
}

export function subscribeToasts(fn: (list: Toast[]) => void): () => void {
  subs.add(fn);
  fn([...list]);
  return () => subs.delete(fn);
}

export function errorText(e: unknown): string {
  return String((e as Error)?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
}

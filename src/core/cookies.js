import fs from "node:fs";

function stripQuotes(s) {
  const t = String(s ?? "").trim();
  if (
    (t.startsWith('"') && t.endsWith('"')) ||
    (t.startsWith("'") && t.endsWith("'"))
  ) {
    return t.slice(1, -1);
  }
  return t;
}

function parseExpires(raw) {
  const v = stripQuotes(raw);
  if (!v || v === "0") return undefined;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  if (n > 1e12) return Math.floor(n / 1000);
  return Math.floor(n);
}

function parseNetscapeLine(line) {

  const parts = line.split("\t");
  if (parts.length < 7) return null;
  const domain = parts[0].trim();
  const path = parts[2].trim() || "/";
  const secure = String(parts[3]).toUpperCase() === "TRUE";
  const expires = parseExpires(parts[4]);
  const name = parts[5].trim();
  const value = parts[6].trim();
  if (!name) return null;
  const cookie = {
    name,
    value,
    domain,
    path,
    secure: secure || name === "auth_token" || name === "ct0" || name === "kdt",
    httpOnly: name === "auth_token" || name === "kdt",
    sameSite: "Lax"
  };
  if (expires != null) cookie.expires = expires;
  return cookie;
}


export function parseCookieText(text) {
  const cookies = [];
  const lines = String(text || "").split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("//")) continue;
    if (trimmed.startsWith("#") && !trimmed.startsWith("#HttpOnly_")) continue;


    if (trimmed.includes("\t") || /^#HttpOnly_/i.test(trimmed)) {
      const netscape = parseNetscapeLine(trimmed.replace(/^#HttpOnly_/i, ""));
      if (netscape) {
        cookies.push(netscape);
        continue;
      }
    }

    let body = trimmed;
    if (/^Set-Cookie3:\s*/i.test(body)) {
      body = body.replace(/^Set-Cookie3:\s*/i, "");
    } else if (/^Set-Cookie:\s*/i.test(body)) {
      body = body.replace(/^Set-Cookie:\s*/i, "");
    }

    const parts = body.split(";").map((p) => p.trim()).filter(Boolean);
    if (parts.length === 0) continue;

    const nv = parts[0];
    const eq = nv.indexOf("=");
    if (eq <= 0) continue;
    const name = nv.slice(0, eq).trim();
    const value = nv.slice(eq + 1).trim();
    if (!name) continue;

    const attrs = Object.create(null);
    for (let i = 1; i < parts.length; i++) {
      const p = parts[i];
      const aeq = p.indexOf("=");
      if (aeq === -1) {
        attrs[p.toLowerCase()] = true;
        continue;
      }
      const k = p.slice(0, aeq).trim().toLowerCase();
      const val = stripQuotes(p.slice(aeq + 1).trim());
      attrs[k] = val;
    }

    let domain = String(attrs.domain || ".x.com").trim();
    if (!domain) domain = ".x.com";

    const path = stripQuotes(attrs.path || "/") || "/";
    const expires = parseExpires(attrs.expires);
    const secure =
      attrs.secure === true ||
      name === "auth_token" ||
      name === "ct0" ||
      name === "kdt";

    const cookie = {
      name,
      value,
      domain,
      path,
      secure,
      httpOnly: name === "auth_token" || name === "kdt",
      sameSite: "Lax"
    };
    if (expires != null) cookie.expires = expires;
    cookies.push(cookie);
  }

  if (cookies.length === 0) {
    throw new Error("No cookies parsed. Use an EditThisCookie Set-Cookie3 or Netscape export.");
  }

  const names = new Set(cookies.map((c) => c.name));
  if (!names.has("auth_token") || !names.has("ct0")) {
    throw new Error("Cookie export must include auth_token and ct0 for a logged-in session.");
  }

  return cookies;
}

export function parseCookieFile(filePath) {
  const text = fs.readFileSync(filePath, "utf8");
  return parseCookieText(text);
}


export function expandCookiesForX(cookies) {
  const out = [];
  const seen = new Set();
  for (const c of cookies) {
    const hosts = new Set([c.domain]);
    const d = c.domain.replace(/^\./, "").toLowerCase();
    if (d === "x.com" || d.endsWith(".x.com")) {
      hosts.add(".x.com");
      hosts.add("x.com");
      hosts.add(".twitter.com");
      hosts.add("twitter.com");
    }
    if (d === "twitter.com" || d.endsWith(".twitter.com")) {
      hosts.add(".twitter.com");
      hosts.add("twitter.com");
      hosts.add(".x.com");
      hosts.add("x.com");
    }
    for (const domain of hosts) {
      const key = `${domain}\t${c.path}\t${c.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ ...c, domain });
    }
  }
  return out;
}

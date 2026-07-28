/*
  Drive Screen proxy, Netlify version

  Put this file at   netlify/edge-functions/proxy.js
  and netlify.toml at the top of the same folder as index.html.

  Your app is on https because Netlify forces it. Your IPTV service is on plain
  http on port 2029. Browsers refuse that mix. This runs on Netlify itself,
  talks to the service over http, and rewrites the channel playlist so every
  piece of video comes back through your own secure address.

  After you deploy, open Setup in the app and put this in the proxy field,
  exactly like this, keeping the ending:

    /proxy?k=2692&url=

  A plain path is enough because it lives on the same site as the app.
  Change the key below if you want, then change it in that address too.
*/

const KEY = "2692";

const ALLOW = [
  "ismarter.xyz",
  "iptv-org.github.io"
];

export default async (request) => {
  const here = new URL(request.url);

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors() });
  }

  const target = here.searchParams.get("url");
  if (!target) {
    return new Response("Drive Screen proxy is running.", {
      status: 200,
      headers: cors({ "content-type": "text/plain" })
    });
  }

  if (here.searchParams.get("k") !== KEY) {
    return new Response("Wrong key.", { status: 403, headers: cors() });
  }

  let aim;
  try {
    aim = new URL(target);
  } catch (e) {
    return new Response("That is not a link.", { status: 400, headers: cors() });
  }

  const host = aim.hostname.toLowerCase();
  if (!ALLOW.some((h) => host === h || host.endsWith("." + h))) {
    return new Response("That host is not on the allow list.", { status: 403, headers: cors() });
  }

  const send = new Headers();
  const range = request.headers.get("range");
  if (range) send.set("range", range);
  send.set("user-agent", request.headers.get("user-agent") || "VLC/3.0.20");

  let hit;
  try {
    hit = await fetch(aim.toString(), { headers: send, redirect: "follow" });
  } catch (e) {
    return new Response("The service did not answer.", { status: 502, headers: cors() });
  }

  const type = (hit.headers.get("content-type") || "").toLowerCase();
  const path = aim.pathname.toLowerCase();
  const playlist =
    type.indexOf("mpegurl") > -1 || path.indexOf(".m3u8") > -1 || path.indexOf(".m3u") > -1;

  if (playlist) {
    const text = await hit.text();
    if (text.indexOf("#EXTM3U") > -1 || text.indexOf("#EXTINF") > -1) {
      return new Response(rewrite(text, aim, here.origin), {
        status: hit.status,
        headers: cors({ "content-type": "application/vnd.apple.mpegurl" })
      });
    }
    return new Response(text, {
      status: hit.status,
      headers: cors({ "content-type": type || "text/plain" })
    });
  }

  const out = cors();
  ["content-type", "content-length", "content-range", "accept-ranges", "cache-control"].forEach((h) => {
    const v = hit.headers.get(h);
    if (v) out.set(h, v);
  });
  return new Response(hit.body, { status: hit.status, headers: out });
};

function wrap(link, origin) {
  return origin + "/proxy?k=" + encodeURIComponent(KEY) + "&url=" + encodeURIComponent(link);
}

function rewrite(text, aim, origin) {
  const lines = text.split(/\r?\n/);
  const out = [];
  for (const line of lines) {
    const flat = line.trim();
    if (!flat) { out.push(line); continue; }
    if (flat.charAt(0) === "#") {
      out.push(
        line.replace(/URI="([^"]+)"/g, (m, u) => {
          try { return 'URI="' + wrap(new URL(u, aim).toString(), origin) + '"'; }
          catch (e) { return m; }
        })
      );
      continue;
    }
    try { out.push(wrap(new URL(flat, aim).toString(), origin)); }
    catch (e) { out.push(line); }
  }
  return out.join("\n");
}

function cors(extra) {
  const h = new Headers(extra || {});
  h.set("access-control-allow-origin", "*");
  h.set("access-control-allow-headers", "range, content-type");
  h.set("access-control-expose-headers", "content-length, content-range, accept-ranges");
  h.set("access-control-allow-methods", "GET, HEAD, OPTIONS");
  return h;
}

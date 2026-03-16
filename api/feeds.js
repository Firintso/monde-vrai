// api/feeds.js — Fonction serverless Vercel
// Récupère tous les flux RSS côté serveur (pas de CORS, pas de proxy)
// Vercel met en cache la réponse 30 minutes automatiquement

const https = require("https");
const http = require("http");
const { DOMParser } = require("@xmldom/xmldom");

const FEEDS = [
  { id: "f24",  url: "https://www.france24.com/fr/rss",                                          name: "France 24",    col: "#1a6ea8", rel: 4 },
  { id: "rfi",  url: "https://www.rfi.fr/fr/rss",                                                name: "RFI",          col: "#c0392b", rel: 4 },
  { id: "lm",   url: "https://www.lemonde.fr/rss/une.xml",                                       name: "Le Monde",     col: "#1a5276", rel: 5 },
  { id: "bbcm", url: "https://feeds.bbci.co.uk/mundo/rss.xml",                                   name: "BBC Mundo",    col: "#bb1919", rel: 5 },
  { id: "alla", url: "https://allafrica.com/tools/headlines/rdf/latest/headlines.rdf",            name: "AllAfrica",    col: "#7d6608", rel: 3 },
  { id: "bbc",  url: "https://feeds.bbci.co.uk/news/world/rss.xml",                              name: "BBC World",    col: "#bb1919", rel: 5 },
  { id: "alj",  url: "https://www.aljazeera.com/xml/rss/all.xml",                                name: "Al Jazeera",   col: "#c8960c", rel: 4 },
  { id: "dw",   url: "https://rss.dw.com/rdf/rss-en-all",                                        name: "DW",           col: "#007b5e", rel: 4 },
  { id: "gua",  url: "https://www.theguardian.com/world/rss",                                    name: "The Guardian", col: "#234f6e", rel: 4 },
  { id: "voa",  url: "https://feeds.voanews.com/voaenglish/world",                               name: "VOA",          col: "#1a3a6b", rel: 4 },
  { id: "npr",  url: "https://feeds.npr.org/1004/rss.xml",                                       name: "NPR",          col: "#1b4f72", rel: 4 },
  { id: "bspt", url: "https://feeds.bbci.co.uk/sport/rss.xml",                                   name: "BBC Sport",    col: "#bb1919", rel: 5, cat: "sport" },
];

// Fetch simple avec timeout, sans dépendances externes
function fetchUrl(url, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https") ? https : http;
    const timer = setTimeout(() => reject(new Error("timeout")), timeoutMs);
    const req = lib.get(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; MondeVrai/1.0)" } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        clearTimeout(timer);
        fetchUrl(res.headers.location, timeoutMs).then(resolve).catch(reject);
        return;
      }
      if (res.statusCode !== 200) {
        clearTimeout(timer);
        reject(new Error("HTTP " + res.statusCode));
        return;
      }
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => { clearTimeout(timer); resolve(Buffer.concat(chunks).toString("utf8")); });
      res.on("error", (e) => { clearTimeout(timer); reject(e); });
    });
    req.on("error", (e) => { clearTimeout(timer); reject(e); });
  });
}

function stripH(h) {
  if (!h) return "";
  return h
    .replace(/<!\[CDATA\[/g, "").replace(/\]\]>/g, "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => { try { return String.fromCharCode(+n); } catch { return " "; } })
    .replace(/&[a-z]{1,8};/g, " ")
    .replace(/\s+/g, " ").trim().substring(0, 300);
}

function xget(el, names) {
  for (const name of names) {
    const local = name.includes(":") ? name.split(":")[1] : name;
    let els = el.getElementsByTagName(local);
    if (els.length > 0 && els[0].textContent && els[0].textContent.trim()) return els[0].textContent.trim();
    els = el.getElementsByTagName(name);
    if (els.length > 0 && els[0].textContent && els[0].textContent.trim()) return els[0].textContent.trim();
  }
  return "";
}

function xlink(el) {
  const els = el.getElementsByTagName("link");
  for (let i = 0; i < els.length; i++) {
    const h = els[i].getAttribute("href") || "";
    if (h.startsWith("http")) return h;
    const txt = (els[i].textContent || "").trim();
    if (txt.startsWith("http")) return txt;
  }
  const orig = xget(el, ["origLink"]);
  return orig && orig.startsWith("http") ? orig : "";
}

function xthumb(el) {
  let els = el.getElementsByTagName("thumbnail");
  if (els.length > 0) { const u = els[0].getAttribute("url") || ""; if (u.startsWith("http")) return u; }
  els = el.getElementsByTagName("content");
  for (let i = 0; i < els.length; i++) {
    const u = els[i].getAttribute("url") || "";
    if (u.startsWith("http") && /\.(jpg|jpeg|png|webp|gif)/i.test(u)) return u;
  }
  els = el.getElementsByTagName("enclosure");
  if (els.length > 0) {
    const tp = els[i = 0] && els[0].getAttribute("type") || "";
    const u = els[0].getAttribute("url") || "";
    if (tp.includes("image") && u.startsWith("http")) return u;
  }
  return "";
}

function dReg(s) {
  s = s.toLowerCase();
  if (/iran|iraq|israel|palestin|hamas|hezbollah|syria|liban|lebanon|yemen|saudi|qatar|kuwait|uae|tehran|jerusalem|gaza|moyen.orient|middle east|golfe/.test(s)) return "me";
  if (/ukraine|russia|france|germany|britain|\buk\b|england|italy|spain|poland|nato|european|turkey|berlin|paris|london|rome|madrid|warsaw|kyiv/.test(s)) return "eu";
  if (/china|japan|korea|india|pakistan|vietnam|indonesia|philippines|taiwan|hong kong|beijing|tokyo|seoul|delhi|\basia\b|myanmar|afghanistan/.test(s)) return "as";
  if (/kremlin|putin|moscow|kazakhstan|uzbekistan|caucasus|georgia|armenia|azerbaijan|belarus/.test(s)) return "ru";
  if (/\bafrica\b|nigeria|kenya|ethiopia|ghana|senegal|mali|niger|burkina|sudan|somalia|congo|cameroon|mozambique|tanzania|south africa|nairobi|lagos|sahel|madagascar|afrique/.test(s)) return "af";
  if (/america|united states|\busa\b|canada|brazil|mexico|argentina|colombia|venezuela|chile|peru|cuba|haiti|washington|new york|latin/.test(s)) return "am";
  return "wo";
}

function dCat(s, feed) {
  if (feed && feed.cat) return feed.cat;
  s = s.toLowerCase();
  if (/\bwar\b|battle|attack|bomb|missile|militar|killed|conflict|strike|invasion|ceasefire|guerre|combat|\bmort\b|tu[eé]|attaque|frappe|explosion|airstrike|terror/.test(s)) return "conflit";
  if (/election|president|prime minister|government|parliament|\bvote\b|politic|senate|minister|sanction|diplomat|treaty|gouvernement|parlement|ministre|élection/.test(s)) return "politique";
  if (/econom|gdp|inflation|recession|market|stock|finance|\bbank\b|trade|investment|currency|dollar|euro|\boil\b|\bgas\b|budget|tariff|économie|marché|banque|pétrole/.test(s)) return "economie";
  if (/climate|flood|earthquake|tsunami|hurricane|typhoon|cyclone|wildfire|drought|storm|carbon|emission|environment|pollution|warming|disaster|inondation|séisme/.test(s)) return "climat";
  if (/science|research|discovery|vaccine|medical|\bhealth\b|hospital|disease|pandemic|virus|\bspace\b|nasa|rocket|satellite|artificial intelligence|\bai\b|technolog|cyber|scientifique|santé/.test(s)) return "science";
  if (/football|soccer|tennis|basketball|rugby|cricket|olympic|championship|tournament|\bmatch\b|\bleague\b|\bcup\b|fifa|uefa|nba|formula|\bsport\b|\bgoal\b|champion|medal/.test(s)) return "sport";
  return "societe";
}

function parseMs(s) {
  if (!s) return 0;
  const d = new Date(s);
  return isNaN(d.getTime()) ? 0 : d.getTime();
}

function parseFeed(xmlText, feed) {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlText, "text/xml");
    const errors = doc.getElementsByTagName("parsererror");
    if (errors.length > 0) return [];

    let nodes = doc.getElementsByTagName("item");
    if (nodes.length === 0) nodes = doc.getElementsByTagName("entry");
    if (nodes.length === 0) return [];

    const out = [];
    for (let i = 0; i < Math.min(nodes.length, 18); i++) {
      const el = nodes[i];
      const title = xget(el, ["title"]);
      if (!title || title.length < 4) continue;
      const desc = stripH(xget(el, ["description", "summary", "encoded", "content"]));
      const link = xlink(el);
      const date = xget(el, ["pubDate", "published", "updated", "date"]);
      const thumb = xthumb(el);
      const txt = (title + " " + desc).toLowerCase();
      out.push({
        id: feed.id + "-" + Math.random().toString(36).slice(2, 9),
        headline: title,
        summary: desc || title.substring(0, 150),
        body: desc ? "<p>" + desc + "</p>" : "<p>" + title + "</p>",
        date,
        ms: parseMs(date),
        region: dReg(txt),
        category: dCat(txt, feed),
        source: { name: feed.name, url: link, color: feed.col },
        reliability: feed.rel,
        thumbnail: thumb && thumb.startsWith("http") ? thumb : "",
        articleUrl: link,
      });
    }
    return out;
  } catch (e) {
    return [];
  }
}

async function fetchOneFeed(feed) {
  try {
    const xml = await fetchUrl(feed.url);
    const items = parseFeed(xml, feed);
    return { feed: feed.id, ok: true, count: items.length, items };
  } catch (e) {
    return { feed: feed.id, ok: false, count: 0, items: [], error: e.message };
  }
}

module.exports = async (req, res) => {
  // Headers CORS pour que votre frontend puisse appeler cette API
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET");
  // Cache 30 minutes sur Vercel CDN
  res.setHeader("Cache-Control", "s-maxage=1800, stale-while-revalidate=300");
  res.setHeader("Content-Type", "application/json");

  try {
    // Tous les flux en parallèle — pas de proxy, connexion directe depuis Vercel
    const results = await Promise.all(FEEDS.map(fetchOneFeed));

    const allItems = [];
    const status = {};
    for (const r of results) {
      allItems.push(...r.items);
      status[r.feed] = { ok: r.ok, count: r.count, error: r.error || null };
    }

    // Tri par date décroissante
    allItems.sort((a, b) => (b.ms || 0) - (a.ms || 0));

    res.status(200).json({
      ok: true,
      total: allItems.length,
      generated: new Date().toISOString(),
      status,
      articles: allItems,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message, articles: [] });
  }
};

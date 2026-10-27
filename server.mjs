import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8089);
const DATA_DIR = path.join(__dirname, "data");
const DEFAULT_INI_FILE = path.join(DATA_DIR, "rules.ini");
const DEFAULT_YAML_FILE = path.join(DATA_DIR, "config.yaml");
const PROFILES_FILE = path.join(DATA_DIR, "profiles.json");

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readProfiles() {
  try {
    if (!fs.existsSync(PROFILES_FILE)) return [];
    const raw = fs.readFileSync(PROFILES_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeProfiles(profiles) {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  fs.writeFileSync(PROFILES_FILE, JSON.stringify(profiles, null, 2), "utf-8");
}

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".ini": "text/plain; charset=utf-8",
  ".yaml": "text/yaml; charset=utf-8",
  ".yml": "text/yaml; charset=utf-8",
  ".woff2": "font/woff2",
};

function sendJson(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(JSON.stringify(data));
}

function handleConfigApi(req, res, filePath, publicPath) {
  if (req.method === "GET") {
    const exists = fs.existsSync(filePath);
    const content = exists ? fs.readFileSync(filePath, "utf-8") : "";
    const updatedAt = exists ? fs.statSync(filePath).mtime.toISOString() : null;
    sendJson(res, 200, { ok: true, exists, content, updatedAt, path: publicPath });
    return;
  }
  if (req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 5 * 1024 * 1024) req.destroy();
    });
    req.on("end", () => {
      try {
        const payload = JSON.parse(body || "{}");
        const content = String(payload.content || "").trim();
        if (!content) {
          sendJson(res, 400, { ok: false, error: "配置内容不能为空" });
          return;
        }
        fs.writeFileSync(filePath, content + "\n", "utf-8");
        sendJson(res, 200, {
          ok: true,
          path: publicPath,
          updatedAt: new Date().toISOString(),
        });
      } catch (err) {
        sendJson(res, 500, { ok: false, error: String(err.message || err) });
      }
    });
    return;
  }
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const pathname = parsedUrl.pathname;

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    res.end();
    return;
  }

  // 0. API: Multi-profile management (/api/profiles)
  if (pathname === "/api/profiles" && req.method === "GET") {
    sendJson(res, 200, { ok: true, profiles: readProfiles() });
    return;
  }

  if (pathname === "/api/profiles" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 5 * 1024 * 1024) req.destroy();
    });
    req.on("end", () => {
      try {
        const payload = JSON.parse(body || "{}");
        const name = String(payload.name || "").trim();
        const content = String(payload.content || "").trim();
        const format = payload.format === "yaml" ? "yaml" : "ini";
        const iniContent = String(
          payload.iniContent || (format === "ini" ? content : "")
        ).trim();
        const yamlContent = String(
          payload.yamlContent || (format === "yaml" ? content : "")
        ).trim();

        if (!name) {
          sendJson(res, 400, { ok: false, error: "配置名称不能为空" });
          return;
        }
        if (!content) {
          sendJson(res, 400, { ok: false, error: "配置内容不能为空" });
          return;
        }

        const profiles = readProfiles();
        const record = {
          name,
          format,
          content,
          iniContent,
          yamlContent,
          updatedAt: new Date().toISOString(),
        };
        const existingIdx = profiles.findIndex((p) => p && p.name === name);
        if (existingIdx >= 0) {
          profiles[existingIdx] = record;
        } else {
          profiles.unshift(record);
        }
        writeProfiles(profiles);

        if (iniContent) {
          fs.writeFileSync(DEFAULT_INI_FILE, iniContent + "\n", "utf-8");
        }
        if (yamlContent) {
          fs.writeFileSync(DEFAULT_YAML_FILE, yamlContent + "\n", "utf-8");
        }

        sendJson(res, 200, { ok: true, profile: record, profiles });
      } catch (err) {
        sendJson(res, 500, { ok: false, error: String(err.message || err) });
      }
    });
    return;
  }

  if (pathname === "/api/profiles" && req.method === "DELETE") {
    const name = String(parsedUrl.searchParams.get("name") || "").trim();
    if (!name) {
      sendJson(res, 400, { ok: false, error: "缺少要删除的配置名称" });
      return;
    }
    const profiles = readProfiles().filter((p) => p && p.name !== name);
    writeProfiles(profiles);
    sendJson(res, 200, { ok: true, profiles });
    return;
  }

  // 0.5 Direct Named Profile Remote Endpoint: GET /profiles/<name>.ini or /profiles/<name>.yaml
  if (req.method === "GET" && pathname.startsWith("/profiles/")) {
    const rawFile = decodeURIComponent(pathname.slice("/profiles/".length));
    const isYaml = rawFile.endsWith(".yaml") || rawFile.endsWith(".yml");
    const isIni = rawFile.endsWith(".ini");
    const profileName = rawFile.replace(/\.(ini|ya?ml)$/i, "");
    const profiles = readProfiles();
    const found = profiles.find((p) => p && p.name === profileName);
    if (!found) {
      res.writeHead(404, {
        "Content-Type": "text/plain; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
      });
      res.end(`# 404 Not Found: Profile "${profileName}" does not exist\n`);
      return;
    }
    const outText = isYaml
      ? found.yamlContent || found.content || ""
      : isIni
      ? found.iniContent || found.content || ""
      : found.content || "";
    res.writeHead(200, {
      "Content-Type": isYaml
        ? "text/yaml; charset=utf-8"
        : "text/plain; charset=utf-8",
      "Cache-Control": "no-cache, no-store, must-revalidate",
      "Access-Control-Allow-Origin": "*",
    });
    res.end(outText + "\n");
    return;
  }

  // 1. Direct INI remote rule endpoint: GET /rules.ini
  if (req.method === "GET" && pathname === "/rules.ini") {
    const content = fs.existsSync(DEFAULT_INI_FILE)
      ? fs.readFileSync(DEFAULT_INI_FILE, "utf-8")
      : "[custom]\n; 尚未保存任何 INI 规则，请在可视化构建器中点击「保存并更新远程地址」\n";
    res.writeHead(200, {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache, no-store, must-revalidate",
      "Access-Control-Allow-Origin": "*",
    });
    res.end(content);
    return;
  }

  // 2. Direct YAML remote config endpoint: GET /config.yaml (or /clash.yaml)
  if (req.method === "GET" && (pathname === "/config.yaml" || pathname === "/clash.yaml")) {
    const content = fs.existsSync(DEFAULT_YAML_FILE)
      ? fs.readFileSync(DEFAULT_YAML_FILE, "utf-8")
      : "# 尚未保存任何 YAML 配置，请在可视化构建器中点击「保存并更新远程地址」\n";
    res.writeHead(200, {
      "Content-Type": "text/yaml; charset=utf-8",
      "Cache-Control": "no-cache, no-store, must-revalidate",
      "Access-Control-Allow-Origin": "*",
    });
    res.end(content);
    return;
  }

  // 3. API: Get or Save hosted INI rule / YAML config
  if (pathname === "/api/rules-ini") {
    handleConfigApi(req, res, DEFAULT_INI_FILE, "/rules.ini");
    return;
  }
  if (pathname === "/api/config-yaml") {
    handleConfigApi(req, res, DEFAULT_YAML_FILE, "/config.yaml");
    return;
  }

  // 4. API: Proxy fetch remote INI URL to avoid browser CORS
  if (req.method === "GET" && pathname === "/api/fetch-ini") {
    const targetUrl = parsedUrl.searchParams.get("url") || "";
    if (!targetUrl || !/^https?:\/\//i.test(targetUrl)) {
      sendJson(res, 400, { ok: false, error: "无效的远程规则 URL" });
      return;
    }
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      const response = await fetch(targetUrl, { signal: controller.signal });
      clearTimeout(timer);
      if (!response.ok) {
        sendJson(res, 502, {
          ok: false,
          error: `远程服务器返回 HTTP ${response.status}`,
        });
        return;
      }
      const text = await response.text();
      sendJson(res, 200, { ok: true, content: text });
    } catch (err) {
      sendJson(res, 502, { ok: false, error: `拉取失败: ${err.message || err}` });
    }
    return;
  }

  // 5. Static file serving
  let safePath = path.normalize(decodeURIComponent(pathname)).replace(/^(\.\.(\/|\\|$))+/, "");
  if (safePath === "/" || safePath === "\\") safePath = "/index.html";
  const filePath = path.join(__dirname, safePath);

  if (!filePath.startsWith(__dirname) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("404 Not Found");
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || "application/octet-stream";
  res.writeHead(200, {
    "Content-Type": contentType,
    "Cache-Control": "no-cache",
  });
  fs.createReadStream(filePath).pipe(res);
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Mihomo Constructor running at http://0.0.0.0:${PORT}`);
  console.log(`Remote INI Rule URL:   http://127.0.0.1:${PORT}/rules.ini`);
  console.log(`Remote YAML Config URL: http://127.0.0.1:${PORT}/config.yaml`);
});

const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");
const { createBotController, DEFAULT_CONFIG } = require("./bot.js");

const PORT = Number(process.env.PORT || 5000);
const publicFile = path.join(__dirname, "index.html");
const controller = createBotController(DEFAULT_CONFIG);

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
  });
  response.end(body);
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error("Request body is too large."));
        request.destroy();
      }
    });
    request.on("end", () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("Request body must be valid JSON."));
      }
    });
    request.on("error", reject);
  });
}

function cleanConfig(input = {}) {
  const result = {};
  if (typeof input.host === "string" && input.host.trim()) {
    result.host = input.host.trim();
  }
  if (input.port !== undefined) {
    const port = Number(input.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error("Port must be a number between 1 and 65535.");
    }
    result.port = port;
  }
  if (typeof input.username === "string" && input.username.trim()) {
    const username = input.username.trim();
    if (username.length > 16) throw new Error("Minecraft usernames can be at most 16 characters.");
    result.username = username;
  }
  if (typeof input.version === "string" && input.version.trim()) {
    result.version = input.version.trim();
  }
  if (typeof input.auth === "string" && input.auth.trim()) {
    result.auth = input.auth.trim();
  }
  return result;
}

function cleanBehavior(input = {}) {
  const result = {};
  for (const key of ["antiAfk", "autoJump", "killAnimals", "autoReconnect"]) {
    if (input[key] !== undefined) {
      if (typeof input[key] !== "boolean") {
        throw new Error(`${key} must be true or false.`);
      }
      result[key] = input[key];
    }
  }
  return result;
}

async function handleApi(request, response, url) {
  try {
    if (request.method === "GET" && url.pathname === "/api/status") {
      return sendJson(response, 200, controller.getStatus());
    }

    if (request.method === "GET" && url.pathname === "/api/logs") {
      return sendJson(response, 200, { logs: controller.getLogs(url.searchParams.get("after")) });
    }

    if (request.method === "POST" && url.pathname === "/api/bot/start") {
      const config = cleanConfig(await readJson(request));
      return sendJson(response, 200, { ok: true, status: controller.start(config) });
    }

    if (request.method === "POST" && url.pathname === "/api/bot/restart") {
      const config = cleanConfig(await readJson(request));
      return sendJson(response, 200, { ok: true, status: controller.restart(config) });
    }

    if (request.method === "POST" && url.pathname === "/api/bot/stop") {
      return sendJson(response, 200, { ok: true, status: controller.stop() });
    }

    if (request.method === "POST" && url.pathname === "/api/bot/behavior") {
      const behavior = cleanBehavior(await readJson(request));
      return sendJson(response, 200, { ok: true, status: controller.setBehavior(behavior) });
    }

    if (request.method === "POST" && url.pathname === "/api/chat") {
      const { message } = await readJson(request);
      const result = controller.chat(message);
      return sendJson(response, 200, { ok: true, ...result });
    }

    sendJson(response, 404, { error: "Not found." });
  } catch (error) {
    sendJson(response, 400, { error: error.message });
  }
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  if (url.pathname.startsWith("/api/")) {
    handleApi(request, response, url);
    return;
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    sendJson(response, 405, { error: "Method not allowed." });
    return;
  }

  if (url.pathname === "/" || url.pathname === "/index.html") {
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return response.end(fs.readFileSync(publicFile));
  }

  response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  response.end("Not found.");
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[web] CraftHost dashboard listening on port ${PORT}`);
  controller.start();
});

function shutdown() {
  controller.stop();
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

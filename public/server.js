const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");
const { createBotController } = require("./bot");

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");
const controller = createBotController();

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1e6) {
        request.destroy();
        reject(new Error("Payload too large"));
      }
    });
    request.on("end", () => {
      if (!body.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(new Error("Invalid JSON body"));
      }
    });
    request.on("error", reject);
  });
}

function sendJson(response, statusCode, data) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(data));
}

function sendText(response, statusCode, text) {
  response.writeHead(statusCode, { "Content-Type": "text/plain; charset=utf-8" });
  response.end(text);
}

function serveStatic(request, response, pathname) {
  let relativePath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  let safePath = path.normalize(relativePath).replace(/^(\.\.[\/\\])+/, "");
  let filePath = path.join(PUBLIC_DIR, safePath);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    sendText(response, 403, "Forbidden");
    return;
  }

  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, "index.html");
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      if (err.code === "ENOENT") {
        sendText(response, 404, "Not Found");
      } else {
        sendText(response, 500, "Internal Server Error");
      }
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "application/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".svg": "image/svg+xml",
      ".ico": "image/x-icon",
    };

    response.writeHead(200, {
      "Content-Type": mimeTypes[ext] || "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    response.end(data);
  });
}

async function handleApi(request, response, url) {
  try {
    if (request.method === "GET" && url.pathname === "/api/status") {
      return sendJson(response, 200, controller.getStatus());
    }

    if (request.method === "GET" && url.pathname === "/api/logs") {
      const after = url.searchParams.get("after") || 0;
      return sendJson(response, 200, {
        logs: controller.getLogs(after),
        status: controller.getStatus(),
      });
    }

    if (request.method === "POST" && url.pathname === "/api/bot/start") {
      const payload = await readJson(request);
      const status = controller.start(payload);
      return sendJson(response, 200, { ok: true, status });
    }

    if (request.method === "POST" && url.pathname === "/api/bot/stop") {
      const status = controller.stop();
      return sendJson(response, 200, { ok: true, status });
    }

    if (request.method === "POST" && url.pathname === "/api/bot/restart") {
      const payload = await readJson(request);
      const status = controller.restart(payload);
      return sendJson(response, 200, { ok: true, status });
    }

    if (request.method === "POST" && url.pathname === "/api/bot/behavior") {
      const payload = await readJson(request);
      const status = controller.setBehavior(payload);
      return sendJson(response, 200, { ok: true, status });
    }

    if (request.method === "POST" && url.pathname === "/api/bot/chat") {
      const payload = await readJson(request);
      const result = controller.chat(payload.message);
      return sendJson(response, 200, { ok: true, ...result, status: controller.getStatus() });
    }

    if (request.method === "POST" && url.pathname === "/api/bot/click") {
      const { slot, mouseButton, mode } = await readJson(request);
      const result = await controller.clickWindowSlot(slot, mouseButton, mode);
      return sendJson(response, 200, { ok: true, ...result, status: controller.getStatus() });
    }

    return sendJson(response, 404, { error: "API route not found" });
  } catch (error) {
    return sendJson(response, 400, { error: error.message || "Bad Request" });
  }
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);

  if (url.pathname.startsWith("/api/")) {
    handleApi(request, response, url);
  } else {
    serveStatic(request, response, url.pathname);
  }
});

server.listen(PORT, () => {
  console.log(`[dashboard] Web server running on port ${PORT}`);
  controller.start();
});

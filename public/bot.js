const mineflayer = require("mineflayer");
const readline = require("readline");

const DEFAULT_CONFIG = {
  host: process.env.MC_HOST || "theweirdpeoplelol.aternos.me",
  port: Number(process.env.MC_PORT || 40676),
  username: process.env.MC_USERNAME || "TestingBot",
  ...(process.env.MC_VERSION ? { version: process.env.MC_VERSION } : {}),
  ...(process.env.MC_AUTH ? { auth: process.env.MC_AUTH } : {}),
};

function createBotController(initialConfig = DEFAULT_CONFIG) {
  let bot = null;
  let config = { ...initialConfig };
  let state = "offline";
  let startedAt = null;
  let retryTimer = null;
  let movementTimer = null;
  let jumpTimer = null;
  let shouldRun = false;
  let connectionId = 0;
  let sequence = 0;
  let usageMs = 0;
  let usageStartedAt = null;
  const metrics = {
    messagesSent: 0,
    commandsExecuted: 0,
  };
  const logs = [];

  function addLog(message, level = "info") {
    const entry = {
      id: ++sequence,
      time: new Date().toISOString(),
      message: String(message),
      level,
    };
    logs.push(entry);
    if (logs.length > 250) logs.shift();
    console.log(entry.message);
    return entry;
  }

  function clearRetry() {
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
  }

  function stopAntiAfk() {
    if (movementTimer) {
      clearInterval(movementTimer);
      movementTimer = null;
    }
    if (jumpTimer) {
      clearInterval(jumpTimer);
      jumpTimer = null;
    }
    if (bot?.clearControlStates) {
      bot.clearControlStates();
    }
  }

  function startAntiAfk(currentBot, currentConnection) {
    stopAntiAfk();

    const movementStates = ["forward", "left", "forward", "right"];
    let movementIndex = 0;

    const move = () => {
      if (currentConnection !== connectionId || currentBot !== bot || state !== "online") {
        stopAntiAfk();
        return;
      }
      currentBot.clearControlStates();
      currentBot.setControlState(movementStates[movementIndex], true);
      movementIndex = (movementIndex + 1) % movementStates.length;
    };

    move();
    movementTimer = setInterval(move, 4500);
    jumpTimer = setInterval(() => {
      if (currentConnection !== connectionId || currentBot !== bot || state !== "online") {
        stopAntiAfk();
        return;
      }
      currentBot.setControlState("jump", true);
      setTimeout(() => {
        if (currentConnection === connectionId && currentBot === bot && state === "online") {
          currentBot.setControlState("jump", false);
        }
      }, 450);
    }, 3500);
    addLog("[anti-afk] Auto-movement and jumping enabled.");
  }

  function scheduleRetry() {
    clearRetry();
    if (!shouldRun) return;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      connect();
    }, 5000);
    addLog("[system] Will retry the Minecraft connection in 5 seconds.", "warning");
  }

  function closeCurrentBot() {
    if (!bot) return;
    stopAntiAfk();
    const currentBot = bot;
    bot = null;
    currentBot.removeAllListeners();
    try {
      currentBot.quit();
    } catch {
      // The socket may already be closed.
    }
  }

  function accrueUsage() {
    if (!usageStartedAt) return;
    usageMs += Date.now() - usageStartedAt;
    usageStartedAt = Date.now();
  }

  function connect() {
    if (!shouldRun) return;
    clearRetry();
    const thisConnection = ++connectionId;
    state = "connecting";
    startedAt = null;
    addLog(`[system] Connecting to ${config.host}:${config.port} as ${config.username}...`);

    const botOptions = {
      host: config.host,
      port: Number(config.port),
      username: config.username,
    };
    if (config.version) botOptions.version = config.version;
    if (config.auth) botOptions.auth = config.auth;

    try {
      bot = mineflayer.createBot(botOptions);
    } catch (error) {
      state = "error";
      addLog(`[error] Could not create the bot: ${error.message}`, "error");
      scheduleRetry();
      return;
    }

    bot.on("spawn", () => {
      if (thisConnection !== connectionId) return;
      state = "online";
      startedAt = Date.now();
      usageStartedAt = startedAt;
      addLog(`[system] ${bot.username} joined the Minecraft server.`);
      startAntiAfk(bot, thisConnection);
    });

    bot.on("chat", (username, message) => {
      if (username === bot.username) return;
      addLog(`[chat] <${username}> ${message}`);
    });

    bot.on("whisper", (username, message) => {
      addLog(`[whisper] <${username}> ${message}`);
    });

    bot.on("error", (error) => {
      if (thisConnection !== connectionId) return;
      stopAntiAfk();
      accrueUsage();
      startedAt = null;
      usageStartedAt = null;
      state = "error";
      addLog(`[error] ${error.message}`, "error");
      scheduleRetry();
    });

    bot.on("kicked", (reason) => {
      if (thisConnection !== connectionId) return;
      addLog(`[server] Bot was kicked: ${formatReason(reason)}`, "warning");
    });

    bot.on("end", () => {
      if (thisConnection !== connectionId) return;
      stopAntiAfk();
      accrueUsage();
      bot = null;
      startedAt = null;
      usageStartedAt = null;
      state = shouldRun ? "connecting" : "offline";
      addLog("[system] Bot disconnected.", "warning");
      scheduleRetry();
    });
  }

  function formatReason(reason) {
    if (typeof reason === "string") return reason;
    try {
      return JSON.stringify(reason);
    } catch {
      return "Unknown reason";
    }
  }

  return {
    start(nextConfig = {}) {
      config = {
        ...config,
        ...nextConfig,
        port: Number(nextConfig.port || config.port),
      };
      shouldRun = true;
      clearRetry();
      if (state === "online" || state === "connecting") {
        return this.getStatus();
      }
      connect();
      return this.getStatus();
    },

    stop() {
      shouldRun = false;
      clearRetry();
      stopAntiAfk();
      connectionId += 1;
      accrueUsage();
      closeCurrentBot();
      startedAt = null;
      usageStartedAt = null;
      state = "offline";
      addLog("[system] Bot stopped by dashboard.");
      return this.getStatus();
    },

    restart(nextConfig = {}) {
      shouldRun = false;
      clearRetry();
      stopAntiAfk();
      connectionId += 1;
      accrueUsage();
      closeCurrentBot();
      startedAt = null;
      usageStartedAt = null;
      state = "offline";
      return this.start(nextConfig);
    },

    chat(message) {
      const cleanMessage = String(message || "").trim();
      if (!cleanMessage) throw new Error("Message cannot be empty.");
      if (!bot || state !== "online") {
        throw new Error("The bot is not connected to Minecraft.");
      }
      bot.chat(cleanMessage);
      if (cleanMessage.startsWith("/")) {
        metrics.commandsExecuted += 1;
      } else {
        metrics.messagesSent += 1;
      }
      addLog(`[chat] <${bot.username}> ${cleanMessage}`);
      return { sent: true };
    },

    getStatus() {
      accrueUsage();
      const players = bot?.players ? Object.keys(bot.players) : [];
      return {
        state,
        online: state === "online",
        username: config.username,
        config: {
          host: config.host,
          port: Number(config.port),
          username: config.username,
          version: config.version || "auto",
        },
        uptimeMs: startedAt ? Date.now() - startedAt : 0,
        players: players.length,
        playerNames: players.slice(0, 20),
        metrics: {
          ...metrics,
          usageMs,
          usageHours: Number((usageMs / 3600000).toFixed(4)),
        },
        lastLogId: sequence,
      };
    },

    getLogs(after = 0) {
      return logs.filter((entry) => entry.id > Number(after || 0));
    },

    getConfig() {
      return { ...config };
    },
  };
}

module.exports = { createBotController, DEFAULT_CONFIG };

if (require.main === module) {
  const controller = createBotController();
  controller.start();
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.on("line", (line) => {
    try {
      controller.chat(line);
    } catch (error) {
      console.error(`[error] ${error.message}`);
    }
  });
  process.on("SIGINT", () => {
    controller.stop();
    rl.close();
    process.exit(0);
  });
}
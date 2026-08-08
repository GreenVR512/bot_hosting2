const mineflayer = require("mineflayer");

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
  let targetPlayerTimer = null;
  let autoEatTimer = null;
  let guardTimer = null;
  let animalTimer = null;
  let shouldRun = false;
  let connectionId = 0;
  let sequence = 0;
  let usageMs = 0;
  let usageStartedAt = null;

  const behavior = {
    antiAfk: true,
    autoJump: true,
    killAnimals: false,
    targetPlayers: false,
    autoEat: true,
    guardMode: false,
    autoReconnect: true,
  };

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

  function stopAllTimers() {
    if (movementTimer) { clearInterval(movementTimer); movementTimer = null; }
    if (jumpTimer) { clearInterval(jumpTimer); jumpTimer = null; }
    if (targetPlayerTimer) { clearInterval(targetPlayerTimer); targetPlayerTimer = null; }
    if (autoEatTimer) { clearInterval(autoEatTimer); autoEatTimer = null; }
    if (guardTimer) { clearInterval(guardTimer); guardTimer = null; }
    if (animalTimer) { clearInterval(animalTimer); animalTimer = null; }
    if (bot?.clearControlStates) { bot.clearControlStates(); }
  }

  function startAntiAfk(currentBot, currentConnection) {
    if (movementTimer) clearInterval(movementTimer);
    if (jumpTimer) clearInterval(jumpTimer);
    if (!behavior.antiAfk) return;

    const movementStates = ["forward", "left", "forward", "right"];
    let movementIndex = 0;

    const move = () => {
      if (currentConnection !== connectionId || currentBot !== bot || state !== "online") return;
      currentBot.clearControlStates();
      currentBot.setControlState(movementStates[movementIndex], true);
      movementIndex = (movementIndex + 1) % movementStates.length;
    };

    move();
    movementTimer = setInterval(move, 4500);
    if (behavior.autoJump) {
      jumpTimer = setInterval(() => {
        if (currentConnection !== connectionId || currentBot !== bot || state !== "online") return;
        currentBot.setControlState("jump", true);
        setTimeout(() => {
          if (currentConnection === connectionId && currentBot === bot && state === "online") {
            currentBot.setControlState("jump", false);
          }
        }, 450);
      }, 3500);
    }
  }

  function startPlayerTargeting(currentBot, currentConnection) {
    if (targetPlayerTimer) clearInterval(targetPlayerTimer);
    if (!behavior.targetPlayers) return;

    const track = () => {
      if (currentConnection !== connectionId || currentBot !== bot || state !== "online") return;
      const playerTarget = currentBot.nearestEntity((e) => e.type === "player" && e.username !== currentBot.username);
      if (playerTarget && playerTarget.position) {
        currentBot.lookAt(playerTarget.position.offset(0, playerTarget.height || 1.6, 0), true);
        const dist = currentBot.entity.position.distanceTo(playerTarget.position);
        currentBot.setControlState("forward", dist > 2);
      }
    };

    track();
    targetPlayerTimer = setInterval(track, 1000);
  }

  function startAutoEat(currentBot, currentConnection) {
    if (autoEatTimer) clearInterval(autoEatTimer);
    if (!behavior.autoEat) return;

    const checkHunger = async () => {
      if (currentConnection !== connectionId || currentBot !== bot || state !== "online") return;
      if (currentBot.food < 18) {
        const foodItem = currentBot.inventory.items().find((item) =>
          item.name.includes("cooked") || item.name.includes("bread") || item.name.includes("apple")
        );
        if (foodItem) {
          try {
            await currentBot.equip(foodItem, "hand");
            await currentBot.consume();
            addLog(`[auto-eat] Consumed ${foodItem.name}.`);
          } catch (err) {}
        }
      }
    };

    autoEatTimer = setInterval(checkHunger, 5000);
  }

  function startGuardMode(currentBot, currentConnection) {
    if (guardTimer) clearInterval(guardTimer);
    if (!behavior.guardMode) return;

    const guard = () => {
      if (currentConnection !== connectionId || currentBot !== bot || state !== "online") return;
      const hostile = currentBot.nearestEntity((e) => {
        if (!e?.position || e.type !== "mob") return false;
        return ["zombie", "skeleton", "spider", "creeper", "enderman"].includes(e.name) &&
          currentBot.entity.position.distanceTo(e.position) <= 6;
      });

      if (hostile) {
        try {
          currentBot.lookAt(hostile.position.offset(0, hostile.height / 2, 0), true);
          currentBot.attack(hostile);
        } catch (e) {}
      }
    };

    guard();
    guardTimer = setInterval(guard, 1500);
  }

  function startAnimalGuard(currentBot, currentConnection) {
    if (animalTimer) clearInterval(animalTimer);
    if (!behavior.killAnimals) return;

    const animalNames = new Set(["cow", "pig", "sheep", "chicken", "rabbit"]);
    const hunt = () => {
      if (currentConnection !== connectionId || currentBot !== bot || state !== "online") return;
      const target = currentBot.nearestEntity((e) => e?.position && animalNames.has(e.name) && currentBot.entity.position.distanceTo(e.position) <= 5);
      if (target) {
        try {
          currentBot.lookAt(target.position.offset(0, target.height / 2, 0), true);
          currentBot.attack(target);
        } catch (e) {}
      }
    };

    hunt();
    animalTimer = setInterval(hunt, 2500);
  }

  function applyActiveBehaviors(currentBot, currentConnection) {
    startAntiAfk(currentBot, currentConnection);
    startPlayerTargeting(currentBot, currentConnection);
    startAutoEat(currentBot, currentConnection);
    startGuardMode(currentBot, currentConnection);
    startAnimalGuard(currentBot, currentConnection);
  }

  function scheduleRetry() {
    clearRetry();
    if (!shouldRun || !behavior.autoReconnect) return;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      connect();
    }, 5000);
    addLog("[system] Retrying Minecraft connection in 5 seconds...", "warning");
  }

  function closeCurrentBot() {
    if (!bot) return;
    stopAllTimers();
    const currentBot = bot;
    bot = null;
    currentBot.removeAllListeners();
    try { currentBot.quit(); } catch {}
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
      addLog(`[error] Could not create bot: ${error.message}`, "error");
      scheduleRetry();
      return;
    }

    bot.on("spawn", () => {
      if (thisConnection !== connectionId) return;
      state = "online";
      startedAt = Date.now();
      usageStartedAt = startedAt;
      addLog(`[system] ${bot.username} joined the server.`);
      applyActiveBehaviors(bot, thisConnection);
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
      stopAllTimers();
      accrueUsage();
      startedAt = null;
      usageStartedAt = null;
      state = "error";
      addLog(`[error] ${error.message}`, "error");
      scheduleRetry();
    });

    bot.on("kicked", (reason) => {
      if (thisConnection !== connectionId) return;
      addLog(`[server] Bot kicked: ${typeof reason === 'string' ? reason : JSON.stringify(reason)}`, "warning");
    });

    bot.on("end", () => {
      if (thisConnection !== connectionId) return;
      stopAllTimers();
      accrueUsage();
      bot = null;
      startedAt = null;
      usageStartedAt = null;
      state = shouldRun ? "connecting" : "offline";
      addLog("[system] Bot disconnected.", "warning");
      scheduleRetry();
    });
  }

  return {
    start(nextConfig = {}) {
      config = { ...config, ...nextConfig, port: Number(nextConfig.port || config.port) };
      shouldRun = true;
      clearRetry();
      if (state === "online" || state === "connecting") return this.getStatus();
      connect();
      return this.getStatus();
    },

    stop() {
      shouldRun = false;
      clearRetry();
      stopAllTimers();
      connectionId += 1;
      accrueUsage();
      closeCurrentBot();
      startedAt = null;
      usageStartedAt = null;
      state = "offline";
      addLog("[system] Bot stopped.");
      return this.getStatus();
    },

    restart(nextConfig = {}) {
      this.stop();
      return this.start(nextConfig);
    },

    setBehavior(nextBehavior = {}) {
      for (const key of Object.keys(behavior)) {
        if (typeof nextBehavior[key] === "boolean") {
          behavior[key] = nextBehavior[key];
        }
      }
      if (!behavior.autoReconnect) clearRetry();
      if (bot && state === "online") applyActiveBehaviors(bot, connectionId);
      addLog(`[settings] Behaviors updated.`);
      return this.getStatus();
    },

    chat(message) {
      const cleanMessage = String(message || "").trim();
      if (!cleanMessage) throw new Error("Message cannot be empty.");
      if (!bot || state !== "online") throw new Error("Bot is not connected.");
      bot.chat(cleanMessage);
      if (cleanMessage.startsWith("/")) metrics.commandsExecuted += 1;
      else metrics.messagesSent += 1;
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
        behavior: { ...behavior },
        metrics: { ...metrics, usageMs, usageHours: Number((usageMs / 3600000).toFixed(4)) },
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

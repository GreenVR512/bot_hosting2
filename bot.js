const mineflayer = require('mineflayer');
const readline = require('readline');

const bot = mineflayer.createBot({
  host: 'theweirdpeoplelol.aternos.me',
  port: 40676,
  username: 'TestingBot',
  // auth: 'offline' // Uncomment if the server is in offline/cracked mode
});

// Set up console input
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

bot.on('spawn', () => {
  console.log(`${bot.username} has joined! Type in this console to chat in-game.`);

  // Listen for user input in the console and send it to Minecraft chat
  rl.on('line', (line) => {
    if (line.trim().length > 0) {
      bot.chat(line);
    }
  });
});

bot.on('chat', (username, message) => {
  if (username === bot.username) return;
  console.log(`[Chat] ${username}: ${message}`);
});

bot.on('error', (err) => console.log('Bot encountered an error:', err.message));
bot.on('kicked', (reason) => console.log('Bot was kicked:', reason));
bot.on('end', () => {
  console.log('Bot disconnected.');
  rl.close();
});
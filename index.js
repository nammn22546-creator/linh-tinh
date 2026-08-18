'use strict'

const http = require('http')
const mineflayer = require('mineflayer')

// ============================================================
// CONFIG
// ============================================================

const SERVER_HOST = process.env.MC_HOST || 'puffernetwork.io.vn'
const SERVER_PORT = Number(process.env.MC_PORT || 25863)

const BOT_USERNAME =
  process.env.BOT_USERNAME || 'hellodomcon123'

const MC_VERSION =
  process.env.MC_VERSION || '1.21.11'

const LOGIN_COMMAND =
  process.env.MC_LOGIN_COMMAND || ''

const HOME_COMMAND =
  process.env.MC_HOME_COMMAND || '/tpa domcon'

const WEB_PASSWORD =
  process.env.WEB_PASSWORD || ''

const WEB_PORT =
  Number(process.env.PORT || 8080)

// ============================================================
// STATE
// ============================================================

let botInstance = null

let isOnline = false
let isConnecting = false
let manualStop = false

let reconnectTimer = null
let afkTimer = null

let logs = []

const startTime = Date.now()

let botStatus = 'Đang khởi động...'

// ============================================================
// LOG
// ============================================================

function addLog(message) {

  const time =
    new Date().toLocaleTimeString('vi-VN')

  const line =
    `[${time}] ${message}`

  logs.unshift(line)

  if (logs.length > 50) {
    logs.length = 50
  }

  console.log(line)
}

// ============================================================
// TIMERS
// ============================================================

function stopTimers() {

  if (afkTimer) {
    clearInterval(afkTimer)
    afkTimer = null
  }

  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
}

// ============================================================
// AFK
// ============================================================

function startAFK(bot) {

  if (!bot) return

  if (afkTimer) {
    clearInterval(afkTimer)
    afkTimer = null
  }

  afkTimer = setInterval(() => {

    if (
      bot !== botInstance ||
      !bot.entity ||
      !isOnline
    ) {
      return
    }

    try {

      bot.setControlState(
        'jump',
        true
      )

      setTimeout(() => {

        try {

          if (
            bot === botInstance &&
            bot.setControlState
          ) {

            bot.setControlState(
              'jump',
              false
            )

          }

        } catch {}

      }, 200)

    } catch {}

  }, 5000)

  addLog(
    '🔄 Đã bật chế độ AFK.'
  )
}

// ============================================================
// CHAT
// ============================================================

function sendChat(bot, message) {

  if (
    !bot ||
    bot !== botInstance ||
    !isOnline ||
    typeof bot.chat !== 'function'
  ) {
    return false
  }

  try {

    bot.chat(message)

    addLog(
      `[Bot → Server] ${message}`
    )

    return true

  } catch (error) {

    addLog(
      `❌ Không thể gửi chat: ${error.message}`
    )

    return false
  }
}

// ============================================================
// RECONNECT
// ============================================================

function scheduleReconnect() {

  if (manualStop) {
    return
  }

  if (reconnectTimer) {
    return
  }

  botStatus =
    'Offline — thử lại sau 15 giây'

  addLog(
    '⏳ Tự động kết nối lại sau 15 giây...'
  )

  reconnectTimer = setTimeout(() => {

    reconnectTimer = null

    if (
      manualStop ||
      isOnline ||
      isConnecting
    ) {
      return
    }

    addLog(
      '🔄 Bắt đầu kết nối lại...'
    )

    createBot()

  }, 15000)
}

// ============================================================
// CREATE BOT
// ============================================================

function createBot() {

  if (manualStop) {
    return
  }

  if (isConnecting) {
    return
  }

  isConnecting = true
  isOnline = false

  stopTimers()

  if (botInstance) {

    try {
      botInstance.end()
    } catch {}

    botInstance = null
  }

  botStatus =
    'Đang kết nối server Minecraft...'

  addLog(
    `Đang kết nối ${SERVER_HOST}:${SERVER_PORT}...`
  )

  let bot

  try {

    bot = mineflayer.createBot({

      host: SERVER_HOST,

      port: SERVER_PORT,

      username: BOT_USERNAME,

      version: MC_VERSION,

      checkTimeoutInterval: 120000,

      hideErrors: false

    })

  } catch (error) {

    isConnecting = false

    botStatus =
      'Lỗi tạo kết nối'

    addLog(
      `❌ createBot: ${error.message}`
    )

    scheduleReconnect()

    return
  }

  botInstance = bot

  let loginDone = false
  let spawnDone = false

  // ==========================================================
  // RESOURCE PACK
  // QUAN TRỌNG: LISTENER ĐƯỢC ĐĂNG KÝ NGAY SAU createBot
  // ==========================================================

  bot.on(
    'resourcePack',
    (resourcePackUrl, hash) => {

      addLog(
        '📦 Server yêu cầu Resource Pack.'
      )

      /*
       * ACCEPT NGAY LẬP TỨC.
       *
       * Không setTimeout.
       * Không đợi login.
       * Không đợi spawn.
       */

      try {

        if (
          typeof bot.acceptResourcePack ===
          'function'
        ) {

          bot.acceptResourcePack()

          addLog(
            '✅ Đã ACCEPT Resource Pack ngay lập tức.'
          )

        } else {

          addLog(
            '❌ Không tìm thấy acceptResourcePack().'
          )

        }

      } catch (error) {

        addLog(
          `❌ Lỗi Resource Pack: ${error.message}`
        )

      }

    }
  )

  // ==========================================================
  // TCP CONNECT
  // ==========================================================

  if (
    bot._client &&
    typeof bot._client.on === 'function'
  ) {

    bot._client.on(
      'connect',
      () => {

        addLog(
          '🔌 TCP đã kết nối tới server.'
        )

      }
    )

    bot._client.on(
      'close',
      () => {

        addLog(
          '🔌 Socket Minecraft đã đóng.'
        )

      }
    )

  }

  // ==========================================================
  // LOGIN
  // ==========================================================

  bot.once(
    'login',
    () => {

      addLog(
        '✅ Minecraft login thành công.'
      )

    }
  )

  // ==========================================================
  // SPAWN
  // ==========================================================

  bot.once(
    'spawn',
    () => {

      spawnDone = true

      isConnecting = false
      isOnline = true

      botStatus =
        'Đang hoạt động (Online)'

      addLog(
        `✅ Bot ${BOT_USERNAME} đã vào server!`
      )

      // ------------------------------------------------------
      // LOGIN COMMAND
      // ------------------------------------------------------

      if (
        LOGIN_COMMAND &&
        !loginDone
      ) {

        loginDone = true

        setTimeout(() => {

          if (
            bot !== botInstance ||
            !isOnline
          ) {
            return
          }

          sendChat(
            bot,
            LOGIN_COMMAND
          )

        }, 3000)

      }

      // ------------------------------------------------------
      // HOME / TPA / SERVER COMMAND
      // ------------------------------------------------------

      const commandDelay =
        LOGIN_COMMAND
          ? 6000
          : 3000

      setTimeout(() => {

        if (
          bot !== botInstance ||
          !isOnline
        ) {
          return
        }

        if (HOME_COMMAND) {

          sendChat(
            bot,
            HOME_COMMAND
          )

        }

        setTimeout(() => {

          if (
            bot === botInstance &&
            isOnline
          ) {

            startAFK(bot)

          }

        }, 2000)

      }, commandDelay)

    }
  )

  // ==========================================================
  // DEATH
  // ==========================================================

  bot.on(
    'death',
    () => {

      addLog(
        '💀 Bot đã chết.'
      )

      if (bot !== botInstance) {
        return
      }

      stopTimers()

      setTimeout(() => {

        if (
          bot !== botInstance ||
          !isOnline
        ) {
          return
        }

        try {

          if (
            typeof bot.respawn ===
            'function'
          ) {

            bot.respawn()

          }

        } catch {}

        setTimeout(() => {

          if (
            bot !== botInstance ||
            !isOnline
          ) {
            return
          }

          if (HOME_COMMAND) {

            sendChat(
              bot,
              HOME_COMMAND
            )

          }

          startAFK(bot)

        }, 3000)

      }, 1000)

    }
  )

  // ==========================================================
  // SERVER MESSAGE
  // ==========================================================

  bot.on(
    'message',
    message => {

      try {

        const text =
          message.toString().trim()

        if (!text) {
          return
        }

        addLog(
          `[Server] ${text}`
        )

      } catch {}

    }
  )

  // ==========================================================
  // KICK
  // ==========================================================

  bot.on(
    'kicked',
    reason => {

      isOnline = false
      isConnecting = false

      stopTimers()

      let reasonText = ''

      try {

        if (
          typeof reason === 'string'
        ) {

          reasonText = reason

        } else {

          reasonText =
            JSON.stringify(reason)

        }

      } catch {

        reasonText =
          String(reason)

      }

      botStatus =
        'Bị kick khỏi server'

      addLog(
        `⚠️ Bot bị kick: ${reasonText}`
      )

    }
  )

  // ==========================================================
  // ERROR
  // ==========================================================

  bot.on(
    'error',
    error => {

      isOnline = false
      isConnecting = false

      botStatus =
        'Gặp lỗi kết nối'

      addLog(
        `❌ Lỗi: ${error.message}`
      )

      if (error.code) {

        addLog(
          `Mã lỗi: ${error.code}`
        )

      }

    }
  )

  // ==========================================================
  // END
  // ==========================================================

  bot.on(
    'end',
    reason => {

      isOnline = false
      isConnecting = false

      stopTimers()

      if (
        botInstance === bot
      ) {

        botInstance = null

      }

      if (manualStop) {

        botStatus =
          'Đã dừng thủ công'

        addLog(
          '🛑 Bot đã dừng thủ công.'
        )

        return
      }

      if (!spawnDone) {

        addLog(
          '⚠️ Bot mất kết nối trước khi spawn.'
        )

      } else {

        addLog(
          'Bot mất kết nối: socketClosed'
        )

      }

      botStatus =
        'Mất kết nối — đang thử lại...'

      scheduleReconnect()

    }
  )

}

// ============================================================
// WEB SERVER
// ============================================================

function startWebServer() {

  const server =
    http.createServer(
      async (req, res) => {

        // ----------------------------------------------------
        // HEALTH
        // ----------------------------------------------------

        if (
          req.url === '/health' &&
          req.method === 'GET'
        ) {

          res.writeHead(
            200,
            {
              'Content-Type':
                'application/json; charset=utf-8'
            }
          )

          return res.end(
            JSON.stringify({
              success: true,
              online: isOnline,
              status: botStatus,
              bot: BOT_USERNAME,
              server:
                `${SERVER_HOST}:${SERVER_PORT}`,
              version: MC_VERSION,
              uptime:
                Math.floor(
                  (Date.now() - startTime) / 1000
                )
            })
          )

        }

        // ----------------------------------------------------
        // LOGS
        // ----------------------------------------------------

        if (
          req.url === '/logs' &&
          req.method === 'GET'
        ) {

          res.writeHead(
            200,
            {
              'Content-Type':
                'application/json; charset=utf-8'
            }
          )

          return res.end(
            JSON.stringify({
              logs
            })
          )

        }

        // ----------------------------------------------------
        // RESTART
        // ----------------------------------------------------

        if (
          req.url === '/restart' &&
          req.method === 'POST'
        ) {

          manualStop = false

          stopTimers()

          if (botInstance) {

            try {
              botInstance.end()
            } catch {}

            botInstance = null

          }

          isOnline = false
          isConnecting = false

          botStatus =
            'Đang restart...'

          addLog(
            '🔄 Yêu cầu restart bot.'
          )

          setTimeout(
            createBot,
            1000
          )

          res.writeHead(
            200,
            {
              'Content-Type':
                'application/json'
            }
          )

          return res.end(
            JSON.stringify({
              success: true,
              message:
                'Đang khởi động lại bot...'
            })
          )

        }

        // ----------------------------------------------------
        // DASHBOARD
        // ----------------------------------------------------

        res.writeHead(
          200,
          {
            'Content-Type':
              'text/html; charset=utf-8'
          }
        )

        res.end(`

<!DOCTYPE html>

<html lang="vi">

<head>

<meta charset="UTF-8">

<meta
name="viewport"
content="width=device-width,initial-scale=1.0"
>

<title>AFK Bot 2</title>

<style>

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  padding: 20px;

  min-height: 100vh;

  background: #0f172a;
  color: #f8fafc;

  font-family:
    Arial,
    Helvetica,
    sans-serif;
}

.card {
  width: 100%;
  max-width: 650px;

  margin: auto;

  padding: 24px;

  background: #1e293b;

  border:
    1px solid
    #334155;

  border-radius: 18px;
}

h1 {
  text-align: center;

  color: #38bdf8;

  margin-top: 0;
}

.info {
  background: #0f172a;

  padding: 12px;

  margin: 8px 0;

  border-radius: 10px;
}

.logs {
  margin-top: 15px;

  height: 300px;

  overflow-y: auto;

  background: #090d16;

  padding: 12px;

  border-radius: 10px;

  color: #a7f3d0;

  font-family: monospace;

  font-size: 12px;

  white-space: pre-wrap;
}

button {
  width: 100%;

  padding: 12px;

  margin-top: 15px;

  border: 0;

  border-radius: 9px;

  background: #22c55e;

  color: white;

  font-weight: bold;

  cursor: pointer;
}

</style>

</head>

<body>

<div class="card">

<h1>🤖 AFK Bot Dashboard</h1>

<div class="info">
Bot:
<strong>${BOT_USERNAME}</strong>
</div>

<div class="info">
Server:
<strong>${SERVER_HOST}:${SERVER_PORT}</strong>
</div>

<div class="info">
Version:
<strong>${MC_VERSION}</strong>
</div>

<div class="info">
Trạng thái:
<strong id="status">
${botStatus}
</strong>
</div>

<button onclick="restartBot()">
🔄 Restart Bot
</button>

<h3>📜 Nhật ký</h3>

<div
class="logs"
id="logs"
>${logs.join('\\n')}</div>

</div>

<script>

async function update() {

  try {

    const r =
      await fetch('/health')

    const data =
      await r.json()

    document
      .getElementById('status')
      .textContent =
        data.status

    const l =
      await fetch('/logs')

    const logs =
      await l.json()

    document
      .getElementById('logs')
      .textContent =
        logs.logs.join('\\n')

  } catch {}

}

async function restartBot() {

  try {

    const r =
      await fetch(
        '/restart',
        {
          method: 'POST'
        }
      )

    const data =
      await r.json()

    alert(data.message)

  } catch {

    alert(
      'Không thể kết nối Dashboard.'
    )

  }

}

setInterval(
  update,
  2000
)

</script>

</body>

</html>

`)

      }
    )

  server.listen(
    WEB_PORT,
    '0.0.0.0',
    () => {

      console.log(
        `[Web] Running on port ${WEB_PORT}`
      )

    }
  )

}

// ============================================================
// PROCESS SAFETY
// ============================================================

process.on(
  'uncaughtException',
  error => {

    console.error(
      '[uncaughtException]',
      error
    )

    addLog(
      `❌ Lỗi hệ thống: ${error.message}`
    )

  }
)

process.on(
  'unhandledRejection',
  reason => {

    console.error(
      '[unhandledRejection]',
      reason
    )

  }
)

process.on(
  'SIGTERM',
  () => {

    manualStop = true

    stopTimers()

    if (botInstance) {

      try {

        botInstance.quit(
          'Render shutting down'
        )

      } catch {}

    }

    setTimeout(
      () => process.exit(0),
      1000
    )

  }
)

// ============================================================
// START
// ============================================================

console.log(
  '=========================================='
)

console.log(
  '        MINECRAFT AFK BOT 2'
)

console.log(
  '=========================================='
)

console.log(
  `Server : ${SERVER_HOST}:${SERVER_PORT}`
)

console.log(
  `Version: ${MC_VERSION}`
)

console.log(
  `Bot    : ${BOT_USERNAME}`
)

console.log(
  `Port   : ${WEB_PORT}`
)

console.log(
  '=========================================='
)

startWebServer()

setTimeout(
  createBot,
  1000
)

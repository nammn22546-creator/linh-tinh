'use strict'

const http = require('http')
const mineflayer = require('mineflayer')

// ============================================================
// CONFIG — BOT 2
// ============================================================

const MC_HOST = process.env.MC_HOST || 'puffernetwork.io.vn'
const MC_PORT = Number(process.env.MC_PORT || 25863)

const BOT_USERNAME =
  process.env.BOT_USERNAME || 'hellodomcon123'

const MC_VERSION =
  process.env.MC_VERSION || '1.21.11'

// Lệnh đăng nhập server.
// Render → Environment:
// MC_LOGIN_COMMAND=/login matkhau
const LOGIN_COMMAND =
  process.env.MC_LOGIN_COMMAND || ''

// Sau khi đăng nhập thì bot AFK.
// Không có /server eco ở BOT 2.
const HOME_COMMAND =
  process.env.MC_HOME_COMMAND || ''

const WEB_PORT =
  Number(process.env.PORT || 10000)

const RECONNECT_DELAY = 15000
const SPAWN_TIMEOUT = 60000

// ============================================================
// STATE
// ============================================================

let botInstance = null

let isOnline = false
let isConnecting = false
let manualStop = false

let reconnectTimer = null
let spawnTimer = null
let afkTimer = null

let botStatus = 'Đang khởi động...'

let startTime = Date.now()

let logs = []

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
// UPTIME
// ============================================================

function getUptime() {
  const sec =
    Math.floor((Date.now() - startTime) / 1000)

  const h =
    Math.floor(sec / 3600)

  const m =
    Math.floor((sec % 3600) / 60)

  const s =
    sec % 60

  return `${h} giờ ${m} phút ${s} giây`
}

// ============================================================
// STOP TIMERS
// ============================================================

function stopTimers() {

  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }

  if (spawnTimer) {
    clearTimeout(spawnTimer)
    spawnTimer = null
  }

  if (afkTimer) {
    clearInterval(afkTimer)
    afkTimer = null
  }
}

// ============================================================
// SAFE CHAT
// ============================================================

function sendChat(bot, text) {

  if (!bot) return false

  if (!text) return false

  try {

    bot.chat(text)

    // Không in mật khẩu/lệnh login ra log
    if (
      text.toLowerCase().startsWith('/login') ||
      text.toLowerCase().startsWith('/register') ||
      text.toLowerCase().startsWith('/changepassword')
    ) {

      addLog(
        '🔐 Đã gửi lệnh đăng nhập.'
      )

    } else {

      addLog(
        `💬 Đã gửi: ${text}`
      )

    }

    return true

  } catch (error) {

    addLog(
      `❌ Không thể gửi chat: ${error.message}`
    )

    return false
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

  addLog('🟢 Bot đã vào game → bắt đầu AFK.')

  afkTimer = setInterval(() => {

    if (
      botInstance !== bot ||
      !isOnline ||
      !bot.entity
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
            botInstance === bot &&
            isOnline
          ) {

            bot.setControlState(
              'jump',
              false
            )

          }

        } catch {}

      }, 250)

    } catch {}

  }, 5000)
}

// ============================================================
// RESOURCE PACK
// ============================================================

function acceptResourcePack(bot) {

  if (!bot) return

  try {

    if (
      typeof bot.acceptResourcePack ===
      'function'
    ) {

      bot.acceptResourcePack()

      addLog(
        '📦 Server yêu cầu Resource Pack.'
      )

      addLog(
        '✅ Đã ACCEPT Resource Pack ngay lập tức.'
      )

    } else {

      addLog(
        '⚠️ Mineflayer không có acceptResourcePack().'
      )

    }

  } catch (error) {

    addLog(
      `❌ Lỗi Resource Pack: ${error.message}`
    )

  }
}

// ============================================================
// RECONNECT
// ============================================================

function scheduleReconnect() {

  if (manualStop) return

  if (reconnectTimer) return

  botStatus =
    'Offline — thử lại sau 15 giây'

  addLog(
    '⏳ Tự động kết nối lại sau 15 giây...'
  )

  reconnectTimer =
    setTimeout(() => {

      reconnectTimer = null

      if (
        manualStop ||
        isConnecting ||
        isOnline
      ) {
        return
      }

      addLog(
        '🔄 Bắt đầu kết nối lại...'
      )

      createBot()

    }, RECONNECT_DELAY)
}

// ============================================================
// CREATE BOT
// ============================================================

function createBot() {

  if (isConnecting) {

    addLog(
      '⚠️ Đã có kết nối đang chạy.'
    )

    return
  }

  if (isOnline) {

    addLog(
      '⚠️ Bot đang online.'
    )

    return
  }

  manualStop = false
  isConnecting = true

  stopTimers()

  botStatus =
    'Đang kết nối server Minecraft...'

  addLog(
    `Đang kết nối ${MC_HOST}:${MC_PORT}...`
  )

  let bot

  try {

    bot =
      mineflayer.createBot({

        host: MC_HOST,

        port: MC_PORT,

        username: BOT_USERNAME,

        version: MC_VERSION,

        // Quan trọng khi server chậm handshake
        connectTimeout: 30000,

        checkTimeoutInterval: 120000

      })

  } catch (error) {

    isConnecting = false

    botStatus =
      'Lỗi tạo bot'

    addLog(
      `❌ createBot: ${error.message}`
    )

    scheduleReconnect()

    return
  }

  botInstance = bot

  let spawned = false
  let loginSent = false

  // ==========================================================
  // TCP CONNECT
  // ==========================================================

  bot._client?.socket?.on(
    'connect',
    () => {

      addLog(
        '🔌 TCP đã kết nối tới server.'
      )

    }
  )

  // ==========================================================
  // RESOURCE PACK — ĐẶT SỚM
  // ==========================================================

  bot.on(
    'resourcePack',
    () => {

      acceptResourcePack(bot)

    }
  )

  // ==========================================================
  // LOGIN PACKET
  // ==========================================================

  bot.once(
    'login',
    () => {

      addLog(
        '🔑 Minecraft handshake/login thành công.'
      )

    }
  )

  // ==========================================================
  // SPAWN
  // ==========================================================

  bot.once(
    'spawn',
    () => {

      spawned = true

      isConnecting = false
      isOnline = true

      botStatus =
        'Đang hoạt động (Online)'

      if (spawnTimer) {
        clearTimeout(spawnTimer)
        spawnTimer = null
      }

      addLog(
        `✅ ${BOT_USERNAME} đã SPAWN vào server.`
      )

      // ------------------------------------------------------
      // LOGIN
      // ------------------------------------------------------

      if (
        LOGIN_COMMAND &&
        !loginSent
      ) {

        loginSent = true

        addLog(
          '🔐 Chuẩn bị đăng nhập server...'
        )

        setTimeout(() => {

          if (
            botInstance !== bot ||
            !isOnline
          ) {
            return
          }

          sendChat(
            bot,
            LOGIN_COMMAND
          )

          // --------------------------------------------------
          // HOME COMMAND
          // --------------------------------------------------

          setTimeout(() => {

            if (
              botInstance !== bot ||
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
                botInstance === bot &&
                isOnline
              ) {

                startAFK(bot)

              }

            }, 1500)

          }, 2500)

        }, 2500)

      } else {

        // Không cần login
        if (HOME_COMMAND) {

          setTimeout(() => {

            if (
              botInstance === bot &&
              isOnline
            ) {

              sendChat(
                bot,
                HOME_COMMAND
              )

            }

          }, 1000)

        }

        setTimeout(() => {

          if (
            botInstance === bot &&
            isOnline
          ) {

            startAFK(bot)

          }

        }, 2000)

      }

    }
  )

  // ==========================================================
  // SPAWN TIMEOUT
  // ==========================================================

  spawnTimer =
    setTimeout(() => {

      if (
        botInstance !== bot ||
        spawned ||
        !isConnecting
      ) {
        return
      }

      addLog(
        '⚠️ Quá 60 giây nhưng Bot chưa SPAWN.'
      )

      addLog(
        '⚠️ Server có thể yêu cầu handshake/auth khác hoặc đang chặn bot.'
      )

      try {
        bot.end()
      } catch {}

    }, SPAWN_TIMEOUT)

  // ==========================================================
  // CHAT / MESSAGE
  // ==========================================================

  bot.on(
    'message',
    message => {

      try {

        const text =
          message.toString().trim()

        if (!text) return

        // Không log password
        if (
          text.toLowerCase().includes('/login') ||
          text.toLowerCase().includes('/register')
        ) {

          addLog(
            '💬 Server gửi thông báo đăng nhập.'
          )

          return
        }

        addLog(
          `📨 Server: ${text}`
        )

      } catch {}

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

      if (afkTimer) {

        clearInterval(afkTimer)

        afkTimer = null

      }

      setTimeout(() => {

        if (
          botInstance !== bot ||
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
            botInstance !== bot ||
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

      }, 1500)

    }
  )

  // ==========================================================
  // KICK
  // ==========================================================

  bot.on(
    'kicked',
    reason => {

      let text

      try {

        text =
          typeof reason === 'string'
            ? reason
            : JSON.stringify(reason)

      } catch {

        text =
          String(reason)

      }

      addLog(
        `⚠️ Bot bị KICK: ${text}`
      )

    }
  )

  // ==========================================================
  // ERROR
  // ==========================================================

  bot.on(
    'error',
    error => {

      addLog(
        `❌ Lỗi bot: ${error.message}`
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

      if (spawnTimer) {

        clearTimeout(spawnTimer)

        spawnTimer = null

      }

      if (afkTimer) {

        clearInterval(afkTimer)

        afkTimer = null

      }

      isOnline = false
      isConnecting = false

      if (
        botInstance === bot
      ) {

        botInstance = null

      }

      if (manualStop) {

        botStatus =
          'Đã dừng thủ công'

        addLog(
          '🛑 Bot đã dừng.'
        )

        return
      }

      if (!spawned) {

        addLog(
          `⚠️ Bot mất kết nối trước khi SPAWN: ${reason || 'socketClosed'}`
        )

      } else {

        addLog(
          `⚠️ Bot mất kết nối: ${reason || 'socketClosed'}`
        )

      }

      botStatus =
        'Mất kết nối — đang reconnect...'

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
      (req, res) => {

        if (
          req.url === '/health'
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
              uptime: getUptime()
            })
          )

        }

        if (
          req.url === '/status'
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

              online:
                isOnline,

              connecting:
                isConnecting,

              status:
                botStatus,

              server:
                `${MC_HOST}:${MC_PORT}`,

              version:
                MC_VERSION,

              bot:
                BOT_USERNAME,

              uptime:
                getUptime(),

              logs

            })
          )

        }

        res.writeHead(
          200,
          {
            'Content-Type':
              'text/html; charset=utf-8'
          }
        )

        res.end(`<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>AFK Bot 2</title>

<style>
body{
  margin:0;
  background:#0f172a;
  color:#e2e8f0;
  font-family:Arial,sans-serif;
  padding:20px;
}
.card{
  max-width:700px;
  margin:auto;
  background:#1e293b;
  border-radius:16px;
  padding:20px;
}
h1{
  text-align:center;
  color:#38bdf8;
}
.box{
  background:#0f172a;
  padding:12px;
  margin:8px 0;
  border-radius:10px;
}
.online{
  color:#4ade80;
  font-weight:bold;
}
.offline{
  color:#f87171;
  font-weight:bold;
}
pre{
  white-space:pre-wrap;
  word-break:break-word;
  background:#020617;
  padding:12px;
  border-radius:10px;
  max-height:400px;
  overflow:auto;
}
</style>
</head>

<body>

<div class="card">

<h1>🤖 AFK BOT 2</h1>

<div class="box">
Server:
<strong>${MC_HOST}:${MC_PORT}</strong>
</div>

<div class="box">
Bot:
<strong>${BOT_USERNAME}</strong>
</div>

<div class="box">
Version:
<strong>${MC_VERSION}</strong>
</div>

<div class="box">
Status:
<span id="status">Đang tải...</span>
</div>

<div class="box">
Uptime:
<span id="uptime">...</span>
</div>

<pre id="logs">Đang tải log...</pre>

</div>

<script>

async function update(){

  try{

    const r =
      await fetch('/status')

    const d =
      await r.json()

    const status =
      document.getElementById('status')

    status.textContent =
      d.status

    status.className =
      d.online
        ? 'online'
        : 'offline'

    document.getElementById('uptime')
      .textContent =
        d.uptime

    document.getElementById('logs')
      .textContent =
        d.logs.join('\\n')

  }catch{}

}

update()

setInterval(
  update,
  3000
)

</script>

</body>
</html>`)

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
      `💥 uncaughtException: ${error.message}`
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

    addLog(
      `💥 unhandledRejection: ${String(reason)}`
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
  `Server : ${MC_HOST}:${MC_PORT}`
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
  () => {

    addLog(
      '🔄 Bắt đầu kết nối...'
    )

    createBot()

  },
  1000
)

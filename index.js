const http = require('http')
const mineflayer = require('mineflayer')
const url = require('url')

// ======================================================
// CONFIG
// ======================================================

const SERVER_HOST = process.env.MC_HOST || 'puffernetwork.io.vn'
const SERVER_PORT = Number(process.env.MC_PORT || 25863)

const BOT_USERNAME = process.env.MC_USERNAME || 'hellodomcon123'
const MC_VERSION = process.env.MC_VERSION || '1.21.11'

const LOGIN_COMMAND = process.env.LOGIN_COMMAND || '/login domcon1234'
const HOME_COMMAND = process.env.HOME_COMMAND || '/tpa domcon123'

const WEB_PASSWORD =
  process.env.WEB_PASSWORD || 'CHANGE_THIS_PASSWORD'

const WEB_PORT = Number(process.env.PORT || 8080)

const RECONNECT_DELAY = 15000
const LOGIN_DELAY = 3000
const COMMAND_DELAY = 3000
const AFK_INTERVAL = 5000

// ======================================================
// SECURITY
// ======================================================

const SENSITIVE_WORDS = [
  'domcon1234',
  'condombebong123',
  '/login',
  '/register',
  '/changepassword',
  '/passwd'
]

const authenticatedIPs = new Set()

function getClientIP(req) {
  const forwarded = req.headers['x-forwarded-for']

  if (forwarded) {
    return forwarded.split(',')[0].trim()
  }

  return req.socket.remoteAddress || 'unknown'
}

function containsSensitiveData(text) {
  if (!text) return false

  const lower = String(text).toLowerCase()

  return SENSITIVE_WORDS.some(word =>
    lower.includes(word.toLowerCase())
  )
}

// ======================================================
// STATE
// ======================================================

let botStatus = 'Đang khởi động...'
let isOnline = false
let startTime = Date.now()

let logs = []

let botInstance = null

let afkInterval = null
let reconnectTimeout = null

let isConnecting = false
let manualStop = false
let restartInProgress = false

let connectionGeneration = 0

let currentVault = {
  title: 'Chưa mở kho nào',
  items: []
}

// ======================================================
// LOGGING
// ======================================================

function addLog(message) {
  if (containsSensitiveData(message)) {
    message = '[Thông tin bảo mật đã được ẩn]'
  }

  const time = new Date().toLocaleTimeString('vi-VN')

  logs.unshift(`[${time}] ${message}`)

  if (logs.length > 40) {
    logs.pop()
  }

  console.log(`[BOT] ${message}`)
}

function getUptime() {
  const seconds = Math.floor(
    (Date.now() - startTime) / 1000
  )

  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60

  return `${h} giờ ${m} phút ${s} giây`
}

// ======================================================
// INVENTORY
// ======================================================

function getInventoryItems() {
  if (
    !botInstance ||
    !isOnline ||
    !botInstance.inventory
  ) {
    return []
  }

  return botInstance.inventory.items().map(item => ({
    name: item.displayName || item.name,
    count: item.count,
    slot: item.slot
  }))
}

// ======================================================
// AFK
// ======================================================

function stopAFK() {
  if (afkInterval) {
    clearInterval(afkInterval)
    afkInterval = null
  }
}

function stopAllModes() {
  stopAFK()

  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout)
    reconnectTimeout = null
  }
}

function startAFK(bot) {
  stopAFK()

  if (!bot) return

  addLog('🔄 Đã bật chế độ AFK.')

  afkInterval = setInterval(() => {
    if (
      !bot ||
      bot !== botInstance ||
      !isOnline ||
      !bot.entity
    ) {
      return
    }

    try {
      bot.setControlState('jump', true)

      setTimeout(() => {
        if (
          bot &&
          bot === botInstance &&
          typeof bot.setControlState === 'function'
        ) {
          bot.setControlState('jump', false)
        }
      }, 200)

    } catch (err) {
      console.log('AFK error:', err.message)
    }
  }, AFK_INTERVAL)
}

// ======================================================
// SAFE CHAT
// ======================================================

function safeChat(bot, message) {
  if (
    !bot ||
    bot !== botInstance ||
    typeof bot.chat !== 'function'
  ) {
    return false
  }

  try {
    bot.chat(message)

    if (containsSensitiveData(message)) {
      addLog('[Hệ thống]: [Đã ẩn lệnh bảo mật]')
    } else {
      addLog(`[Hệ thống]: ${message}`)
    }

    return true

  } catch (err) {
    addLog(`❌ Không gửi được chat: ${err.message}`)
    return false
  }
}

// ======================================================
// RECONNECT
// ======================================================

function scheduleReconnect(reason = 'Mất kết nối') {

  if (manualStop) {
    addLog('🛑 Bot đang được tắt thủ công, không reconnect.')
    return
  }

  if (restartInProgress) {
    addLog('🔄 Đang restart, bỏ qua reconnect tự động.')
    return
  }

  if (reconnectTimeout) {
    return
  }

  isOnline = false
  isConnecting = false

  botStatus = `Mất kết nối - thử lại sau ${RECONNECT_DELAY / 1000}s`

  addLog(`${reason}`)

  reconnectTimeout = setTimeout(() => {

    reconnectTimeout = null

    if (
      manualStop ||
      restartInProgress ||
      isOnline ||
      isConnecting
    ) {
      return
    }

    addLog('⏳ Bắt đầu kết nối lại...')
    createBotInstance()

  }, RECONNECT_DELAY)
}

// ======================================================
// DESTROY BOT
// ======================================================

function destroyCurrentBot() {

  const oldBot = botInstance

  if (!oldBot) {
    return
  }

  botInstance = null

  try {
    oldBot.removeAllListeners()
  } catch (e) {}

  try {
    oldBot.quit()
  } catch (e) {}

  try {
    oldBot.end()
  } catch (e) {}
}

// ======================================================
// CREATE BOT
// ======================================================

function createBotInstance() {

  if (manualStop) {
    addLog('🛑 Bot đang ở trạng thái tắt thủ công.')
    return
  }

  if (isConnecting) {
    addLog('⚠️ Đã có một kết nối đang chạy.')
    return
  }

  if (botInstance && isOnline) {
    addLog('⚠️ Bot đã online.')
    return
  }

  isConnecting = true

  stopAllModes()

  const generation = ++connectionGeneration

  botStatus = 'Đang kết nối server...'
  isOnline = false

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

  } catch (err) {

    isConnecting = false

    botStatus = 'Lỗi tạo bot'

    addLog(`❌ Không thể tạo bot: ${err.message}`)

    scheduleReconnect(
      '❌ Không tạo được kết nối Minecraft.'
    )

    return
  }

  botInstance = bot

  let loginFlowStarted = false
  let destroyed = false

  // ====================================================
  // RESOURCE PACK
  // ====================================================

  bot.on('resourcePack', () => {

    addLog(
      '📦 Server yêu cầu Resource Pack.'
    )

    try {

      if (typeof bot.acceptResourcePack === 'function') {
        bot.acceptResourcePack()

        addLog(
          '✅ Đã chấp nhận Resource Pack.'
        )
      }

    } catch (err) {

      addLog(
        `❌ Resource Pack lỗi: ${err.message}`
      )
    }
  })

  // ====================================================
  // WINDOW
  // ====================================================

  bot.on('windowOpen', window => {

    let title = 'Kho'

    try {

      if (window && window.title) {

        if (typeof window.title === 'string') {

          try {
            const parsed = JSON.parse(window.title)

            title =
              parsed.text ||
              parsed.translate ||
              window.title

          } catch {
            title = window.title
          }

        } else {
          title = String(window.title)
        }
      }

    } catch {
      title = 'Kho'
    }

    addLog(`📦 Đã mở giao diện: ${title}`)

    try {

      const items = window
        .containerItems()
        .map(item => ({
          name: item.displayName || item.name,
          count: item.count,
          slot: item.slot
        }))

      currentVault = {
        title,
        items
      }

    } catch (err) {

      addLog(
        `⚠️ Không đọc được kho: ${err.message}`
      )
    }
  })

  // ====================================================
  // SPAWN
  // ====================================================

  bot.on('spawn', () => {

    if (generation !== connectionGeneration) {
      return
    }

    isConnecting = false
    isOnline = true
    manualStop = false

    botStatus = 'Đang hoạt động (Online)'

    startTime = Date.now()

    addLog(
      `✅ Bot ${BOT_USERNAME} đã vào server!`
    )

    if (!loginFlowStarted) {

      loginFlowStarted = true

      setTimeout(() => {

        if (
          bot !== botInstance ||
          !isOnline
        ) {
          return
        }

        safeChat(bot, LOGIN_COMMAND)

        setTimeout(() => {

          if (
            bot !== botInstance ||
            !isOnline
          ) {
            return
          }

          safeChat(bot, HOME_COMMAND)

          addLog(
            `📍 Đã thực hiện: ${HOME_COMMAND}`
          )

          startAFK(bot)

        }, COMMAND_DELAY)

      }, LOGIN_DELAY)

    } else {

      startAFK(bot)

    }
  })

  // ====================================================
  // DEATH
  // ====================================================

  bot.on('death', () => {

    if (
      bot !== botInstance ||
      !isOnline
    ) {
      return
    }

    stopAFK()

    addLog(
      '☠️ Bot đã chết. Đang hồi sinh...'
    )

    try {
      bot.respawn()
    } catch (err) {
      addLog(
        `❌ Respawn lỗi: ${err.message}`
      )
      return
    }

    setTimeout(() => {

      if (
        bot !== botInstance ||
        !isOnline
      ) {
        return
      }

      safeChat(bot, HOME_COMMAND)

      addLog(
        `📍 Đã thực hiện lại: ${HOME_COMMAND}`
      )

      startAFK(bot)

    }, 3000)
  })

  // ====================================================
  // CHAT / MESSAGE
  // ====================================================

  bot.on('message', message => {

    const text = message
      .toString()
      .trim()

    if (!text) return

    if (containsSensitiveData(text)) {

      addLog(
        '[Server]: [Thông tin bảo mật đã được ẩn]'
      )

      return
    }

    console.log(`[Server] ${text}`)
    addLog(`[Server]: ${text}`)
  })

  // ====================================================
  // KICK
  // ====================================================

  bot.on('kicked', reason => {

    if (destroyed) return

    const text =
      typeof reason === 'string'
        ? reason
        : JSON.stringify(reason)

    isOnline = false
    isConnecting = false

    stopAFK()

    addLog(
      `⚠️ Bot bị kick: ${containsSensitiveData(text)
        ? '[Đã ẩn]'
        : text}`
    )

    if (!manualStop && !restartInProgress) {
      scheduleReconnect(
        'Bot bị kick khỏi server.'
      )
    }
  })

  // ====================================================
  // ERROR
  // ====================================================

  bot.on('error', err => {

    if (destroyed) return

    isOnline = false
    isConnecting = false

    stopAFK()

    addLog(
      `❌ Lỗi Minecraft: ${err.message}`
    )

    if (!manualStop && !restartInProgress) {
      scheduleReconnect(
        'Lỗi kết nối Minecraft.'
      )
    }
  })

  // ====================================================
  // END
  // ====================================================

  bot.on('end', () => {

    if (destroyed) return

    destroyed = true

    isOnline = false
    isConnecting = false

    stopAFK()

    // Chỉ xử lý bot hiện tại
    if (bot === botInstance) {
      botInstance = null
    }

    addLog('🔌 Bot đã thoát khỏi server.')

    if (
      !manualStop &&
      !restartInProgress
    ) {

      scheduleReconnect(
        'Bot mất kết nối.'
      )
    }
  })
}

// ======================================================
// HTTP HELPERS
// ======================================================

function sendJSON(res, status, data) {

  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  })

  res.end(JSON.stringify(data))
}

function readJSON(req) {

  return new Promise((resolve, reject) => {

    let body = ''

    req.on('data', chunk => {

      body += chunk.toString()

      // chống body quá lớn
      if (body.length > 1024 * 1024) {
        reject(
          new Error('Request quá lớn')
        )

        req.destroy()
      }
    })

    req.on('end', () => {

      try {

        resolve(
          body ? JSON.parse(body) : {}
        )

      } catch (err) {

        reject(err)
      }
    })

    req.on('error', reject)
  })
}

function authenticate(clientIP, password) {

  if (authenticatedIPs.has(clientIP)) {
    return true
  }

  if (
    typeof password === 'string' &&
    password === WEB_PASSWORD
  ) {

    authenticatedIPs.add(clientIP)

    return true
  }

  return false
}

// ======================================================
// WEB SERVER
// ======================================================

function startWebServer(port) {

  const server = http.createServer(
    async (req, res) => {

      const parsedUrl =
        url.parse(req.url, true)

      const clientIP =
        getClientIP(req)

      // ================================================
      // AUTH
      // ================================================

      if (
        parsedUrl.pathname === '/check-auth' &&
        req.method === 'GET'
      ) {

        return sendJSON(res, 200, {
          isAuth: authenticatedIPs.has(clientIP)
        })
      }

      // ================================================
      // STATUS
      // ================================================

      if (
        parsedUrl.pathname === '/status' &&
        req.method === 'GET'
      ) {

        return sendJSON(res, 200, {
          success: true,
          status: botStatus,
          online: isOnline,
          connecting: isConnecting,
          username: BOT_USERNAME,
          host: SERVER_HOST,
          port: SERVER_PORT,
          version: MC_VERSION,
          uptime: getUptime()
        })
      }

      // ================================================
      // INVENTORY
      // ================================================

      if (
        parsedUrl.pathname === '/get-inventory' &&
        req.method === 'GET'
      ) {

        return sendJSON(res, 200, {
          success: true,
          items: getInventoryItems(),
          vault: currentVault,
          heldItem:
            botInstance?.heldItem
              ? (
                botInstance.heldItem.displayName ||
                botInstance.heldItem.name
              )
              : 'Tay không'
        })
      }

      // ================================================
      // LOGS
      // ================================================

      if (
        parsedUrl.pathname === '/logs' &&
        req.method === 'GET'
      ) {

        return sendJSON(res, 200, {
          success: true,
          logs
        })
      }

      // ================================================
      // SEND CHAT
      // ================================================

      if (
        parsedUrl.pathname === '/send-chat' &&
        req.method === 'POST'
      ) {

        try {

          const data = await readJSON(req)

          if (
            !authenticate(
              clientIP,
              data.password
            )
          ) {

            return sendJSON(res, 401, {
              success: false,
              message: 'Sai mật khẩu xác thực!'
            })
          }

          if (
            !isOnline ||
            !botInstance
          ) {

            return sendJSON(res, 400, {
              success: false,
              message: 'Bot chưa vào game!'
            })
          }

          const message =
            typeof data.message === 'string'
              ? data.message.trim()
              : ''

          if (!message) {

            return sendJSON(res, 400, {
              success: false,
              message: 'Tin nhắn trống!'
            })
          }

          safeChat(
            botInstance,
            message
          )

          return sendJSON(res, 200, {
            success: true,
            message: 'Đã gửi thành công!',
            isAuth: true
          })

        } catch (err) {

          return sendJSON(res, 400, {
            success: false,
            message: 'Lỗi dữ liệu!'
          })
        }
      }

      // ================================================
      // STOP BOT
      // ================================================

      if (
        parsedUrl.pathname === '/stop-bot' &&
        req.method === 'POST'
      ) {

        try {

          const data = await readJSON(req)

          if (
            !authenticate(
              clientIP,
              data.password
            )
          ) {

            return sendJSON(res, 401, {
              success: false,
              message: 'Sai mật khẩu xác thực!'
            })
          }

          manualStop = true
          restartInProgress = false

          stopAllModes()

          isOnline = false
          isConnecting = false

          botStatus =
            'Đã dừng thủ công (Offline)'

          if (botInstance) {

            const oldBot = botInstance

            botInstance = null

            try {
              oldBot.quit(
                'Được tắt bởi Admin'
              )
            } catch {}

            try {
              oldBot.end()
            } catch {}
          }

          addLog(
            '🛑 Bot đã được tắt bởi Admin.'
          )

          return sendJSON(res, 200, {
            success: true,
            message: 'Đã tắt bot thành công!',
            isAuth: true
          })

        } catch {

          return sendJSON(res, 400, {
            success: false,
            message: 'Lỗi dữ liệu!'
          })
        }
      }

      // ================================================
      // RESTART
      // ================================================

      if (
        parsedUrl.pathname === '/restart' &&
        req.method === 'POST'
      ) {

        if (restartInProgress) {

          return sendJSON(res, 400, {
            success: false,
            message: 'Bot đang restart, vui lòng chờ!'
          })
        }

        restartInProgress = true
        manualStop = false

        stopAllModes()

        isOnline = false
        isConnecting = false

        botStatus =
          'Đang khởi động lại...'

        addLog(
          '🔄 Yêu cầu khởi động lại bot từ Web Dashboard...'
        )

        const oldBot = botInstance

        botInstance = null

        if (oldBot) {

          try {
            oldBot.removeAllListeners()
          } catch {}

          try {
            oldBot.quit(
              'Restart Bot'
            )
          } catch {}

          try {
            oldBot.end()
          } catch {}
        }

        setTimeout(() => {

          restartInProgress = false

          if (!manualStop) {

            addLog(
              '🚀 Bắt đầu bot mới...'
            )

            createBotInstance()
          }

        }, 2500)

        return sendJSON(res, 200, {
          success: true,
          message: 'Đang khởi động lại bot...'
        })
      }

      // ==================================================
      // DASHBOARD
      // ==================================================

      res.writeHead(200, {
        'Content-Type':
          'text/html; charset=utf-8'
      })

      res.end(`
<!DOCTYPE html>
<html lang="vi">

<head>

<meta charset="UTF-8">

<meta
name="viewport"
content="width=device-width,initial-scale=1.0"
>

<title>Bot 2 Dashboard</title>

<style>

* {
  box-sizing: border-box;
  font-family: Arial, sans-serif;
}

body {
  margin: 0;
  min-height: 100vh;
  background: #0f172a;
  color: #f8fafc;
  display: flex;
  justify-content: center;
  padding: 20px;
}

.card {
  width: 100%;
  max-width: 600px;
  background: #1e293b;
  border: 1px solid #334155;
  border-radius: 16px;
  padding: 22px;
}

.title {
  text-align: center;
  font-size: 23px;
  font-weight: bold;
  color: #38bdf8;
  margin-bottom: 12px;
}

.badge {
  text-align: center;
  margin-bottom: 15px;
  color: ${isOnline ? '#4ade80' : '#f87171'};
  font-weight: bold;
}

.info {
  background: #0f172a;
  padding: 11px;
  border-radius: 9px;
  margin-bottom: 8px;
}

.label {
  color: #94a3b8;
  font-size: 11px;
  text-transform: uppercase;
}

.value {
  margin-top: 4px;
  font-weight: bold;
}

.section {
  color: #38bdf8;
  font-weight: bold;
  font-size: 12px;
  margin-top: 16px;
  margin-bottom: 7px;
}

.inventory {
  max-height: 180px;
  overflow-y: auto;
  background: #0f172a;
  border-radius: 8px;
}

table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

th,
td {
  padding: 9px;
  border-bottom: 1px solid #1e293b;
  text-align: left;
}

th {
  color: #38bdf8;
  position: sticky;
  top: 0;
  background: #1e293b;
}

input {
  width: 100%;
  padding: 11px;
  margin-top: 6px;
  border-radius: 8px;
  border: 1px solid #334155;
  background: #0f172a;
  color: white;
  outline: none;
}

button {
  width: 100%;
  border: 0;
  padding: 11px;
  border-radius: 9px;
  margin-top: 8px;
  font-weight: bold;
  cursor: pointer;
}

.send {
  background: #38bdf8;
}

.stop {
  background: #ef4444;
  color: white;
}

.restart {
  background: #22c55e;
  color: white;
}

.logs {
  background: #090d16;
  border-radius: 8px;
  padding: 10px;
  height: 160px;
  overflow-y: auto;
  font-family: monospace;
  font-size: 11px;
}

.log {
  margin-bottom: 5px;
  word-break: break-word;
}

</style>

</head>

<body>

<div class="card">

<div class="title">
🤖 AFK BOT 2
</div>

<div
class="badge"
id="status"
>
● ${botStatus}
</div>

<div class="info">
<div class="label">Bot</div>
<div class="value">${BOT_USERNAME}</div>
</div>

<div class="info">
<div class="label">Server</div>
<div class="value">
${SERVER_HOST}:${SERVER_PORT}
</div>
</div>

<div class="info">
<div class="label">Phiên bản</div>
<div class="value">${MC_VERSION}</div>
</div>

<div class="info">
<div class="label">Uptime</div>
<div
class="value"
id="uptime"
>
${getUptime()}
</div>
</div>

<div class="section">
🎒 TÚI ĐỒ
</div>

<div class="inventory">

<table>

<thead>
<tr>
<th>Slot</th>
<th>Vật phẩm</th>
<th>Số lượng</th>
</tr>
</thead>

<tbody id="inventory">
<tr>
<td colspan="3">
Đang tải...
</td>
</tr>
</tbody>

</table>

</div>

<div class="section">
💬 CHAT / LỆNH
</div>

<input
id="message"
placeholder="Nhập chat hoặc lệnh..."
>

<input
id="password"
type="password"
placeholder="Mật khẩu web"
>

<button
class="send"
onclick="sendChat()"
>
🚀 Gửi
</button>

<div class="section">
📜 NHẬT KÝ
</div>

<div
class="logs"
id="logs"
>
${logs.map(
  x => `<div class="log">${x}</div>`
).join('')}
</div>

<button
class="stop"
onclick="stopBot()"
>
🛑 Tắt Bot
</button>

<button
class="restart"
onclick="restartBot()"
>
🔄 Restart Bot
</button>

</div>

<script>

let authenticated = false

async function checkAuth() {

  try {

    const r =
      await fetch('/check-auth')

    const d =
      await r.json()

    authenticated = d.isAuth

    if (authenticated) {
      document.getElementById(
        'password'
      ).style.display = 'none'
    }

  } catch {}
}

async function sendChat() {

  const message =
    document.getElementById(
      'message'
    ).value.trim()

  const password =
    document.getElementById(
      'password'
    ).value

  if (!message) {
    alert('Nhập tin nhắn!')
    return
  }

  if (!authenticated && !password) {
    alert('Nhập mật khẩu!')
    return
  }

  try {

    const r =
      await fetch('/send-chat', {
        method: 'POST',
        headers: {
          'Content-Type':
            'application/json'
        },
        body: JSON.stringify({
          message,
          password
        })
      })

    const d =
      await r.json()

    alert(d.message)

    if (d.success) {

      document.getElementById(
        'message'
      ).value = ''

      authenticated = true

      document.getElementById(
        'password'
      ).style.display = 'none'
    }

  } catch {

    alert('Không kết nối được dashboard!')
  }
}

async function stopBot() {

  if (
    !confirm(
      'Bạn chắc chắn muốn tắt bot?'
    )
  ) {
    return
  }

  const password =
    document.getElementById(
      'password'
    ).value

  try {

    const r =
      await fetch('/stop-bot', {
        method: 'POST',
        headers: {
          'Content-Type':
            'application/json'
        },
        body: JSON.stringify({
          password
        })
      })

    const d =
      await r.json()

    alert(d.message)

    setTimeout(
      () => location.reload(),
      500
    )

  } catch {

    alert('Lỗi kết nối!')
  }
}

async function restartBot() {

  try {

    const r =
      await fetch('/restart', {
        method: 'POST'
      })

    const d =
      await r.json()

    alert(d.message)

    setTimeout(
      () => location.reload(),
      2500
    )

  } catch {

    alert('Lỗi restart!')
  }
}

async function updateStatus() {

  try {

    const r =
      await fetch('/status')

    const d =
      await r.json()

    document.getElementById(
      'status'
    ).innerText =
      '● ' + d.status

    document.getElementById(
      'uptime'
    ).innerText =
      d.uptime

  } catch {}
}

async function updateInventory() {

  try {

    const r =
      await fetch('/get-inventory')

    const d =
      await r.json()

    if (!d.success) return

    const tbody =
      document.getElementById(
        'inventory'
      )

    if (!d.items.length) {

      tbody.innerHTML = `
        <tr>
          <td colspan="3">
            Túi đồ trống
          </td>
        </tr>
      `

      return
    }

    tbody.innerHTML =
      d.items.map(item => `
        <tr>
          <td>${item.slot}</td>
          <td>${item.name}</td>
          <td>x${item.count}</td>
        </tr>
      `).join('')

  } catch {}
}

async function updateLogs() {

  try {

    const r =
      await fetch('/logs')

    const d =
      await r.json()

    if (!d.success) return

    document.getElementById(
      'logs'
    ).innerHTML =
      d.logs.map(
        x =>
          '<div class="log">' +
          x.replace(
            /</g,
            '&lt;'
          ) +
          '</div>'
      ).join('')

  } catch {}
}

checkAuth()

setInterval(
  updateStatus,
  2000
)

setInterval(
  updateInventory,
  3000
)

setInterval(
  updateLogs,
  2000
)

updateStatus()
updateInventory()
updateLogs()

</script>

</body>

</html>
`)
    }
  )

  server.listen(
    port,
    '0.0.0.0',
    () => {
      console.log(
        `[Web] Dashboard chạy tại port ${port}`
      )

      console.log(
        `[Minecraft] ${SERVER_HOST}:${SERVER_PORT}`
      )
    }
  )

  server.on(
    'error',
    err => {

      console.error(
        '[Web Server Error]',
        err
      )
    }
  )
}

// ======================================================
// START
// ======================================================

startWebServer(WEB_PORT)

createBotInstance()

// ======================================================
// PROCESS SAFETY
// ======================================================

process.on(
  'uncaughtException',
  err => {

    console.error(
      '[uncaughtException]',
      err
    )

    addLog(
      `❌ Lỗi hệ thống: ${err.message}`
    )
  }
)

process.on(
  'unhandledRejection',
  err => {

    console.error(
      '[unhandledRejection]',
      err
    )

    addLog(
      `❌ Promise lỗi: ${err?.message || err}`
    )
  }
)

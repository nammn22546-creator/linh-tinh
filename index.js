'use strict'

const http = require('http')
const mineflayer = require('mineflayer')
const url = require('url')

// ============================================================
// CONFIG
// ============================================================

const SERVER_HOST = process.env.MC_HOST || 'puffernetwork.io.vn'
const SERVER_PORT = Number(process.env.MC_PORT || 25863)

const BOT_USERNAME = process.env.BOT_USERNAME || 'hellodomcon123'

// Đặt trong Render → Environment
// Ví dụ:
// MC_LOGIN_COMMAND=/login matkhau
const LOGIN_COMMAND = process.env.MC_LOGIN_COMMAND || ''

// Không có /server eco
// Không có /tpa
const WEB_PASSWORD = process.env.WEB_PASSWORD || ''

const WEB_PORT = Number(process.env.PORT || 10000)

const MC_VERSION = process.env.MC_VERSION || '1.21.11'

// ============================================================
// STATE
// ============================================================

let botInstance = null

let botStatus = 'Đang khởi động...'
let isOnline = false
let isConnecting = false
let manualStop = false

let afkInterval = null
let reconnectTimeout = null

let startTime = Date.now()
let logs = []

const authenticatedIPs = new Set()

let currentVault = {
  title: 'Chưa mở kho nào',
  items: []
}

// ============================================================
// LOG
// ============================================================

function timeNow() {
  return new Date().toLocaleTimeString('vi-VN')
}

function addLog(message) {
  const line = `[${timeNow()}] ${message}`

  logs.unshift(line)

  if (logs.length > 50) {
    logs.length = 50
  }

  console.log(line)
}

// ============================================================
// SECURITY
// ============================================================

function getClientIP(req) {
  const forwarded = req.headers['x-forwarded-for']

  if (forwarded) {
    return forwarded.split(',')[0].trim()
  }

  return req.socket.remoteAddress || 'unknown'
}

function authenticate(req, data = {}) {
  const ip = getClientIP(req)

  if (authenticatedIPs.has(ip)) {
    return true
  }

  if (
    WEB_PASSWORD &&
    typeof data.password === 'string' &&
    data.password === WEB_PASSWORD
  ) {
    authenticatedIPs.add(ip)
    return true
  }

  return false
}

// ============================================================
// UPTIME
// ============================================================

function getUptime() {
  const seconds = Math.floor(
    (Date.now() - startTime) / 1000
  )

  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60

  return `${h} giờ ${m} phút ${s} giây`
}

// ============================================================
// INVENTORY
// ============================================================

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

// ============================================================
// TIMER
// ============================================================

function stopAllModes() {
  if (afkInterval) {
    clearInterval(afkInterval)
    afkInterval = null
  }

  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout)
    reconnectTimeout = null
  }
}

// ============================================================
// AFK
// ============================================================

function startAFK(bot) {
  if (!bot) return

  if (afkInterval) {
    clearInterval(afkInterval)
    afkInterval = null
  }

  addLog('🟢 Bắt đầu AFK.')

  afkInterval = setInterval(() => {
    if (
      !bot ||
      botInstance !== bot ||
      !isOnline ||
      !bot.entity
    ) {
      return
    }

    try {
      bot.setControlState('jump', true)

      setTimeout(() => {
        try {
          if (
            bot &&
            botInstance === bot &&
            typeof bot.setControlState === 'function'
          ) {
            bot.setControlState('jump', false)
          }
        } catch {}
      }, 200)

    } catch (error) {
      addLog(`⚠️ Lỗi AFK: ${error.message}`)
    }

  }, 5000)
}

// ============================================================
// SAFE CHAT
// ============================================================

function sendBotChat(bot, message) {
  if (!bot) return false

  if (
    typeof bot.chat !== 'function'
  ) {
    addLog('❌ bot.chat không khả dụng.')
    return false
  }

  if (!message) {
    return false
  }

  try {
    bot.chat(message)

    // Không ghi nội dung login ra log
    if (
      message.toLowerCase().startsWith('/login') ||
      message.toLowerCase().startsWith('/register') ||
      message.toLowerCase().startsWith('/changepassword') ||
      message.toLowerCase().startsWith('/passwd')
    ) {
      addLog('🔐 Đã gửi lệnh đăng nhập.')
    } else {
      addLog(`💬 Đã gửi: ${message}`)
    }

    return true

  } catch (error) {
    addLog(`❌ Không thể gửi lệnh: ${error.message}`)
    return false
  }
}

// ============================================================
// JSON
// ============================================================

function sendJSON(res, code, data) {
  res.writeHead(code, {
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

      if (body.length > 1024 * 1024) {
        reject(new Error('Request quá lớn'))
        req.destroy()
      }
    })

    req.on('end', () => {
      try {
        resolve(
          body
            ? JSON.parse(body)
            : {}
        )
      } catch {
        reject(new Error('JSON không hợp lệ'))
      }
    })

    req.on('error', reject)
  })
}

// ============================================================
// WEB SERVER
// ============================================================

function startWebServer(port) {

  const server = http.createServer(
    async (req, res) => {

      const parsed = url.parse(
        req.url,
        true
      )

      const pathname = parsed.pathname

      // ------------------------------------------------------
      // HEALTH
      // ------------------------------------------------------

      if (
        pathname === '/health' &&
        req.method === 'GET'
      ) {

        return sendJSON(res, 200, {
          success: true,
          online: isOnline,
          status: botStatus,
          uptime: getUptime()
        })
      }

      // ------------------------------------------------------
      // AUTH
      // ------------------------------------------------------

      if (
        pathname === '/check-auth' &&
        req.method === 'GET'
      ) {

        const ip = getClientIP(req)

        return sendJSON(res, 200, {
          isAuth: authenticatedIPs.has(ip)
        })
      }

      // ------------------------------------------------------
      // STATUS
      // ------------------------------------------------------

      if (
        pathname === '/status' &&
        req.method === 'GET'
      ) {

        return sendJSON(res, 200, {
          success: true,
          online: isOnline,
          status: botStatus,
          bot: BOT_USERNAME,
          server: SERVER_HOST,
          port: SERVER_PORT,
          version: MC_VERSION,
          uptime: getUptime()
        })
      }

      // ------------------------------------------------------
      // INVENTORY
      // ------------------------------------------------------

      if (
        pathname === '/get-inventory' &&
        req.method === 'GET'
      ) {

        return sendJSON(res, 200, {
          success: true,
          items: getInventoryItems(),
          vault: currentVault
        })
      }

      // ------------------------------------------------------
      // CHAT
      // ------------------------------------------------------

      if (
        pathname === '/send-chat' &&
        req.method === 'POST'
      ) {

        try {

          const data =
            await readJSON(req)

          if (!authenticate(req, data)) {
            return sendJSON(res, 401, {
              success: false,
              message: 'Sai mật khẩu Dashboard!'
            })
          }

          if (
            !isOnline ||
            !botInstance
          ) {
            return sendJSON(res, 400, {
              success: false,
              message: 'Bot chưa online!'
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

          sendBotChat(
            botInstance,
            message
          )

          return sendJSON(res, 200, {
            success: true,
            message: 'Đã gửi thành công!',
            isAuth: true
          })

        } catch (error) {

          return sendJSON(res, 400, {
            success: false,
            message: error.message
          })
        }
      }

      // ------------------------------------------------------
      // STOP
      // ------------------------------------------------------

      if (
        pathname === '/stop-bot' &&
        req.method === 'POST'
      ) {

        try {

          const data =
            await readJSON(req)

          if (!authenticate(req, data)) {
            return sendJSON(res, 401, {
              success: false,
              message: 'Sai mật khẩu Dashboard!'
            })
          }

          manualStop = true

          stopAllModes()

          const bot =
            botInstance

          botInstance = null
          isOnline = false
          isConnecting = false

          botStatus =
            'Đã dừng thủ công (Offline)'

          if (bot) {
            try {
              bot.quit(
                'Stopped from Dashboard'
              )
            } catch {}

            try {
              bot.end()
            } catch {}
          }

          addLog(
            '🛑 Bot đã được tắt từ Dashboard.'
          )

          return sendJSON(res, 200, {
            success: true,
            message: 'Đã tắt bot!',
            isAuth: true
          })

        } catch (error) {

          return sendJSON(res, 400, {
            success: false,
            message: error.message
          })
        }
      }

      // ------------------------------------------------------
      // RESTART
      // ------------------------------------------------------

      if (
        pathname === '/restart' &&
        req.method === 'POST'
      ) {

        try {

          const data =
            await readJSON(req)

          if (!authenticate(req, data)) {
            return sendJSON(res, 401, {
              success: false,
              message: 'Sai mật khẩu Dashboard!'
            })
          }

          if (isConnecting) {
            return sendJSON(res, 400, {
              success: false,
              message: 'Bot đang kết nối!'
            })
          }

          addLog(
            '🔄 Yêu cầu restart bot.'
          )

          manualStop = false

          stopAllModes()

          const oldBot =
            botInstance

          botInstance = null
          isOnline = false
          isConnecting = false

          if (oldBot) {
            try {
              oldBot.quit(
                'Restart'
              )
            } catch {}

            try {
              oldBot.end()
            } catch {}
          }

          botStatus =
            'Đang restart...'

          setTimeout(() => {
            createBotInstance()
          }, 1000)

          return sendJSON(res, 200, {
            success: true,
            message: 'Đang restart bot...'
          })

        } catch (error) {

          return sendJSON(res, 400, {
            success: false,
            message: error.message
          })
        }
      }

      // ------------------------------------------------------
      // FAVICON
      // ------------------------------------------------------

      if (
        pathname === '/favicon.ico'
      ) {
        res.writeHead(204)
        return res.end()
      }

      // ======================================================
      // DASHBOARD
      // ======================================================

      const statusColor =
        isOnline
          ? '#4ade80'
          : '#f87171'

      res.writeHead(200, {
        'Content-Type':
          'text/html; charset=utf-8',
        'Cache-Control':
          'no-store'
      })

      res.end(`<!DOCTYPE html>

<html lang="vi">

<head>

<meta charset="UTF-8">

<meta
  name="viewport"
  content="width=device-width,initial-scale=1"
>

<title>AFK Bot 2</title>

<style>

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  min-height: 100vh;

  display: flex;
  justify-content: center;
  align-items: center;

  padding: 20px;

  background: #0f172a;
  color: white;

  font-family:
    Arial,
    sans-serif;
}

.card {
  width: 100%;
  max-width: 600px;

  background: #1e293b;

  border: 1px solid #334155;
  border-radius: 18px;

  padding: 24px;

  box-shadow:
    0 20px 50px
    rgba(0,0,0,.4);
}

.title {
  text-align: center;

  font-size: 24px;
  font-weight: 800;

  color: #38bdf8;

  margin-bottom: 12px;
}

.status {
  width: fit-content;

  margin:
    0 auto 18px;

  padding:
    7px 14px;

  border-radius: 20px;

  color: ${statusColor};

  background:
    rgba(255,255,255,.05);

  font-weight: 700;
}

.grid {
  display: grid;

  grid-template-columns:
    repeat(2, 1fr);

  gap: 8px;
}

.box {
  background: #0f172a;

  padding: 12px;

  border-radius: 10px;
}

.label {
  font-size: 10px;

  color: #64748b;

  font-weight: 700;
}

.value {
  margin-top: 5px;

  font-size: 13px;

  font-weight: 700;
}

.section {
  color: #38bdf8;

  font-size: 12px;

  font-weight: 800;

  margin:
    18px 0 7px;
}

.table {
  max-height: 180px;

  overflow-y: auto;

  background: #0f172a;

  border: 1px solid #334155;

  border-radius: 10px;
}

table {
  width: 100%;

  border-collapse:
    collapse;
}

th,
td {
  padding: 9px;

  border-bottom:
    1px solid #1e293b;

  text-align: left;

  font-size: 12px;
}

th {
  color: #38bdf8;

  background: #1e293b;
}

input {
  width: 100%;

  padding: 11px;

  margin-bottom: 8px;

  border:
    1px solid #334155;

  border-radius: 9px;

  background: #0f172a;

  color: white;

  outline: none;
}

button {
  width: 100%;

  padding: 11px;

  border: none;

  border-radius: 9px;

  font-weight: 800;

  cursor: pointer;
}

.send {
  background: #38bdf8;
}

.buttons {
  display: flex;

  gap: 10px;

  margin-top: 15px;
}

.buttons button {
  flex: 1;
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
  height: 160px;

  overflow-y: auto;

  padding: 10px;

  background: #090d16;

  border-radius: 10px;

  color: #a7f3d0;

  font-family: monospace;

  font-size: 11px;
}

.log {
  margin-bottom: 5px;
}

@media(max-width:500px) {

  .grid {
    grid-template-columns: 1fr;
  }

  .buttons {
    flex-direction: column;
  }

}

</style>

</head>

<body>

<div class="card">

<div class="title">
🤖 MINECRAFT AFK BOT 2
</div>

<div class="status">
● ${botStatus}
</div>

<div class="grid">

<div class="box">
<div class="label">BOT</div>
<div class="value">${BOT_USERNAME}</div>
</div>

<div class="box">
<div class="label">SERVER</div>
<div class="value">
${SERVER_HOST}:${SERVER_PORT}
</div>
</div>

<div class="box">
<div class="label">VERSION</div>
<div class="value">${MC_VERSION}</div>
</div>

<div class="box">
<div class="label">UPTIME</div>
<div class="value">${getUptime()}</div>
</div>

</div>

<div class="section">
🎒 TÚI ĐỒ
</div>

<div class="table">

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
  placeholder="Nhập tin nhắn hoặc lệnh..."
>

<input
  id="password"
  type="password"
  placeholder="Mật khẩu Dashboard"
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

<div class="logs">

${logs.map(log =>
  `<div class="log">${String(log)
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')}</div>`
).join('')}

</div>

<div class="buttons">

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
🔄 Restart
</button>

</div>

</div>

<script>

let authenticated = false

async function checkAuth() {

  try {

    const r =
      await fetch('/check-auth')

    const d =
      await r.json()

    authenticated =
      Boolean(d.isAuth)

    if (authenticated) {

      document
        .getElementById('password')
        .style.display = 'none'
    }

  } catch {}

}

async function fetchInventory() {

  try {

    const r =
      await fetch('/get-inventory')

    const d =
      await r.json()

    if (!d.success) return

    const tbody =
      document
        .getElementById('inventory')

    if (!d.items.length) {

      tbody.innerHTML =
        '<tr><td colspan="3">Túi đồ trống</td></tr>'

      return
    }

    tbody.innerHTML =
      d.items.map(item => \`

<tr>

<td>\${item.slot}</td>

<td>\${item.name}</td>

<td>x\${item.count}</td>

</tr>

\`).join('')

  } catch {}

}

async function sendChat() {

  const message =
    document
      .getElementById('message')
      .value
      .trim()

  const password =
    document
      .getElementById('password')
      .value

  if (!message) {
    alert('Nhập tin nhắn!')
    return
  }

  if (!authenticated && !password) {
    alert('Nhập mật khẩu Dashboard!')
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

      authenticated = true

      document
        .getElementById('message')
        .value = ''

      document
        .getElementById('password')
        .style.display = 'none'
    }

  } catch {

    alert('Không kết nối được Dashboard!')
  }

}

async function stopBot() {

  if (
    !confirm(
      'Bạn chắc chắn muốn tắt Bot?'
    )
  ) return

  const password =
    document
      .getElementById('password')
      .value

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
      1000
    )

  } catch {

    alert('Không kết nối được Dashboard!')
  }

}

async function restartBot() {

  const password =
    document
      .getElementById('password')
      .value

  try {

    const r =
      await fetch('/restart', {

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
      1500
    )

  } catch {

    alert('Không kết nối được Dashboard!')
  }

}

window.addEventListener(
  'load',
  () => {

    checkAuth()

    fetchInventory()

    setInterval(
      fetchInventory,
      5000
    )

  }
)

</script>

</body>

</html>`)

    }
  )

  server.listen(
    port,
    '0.0.0.0',
    () => {

      console.log(
        `[Web] Running on port ${port}`
      )

    }
  )

  server.on(
    'error',
    error => {

      console.error(
        '[Web Error]',
        error
      )

    }
  )

  return server
}

// ============================================================
// CREATE BOT
// ============================================================

function createBotInstance() {

  if (manualStop) {
    return
  }

  if (isConnecting) {
    return
  }

  isConnecting = true

  stopAllModes()

  if (botInstance) {

    try {
      botInstance.end()
    } catch {}

    botInstance = null
  }

  isOnline = false

  botStatus =
    'Đang kết nối server Minecraft...'

  addLog(
    `Đang kết nối ${SERVER_HOST}:${SERVER_PORT}...`
  )

  let bot

  try {

    bot =
      mineflayer.createBot({

        host: SERVER_HOST,

        port: SERVER_PORT,

        username: BOT_USERNAME,

        version: MC_VERSION,

        // Cho server có thời gian handshake
        checkTimeoutInterval: 120000,

        // Không tự kick vì timeout quá ngắn
        hideErrors: false

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
  // SOCKET / LOGIN EVENT
  // ==========================================================

  bot.once(
    'login',
    () => {

      addLog(
        '🔌 TCP/Minecraft connection thành công.'
      )

    }
  )

  // ==========================================================
  // RESOURCE PACK
  // QUAN TRỌNG:
  // ACCEPT NGAY LẬP TỨC
  // ==========================================================

  bot.on(
    'resourcePack',
    (url, hash) => {

      addLog(
        '📦 Server yêu cầu Resource Pack.'
      )

      try {

        if (
          typeof bot.acceptResourcePack ===
          'function'
        ) {

          // ACCEPT NGAY.
          // KHÔNG await.
          // KHÔNG tải pack.
          bot.acceptResourcePack()

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
          `❌ Lỗi ACCEPT Resource Pack: ${error.message}`
        )

      }

    }
  )

  // ==========================================================
  // SPAWN
  //
  // Đây mới là lúc bắt đầu LOGIN.
  //
  // Resource Pack chỉ được ACCEPT ở event phía trên.
  // Không login trước spawn.
  // ==========================================================

  bot.once(
    'spawn',
    () => {

      spawned = true

      isConnecting = false
      isOnline = true

      botStatus =
        'Đang hoạt động (Online)'

      addLog(
        `✅ Bot ${BOT_USERNAME} đã SPAWN thành công.`
      )

      // ------------------------------------------------------
      // LOGIN
      // ------------------------------------------------------

      if (
        !loginSent &&
        LOGIN_COMMAND
      ) {

        loginSent = true

        addLog(
          '⏳ Đang chuẩn bị đăng nhập...'
        )

        setTimeout(
          () => {

            if (
              botInstance !== bot ||
              !isOnline
            ) {
              return
            }

            sendBotChat(
              bot,
              LOGIN_COMMAND
            )

            // ------------------------------------------------
            // SAU LOGIN → AFK
            // Không /server eco
            // Không /tpa
            // ------------------------------------------------

            setTimeout(
              () => {

                if (
                  botInstance !== bot ||
                  !isOnline
                ) {
                  return
                }

                addLog(
                  '✅ Đăng nhập xong → bắt đầu AFK.'
                )

                startAFK(bot)

              },
              2500
            )

          },
          1500
        )

      } else {

        // Không có LOGIN_COMMAND
        // thì spawn xong AFK luôn.

        if (!LOGIN_COMMAND) {

          addLog(
            'ℹ️ Không cấu hình MC_LOGIN_COMMAND → AFK trực tiếp.'
          )

        }

        setTimeout(
          () => {

            if (
              botInstance === bot &&
              isOnline
            ) {

              startAFK(bot)

            }

          },
          1000
        )
      }

    }
  )

  // ==========================================================
  // SPAWN TIMEOUT
  // ==========================================================

  setTimeout(
    () => {

      if (
        botInstance === bot &&
        isConnecting &&
        !spawned
      ) {

        addLog(
          '⚠️ Quá 45 giây nhưng Bot chưa SPAWN.'
        )

        addLog(
          '⚠️ Server có thể đang chặn bot hoặc yêu cầu handshake khác.'
        )

      }

    },
    45000
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

      stopAllModes()

      setTimeout(
        () => {

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

        },
        1000
      )

      setTimeout(
        () => {

          if (
            botInstance !== bot ||
            !isOnline
          ) {
            return
          }

          addLog(
            '🔄 Đã hồi sinh → tiếp tục AFK.'
          )

          startAFK(bot)

        },
        3500
      )

    }
  )

  // ==========================================================
  // WINDOW
  // ==========================================================

  bot.on(
    'windowOpen',
    window => {

      try {

        let title = 'Kho'

        if (window.title) {

          try {

            const parsed =
              typeof window.title === 'string'
                ? JSON.parse(window.title)
                : window.title

            if (
              parsed &&
              parsed.text
            ) {
              title = parsed.text
            } else {
              title =
                String(window.title)
            }

          } catch {

            title =
              String(window.title)
          }

        }

        const items =
          typeof window.containerItems ===
          'function'
            ? window.containerItems()
            : []

        currentVault = {

          title,

          items:
            items.map(item => ({
              name:
                item.displayName ||
                item.name,

              count:
                item.count,

              slot:
                item.slot
            }))

        }

        addLog(
          `📦 Đã mở giao diện: ${title}`
        )

      } catch (error) {

        addLog(
          `⚠️ Lỗi đọc cửa sổ: ${error.message}`
        )

      }

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

        if (!text) return

        // Không ghi password/login vào log
        const lower =
          text.toLowerCase()

        if (
          lower.includes('/login') ||
          lower.includes('/register') ||
          lower.includes('password')
        ) {

          addLog(
            '[Server]: [Thông tin đăng nhập đã ẩn]'
          )

          return
        }

        addLog(
          `[Server]: ${text}`
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

      stopAllModes()

      let reasonText

      try {

        reasonText =
          typeof reason === 'string'
            ? reason
            : JSON.stringify(reason)

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
        'Lỗi kết nối'

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

      stopAllModes()

      if (
        botInstance === bot
      ) {

        botInstance = null

      }

      if (manualStop) {

        isConnecting = false

        botStatus =
          'Đã dừng thủ công (Offline)'

        addLog(
          'Bot đã dừng thủ công.'
        )

        return
      }

      isConnecting = false

      botStatus =
        'Mất kết nối — đang thử lại...'

      let reasonText = ''

      try {

        reasonText =
          reason
            ? String(reason)
            : 'socketClosed'

      } catch {

        reasonText =
          'socketClosed'

      }

      addLog(
        `⚠️ Bot mất kết nối: ${reasonText}`
      )

      scheduleReconnect()

    }
  )
}

// ============================================================
// RECONNECT
// ============================================================

function scheduleReconnect() {

  if (manualStop) {
    return
  }

  if (reconnectTimeout) {
    return
  }

  const delay = 15000

  botStatus =
    'Offline — thử lại sau 15 giây'

  addLog(
    '⏳ Tự động kết nối lại sau 15 giây...'
  )

  reconnectTimeout =
    setTimeout(
      () => {

        reconnectTimeout = null

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

        createBotInstance()

      },
      delay
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

    addLog(
      `❌ Promise lỗi: ${String(reason)}`
    )

  }
)

process.on(
  'SIGTERM',
  () => {

    console.log(
      'SIGTERM → đóng Bot.'
    )

    manualStop = true

    stopAllModes()

    const bot =
      botInstance

    botInstance = null

    if (bot) {

      try {
        bot.quit(
          'Render shutting down'
        )
      } catch {}

      try {
        bot.end()
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

// Web trước
startWebServer(WEB_PORT)

// Bot sau
setTimeout(
  () => {

    createBotInstance()

  },
  1000
)

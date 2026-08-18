'use strict'

const http = require('http')
const mineflayer = require('mineflayer')
const url = require('url')

// ============================================================
// CONFIG
// ============================================================

const SERVER_HOST = process.env.MC_HOST || 'gemsmp.club'
const SERVER_PORT = Number(process.env.MC_PORT || 19132)

const BOT_USERNAME =
  process.env.BOT_USERNAME || 'domcon123'

const LOGIN_COMMAND =
  process.env.MC_LOGIN_COMMAND || ''

const HOME_COMMAND =
  process.env.MC_HOME_COMMAND || '/server eco'

const WEB_PASSWORD =
  process.env.WEB_PASSWORD || ''

const WEB_PORT =
  Number(process.env.PORT || 8080)

const MC_VERSION =
  process.env.MC_VERSION || '1.21.11'

// ============================================================
// STATE
// ============================================================

let botStatus = 'Đang khởi động...'
let isOnline = false
let startTime = Date.now()

let logs = []
let botInstance = null

let afkInterval = null
let reconnectTimeout = null

let isConnecting = false
let manualStop = false

let currentVault = {
  title: 'Chưa mở kho nào',
  items: []
}

const authenticatedIPs = new Set()

// ============================================================
// SECURITY / LOGGING
// ============================================================

const SENSITIVE_WORDS = [
  '/login',
  '/register',
  '/changepassword',
  '/passwd'
]

function containsSensitiveData(text) {
  if (!text) return false

  const value = String(text).toLowerCase()

  return SENSITIVE_WORDS.some(word =>
    value.includes(word.toLowerCase())
  )
}

function sanitizeLog(text) {
  if (!text) {
    return '[Thông tin bảo mật đã ẩn]'
  }

  const value = String(text)

  if (containsSensitiveData(value)) {
    return '[Thông tin bảo mật đã ẩn]'
  }

  return value
}

function addLog(message) {
  const safeMessage = sanitizeLog(message)
  const time = new Date().toLocaleTimeString('vi-VN')

  logs.unshift(
    `[${time}] ${safeMessage}`
  )

  if (logs.length > 40) {
    logs.length = 40
  }

  console.log(`[BOT] ${safeMessage}`)
}

function getClientIP(req) {
  const forwarded =
    req.headers['x-forwarded-for']

  if (forwarded) {
    return forwarded
      .split(',')[0]
      .trim()
  }

  return req.socket.remoteAddress || 'unknown'
}

function getUptime() {
  const seconds =
    Math.floor(
      (Date.now() - startTime) / 1000
    )

  const h =
    Math.floor(seconds / 3600)

  const m =
    Math.floor(
      (seconds % 3600) / 60
    )

  const s =
    seconds % 60

  return `${h} giờ ${m} phút ${s} giây`
}

// ============================================================
// HTML ESCAPE
// ============================================================

function escapeHTML(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
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

  return botInstance.inventory
    .items()
    .map(item => ({
      name:
        item.displayName ||
        item.name,

      count:
        item.count,

      slot:
        item.slot
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

  afkInterval = setInterval(() => {
    if (
      !bot ||
      !bot.entity ||
      !isOnline ||
      botInstance !== bot
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
            bot &&
            botInstance === bot &&
            typeof bot.setControlState ===
              'function'
          ) {
            bot.setControlState(
              'jump',
              false
            )
          }
        } catch {}
      }, 200)

    } catch (error) {
      addLog(
        `Lỗi AFK: ${error.message}`
      )
    }
  }, 5000)

  addLog(
    '🔄 Đã bật chế độ AFK.'
  )
}

// ============================================================
// SAFE CHAT
// ============================================================

function safeChat(bot, message) {
  if (!bot) return false

  if (
    typeof bot.chat !== 'function'
  ) {
    return false
  }

  try {
    bot.chat(message)

    if (
      containsSensitiveData(message)
    ) {
      addLog(
        '[Hệ thống]: [Đã ẩn lệnh bảo mật]'
      )
    } else {
      addLog(
        `[Hệ thống]: ${message}`
      )
    }

    return true

  } catch (error) {
    addLog(
      `Không thể gửi chat: ${error.message}`
    )

    return false
  }
}

// ============================================================
// HTTP HELPERS
// ============================================================

function sendJSON(
  res,
  statusCode,
  data
) {
  res.writeHead(
    statusCode,
    {
      'Content-Type':
        'application/json; charset=utf-8',

      'Cache-Control':
        'no-store'
    }
  )

  res.end(
    JSON.stringify(data)
  )
}

function readJSON(req) {
  return new Promise(
    (resolve, reject) => {
      let body = ''

      req.on(
        'data',
        chunk => {
          body += chunk.toString()

          if (
            body.length >
            1024 * 1024
          ) {
            reject(
              new Error(
                'Request quá lớn'
              )
            )

            req.destroy()
          }
        }
      )

      req.on(
        'end',
        () => {
          try {
            resolve(
              body
                ? JSON.parse(body)
                : {}
            )
          } catch {
            reject(
              new Error(
                'JSON không hợp lệ'
              )
            )
          }
        }
      )

      req.on(
        'error',
        reject
      )
    }
  )
}

// ============================================================
// AUTH
// ============================================================

function authenticate(req, data) {
  const clientIP =
    getClientIP(req)

  if (
    authenticatedIPs.has(clientIP)
  ) {
    return true
  }

  if (!WEB_PASSWORD) {
    return false
  }

  if (
    typeof data.password ===
      'string' &&
    data.password ===
      WEB_PASSWORD
  ) {
    authenticatedIPs.add(
      clientIP
    )

    return true
  }

  return false
}

// ============================================================
// WEB SERVER
// ============================================================

function startWebServer(port) {
  const server =
    http.createServer(
      async (req, res) => {

        const parsedUrl =
          url.parse(
            req.url,
            true
          )

        const pathname =
          parsedUrl.pathname

        // ====================================================
        // HEALTH
        // ====================================================

        if (
          pathname === '/health' &&
          req.method === 'GET'
        ) {
          return sendJSON(
            res,
            200,
            {
              success: true,
              status: 'online',
              botOnline: isOnline,
              botStatus,
              uptime: getUptime()
            }
          )
        }

        // ====================================================
        // AUTH
        // ====================================================

        if (
          pathname === '/check-auth' &&
          req.method === 'GET'
        ) {
          const clientIP =
            getClientIP(req)

          return sendJSON(
            res,
            200,
            {
              isAuth:
                authenticatedIPs.has(
                  clientIP
                )
            }
          )
        }

        // ====================================================
        // STATUS
        // ====================================================

        if (
          pathname === '/status' &&
          req.method === 'GET'
        ) {
          return sendJSON(
            res,
            200,
            {
              success: true,
              status: botStatus,
              online: isOnline,
              username:
                BOT_USERNAME,
              host:
                SERVER_HOST,
              port:
                SERVER_PORT,
              version:
                MC_VERSION,
              uptime:
                getUptime()
            }
          )
        }

        // ====================================================
        // INVENTORY
        // ====================================================

        if (
          pathname ===
            '/get-inventory' &&
          req.method === 'GET'
        ) {
          return sendJSON(
            res,
            200,
            {
              success: true,
              items:
                getInventoryItems(),

              vault:
                currentVault,

              heldItem:
                botInstance &&
                botInstance.heldItem
                  ? (
                      botInstance
                        .heldItem
                        .displayName ||
                      botInstance
                        .heldItem
                        .name
                    )
                  : 'Tay không'
            }
          )
        }

        // ====================================================
        // SEND CHAT
        // ====================================================

        if (
          pathname === '/send-chat' &&
          req.method === 'POST'
        ) {
          try {
            const data =
              await readJSON(req)

            if (
              !authenticate(
                req,
                data
              )
            ) {
              return sendJSON(
                res,
                401,
                {
                  success: false,
                  message:
                    'Sai mật khẩu xác thực!'
                }
              )
            }

            if (
              !isOnline ||
              !botInstance
            ) {
              return sendJSON(
                res,
                400,
                {
                  success: false,
                  message:
                    'Bot chưa vào game!'
                }
              )
            }

            const message =
              typeof data.message ===
                'string'
                ? data.message.trim()
                : ''

            if (!message) {
              return sendJSON(
                res,
                400,
                {
                  success: false,
                  message:
                    'Tin nhắn trống!'
                }
              )
            }

            if (
              message.length > 500
            ) {
              return sendJSON(
                res,
                400,
                {
                  success: false,
                  message:
                    'Tin nhắn quá dài!'
                }
              )
            }

            safeChat(
              botInstance,
              message
            )

            return sendJSON(
              res,
              200,
              {
                success: true,
                message:
                  'Đã gửi thành công!',
                isAuth: true
              }
            )

          } catch (error) {
            return sendJSON(
              res,
              400,
              {
                success: false,
                message:
                  error.message
              }
            )
          }
        }

        // ====================================================
        // STOP
        // ====================================================

        if (
          pathname === '/stop-bot' &&
          req.method === 'POST'
        ) {
          try {
            const data =
              await readJSON(req)

            if (
              !authenticate(
                req,
                data
              )
            ) {
              return sendJSON(
                res,
                401,
                {
                  success: false,
                  message:
                    'Sai mật khẩu xác thực!'
                }
              )
            }

            if (!botInstance) {
              return sendJSON(
                res,
                400,
                {
                  success: false,
                  message:
                    'Bot đã dừng.'
                }
              )
            }

            manualStop = true
            isConnecting = false

            stopAllModes()

            const bot =
              botInstance

            botStatus =
              'Đang dừng bot...'

            isOnline = false

            try {
              bot.quit(
                'Bot stopped from dashboard'
              )
            } catch {}

            botInstance = null

            botStatus =
              'Đã dừng thủ công (Offline)'

            addLog(
              '🛑 Bot đã được tắt từ Dashboard.'
            )

            return sendJSON(
              res,
              200,
              {
                success: true,
                message:
                  'Đã tắt bot thành công!',
                isAuth: true
              }
            )

          } catch (error) {
            return sendJSON(
              res,
              400,
              {
                success: false,
                message:
                  error.message
              }
            )
          }
        }

        // ====================================================
        // RESTART
        // ====================================================

        if (
          pathname === '/restart' &&
          req.method === 'POST'
        ) {
          try {
            const data =
              await readJSON(req)

            if (
              !authenticate(
                req,
                data
              )
            ) {
              return sendJSON(
                res,
                401,
                {
                  success: false,
                  message:
                    'Sai mật khẩu xác thực!'
                }
              )
            }

            if (isConnecting) {
              return sendJSON(
                res,
                400,
                {
                  success: false,
                  message:
                    'Bot đang kết nối, hãy chờ một chút.'
                }
              )
            }

            addLog(
              '🔄 Yêu cầu restart bot.'
            )

            manualStop = false

            stopAllModes()

            if (botInstance) {
              try {
                botInstance.end()
              } catch {}

              botInstance = null
            }

            isOnline = false

            botStatus =
              'Đang chuẩn bị restart...'

            setTimeout(
              () => {
                createBotInstance()
              },
              1500
            )

            return sendJSON(
              res,
              200,
              {
                success: true,
                message:
                  'Đang khởi động lại bot...'
              }
            )

          } catch (error) {
            return sendJSON(
              res,
              400,
              {
                success: false,
                message:
                  error.message
              }
            )
          }
        }

        // ====================================================
        // FAVICON
        // ====================================================

        if (
          pathname ===
          '/favicon.ico'
        ) {
          res.writeHead(204)
          return res.end()
        }

        // ====================================================
        // DASHBOARD
        // ====================================================

        const safeStatus =
          escapeHTML(
            botStatus
          )

        const safeUsername =
          escapeHTML(
            BOT_USERNAME
          )

        const safeHost =
          escapeHTML(
            SERVER_HOST
          )

        const safeVersion =
          escapeHTML(
            MC_VERSION
          )

        const onlineColor =
          isOnline
            ? '#4ade80'
            : '#f87171'

        const onlineBackground =
          isOnline
            ? 'rgba(34,197,94,.1)'
            : 'rgba(239,68,68,.1)'

        const renderedLogs =
          logs
            .map(log => {
              return (
                '<div class="log">' +
                escapeHTML(log) +
                '</div>'
              )
            })
            .join('')

        res.writeHead(
          200,
          {
            'Content-Type':
              'text/html; charset=utf-8',

            'Cache-Control':
              'no-store'
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

<title>AFK Bot Dashboard</title>

<style>

* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  background: #0f172a;
  color: #f8fafc;
  font-family: Arial, Helvetica, sans-serif;

  min-height: 100vh;

  display: flex;
  justify-content: center;
  align-items: center;

  padding: 20px;
}

.card {
  width: 100%;
  max-width: 620px;

  background: #1e293b;

  border: 1px solid #334155;
  border-radius: 18px;

  padding: 24px;

  box-shadow:
    0 20px 40px rgba(0,0,0,.35);
}

.title {
  text-align: center;

  color: #38bdf8;

  font-size: 24px;
  font-weight: 800;

  margin-bottom: 14px;
}

.badge {
  display: block;

  width: fit-content;

  margin: 0 auto 18px;

  padding: 7px 14px;

  border-radius: 20px;

  font-size: 13px;
  font-weight: 700;

  color: ${onlineColor};
  background: ${onlineBackground};
}

.info-grid {
  display: grid;

  grid-template-columns:
    repeat(2, 1fr);

  gap: 8px;
}

.info {
  background: #0f172a;

  border-radius: 10px;

  padding: 12px;
}

.label {
  color: #64748b;

  font-size: 10px;
  font-weight: 700;

  text-transform: uppercase;
}

.value {
  margin-top: 5px;

  color: #e2e8f0;

  font-size: 13px;
  font-weight: 700;

  word-break: break-word;
}

.section {
  color: #38bdf8;

  font-size: 12px;
  font-weight: 800;

  margin: 18px 0 7px;
}

.table-wrap {
  max-height: 180px;

  overflow-y: auto;

  background: #0f172a;

  border: 1px solid #334155;

  border-radius: 10px;
}

table {
  width: 100%;

  border-collapse: collapse;

  font-size: 12px;
}

th,
td {
  padding: 9px 10px;

  text-align: left;

  border-bottom: 1px solid #1e293b;
}

th {
  position: sticky;
  top: 0;

  background: #1e293b;

  color: #38bdf8;
}

td {
  color: #cbd5e1;
}

.empty {
  padding: 18px;

  text-align: center;

  color: #64748b;
}

input {
  width: 100%;

  padding: 11px;

  margin-bottom: 8px;

  background: #0f172a;

  color: white;

  border: 1px solid #334155;

  border-radius: 9px;

  outline: none;
}

input:focus {
  border-color: #38bdf8;
}

button {
  width: 100%;

  padding: 11px;

  border: 0;

  border-radius: 9px;

  font-weight: 800;

  cursor: pointer;
}

.send {
  background: #38bdf8;
  color: #082f49;
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
  height: 170px;

  overflow-y: auto;

  padding: 10px;

  background: #090d16;

  border: 1px solid #1e293b;

  border-radius: 10px;

  color: #a7f3d0;

  font-family: monospace;

  font-size: 11px;
}

.log {
  margin-bottom: 5px;

  word-break: break-word;
}

.footer {
  margin-top: 14px;

  color: #64748b;

  text-align: center;

  font-size: 10px;
}

@media (max-width: 500px) {

  .info-grid {
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
    🤖 AFK Bot Dashboard
  </div>

  <div class="badge">
    ● ${safeStatus}
  </div>

  <div class="info-grid">

    <div class="info">

      <div class="label">
        Bot
      </div>

      <div class="value">
        ${safeUsername}
      </div>

    </div>

    <div class="info">

      <div class="label">
        Server
      </div>

      <div class="value">
        ${safeHost}:${SERVER_PORT}
      </div>

    </div>

    <div class="info">

      <div class="label">
        Phiên bản
      </div>

      <div class="value">
        ${safeVersion}
      </div>

    </div>

    <div class="info">

      <div class="label">
        Uptime
      </div>

      <div class="value">
        ${getUptime()}
      </div>

    </div>

  </div>

  <div class="section">
    🎒 TÚI ĐỒ
  </div>

  <div class="table-wrap">

    <table>

      <thead>

        <tr>
          <th>Slot</th>
          <th>Vật phẩm</th>
          <th>Số lượng</th>
        </tr>

      </thead>

      <tbody id="invBody">

        <tr>
          <td
            colspan="3"
            class="empty"
          >
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
    id="chatMsg"
    type="text"
    placeholder="Nhập tin nhắn hoặc lệnh..."
    autocomplete="off"
  >

  <input
    id="chatPwd"
    type="password"
    placeholder="Mật khẩu Dashboard"
    autocomplete="off"
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
    ${renderedLogs}
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

  <div class="footer">
    AFK Bot • Render
  </div>

</div>

<script>

let authenticated = false

async function checkAuth() {

  try {

    const response =
      await fetch('/check-auth')

    const data =
      await response.json()

    authenticated =
      Boolean(data.isAuth)

    if (authenticated) {

      const passwordInput =
        document.getElementById(
          'chatPwd'
        )

      if (passwordInput) {
        passwordInput.style.display =
          'none'
      }

    }

  } catch {}

}

async function fetchInventory() {

  try {

    const response =
      await fetch(
        '/get-inventory',
        {
          cache: 'no-store'
        }
      )

    const data =
      await response.json()

    if (!data.success) {
      return
    }

    const tbody =
      document.getElementById(
        'invBody'
      )

    if (!data.items.length) {

      tbody.innerHTML =
        '<tr>' +
        '<td colspan="3" class="empty">' +
        'Túi đồ trống' +
        '</td>' +
        '</tr>'

      return
    }

    tbody.innerHTML =
      data.items
        .map(item => {

          const name =
            String(
              item.name
            )
              .replace(
                /&/g,
                '&amp;'
              )
              .replace(
                /</g,
                '&lt;'
              )
              .replace(
                />/g,
                '&gt;'
              )

          return (
            '<tr>' +
              '<td>' +
                String(item.slot) +
              '</td>' +

              '<td>' +
                name +
              '</td>' +

              '<td>' +
                'x' +
                String(item.count) +
              '</td>' +

            '</tr>'
          )

        })
        .join('')

  } catch {}

}

async function sendChat() {

  const message =
    document
      .getElementById(
        'chatMsg'
      )
      .value
      .trim()

  const password =
    document
      .getElementById(
        'chatPwd'
      )
      .value

  if (!message) {

    alert(
      'Vui lòng nhập tin nhắn!'
    )

    return
  }

  if (
    !authenticated &&
    !password
  ) {

    alert(
      'Vui lòng nhập mật khẩu Dashboard!'
    )

    return
  }

  try {

    const response =
      await fetch(
        '/send-chat',
        {
          method: 'POST',

          headers: {
            'Content-Type':
              'application/json'
          },

          body:
            JSON.stringify({
              message,
              password
            })
        }
      )

    const data =
      await response.json()

    alert(data.message)

    if (data.success) {

      authenticated = true

      document
        .getElementById(
          'chatMsg'
        )
        .value = ''

      document
        .getElementById(
          'chatPwd'
        )
        .style.display =
          'none'
    }

  } catch {

    alert(
      'Không thể kết nối Dashboard.'
    )

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
    document
      .getElementById(
        'chatPwd'
      )
      .value

  try {

    const response =
      await fetch(
        '/stop-bot',
        {
          method: 'POST',

          headers: {
            'Content-Type':
              'application/json'
          },

          body:
            JSON.stringify({
              password
            })
        }
      )

    const data =
      await response.json()

    alert(data.message)

    setTimeout(
      () => {
        location.reload()
      },
      1000
    )

  } catch {

    alert(
      'Không thể kết nối Dashboard.'
    )

  }

}

async function restartBot() {

  try {

    const response =
      await fetch(
        '/restart',
        {
          method: 'POST',

          headers: {
            'Content-Type':
              'application/json'
          },

          body:
            JSON.stringify({})
        }
      )

    const data =
      await response.json()

    alert(data.message)

    setTimeout(
      () => {
        location.reload()
      },
      1500
    )

  } catch {

    alert(
      'Không thể kết nối Dashboard.'
    )

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

</html>
`)
      }
    )

  server.listen(
    port,
    '0.0.0.0',
    () => {

      console.log(
        `[Web Server] Đã mở port ${port}`
      )

      console.log(
        `[Web Server] Dashboard: http://0.0.0.0:${port}`
      )

    }
  )

  server.on(
    'error',
    error => {

      console.error(
        '[Web Server Error]',
        error
      )

    }
  )

  return server
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
// CREATE BOT
// ============================================================

function createBotInstance() {

  if (isConnecting) {

    addLog(
      'Đã có một kết nối đang chạy.'
    )

    return
  }

  manualStop = false
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

        host:
          SERVER_HOST,

        port:
          SERVER_PORT,

        username:
          BOT_USERNAME,

        version:
          MC_VERSION,

        checkTimeoutInterval:
          120000

      })

  } catch (error) {

    isConnecting = false

    botStatus =
      'Lỗi tạo kết nối'

    addLog(
      `Lỗi createBot: ${error.message}`
    )

    scheduleReconnect()

    return
  }

  botInstance = bot

  let loginStarted = false

  // ==========================================================
  // LOGIN
  // ==========================================================

  bot.once(
    'login',
    () => {

      addLog(
        'Minecraft handshake thành công. Bot đang đăng nhập...'
      )

    }
  )

  // ==========================================================
  // RESOURCE PACK
  // ==========================================================

  bot.on(
    'resourcePack',
    () => {

      addLog(
        'Server yêu cầu Resource Pack.'
      )

      try {

        if (
          typeof bot.acceptResourcePack ===
          'function'
        ) {

          bot.acceptResourcePack()

          addLog(
            '✅ Đã chấp nhận Resource Pack.'
          )

        }

      } catch (error) {

        addLog(
          `Lỗi Resource Pack: ${error.message}`
        )

      }

    }
  )

  // ==========================================================
  // SPAWN
  // ==========================================================

  bot.once(
    'spawn',
    () => {

      isConnecting = false
      isOnline = true

      botStatus =
        'Đang hoạt động (Online)'

      addLog(
        `✅ Bot ${BOT_USERNAME} đã vào server!`
      )

      if (loginStarted) {

        startAFK(bot)

        return
      }

      loginStarted = true

      // ------------------------------------------------------
      // LOGIN
      // ------------------------------------------------------

      if (LOGIN_COMMAND) {

        setTimeout(
          () => {

            if (
              botInstance !== bot ||
              !isOnline
            ) {
              return
            }

            safeChat(
              bot,
              LOGIN_COMMAND
            )

          },
          3000
        )

      }

      // ------------------------------------------------------
      // HOME / SERVER
      // ------------------------------------------------------

      setTimeout(
        () => {

          if (
            botInstance !== bot ||
            !isOnline
          ) {
            return
          }

          safeChat(
            bot,
            HOME_COMMAND
          )

          setTimeout(
            () => {

              if (
                botInstance === bot &&
                isOnline
              ) {
                startAFK(bot)
              }

            },
            1500
          )

        },
        LOGIN_COMMAND
          ? 6000
          : 3000
      )

    }
  )

  // ==========================================================
  // DEATH
  // ==========================================================

  bot.on(
    'death',
    () => {

      addLog(
        '⚠️ Bot đã chết.'
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

          setTimeout(
            () => {

              if (
                botInstance !== bot ||
                !isOnline
              ) {
                return
              }

              safeChat(
                bot,
                HOME_COMMAND
              )

              startAFK(bot)

            },
            3000
          )

        },
        1000
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

          if (
            typeof window.title ===
            'string'
          ) {

            try {

              const parsed =
                JSON.parse(
                  window.title
                )

              if (
                parsed &&
                parsed.text
              ) {
                title =
                  parsed.text
              }

            } catch {

              title =
                String(
                  window.title
                )

            }

          } else {

            title =
              String(
                window.title
              )

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
          `Lỗi đọc cửa sổ: ${error.message}`
        )

      }

    }
  )

  // ==========================================================
  // MESSAGE
  // ==========================================================

  bot.on(
    'message',
    message => {

      try {

        const text =
          message
            .toString()
            .trim()

        if (!text) {
          return
        }

        if (
          containsSensitiveData(text)
        ) {

          addLog(
            '[Server]: [Thông tin bảo mật đã ẩn]'
          )

        } else {

          addLog(
            `[Server]: ${text}`
          )

        }

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

      let reasonText = ''

      try {

        reasonText =
          typeof reason ===
          'string'
            ? reason
            : JSON.stringify(
                reason
              )

      } catch {

        reasonText =
          String(reason)

      }

      botStatus =
        'Bị đá khỏi server (Offline)'

      addLog(
        `⚠️ Bot bị kick: ${sanitizeLog(reasonText)}`
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

      if (reason) {

        addLog(
          `Bot mất kết nối: ${sanitizeLog(reason)}`
        )

      } else {

        addLog(
          'Bot đã mất kết nối.'
        )

      }

      scheduleReconnect()

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
      `Lỗi hệ thống: ${error.message}`
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
      `Promise lỗi: ${String(reason)}`
    )

  }
)

process.on(
  'SIGTERM',
  () => {

    console.log(
      'Nhận SIGTERM — đang đóng bot...'
    )

    manualStop = true

    stopAllModes()

    if (botInstance) {

      try {

        botInstance.quit(
          'Render shutting down'
        )

      } catch {}

    }

    setTimeout(
      () => {
        process.exit(0)
      },
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
  '          MINECRAFT AFK BOT'
)

console.log(
  '=========================================='
)

console.log(
  `Minecraft: ${SERVER_HOST}:${SERVER_PORT}`
)

console.log(
  `Version: ${MC_VERSION}`
)

console.log(
  `Username: ${BOT_USERNAME}`
)

console.log(
  `Render PORT: ${WEB_PORT}`
)

console.log(
  '=========================================='
)

// Web server phải chạy trước
// để Render nhận diện HTTP service.

startWebServer(
  WEB_PORT
)

// Khởi động Minecraft sau 1 giây.

setTimeout(
  () => {

    createBotInstance()

  },
  1000
)

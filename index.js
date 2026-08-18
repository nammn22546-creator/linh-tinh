const http = require('http')
const mineflayer = require('mineflayer')
const url = require('url')

const SERVER_HOST = 'puffernetwork.io.vn'
const SERVER_PORT = 25863
const BOT_USERNAME = 'hellodomcon123'
const LOGIN_COMMAND = '/login domcon1234'
const HOME_COMMAND = '/tpa domcon123'
const WEB_PASSWORD = 'condombebong123'

const SENSITIVE_WORDS = [
  'domcon1234', 
  'condombebong123', 
  '/login', 
  '/register', 
  '/changepassword',
  '/passwd'
]

let botStatus = 'Đang khởi động...'
let isOnline = false
let startTime = Date.now()
let logs = []
let botInstance = null

// Biến quản lý Auto-Reconnect
let reconnectTimer = null
let autoReconnectEnabled = true 

let currentVault = {
  title: 'Chưa mở kho nào',
  items: []
}

const authenticatedIPs = new Set()

function getClientIP(req) {
  return req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress
}

function containsSensitiveData(text) {
  if (!text) return false
  return SENSITIVE_WORDS.some(word => text.toLowerCase().includes(word.toLowerCase()))
}

function addLog(msg) {
  if (containsSensitiveData(msg)) return
  const time = new Date().toLocaleTimeString('vi-VN')
  logs.unshift(`[${time}] ${msg}`)
  if (logs.length > 20) logs.pop()
}

function getUptime() {
  const seconds = Math.floor((Date.now() - startTime) / 1000)
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  return `${h} giờ ${m} phút ${s} giây`
}

function getInventoryItems() {
  if (!botInstance || !isOnline || !botInstance.inventory) return []
  return botInstance.inventory.items().map(item => ({
    name: item.displayName || item.name,
    count: item.count,
    slot: item.slot
  }))
}

function startWebServer(port) {
  const server = http.createServer((req, res) => {
    const parsedUrl = url.parse(req.url, true)
    const clientIP = getClientIP(req)

    if (parsedUrl.pathname === '/check-auth' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify({ isAuth: authenticatedIPs.has(clientIP) }))
    }

    if (parsedUrl.pathname === '/send-chat' && req.method === 'POST') {
      let body = ''
      req.on('data', chunk => { body += chunk.toString() })
      req.on('end', () => {
        try {
          const data = JSON.parse(body)

          if (!authenticatedIPs.has(clientIP)) {
            if (data.password !== WEB_PASSWORD) {
              res.writeHead(401, { 'Content-Type': 'application/json' })
              return res.end(JSON.stringify({ success: false, message: 'Sai mật khẩu xác thực!' }))
            }
            authenticatedIPs.add(clientIP)
          }

          if (!isOnline || !botInstance) {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            return res.end(JSON.stringify({ success: false, message: 'Bot chưa vào game!' }))
          }

          if (data.message) {
            botInstance.chat(data.message)
            if (!containsSensitiveData(data.message)) {
              addLog(`[Lệnh Web]: ${data.message}`)
            } else {
              addLog(`[Lệnh Web]: [Đã ẩn tin nhắn bảo mật]`)
            }
            
            res.writeHead(200, { 'Content-Type': 'application/json' })
            return res.end(JSON.stringify({ success: true, message: 'Đã gửi thành công!', isAuth: true }))
          }
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          return res.end(JSON.stringify({ success: false, message: 'Lỗi dữ liệu gửi lên!' }))
        }
      })
      return
    }

    if (parsedUrl.pathname === '/stop-bot' && req.method === 'POST') {
      let body = ''
      req.on('data', chunk => { body += chunk.toString() })
      req.on('end', () => {
        try {
          const data = JSON.parse(body)

          if (!authenticatedIPs.has(clientIP)) {
            if (data.password !== WEB_PASSWORD) {
              res.writeHead(401, { 'Content-Type': 'application/json' })
              return res.end(JSON.stringify({ success: false, message: 'Sai mật khẩu xác thực!' }))
            }
            authenticatedIPs.add(clientIP)
          }

          autoReconnectEnabled = false 
          if (reconnectTimer) clearTimeout(reconnectTimer)

          if (botInstance) {
            botInstance.quit('Được tắt bởi Admin qua Web Dashboard')
          }
          
          botStatus = 'Đã dừng thủ công (Offline)'
          isOnline = false
          
          res.writeHead(200, { 'Content-Type': 'application/json' })
          return res.end(JSON.stringify({ success: true, message: 'Đã tắt bot thành công!', isAuth: true }))
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          return res.end(JSON.stringify({ success: false, message: 'Lỗi dữ liệu!' }))
        }
      })
      return
    }

    if (parsedUrl.pathname === '/restart' && req.method === 'POST') {
      if (!isOnline) {
        autoReconnectEnabled = true 
        if (reconnectTimer) clearTimeout(reconnectTimer)
        addLog('Yêu cầu khởi động lại bot từ Web Dashboard...')
        if (botInstance) botInstance.end()
        createBotInstance()
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: true, message: 'Đang khởi động lại...' }))
      } else {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: false, message: 'Bot đang online, không thể restart!' }))
      }
      return
    }

    const inventoryItems = getInventoryItems()

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.write(`
      <!DOCTYPE html>
      <html lang="vi">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Minecraft AFK Bot Dashboard</title>
        <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700&display=swap" rel="stylesheet">
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; font-family: 'Plus Jakarta Sans', sans-serif; }
          body {
            background: #0f172a;
            color: #f8fafc;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            padding: 20px;
          }
          .card {
            background: #1e293b;
            border: 1px solid #334155;
            border-radius: 16px;
            padding: 24px;
            width: 100%;
            max-width: 520px;
            box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5);
            text-align: center;
            position: relative;
          }
          .header-ctrl {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 12px;
          }
          .title { font-size: 20px; font-weight: 700; color: #38bdf8; }
          .btn-auto-refresh {
            padding: 4px 10px;
            border-radius: 6px;
            font-size: 11px;
            font-weight: 600;
            border: 1px solid #334155;
            cursor: pointer;
            background: #0f172a;
            color: #38bdf8;
          }
          .btn-auto-refresh.paused {
            color: #f87171;
            border-color: #ef4444;
          }
          .badge {
            display: inline-block;
            padding: 6px 14px;
            border-radius: 20px;
            font-size: 13px;
            font-weight: 600;
            margin-bottom: 16px;
            background: ${isOnline ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)'};
            color: ${isOnline ? '#4ade80' : '#f87171'};
            border: 1px solid ${isOnline ? 'rgba(34, 197, 94, 0.2)' : 'rgba(239, 68, 68, 0.2)'};
          }
          .info-group { background: #0f172a; border-radius: 10px; padding: 10px 14px; margin-bottom: 8px; text-align: left; }
          .label { font-size: 11px; color: #94a3b8; font-weight: 600; text-transform: uppercase; }
          .value { font-size: 14px; font-weight: 600; color: #f1f5f9; margin-top: 2px; }

          .section-title { font-size: 12px; color: #38bdf8; font-weight: 700; text-align: left; margin: 16px 0 6px 0; text-transform: uppercase; }
          
          .inv-table-container {
            max-height: 120px;
            overflow-y: auto;
            border: 1px solid #334155;
            border-radius: 8px;
            background: #0f172a;
          }
          table { width: 100%; border-collapse: collapse; text-align: left; font-size: 12px; }
          th, td { padding: 8px 12px; border-bottom: 1px solid #1e293b; }
          th { background: #1e293b; color: #38bdf8; font-weight: 600; position: sticky; top: 0; }
          td { color: #cbd5e1; }
          .empty-inv { text-align: center; padding: 12px; color: #64748b; font-style: italic; }

          .chat-box-container { margin-top: 14px; text-align: left; }
          .input-field {
            width: 100%;
            padding: 10px;
            margin-top: 6px;
            border-radius: 8px;
            border: 1px solid #334155;
            background: #0f172a;
            color: #fff;
            font-size: 13px;
          }
          .btn-send {
            width: 100%;
            padding: 10px;
            margin-top: 8px;
            border-radius: 8px;
            border: none;
            background: #38bdf8;
            color: #0f172a;
            font-weight: 700;
            cursor: pointer;
          }
          .btn-send:hover { background: #0284c7; color: #fff; }

          .log-box {
            background: #090d16;
            border: 1px solid #1e293b;
            border-radius: 10px;
            padding: 10px;
            height: 100px;
            overflow-y: auto;
            text-align: left;
            font-family: monospace;
            font-size: 11px;
            color: #a7f3d0;
          }
          .log-item { margin-bottom: 4px; word-break: break-all; }
          
          .action-btn-group { display: flex; gap: 10px; margin-top: 14px; }
          .btn-action {
            flex: 1;
            padding: 10px;
            border-radius: 10px;
            border: none;
            font-weight: 700;
            font-size: 13px;
            cursor: pointer;
          }
          .btn-stop { background: #ef4444; color: #ffffff; }
          .btn-stop:disabled { background: #334155; color: #64748b; cursor: not-allowed; }
          
          .btn-restart { background: #22c55e; color: #ffffff; }
          .btn-restart:disabled { background: #334155; color: #64748b; cursor: not-allowed; }
        </style>
        <script>
          let isIPAuthenticated = false;
          let autoRefreshEnabled = true;
          let refreshTimer = null;

          function startAutoReload() {
            if (refreshTimer) clearInterval(refreshTimer);
            refreshTimer = setInterval(() => {
              if (autoRefreshEnabled) {
                location.reload(); // Làm mới (F5) toàn bộ trang
              }
            }, 3000); // 3 giây F5 1 lần
          }

          window.onload = function() {
            fetch('/check-auth')
              .then(res => res.json())
              .then(data => {
                isIPAuthenticated = data.isAuth;
                if (isIPAuthenticated) {
                  document.getElementById('chatPwd').style.display = 'none';
                }
              });

            // Tạm dừng F5 khi người dùng đang bấm vào ô nhập dữ liệu
            const inputs = document.querySelectorAll('.input-field');
            inputs.forEach(input => {
              input.addEventListener('focus', () => { 
                autoRefreshEnabled = false; 
                document.getElementById('btnRefreshToggle').innerText = '⏸️ Đang gõ (Tạm dừng F5)';
                document.getElementById('btnRefreshToggle').classList.add('paused');
              });
              input.addEventListener('blur', () => { 
                autoRefreshEnabled = true; 
                document.getElementById('btnRefreshToggle').innerText = '⚡ Tự F5: Bật (3s)';
                document.getElementById('btnRefreshToggle').classList.remove('paused');
              });
            });

            startAutoReload();
          }

          function toggleAutoRefresh() {
            autoRefreshEnabled = !autoRefreshEnabled;
            const btn = document.getElementById('btnRefreshToggle');
            if (autoRefreshEnabled) {
              btn.innerText = '⚡ Tự F5: Bật (3s)';
              btn.classList.remove('paused');
            } else {
              btn.innerText = '⏸️ Tự F5: Đã tắt';
              btn.classList.add('paused');
            }
          }

          function sendChatMessage() {
            const msg = document.getElementById('chatMsg').value;
            const pwd = document.getElementById('chatPwd').value;
            
            if (!msg) return alert('Vui lòng nhập nội dung!');
            if (!isIPAuthenticated && !pwd) return alert('Vui lòng nhập mật khẩu xác thực!');

            fetch('/send-chat', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ message: msg, password: pwd })
            })
            .then(res => res.json())
            .then(data => {
              alert(data.message);
              if (data.success) {
                location.reload();
              }
            });
          }

          function stopBot() {
            const pwd = document.getElementById('chatPwd').value;
            if (!isIPAuthenticated && !pwd) return alert('Vui lòng nhập mật khẩu xác thực để tắt bot!');

            if (!confirm('Bạn có chắc chắn muốn ngắt kết nối Bot khỏi Server?')) return;

            fetch('/stop-bot', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ password: pwd })
            })
            .then(res => res.json())
            .then(data => {
              alert(data.message);
              if (data.success) {
                location.reload();
              }
            });
          }

          function restartBot() {
            fetch('/restart', { method: 'POST' })
              .then(res => res.json())
              .then(data => {
                alert(data.message);
                location.reload();
              });
          }
        </script>
      </head>
      <body>
        <div class="card">
          <div class="header-ctrl">
            <div class="title">🤖 AFK Bot Dashboard</div>
            <button id="btnRefreshToggle" class="btn-auto-refresh" onclick="toggleAutoRefresh()">⚡ Tự F5: Bật (3s)</button>
          </div>
          
          <div class="badge">● ${botStatus}</div>
          
          <div class="info-group">
            <div class="label">Tên Bot / Server</div>
            <div class="value">${BOT_USERNAME} (${SERVER_HOST})</div>
          </div>
          <div class="info-group">
            <div class="label">Thời gian hoạt động</div>
            <div class="value">${getUptime()}</div>
          </div>

          <div class="section-title">🎒 Túi Đồ Nhân Vật</div>
          <div class="inv-table-container">
            <table>
              <thead>
                <tr>
                  <th style="width: 15%;">Slot</th>
                  <th>Vật phẩm</th>
                  <th style="width: 20%;">Số lượng</th>
                </tr>
              </thead>
              <tbody>
                ${inventoryItems.length === 0 
                  ? '<tr><td colspan="3" class="empty-inv">Túi đồ trống...</td></tr>'
                  : inventoryItems.map(i => `
                    <tr>
                      <td>${i.slot}</td>
                      <td style="font-weight: 600; color: #f8fafc;">${i.name}</td>
                      <td style="color: #4ade80;">x${i.count}</td>
                    </tr>
                  `).join('')
                }
              </tbody>
            </table>
          </div>

          <div class="section-title">📦 Kho Vault: ${currentVault.title}</div>
          <div class="inv-table-container">
            <table>
              <thead>
                <tr>
                  <th style="width: 15%;">Slot</th>
                  <th>Vật phẩm trong Vault</th>
                  <th style="width: 20%;">Số lượng</th>
                </tr>
              </thead>
              <tbody>
                ${!currentVault.items || currentVault.items.length === 0 
                  ? '<tr><td colspan="3" class="empty-inv">Kho trống hoặc chưa gõ lệnh /pv</td></tr>'
                  : currentVault.items.map(i => `
                    <tr>
                      <td>${i.slot}</td>
                      <td style="font-weight: 600; color: #f8fafc;">${i.name}</td>
                      <td style="color: #38bdf8;">x${i.count}</td>
                    </tr>
                  `).join('')
                }
              </tbody>
            </table>
          </div>

          <div class="chat-box-container">
            <div class="section-title" style="margin-top:0;">🚀 Gửi lệnh / Chat</div>
            <input type="text" id="chatMsg" class="input-field" placeholder="Nhập tin nhắn/lệnh (/pv 1, /home...)">
            <input type="password" id="chatPwd" class="input-field" placeholder="Nhập mật khẩu xác thực (chỉ nhập 1 lần)">
            <button class="btn-send" onclick="sendChatMessage()">Gửi vào Server</button>
          </div>

          <div class="section-title">📜 Nhật ký hoạt động</div>
          <div class="log-box">
            ${logs.map(log => `<div class="log-item">${log}</div>`).join('')}
          </div>

          <div class="action-btn-group">
            <button id="btnStop" class="btn-action btn-stop" onclick="stopBot()" ${isOnline ? '' : 'disabled'}>
              🛑 Tắt Bot
            </button>
            <button id="btnRestart" class="btn-action btn-restart" onclick="restartBot()" ${isOnline ? 'disabled' : ''}>
              🔄 Bật lại Bot
            </button>
          </div>
        </div>
      </body>
      </html>
    `)
    res.end()
  })

  server.listen(port, '0.0.0.0', () => {
    console.log(`[Web Server] Đã mở port ${port}`)
  }).on('error', (err) => {
    if (err.code === 'EADDRINUSE') server.listen(0, '0.0.0.0')
  })
}

startWebServer(process.env.PORT || 8080)

// Hàm xử lý Reconnect
function handleReconnect() {
  if (!autoReconnectEnabled) return
  if (reconnectTimer) clearTimeout(reconnectTimer)

  botStatus = 'Đang đếm ngược kết nối lại (10s)...'
  addLog('🔄 Mất kết nối! Sẽ tự động kết nối lại sau 10 giây...')

  reconnectTimer = setTimeout(() => {
    if (autoReconnectEnabled) {
      if (botInstance) botInstance.removeAllListeners()
      createBotInstance()
    }
  }, 10000)
}

function createBotInstance() {
  botStatus = 'Đang kết nối server...'
  isOnline = false
  addLog('Đang kết nối đến server Minecraft...')

  const bot = mineflayer.createBot({
    host: SERVER_HOST,
    port: SERVER_PORT,
    username: BOT_USERNAME,
    version: '1.21.11',
    checkTimeoutInterval: 120000,
  })

  botInstance = bot
  let loginFlowStarted = false

  function safeChat(msg) {
    if (typeof bot.chat === 'function') {
      bot.chat(msg)
      if (!containsSensitiveData(msg)) {
        addLog(`[Hệ thống]: ${msg}`)
      } else {
        addLog(`[Hệ thống]: [Đã ẩn thông tin bảo mật]`)
      }
    }
  }

  bot.on('windowOpen', (window) => {
    const title = window.title ? JSON.parse(window.title).text || window.title : 'Vault'
    addLog(`Đã mở giao diện kho: ${title}`)
    
    const vaultItems = window.containerItems().map(item => ({
      name: item.displayName || item.name,
      count: item.count,
      slot: item.slot
    }))

    currentVault = {
      title: title,
      items: vaultItems
    }
  })

  bot.on('windowClose', () => {
    addLog('Đã đóng giao diện kho Vault')
  })

  bot._client.on('packet', (data, metadata) => {
    if (metadata.name === 'resource_pack_send' || metadata.name === 'add_resource_pack') {
      const packUuid = data.uuid || data.id
      bot._client.write('resource_pack_receive', { uuid: packUuid, result: 3 })

      setTimeout(() => {
        if (bot._client) {
          bot._client.write('resource_pack_receive', { uuid: packUuid, result: 0 })
          addLog('Đã bỏ qua Resource Pack')
        }
      }, 200)
    }
  })

  bot.on('spawn', () => {
    botStatus = 'Đang hoạt động (Online)'
    isOnline = true
    addLog(`Bot ${BOT_USERNAME} vào server thành công!`)

    if (loginFlowStarted) return
    loginFlowStarted = true

    setTimeout(() => {
      safeChat(LOGIN_COMMAND)

      setTimeout(() => {
        safeChat(HOME_COMMAND)
        addLog(`Đã gửi yêu cầu dịch chuyển ${HOME_COMMAND}`)
      }, 2000)
    }, 3000)

    setInterval(() => {
      if (!bot.entity) return
      bot.setControlState('jump', true)
      setTimeout(() => bot.setControlState('jump', false), 400)
    }, 8000)
  })

  bot.on('death', () => {
    addLog('⚠️ Bot đã bị chết! Đang thực hiện tự động hồi sinh...')
    bot.respawn()
    setTimeout(() => {
      safeChat(HOME_COMMAND)
      addLog(`Đã gửi lại yêu cầu ${HOME_COMMAND} sau khi hồi sinh`)
    }, 2000)
  })

  bot.on('message', (message) => {
    const text = message.toString().trim()
    if (text) {
      if (!containsSensitiveData(text)) {
        console.log(`[Server] ${text}`)
        addLog(`[Server]: ${text}`)
      } else {
        addLog(`[Server]: [Thông tin hệ thống đã được bảo mật]`)
      }
    }
  })

  bot.on('kicked', (reason) => {
    isOnline = false
    addLog(`Mất kết nối: Bot bị đá! Lý do: ${reason}`)
    handleReconnect()
  })

  bot.on('error', (error) => {
    isOnline = false
    addLog(`Lỗi kết nối: ${error.message}`)
    handleReconnect()
  })

  bot.on('end', () => {
    isOnline = false
    addLog('Bot đã thoát khỏi server.')
    handleReconnect()
  })
}

createBotInstance()

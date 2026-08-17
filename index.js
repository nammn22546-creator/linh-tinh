const http = require('http')
const mineflayer = require('mineflayer')
const url = require('url')

const SERVER_HOST = 'puffernetwork.io.vn'
const SERVER_PORT = 25863
const BOT_USERNAME = 'hellodomcon123'
const LOGIN_COMMAND = '/login domcon1234'
const HOME_COMMAND = '/home 1'
const WEB_PASSWORD = 'condombebong123'

const SENSITIVE_WORDS = [
  'domcon1234', 
  'condombebong123', 
  '/login', 
  '/register', 
  '/changepassword',
  '/passwd'
]

const WEAPON_DAMAGE = {
  'netherite_sword': 8, 'diamond_sword': 7, 'iron_sword': 6, 'stone_sword': 5, 'golden_sword': 4, 'wooden_sword': 4,
  'netherite_axe': 10, 'diamond_axe': 9, 'iron_axe': 9, 'stone_axe': 9, 'golden_axe': 7, 'wooden_axe': 7
}

const FOOD_NAMES = ['cooked_beef', 'cooked_porkchop', 'golden_apple', 'bread', 'cooked_chicken', 'cooked_mutton', 'apple']

let botStatus = 'Đang khởi động...'
let isOnline = false
let startTime = Date.now()
let logs = []
let botInstance = null

let isPvPActive = false
let isAttacking = false
let isEating = false
let pvpInterval = null
let afkInterval = null

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
  if (logs.length > 25) logs.pop()
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

// ==========================================
// LOGIC PVP & AFK & TỰ ĐỘNG ĂN
// ==========================================

function stopAllModes() {
  isPvPActive = false
  isAttacking = false
  if (afkInterval) clearInterval(afkInterval)
  if (pvpInterval) clearInterval(pvpInterval)
}

function startAFK(bot) {
  stopAllModes()
  afkInterval = setInterval(() => {
    if (bot && bot.entity && isOnline) {
      bot.setControlState('jump', true)
      setTimeout(() => bot.setControlState('jump', false), 200)
    }
  }, 4000)
  addLog('🔄 Đã chuyển sang chế độ AFK nhảy nhảy thông thường.')
}

async function checkAndEat(bot) {
  if (!bot || isEating || !isOnline) return false
  if (bot.health <= 15 || bot.food <= 15) {
    const foodItem = bot.inventory.items().find(item => FOOD_NAMES.includes(item.name))
    if (foodItem) {
      try {
        isEating = true
        addLog(`🍖 Máu/Thức ăn thấp (${bot.health}/20 HP). Đang ăn ${foodItem.displayName || foodItem.name}...`)
        await bot.equip(foodItem, 'hand')
        await bot.consume()
        addLog('✅ Đã ăn xong!')
        isEating = false
        return true
      } catch (err) {
        isEating = false
      }
    }
  }
  return false
}

async function equipBestWeapon(bot) {
  if (!bot || !bot.inventory) return 'Tay không'
  let bestItem = null
  let maxDamage = 0

  for (const item of bot.inventory.items()) {
    const damage = WEAPON_DAMAGE[item.name] || 0
    if (damage > maxDamage) {
      maxDamage = damage
      bestItem = item
    }
  }

  if (bestItem) {
    const heldItem = bot.heldItem
    if (!heldItem || heldItem.name !== bestItem.name) {
      try {
        await bot.equip(bestItem, 'hand')
      } catch (err) {}
    }
    return bestItem.displayName || bestItem.name
  }

  return bot.heldItem ? (bot.heldItem.displayName || bot.heldItem.name) : 'Tay không'
}

async function performLegitCombo(bot) {
  if (!bot || !bot.entity || !isPvPActive || isAttacking || isEating || !isOnline) return

  const ate = await checkAndEat(bot)
  if (ate) return

  const filter = (entity) => 
    entity.type === 'player' && 
    entity.username !== bot.username && 
    entity.metadata[6] !== 0

  const target = bot.nearestEntity(filter)

  if (target && bot.entity.position.distanceTo(target.position) <= 4.0) {
    isAttacking = true

    const currentWeapon = await equipBestWeapon(bot)
    const targetPos = target.position.offset(0, target.height * 0.8, 0)
    await bot.lookAt(targetPos, true)

    bot.setControlState('jump', true)
    setTimeout(() => bot.setControlState('jump', false), 150)

    setTimeout(() => {
      if (bot.entity && target && isPvPActive) {
        bot.lookAt(target.position.offset(0, target.height * 0.8, 0), true)
        bot.attack(target)
        addLog(`⚔️ Đánh [${target.username}] | Đồ đang cầm: [${currentWeapon}]`)
      }
      isAttacking = false
    }, 380)
  }
}

function startPvP(bot) {
  stopAllModes()
  isPvPActive = true
  pvpInterval = setInterval(() => {
    performLegitCombo(bot)
  }, 1100)
  addLog('⚔️ Đã BẬT Chế độ PvP Legit!')
}

// ==========================================
// WEB SERVER DASHBOARD
// ==========================================

function startWebServer(port) {
  const server = http.createServer((req, res) => {
    const parsedUrl = url.parse(req.url, true)
    const clientIP = getClientIP(req)

    if (parsedUrl.pathname === '/check-auth' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify({ isAuth: authenticatedIPs.has(clientIP), isPvP: isPvPActive }))
    }

    if (parsedUrl.pathname === '/get-inventory' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify({ 
        success: true, 
        items: getInventoryItems(),
        vault: currentVault,
        isPvP: isPvPActive,
        heldItem: botInstance && botInstance.heldItem ? (botInstance.heldItem.displayName || botInstance.heldItem.name) : 'Tay không'
      }))
    }

    if (parsedUrl.pathname === '/toggle-pvp' && req.method === 'POST') {
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

          if (data.enable) {
            startPvP(botInstance)
          } else {
            startAFK(botInstance)
          }

          res.writeHead(200, { 'Content-Type': 'application/json' })
          return res.end(JSON.stringify({ success: true, isPvP: isPvPActive, isAuth: true }))
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          return res.end(JSON.stringify({ success: false, message: 'Lỗi dữ liệu!' }))
        }
      })
      return
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
          return res.end(JSON.stringify({ success: false, message: 'Lỗi dữ liệu!' }))
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

          if (!isOnline || !botInstance) {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            return res.end(JSON.stringify({ success: false, message: 'Bot đã dừng từ trước!' }))
          }

          stopAllModes()
          botInstance.quit('Được tắt bởi Admin qua Web Dashboard')
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
          body { background: #0f172a; color: #f8fafc; display: flex; justify-content: center; align-items: center; min-height: 100vh; padding: 20px; }
          .card { background: #1e293b; border: 1px solid #334155; border-radius: 16px; padding: 24px; width: 100%; max-width: 520px; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5); text-align: center; }
          .title { font-size: 22px; font-weight: 700; color: #38bdf8; margin-bottom: 12px; }
          .badge { display: inline-block; padding: 6px 14px; border-radius: 20px; font-size: 13px; font-weight: 600; margin-bottom: 16px; background: ${isOnline ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)'}; color: ${isOnline ? '#4ade80' : '#f87171'}; border: 1px solid ${isOnline ? 'rgba(34, 197, 94, 0.2)' : 'rgba(239, 68, 68, 0.2)'}; }
          .info-group { background: #0f172a; border-radius: 10px; padding: 10px 14px; margin-bottom: 8px; text-align: left; }
          .label { font-size: 11px; color: #94a3b8; font-weight: 600; text-transform: uppercase; }
          .value { font-size: 14px; font-weight: 600; color: #f1f5f9; margin-top: 2px; }
          .section-title { font-size: 12px; color: #38bdf8; font-weight: 700; text-align: left; margin: 16px 0 6px 0; text-transform: uppercase; }
          .inv-table-container { max-height: 120px; overflow-y: auto; border: 1px solid #334155; border-radius: 8px; background: #0f172a; }
          table { width: 100%; border-collapse: collapse; text-align: left; font-size: 12px; }
          th, td { padding: 8px 12px; border-bottom: 1px solid #1e293b; }
          th { background: #1e293b; color: #38bdf8; font-weight: 600; position: sticky; top: 0; }
          td { color: #cbd5e1; }
          .empty-inv { text-align: center; padding: 12px; color: #64748b; font-style: italic; }
          .chat-box-container { margin-top: 14px; text-align: left; }
          .input-field { width: 100%; padding: 10px; margin-top: 6px; border-radius: 8px; border: 1px solid #334155; background: #0f172a; color: #fff; font-size: 13px; }
          .btn-send { width: 100%; padding: 10px; margin-top: 8px; border-radius: 8px; border: none; background: #38bdf8; color: #0f172a; font-weight: 700; cursor: pointer; }
          .log-box { background: #090d16; border: 1px solid #1e293b; border-radius: 10px; padding: 10px; height: 120px; overflow-y: auto; text-align: left; font-family: monospace; font-size: 11px; color: #a7f3d0; }
          .log-item { margin-bottom: 4px; word-break: break-all; }
          .action-btn-group { display: flex; gap: 10px; margin-top: 14px; }
          .btn-action { flex: 1; padding: 10px; border-radius: 10px; border: none; font-weight: 700; font-size: 13px; cursor: pointer; }
          .btn-stop { background: ${isOnline ? '#ef4444' : '#334155'}; color: ${isOnline ? '#ffffff' : '#64748b'}; cursor: ${isOnline ? 'pointer' : 'not-allowed'}; }
          .btn-restart { background: ${isOnline ? '#334155' : '#22c55e'}; color: ${isOnline ? '#64748b' : '#ffffff'}; cursor: ${isOnline ? 'not-allowed' : 'pointer'}; }
          .pvp-box { background: #0f172a; border: 1px solid #334155; border-radius: 10px; padding: 12px; margin-top: 14px; text-align: left; }
          .btn-pvp { width: 100%; padding: 10px; margin-top: 8px; border-radius: 8px; border: none; font-weight: 700; cursor: pointer; color: white; }
        </style>
        <script>
          let isIPAuthenticated = false;
          let pvpStatus = false;

          window.onload = function() {
            fetch('/check-auth')
              .then(res => res.json())
              .then(data => {
                isIPAuthenticated = data.isAuth;
                pvpStatus = data.isPvP;
                if (isIPAuthenticated) {
                  document.getElementById('chatPwd').style.display = 'none';
                }
                updatePvPUI(pvpStatus);
              });
            setInterval(fetchData, 2000);
          }

          function updatePvPUI(status) {
            const btn = document.getElementById('btnPvP');
            const txt = document.getElementById('pvpTxt');
            pvpStatus = status;
            if (pvpStatus) {
              btn.innerText = '🛡️ Tắt Chế Độ PvP (Chuyển AFK)';
              btn.style.background = '#ef4444';
              txt.innerText = 'BẬT (Đang săn người chơi & Ăn hồi máu)';
              txt.style.color = '#4ade80';
            } else {
              btn.innerText = '⚔️ Bật Chế Độ PvP';
              btn.style.background = '#22c55e';
              txt.innerText = 'TẮT (Đang AFK nhảy thông thường)';
              txt.style.color = '#f87171';
            }
          }

          function fetchData() {
            fetch('/get-inventory')
              .then(res => res.json())
              .then(data => {
                if (data.success) {
                  document.getElementById('heldItemTxt').innerText = data.heldItem;
                  const tbody = document.getElementById('invBody');
                  if (data.items.length === 0) {
                    tbody.innerHTML = '<tr><td colspan="3" class="empty-inv">Túi đồ trống...</td></tr>';
                  } else {
                    tbody.innerHTML = data.items.map(i => \`
                      <tr>
                        <td>\${i.slot}</td>
                        <td style="font-weight: 600; color: #f8fafc;">\${i.name}</td>
                        <td style="color: #4ade80;">x\${i.count}</td>
                      </tr>
                    \`).join('');
                  }
                }
              });
          }

          function togglePvP() {
            const pwd = document.getElementById('chatPwd').value;
            if (!isIPAuthenticated && !pwd) return alert('Vui lòng nhập mật khẩu xác thực!');

            fetch('/toggle-pvp', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ enable: !pvpStatus, password: pwd })
            })
            .then(res => res.json())
            .then(data => {
              if (data.success) {
                if (data.isAuth) {
                  isIPAuthenticated = true;
                  document.getElementById('chatPwd').style.display = 'none';
                }
                updatePvPUI(data.isPvP);
              } else {
                alert(data.message);
              }
            });
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
                document.getElementById('chatMsg').value = '';
                if (data.isAuth) {
                  isIPAuthenticated = true;
                  document.getElementById('chatPwd').style.display = 'none';
                }
              }
            });
          }

          function stopBot() {
            if (!${isOnline}) return;
            const pwd = document.getElementById('chatPwd').value;
            if (!isIPAuthenticated && !pwd) return alert('Vui lòng nhập mật khẩu xác thực!');
            if (!confirm('Bạn chắc chắn muốn ngắt kết nối Bot?')) return;

            fetch('/stop-bot', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ password: pwd })
            })
            .then(res => res.json())
            .then(data => {
              alert(data.message);
              if (data.success) window.location.reload();
            });
          }

          function restartBot() {
            if (${isOnline}) return;
            fetch('/restart', { method: 'POST' })
              .then(res => res.json())
              .then(data => {
                alert(data.message);
                window.location.reload();
              });
          }
        </script>
      </head>
      <body>
        <div class="card">
          <div class="title">🤖 AFK Bot Dashboard</div>
          <div class="badge">● ${botStatus}</div>
          
          <div class="info-group">
            <div class="label">Tên Bot / Server</div>
            <div class="value">${BOT_USERNAME} (${SERVER_HOST})</div>
          </div>
          <div class="info-group">
            <div class="label">Thời gian hoạt động</div>
            <div class="value">${getUptime()}</div>
          </div>
          <div class="info-group">
            <div class="label">Vũ khí / Vật phẩm đang cầm</div>
            <div class="value" id="heldItemTxt" style="color: #38bdf8;">Đang tải...</div>
          </div>

          <div class="pvp-box">
            <div class="label">Chế độ PvP Tự Động</div>
            <div class="value" id="pvpTxt">Đang tải...</div>
            <button id="btnPvP" class="btn-pvp" onclick="togglePvP()">Bật/Tắt PvP</button>
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
              <tbody id="invBody">
                <tr><td colspan="3" class="empty-inv">Tải dữ liệu...</td></tr>
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
            <button class="btn-action btn-stop" onclick="stopBot()" ${isOnline ? '' : 'disabled'}>
              🛑 Tắt Bot
            </button>
            <button class="btn-action btn-restart" onclick="restartBot()" ${isOnline ? 'disabled' : ''}>
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
    currentVault = { title: title, items: vaultItems }
  })

  bot.on('spawn', () => {
    botStatus = 'Đang hoạt động (Online)'
    isOnline = true
    addLog(`Bot ${BOT_USERNAME} vào server thành công!`)

    if (!loginFlowStarted) {
      loginFlowStarted = true
      setTimeout(() => {
        safeChat(LOGIN_COMMAND)
        setTimeout(() => {
          safeChat(HOME_COMMAND)
          addLog('Đã thực hiện dịch chuyển /home 1')
          startAFK(bot)
        }, 2000)
      }, 3000)
    } else {
      startAFK(bot)
    }
  })

  bot.on('death', () => {
    stopAllModes()
    addLog('⚠️ Bot đã bị chết! Đang tự động hồi sinh...')
    bot.respawn()
    setTimeout(() => {
      safeChat(HOME_COMMAND)
      startAFK(bot)
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

  bot.on('kicked', () => {
    stopAllModes()
    botStatus = 'Bị đá khỏi server (Offline)'
    isOnline = false
    addLog(`Mất kết nối: Bot bị đá!`)
  })

  bot.on('error', (err) => {
    stopAllModes()
    botStatus = 'Gặp lỗi kết nối'
    isOnline = false
    addLog(`Lỗi: ${err.message}`)
  })

  bot.on('end', () => {
    stopAllModes()
    botStatus = 'Đã ngắt kết nối (Offline)'
    isOnline = false
    addLog('Bot đã thoát khỏi server.')
  })
}

createBotInstance()

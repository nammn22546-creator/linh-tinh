function createBotInstance() {

  if (isConnecting) return
  if (manualStop) return

  isConnecting = true
  isOnline = false

  stopAllModes()

  if (botInstance) {
    try {
      botInstance.end()
    } catch {}

    botInstance = null
  }

  botStatus = 'Đang kết nối server Minecraft...'

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

      /*
       * Server có Resource Pack nên giữ timeout
       * đủ dài để hoàn tất handshake.
       */
      connectTimeout: 30000,
      checkTimeoutInterval: 120000,

      auth: 'offline'
    })

  } catch (error) {

    isConnecting = false

    botStatus = 'Lỗi tạo bot'

    addLog(
      `❌ createBot: ${error.message}`
    )

    scheduleReconnect()

    return
  }

  botInstance = bot

  let resourcePackAccepted = false
  let loginStarted = false
  let spawnStarted = false

  // ==========================================================
  // TCP
  // ==========================================================

  if (bot._client?.socket) {

    bot._client.socket.once(
      'connect',
      () => {
        addLog(
          '🔌 TCP đã kết nối tới server.'
        )
      }
    )

  }

  // ==========================================================
  // RESOURCE PACK
  // ==========================================================

  bot.on(
    'resourcePack',
    (resourcePackUrl, hash) => {

      addLog(
        '📦 Server yêu cầu Resource Pack.'
      )

      try {

        if (
          typeof bot.acceptResourcePack ===
          'function'
        ) {

          // ACCEPT NGAY
          bot.acceptResourcePack()

          resourcePackAccepted = true

          addLog(
            '✅ Đã ACCEPT Resource Pack ngay lập tức.'
          )

        } else {

          addLog(
            '❌ Mineflayer không có acceptResourcePack().'
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
  // LOGIN HANDSHAKE
  // ==========================================================

  bot.once(
    'login',
    () => {

      addLog(
        '🔐 Minecraft login handshake thành công.'
      )

    }
  )

  // ==========================================================
  // SPAWN
  // ==========================================================

  bot.once(
    'spawn',
    () => {

      if (spawnStarted) return

      spawnStarted = true

      isConnecting = false
      isOnline = true

      botStatus =
        'Đang hoạt động (Online)'

      addLog(
        `✅ Bot ${BOT_USERNAME} đã vào server!`
      )

      /*
       * Quan trọng:
       *
       * Resource Pack có thể được server gửi
       * trước spawn hoặc sau login.
       *
       * Không login command trước spawn.
       */

      if (loginStarted) {

        startAFK(bot)

        return
      }

      loginStarted = true

      // ======================================================
      // LOGIN COMMAND
      // ======================================================

      if (LOGIN_COMMAND) {

        setTimeout(() => {

          if (
            botInstance !== bot ||
            !isOnline
          ) {
            return
          }

          addLog(
            '🔐 Đang gửi lệnh đăng nhập...'
          )

          safeChat(
            bot,
            LOGIN_COMMAND
          )

        }, 2500)

      }

      // ======================================================
      // SAU LOGIN → TPA / HOME
      // ======================================================

      const afterLoginDelay =
        LOGIN_COMMAND
          ? 5500
          : 2500

      setTimeout(() => {

        if (
          botInstance !== bot ||
          !isOnline
        ) {
          return
        }

        if (HOME_COMMAND) {

          addLog(
            '📍 Đang thực hiện lệnh sau đăng nhập...'
          )

          safeChat(
            bot,
            HOME_COMMAND
          )

        }

        // ====================================================
        // AFK
        // ====================================================

        setTimeout(() => {

          if (
            botInstance !== bot ||
            !isOnline
          ) {
            return
          }

          addLog(
            '🟢 Đăng nhập hoàn tất → bắt đầu AFK.'
          )

          startAFK(bot)

        }, 2000)

      }, afterLoginDelay)

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

      stopAllModes()

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

            safeChat(
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
  // MESSAGE
  // ==========================================================

  bot.on(
    'message',
    message => {

      try {

        const text =
          message.toString().trim()

        if (!text) return

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

      if (botInstance === bot) {
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

      addLog(
        `🔌 Bot mất kết nối: ${
          reason || 'socketClosed'
        }`
      )

      scheduleReconnect()

    }
  )

}

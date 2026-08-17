<!-- Bảng điều khiển Chế độ PvP / AFK -->
<div style="margin: 15px 0; padding: 10px; background: #222; border-radius: 8px; color: #fff;">
  <p style="margin: 0 0 10px 0;">Trạng thái: <strong id="pvp-status" style="color: #ff4d4d;">TẮT (Đang AFK nhảy)</strong></p>
  <button id="btn-toggle-pvp" onclick="togglePvP()" style="padding: 8px 16px; background: #28a745; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">
    ⚔️ Bật Chế Độ PvP
  </button>
</div>

<script>
  let pvpState = false;
  function togglePvP() {
    pvpState = !pvpState;
    const btn = document.getElementById('btn-toggle-pvp');
    const status = document.getElementById('pvp-status');
    
    // Gửi lệnh về Server qua WebSocket hoặc Socket.io
    socket.emit('toggle-pvp', { enabled: pvpState });

    if (pvpState) {
      btn.innerText = '🛡️ Tắt PvP (Chuyển AFK)';
      btn.style.background = '#dc3545';
      status.innerText = 'BẬT (Đang săn người chơi)';
      status.style.color = '#28a745';
    } else {
      btn.innerText = '⚔️ Bật Chế Độ PvP';
      btn.style.background = '#28a745';
      status.innerText = 'TẮT (Đang AFK nhảy)';
      status.style.color = '#ff4d4d';
    }
  }
</script>

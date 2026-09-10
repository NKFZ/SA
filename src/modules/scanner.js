/* ==========================================================================
   QR Code Scanner Module with Confirmation Modal & Turso DB Sync (scanner.js)
   ========================================================================== */

import { Html5Qrcode } from 'html5-qrcode';
import confetti from 'canvas-confetti';

let html5QrCode = null;
let isScanning = false;
let isProcessingScan = false;
let pendingPayload = null;

export function initScannerModule(showToast, refreshAllUI) {
  const btnToggleCamera = document.getElementById('btn-toggle-camera-seller') || document.getElementById('btn-toggle-camera');
  const btnSimulateScan = document.getElementById('btn-simulate-scan-seller') || document.getElementById('btn-simulate-scan');

  if (btnToggleCamera) {
    btnToggleCamera.addEventListener('click', () => {
      toggleCameraScanner(showToast, refreshAllUI);
    });
  }

  if (btnSimulateScan) {
    btnSimulateScan.addEventListener('click', () => {
      simulateScan(showToast, refreshAllUI);
    });
  }

  // Setup Confirmation Modal Actions
  const btnConfirm = document.getElementById('btn-confirm-claim-points');
  const btnCancel = document.getElementById('btn-cancel-claim-points');

  if (btnConfirm) {
    btnConfirm.addEventListener('click', async () => {
      await handleConfirmClaimPoints(showToast, refreshAllUI);
    });
  }

  if (btnCancel) {
    btnCancel.addEventListener('click', () => {
      closeSummaryModal();
      showToast('ยกเลิกรายการแล้ว', 'info');
    });
  }
}

async function toggleCameraScanner(showToast, refreshAllUI) {
  const btnToggleCamera = document.getElementById('btn-toggle-camera-seller') || document.getElementById('btn-toggle-camera');

  if (isScanning) {
    await stopScanner();
    if (btnToggleCamera) btnToggleCamera.innerHTML = '<i data-lucide="camera"></i> เปิดกล้องสแกน';
    if (window.lucide) window.lucide.createIcons();
    showToast('ปิดกล้องสแกนแล้ว', 'info');
    return;
  }

  try {
    if (!html5QrCode) {
      html5QrCode = new Html5Qrcode("qr-reader");
    }

    const config = { fps: 10, qrbox: { width: 250, height: 250 } };

    await html5QrCode.start(
      { facingMode: "environment" },
      config,
      async (decodedText) => {
        if (isProcessingScan) return;
        isProcessingScan = true;

        // Immediately stop camera upon detecting QR code to avoid repeat scans
        await stopScanner();
        if (btnToggleCamera) btnToggleCamera.innerHTML = '<i data-lucide="camera"></i> เปิดกล้องสแกน';
        if (window.lucide) window.lucide.createIcons();

        let payload;
        try {
          payload = JSON.parse(decodedText);
        } catch (e) {
          showToast('QR Code นี้ไม่อยู่ในรูปแบบของ EcoRecycle', 'error');
          isProcessingScan = false;
          return;
        }

        if (payload.type !== 'ECO_RECYCLE_POINTS' || !payload.points) {
          showToast('QR Code ไม่ถูกต้อง หรือหมดอายุแล้ว', 'error');
          isProcessingScan = false;
          return;
        }

        // ข้อ 12: ตรวจสอบถ้าไม่ได้สแกนของตัวเอง จะไม่ได้คะแนน
        const loggedUser = window.getCurrentUser ? window.getCurrentUser() : null;
        const currentUserId = loggedUser ? loggedUser.user_id : (localStorage.getItem('ECO_USER_ID') ? Number(localStorage.getItem('ECO_USER_ID')) : null);

        if (payload.targetUserId && currentUserId && Number(payload.targetUserId) !== Number(currentUserId)) {
          showToast(`❌ ไม่สามารถรับคะแนนได้! QR Code นี้ถูกสร้างสำหรับ "${payload.targetUserName || 'ลูกค้าท่านอื่น'}" (ID: ${payload.targetUserId}) ซึ่งไม่ใช่บัญชีของคุณ`, 'error');
          isProcessingScan = false;
          return;
        }

        openSummaryModal(payload, showToast, refreshAllUI);
      },
      (errorMessage) => {
        // Parse error during scanning frame (silent)
      }
    );

    isScanning = true;
    if (btnToggleCamera) btnToggleCamera.innerHTML = '<i data-lucide="camera-off"></i> ปิดกล้องสแกน';
    if (window.lucide) window.lucide.createIcons();
    showToast('เปิดกล้องแล้ว กรุณาเล็งไปยัง QR Code ของพนักงาน', 'info');
  } catch (err) {
    console.error('Camera error:', err);
    showToast('ไม่สามารถเข้าถึงกล้องได้ (สามารถใช้ปุ่มจำลองการสแกนด้านล่างได้)', 'warning');
  }
}

async function stopScanner() {
  if (html5QrCode && isScanning) {
    try {
      await html5QrCode.stop();
    } catch (e) {
      console.warn('Stop scanner warning:', e);
    }
    isScanning = false;
  }
}

export function simulateScan(showToast, refreshAllUI) {
  const loggedUser = window.getCurrentUser ? window.getCurrentUser() : null;
  const myUserId = loggedUser ? loggedUser.user_id : (localStorage.getItem('ECO_USER_ID') ? Number(localStorage.getItem('ECO_USER_ID')) : 1);
  const myName = loggedUser ? (loggedUser.name || loggedUser.username) : 'คุณ';

  const mockPayload = {
    type: 'ECO_RECYCLE_POINTS',
    id: 'TX-' + Math.floor(10000 + Math.random() * 90000),
    targetUserId: myUserId,
    targetUserName: myName,
    points: 450,
    totalWeight: 12.5,
    recycleKg: 5.0,
    organicKg: 3.5,
    generalKg: 3.0,
    hazardousKg: 1.0,
    summary: 'Recycle 5.0kg, Organic 3.5kg, General 3.0kg, Hazardous 1.0kg',
    collectorName: 'สมชาย เก็บขยะ (EMP-8821)',
    location: 'จุดบริการรับซื้อขยะเคลื่อนที่ (กรุงเทพฯ)',
    timestamp: Date.now()
  };

  openSummaryModal(mockPayload, showToast, refreshAllUI);
}

// เปิดหน้าต่างสรุปข้อมูลทั้งหมดเพื่อให้ผู้ขายตรวจสอบก่อนกดยืนยันรับแต้ม
function openSummaryModal(payload, showToast, refreshAllUI) {
  pendingPayload = payload;

  const modal = document.getElementById('qr-summary-modal-overlay');
  if (!modal) return;

  // 1. Transaction ID
  const txEl = document.getElementById('summary-tx-id');
  if (txEl) txEl.textContent = payload.id || 'TX-99999';

  // 2. Date & Time
  const dtEl = document.getElementById('summary-datetime');
  if (dtEl) {
    const timeVal = payload.timestamp ? new Date(payload.timestamp) : new Date();
    dtEl.textContent = timeVal.toLocaleString('th-TH', {
      dateStyle: 'medium',
      timeStyle: 'short'
    });
  }

  // 3. Location
  const locEl = document.getElementById('summary-location');
  if (locEl) locEl.textContent = payload.location || 'จุดบริการรับซื้อขยะเคลื่อนที่ (กรุงเทพฯ)';

  // 4. Staff
  const staffEl = document.getElementById('summary-staff');
  if (staffEl) staffEl.textContent = payload.collectorName || 'สมชาย เก็บขยะ (EMP-8821)';

  // 5. Waste Breakdown
  const recycleEl = document.getElementById('summary-recycle-kg');
  const organicEl = document.getElementById('summary-organic-kg');
  const generalEl = document.getElementById('summary-general-kg');
  const hazardousEl = document.getElementById('summary-hazardous-kg');
  const totalEl = document.getElementById('summary-total-kg');

  const rKg = parseFloat(payload.recycleKg) || 0;
  const oKg = parseFloat(payload.organicKg) || 0;
  const gKg = parseFloat(payload.generalKg) || 0;
  const hKg = parseFloat(payload.hazardousKg) || 0;
  const tKg = payload.totalWeight ? parseFloat(payload.totalWeight) : +(rKg + oKg + gKg + hKg).toFixed(1);

  if (recycleEl) recycleEl.textContent = `${rKg.toFixed(1)} kg`;
  if (organicEl) organicEl.textContent = `${oKg.toFixed(1)} kg`;
  if (generalEl) generalEl.textContent = `${gKg.toFixed(1)} kg`;
  if (hazardousEl) hazardousEl.textContent = `${hKg.toFixed(1)} kg`;
  if (totalEl) totalEl.textContent = `${tKg.toFixed(1)} kg`;

  // 6. Total Points
  const ptsEl = document.getElementById('summary-points-val');
  if (ptsEl) ptsEl.textContent = `+${Number(payload.points).toLocaleString()} แต้ม`;

  // Show Modal
  modal.classList.remove('hidden');
  if (window.lucide) window.lucide.createIcons();
}

function closeSummaryModal() {
  const modal = document.getElementById('qr-summary-modal-overlay');
  if (modal) modal.classList.add('hidden');
  pendingPayload = null;
  isProcessingScan = false;
}

// กดยืนยันเพื่อรับแต้มเข้าฐานข้อมูล
async function handleConfirmClaimPoints(showToast, refreshAllUI) {
  if (!pendingPayload) {
    showToast('ไม่พบข้อมูลรายการขยะ', 'warning');
    return;
  }

  const btnConfirm = document.getElementById('btn-confirm-claim-points');
  if (btnConfirm) {
    btnConfirm.disabled = true;
    btnConfirm.innerHTML = '<i data-lucide="loader" class="spin"></i> กำลังบันทึกแต้ม...';
  }

  try {
    const user = window.getCurrentUser ? window.getCurrentUser() : null;
    const targetUserId = (user && user.user_id) || localStorage.getItem('ECO_USER_ID') || 1;

    const res = await fetch('/api/points/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: Number(targetUserId),
        points: pendingPayload.points,
        summary: pendingPayload.summary || 'สแกน QR Code รับแต้ม',
        staffId: pendingPayload.staffId || 1,
        recycleKg: pendingPayload.recycleKg || 0,
        organicKg: pendingPayload.organicKg || 0,
        generalKg: pendingPayload.generalKg || 0,
        hazardousKg: pendingPayload.hazardousKg || 0,
        totalWeight: pendingPayload.totalWeight || 0,
        targetUserId: pendingPayload.targetUserId || null,
        reportId: pendingPayload.reportId || null
      })
    });

    const data = await res.json();

    if (res.ok && data.success) {
      // Sync currentUser in main.js
      if (window.setCurrentUser && data.user) {
        window.setCurrentUser(data.user);
      }

      // Confetti celebration
      try {
        confetti({
          particleCount: 100,
          spread: 70,
          origin: { y: 0.6 }
        });
      } catch (e) {}

      showToast(`🎉 ยืนยันสำเร็จ! ได้รับ +${Number(pendingPayload.points).toLocaleString()} แต้มเรียบร้อยแล้ว`, 'success');

      closeSummaryModal();
      await refreshAllUI();

      // สลับไปหน้า Home เพื่อให้เห็นแต้มใหม่ทันที
      if (window.switchView) {
        window.switchView('view-seller-home');
      }
    } else {
      showToast(data.error || 'ไม่สามารถบันทึกแต้มได้', 'error');
    }
  } catch (err) {
    console.error('Error claiming points:', err);
    showToast('เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์', 'error');
  } finally {
    if (btnConfirm) {
      btnConfirm.disabled = false;
      btnConfirm.innerHTML = '<i data-lucide="check-circle"></i> ยืนยันเพื่อรับแต้ม';
      if (window.lucide) window.lucide.createIcons();
    }
    isProcessingScan = false;
  }
}

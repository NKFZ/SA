/* ==========================================================================
   QR Code Scanner Module with SQLite Database Sync (scanner.js)
   ========================================================================== */

import { Html5Qrcode } from 'html5-qrcode';
import confetti from 'canvas-confetti';

let html5QrCode = null;
let isScanning = false;

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
        await handleDecodedQR(decodedText, showToast, refreshAllUI);
        stopScanner();
      },
      (errorMessage) => {
        // Parse error (silent)
      }
    );

    isScanning = true;
    if (btnToggleCamera) btnToggleCamera.innerHTML = '<i data-lucide="camera-off"></i> ปิดกล้องสแกน';
    if (window.lucide) window.lucide.createIcons();
    showToast('เปิดกล้องแล้ว กรุณาเล็งไปยัง QR Code', 'info');
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
      console.warn(e);
    }
    isScanning = false;
  }
}

export function simulateScan(showToast, refreshAllUI) {
  const mockPayload = {
    type: 'ECO_RECYCLE_POINTS',
    id: 'TX-' + Math.floor(10000 + Math.random() * 90000),
    points: 450,
    totalWeight: 12.5,
    recycleKg: 5.0,
    organicKg: 3.5,
    generalKg: 3.0,
    hazardousKg: 1.0,
    summary: 'Recycle 5.0kg, Organic 3.5kg, General 3.0kg, Hazardous 1.0kg',
    collectorName: 'สมชาย เก็บขยะ (EMP-8821)',
    timestamp: Date.now()
  };

  handleDecodedQR(JSON.stringify(mockPayload), showToast, refreshAllUI);
}

async function handleDecodedQR(decodedText, showToast, refreshAllUI) {
  try {
    let payload;
    try {
      payload = JSON.parse(decodedText);
    } catch (e) {
      showToast('QR Code นี้ไม่อยู่ในรูปแบบของ EcoRecycle', 'error');
      return;
    }

    if (payload.type !== 'ECO_RECYCLE_POINTS' || !payload.points) {
      showToast('QR Code ไม่ถูกต้อง หรือหมดอายุแล้ว', 'error');
      return;
    }

    // Award Points into SQLite Database (Points Only + Waste Breakdown)
    const savedUserId = localStorage.getItem('ECO_USER_ID') || 1;
    const res = await fetch('/api/points/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: savedUserId,
        points: payload.points,
        summary: payload.summary || 'สแกน QR Code รับแต้ม',
        staffId: 1,
        recycleKg: payload.recycleKg || 0,
        organicKg: payload.organicKg || 0,
        generalKg: payload.generalKg || 0,
        hazardousKg: payload.hazardousKg || 0,
        totalWeight: payload.totalWeight || 0
      })
    });

    const data = await res.json();
    if (data.success) {
      // Trigger Confetti!
      try {
        confetti({
          particleCount: 80,
          spread: 70,
          origin: { y: 0.6 }
        });
      } catch (e) {}

      showToast(`สแกนสะสมแต้มสำเร็จ! +${payload.points} แต้ม`, 'success');
      await refreshAllUI();
    } else {
      showToast(data.error || 'ไม่สามารถบันทึกแต้มได้', 'error');
    }

  } catch (err) {
    console.error('Error processing QR:', err);
    showToast('เกิดข้อผิดพลาดในการประมวลผล QR Code', 'error');
  }
}

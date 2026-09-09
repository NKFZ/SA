/* ==========================================================================
   Collector / Staff Waste Inspection & Dynamic QR Generator (collector.js)
   ========================================================================== */

import QRCode from 'qrcode';
import { getStore, updatePoints, addTransaction } from './store.js';

// Rates for 4 waste categories
export const WASTE_RATES = {
  plastic: { name: 'พลาสติก (PET)', pointsPerKg: 50, thbPerKg: 12, co2PerKg: 1.5, icon: '🍾' },
  paper:   { name: 'กระดาษ & ลัง', pointsPerKg: 30, thbPerKg: 6,  co2PerKg: 1.0, icon: '📰' },
  glass:   { name: 'ขวดแก้ว',       pointsPerKg: 20, thbPerKg: 3,  co2PerKg: 0.5, icon: '🍷' },
  metal:   { name: 'โลหะ & กระป๋อง', pointsPerKg: 80, thbPerKg: 35, co2PerKg: 2.5, icon: '🥫' }
};

let currentQRPayload = null;

export function initCollectorModule(showToast, refreshAllUI) {
  // Bind counters & recalculation
  window.adjustWeight = (type, delta) => {
    const input = document.getElementById(`input-weight-${type}`);
    if (!input) return;
    let val = parseFloat(input.value) || 0;
    val = Math.max(0, parseFloat((val + delta).toFixed(1)));
    input.value = val.toFixed(1);
    calculateCollectorTotals();
  };

  window.calculateCollectorTotals = calculateCollectorTotals;

  const btnGenerate = document.getElementById('btn-generate-qr');
  if (btnGenerate) {
    btnGenerate.addEventListener('click', () => {
      generateCollectorQR(showToast);
    });
  }

  const btnAutoCollect = document.getElementById('btn-auto-collect-qr');
  if (btnAutoCollect) {
    btnAutoCollect.addEventListener('click', () => {
      if (!currentQRPayload) {
        showToast('กรุณาสร้าง QR Code ก่อนทดสอบโอนแต้ม', 'warning');
        return;
      }
      // Process auto transfer to user
      updatePoints(currentQRPayload.points, currentQRPayload.money, currentQRPayload.totalWeight);
      addTransaction({
        id: currentQRPayload.id,
        date: new Date().toLocaleString('th-TH'),
        type: 'ขายขยะรีไซเคิล (สแกน QR)',
        summary: currentQRPayload.summary,
        weight: currentQRPayload.totalWeight,
        money: currentQRPayload.money,
        points: currentQRPayload.points,
        status: 'สำเร็จ'
      });

      showToast(`โอนแต้มสำเร็จ! +${currentQRPayload.points} แต้ม (+${currentQRPayload.money} ฿)`, 'success');
      refreshAllUI();
      
      // Highlight scan result in user dashboard
      window.switchView('view-dashboard');
    });
  }

  calculateCollectorTotals();
}

export function calculateCollectorTotals() {
  const plastic = parseFloat(document.getElementById('input-weight-plastic')?.value) || 0;
  const paper   = parseFloat(document.getElementById('input-weight-paper')?.value) || 0;
  const glass   = parseFloat(document.getElementById('input-weight-glass')?.value) || 0;
  const metal   = parseFloat(document.getElementById('input-weight-metal')?.value) || 0;

  const totalWeight = +(plastic + paper + glass + metal).toFixed(1);

  const totalMoney = +(
    plastic * WASTE_RATES.plastic.thbPerKg +
    paper   * WASTE_RATES.paper.thbPerKg +
    glass   * WASTE_RATES.glass.thbPerKg +
    metal   * WASTE_RATES.metal.thbPerKg
  ).toFixed(2);

  const totalPoints = Math.round(
    plastic * WASTE_RATES.plastic.pointsPerKg +
    paper   * WASTE_RATES.paper.pointsPerKg +
    glass   * WASTE_RATES.glass.pointsPerKg +
    metal   * WASTE_RATES.metal.pointsPerKg
  );

  // Update UI Elements
  const elWeight = document.getElementById('summary-total-weight');
  const elMoney  = document.getElementById('summary-total-money');
  const elPoints = document.getElementById('summary-total-points');

  if (elWeight) elWeight.textContent = `${totalWeight} kg`;
  if (elMoney)  elMoney.textContent  = `${totalMoney.toLocaleString()} ฿`;
  if (elPoints) elPoints.textContent = `${totalPoints.toLocaleString()} แต้ม`;

  return { plastic, paper, glass, metal, totalWeight, totalMoney, totalPoints };
}

function generateCollectorQR(showToast) {
  const totals = calculateCollectorTotals();
  if (totals.totalWeight <= 0) {
    showToast('กรุณาระบุน้ำหนักขยะอย่างน้อย 1 ประเภท', 'warning');
    return;
  }

  const customerName = document.getElementById('collector-customer-name')?.value || 'ลูกค้าทั่วไป';

  // Build summary text
  const parts = [];
  if (totals.plastic > 0) parts.push(`พลาสติก ${totals.plastic}kg`);
  if (totals.paper > 0)   parts.push(`กระดาษ ${totals.paper}kg`);
  if (totals.glass > 0)   parts.push(`ขวดแก้ว ${totals.glass}kg`);
  if (totals.metal > 0)   parts.push(`กระป๋อง/โลหะ ${totals.metal}kg`);
  const summaryText = parts.join(', ');

  const txId = 'TX-' + Math.floor(10000 + Math.random() * 90000);

  currentQRPayload = {
    type: 'ECO_RECYCLE_POINTS',
    id: txId,
    points: totals.totalPoints,
    money: totals.totalMoney,
    totalWeight: totals.totalWeight,
    summary: summaryText,
    collectorName: 'สมชาย เก็บขยะ (EMP-8821)',
    customerName: customerName,
    timestamp: Date.now()
  };

  const payloadString = JSON.stringify(currentQRPayload);

  const qrCanvasBox = document.getElementById('qr-canvas-box');
  const qrPlaceholder = document.getElementById('qr-placeholder-text');
  const canvasEl = document.getElementById('generated-qr-canvas');
  const idEl = document.getElementById('generated-qr-code-id');

  if (canvasEl && qrCanvasBox && qrPlaceholder) {
    QRCode.toCanvas(canvasEl, payloadString, {
      width: 220,
      margin: 2,
      color: {
        dark: '#0f172a',
        light: '#ffffff'
      }
    }, function (error) {
      if (error) {
        console.error(error);
        showToast('เกิดข้อผิดพลาดในการสร้าง QR Code', 'error');
        return;
      }
      qrPlaceholder.classList.add('hidden');
      qrCanvasBox.classList.remove('hidden');
      if (idEl) idEl.textContent = `${txId} | ${totals.totalPoints} แต้ม`;
      showToast(`สร้าง QR Code สำเร็จ! (${totals.totalPoints} แต้ม)`, 'success');
    });
  }
}

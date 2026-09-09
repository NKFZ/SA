/* ==========================================================================
   Waste Pickup Request & Tracking Module (pickup.js)
   ========================================================================== */

import { getStore, addPickupRequest, updatePickupStatus } from './store.js';

export function initPickupModule(showToast, refreshAllUI) {
  // Set default date to today
  const inputDate = document.getElementById('pickup-date');
  if (inputDate && !inputDate.value) {
    const today = new Date().toISOString().split('T')[0];
    inputDate.value = today;
  }

  window.handlePickupSubmit = (e) => {
    e.preventDefault();
    submitPickupForm(showToast, refreshAllUI);
  };

  renderPickupList(showToast, refreshAllUI);
}

function submitPickupForm(showToast, refreshAllUI) {
  const address = document.getElementById('pickup-address')?.value;
  const phone = document.getElementById('pickup-phone')?.value;
  const date = document.getElementById('pickup-date')?.value;
  const estWeight = document.getElementById('pickup-est-weight')?.value;

  const checkboxes = document.querySelectorAll('input[name="waste-type"]:checked');
  const wasteTypes = Array.from(checkboxes).map(cb => cb.value);

  if (!address || !phone || !date) {
    showToast('กรุณากรอกข้อมูลที่จำเป็นให้ครบถ้วน', 'warning');
    return;
  }

  const reqId = 'REQ-' + Math.floor(1000 + Math.random() * 9000);

  const newRequest = {
    id: reqId,
    address,
    phone,
    date,
    wasteTypes,
    estWeight,
    status: 'pending',
    createdAt: new Date().toLocaleString('th-TH')
  };

  addPickupRequest(newRequest);
  showToast(`ส่งคำขอเรียกรถสำเร็จ! หมายเลข ${reqId}`, 'success');
  
  renderPickupList(showToast, refreshAllUI);
}

export function renderPickupList(showToast, refreshAllUI) {
  const container = document.getElementById('pickup-tracker-list');
  if (!container) return;

  const store = getStore();
  const requests = store.pickupRequests || [];

  if (requests.length === 0) {
    container.innerHTML = `<p class="subtitle" style="text-align:center; padding: 20px;">ยังไม่มีคำขอเรียกรถในระบบ</p>`;
    return;
  }

  const role = store.user.role || 'user';

  container.innerHTML = requests.map(item => {
    let statusLabel = 'รอดำเนินการ (Pending)';
    let statusClass = 'status-pending';

    if (item.status === 'assigned') {
      statusLabel = 'กำลังเดินทางไปรับซื้อ (En Route)';
      statusClass = 'status-assigned';
    } else if (item.status === 'completed') {
      statusLabel = 'เสร็จสิ้นแล้ว (Completed)';
      statusClass = 'status-completed';
    }

    const wasteBadges = (item.wasteTypes || []).map(w => `<span class="rate-badge">${w}</span>`).join(' ');

    let actionBtns = '';
    if (role === 'staff') {
      if (item.status === 'pending') {
        actionBtns = `<button class="btn btn-sm btn-outline margin-top-md" onclick="changeRequestStatus('${item.id}', 'assigned')">รับงานเดินทางไปรับซื้อ</button>`;
      } else if (item.status === 'assigned') {
        actionBtns = `<button class="btn btn-sm btn-primary margin-top-md" onclick="changeRequestStatus('${item.id}', 'completed')">ทำรายการสำเร็จ (ตรวจขยะและออก QR)</button>`;
      }
    }

    return `
      <div class="pickup-item-card">
        <div class="flex-between">
          <strong class="text-main">${item.id}</strong>
          <span class="pickup-status-badge ${statusClass}">${statusLabel}</span>
        </div>
        <p class="margin-top-md" style="color:#e2e8f0; font-size:0.9rem;">📍 ${item.address}</p>
        <div class="flex-between margin-top-md" style="font-size:0.825rem; color:#94a3b8;">
          <span>📞 ${item.phone}</span>
          <span>📅 นัดหมาย: ${item.date}</span>
        </div>
        <div class="margin-top-md flex-between" style="font-size:0.825rem;">
          <div>ประเภท: ${wasteBadges}</div>
          <span class="price-badge">น้ำหนัก: ${item.estWeight}</span>
        </div>
        ${actionBtns}
      </div>
    `;
  }).join('');

  window.changeRequestStatus = (reqId, newStatus) => {
    updatePickupStatus(reqId, newStatus);
    showToast(`อัปเดตสถานะคำขอ ${reqId} แล้ว`, 'success');
    renderPickupList(showToast, refreshAllUI);
    if (newStatus === 'completed') {
      window.switchView('view-collector');
    }
  };
}

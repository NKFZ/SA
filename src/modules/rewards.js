/* ==========================================================================
   Rewards Shop & Transaction History Module (rewards.js)
   ========================================================================== */

import { getStore, updatePoints, addTransaction } from './store.js';

const REWARD_ITEMS = [
  {
    id: 'RWD-01',
    title: 'คูปองส่วนลด 50 บาท (Lotus/BigC)',
    cost: 500,
    category: 'Voucher',
    emoji: '🎟️',
    description: 'ใช้เป็นส่วนลดซื้อสินค้าในซูเปอร์มาร์เก็ตชั้นนำ'
  },
  {
    id: 'RWD-02',
    title: 'กระเป๋าผ้า Eco-Bag รักษ์โลก',
    cost: 800,
    category: 'Eco Item',
    emoji: '🛍️',
    description: 'กระเป๋าผ้าแคนวาสอย่างดี พับเก็บสะดวก ทนทาน'
  },
  {
    id: 'RWD-03',
    title: 'บัตรกำนัลเครื่องดื่ม 100 บาท (Amazon/Starbucks)',
    cost: 1000,
    category: 'Beverage',
    emoji: '☕',
    description: 'รับรหัสคูปองเติมเงินในแอปกาแฟแบรนด์ดัง'
  },
  {
    id: 'RWD-04',
    title: 'บริจาคสมทบทุนปลูกต้นไม้ 10 ต้น',
    cost: 300,
    category: 'Donation',
    emoji: '🌳',
    description: 'ร่วมสนับสนุนโครงการฟื้นฟูป่าไม้และเพิ่มพื้นที่สีเขียว'
  }
];

export function initRewardsModule(showToast, refreshAllUI) {
  renderRewardsGrid(showToast, refreshAllUI);
  renderHistoryTable();
}

export function renderRewardsGrid(showToast, refreshAllUI) {
  const container = document.getElementById('rewards-items-grid');
  if (!container) return;

  const store = getStore();
  const userPoints = store.user.points;

  const elPointsVal = document.getElementById('rewards-points-val');
  if (elPointsVal) elPointsVal.textContent = `${userPoints.toLocaleString()} แต้ม`;

  container.innerHTML = REWARD_ITEMS.map(item => {
    const canAfford = userPoints >= item.cost;
    const btnClass = canAfford ? 'btn-primary' : 'btn-secondary';
    const btnDisabled = canAfford ? '' : 'disabled';
    const btnText = canAfford ? 'แลกของรางวัล' : 'แต้มไม่พอ';

    return `
      <div class="reward-card">
        <div>
          <div class="reward-img-emoji">${item.emoji}</div>
          <h3>${item.title}</h3>
          <p>${item.description}</p>
          <div class="reward-cost">${item.cost.toLocaleString()} แต้ม</div>
        </div>
        <button class="btn ${btnClass} btn-block margin-top-md" ${btnDisabled} onclick="redeemRewardItem('${item.id}')">
          ${btnText}
        </button>
      </div>
    `;
  }).join('');

  window.redeemRewardItem = (itemId) => {
    const item = REWARD_ITEMS.find(r => r.id === itemId);
    if (!item) return;

    const currentStore = getStore();
    if (currentStore.user.points < item.cost) {
      showToast('แต้มสะสมของคุณไม่เพียงพอ', 'warning');
      return;
    }

    // Deduct points
    updatePoints(-item.cost);

    // Record Transaction
    addTransaction({
      id: 'RW-' + Math.floor(10000 + Math.random() * 90000),
      date: new Date().toLocaleString('th-TH'),
      type: 'แลกของรางวัล',
      summary: item.title,
      weight: 0,
      money: 0,
      points: -item.cost,
      status: 'แลกสำเร็จ'
    });

    showToast(`แลกรับ "${item.title}" สำเร็จแล้ว!`, 'success');
    refreshAllUI();
  };
}

export function renderHistoryTable() {
  const dashList = document.getElementById('dashboard-history-list');
  const fullTbody = document.getElementById('full-history-tbody');

  const store = getStore();
  const list = store.transactions || [];

  // 1. Dashboard short list
  if (dashList) {
    if (list.length === 0) {
      dashList.innerHTML = `<p class="subtitle" style="padding: 16px; text-align:center;">ยังไม่มีประวัติการสะสมแต้ม</p>`;
    } else {
      dashList.innerHTML = list.slice(0, 5).map(tx => {
        const isEarned = tx.points > 0;
        const ptsClass = isEarned ? 'text-points' : 'subtitle';
        const ptsSign = isEarned ? '+' : '';

        return `
          <div class="detail-row" style="padding: 10px 0;">
            <div>
              <strong>${tx.type}</strong>
              <div class="subtitle" style="font-size:0.775rem;">${tx.date} • ${tx.summary}</div>
            </div>
            <div style="text-align:right;">
              <span class="${ptsClass}" style="font-weight:700;">${ptsSign}${tx.points} แต้ม</span>
              ${tx.money ? `<div class="subtitle">${tx.money} ฿</div>` : ''}
            </div>
          </div>
        `;
      }).join('');
    }
  }

  // 2. Full History Table
  if (fullTbody) {
    if (list.length === 0) {
      fullTbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding: 20px;">ไม่มีข้อมูลประวัติ</td></tr>`;
    } else {
      fullTbody.innerHTML = list.map(tx => {
        const isEarn = tx.points > 0;
        const ptsBadge = isEarn ? 
          `<span style="color:#34d399; font-weight:700;">+${tx.points}</span>` : 
          `<span style="color:#f43f5e; font-weight:700;">${tx.points}</span>`;

        return `
          <tr>
            <td>${tx.date}</td>
            <td><strong>${tx.type}</strong></td>
            <td>${tx.summary}</td>
            <td style="color:#fbbf24; font-weight:600;">${tx.money ? tx.money + ' ฿' : '-'}</td>
            <td>${ptsBadge}</td>
            <td><span class="rate-badge">${tx.status || 'สำเร็จ'}</span></td>
          </tr>
        `;
      }).join('');
    }
  }
}

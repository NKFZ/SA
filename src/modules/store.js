/* ==========================================================================
   State & LocalStorage Management (store.js)
   ========================================================================== */

const STORE_KEY = 'ECO_RECYCLE_APP_DATA_V1';

const INITIAL_STORE = {
  user: {
    points: 1250,
    totalEarnedMoney: 385,
    totalWeightKg: 26.8,
    co2ReducedKg: 48.5,
    level: 3,
    role: 'user' // 'user' or 'staff'
  },
  transactions: [
    {
      id: 'TX-98401',
      date: '2026-07-22 14:30',
      type: 'ขายขยะรีไซเคิล',
      summary: 'พลาสติก 4.5kg, กระดาษ 10.0kg',
      weight: 14.5,
      money: 114,
      points: 525,
      status: 'สำเร็จ'
    },
    {
      id: 'TX-98219',
      date: '2026-07-18 10:15',
      type: 'ขายขยะรีไซเคิล',
      summary: 'ขวดแก้ว 8.0kg, กระป๋องอลูมิเนียม 2.0kg',
      weight: 10.0,
      money: 94,
      points: 320,
      status: 'สำเร็จ'
    },
    {
      id: 'RW-44102',
      date: '2026-07-15 16:20',
      type: 'แลกของรางวัล',
      summary: 'คูปองส่วนลด Lotus 50 บาท',
      weight: 0,
      money: 0,
      points: -500,
      status: 'แลกสำเร็จ'
    }
  ],
  pickupRequests: [
    {
      id: 'REQ-1082',
      address: '123/45 หมู่บ้านพฤกษา ซอย 8 ถ.สุขุมวิท กรุงเทพฯ',
      phone: '089-765-4321',
      date: '2026-07-23',
      wasteTypes: ['พลาสติก', 'กระดาษ'],
      estWeight: '5 - 15 kg',
      status: 'pending', // pending, assigned, completed
      createdAt: '2026-07-22 18:00'
    }
  ]
};

export function getStore() {
  const data = localStorage.getItem(STORE_KEY);
  if (!data) {
    saveStore(INITIAL_STORE);
    return INITIAL_STORE;
  }
  try {
    return JSON.parse(data);
  } catch (e) {
    console.error('Error parsing stored data:', e);
    return INITIAL_STORE;
  }
}

export function saveStore(store) {
  localStorage.setItem(STORE_KEY, JSON.stringify(store));
}

export function updatePoints(pointsDelta, moneyDelta = 0, weightDelta = 0) {
  const store = getStore();
  store.user.points += pointsDelta;
  store.user.totalEarnedMoney += moneyDelta;
  store.user.totalWeightKg += weightDelta;
  store.user.co2ReducedKg += +(weightDelta * 1.8).toFixed(1);
  
  // Recalculate level
  if (store.user.points >= 3000) store.user.level = 5;
  else if (store.user.points >= 2000) store.user.level = 4;
  else if (store.user.points >= 1000) store.user.level = 3;
  else if (store.user.points >= 500) store.user.level = 2;
  else store.user.level = 1;

  saveStore(store);
  return store.user;
}

export function addTransaction(tx) {
  const store = getStore();
  store.transactions.unshift(tx);
  saveStore(store);
}

export function addPickupRequest(req) {
  const store = getStore();
  store.pickupRequests.unshift(req);
  saveStore(store);
}

export function updatePickupStatus(reqId, newStatus) {
  const store = getStore();
  const item = store.pickupRequests.find(r => r.id === reqId);
  if (item) {
    item.status = newStatus;
    saveStore(store);
  }
}

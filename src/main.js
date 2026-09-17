/* ==========================================================================
   Main App Entry Point with SuperTrash Database Integration & Login (main.js)
   ========================================================================== */

import { createIcons, icons } from 'lucide';
import QRCode from 'qrcode';
import confetti from 'canvas-confetti';
import { initScannerModule } from './modules/scanner.js';

// State Management (Session + DB Sync)
let currentRole = localStorage.getItem('ECO_CURRENT_ROLE') || 'seller'; // 'seller', 'employee', or 'admin'
let currentUser = null; // { user_id, username, name, points, phone }
let currentStaff = null; // { staff_id, staff_name, phone }
let currentAdmin = null; // { admin_id, admin_name }
let activeRates = { recycle: 50, organic: 30, general: 20, hazardous: 80 }; // Live waste rates from DB
let currentEmployeePayload = null;
let qrTimerInterval = null;
let pendingLoginRole = 'seller';
let rewardsCurrentPage = 1; // ข้อ 9: หน้าปัจจุบันของของรางวัล (6 ชิ้นต่อหน้า)
const REWARDS_PER_PAGE = 6;

document.addEventListener('DOMContentLoaded', () => {
  initApp();
});

async function initApp() {
  createIcons({ icons });

  // Setup Navigation Tabs & Role Switcher Buttons
  setupRoleSwitcher();
  setupNavTabs();

  // Setup Scanner & Event Handlers
  initScannerModule(showToast, refreshAllUI);
  setupEmployeeFormEvents();
  setupSellerPickupForm();
  setupLoginModalEvents();

  // Auto load existing session or show login
  const savedUserId = localStorage.getItem('ECO_USER_ID');
  const savedStaffId = localStorage.getItem('ECO_STAFF_ID');
  const savedAdminName = localStorage.getItem('ECO_ADMIN_NAME');

  if (currentRole === 'seller' && savedUserId) {
    await fetchUserById(savedUserId);
  } else if (currentRole === 'employee' && savedStaffId) {
    await fetchStaffById(savedStaffId);
  } else if (currentRole === 'admin' && savedAdminName) {
    currentAdmin = { admin_name: savedAdminName };
  } else {
    // If no user session, try default user or show login
    await fetchUserById(1);
    await fetchStaffById(1);
  }

  // If first time visit and no user saved, prompt login modal
  if (!savedUserId && !savedStaffId && !savedAdminName) {
    openLoginModal();
  }

  // Fetch rates first
  await loadWasteRates();

  switchRole(currentRole, false);
  await refreshAllUI();
}

/* ==========================================================================
   Simple Login Flow (ข้อ 2: เลือกว่าฝั่งไหน + กรอกชื่อ)
   ========================================================================== */
function setupLoginModalEvents() {
  const btnOpenLogin = document.getElementById('btn-open-login');
  if (btnOpenLogin) {
    btnOpenLogin.addEventListener('click', () => {
      openLoginModal();
    });
  }

  window.switchAuthTab = (tab) => {
    const tabLogin = document.getElementById('tab-btn-login');
    const tabRegister = document.getElementById('tab-btn-register');
    const formLogin = document.getElementById('auth-login-form');
    const formRegister = document.getElementById('auth-register-form');
    const title = document.getElementById('auth-modal-title');

    if (tab === 'login') {
      tabLogin?.classList.add('active');
      tabRegister?.classList.remove('active');
      if (tabLogin) {
        tabLogin.style.borderBottom = '3px solid var(--emerald-green)';
        tabLogin.style.color = 'var(--emerald-green)';
      }
      if (tabRegister) {
        tabRegister.style.borderBottom = '3px solid transparent';
        tabRegister.style.color = 'var(--text-muted)';
      }
      if (formLogin) formLogin.style.display = 'block';
      if (formRegister) formRegister.style.display = 'none';
      if (title) title.textContent = 'เข้าสู่ระบบ EcoRecycle';
    } else {
      tabRegister?.classList.add('active');
      tabLogin?.classList.remove('active');
      if (tabRegister) {
        tabRegister.style.borderBottom = '3px solid var(--emerald-green)';
        tabRegister.style.color = 'var(--emerald-green)';
      }
      if (tabLogin) {
        tabLogin.style.borderBottom = '3px solid transparent';
        tabLogin.style.color = 'var(--text-muted)';
      }
      if (formRegister) formRegister.style.display = 'block';
      if (formLogin) formLogin.style.display = 'none';
      if (title) title.textContent = 'สมัครสมาชิก EcoRecycle';
      const roleRadio = document.querySelector('input[name="reg-role"]:checked');
      window.handleRegRoleChange(roleRadio ? roleRadio.value : 'seller');
    }
    createIcons({ icons });
  };

  // ข้อ 33: หน้า register ของ staff ไม่ต้องใส่ที่อยู่
  window.handleRegRoleChange = (role) => {
    const addrGroup = document.getElementById('reg-group-address');
    const addrInput = document.getElementById('reg-input-address');
    if (!addrGroup || !addrInput) return;

    if (role === 'staff') {
      addrGroup.style.display = 'none';
      addrInput.removeAttribute('required');
      addrInput.value = '';
    } else {
      addrGroup.style.display = 'block';
      addrInput.setAttribute('required', 'required');
    }
  };

  window.openLoginModal = (tab = 'login') => {
    const overlay = document.getElementById('login-modal-overlay');
    if (overlay) overlay.classList.remove('hidden');
    window.switchAuthTab(tab);
    createIcons({ icons });
  };

  window.closeLoginModal = () => {
    const overlay = document.getElementById('login-modal-overlay');
    if (overlay) overlay.classList.add('hidden');
  };

  window.handleAuthLoginSubmit = async (e) => {
    e.preventDefault();
    const usernameInput = document.getElementById('login-input-username')?.value.trim();
    const passwordInput = document.getElementById('login-input-password')?.value.trim();

    if (!usernameInput || !passwordInput) {
      showToast('กรุณากรอกชื่อผู้ใช้และรหัสผ่าน', 'warning');
      return;
    }

    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: usernameInput, password: passwordInput })
      });
      const data = await res.json();

      if (!res.ok) {
        showToast(data.error || 'เข้าสู่ระบบไม่สำเร็จ', 'error');
        return;
      }

      if (data.role === 'admin') {
        currentAdmin = data.admin || { admin_name: 'admin' };
        localStorage.setItem('ECO_ADMIN_AUTH', 'true');
        localStorage.setItem('ECO_ADMIN_NAME', currentAdmin.admin_name);
        localStorage.removeItem('ECO_USER_ID');
        localStorage.removeItem('ECO_STAFF_ID');
        localStorage.setItem('ECO_CURRENT_ROLE', 'admin');
        switchRole('admin', false);
        closeLoginModal();
        showToast(`เข้าสู่ระบบผู้ดูแลระบบ: ${currentAdmin.admin_name}`, 'success');
        await refreshAllUI();
      } else if (data.role === 'seller') {
        currentUser = data.user;
        localStorage.setItem('ECO_USER_ID', currentUser.user_id);
        localStorage.removeItem('ECO_STAFF_ID');
        localStorage.removeItem('ECO_ADMIN_NAME');
        localStorage.removeItem('ECO_ADMIN_AUTH');
        localStorage.setItem('ECO_CURRENT_ROLE', 'seller');
        switchRole('seller', false);
        closeLoginModal();
        showToast(`ยินดีต้อนรับคุณ ${currentUser.name || currentUser.username}!`, 'success');
        await refreshAllUI();
      } else if (data.role === 'staff') {
        currentStaff = data.staff;
        localStorage.setItem('ECO_STAFF_ID', currentStaff.staff_id);
        localStorage.removeItem('ECO_USER_ID');
        localStorage.removeItem('ECO_ADMIN_NAME');
        localStorage.removeItem('ECO_ADMIN_AUTH');
        localStorage.setItem('ECO_CURRENT_ROLE', 'employee');
        switchRole('employee', false);
        closeLoginModal();
        showToast(`เข้าสู่ระบบพนักงาน: ${currentStaff.staff_name}`, 'success');
        await refreshAllUI();
      }
    } catch (err) {
      console.error('Login error:', err);
      showToast('เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์', 'error');
    }
  };

  window.handleAuthRegisterSubmit = async (e) => {
    e.preventDefault();
    const email = document.getElementById('reg-input-email')?.value.trim();
    const username = document.getElementById('reg-input-username')?.value.trim();
    const phone = document.getElementById('reg-input-phone')?.value.trim();
    const address = document.getElementById('reg-input-address')?.value.trim();
    const password = document.getElementById('reg-input-password')?.value.trim();
    const roleRadio = document.querySelector('input[name="reg-role"]:checked');
    const role = roleRadio ? roleRadio.value : 'seller';

    // ข้อ 33: ถ้าเป็น staff ไม่ต้องกรอกที่อยู่
    if (role === 'seller') {
      if (!email || !username || !phone || !address || !password) {
        showToast('กรุณากรอกข้อมูลให้ครบถ้วนทุกช่อง (รวมที่อยู่)', 'warning');
        return;
      }
    } else {
      if (!email || !username || !phone || !password) {
        showToast('กรุณากรอกข้อมูลให้ครบถ้วน (อีเมล, ชื่อผู้ใช้งาน, เบอร์โทรศัพท์, รหัสผ่าน)', 'warning');
        return;
      }
    }

    if (username.toLowerCase() === 'admin') {
      showToast('ไม่อนุญาตให้ใช้ชื่อผู้ใช้งาน admin', 'error');
      return;
    }

    try {
      const res = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, username, phone, address, password, role })
      });
      const data = await res.json();

      if (!res.ok) {
        showToast(data.error || 'สมัครสมาชิกไม่สำเร็จ', 'error');
        return;
      }

      showToast(`🎉 สมัครสมาชิกสำเร็จ! เข้าสู่ระบบในฐานะ ${role === 'seller' ? 'คนขายขยะ (Seller)' : 'พนักงาน (Staff)'}`, 'success');

      if (role === 'seller' && data.user) {
        currentUser = data.user;
        localStorage.setItem('ECO_USER_ID', currentUser.user_id);
        localStorage.removeItem('ECO_STAFF_ID');
        localStorage.removeItem('ECO_ADMIN_NAME');
        localStorage.removeItem('ECO_ADMIN_AUTH');
        localStorage.setItem('ECO_CURRENT_ROLE', 'seller');
        switchRole('seller', false);
        closeLoginModal();
        await refreshAllUI();
      } else if (role === 'staff' && data.staff) {
        currentStaff = data.staff;
        localStorage.setItem('ECO_STAFF_ID', currentStaff.staff_id);
        localStorage.removeItem('ECO_USER_ID');
        localStorage.removeItem('ECO_ADMIN_NAME');
        localStorage.removeItem('ECO_ADMIN_AUTH');
        localStorage.setItem('ECO_CURRENT_ROLE', 'employee');
        switchRole('employee', false);
        closeLoginModal();
        await refreshAllUI();
      }
    } catch (err) {
      console.error('Register error:', err);
      showToast('เกิดข้อผิดพลาดในการลงทะเบียน', 'error');
    }
  };
}

async function fetchUserById(userId) {
  try {
    const res = await fetch(`/api/user/${userId}`);
    if (res.ok) {
      const data = await res.json();
      currentUser = data.user;
      localStorage.setItem('ECO_USER_ID', currentUser.user_id);
    }
  } catch (e) {
    console.error('Error fetching user:', e);
  }
}

async function fetchStaffById(staffId) {
  try {
    const res = await fetch('/api/staffs');
    if (res.ok) {
      const data = await res.json();
      currentStaff = data.staffs.find(s => s.staff_id == staffId) || data.staffs[0];
      if (currentStaff) {
        localStorage.setItem('ECO_STAFF_ID', currentStaff.staff_id);
      }
    }
  } catch (e) {
    console.error('Error fetching staff:', e);
  }
}

/* ==========================================================================
   Role Switcher (รองรับ 3 บทบาท: Seller, Employee, Admin)
   ========================================================================== */
function setupRoleSwitcher() {
  const btnSeller = document.getElementById('btn-role-seller');
  const btnEmployee = document.getElementById('btn-role-employee');
  const btnAdmin = document.getElementById('btn-role-admin');

  if (btnSeller) {
    btnSeller.addEventListener('click', () => switchRole('seller'));
  }
  if (btnEmployee) {
    btnEmployee.addEventListener('click', () => switchRole('employee'));
  }
  if (btnAdmin) {
    btnAdmin.addEventListener('click', () => {
      const isAuth = localStorage.getItem('ECO_ADMIN_AUTH') === 'true';
      if (!isAuth || !currentAdmin || currentAdmin.admin_name.toLowerCase() !== 'admin') {
        showToast('กรุณากรอกชื่อผู้ใช้และรหัสผ่านเพื่อเข้าสู่ระบบผู้ดูแลระบบ', 'info');
        openLoginModal('login');
        return;
      }
      switchRole('admin');
    });
  }

  window.switchRole = switchRole;
}

function switchRole(role, notify = true) {
  currentRole = role;
  localStorage.setItem('ECO_CURRENT_ROLE', role);

  const btnSeller = document.getElementById('btn-role-seller');
  const btnEmployee = document.getElementById('btn-role-employee');
  const btnAdmin = document.getElementById('btn-role-admin');
  const roleBadge = document.getElementById('header-role-badge');
  const pointsStrip = document.getElementById('user-points-strip-bar');
  
  const navSellerGroup = document.getElementById('nav-group-seller');
  const navEmployeeGroup = document.getElementById('nav-group-employee');
  const navAdminGroup = document.getElementById('nav-group-admin');

  btnSeller?.classList.remove('active');
  btnEmployee?.classList.remove('active');
  btnAdmin?.classList.remove('active');

  if (role === 'seller') {
    btnSeller?.classList.add('active');
    if (roleBadge) roleBadge.textContent = ': SELLER';

    // SHOW POINTS STRIP ONLY FOR SELLER
    if (pointsStrip) pointsStrip.style.display = 'flex';

    if (navSellerGroup) navSellerGroup.style.display = 'flex';
    if (navEmployeeGroup) navEmployeeGroup.style.display = 'none';
    if (navAdminGroup) navAdminGroup.style.display = 'none';

    switchView('view-seller-home');
  } else if (role === 'employee') {
    btnEmployee?.classList.add('active');
    if (roleBadge) roleBadge.textContent = ': EMPLOYEE';

    // HIDE POINTS STRIP FOR STAFF
    if (pointsStrip) pointsStrip.style.display = 'none';

    if (navEmployeeGroup) navEmployeeGroup.style.display = 'flex';
    if (navSellerGroup) navSellerGroup.style.display = 'none';
    if (navAdminGroup) navAdminGroup.style.display = 'none';

    switchView('view-employee-home');
  } else if (role === 'admin') {
    btnAdmin?.classList.add('active');
    if (roleBadge) roleBadge.textContent = ': ADMIN';

    // HIDE POINTS STRIP FOR ADMIN
    if (pointsStrip) pointsStrip.style.display = 'none';

    if (navAdminGroup) navAdminGroup.style.display = 'flex';
    if (navSellerGroup) navSellerGroup.style.display = 'none';
    if (navEmployeeGroup) navEmployeeGroup.style.display = 'none';

    switchView('view-admin-dashboard');
    loadAdminDashboardData();
  }

  if (notify) {
    let roleThai = 'คนขายขยะ (Seller)';
    if (role === 'employee') roleThai = 'พนักงาน (Employee)';
    if (role === 'admin') roleThai = 'ผู้ดูแลระบบ (Admin)';
    showToast(`สลับโหมดเป็น: ${roleThai}`, 'info');
  }

  createIcons({ icons });
}

/* ==========================================================================
   Navigation Views
   ========================================================================== */
function setupNavTabs() {
  const navButtons = document.querySelectorAll('.nav-tab-item');
  navButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetView = btn.getAttribute('data-target');
      if (targetView) switchView(targetView);
    });
  });

  window.switchView = switchView;
}

function switchView(viewId) {
  document.querySelectorAll('.view-section').forEach(sec => sec.classList.remove('active'));
  
  const targetSection = document.getElementById(viewId);
  if (targetSection) {
    targetSection.classList.add('active');
  }

  document.querySelectorAll('.nav-tab-item').forEach(btn => {
    if (btn.getAttribute('data-target') === viewId) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  if (viewId === 'view-seller-queue') {
    loadSellerQueueStatus();
  } else if (viewId === 'view-employee-queue') {
    loadPickupQueue();
  } else if (viewId === 'view-seller-home') {
    loadUserSalesHistory();
  } else if (viewId === 'view-employee-history') {
    loadStaffSalesHistory();
  } else if (viewId === 'view-employee-form') {
    if (window.ensureServingCustomerDisplay) window.ensureServingCustomerDisplay();
  } else if (viewId === 'view-seller-profile' && currentUser) {
    const profileAddr = document.getElementById('profile-input-address');
    const profilePhone = document.getElementById('profile-input-phone');
    if (profileAddr && !profileAddr.value && currentUser.address) profileAddr.value = currentUser.address;
    if (profilePhone && !profilePhone.value && currentUser.phone) profilePhone.value = currentUser.phone;
  }

  window.scrollTo({ top: 0, behavior: 'smooth' });
  createIcons({ icons });
}

/* ==========================================================================
   Employee Logic (Form, Evaluation, QR Code)
   ========================================================================== */
function setupEmployeeFormEvents() {
  let servingReportPollInterval = null;

  function stopServingReportPolling() {
    if (servingReportPollInterval) {
      clearInterval(servingReportPollInterval);
      servingReportPollInterval = null;
    }
  }

  async function checkServingReportStatus() {
    if (!window.currentServingReportId) {
      stopServingReportPolling();
      return;
    }

    try {
      const res = await fetch(`/api/pickup/status/${window.currentServingReportId}`);
      if (!res.ok) return;
      const data = await res.json();
      const rep = data.report;
      if (!rep) return;

      const decisionText = document.getElementById('emp-customer-decision-status');
      const confirmBtn = document.getElementById('btn-emp-direct-confirm');

      if (rep.seller_decision === 'accepted' || rep.status === 'Seller Accepted') {
        if (decisionText) {
          decisionText.innerHTML = '<span style="color:var(--emerald-green);">✅ ลูกค้าสแกนและ "ยืนยันรับแต้มแล้ว" เรียบร้อยแล้ว!</span>';
        }
        if (confirmBtn) {
          confirmBtn.disabled = false;
          confirmBtn.style.opacity = '1';
          confirmBtn.style.cursor = 'pointer';
        }
      } else if (rep.seller_decision === 'rejected' || rep.status === 'Seller Rejected') {
        if (decisionText) {
          decisionText.innerHTML = '<span style="color:#ef4444;">❌ ลูกค้าสแกนและ "ปฏิเสธแต้ม" (Reject)</span>';
        }
        if (confirmBtn) {
          confirmBtn.disabled = false;
          confirmBtn.style.opacity = '1';
          confirmBtn.style.cursor = 'pointer';
        }
      } else {
        if (decisionText) {
          decisionText.innerHTML = '<span style="color:var(--amber-orange);">⏳ รอลูกค้าสแกน QR Code และกดยืนยันรับหรือปฏิเสธแต้ม...</span>';
        }
        if (confirmBtn) {
          confirmBtn.disabled = true;
          confirmBtn.style.opacity = '0.6';
          confirmBtn.style.cursor = 'not-allowed';
        }
      }
    } catch (e) {
      console.warn('Error checking serving report status:', e);
    }
  }

  window.resetEmployeeForm = () => {
    ['recycle', 'organic', 'general', 'hazardous'].forEach(type => {
      const chk = document.getElementById(`chk-emp-${type}`);
      const input = document.getElementById(`emp-input-${type}`);
      if (chk) chk.checked = false;
      if (input) {
        input.value = '';
        input.disabled = true;
        input.style.opacity = '0.5';
        input.style.cursor = 'not-allowed';
      }
    });
    calcEmpTotals();
  };

  window.toggleWasteType = (type) => {
    const chk = document.getElementById(`chk-emp-${type}`);
    const input = document.getElementById(`emp-input-${type}`);
    if (!chk || !input) return;

    if (chk.checked) {
      input.disabled = false;
      input.style.opacity = '1';
      input.style.cursor = 'text';
      input.focus();
    } else {
      input.value = '';
      input.disabled = true;
      input.style.opacity = '0.5';
      input.style.cursor = 'not-allowed';
    }
    calcEmpTotals();
  };

  window.ensureServingCustomerDisplay = async () => {
    const label = document.getElementById('form-customer-name-display');
    if (!label) return;

    try {
      const res = await fetch('/api/pickup');
      const data = await res.json();
      const reports = data.reports || [];
      const waitingReports = reports.filter(r => r.status === 'Waiting');
      waitingReports.sort((a, b) => a.report_id - b.report_id);

      // ถ้ามี currentServingReportId ตรวจสอบว่าคิวนั้นยังเป็น Waiting อยู่หรือไม่
      let stillValid = null;
      if (window.currentServingReportId) {
        stillValid = waitingReports.find(r => Number(r.report_id) === Number(window.currentServingReportId));
      }

      let assigned = stillValid;
      if (!assigned) {
        if (currentStaff && currentStaff.staff_id) {
          assigned = waitingReports.find(r => Number(r.staff_id) === Number(currentStaff.staff_id));
        } else if (!currentStaff && waitingReports.length > 0) {
          assigned = waitingReports[0];
        }
      }

      if (assigned) {
        window.currentServingUserId = assigned.user_id || 1;
        window.currentServingUserName = assigned.user_name || 'ลูกค้าทั่วไป';
        window.currentServingReportId = assigned.report_id;
        window.currentServingLocation = assigned.location_name || '';
        label.textContent = `${assigned.user_name || 'ลูกค้าทั่วไป'} (User #${assigned.user_id || 1}) - คิวคำขอ #${assigned.report_id}`;
      } else {
        window.currentServingUserId = null;
        window.currentServingUserName = null;
        window.currentServingReportId = null;
        window.currentServingLocation = null;
        label.textContent = 'ไม่มีคิวที่กำลังให้บริการ (พนักงานยังไม่มีคิวงานที่ต้องทำ)';
      }
    } catch (e) {
      window.currentServingReportId = null;
      label.textContent = 'ไม่มีคิวที่กำลังให้บริการ';
    }

    calcEmpTotals();
  };

  window.employeeGoToLocation = (reportId, name, userId, locName) => {
    const label = document.getElementById('form-customer-name-display');
    if (label) label.textContent = `${name} (User #${userId || 1}) - คิวคำขอ #${reportId}`;
    window.currentServingUserId = userId || 1;
    window.currentServingUserName = name || 'ลูกค้า';
    window.currentServingReportId = reportId || null;
    window.currentServingLocation = locName || null;

    // รีเซ็ตฟอร์มขยะให้ว่างเปล่าสำหรับลูกค้ารายใหม่
    window.resetEmployeeForm();

    // รีเซ็ตสถานะปุ่มยืนยันให้ disabled ไว้ก่อน (ข้อ 22)
    const confirmBtn = document.getElementById('btn-emp-direct-confirm');
    if (confirmBtn) {
      confirmBtn.disabled = true;
      confirmBtn.style.opacity = '0.6';
      confirmBtn.style.cursor = 'not-allowed';
    }
    const decisionText = document.getElementById('emp-customer-decision-status');
    if (decisionText) {
      decisionText.innerHTML = '<span style="color:var(--amber-orange);">⏳ รอลูกค้าสแกน QR Code และกดยืนยันรับหรือปฏิเสธแต้ม...</span>';
    }

    switchView('view-employee-form');
    calcEmpTotals();

    // เริ่ม Polling เช็คผลการสแกนของลูกค้า (ทุก 2 วินาที)
    stopServingReportPolling();
    servingReportPollInterval = setInterval(checkServingReportStatus, 2000);
    checkServingReportStatus();

    showToast(`กำลังรับซื้อขยะให้ลูกค้า ${name} (คำขอ #${reportId})`, 'info');
  };

  window.handleDirectConfirmQueue = async () => {
    if (!window.currentServingReportId) {
      showToast('ไม่พบคิวที่กำลังให้บริการอยู่ หรือคิวนี้ได้รับการยืนยันแล้ว', 'warning');
      return;
    }
    const reportIdToConfirm = window.currentServingReportId;
    try {
      const res = await fetch('/api/pickup/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reportId: reportIdToConfirm,
          staffId: currentStaff ? currentStaff.staff_id : 1
        })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showToast(`✅ ยืนยันคิว #${reportIdToConfirm} เสร็จสิ้นแล้ว ปลดล็อคคิวถัดไปเรียบร้อย`, 'success');
        window.currentServingReportId = null;
        window.currentServingUserId = null;
        window.currentServingUserName = null;
        window.currentServingLocation = null;
        stopServingReportPolling();
        calcEmpTotals();
        await loadPickupQueue();
        switchView('view-employee-home');
      } else {
        showToast(data.error || 'ไม่สามารถยืนยันคิวได้', 'error');
      }
    } catch (err) {
      console.error('Direct confirm error:', err);
      showToast('เกิดข้อผิดพลาดในการยืนยันคิว', 'error');
    }
  };

  window.calcEmpTotals = calcEmpTotals;

  const btnGenerateQR = document.getElementById('btn-emp-generate-qr');
  if (btnGenerateQR) {
    btnGenerateQR.addEventListener('click', generateEmployeeQR);
  }

}

// ข้อ 3: คำนวณเฉพาะแต้มสะสมเท่านั้น (ไม่มีเงิน) - ใช้ตัวคูณขยะ activeRates จากฐานข้อมูล
function calcEmpTotals() {
  const chkRecycle = document.getElementById('chk-emp-recycle')?.checked;
  const chkOrganic = document.getElementById('chk-emp-organic')?.checked;
  const chkGeneral = document.getElementById('chk-emp-general')?.checked;
  const chkHazardous = document.getElementById('chk-emp-hazardous')?.checked;

  const recycleKg = chkRecycle ? (parseFloat(document.getElementById('emp-input-recycle')?.value) || 0) : 0;
  const organicKg = chkOrganic ? (parseFloat(document.getElementById('emp-input-organic')?.value) || 0) : 0;
  const generalBags = chkGeneral ? (parseFloat(document.getElementById('emp-input-general')?.value) || 0) : 0;
  const hazardousItems = chkHazardous ? (parseFloat(document.getElementById('emp-input-hazardous')?.value) || 0) : 0;

  // คำนวณน้ำหนักเทียบเท่า (กิโลกรัม)
  const generalKg = +(generalBags * 1.5).toFixed(1);
  const hazardousKg = +(hazardousItems * 0.5).toFixed(1);
  const totalWeight = +(recycleKg + organicKg + generalKg + hazardousKg).toFixed(1);

  const rateRecycle = activeRates.recycle || 50;
  const rateOrganic = activeRates.organic || 30;
  const rateGeneral = activeRates.general || 20;
  const rateHazardous = activeRates.hazardous || 80;

  const totalPoints = Math.round(
    (recycleKg * rateRecycle) + (organicKg * rateOrganic) + (generalBags * rateGeneral) + (hazardousItems * rateHazardous)
  );

  const scoreEl = document.getElementById('emp-total-score-display');
  if (scoreEl) scoreEl.textContent = `${totalPoints} แต้ม`;

  // ข้อ 31: ถ้า staff ไม่ได้มีคิวอยู่ จะไม่สามารถกดสร้าง qr code ได้
  const btnGenQR = document.getElementById('btn-emp-generate-qr');
  const hasChecked = !!(chkRecycle || chkOrganic || chkGeneral || chkHazardous);
  const hasWeight = totalPoints > 0;
  const hasQueue = !!window.currentServingReportId;

  if (btnGenQR) {
    if (hasChecked && hasWeight && hasQueue) {
      btnGenQR.disabled = false;
      btnGenQR.style.opacity = '1';
      btnGenQR.style.cursor = 'pointer';
      btnGenQR.title = 'คลิกเพื่อสร้าง QR Code รับแต้ม';
    } else {
      btnGenQR.disabled = true;
      btnGenQR.style.opacity = '0.5';
      btnGenQR.style.cursor = 'not-allowed';
      if (!hasQueue) {
        btnGenQR.title = 'พนักงานยังไม่มีคิวลูกค้าที่กำลังให้บริการ ไม่สามารถสร้าง QR Code ได้';
      } else if (!hasChecked) {
        btnGenQR.title = 'กรุณาติ๊กเลือกประเภทขยะก่อนสร้าง QR Code';
      } else {
        btnGenQR.title = 'กรุณาระบุน้ำหนักขยะก่อนสร้าง QR Code';
      }
    }
  }

  return { recycleKg, organicKg, generalBags, generalKg, hazardousItems, hazardousKg, totalPoints, totalWeight, hasChecked, hasWeight, hasQueue };
}

function generateEmployeeQR() {
  const totals = calcEmpTotals();

  // ข้อ 31: ถ้า staff ไม่ได้มีคิวอยู่ จะไม่สามารถกดสร้าง qr code ได้
  if (!window.currentServingReportId || !totals.hasQueue) {
    showToast('คุณยังไม่มีคิวลูกค้าที่กำลังให้บริการ ไม่สามารถสร้าง QR Code ได้', 'warning');
    return;
  }

  if (!totals.hasChecked) {
    showToast('กรุณาติ๊กเลือกประเภทขยะที่ seller นำมาขายอย่างน้อย 1 ประเภท', 'warning');
    return;
  }

  if (totals.totalPoints <= 0) {
    showToast('กรุณาระบุน้ำหนักหรือจำนวนขยะให้มากกว่า 0', 'warning');
    return;
  }

  const txId = 'TX-' + Math.floor(10000 + Math.random() * 90000);
  const summaryParts = [];
  if (totals.recycleKg > 0) summaryParts.push(`Recycle ${totals.recycleKg}kg`);
  if (totals.organicKg > 0) summaryParts.push(`Organic ${totals.organicKg}kg`);
  if (totals.generalBags > 0) summaryParts.push(`General ${totals.generalBags}ถุง (${totals.generalKg}kg)`);
  if (totals.hazardousItems > 0) summaryParts.push(`Hazardous ${totals.hazardousItems}ชิ้น (${totals.hazardousKg}kg)`);

  const assignedUserId = window.currentServingUserId || (currentUser ? currentUser.user_id : 1);
  const assignedUserName = window.currentServingUserName || (currentUser ? (currentUser.name || currentUser.username) : 'ลูกค้า');

  // Payload: เฉพาะแต้มและน้ำหนักขยะ (ข้อ 12: แนบ targetUserId ป้องกันคนอื่นสแกนรับแทน)
  currentEmployeePayload = {
    type: 'ECO_RECYCLE_POINTS',
    id: txId,
    targetUserId: assignedUserId,
    targetUserName: assignedUserName,
    reportId: window.currentServingReportId || null,
    points: totals.totalPoints,
    totalWeight: totals.totalWeight,
    recycleKg: totals.recycleKg,
    organicKg: totals.organicKg,
    generalKg: totals.generalKg,
    hazardousKg: totals.hazardousKg,
    summary: summaryParts.join(', '),
    collectorName: currentStaff ? currentStaff.staff_name : 'สมชาย เก็บขยะ (EMP-8821)',
    location: window.currentServingLocation || 'จุดบริการรับซื้อขยะเคลื่อนที่ (กรุงเทพฯ)',
    staffId: currentStaff ? currentStaff.staff_id : 1,
    timestamp: Date.now()
  };

  const canvasEl = document.getElementById('generated-qr-canvas');
  const idEl = document.getElementById('generated-qr-code-id');

  if (canvasEl) {
    QRCode.toCanvas(canvasEl, JSON.stringify(currentEmployeePayload), {
      width: 220,
      margin: 2,
      color: { dark: '#001f3f', light: '#ffffff' }
    }, (error) => {
      if (error) {
        showToast('เกิดข้อผิดพลาดในการสร้าง QR Code', 'error');
        return;
      }
      if (idEl) idEl.textContent = `${txId} | สำหรับ: ${assignedUserName} (#${assignedUserId}) | ${totals.totalPoints} แต้ม`;
      
      switchView('view-employee-qr');
      startQRTimer();
      showToast(`สร้าง QR Code สำเร็จ! สำหรับคุณ ${assignedUserName} (${totals.totalPoints} แต้ม)`, 'success');
    });
  }
}

function startQRTimer() {
  if (qrTimerInterval) clearInterval(qrTimerInterval);
  let seconds = 300; // 5 minutes timer
  const timerTextEl = document.getElementById('emp-qr-timer-text');

  qrTimerInterval = setInterval(() => {
    seconds--;
    if (seconds <= 0) {
      clearInterval(qrTimerInterval);
      if (timerTextEl) timerTextEl.textContent = 'หมดอายุแล้ว (Expired)';
      return;
    }
    const mins = String(Math.floor(seconds / 60)).padStart(2, '0');
    const secs = String(seconds % 60).padStart(2, '0');
    if (timerTextEl) timerTextEl.textContent = `${mins}min ${secs}s`;
  }, 1000);
}

/* ==========================================================================
   Seller Logic (Pickup Reports & Redemptions from DB)
   ========================================================================== */
function setupSellerPickupForm() {
  // บันทึกที่อยู่เริ่มต้นจากฟอร์มเรียกรถ (ข้อ 14)
  window.saveUserAddressFromForm = async () => {
    if (!currentUser || !currentUser.user_id) return;
    const address = document.getElementById('input-pickup-address')?.value;
    const phone = document.getElementById('input-pickup-phone')?.value;
    if (!address || !address.trim()) {
      showToast('กรุณากรอกที่อยู่ก่อนกดบันทึก', 'warning');
      return;
    }

    try {
      const res = await fetch('/api/user/address', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: currentUser.user_id, address: address.trim(), phone: (phone || '').trim() })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        currentUser = data.user;
        showToast('💾 บันทึกที่อยู่และเบอร์โทรเริ่มต้นของคุณเรียบร้อยแล้ว', 'success');
        const profileAddr = document.getElementById('profile-input-address');
        const profilePhone = document.getElementById('profile-input-phone');
        if (profileAddr) profileAddr.value = address.trim();
        if (profilePhone && phone) profilePhone.value = phone.trim();
      } else {
        showToast(data.error || 'บันทึกที่อยู่ไม่สำเร็จ', 'error');
      }
    } catch (err) {
      showToast('เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์', 'error');
    }
  };

  // บันทึกที่อยู่เริ่มต้นจากหน้าโปรไฟล์ (ข้อ 14)
  window.saveUserAddressFromProfile = async () => {
    if (!currentUser || !currentUser.user_id) return;
    const address = document.getElementById('profile-input-address')?.value;
    const phone = document.getElementById('profile-input-phone')?.value;
    if (!address || !address.trim()) {
      showToast('กรุณากรอกที่อยู่ก่อนกดบันทึก', 'warning');
      return;
    }

    try {
      const res = await fetch('/api/user/address', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: currentUser.user_id, address: address.trim(), phone: (phone || '').trim() })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        currentUser = data.user;
        showToast('💾 บันทึกที่อยู่และเบอร์โทรเริ่มต้นในโปรไฟล์สำเร็จ', 'success');
        const inputAddr = document.getElementById('input-pickup-address');
        const inputPhone = document.getElementById('input-pickup-phone');
        if (inputAddr) inputAddr.value = address.trim();
        if (inputPhone && phone) inputPhone.value = phone.trim();
      } else {
        showToast(data.error || 'บันทึกที่อยู่ไม่สำเร็จ', 'error');
      }
    } catch (err) {
      showToast('เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์', 'error');
    }
  };

  window.handleSellerPickupSubmit = async (e) => {
    e.preventDefault();
    const address = document.getElementById('input-pickup-address')?.value;
    const desc = document.getElementById('input-pickup-desc')?.value;
    const phone = document.getElementById('input-pickup-phone')?.value;

    if (!address || !address.trim()) {
      showToast('กรุณากรอกที่อยู่นัดหมาย', 'warning');
      return;
    }

    const btnSubmit = document.getElementById('btn-submit-pickup');
    if (btnSubmit) {
      btnSubmit.disabled = true;
      btnSubmit.innerHTML = '<i data-lucide="loader" class="spin"></i> กำลังส่งคำขอ...';
    }

    try {
      const res = await fetch('/api/pickup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: currentUser ? currentUser.user_id : 1,
          title: 'เรียกรถรับซื้อขยะ',
          description: desc || 'ขยะรีไซเคิล',
          phone: phone || '',
          locationName: address.trim()
        })
      });

      const data = await res.json();
      if (res.ok && data.success) {
        const staffName = data.assignedStaff ? data.assignedStaff.staff_name : (data.report.staff_name || 'พนักงาน');
        showToast(`🎉 เรียกรถสำเร็จ! คิว #${data.report.report_id} มอบหมายให้ "${staffName}"`, 'success');
        switchView('view-seller-queue');
        await loadSellerQueueStatus();
        await loadPickupQueue();
      } else {
        showToast(data.error || 'เกิดข้อผิดพลาดในการบันทึกคำขอ', 'error');
      }
    } catch (err) {
      console.error('Pickup request error:', err);
      showToast('เกิดข้อผิดพลาดในการบันทึกคำขอ', 'error');
    } finally {
      if (btnSubmit) {
        btnSubmit.disabled = false;
        btnSubmit.innerHTML = '<i data-lucide="send"></i> ยืนยันเรียกรถรับขยะ (บันทึกลงระบบ)';
        if (window.lucide) window.lucide.createIcons();
      }
      await loadSellerQueueStatus();
    }
  };
}

// ข้อ 11 & ข้อ 21: จัดการสถานะคิวของฝั่ง User
async function loadSellerQueueStatus() {
  const dateDisplay = document.getElementById('queue-date-display');
  const noDisplay = document.getElementById('queue-no-display');
  const statusDot = document.getElementById('queue-status-dot');
  const statusText = document.getElementById('queue-status-text');
  const staffInfoContainer = document.getElementById('queue-staff-info-container');
  const staffNameVal = document.getElementById('queue-staff-name-val');
  const staffPhoneVal = document.getElementById('queue-staff-phone-val');
  const locationVal = document.getElementById('queue-location-val');
  const descVal = document.getElementById('queue-desc-val');
  const estTimeDisplay = document.getElementById('queue-est-time-display');
  const emptyPrompt = document.getElementById('queue-empty-prompt');
  const lockBanner = document.getElementById('queue-active-lock-banner');
  const submitBtn = document.getElementById('btn-submit-pickup');
  const addressInput = document.getElementById('input-pickup-address');
  const descInput = document.getElementById('input-pickup-desc');
  const phoneInput = document.getElementById('input-pickup-phone');

  // Pre-fill user default address and phone if available
  if (currentUser) {
    if (addressInput && !addressInput.value && currentUser.address) {
      addressInput.value = currentUser.address;
    }
    if (phoneInput && !phoneInput.value && currentUser.phone) {
      phoneInput.value = currentUser.phone;
    }
    const profileAddr = document.getElementById('profile-input-address');
    const profilePhone = document.getElementById('profile-input-phone');
    if (profileAddr && !profileAddr.value && currentUser.address) profileAddr.value = currentUser.address;
    if (profilePhone && !profilePhone.value && currentUser.phone) profilePhone.value = currentUser.phone;
  }

  if (!currentUser || !currentUser.user_id) return;

  try {
    const res = await fetch(`/api/pickup/user/${currentUser.user_id}`);
    const data = await res.json();
    const report = data.report;

    if (report && report.status === 'Waiting') {
      // มีคิวรอดำเนินการ (Status: Waiting)
      if (dateDisplay) {
        const timeStr = report.created_at ? new Date(report.created_at).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' }) : 'วันนี้ (เวลานัดหมาย)';
        dateDisplay.textContent = `📅 วันที่เรียก: ${timeStr}`;
      }
      if (noDisplay) noDisplay.textContent = `Queue Number : A-${String(report.report_id).padStart(3, '0')}`;
      if (statusDot) {
        statusDot.className = 'status-dot active';
        statusDot.style.background = 'var(--amber-orange)';
      }
      if (statusText) statusText.textContent = 'Status: Waiting (กำลังรอพนักงาน)';

      // ข้อมูลพนักงาน (ข้อ 11)
      if (staffInfoContainer) staffInfoContainer.style.display = 'block';
      if (staffNameVal) staffNameVal.textContent = report.staff_name || 'กำลังจัดสรรพนักงาน';
      if (staffPhoneVal) {
        staffPhoneVal.textContent = report.staff_phone || '081-999-8888';
        staffPhoneVal.href = `tel:${report.staff_phone || ''}`;
      }
      if (locationVal) locationVal.textContent = report.location_name || '-';
      if (descVal) descVal.textContent = report.descriiption || '-';

      if (estTimeDisplay) estTimeDisplay.style.display = 'block';
      if (emptyPrompt) emptyPrompt.style.display = 'none';

      // ข้อ 21: ล็อคฟอร์มไม่ให้กดซ้ำ
      if (lockBanner) lockBanner.style.display = 'block';
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i data-lucide="clock"></i> มีคิวรอดำเนินการอยู่ (ไม่สามารถเรียกซ้ำได้)';
      }
      if (addressInput) addressInput.disabled = true;
      if (descInput) descInput.disabled = true;
      if (phoneInput) phoneInput.disabled = true;

    } else {
      // ยังไม่ได้เรียกพนักงาน (ข้อ 11)
      if (dateDisplay) dateDisplay.textContent = '📅 ยังไม่มีนัดหมาย';
      if (noDisplay) noDisplay.textContent = 'Queue Number : -';
      if (statusDot) {
        statusDot.className = 'status-dot';
        statusDot.style.background = '#94a3b8';
      }
      if (statusText) statusText.textContent = 'สถานะ: ยังไม่ได้เรียกพนักงาน';

      if (staffInfoContainer) staffInfoContainer.style.display = 'none';
      if (estTimeDisplay) estTimeDisplay.style.display = 'none';
      if (emptyPrompt) emptyPrompt.style.display = 'block';

      // ปลดล็อคฟอร์มให้กดเรียกได้ตามปกติ
      if (lockBanner) lockBanner.style.display = 'none';
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<i data-lucide="send"></i> ยืนยันเรียกรถรับขยะ (บันทึกลงระบบ)';
      }
      if (addressInput) addressInput.disabled = false;
      if (descInput) descInput.disabled = false;
      if (phoneInput) phoneInput.disabled = false;
    }

    if (window.lucide) window.lucide.createIcons();
  } catch (err) {
    console.error('Error loading seller queue status:', err);
  }
}

// ข้อ 4 & ข้อ 9: ระบบแลกของรางวัล & แสดงผล 6 ชิ้นต่อหนึ่งหน้าพร้อมปุ่มเปลี่ยนหน้า
async function loadRewards() {
  const container = document.getElementById('seller-rewards-grid');
  const pagContainer = document.getElementById('rewards-pagination-container');
  if (!container) return;

  try {
    const res = await fetch('/api/rewards');
    const data = await res.json();
    const rewards = data.rewards || [];

    const userPoints = currentUser ? currentUser.points : 0;
    const totalItems = rewards.length;
    const totalPages = Math.ceil(totalItems / REWARDS_PER_PAGE) || 1;

    // Ensure valid page range
    if (rewardsCurrentPage > totalPages) rewardsCurrentPage = totalPages;
    if (rewardsCurrentPage < 1) rewardsCurrentPage = 1;

    const startIndex = (rewardsCurrentPage - 1) * REWARDS_PER_PAGE;
    const currentBatch = rewards.slice(startIndex, startIndex + REWARDS_PER_PAGE);

    if (currentBatch.length === 0) {
      container.innerHTML = `<div style="grid-column:1/-1; text-align:center; padding:24px; color:var(--text-muted);">ยังไม่มีของรางวัลในระบบ</div>`;
      if (pagContainer) pagContainer.innerHTML = '';
      return;
    }

    container.innerHTML = currentBatch.map(item => {
      const canAfford = userPoints >= item.point_required;
      const inStock = item.stock > 0;
      const costClass = canAfford ? '' : 'not-enough';

      let btnText = 'Exchange';
      let btnDisabled = false;
      if (!inStock) {
        btnText = 'สินค้าหมด';
        btnDisabled = true;
      } else if (!canAfford) {
        btnText = 'แต้มไม่พอ';
        btnDisabled = true;
      }

      // Check if image is URL/Base64 or Emoji
      const isImgUrl = item.image && (item.image.startsWith('http') || item.image.startsWith('data:image'));
      const imgHtml = isImgUrl 
        ? `<img src="${item.image}" alt="${item.reward_name}" style="width:72px; height:72px; object-fit:contain; margin:0 auto 6px auto; border-radius:12px;" />`
        : `<div class="reward-emoji-large">${item.image || '🎁'}</div>`;

      return `
        <div class="reward-figma-card">
          <div>
            ${imgHtml}
            <div class="reward-title-text">${item.reward_name}</div>
            <div class="reward-stock-badge">คงเหลือ: ${item.stock} ชิ้น</div>
            <div class="reward-points-cost ${costClass}">${item.point_required.toLocaleString()} แต้ม</div>
          </div>
          <button class="btn-figma-secondary" style="width:100%; font-size:0.775rem;" 
                  ${btnDisabled ? 'disabled' : ''} 
                  onclick="redeemDbReward(${item.reward_id})">
            ${btnText}
          </button>
        </div>
      `;
    }).join('');

    // ข้อ 9: แสดงปุ่มเปลี่ยนหน้าเมื่อมีของรางวัลมากกว่า 6 ชิ้น (หรือมีมากกว่า 1 หน้า)
    if (pagContainer) {
      if (totalPages > 1) {
        let dotsHtml = '';
        for (let p = 1; p <= totalPages; p++) {
          dotsHtml += `<span class="page-dot-item ${p === rewardsCurrentPage ? 'active' : ''}" onclick="changeRewardsPage(${p})"></span>`;
        }

        pagContainer.innerHTML = `
          <div class="rewards-pagination-row">
            <button type="button" class="btn-page-nav" ${rewardsCurrentPage <= 1 ? 'disabled' : ''} onclick="changeRewardsPage(${rewardsCurrentPage - 1})">
              <i data-lucide="chevron-left" style="width:16px; height:16px;"></i> ก่อนหน้า
            </button>
            <span class="page-indicator-badge">หน้า ${rewardsCurrentPage} / ${totalPages}</span>
            <button type="button" class="btn-page-nav" ${rewardsCurrentPage >= totalPages ? 'disabled' : ''} onclick="changeRewardsPage(${rewardsCurrentPage + 1})">
              ถัดไป <i data-lucide="chevron-right" style="width:16px; height:16px;"></i>
            </button>
          </div>
          <div class="rewards-page-dots margin-top-xs">
            ${dotsHtml}
          </div>
        `;
      } else {
        pagContainer.innerHTML = '';
      }
    }

    createIcons({ icons });

    window.changeRewardsPage = (page) => {
      rewardsCurrentPage = page;
      loadRewards();
      // Smooth scroll back to top of rewards grid
      const gridEl = document.getElementById('seller-rewards-grid');
      if (gridEl) {
        gridEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    };

    window.redeemDbReward = async (rewardId) => {
      if (!currentUser) {
        showToast('กรุณาเข้าสู่ระบบก่อนแลกของรางวัล', 'warning');
        openLoginModal();
        return;
      }

      try {
        const resRedeem = await fetch('/api/redeem', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: currentUser.user_id,
            rewardId: rewardId,
            quantity: 1
          })
        });

        const result = await resRedeem.json();
        if (!resRedeem.ok) {
          showToast(result.error || 'ไม่สามารถแลกได้', 'error');
          return;
        }

        currentUser = result.user;
        try {
          confetti({ particleCount: 60, spread: 55 });
        } catch (e) {}

        showToast(result.message || 'แลกของรางวัลสำเร็จ!', 'success');
        await refreshAllUI();
      } catch (err) {
        console.error('Redeem error:', err);
        showToast('เกิดข้อผิดพลาดในการเชื่อมต่อฐานข้อมูล', 'error');
      }
    };

  } catch (e) {
    console.error('Error loading rewards:', e);
  }
}

// โหลดประวัติการแลกจากตาราง redemptions
async function loadRedemptionsHistory() {
  const shortBox = document.getElementById('seller-recent-history-box');
  const tableBody = document.getElementById('redemptions-tbody');

  if (!currentUser) {
    if (shortBox) shortBox.innerHTML = '<p style="text-align:center; color:var(--text-muted);">กรุณาเข้าสู่ระบบ</p>';
    if (tableBody) tableBody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:12px;">กรุณาเข้าสู่ระบบ</td></tr>';
    return;
  }

  try {
    const res = await fetch(`/api/redemptions/${currentUser.user_id}`);
    const data = await res.json();
    const history = data.history || [];

    // 1. Short view in Home
    if (shortBox) {
      if (history.length === 0) {
        shortBox.innerHTML = `<p style="font-size:0.85rem; color:var(--text-muted); text-align:center;">ยังไม่มีประวัติการแลกของรางวัลในฐานข้อมูล</p>`;
      } else {
        shortBox.innerHTML = history.slice(0, 3).map(tx => `
          <div style="display:flex; justify-content:space-between; align-items:center; padding:8px 0; border-bottom:1px solid rgba(0,0,0,0.06); font-size:0.85rem;">
            <div>
              <div style="font-weight:700; color:var(--navy-dark);">${tx.image || '🎁'} ${tx.reward_name}</div>
              <div style="font-size:0.75rem; color:var(--text-muted);">${tx.redeemed_at} • จำนวน ${tx.quantity} ชิ้น</div>
            </div>
            <div style="font-weight:800; color:var(--danger-red); font-size:0.9rem;">-${tx.points_used} แต้ม</div>
          </div>
        `).join('');
      }
    }

    // 2. Full table in Gift View
    if (tableBody) {
      if (history.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:16px; color:var(--text-muted);">ไม่มีรายการแลกของรางวัล</td></tr>`;
      } else {
        tableBody.innerHTML = history.map(item => `
          <tr style="border-bottom:1px solid rgba(0,0,0,0.06);">
            <td style="padding:8px 4px; font-weight:700;">#RED-${item.redemption_id}</td>
            <td style="padding:8px 4px;">${item.image || '🎁'} ${item.reward_name}</td>
            <td style="padding:8px 4px; color:var(--danger-red); font-weight:700;">-${item.points_used}</td>
            <td style="padding:8px 4px;">${item.quantity}</td>
            <td style="padding:8px 4px; font-size:0.75rem; color:var(--text-muted);">${item.redeemed_at}</td>
            <td style="padding:8px 4px;"><span class="rate-badge" style="background:#d1fae5; color:#065f46; font-size:0.75rem; padding:2px 6px; border-radius:12px;">${item.status || 'สำเร็จ'}</span></td>
          </tr>
        `).join('');
      }
    }

  } catch (err) {
    console.error('Error loading redemptions history:', err);
  }
}

// โหลดประวัติการขายขยะของ User จากตาราง waste_history (แสดงวันเวลา, สถานที่, ชื่อ staff, และรายละเอียดขยะ)
async function loadUserSalesHistory() {
  const container = document.getElementById('seller-sales-history-box');
  if (!container) return;

  if (!currentUser) {
    container.innerHTML = '<p style="text-align:center; color:var(--text-muted); font-size:0.85rem; padding:12px;">กรุณาเข้าสู่ระบบ</p>';
    return;
  }

  try {
    const res = await fetch(`/api/user/sales-history/${currentUser.user_id}`);
    const data = await res.json();
    const history = data.history || [];

    if (history.length === 0) {
      container.innerHTML = `
        <div style="text-align:center; padding:20px 8px; color:var(--text-muted); font-size:0.85rem;">
          <i data-lucide="package-open" style="width:32px; height:32px; margin:0 auto 6px auto; opacity:0.4; display:block;"></i>
          <div>ยังไม่มีประวัติการขายขยะในระบบ</div>
        </div>
      `;
      createIcons({ icons });
      return;
    }

    container.innerHTML = history.map(tx => {
      const staffName = tx.staff_name || 'เจ้าหน้าที่ทั่วไป (Staff)';
      const staffPhone = tx.staff_phone ? ` (โทร: ${tx.staff_phone})` : '';
      const locationName = tx.location_name || 'จุดบริการรับซื้อขยะเคลื่อนที่ (กรุงเทพฯ)';
      const wasteDetails = tx.waste_details || `ขยะรีไซเคิล ${tx.recycle_kg || 0} kg, เปียก ${tx.organic_kg || 0} kg, ทั่วไป ${tx.general_kg || 0} ถุง, อันตราย ${tx.hazardous_kg || 0} ชิ้น`;
      const dateStr = tx.created_at || 'เมื่อสักครู่';

      return `
        <div style="padding:12px; margin-bottom:10px; background:#ffffff; border-radius:12px; border:1px solid rgba(0,0,0,0.08); box-shadow:0 1px 3px rgba(0,0,0,0.04);">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
            <div style="font-size:0.8rem; color:var(--text-muted); display:flex; align-items:center; gap:4px;">
              <i data-lucide="clock" style="width:13px; height:13px;"></i>
              <span>${dateStr}</span>
            </div>
            <div style="font-weight:800; color:var(--emerald-green); font-size:0.95rem; background:#ecfdf5; padding:2px 8px; border-radius:6px; border:1px solid #a7f3d0;">
              +${(tx.points_earned || 0).toLocaleString()} แต้ม
            </div>
          </div>
          <div style="font-size:0.82rem; color:var(--navy-dark); margin-bottom:4px; display:flex; align-items:flex-start; gap:5px;">
            <i data-lucide="map-pin" style="width:14px; height:14px; color:#3b82f6; flex-shrink:0; margin-top:2px;"></i>
            <span><strong>สถานที่:</strong> ${locationName}</span>
          </div>
          <div style="font-size:0.82rem; color:var(--navy-dark); margin-bottom:6px; display:flex; align-items:center; gap:5px;">
            <i data-lucide="user-check" style="width:14px; height:14px; color:#10b981; flex-shrink:0;"></i>
            <span><strong>เจ้าหน้าที่รับซื้อ:</strong> ${staffName}${staffPhone}</span>
          </div>
          <div style="background:#f8fafc; border-radius:8px; padding:8px 10px; font-size:0.8rem; color:#334155; border:1px solid #f1f5f9;">
            <div style="font-weight:700; margin-bottom:2px; color:#475569; display:flex; justify-content:space-between;">
              <span><i data-lucide="trash-2" style="width:12px; height:12px; vertical-align:middle;"></i> รายละเอียดขยะ:</span>
              <span style="color:#0284c7; font-weight:700;">รวม ${tx.total_kg || 0} kg</span>
            </div>
            <div>${wasteDetails}</div>
          </div>
        </div>
      `;
    }).join('');

    createIcons({ icons });
  } catch (err) {
    console.error('Error loading user sales history:', err);
    container.innerHTML = '<p style="text-align:center; color:var(--danger-red); font-size:0.85rem; padding:12px;">เกิดข้อผิดพลาดในการโหลดประวัติการขาย</p>';
  }
}

// โหลดประวัติการรับซื้อขยะของ Staff จากตาราง waste_history (แสดงวันเวลา, สถานที่, ชื่อ user, และรายละเอียดขยะ)
async function loadStaffSalesHistory() {
  const container = document.getElementById('employee-history-cards-container');
  if (!container) return;

  if (!currentStaff) {
    container.innerHTML = '<p style="text-align:center; color:var(--text-muted); font-size:0.85rem; padding:16px;">กรุณาเลือกหรือเข้าสู่ระบบพนักงาน</p>';
    return;
  }

  try {
    const res = await fetch(`/api/staff/sales-history/${currentStaff.staff_id}`);
    const data = await res.json();
    const history = data.history || [];

    if (history.length === 0) {
      container.innerHTML = `
        <div style="text-align:center; padding:30px 12px; color:var(--text-muted); font-size:0.85rem;">
          <i data-lucide="clipboard-list" style="width:36px; height:36px; margin:0 auto 8px auto; opacity:0.4; display:block;"></i>
          <div>ยังไม่มีประวัติการรับซื้อขยะสำหรับ ${currentStaff.staff_name}</div>
        </div>
      `;
      createIcons({ icons });
      return;
    }

    container.innerHTML = history.map(tx => {
      const customerName = tx.user_name || tx.username || `ลูกค้า #${tx.user_id}`;
      const customerPhone = tx.user_phone ? ` (โทร: ${tx.user_phone})` : '';
      const locationName = tx.location_name || 'จุดบริการรับซื้อขยะเคลื่อนที่ (กรุงเทพฯ)';
      const wasteDetails = tx.waste_details || `ขยะรีไซเคิล ${tx.recycle_kg || 0} kg, เปียก ${tx.organic_kg || 0} kg, ทั่วไป ${tx.general_kg || 0} ถุง, อันตราย ${tx.hazardous_kg || 0} ชิ้น`;
      const dateStr = tx.created_at || 'เมื่อสักครู่';

      return `
        <div style="padding:14px; margin-bottom:12px; background:#ffffff; border-radius:12px; border:1px solid rgba(0,0,0,0.08); box-shadow:0 1px 3px rgba(0,0,0,0.04);">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
            <div style="font-size:0.8rem; color:var(--text-muted); display:flex; align-items:center; gap:4px;">
              <i data-lucide="clock" style="width:13px; height:13px;"></i>
              <span>${dateStr}</span>
            </div>
            <div style="font-weight:800; color:var(--emerald-green); font-size:0.95rem; background:#ecfdf5; padding:3px 8px; border-radius:6px; border:1px solid #a7f3d0;">
              โอนแล้ว +${(tx.points_earned || 0).toLocaleString()} แต้ม
            </div>
          </div>
          <div style="font-size:0.85rem; color:var(--navy-dark); margin-bottom:4px; display:flex; align-items:center; gap:6px;">
            <i data-lucide="user" style="width:15px; height:15px; color:#3b82f6; flex-shrink:0;"></i>
            <span><strong>ผู้ขาย (ลูกค้า):</strong> ${customerName}${customerPhone}</span>
          </div>
          <div style="font-size:0.85rem; color:var(--navy-dark); margin-bottom:8px; display:flex; align-items:flex-start; gap:6px;">
            <i data-lucide="map-pin" style="width:15px; height:15px; color:#f59e0b; flex-shrink:0; margin-top:2px;"></i>
            <span><strong>สถานที่รับซื้อ:</strong> ${locationName}</span>
          </div>
          <div style="background:#f8fafc; border-radius:8px; padding:10px; font-size:0.82rem; color:#334155; border:1px solid #f1f5f9;">
            <div style="font-weight:700; margin-bottom:4px; color:#475569; display:flex; justify-content:space-between;">
              <span><i data-lucide="scale" style="width:13px; height:13px; vertical-align:middle;"></i> รายละเอียดขยะที่รับซื้อ:</span>
              <span style="color:#0284c7; font-weight:800;">น้ำหนักรวม ${tx.total_kg || 0} kg</span>
            </div>
            <div>${wasteDetails}</div>
          </div>
        </div>
      `;
    }).join('');

    createIcons({ icons });
  } catch (err) {
    console.error('Error loading staff sales history:', err);
    container.innerHTML = '<p style="text-align:center; color:var(--danger-red); font-size:0.85rem; padding:16px;">เกิดข้อผิดพลาดในการโหลดประวัติการรับซื้อ</p>';
  }
}

// โหลดคำขอจากตาราง garbage_reports (ข้อ 20: ล็อคคิวแบบ FIFO ต้อง confirm คิวแรกก่อนถึงจะกดรับคิวถัดไปได้)
async function loadPickupQueue() {
  const container = document.getElementById('employee-queue-cards-container');
  try {
    const res = await fetch('/api/pickup');
    const data = await res.json();
    const reports = data.reports || [];

    // กรองเฉพาะคิวที่ยัง Waiting และเรียงตาม report_id ASC (FIFO)
    const waitingReports = reports.filter(r => r.status === 'Waiting');
    waitingReports.sort((a, b) => a.report_id - b.report_id);

    const queueCountEl = document.getElementById('employee-queue-count');
    if (queueCountEl) queueCountEl.textContent = waitingReports.length;

    if (!container) return;

    if (waitingReports.length === 0) {
      container.innerHTML = `<p style="text-align:center; padding:24px; color:var(--text-muted);">🎉 ยังไม่มีคำขอเรียกรถค้างในระบบ ทุกคิวเสร็จสิ้นแล้ว</p>`;
      return;
    }

    const firstReport = waitingReports[0];

    container.innerHTML = waitingReports.map((r, index) => {
      const isFirst = index === 0;

      if (isFirst) {
        return `
          <div class="employee-queue-item" style="border: 2px solid var(--emerald-green); background: #f0fdf4; box-shadow: 0 4px 12px rgba(16, 185, 129, 0.15);">
            <div class="queue-item-top">
              <span class="queue-badge-tag" style="background:var(--emerald-green); color:#fff;">คิวแรกที่ต้องทำ #${r.report_id}</span>
              <span style="font-size:0.8rem; font-weight:700; color:var(--emerald-green);">🟢 พร้อมรับงาน</span>
            </div>
            <div class="user-detail-rows">
              <div>ลูกค้า : <strong>${r.user_name || 'ลูกค้าทั่วไป'}</strong></div>
              <div>เบอร์โทร : <strong>${r.user_phone || '-'}</strong></div>
              <div>สถานที่ : <strong>${r.location_name || '-'}</strong></div>
              <div>รายละเอียด : ${r.descriiption || '-'}</div>
              <div>พนักงานที่รับผิดชอบ : <strong style="color:var(--navy-dark);">${r.staff_name || 'ยังไม่ระบุ'}</strong></div>
            </div>
            <button class="btn-figma-primary margin-top-md" onclick="employeeGoToLocation('${r.report_id}', '${(r.user_name || 'ลูกค้า').replace(/'/g, "\\'")}', ${r.user_id || 1}, '${(r.location_name || '').replace(/'/g, "\\'")}')">
              <i data-lucide="navigation"></i> Go To Location (ไปรับซื้อขยะคิวนี้)
            </button>
          </div>
        `;
      } else {
        // ข้อ 20: คิวถัดไป ต้องยืนยันคิวแรกก่อน
        return `
          <div class="employee-queue-item" style="opacity: 0.75; background: #f8fafc; border: 1px dashed #cbd5e1;">
            <div class="queue-item-top">
              <span class="queue-badge-tag" style="background:#64748b; color:#fff;">คิวลำดับที่ ${index + 1} (#${r.report_id})</span>
              <span style="font-size:0.8rem; font-weight:700; color:#ef4444;">🔒 ล็อค (รอคิวแรก)</span>
            </div>
            <div class="user-detail-rows">
              <div>ลูกค้า : <strong>${r.user_name || 'ลูกค้าทั่วไป'}</strong></div>
              <div>เบอร์โทร : <strong>${r.user_phone || '-'}</strong></div>
              <div>สถานที่ : <strong>${r.location_name || '-'}</strong></div>
              <div>รายละเอียด : ${r.descriiption || '-'}</div>
              <div>พนักงานที่รับผิดชอบ : <strong>${r.staff_name || 'ยังไม่ระบุ'}</strong></div>
            </div>
            <div style="font-size:0.8rem; color:#dc2626; font-weight:600; margin-top:8px; padding:6px 10px; background:#fee2e2; border-radius:8px;">
              ⚠️ ต้องยืนยัน/ทำรายการคิวที่ #${firstReport.report_id} ให้เสร็จสิ้นก่อน จึงจะสามารถรับคิวนี้ได้
            </div>
            <button class="btn-figma-secondary margin-top-md" disabled style="opacity:0.5; cursor:not-allowed; width:100%;">
              <i data-lucide="lock"></i> ล็อค (ต้องยืนยันคิวแรกก่อน)
            </button>
          </div>
        `;
      }
    }).join('');

    createIcons({ icons });

  } catch (err) {
    console.error('Error loading pickup queue:', err);
  }
}

/* ==========================================================================
   Global UI Refresh & Toast Helper
   ========================================================================== */
export async function refreshAllUI() {
  // Sync latest user data from database
  if (currentUser && currentUser.user_id) {
    try {
      const res = await fetch(`/api/user/${currentUser.user_id}`);
      if (res.ok) {
        const data = await res.json();
        if (data.user) {
          currentUser = data.user;
        }
      }
    } catch (e) {
      console.warn('Could not refresh current user:', e);
    }
  }

  // Sync user display
  if (currentUser) {
    const pointsHeader = document.getElementById('header-points-val');
    const userDisplay = document.getElementById('user-display-name');
    const sellerName = document.getElementById('seller-name-val');
    const sellerId = document.getElementById('seller-id-val');
    const sellerUsername = document.getElementById('seller-username-val');
    const sellerPhone = document.getElementById('seller-phone-val');
    const avatarInitials = document.getElementById('seller-avatar-initials');

    const profileName = document.getElementById('profile-name-text');
    const profileId = document.getElementById('profile-id-text');
    const profileEmail = document.getElementById('profile-email-text');
    const profilePoints = document.getElementById('profile-points-badge');

    if (pointsHeader) pointsHeader.textContent = (currentUser.points || 0).toLocaleString();
    if (userDisplay) userDisplay.textContent = currentUser.name || currentUser.username;
    if (sellerName) sellerName.textContent = currentUser.name || currentUser.username;
    if (sellerId) sellerId.textContent = currentUser.user_id;
    if (sellerUsername) sellerUsername.textContent = currentUser.username;
    if (sellerPhone) sellerPhone.textContent = currentUser.phone ? currentUser.phone : 'ยังไม่ได้ระบุเบอร์โทร';

    renderUserAvatar();

    if (profileName) profileName.textContent = currentUser.name || currentUser.username;
    if (profileId) profileId.textContent = currentUser.user_id;
    if (profileEmail) profileEmail.textContent = currentUser.email || '-';
    if (profilePoints) profilePoints.textContent = `🏅 แต้มสะสม: ${(currentUser.points || 0).toLocaleString()} แต้ม`;
  }

  // Sync staff banner (NO POINTS FOR STAFF) & Staff Phone (ข้อ 24)
  if (currentStaff) {
    const staffBanner = document.getElementById('staff-name-banner');
    if (staffBanner) staffBanner.textContent = `${currentStaff.staff_name} (ID: ${currentStaff.staff_id})`;
    const staffPhoneInput = document.getElementById('staff-phone-input');
    if (staffPhoneInput && currentStaff.phone) {
      staffPhoneInput.value = currentStaff.phone;
    }
  }

  await loadWasteRates();
  await loadRewards();
  await loadRedemptionsHistory();
  await loadUserSalesHistory();
  if (currentStaff) {
    await loadStaffSalesHistory();
  }
  await loadSellerQueueStatus();
  await loadPickupQueue();
  await loadUserWasteStats();
  if (currentRole === 'admin') {
    await loadAdminDashboardData();
  }
  renderUserAvatar();

  createIcons({ icons });

  window.getCurrentUser = () => currentUser;
  window.setCurrentUser = (u) => { currentUser = u; };
}

// ข้อ 2 & ข้อ 13: จัดการการเลือกรูปภาพโปรไฟล์ และย่อขนาดด้วย Canvas ก่อนบันทึกลง DB
window.triggerProfileImageUpload = () => {
  if (currentRole !== 'seller') {
    showToast('ฟังก์ชันนี้สำหรับคนขายขยะเท่านั้น', 'warning');
    return;
  }
  const fileInput = document.getElementById('profile-image-file-input');
  if (fileInput) {
    fileInput.value = '';
    fileInput.click();
  }
};

window.handleProfileImageSelected = async (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;

  if (!currentUser) {
    showToast('กรุณาเข้าสู่ระบบก่อน', 'warning');
    return;
  }

  showToast('กำลังประมวลผลรูปภาพโปรไฟล์...', 'info');

  try {
    // Resize image to max 400x400 with 0.85 quality using Canvas to prevent large payloads
    const base64Image = await resizeImageToMax(file, 400, 400);

    const res = await fetch('/api/user/profile-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: currentUser.user_id,
        imageBase64: base64Image
      })
    });

    const data = await res.json();
    if (res.ok && data.success) {
      currentUser = data.user;
      renderUserAvatar();
      showToast('อัปเดตรูปโปรไฟล์สำเร็จเรียบร้อย!', 'success');
      await refreshAllUI();
    } else {
      showToast(data.error || 'ไม่สามารถบันทึกรูปได้', 'error');
    }
  } catch (err) {
    console.error('Error uploading avatar:', err);
    showToast('เกิดข้อผิดพลาดในการอัปโหลดรูปภาพ', 'error');
  } finally {
    e.target.value = '';
  }
};

function resizeImageToMax(file, maxWidth, maxHeight) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > maxWidth) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          }
        } else {
          if (height > maxHeight) {
            width = Math.round((width * maxHeight) / height);
            height = maxHeight;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function renderUserAvatar() {
  const avatarHome = document.getElementById('seller-avatar-initials');
  const avatarProfile = document.getElementById('profile-avatar-circle');

  if (currentUser && currentUser.profile_image) {
    const imgHtml = `<img src="${currentUser.profile_image}" alt="Profile Photo" />`;
    if (avatarHome) avatarHome.innerHTML = imgHtml;
    if (avatarProfile) avatarProfile.innerHTML = imgHtml;
  } else if (currentUser) {
    const initials = (currentUser.name || currentUser.username || 'U').substring(0, 2).toUpperCase();
    if (avatarHome) avatarHome.textContent = initials;
    if (avatarProfile) avatarProfile.textContent = initials;
  }
}

// ข้อ 1: โหลดสถิติการขายขยะรวมทั้งหมด และแต่ละประเภท
async function loadUserWasteStats() {
  if (!currentUser) return;

  try {
    const res = await fetch(`/api/user-stats/${currentUser.user_id}`);
    if (!res.ok) return;

    const data = await res.json();
    const stats = data.stats || {
      recycle_kg: 0,
      organic_kg: 0,
      general_kg: 0,
      hazardous_kg: 0,
      total_kg: 0,
      total_times: 0
    };

    // Update UI Stats Elements
    const totalKgEl = document.getElementById('stats-total-kg');
    const totalTimesEl = document.getElementById('stats-total-times');
    const recycleKgEl = document.getElementById('stats-recycle-kg');
    const organicKgEl = document.getElementById('stats-organic-kg');
    const generalKgEl = document.getElementById('stats-general-kg');
    const hazardousKgEl = document.getElementById('stats-hazardous-kg');
    const co2El = document.getElementById('profile-co2-val');

    const totalKgVal = (parseFloat(stats.total_kg) || 0).toFixed(1);
    if (totalKgEl) totalKgEl.textContent = totalKgVal;
    if (totalTimesEl) totalTimesEl.textContent = stats.total_times || 0;
    if (recycleKgEl) recycleKgEl.textContent = (parseFloat(stats.recycle_kg) || 0).toFixed(1);
    if (organicKgEl) organicKgEl.textContent = (parseFloat(stats.organic_kg) || 0).toFixed(1);
    if (generalKgEl) generalKgEl.textContent = (parseFloat(stats.general_kg) || 0).toFixed(1);
    if (hazardousKgEl) hazardousKgEl.textContent = (parseFloat(stats.hazardous_kg) || 0).toFixed(1);

    // CO2 calculation: ~1.8 kg CO2 reduced per kg of waste recycled
    const co2Val = (totalKgVal * 1.8).toFixed(1);
    if (co2El) co2El.textContent = `${co2Val} kg`;

  } catch (err) {
    console.error('Error loading waste stats:', err);
  }
}

export function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  
  let iconName = 'info';
  if (type === 'success') iconName = 'check-circle';
  if (type === 'warning') iconName = 'alert-circle';
  if (type === 'error') iconName = 'x-circle';

  toast.innerHTML = `<i data-lucide="${iconName}"></i> <span>${message}</span>`;
  container.appendChild(toast);
  createIcons({ icons });

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    toast.style.transition = 'all 0.25s ease';
    setTimeout(() => toast.remove(), 250);
  }, 3500);
}

window.showToast = showToast;

/* ==========================================================================
   Waste Rates Synchronization (DB <-> Seller Home & Employee Form)
   ========================================================================== */
async function loadWasteRates() {
  try {
    const res = await fetch('/api/rates');
    if (!res.ok) return;
    const data = await res.json();
    const rates = data.rates || [];

    rates.forEach(r => {
      if (r.category_key === 'recycle') activeRates.recycle = r.points_per_unit;
      if (r.category_key === 'organic') activeRates.organic = r.points_per_unit;
      if (r.category_key === 'general') activeRates.general = r.points_per_unit;
      if (r.category_key === 'hazardous') activeRates.hazardous = r.points_per_unit;
    });

    // Update Seller Waste Bags Display
    const badgeRecycle = document.getElementById('badge-rate-recycle');
    const badgeOrganic = document.getElementById('badge-rate-organic');
    const badgeGeneral = document.getElementById('badge-rate-general');
    const badgeHazardous = document.getElementById('badge-rate-hazardous');

    if (badgeRecycle) badgeRecycle.textContent = `${activeRates.recycle} แต้ม/kg`;
    if (badgeOrganic) badgeOrganic.textContent = `${activeRates.organic} แต้ม/kg`;
    if (badgeGeneral) badgeGeneral.textContent = `${activeRates.general} แต้ม/ถุง`;
    if (badgeHazardous) badgeHazardous.textContent = `${activeRates.hazardous} แต้ม/ชิ้น`;

    // Recalculate employee form if open
    calcEmpTotals();
  } catch (err) {
    console.error('Error loading waste rates:', err);
  }
}

/* ==========================================================================
   Admin Dashboard Functions (3 Blocks in 1 Page)
   ========================================================================== */
async function loadAdminDashboardData() {
  await loadAdminRewards();
  await loadAdminRatesForm();
  await loadAdminUsersList();
  await loadAdminStaffsList();
}

window.loadAdminDashboardData = loadAdminDashboardData;

// Block 1: จัดการสต็อกและคะแนนของรางวัล & เพิ่มของรางวัลใหม่ (ข้อ 8)
async function loadAdminRewards() {
  const container = document.getElementById('admin-rewards-list');
  const countBadge = document.getElementById('admin-rewards-total-count');
  if (!container) return;

  try {
    const res = await fetch('/api/rewards');
    const data = await res.json();
    const rewards = data.rewards || [];

    if (countBadge) countBadge.textContent = `${rewards.length} รายการ`;

    if (rewards.length === 0) {
      container.innerHTML = `<div style="text-align:center; padding:12px; color:var(--text-muted);">ไม่มีรายการของรางวัล</div>`;
      return;
    }

    container.innerHTML = rewards.map(r => {
      const isImgUrl = r.image && (r.image.startsWith('http') || r.image.startsWith('data:image'));
      const imgHtml = isImgUrl 
        ? `<img src="${r.image}" alt="${r.reward_name}" style="width:40px; height:40px; object-fit:contain; border-radius:8px;" />`
        : `<span style="font-size:1.6rem;">${r.image || '🎁'}</span>`;

      return `
        <div class="admin-reward-row">
          <div class="admin-reward-info">
            ${imgHtml}
            <div>
              <div style="font-weight:800; color:var(--navy-dark); font-size:0.9rem;">${r.reward_name}</div>
              <div style="font-size:0.75rem; color:var(--text-muted);">ID: #${r.reward_id}</div>
            </div>
          </div>

          <div class="admin-reward-controls">
            <div class="admin-inline-field">
              <span style="color:var(--text-muted);">สต็อก:</span>
              <input type="number" min="0" id="admin-reward-stock-${r.reward_id}" class="admin-inline-input" value="${r.stock}" />
              <span style="color:var(--text-muted); font-size:0.75rem;">ชิ้น</span>
            </div>

            <div class="admin-inline-field">
              <span style="color:var(--text-muted);">แต้มที่ใช้:</span>
              <input type="number" min="1" id="admin-reward-pts-${r.reward_id}" class="admin-inline-input" style="width:90px;" value="${r.point_required}" />
              <span style="color:var(--text-muted); font-size:0.75rem;">แต้ม</span>
            </div>

            <button type="button" class="btn-admin-save-sm" onclick="handleAdminUpdateReward(${r.reward_id})">
              <i data-lucide="check" style="width:14px; height:14px;"></i> บันทึก
            </button>

            <button type="button" class="btn-admin-del-sm" onclick="handleAdminDeleteReward(${r.reward_id}, '${r.reward_name}')" title="ลบของรางวัลนี้">
              <i data-lucide="trash-2" style="width:14px; height:14px;"></i>
            </button>
          </div>
        </div>
      `;
    }).join('');

    createIcons({ icons });
  } catch (err) {
    console.error('Error loading admin rewards:', err);
  }
}

window.handleAdminUpdateReward = async (rewardId) => {
  const stockInput = document.getElementById(`admin-reward-stock-${rewardId}`);
  const ptsInput = document.getElementById(`admin-reward-pts-${rewardId}`);

  const stock = parseInt(stockInput?.value);
  const pointRequired = parseInt(ptsInput?.value);

  if (isNaN(stock) || isNaN(pointRequired)) {
    showToast('กรุณากรอกสต็อกและคะแนนให้ถูกต้อง', 'warning');
    return;
  }

  try {
    const res = await fetch('/api/admin/rewards/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rewardId, stock, pointRequired })
    });

    const data = await res.json();
    if (res.ok && data.success) {
      showToast(data.message || 'อัปเดตของรางวัลสำเร็จ!', 'success');
      await loadRewards(); // Refresh user-facing gift view
    } else {
      showToast(data.error || 'ไม่สามารถอัปเดตของรางวัลได้', 'error');
    }
  } catch (err) {
    console.error('Error updating reward:', err);
    showToast('เกิดข้อผิดพลาดในการเชื่อมต่อฐานข้อมูล', 'error');
  }
};

// ข้อ 8: เพิ่มของรางวัลใหม่โดย Admin
window.handleAdminAddReward = async (e) => {
  e.preventDefault();
  const name = document.getElementById('admin-new-reward-name')?.value.trim();
  const stock = parseInt(document.getElementById('admin-new-reward-stock')?.value);
  const pointRequired = parseInt(document.getElementById('admin-new-reward-points')?.value);
  const image = document.getElementById('admin-new-reward-image')?.value.trim();

  if (!name) {
    showToast('กรุณากรอกชื่อของรางวัล', 'warning');
    return;
  }
  if (isNaN(stock) || stock < 0) {
    showToast('กรุณากรอกจำนวนสต็อก (ตัวเลข >= 0)', 'warning');
    return;
  }
  if (isNaN(pointRequired) || pointRequired <= 0) {
    showToast('กรุณากรอกแต้มที่ต้องใช้แลก (ตัวเลข > 0)', 'warning');
    return;
  }
  if (!image) {
    showToast('กรุณาใส่รูปภาพหรือ Emoji ของรางวัล', 'warning');
    return;
  }

  try {
    const res = await fetch('/api/admin/rewards/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, stock, pointRequired, image })
    });

    const data = await res.json();
    if (res.ok && data.success) {
      showToast(data.message || 'เพิ่มของรางวัลใหม่สำเร็จ!', 'success');
      // Reset form
      document.getElementById('admin-add-reward-form')?.reset();
      clearAdminRewardImage();

      // Refresh admin rewards list and user-facing shop
      await loadAdminRewards();
      await loadRewards();
    } else {
      showToast(data.error || 'ไม่สามารถเพิ่มของรางวัลได้', 'error');
    }
  } catch (err) {
    console.error('Error adding new reward:', err);
    showToast('เกิดข้อผิดพลาดในการเชื่อมต่อฐานข้อมูล', 'error');
  }
};

window.handleAdminDeleteReward = async (rewardId, rewardName) => {
  if (!confirm(`คุณแน่ใจหรือไม่ว่าต้องการลบของรางวัล "${rewardName}" ออกจากระบบ?`)) {
    return;
  }

  try {
    const res = await fetch('/api/admin/rewards/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rewardId })
    });

    const data = await res.json();
    if (res.ok && data.success) {
      showToast(data.message || 'ลบของรางวัลสำเร็จ', 'info');
      await loadAdminRewards();
      await loadRewards();
    } else {
      showToast(data.error || 'ไม่สามารถลบได้', 'error');
    }
  } catch (err) {
    console.error('Error deleting reward:', err);
    showToast('เกิดข้อผิดพลาดในการลบของรางวัล', 'error');
  }
};

window.handleAdminRewardImageUploaded = (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;

  if (file.size > 2 * 1024 * 1024) {
    showToast('ขนาดรูปภาพต้องไม่เกิน 2MB', 'warning');
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    const base64 = reader.result;
    const input = document.getElementById('admin-new-reward-image');
    if (input) input.value = base64;

    const previewBox = document.getElementById('admin-reward-img-preview');
    const previewVal = document.getElementById('admin-reward-preview-val');
    if (previewBox && previewVal) {
      previewVal.innerHTML = `<img src="${base64}" alt="Preview" /> <span>เลือกรูปภาพเรียบร้อย (${file.name})</span>`;
      previewBox.classList.remove('hidden');
    }
    showToast('อัปโหลดรูปภาพตัวอย่างเรียบร้อย', 'success');
  };
  reader.readAsDataURL(file);
};

window.clearAdminRewardImage = () => {
  const input = document.getElementById('admin-new-reward-image');
  const fileInput = document.getElementById('admin-reward-file-input');
  const previewBox = document.getElementById('admin-reward-img-preview');
  if (input) input.value = '';
  if (fileInput) fileInput.value = '';
  if (previewBox) previewBox.classList.add('hidden');
};

// Block 2: ปรับตัวคูณของขยะ 4 ประเภท
async function loadAdminRatesForm() {
  try {
    const res = await fetch('/api/rates');
    if (!res.ok) return;
    const data = await res.json();
    const rates = data.rates || [];

    rates.forEach(r => {
      const input = document.getElementById(`admin-rate-${r.category_key}`);
      if (input) input.value = r.points_per_unit;
    });
  } catch (err) {
    console.error('Error loading rates for admin form:', err);
  }
}

window.handleSaveWasteRates = async (e) => {
  e.preventDefault();
  const recycle = parseFloat(document.getElementById('admin-rate-recycle')?.value);
  const organic = parseFloat(document.getElementById('admin-rate-organic')?.value);
  const general = parseFloat(document.getElementById('admin-rate-general')?.value);
  const hazardous = parseFloat(document.getElementById('admin-rate-hazardous')?.value);

  if (isNaN(recycle) || isNaN(organic) || isNaN(general) || isNaN(hazardous)) {
    showToast('กรุณากรอกตัวคูณให้ครบถ้วนทุกช่อง', 'warning');
    return;
  }

  try {
    const res = await fetch('/api/admin/rates/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rates: [
          { category_key: 'recycle', points_per_unit: recycle },
          { category_key: 'organic', points_per_unit: organic },
          { category_key: 'general', points_per_unit: general },
          { category_key: 'hazardous', points_per_unit: hazardous }
        ]
      })
    });

    const data = await res.json();
    if (res.ok && data.success) {
      showToast(data.message || 'บันทึกอัตราตัวคูณขยะลงฐานข้อมูลสำเร็จ!', 'success');
      await loadWasteRates(); // Update live state and UI badges
    } else {
      showToast(data.error || 'ไม่สามารถบันทึกอัตราขยะได้', 'error');
    }
  } catch (err) {
    console.error('Error updating rates:', err);
    showToast('เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์', 'error');
  }
};

// Block 3: จัดการและปรับคะแนน User
async function loadAdminUsersList() {
  const tbody = document.getElementById('admin-users-tbody');
  if (!tbody) return;

  try {
    const res = await fetch('/api/admin/users');
    const data = await res.json();
    const users = data.users || [];

    if (users.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:16px;">ยังไม่มีผู้ใช้ในระบบ</td></tr>';
      return;
    }

    tbody.innerHTML = users.map(u => `
      <tr>
        <td style="font-weight:700;">#${u.user_id}</td>
        <td>
          <div style="font-weight:700; color:var(--navy-dark);">${u.name || u.username}</div>
          <div style="font-size:0.75rem; color:var(--text-muted);">${u.username}</div>
        </td>
        <td style="font-size:0.75rem; color:var(--text-muted);">${u.email || u.phone || '-'}</td>
        <td style="text-align:right; font-weight:800; color:var(--emerald-green); font-size:0.95rem;">
          ${(u.points || 0).toLocaleString()} แต้ม
        </td>
        <td style="text-align:center;">
          <div style="display:flex; align-items:center; justify-content:center; gap:6px;">
            <button type="button" class="btn-select-user-tag" onclick="selectUserForPointsEdit('${u.username}', ${u.points})">
              ปรับแต้ม
            </button>
            <button type="button" class="btn-admin-del-sm" onclick="adminDeleteUser(${u.user_id}, '${u.username}')" title="ลบผู้ใช้นี้ออกจากระบบ">
              <i data-lucide="trash-2" style="width:13px; height:13px;"></i> ลบ
            </button>
          </div>
        </td>
      </tr>
    `).join('');

    createIcons({ icons });
  } catch (err) {
    console.error('Error loading admin users:', err);
  }
}

window.loadAdminUsersList = loadAdminUsersList;

window.adminDeleteUser = async (userId, username) => {
  if (!confirm(`คุณแน่ใจหรือไม่ว่าต้องการลบผู้ใช้งาน "${username}" (ID: #${userId}) ออกจากระบบ?\n\nคำเตือน: ประวัติการแลกของรางวัลและสถิติขยะทั้งหมดของผู้ใช้นี้จะถูกลบอย่างถาวร!`)) {
    return;
  }

  try {
    const res = await fetch('/api/admin/user/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId })
    });

    const data = await res.json();
    if (res.ok && data.success) {
      showToast(data.message || `ลบผู้ใช้งาน "${username}" สำเร็จ`, 'success');
      if (currentUser && currentUser.user_id == userId) {
        currentUser = null;
        localStorage.removeItem('ECO_USER_ID');
      }
      await loadAdminUsersList();
      await refreshAllUI();
    } else {
      showToast(data.error || 'ไม่สามารถลบผู้ใช้งานได้', 'error');
    }
  } catch (err) {
    console.error('Error deleting user:', err);
    showToast('เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์', 'error');
  }
};

window.selectUserForPointsEdit = (username, currentPts) => {
  const inputUser = document.getElementById('admin-input-target-user');
  const inputPts = document.getElementById('admin-input-new-points');
  if (inputUser) inputUser.value = username;
  if (inputPts) inputPts.value = currentPts;
  inputPts?.focus();
};

window.handleAdminAdjustPoints = async (e) => {
  e.preventDefault();
  const targetUser = document.getElementById('admin-input-target-user')?.value.trim();
  const mode = document.getElementById('admin-select-mode')?.value || 'set';
  const points = parseInt(document.getElementById('admin-input-new-points')?.value);

  if (!targetUser || isNaN(points)) {
    showToast('กรุณากรอกชื่อผู้ใช้และคะแนนที่ต้องการปรับ', 'warning');
    return;
  }

  try {
    const res = await fetch('/api/admin/user/adjust-points', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        usernameOrId: targetUser,
        points: points,
        mode: mode
      })
    });

    const data = await res.json();
    if (res.ok && data.success) {
      showToast(data.message || 'ปรับคะแนนผู้ใช้สำเร็จ!', 'success');
      // If currently logged in user was adjusted, update session
      if (currentUser && (currentUser.username === targetUser || currentUser.user_id == targetUser)) {
        currentUser = data.user;
      }
      await refreshAllUI();
      await loadAdminUsersList();
    } else {
      showToast(data.error || 'ไม่สามารถปรับคะแนนผู้ใช้ได้', 'error');
    }
  } catch (err) {
    console.error('Error adjusting user points:', err);
    showToast('เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์', 'error');
  }
};

// ข้อ 17: ฟังก์ชันจัดการและลบพนักงาน (Staffs) สำหรับ Admin
async function loadAdminStaffsList() {
  const tbody = document.getElementById('admin-staffs-tbody');
  if (!tbody) return;

  try {
    const res = await fetch('/api/staffs');
    const data = await res.json();
    const staffs = data.staffs || [];

    if (staffs.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:16px;">ยังไม่มีพนักงานในระบบ</td></tr>';
      return;
    }

    tbody.innerHTML = staffs.map(s => `
      <tr>
        <td style="font-weight:700;">#${s.staff_id}</td>
        <td>
          <div style="font-weight:700; color:var(--navy-dark);">${s.staff_name}</div>
        </td>
        <td style="font-size:0.8rem; color:var(--text-muted);">${s.phone || '-'}</td>
        <td style="text-align:center;">
          <button type="button" class="btn-admin-del-sm" onclick="adminDeleteStaff(${s.staff_id}, '${s.staff_name}')" title="ลบพนักงานนี้ออกจากระบบ">
            <i data-lucide="trash-2" style="width:13px; height:13px;"></i> ลบพนักงาน
          </button>
        </td>
      </tr>
    `).join('');

    createIcons({ icons });
  } catch (err) {
    console.error('Error loading admin staffs:', err);
  }
}

window.loadAdminStaffsList = loadAdminStaffsList;

window.adminDeleteStaff = async (staffId, staffName) => {
  if (!confirm(`คุณแน่ใจหรือไม่ว่าต้องการลบพนักงาน "${staffName}" (ID: #${staffId}) ออกจากระบบ?`)) {
    return;
  }

  try {
    const res = await fetch('/api/admin/staff/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ staffId })
    });

    const data = await res.json();
    if (res.ok && data.success) {
      showToast(data.message || `ลบพนักงาน "${staffName}" สำเร็จ`, 'success');
      if (currentStaff && currentStaff.staff_id == staffId) {
        currentStaff = null;
        localStorage.removeItem('ECO_STAFF_ID');
      }
      await loadAdminStaffsList();
      await refreshAllUI();
    } else {
      showToast(data.error || 'ไม่สามารถลบพนักงานได้', 'error');
    }
  } catch (err) {
    console.error('Error deleting staff:', err);
    showToast('เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์', 'error');
  }
};

// ข้อ 24: Staff สามารถกรอกเบอร์ของตัวเองและบันทึกเบอร์ได้
window.saveStaffPhone = async () => {
  if (!currentStaff || !currentStaff.staff_id) {
    showToast('กรุณาเข้าสู่ระบบในบทบาทพนักงานก่อนบันทึกเบอร์โทร', 'warning');
    return;
  }
  const phoneInput = document.getElementById('staff-phone-input');
  const phoneVal = phoneInput ? phoneInput.value.trim() : '';
  if (!phoneVal) {
    showToast('กรุณากรอกเบอร์โทรศัพท์', 'warning');
    return;
  }

  try {
    const res = await fetch('/api/staff/phone', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        staffId: currentStaff.staff_id,
        phone: phoneVal
      })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      currentStaff = data.staff;
      showToast(`💾 บันทึกเบอร์โทรศัพท์ของพนักงาน "${currentStaff.staff_name}" เรียบร้อยแล้ว`, 'success');
      await refreshAllUI();
    } else {
      showToast(data.error || 'บันทึกเบอร์โทรศัพท์ไม่สำเร็จ', 'error');
    }
  } catch (err) {
    console.error('Error saving staff phone:', err);
    showToast('เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์', 'error');
  }
};

// ข้อ 25: Admin ล้างคิวทั้งหมดของพนักงานทิ้งได้เลย
window.handleAdminClearAllQueues = async () => {
  if (!confirm('⚠️ คุณแน่ใจหรือไม่ว่าต้องการ "ล้างคิวทั้งหมดของพนักงานทิ้งทั้งหมด"?\n\nการกระทำนี้จะลบรายการคิวรับซื้อขยะทุกรายการออกจากระบบทันที')) {
    return;
  }

  try {
    const res = await fetch('/api/admin/queues/clear', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    const data = await res.json();
    if (res.ok && data.success) {
      showToast('🗑️ ล้างคิวงานทั้งหมดของพนักงานเรียบร้อยแล้ว!', 'success');
      window.currentServingReportId = null;
      await loadPickupQueue();
      await loadSellerQueueStatus();
      await refreshAllUI();
    } else {
      showToast(data.error || 'ไม่สามารถล้างคิวได้', 'error');
    }
  } catch (err) {
    console.error('Error clearing queues:', err);
    showToast('เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์', 'error');
  }
};



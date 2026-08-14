// =================================================================
// 1. Firebase 初期化 & 設定
// =================================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { 
  getFirestore, 
  collection, 
  addDoc, 
  updateDoc, 
  doc, 
  onSnapshot, 
  serverTimestamp, 
  query, 
  orderBy 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// ⚠️ ご自身のFirebaseプロジェクトの設定情報に置き換えてください
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT.appstop.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};

let db = null;
let useFirebase = false;

// Firebase設定の簡易検証
if (firebaseConfig.apiKey !== "YOUR_API_KEY") {
  try {
    const app = initializeApp(firebaseConfig);
    db = getFirestore(app);
    useFirebase = true;
    console.log("🔥 Firebase Firestore connected!");
  } catch (err) {
    console.error("Firebase Initialization Error:", err);
  }
} else {
  document.getElementById("config-warning").classList.remove("hidden");
}

// =================================================================
// 2. 店舗メニュー定義 & アプリ内状態管理
// =================================================================
const MENU_ITEMS = [
  { id: 'm1', name: 'ラーメン', price: 850 },
  { id: 'm2', name: 'チャーシューメン', price: 1050 },
  { id: 'm3', name: '唐揚げ', price: 500 },
  { id: 'm4', name: '餃子', price: 400 },
  { id: 'm5', name: '炒飯', price: 750 },
  { id: 'm6', name: 'コーラ', price: 300 },
  { id: 'm7', name: 'ウーロン茶', price: 250 },
  { id: 'm8', name: '生ビール', price: 600 }
];

let selectedCustomerNumStr = ""; // 選択中の客番文字列
let currentOrderDraft = [];     // { productName, quantity, price }
let allOrders = [];             // 全注文データ保持用
let activeCancelTargetId = null;

// LocalStorageフォールバック用キー（Firebase未接続時）
const LOCAL_STORAGE_KEY = 'restaurant_orders_demo_db';

// =================================================================
// 3. アプリ初期化
// =================================================================
document.addEventListener("DOMContentLoaded", () => {
  renderMenuGrid();
  setupRealtimeSync();

  // グローバル関数をwindowに紐付け (HTMLからのonclick用)
  window.switchMainView = switchMainView;
  window.switchKitchenTab = switchKitchenTab;
  window.submitOrder = submitOrder;
  window.markAsCompleted = markAsCompleted;
  window.openCancelPrompt = openCancelPrompt;
  window.closeCancelPrompt = closeCancelPrompt;
  window.setCancelReason = setCancelReason;
  window.confirmCancelOrder = confirmCancelOrder;
  window.openOrderDetailModal = openOrderDetailModal;
  window.closeModal = closeModal;
  window.closeModalOnOverlay = closeModalOnOverlay;
  window.markAsDelivered = markAsDelivered;

  // 客番選択用関数をwindowに紐付け
  window.setCustomerNum = setCustomerNum;
  window.clearCustomerNum = clearCustomerNum;
});

// =================================================================
// 4. 客番選択（ボタン操作）
// =================================================================
function updateCustomerNumDisplay() {
  const displayEl = document.getElementById("customer-num-display");
  displayEl.innerText = selectedCustomerNumStr || "--";
}

function setCustomerNum(numStr) {
  selectedCustomerNumStr = numStr;
  updateCustomerNumDisplay();
}

function clearCustomerNum() {
  selectedCustomerNumStr = "";
  updateCustomerNumDisplay();
}

// =================================================================
// 5. メニュー表示 & 注文下書き操作 (ホール側)
// =================================================================
function renderMenuGrid() {
  const container = document.getElementById("menu-grid");
  container.innerHTML = MENU_ITEMS.map(item => `
    <div class="menu-card" onclick="addMenuItem('${item.name}', ${item.price})">
      <div class="name">${item.name}</div>
      <div class="price">¥${item.price}</div>
    </div>
  `).join('');
}

window.addMenuItem = function(name, price) {
  const existing = currentOrderDraft.find(i => i.productName === name);
  if (existing) {
    existing.quantity++;
  } else {
    currentOrderDraft.push({ productName: name, quantity: 1, price });
  }
  renderSelectedItems();
};

window.changeQty = function(name, delta) {
  const idx = currentOrderDraft.findIndex(i => i.productName === name);
  if (idx !== -1) {
    currentOrderDraft[idx].quantity += delta;
    if (currentOrderDraft[idx].quantity <= 0) {
      currentOrderDraft.splice(idx, 1);
    }
  }
  renderSelectedItems();
};

function renderSelectedItems() {
  const container = document.getElementById("selected-items-list");
  if (currentOrderDraft.length === 0) {
    container.innerHTML = '<p class="empty-msg">商品を選択してください</p>';
    return;
  }

  container.innerHTML = currentOrderDraft.map(item => `
    <div class="selected-item-row">
      <span class="item-name">${item.productName}</span>
      <div class="qty-controls">
        <button type="button" class="btn-qty" onclick="changeQty('${item.productName}', -1)">-</button>
        <span class="qty-value">${item.quantity}</span>
        <button type="button" class="btn-qty" onclick="changeQty('${item.productName}', 1)">+</button>
      </div>
    </div>
  `).join('');
}

// =================================================================
// 6. 注文確定・DB保存
// =================================================================
async function submitOrder() {
  const noteInput = document.getElementById("order-note");

  if (!selectedCustomerNumStr) {
    alert("客番（番号札）を選択してください。");
    return;
  }

  if (currentOrderDraft.length === 0) {
    alert("商品を選択してください。");
    return;
  }

  const newOrder = {
    customerNumber: selectedCustomerNumStr,
    items: [...currentOrderDraft],
    note: noteInput.value.trim() || "",
    status: 'pending', // 'pending' | 'completed' | 'cancelled'
    createdAt: useFirebase ? serverTimestamp() : new Date().toISOString(),
    completedAt: null,
    cancelledAt: null,
    cancelReason: null,
    delivered: false // ホール側での配膳完了フラグ
  };

  try {
    if (useFirebase) {
      await addDoc(collection(db, "orders"), newOrder);
    } else {
      // LocalStorage処理
      const localData = getLocalOrders();
      newOrder.id = 'local_' + Date.now();
      localData.push(newOrder);
      saveLocalOrders(localData);
      triggerLocalSync();
    }

    // フォームリセット
    const targetCustomerNum = selectedCustomerNumStr;
    clearCustomerNum();
    noteInput.value = "";
    currentOrderDraft = [];
    renderSelectedItems();

    alert(`客番 ${targetCustomerNum} の注文を送信しました！`);
  } catch (err) {
    console.error("注文保存エラー:", err);
    alert("注文の保存に失敗しました。");
  }
}

// =================================================================
// 7. リアルタイム同期 (Firebase / LocalStorage)
// =================================================================
function setupRealtimeSync() {
  if (useFirebase) {
    const q = query(collection(db, "orders"), orderBy("createdAt", "desc"));
    onSnapshot(q, (snapshot) => {
      allOrders = snapshot.docs.map(docSnap => ({
        id: docSnap.id,
        ...docSnap.data()
      }));
      renderAllViews();
    });
  } else {
    // ローカルストレージ＆タブ間同期モック
    allOrders = getLocalOrders();
    renderAllViews();

    window.addEventListener('storage', (e) => {
      if (e.key === LOCAL_STORAGE_KEY) {
        allOrders = getLocalOrders();
        renderAllViews();
      }
    });
  }
}

function triggerLocalSync() {
  allOrders = getLocalOrders();
  renderAllViews();
  window.dispatchEvent(new Event('storage'));
}

function getLocalOrders() {
  const str = localStorage.getItem(LOCAL_STORAGE_KEY);
  return str ? JSON.parse(str) : [];
}
function saveLocalOrders(orders) {
  localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(orders));
}

// =================================================================
// 8. 各画面＆タブの描画更新
// =================================================================
function renderAllViews() {
  const pendingOrders = allOrders.filter(o => o.status === 'pending');
  const completedOrders = allOrders.filter(o => o.status === 'completed');
  const cancelledOrders = allOrders.filter(o => o.status === 'cancelled');

  // カウント更新
  document.getElementById("pending-badge").innerText = pendingOrders.length;
  document.getElementById("count-pending").innerText = pendingOrders.length;
  document.getElementById("count-completed").innerText = completedOrders.length;
  document.getElementById("count-history").innerText = allOrders.length;
  document.getElementById("count-cancelled").innerText = cancelledOrders.length;

  // 1. キッチン：未調理カード
  renderKitchenCards("cards-pending", pendingOrders, true);

  // 2. キッチン：調理済みカード
  renderKitchenCards("cards-completed", completedOrders, false);

  // 3. キッチン：キャンセルカード
  renderKitchenCards("cards-cancelled", cancelledOrders, false, true);

  // 4. キッチン：注文履歴テーブル
  renderHistoryTable(allOrders);

  // 5. ホール：調理済み配膳モニター (まだ提供完了していないもの)
  renderReadyMonitor(completedOrders.filter(o => !o.delivered));
}

// キッチン用カードレンダラー
function renderKitchenCards(containerId, orders, isPending, isCancelled = false) {
  const container = document.getElementById(containerId);
  if (orders.length === 0) {
    container.innerHTML = '<p class="empty-msg">該当する注文はありません</p>';
    return;
  }

  container.innerHTML = orders.map(o => {
    const timeStr = formatTimestamp(o.createdAt);
    const itemsHtml = o.items.map(i => `
      <li>
        <span>${i.productName}</span>
        <span class="qty">×${i.quantity}</span>
      </li>
    `).join('');

    const noteHtml = o.note ? `<div class="card-note">備考: ${escapeHtml(o.note)}</div>` : '';
    const cancelReasonHtml = (isCancelled && o.cancelReason) 
      ? `<div class="card-note" style="border-color:var(--status-cancelled); color:#fca5a5;">理由: ${escapeHtml(o.cancelReason)}</div>` 
      : '';

    return `
      <div class="kitchen-card" onclick="openOrderDetailModal('${o.id}')">
        <div>
          <div class="card-top-bar">
            <div class="customer-badge-large">
              <span class="label">客番</span>
              <span class="num">${o.customerNumber}</span>
            </div>
            <span class="order-time-tag">${timeStr} 注文</span>
          </div>
          <ul class="card-items-list">
            ${itemsHtml}
          </ul>
          ${noteHtml}
          ${cancelReasonHtml}
        </div>
        <div class="card-actions" onclick="event.stopPropagation()">
          ${isPending ? `
            <button class="btn btn-success btn-large" onclick="markAsCompleted('${o.id}')">
              調理済みにする
            </button>
          ` : ''}
        </div>
      </div>
    `;
  }).join('');
}

// 履歴テーブル描画
function renderHistoryTable(orders) {
  const tbody = document.getElementById("history-table-body");
  if (orders.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-msg">注文履歴がありません</td></tr>';
    return;
  }

  tbody.innerHTML = orders.map(o => {
    const itemsSummary = o.items.map(i => `${i.productName}×${i.quantity}`).join(', ');
    const createdStr = formatTimestamp(o.createdAt);
    const completedStr = formatTimestamp(o.completedAt);
    
    let statusClass = 'pending';
    let statusLabel = '未調理';
    if (o.status === 'completed') { statusClass = 'completed'; statusLabel = '調理済み'; }
    if (o.status === 'cancelled') { statusClass = 'cancelled'; statusLabel = 'キャンセル'; }

    return `
      <tr onclick="openOrderDetailModal('${o.id}')" style="cursor:pointer;">
        <td><strong>No.${o.customerNumber}</strong></td>
        <td>${itemsSummary}</td>
        <td>${createdStr}</td>
        <td>${completedStr}</td>
        <td><span class="status-badge ${statusClass}">${statusLabel}</span></td>
        <td><button class="btn btn-secondary" style="padding:4px 8px; font-size:0.8rem;">詳細</button></td>
      </tr>
    `;
  }).join('');
}

// ホール側：調理済み配膳モニター描画
function renderReadyMonitor(completedOrders) {
  const container = document.getElementById("ready-orders-list");
  if (completedOrders.length === 0) {
    container.innerHTML = '<p class="empty-msg">現在、配膳待ちの料理はありません</p>';
    return;
  }

  container.innerHTML = completedOrders.map(o => {
    const itemsSummary = o.items.map(i => `<li>${i.productName} ×${i.quantity}</li>`).join('');
    return `
      <div class="ready-card">
        <div class="ready-card-header">
          <span class="ready-customer-num">${o.customerNumber}番</span>
          <span class="status-badge completed">調理完了</span>
        </div>
        <ul class="ready-card-items">
          ${itemsSummary}
        </ul>
        <button class="btn btn-primary" style="width:100%;" onclick="markAsDelivered('${o.id}')">
          提供完了 (画面から消去)
        </button>
      </div>
    `;
  }).join('');
}

// =================================================================
// 9. アクション（ステータス更新・キャンセル・提供済み）
// =================================================================
async function updateOrderStatus(orderId, updateData) {
  try {
    if (useFirebase) {
      const orderRef = doc(db, "orders", orderId);
      await updateDoc(orderRef, updateData);
    } else {
      const localData = getLocalOrders();
      const idx = localData.findIndex(o => o.id === orderId);
      if (idx !== -1) {
        localData[idx] = { ...localData[idx], ...updateData };
        saveLocalOrders(localData);
        triggerLocalSync();
      }
    }
  } catch (err) {
    console.error("ステータス更新エラー:", err);
    alert("更新に失敗しました。");
  }
}

async function markAsCompleted(orderId) {
  const updateData = {
    status: 'completed',
    completedAt: useFirebase ? serverTimestamp() : new Date().toISOString()
  };
  await updateOrderStatus(orderId, updateData);
  closeModal();
}

async function markAsDelivered(orderId) {
  await updateOrderStatus(orderId, { delivered: true });
}

// =================================================================
// 10. モーダル＆ダイアログ制御
// =================================================================
function openOrderDetailModal(orderId) {
  const order = allOrders.find(o => o.id === orderId);
  if (!order) return;

  document.getElementById("modal-customer-num").innerText = order.customerNumber;
  document.getElementById("modal-created-time").innerText = `注文時刻: ${formatTimestamp(order.createdAt)}`;
  document.getElementById("modal-note-text").innerText = order.note || "なし";

  // ステータスバッジ
  const statusBadge = document.getElementById("modal-status-badge");
  statusBadge.className = `status-badge ${order.status}`;
  statusBadge.innerText = order.status === 'pending' ? '未調理' : (order.status === 'completed' ? '調理済み' : 'キャンセル');

  // 商品リスト
  document.getElementById("modal-items-list").innerHTML = order.items.map(i => `
    <div class="modal-item-row">
      <span>${i.productName}</span>
      <span>× ${i.quantity}</span>
    </div>
  `).join('');

  // キャンセル理由表示
  const cancelBox = document.getElementById("modal-cancel-reason-box");
  if (order.status === 'cancelled' && order.cancelReason) {
    cancelBox.classList.remove("hidden");
    document.getElementById("modal-cancel-reason-text").innerText = order.cancelReason;
  } else {
    cancelBox.classList.add("hidden");
  }

  // アクションボタン領域
  const footerActions = document.getElementById("modal-footer-actions");
  let actionBtns = `<button class="btn btn-secondary" onclick="closeModal()">閉じる</button>`;

  if (order.status === 'pending') {
    actionBtns += `
      <button class="btn btn-danger" onclick="openCancelPrompt('${order.id}')">キャンセル</button>
      <button class="btn btn-success" onclick="markAsCompleted('${order.id}')">調理済みにする</button>
    `;
  } else if (order.status === 'completed') {
    actionBtns += `
      <button class="btn btn-danger" onclick="openCancelPrompt('${order.id}')">キャンセル</button>
    `;
  }

  footerActions.innerHTML = actionBtns;
  document.getElementById("modal-detail").classList.remove("hidden");
}

function closeModal() {
  document.getElementById("modal-detail").classList.add("hidden");
}

function closeModalOnOverlay(e) {
  if (e.target.id === "modal-detail") closeModal();
}

// キャンセルモーダル制御
function openCancelPrompt(orderId) {
  activeCancelTargetId = orderId;
  document.getElementById("cancel-reason-input").value = "";
  document.getElementById("modal-cancel-prompt").classList.remove("hidden");
}

function closeCancelPrompt() {
  activeCancelTargetId = null;
  document.getElementById("modal-cancel-prompt").classList.add("hidden");
}

function setCancelReason(text) {
  document.getElementById("cancel-reason-input").value = text;
}

async function confirmCancelOrder() {
  if (!activeCancelTargetId) return;

  const reason = document.getElementById("cancel-reason-input").value.trim() || "理由なし";
  
  const updateData = {
    status: 'cancelled',
    cancelledAt: useFirebase ? serverTimestamp() : new Date().toISOString(),
    cancelReason: reason
  };

  await updateOrderStatus(activeCancelTargetId, updateData);
  closeCancelPrompt();
  closeModal();
}

// =================================================================
// 11. 画面＆タブ切替ナビゲーション
// =================================================================
function switchMainView(viewName) {
  document.querySelectorAll(".main-view").forEach(el => el.classList.remove("active"));
  document.querySelectorAll(".nav-btn").forEach(el => el.classList.remove("active"));

  if (viewName === 'hall') {
    document.getElementById("view-hall").classList.add("active");
    document.getElementById("btn-view-hall").classList.add("active");
  } else {
    document.getElementById("view-kitchen").classList.add("active");
    document.getElementById("btn-view-kitchen").classList.add("active");
  }
}

function switchKitchenTab(tabName) {
  document.querySelectorAll(".kitchen-tab-content").forEach(el => el.classList.remove("active"));
  document.querySelectorAll(".tab-btn").forEach(el => el.classList.remove("active"));

  document.getElementById(`tab-${tabName}`).classList.add("active");
  event.currentTarget.classList.add("active");
}

// =================================================================
// ユーティリティ
// =================================================================
function formatTimestamp(ts) {
  if (!ts) return "--:--";
  let date;
  if (ts.toDate) {
    date = ts.toDate();
  } else if (typeof ts === 'string') {
    date = new Date(ts);
  } else {
    return "--:--";
  }
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
const STORAGE_KEY = "bible-checkin-web-db-v2";
const SESSION_KEY = "bible-checkin-web-session-v2";
const REMINDER_KEY = "bible-checkin-reminded-v1";
const BEIJING_TZ = "Asia/Shanghai";
const REMINDER_HOUR = 21;
const REMINDER_MINUTE = 30;

const app = document.querySelector("#app");
let monthIndex = 0;

const VERSES = [
  { text: "耶和华是我的牧者，我必不至缺乏。", ref: "诗篇 23:1" },
  { text: "你要专心仰赖耶和华，不可倚靠自己的聪明。", ref: "箴言 3:5" },
  { text: "疲乏的，他赐能力；软弱的，他加力量。", ref: "以赛亚书 40:29" },
  { text: "应当一无挂虑，只要凡事借着祷告、祈求和感谢，将你们所要的告诉神。", ref: "腓立比书 4:6" },
  { text: "神爱世人，甚至将他的独生子赐给他们。", ref: "约翰福音 3:16" },
  { text: "你们要先求他的国和他的义，这些东西都要加给你们了。", ref: "马太福音 6:33" },
  { text: "我靠着那加给我力量的，凡事都能做。", ref: "腓立比书 4:13" },
  { text: "你们要将一切的忧虑卸给神，因为他顾念你们。", ref: "彼得前书 5:7" },
  { text: "爱是恒久忍耐，又有恩慈。", ref: "哥林多前书 13:4" },
  { text: "你当刚强壮胆，不要惧怕，也不要惊惶。", ref: "约书亚记 1:9" }
];

const OPENING_VERSE = pickOpeningVerse();

function defaultDb() {
  return {
    nextUserId: 1,
    nextMemberId: 1,
    nextCheckinId: 1,
    nextMessageId: 1,
    users: [],
    groupMembers: [],
    checkinRecords: [],
    chatMessages: []
  };
}

function loadDb() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || defaultDb();
  } catch {
    return defaultDb();
  }
}

function saveDb(db) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
}

function getSession() {
  return Number(localStorage.getItem(SESSION_KEY) || 0);
}

function setSession(userId) {
  if (userId) localStorage.setItem(SESSION_KEY, String(userId));
  else localStorage.removeItem(SESSION_KEY);
}

function normalizeAccount(value) {
  return String(value || "").trim().replace(/\D/g, "");
}

function isValidAccount(account) {
  return /^\d{8}$/.test(account);
}

function cleanName(name, fallback) {
  const value = String(name || "").trim() || fallback;
  return value.slice(0, 24);
}

function beijingParts() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BEIJING_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return {
    date: `${map.year}-${map.month}-${map.day}`,
    month: `${map.year}-${map.month}`
  };
}

function beijingClockParts() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BEIJING_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(new Date());
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return {
    date: `${map.year}-${map.month}-${map.day}`,
    month: `${map.year}-${map.month}`,
    hour: Number(map.hour),
    minute: Number(map.minute)
  };
}

function nowIso() {
  return new Date().toISOString();
}

async function sha256(text) {
  if (!globalThis.crypto?.subtle) return simpleHash(text);
  const bytes = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function simpleHash(text) {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `fallback:${(h2 >>> 0).toString(16).padStart(8, "0")}${(h1 >>> 0).toString(16).padStart(8, "0")}`;
}

function byId(db, userId) {
  return db.users.find((u) => u.id === userId);
}

function isSuperAdmin(user) {
  return user?.account === "20010927";
}

function availableMonths(db) {
  const current = beijingParts().month;
  const months = [...new Set([current, ...db.checkinRecords.map((r) => r.month)])];
  return months.sort().reverse();
}

function hasCheckedOnDate(db, userId, date) {
  return db.checkinRecords.some((r) => r.userId === userId && r.checkinDate === date);
}

function isAfterReminderTime(clock) {
  return clock.hour > REMINDER_HOUR || (clock.hour === REMINDER_HOUR && clock.minute >= REMINDER_MINUTE);
}

function userReminderKey(userId, date) {
  return `${REMINDER_KEY}:${userId}:${date}`;
}

function notifyUser(title, body) {
  if ("Notification" in window && Notification.permission === "granted") {
    new Notification(title, { body, icon: "./assets/app-icon.png" });
  }
  toast(body);
}

function checkDailyReminder() {
  const db = loadDb();
  const user = byId(db, getSession());
  if (!user) return;
  const clock = beijingClockParts();
  if (!isAfterReminderTime(clock)) return;
  if (hasCheckedOnDate(db, user.id, clock.date)) return;
  const key = userReminderKey(user.id, clock.date);
  if (localStorage.getItem(key)) return;
  localStorage.setItem(key, "1");
  notifyUser("读经打卡提醒", "现在已经过了晚上 9:30，今天还没有打卡。");
}

async function requestNotificationAccess() {
  if (!("Notification" in window)) return toast("当前浏览器不支持系统通知");
  if (Notification.permission === "granted") return toast("系统提醒已开启");
  const permission = await Notification.requestPermission();
  toast(permission === "granted" ? "系统提醒已开启" : "系统提醒未开启");
}

function isMentionForUser(text, user) {
  const value = String(text || "");
  return value.includes("@所有人")
    || value.includes(`@${user.displayName}`)
    || value.includes(`@${user.account}`);
}

function shouldNotifyChatMessage(message, currentUser) {
  if (!currentUser || message.userId === currentUser.id) return false;
  if (!currentUser.chatMuted) return true;
  return isMentionForUser(message.text, currentUser);
}

function notifyChatMessage(message, sender, currentUser) {
  if (!shouldNotifyChatMessage(message, currentUser)) return;
  const body = message.type === "image"
    ? `${sender?.displayName || "成员"} 发来了一张图片`
    : `${sender?.displayName || "成员"}：${message.text}`;
  notifyUser("马拉松群聊", body);
}

function render() {
  const db = loadDb();
  const user = byId(db, getSession());
  if (!user) return renderAuth();
  return renderHome(user, db);
}

function html(strings, ...values) {
  return strings.map((s, i) => s + (values[i] ?? "")).join("");
}

function icon(className = "brand-icon") {
  return `<img class="${className}" src="./assets/app-icon.png" alt="读经打卡图标">`;
}

function pickOpeningVerse() {
  const seed = new Uint32Array(1);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(seed);
    return VERSES[seed[0] % VERSES.length];
  }
  return VERSES[Math.floor(Math.random() * VERSES.length)];
}

function renderAuth() {
  app.innerHTML = html`
    <section class="screen auth">
      <div class="brand">
        ${icon()}
        <div>
          <h1>读经打卡</h1>
          <p class="subtitle">使用 8 位数字账号和密码登录。没有账号时，输入新账号和密码即可直接注册。</p>
        </div>
      </div>
      <label class="field">
        <span>8位数账号</span>
        <input id="account" inputmode="numeric" maxlength="8" autocomplete="username" placeholder="例如 12345678">
      </label>
      <label class="field">
        <span>密码</span>
        <input id="password" type="password" autocomplete="current-password" placeholder="至少 6 位">
      </label>
      <label class="field">
        <span>显示名称（新用户填写）</span>
        <input id="displayName" autocomplete="nickname">
      </label>
      <button class="primary" id="login">登录 / 注册</button>
    </section>
  `;

  document.querySelector("#account").addEventListener("input", (event) => {
    event.target.value = normalizeAccount(event.target.value).slice(0, 8);
  });
  document.querySelector("#login").addEventListener("click", loginOrRegister);
}

async function loginOrRegister() {
  const account = normalizeAccount(document.querySelector("#account").value);
  const password = document.querySelector("#password").value;
  const displayName = document.querySelector("#displayName").value;
  if (!isValidAccount(account)) return toast("账号必须是 8 位数字");
  if (password.length < 6) return toast("密码至少 6 位");

  const db = loadDb();
  const existing = db.users.find((u) => u.account === account);
  const passwordHash = await sha256(`${account}:${password}`);

  if (existing) {
    if (existing.passwordHash !== passwordHash) return toast("密码不正确");
    existing.lastLoginAt = nowIso();
    saveDb(db);
    setSession(existing.id);
    toast("登录成功");
    render();
    return;
  }

  const user = {
    id: db.nextUserId++,
    account,
    passwordHash,
    displayName: cleanName(displayName, `成员${account.slice(-4)}`),
    createdAt: nowIso(),
    lastLoginAt: nowIso()
  };
  db.users.push(user);
  db.groupMembers.push({
    id: db.nextMemberId++,
    userId: user.id,
    role: db.groupMembers.length === 0 ? "admin" : "member",
    joinedAt: nowIso()
  });
  saveDb(db);
  setSession(user.id);
  toast("注册并登录成功");
  render();
}

function renderHome(user, db) {
  const { date } = beijingParts();
  const checked = hasCheckedOnDate(db, user.id, date);
  app.innerHTML = html`
    <section class="screen">
      <header class="home-head">
        ${icon("mini-icon")}
        <h1 class="top-title">平安，${escapeHtml(user.displayName)}</h1>
        <button class="text-button" id="mine">我的</button>
      </header>
      <p class="subtitle scripture">
        <span>${escapeHtml(OPENING_VERSE.text)}</span>
        <strong>${escapeHtml(OPENING_VERSE.ref)}</strong>
      </p>
      <div class="home-actions">
        <button class="primary" id="checkin">${checked ? "今日已打卡" : "今日打卡"}</button>
        <button class="primary" id="ranking">排行榜</button>
        <button class="primary" id="members">马拉松成员</button>
        <button class="primary" id="chat">马拉松群聊</button>
      </div>
    </section>
  `;
  document.querySelector("#mine").addEventListener("click", () => renderMine(user));
  document.querySelector("#ranking").addEventListener("click", () => renderRanking());
  document.querySelector("#members").addEventListener("click", () => renderMembers());
  document.querySelector("#chat").addEventListener("click", () => renderChat());
  document.querySelector("#checkin").addEventListener("click", () => checkin(user.id));
}

function checkin(userId) {
  const db = loadDb();
  const { date, month } = beijingParts();
  const exists = db.checkinRecords.some((r) => r.userId === userId && r.checkinDate === date);
  if (exists) {
    toast("今天已经打过卡了");
    render();
    return;
  }
  db.checkinRecords.push({
    id: db.nextCheckinId++,
    userId,
    checkinDate: date,
    month,
    createdAt: nowIso()
  });
  saveDb(db);
  toast("今日已打卡");
  render();
}

function renderRanking() {
  const db = loadDb();
  const months = availableMonths(db);
  if (monthIndex < 0 || monthIndex >= months.length) monthIndex = 0;
  const month = months[monthIndex];
  const rows = db.groupMembers
    .map((member) => {
      const user = byId(db, member.userId);
      const days = db.checkinRecords.filter((r) => r.userId === member.userId && r.month === month).length;
      return { name: user?.displayName || "未知成员", days, userId: member.userId };
    })
    .sort((a, b) => b.days - a.days || a.name.localeCompare(b.name, "zh-Hans-CN") || a.userId - b.userId);

  app.innerHTML = html`
    <section class="screen">
      ${nav("排行榜")}
      <div class="month-row">
        <button class="back" id="prevMonth" ${monthIndex >= months.length - 1 ? "disabled" : ""}>&lt;</button>
        <strong>${month}</strong>
        <button class="back" id="nextMonth" ${monthIndex <= 0 ? "disabled" : ""}>&gt;</button>
      </div>
      <div class="rank-table">
        <div class="rank-row rank-head"><span>排名</span><span>用户名称</span><span>天数</span></div>
        ${rows.map((row, index) => `
          <div class="rank-row">
            <span>${index + 1}</span>
            <span>${escapeHtml(row.name)}</span>
            <span>${row.days}天</span>
          </div>
        `).join("")}
      </div>
    </section>
  `;
  bindBack();
  document.querySelector("#prevMonth").addEventListener("click", () => {
    monthIndex++;
    renderRanking();
  });
  document.querySelector("#nextMonth").addEventListener("click", () => {
    monthIndex--;
    renderRanking();
  });
}

function renderMembers() {
  const db = loadDb();
  const currentUser = byId(db, getSession());
  if (!currentUser) return renderAuth();
  const canDeleteMembers = isSuperAdmin(currentUser);
  const rows = db.groupMembers
    .map((member) => {
      const user = byId(db, member.userId);
      return {
        userId: member.userId,
        account: user?.account || "-------",
        name: user?.displayName || "未知成员",
        joinedAt: member.joinedAt || ""
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN") || a.account.localeCompare(b.account));

  app.innerHTML = html`
    <section class="screen">
      ${nav("马拉松成员")}
      <div class="member-summary">
        <span>当前成员</span>
        <strong>${rows.length}人</strong>
      </div>
      <div class="member-list">
        ${rows.map((row) => `
          <div class="member-row">
            <div>
              <strong>${escapeHtml(row.name)}</strong>
              <span>账号 ${escapeHtml(row.account)}</span>
            </div>
            ${canDeleteMembers && row.userId !== currentUser.id ? `
              <button class="member-delete" data-user-id="${row.userId}" data-name="${escapeAttr(row.name)}">删除</button>
            ` : ""}
          </div>
        `).join("")}
      </div>
    </section>
  `;
  bindBack();
  document.querySelectorAll(".member-delete").forEach((button) => {
    button.addEventListener("click", () => {
      const userId = Number(button.dataset.userId);
      const name = button.dataset.name || "该成员";
      if (confirm(`确定删除 ${name} 吗？`)) {
        deleteMember(userId);
      }
    });
  });
}

function deleteMember(userId) {
  const db = loadDb();
  const currentUser = byId(db, getSession());
  if (!isSuperAdmin(currentUser)) return toast("没有删除权限");
  if (userId === currentUser.id) return toast("不能删除当前登录账号");
  const target = byId(db, userId);
  if (!target) return toast("成员不存在");

  db.users = db.users.filter((user) => user.id !== userId);
  db.groupMembers = db.groupMembers.filter((member) => member.userId !== userId);
  db.checkinRecords = db.checkinRecords.filter((record) => record.userId !== userId);
  if (Array.isArray(db.chatMessages)) {
    db.chatMessages = db.chatMessages.filter((message) => message.userId !== userId);
  }
  saveDb(db);
  toast(`已删除：${target.displayName}`);
  renderMembers();
}

function renderChat() {
  const db = loadDb();
  const user = byId(db, getSession());
  if (!user) return renderAuth();
  const messages = Array.isArray(db.chatMessages) ? db.chatMessages : [];
  const muteText = user.chatMuted ? "免打扰：开" : "免打扰：关";

  app.innerHTML = html`
    <section class="screen chat-screen">
      ${nav("马拉松群聊")}
      <div class="chat-tools">
        <button class="secondary mute-toggle" id="muteToggle">${muteText}</button>
        <span>@昵称、@账号、@所有人 会提醒</span>
      </div>
      <div class="chat-list" id="chatList">
        ${messages.length === 0 ? `
          <div class="empty-chat">还没有消息</div>
        ` : messages.map((message) => {
          const sender = byId(db, message.userId);
          const isMine = message.userId === user.id;
          return `
            <div class="chat-message ${isMine ? "mine-message" : ""}">
              <div class="chat-meta">${escapeHtml(sender?.displayName || "未知成员")}</div>
              <div class="chat-bubble">
                ${message.type === "image" ? `
                  <img class="chat-image" src="${escapeAttr(message.imageData || "")}" alt="${escapeAttr(message.imageName || "聊天图片")}">
                  ${message.text ? `<span class="chat-caption">${escapeHtml(message.text)}</span>` : ""}
                ` : escapeHtml(message.text || "")}
              </div>
            </div>
          `;
        }).join("")}
      </div>
      <form class="chat-compose" id="chatForm">
        <input id="chatInput" maxlength="300" autocomplete="off" placeholder="输入消息">
        <input id="imageInput" class="hidden-file" type="file" accept="image/*">
        <button class="image-send" id="imageButton" type="button">图片</button>
        <button type="submit">发送</button>
      </form>
    </section>
  `;
  bindBack();
  document.querySelector("#muteToggle").addEventListener("click", toggleChatMute);
  document.querySelector("#imageButton").addEventListener("click", () => document.querySelector("#imageInput").click());
  document.querySelector("#imageInput").addEventListener("change", sendImageMessage);
  document.querySelector("#chatForm").addEventListener("submit", sendChatMessage);
  document.querySelector("#chatInput").focus();
  document.querySelector("#chatList").scrollTop = document.querySelector("#chatList").scrollHeight;
}

function toggleChatMute() {
  const db = loadDb();
  const user = byId(db, getSession());
  if (!user) return renderAuth();
  user.chatMuted = !user.chatMuted;
  saveDb(db);
  toast(user.chatMuted ? "群聊免打扰已开启，@你仍会提醒" : "群聊免打扰已关闭");
  renderChat();
}

function sendChatMessage(event) {
  event.preventDefault();
  const db = loadDb();
  const user = byId(db, getSession());
  if (!user) return renderAuth();
  const input = document.querySelector("#chatInput");
  const text = input.value.trim();
  if (!text) return toast("消息不能为空");
  if (!Array.isArray(db.chatMessages)) db.chatMessages = [];
  if (!db.nextMessageId) db.nextMessageId = 1;
  db.chatMessages.push({
    id: db.nextMessageId++,
    type: "text",
    userId: user.id,
    text,
    createdAt: nowIso()
  });
  saveDb(db);
  renderChat();
}

function sendImageMessage(event) {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;
  if (!file.type.startsWith("image/")) return toast("请选择图片文件");
  if (file.size > 2 * 1024 * 1024) return toast("图片不能超过 2MB");

  const reader = new FileReader();
  reader.onload = () => {
    const db = loadDb();
    const user = byId(db, getSession());
    if (!user) return renderAuth();
    const caption = document.querySelector("#chatInput")?.value.trim() || "";
    if (!Array.isArray(db.chatMessages)) db.chatMessages = [];
    if (!db.nextMessageId) db.nextMessageId = 1;
    db.chatMessages.push({
      id: db.nextMessageId++,
      type: "image",
      userId: user.id,
      text: caption,
      imageData: String(reader.result || ""),
      imageName: file.name,
      createdAt: nowIso()
    });
    saveDb(db);
    renderChat();
  };
  reader.onerror = () => toast("图片读取失败");
  reader.readAsDataURL(file);
}

function renderMine(user) {
  app.innerHTML = html`
    <section class="screen">
      ${nav("我的")}
      <div class="mine-stack">
        <span class="section-label">账号</span>
        <div class="value">${escapeHtml(user.account)}</div>

        <label class="field">
          <span>修改名称</span>
          <input id="name" value="${escapeAttr(user.displayName)}">
        </label>
        <button class="primary" id="saveName">保存名称</button>

        <button class="secondary" id="enableNotifications">开启系统提醒</button>

        <button class="text-button danger" id="logout">退出登录</button>
      </div>
    </section>
  `;
  bindBack();
  document.querySelector("#saveName").addEventListener("click", saveName);
  document.querySelector("#enableNotifications").addEventListener("click", requestNotificationAccess);
  document.querySelector("#logout").addEventListener("click", () => {
    setSession(0);
    toast("已退出登录");
    render();
  });
}

function saveName() {
  const db = loadDb();
  const user = byId(db, getSession());
  if (!user) return render();
  const name = cleanName(document.querySelector("#name").value, "");
  if (!name) return toast("名称不能为空");
  user.displayName = name;
  saveDb(db);
  toast("名称已保存");
  renderMine(user);
}

function nav(title) {
  return `<header class="nav"><button class="back" id="back">&lt;</button><h1>${title}</h1><span></span></header>`;
}

function bindBack() {
  document.querySelector("#back").addEventListener("click", () => {
    const db = loadDb();
    const user = byId(db, getSession());
    if (user) renderHome(user, db);
    else renderAuth();
  });
}

function toast(message) {
  document.querySelector(".toast")?.remove();
  const node = document.createElement("div");
  node.className = "toast";
  node.textContent = message;
  document.body.appendChild(node);
  setTimeout(() => node.remove(), 1800);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[ch]));
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, "&#096;");
}

render();
checkDailyReminder();
setInterval(checkDailyReminder, 60 * 1000);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) checkDailyReminder();
});

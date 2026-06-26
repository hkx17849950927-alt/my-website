const APP_VERSION = "2026.06.26-chat-push1";
const REMINDER_KEY = "bible-checkin-reminded-v1";
const BEIJING_TZ = "Asia/Shanghai";
const REMINDER_HOUR = 21;
const REMINDER_MINUTE = 30;
const SUPER_ADMIN_ACCOUNT = "20010927";
const CHAT_IMAGE_BUCKET = "chat-images";
const PUSH_PUBLIC_KEY = "BFG5J_XNlkijsOExggjOj2XmXyJoQCjdZC9sw3oJqrlFleT5GyUoWnkbFdeBiJKLEI9HLp4RWImLT0u6kXIAVAA";
const PROFILE_CACHE_KEY = "bible-checkin-profile-cache-v1";
const CHECKIN_CACHE_KEY = "bible-checkin-checkin-cache-v1";
const CHAT_CACHE_KEY = "bible-checkin-chat-cache-v1";
const CHAT_SEEN_KEY = "bible-checkin-chat-seen-v1";
const MIN_LOADING_MS = 5000;
const VERSION_CHECK_INTERVAL_MS = 5 * 60 * 1000;

const app = document.querySelector("#app");
const supabaseClient = window.supabase?.createClient(
  window.SUPABASE_URL || "",
  window.SUPABASE_ANON_KEY || window.SUPABASE_KEY || ""
);

let monthIndex = 0;
let currentSession = null;
let currentUser = null;
let currentView = "home";
let chatChannel = null;
let profileCache = new Map();
let chatPollTimer = null;
let lastChatCreatedAt = null;
let authRetryTimer = null;
let reminderLoopsStarted = false;
let startupGateOpen = false;
let loadingCountdownTimer = null;
let versionCheckTimer = null;
let updatePromptShown = false;

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
const LOADING_SCENES = [
  { image: "./assets/loading-1.jpg", verse: "你们要休息，要知道我是神。", ref: "诗篇 46:10" },
  { image: "./assets/loading-2.jpg", verse: "耶和华是我的亮光，是我的拯救。", ref: "诗篇 27:1" },
  { image: "./assets/loading-3.jpg", verse: "疲乏的，他赐能力；软弱的，他加力量。", ref: "以赛亚书 40:29" },
  { image: "./assets/loading-4.jpg", verse: "我的帮助从造天地的耶和华而来。", ref: "诗篇 121:2" }
];
const LOADING_SCENE = pickLoadingScene();

function requireSupabase() {
  return Boolean(supabaseClient && window.SUPABASE_URL && (window.SUPABASE_ANON_KEY || window.SUPABASE_KEY));
}

function accountEmail(account) {
  return `${account}@bible-checkin.local`;
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

function isSuperAdmin(user) {
  return user?.account === SUPER_ADMIN_ACCOUNT;
}

function isAfterReminderTime(clock) {
  return clock.hour > REMINDER_HOUR || (clock.hour === REMINDER_HOUR && clock.minute >= REMINDER_MINUTE);
}

function userReminderKey(userId, date) {
  return `${REMINDER_KEY}:${userId}:${date}`;
}

function readCache(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}

function writeCache(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Local cache is only for speed. If storage is full, the app still works online.
  }
}

function clearAppCache() {
  localStorage.removeItem(PROFILE_CACHE_KEY);
  localStorage.removeItem(CHECKIN_CACHE_KEY);
  localStorage.removeItem(CHAT_CACHE_KEY);
  localStorage.removeItem(CHAT_SEEN_KEY);
}

function cacheProfile(profile) {
  if (profile) writeCache(PROFILE_CACHE_KEY, profile);
}

function getCachedProfile() {
  return readCache(PROFILE_CACHE_KEY, null);
}

function getCachedCheckins() {
  return readCache(CHECKIN_CACHE_KEY, {});
}

function isCachedChecked(userId, date) {
  return Boolean(getCachedCheckins()[`${userId}:${date}`]);
}

function setCachedChecked(userId, date, checked) {
  const cache = getCachedCheckins();
  const key = `${userId}:${date}`;
  if (checked) cache[key] = true;
  else delete cache[key];
  writeCache(CHECKIN_CACHE_KEY, cache);
}

function getCachedChatMessages() {
  return readCache(CHAT_CACHE_KEY, []);
}

function cacheChatMessages(messages) {
  writeCache(CHAT_CACHE_KEY, (messages || []).slice(-30));
}

function latestChatCreatedAt(messages, userId, excludeOwn = false) {
  return (messages || [])
    .filter((message) => message.created_at && (!excludeOwn || message.user_id !== userId))
    .map((message) => message.created_at)
    .sort()
    .at(-1) || "";
}

function getChatSeenAt(userId) {
  return readCache(CHAT_SEEN_KEY, {})[userId] || "";
}

function setChatSeenAt(userId, createdAt) {
  if (!userId || !createdAt) return;
  const cache = readCache(CHAT_SEEN_KEY, {});
  if (!cache[userId] || createdAt > cache[userId]) {
    cache[userId] = createdAt;
    writeCache(CHAT_SEEN_KEY, cache);
  }
}

function hasUnreadChat(userId) {
  const latestOtherMessage = latestChatCreatedAt(getCachedChatMessages(), userId, true);
  return Boolean(latestOtherMessage && latestOtherMessage > getChatSeenAt(userId));
}

function updateChatUnreadIndicator(unread) {
  const button = document.querySelector("#chat");
  if (!button) return;
  button.classList.toggle("has-unread", Boolean(unread));
}

function notificationPermissionGranted() {
  return "Notification" in window && Notification.permission === "granted";
}

function notifyUser(title, body) {
  if (notificationPermissionGranted()) {
    new Notification(title, { body, icon: "./assets/app-icon.png" });
  }
  toast(body);
}

async function requestNotificationAccess() {
  if (!("Notification" in window)) return toast("当前浏览器不支持系统通知");
  if (Notification.permission === "granted") {
    toast("系统提醒已开启");
    renderMine(currentUser);
    return;
  }
  const permission = await Notification.requestPermission();
  toast(permission === "granted" ? "系统提醒已开启" : "系统提醒未开启");
  renderMine(currentUser);
}

function supportPushNotifications() {
  return "serviceWorker" in navigator
    && "PushManager" in window
    && "Notification" in window;
}

function urlBase64ToUint8Array(value) {
  const padding = "=".repeat((4 - value.length % 4) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
}

function subscriptionToRecord(subscription) {
  const value = subscription.toJSON();
  return {
    user_id: currentUser.id,
    endpoint: value.endpoint,
    p256dh: value.keys?.p256dh || "",
    auth: value.keys?.auth || "",
    user_agent: navigator.userAgent,
    enabled: true
  };
}

async function requestPushNotifications() {
  if (!supportPushNotifications()) return toast("当前浏览器不支持后台推送");
  if (!PUSH_PUBLIC_KEY) return toast("后台推送密钥还没配置，下一步需要先生成密钥");

  const permission = Notification.permission === "granted"
    ? "granted"
    : await Notification.requestPermission();
  if (permission !== "granted") return toast("系统通知权限未开启");

  try {
    const registration = await navigator.serviceWorker.ready;
    const existing = await registration.pushManager.getSubscription();
    const subscription = existing || await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(PUSH_PUBLIC_KEY)
    });

    const { error } = await supabaseClient
      .from("push_subscriptions")
      .upsert(subscriptionToRecord(subscription), { onConflict: "user_id,endpoint" });
    if (error) return toast(`推送订阅保存失败：${error.message}`);

    const { count, error: countError } = await supabaseClient
      .from("push_subscriptions")
      .select("id", { count: "exact", head: true })
      .eq("user_id", currentUser.id)
      .eq("enabled", true);
    if (countError) return toast(`订阅已生成，保存检查失败：${countError.message}`);
    toast(`后台推送提醒已开启，数据库订阅 ${count || 0} 个`);
  } catch (error) {
    toast(`后台推送开启失败：${error.message || "请换浏览器再试"}`);
  }
}

async function disablePushNotifications() {
  if (!supportPushNotifications()) return toast("当前浏览器不支持后台推送");
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (subscription) {
      await supabaseClient
        .from("push_subscriptions")
        .update({ enabled: false })
        .eq("user_id", currentUser.id)
        .eq("endpoint", subscription.endpoint);
      await subscription.unsubscribe();
    }
    toast("后台推送提醒已关闭");
  } catch (error) {
    toast(`关闭失败：${error.message || "请稍后再试"}`);
  }
}

async function sendTestPushNotification() {
  if (!supportPushNotifications()) return toast("当前浏览器不支持后台推送");
  if (!PUSH_PUBLIC_KEY) return toast("后台推送密钥还没配置");

  try {
    const { data, error } = await supabaseClient.functions.invoke("send-test-push", {
      body: {
        title: "读经打卡测试提醒",
        body: "如果你看到了这条通知，后台推送已经连通。",
        url: "./"
      }
    });
    if (error) return toast(`测试推送失败：${error.message}`);
    const total = Number(data?.total || 0);
    const sent = Number(data?.sent || 0);
    if (total === 0) return toast("没有找到推送订阅，请先点开启后台推送提醒");
    toast(sent > 0 ? `测试推送已发送：${sent}/${total}` : `测试推送未送达：0/${total}`);
  } catch (error) {
    toast(`测试推送失败：${error.message || "请确认 Edge Function 已部署"}`);
  }
}

async function sendChatPushNotification(messageId) {
  if (!messageId) return;
  try {
    await supabaseClient.functions.invoke("send-chat-push", {
      body: { message_id: messageId }
    });
  } catch {
    // Chat sending should not fail just because background push delivery failed.
  }
}

async function checkPushStatus() {
  const support = supportPushNotifications();
  const permission = "Notification" in window ? Notification.permission : "unsupported";
  let swReady = false;
  let hasSubscription = false;
  let savedCount = null;
  let errorText = "";

  try {
    if (support) {
      const registration = await navigator.serviceWorker.ready;
      swReady = Boolean(registration?.active);
      const subscription = await registration.pushManager.getSubscription();
      hasSubscription = Boolean(subscription);
    }

    if (currentUser) {
      const { count, error } = await supabaseClient
        .from("push_subscriptions")
        .select("id", { count: "exact", head: true })
        .eq("user_id", currentUser.id)
        .eq("enabled", true);
      if (error) errorText = error.message;
      else savedCount = count || 0;
    }
  } catch (error) {
    errorText = error.message || "检查失败";
  }

  const parts = [
    support ? "浏览器支持" : "浏览器不支持",
    `权限：${permission}`,
    swReady ? "后台脚本正常" : "后台脚本未就绪",
    hasSubscription ? "本机已订阅" : "本机未订阅",
    savedCount === null ? "数据库未检查" : `数据库 ${savedCount} 个`
  ];
  if (errorText) parts.push(`错误：${errorText}`);
  toast(parts.join("，"));
}

function isMentionForUser(text, user) {
  const value = String(text || "");
  return value.includes("@所有人")
    || value.includes(`@${user.display_name}`)
    || value.includes(`@${user.account}`);
}

function shouldNotifyChatMessage(message, currentProfile) {
  if (!currentProfile || message.user_id === currentProfile.id) return false;
  if (!currentProfile.chat_muted) return true;
  return isMentionForUser(message.text, currentProfile);
}

async function notifyChatMessage(message) {
  if (!shouldNotifyChatMessage(message, currentUser)) return;
  const sender = await getProfile(message.user_id);
  const body = message.type === "image"
    ? `${sender?.display_name || "成员"} 发来了一张图片`
    : `${sender?.display_name || "成员"}：${message.text}`;
  notifyUser("马拉松群聊", body);
}

async function getProfile(userId) {
  const { data } = await supabaseClient
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle();
  return data || null;
}

function withTimeout(promise, timeoutMs, fallback) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(fallback), timeoutMs))
  ]);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stopLoadingCountdown() {
  if (!loadingCountdownTimer) return;
  clearInterval(loadingCountdownTimer);
  loadingCountdownTimer = null;
}

function hasStoredAuthSession() {
  try {
    return Object.keys(localStorage).some((key) => key.startsWith("sb-") && key.endsWith("-auth-token"));
  } catch {
    return false;
  }
}

async function loadCurrentProfile() {
  const result = await withTimeout(
    supabaseClient.auth.getSession(),
    12000,
    { timedOut: true, data: { session: null } }
  );
  if (result.timedOut && hasStoredAuthSession()) return "pending";
  const sessionData = result.data;
  currentSession = sessionData.session;
  if (!currentSession?.user) {
    currentUser = null;
    return null;
  }
  currentUser = await getProfile(currentSession.user.id);
  cacheProfile(currentUser);
  return currentUser;
}

function renderLoading() {
  currentView = "loading";
  closeChatRealtime();
  stopLoadingCountdown();
  app.innerHTML = html`
    <section class="loading-screen" style="background-image: url('${escapeAttr(LOADING_SCENE.image)}')">
      <div class="loading-countdown"><span id="loadingCountdown">5</span>s</div>
      <div class="loading-overlay">
        ${icon("loading-icon")}
        <p>${escapeHtml(LOADING_SCENE.verse)}</p>
        <strong>${escapeHtml(LOADING_SCENE.ref)}</strong>
      </div>
    </section>
  `;
  const startedAt = Date.now();
  loadingCountdownTimer = setInterval(() => {
    const remaining = Math.max(0, Math.ceil((MIN_LOADING_MS - (Date.now() - startedAt)) / 1000));
    const node = document.querySelector("#loadingCountdown");
    if (node) node.textContent = String(remaining);
    if (remaining <= 0) stopLoadingCountdown();
  }, 150);
}

function scheduleAuthRetry() {
  clearTimeout(authRetryTimer);
  authRetryTimer = setTimeout(async () => {
    const profile = await loadCurrentProfile();
    if (profile === "pending") {
      if (!currentUser) renderLoading();
      scheduleAuthRetry();
      return;
    }
    await render();
    startReminderLoops();
  }, 1200);
}

function startReminderLoops() {
  if (reminderLoopsStarted) return;
  reminderLoopsStarted = true;
  checkDailyReminder();
  setInterval(checkDailyReminder, 60 * 1000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) checkDailyReminder();
  });
}

async function init() {
  startUpdateChecks();

  if (!requireSupabase()) {
    renderError("Supabase 还没有配置好，请检查 supabase-config.js。");
    return;
  }

  renderLoading();
  const cachedProfile = getCachedProfile();
  if (cachedProfile && hasStoredAuthSession()) {
    currentUser = cachedProfile;
  }

  supabaseClient.auth.onAuthStateChange(async () => {
    const profile = await loadCurrentProfile();
    if (!startupGateOpen) return;
    if (profile === "pending") {
      if (!currentUser) renderLoading();
      scheduleAuthRetry();
      return;
    }
    await render();
  });

  const authPromise = loadCurrentProfile();
  await wait(MIN_LOADING_MS);
  startupGateOpen = true;

  if (currentUser) {
    renderHome(currentUser);
    startReminderLoops();
    authPromise.then(async (profile) => {
      if (profile === "pending") {
        scheduleAuthRetry();
        return;
      }
      if (profile) {
        await render();
        startReminderLoops();
      }
    });
    return;
  }

  const profile = await authPromise;
  if (profile === "pending") {
    renderLoading();
    scheduleAuthRetry();
    return;
  }
  await render();
  startReminderLoops();
}

function startUpdateChecks() {
  if (versionCheckTimer) return;
  checkForAppUpdate();
  versionCheckTimer = setInterval(checkForAppUpdate, VERSION_CHECK_INTERVAL_MS);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) checkForAppUpdate();
  });
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.ready
      .then((registration) => registration.update())
      .catch(() => {});
  }
}

async function checkForAppUpdate() {
  try {
    const response = await fetch(`./version.json?ts=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) return;
    const latest = await response.json();
    if (latest?.version && latest.version !== APP_VERSION) {
      showUpdatePrompt(latest.version);
    }
  } catch {
    // Update checks are best-effort. Offline users can keep using cached content.
  }
}

function showUpdatePrompt(version) {
  if (updatePromptShown || document.querySelector(".update-banner")) return;
  updatePromptShown = true;
  const banner = document.createElement("div");
  banner.className = "update-banner";
  banner.innerHTML = `
    <span>发现新版本</span>
    <button type="button" id="refreshApp">更新</button>
  `;
  document.body.appendChild(banner);
  document.querySelector("#refreshApp").addEventListener("click", () => refreshApp(version));
}

async function refreshApp() {
  const button = document.querySelector("#refreshApp");
  if (button) {
    button.disabled = true;
    button.textContent = "更新中";
  }
  try {
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith("bible-checkin-"))
          .map((key) => caches.delete(key))
      );
    }
    if ("serviceWorker" in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(
        registrations
          .filter((registration) => registration.scope.includes(location.origin))
          .map((registration) => registration.unregister())
      );
    }
  } finally {
    const url = new URL(window.location.href);
    url.searchParams.set("v", APP_VERSION);
    url.searchParams.set("refresh", String(Date.now()));
    window.location.replace(url.toString());
  }
}

async function render() {
  clearTimeout(authRetryTimer);
  stopLoadingCountdown();
  closeChatRealtime();
  if (!currentUser) return renderAuth();
  return renderHome(currentUser);
}

function renderError(message) {
  app.innerHTML = html`
    <section class="screen auth">
      <div class="brand">
        ${icon()}
        <div>
          <h1>读经打卡</h1>
          <p class="subtitle">${escapeHtml(message)}</p>
        </div>
      </div>
    </section>
  `;
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

function pickLoadingScene() {
  const seed = new Uint32Array(1);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(seed);
    return LOADING_SCENES[seed[0] % LOADING_SCENES.length];
  }
  return LOADING_SCENES[Math.floor(Math.random() * LOADING_SCENES.length)];
}

function renderAuth() {
  currentView = "auth";
  app.innerHTML = html`
    <section class="screen auth">
      <div class="brand">
        ${icon()}
        <div>
          <h1>读经打卡</h1>
          <p class="subtitle">使用 8 位数字账号和密码登录。没有账号时，输入新账号和密码即可注册。</p>
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

  setBusy("#login", true, "请稍候");
  const email = accountEmail(account);
  const loginResult = await supabaseClient.auth.signInWithPassword({ email, password });

  if (!loginResult.error) {
    await loadCurrentProfile();
    toast("登录成功");
    await render();
    return;
  }

  const registerResult = await supabaseClient.auth.signUp({
    email,
    password,
    options: {
      data: {
        account,
        display_name: cleanName(displayName, `成员${account.slice(-4)}`)
      }
    }
  });

  if (registerResult.error) {
    setBusy("#login", false, "登录 / 注册");
    return toast(friendlyAuthError(registerResult.error.message));
  }

  const userId = registerResult.data.user?.id;
  if (!userId) {
    setBusy("#login", false, "登录 / 注册");
    return toast("注册失败，请确认邮箱验证已经关闭");
  }

  const profile = {
    id: userId,
    account,
    display_name: cleanName(displayName, `成员${account.slice(-4)}`)
  };
  const { error: profileError } = await supabaseClient.from("profiles").insert(profile);
  if (profileError && profileError.code !== "23505") {
    setBusy("#login", false, "登录 / 注册");
    return toast(`资料创建失败：${profileError.message}`);
  }

  await loadCurrentProfile();
  toast("注册并登录成功");
  await render();
}

function friendlyAuthError(message) {
  if (/invalid login credentials/i.test(message)) return "账号或密码不正确";
  if (/already registered|already exists/i.test(message)) return "账号已存在，请检查密码";
  return message || "操作失败";
}

function renderHome(user) {
  currentView = "home";
  const { date } = beijingParts();
  const checked = isCachedChecked(user.id, date);
  const chatUnread = hasUnreadChat(user.id);
  app.innerHTML = html`
    <section class="screen">
      <header class="home-head">
        ${icon("mini-icon")}
        <h1 class="top-title">平安，${escapeHtml(user.display_name)}</h1>
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
        <button class="primary chat-action ${chatUnread ? "has-unread" : ""}" id="chat">马拉松群聊</button>
      </div>
    </section>
  `;
  document.querySelector("#mine").addEventListener("click", () => renderMine(user));
  document.querySelector("#ranking").addEventListener("click", () => renderRanking());
  document.querySelector("#members").addEventListener("click", () => renderMembers());
  document.querySelector("#chat").addEventListener("click", () => renderChat());
  document.querySelector("#checkin").addEventListener("click", () => checkin(user.id));
  syncTodayCheckinState(user.id, date);
  syncChatUnreadState(user.id);
}

async function syncChatUnreadState(userId) {
  const { data, error } = await supabaseClient
    .from("chat_messages")
    .select("created_at")
    .neq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || currentView !== "home" || currentUser?.id !== userId) return;
  updateChatUnreadIndicator(Boolean(data?.created_at && data.created_at > getChatSeenAt(userId)));
}

async function hasCheckedOnDate(userId, date) {
  const { data, error } = await supabaseClient
    .from("checkin_records")
    .select("id")
    .eq("user_id", userId)
    .eq("checkin_date", date)
    .maybeSingle();
  if (error) return false;
  return Boolean(data);
}

async function syncTodayCheckinState(userId, date) {
  const checked = await hasCheckedOnDate(userId, date);
  setCachedChecked(userId, date, checked);
  if (currentView !== "home" || currentUser?.id !== userId) return;
  const button = document.querySelector("#checkin");
  if (button) button.textContent = checked ? "今日已打卡" : "今日打卡";
}

async function checkin(userId) {
  const { date, month } = beijingParts();
  setCachedChecked(userId, date, true);
  const button = document.querySelector("#checkin");
  if (button) {
    button.textContent = "今日已打卡";
    button.disabled = true;
  }
  const { error } = await supabaseClient.from("checkin_records").insert({
    user_id: userId,
    checkin_date: date,
    month
  });

  if (error) {
    if (error.code === "23505") {
      setCachedChecked(userId, date, true);
      toast("今天已经打过卡了");
      renderHome(currentUser);
      return;
    }
    setCachedChecked(userId, date, false);
    if (button) {
      button.textContent = "今日打卡";
      button.disabled = false;
    }
    return toast(`打卡失败：${error.message}`);
  }
  setCachedChecked(userId, date, true);
  toast("今日已打卡");
  renderHome(currentUser);
}

async function availableMonths() {
  const current = beijingParts().month;
  const { data } = await supabaseClient
    .from("checkin_records")
    .select("month")
    .order("month", { ascending: false });
  const months = [...new Set([current, ...(data || []).map((row) => row.month)])];
  return months.sort().reverse();
}

async function renderRanking() {
  currentView = "ranking";
  const months = await availableMonths();
  if (monthIndex < 0 || monthIndex >= months.length) monthIndex = 0;
  const month = months[monthIndex];

  const [{ data: profiles }, { data: records }] = await Promise.all([
    supabaseClient.from("profiles").select("id, account, display_name"),
    supabaseClient.from("checkin_records").select("user_id").eq("month", month)
  ]);

  const dayCount = new Map();
  (records || []).forEach((record) => {
    dayCount.set(record.user_id, (dayCount.get(record.user_id) || 0) + 1);
  });

  const rows = (profiles || [])
    .map((profile) => ({
      userId: profile.id,
      name: profile.display_name || "未知成员",
      days: dayCount.get(profile.id) || 0
    }))
    .sort((a, b) => b.days - a.days || a.name.localeCompare(b.name, "zh-Hans-CN"));

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

async function renderMembers() {
  currentView = "members";
  const { data: profiles, error } = await supabaseClient
    .from("profiles")
    .select("id, account, display_name, created_at")
    .order("display_name", { ascending: true });

  if (error) return toast(`成员读取失败：${error.message}`);

  const rows = profiles || [];
  const canDeleteMembers = isSuperAdmin(currentUser);

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
              <strong>${escapeHtml(row.display_name || "未知成员")}</strong>
              <span>账号 ${escapeHtml(row.account)}</span>
            </div>
            ${canDeleteMembers && row.id !== currentUser.id ? `
              <button class="member-delete" data-user-id="${escapeAttr(row.id)}" data-name="${escapeAttr(row.display_name || "该成员")}">删除</button>
            ` : ""}
          </div>
        `).join("")}
      </div>
    </section>
  `;
  bindBack();
  document.querySelectorAll(".member-delete").forEach((button) => {
    button.addEventListener("click", () => {
      const userId = button.dataset.userId;
      const name = button.dataset.name || "该成员";
      if (confirm(`确定删除 ${name} 吗？`)) deleteMember(userId);
    });
  });
}

async function deleteMember(userId) {
  if (!isSuperAdmin(currentUser)) return toast("没有删除权限");
  if (userId === currentUser.id) return toast("不能删除当前登录账号");
  const { error } = await supabaseClient.from("profiles").delete().eq("id", userId);
  if (error) return toast(`删除失败：${error.message}`);
  toast("已删除成员资料");
  await renderMembers();
}

async function renderChat() {
  currentView = "chat";
  const cachedMessages = getCachedChatMessages();
  renderChatShell(cachedMessages, profileCache);
  refreshChatFromServer();
}

async function refreshChatFromServer() {
  const [{ data: messages, error }, { data: profiles }] = await Promise.all([
    supabaseClient
      .from("chat_messages")
      .select("id,user_id,type,text,image_name,created_at")
      .order("created_at", { ascending: false })
      .limit(20),
    supabaseClient.from("profiles").select("id, display_name")
  ]);

  if (error) return toast(`群聊读取失败：${error.message}`);

  const profileMap = new Map((profiles || []).map((profile) => [profile.id, profile]));
  profileCache = profileMap;
  const visibleMessages = [...(messages || [])].reverse();
  cacheChatMessages(visibleMessages);
  renderChatShell(visibleMessages, profileMap);
}

function renderChatShell(visibleMessages, profileMap) {
  lastChatCreatedAt = visibleMessages.at(-1)?.created_at || new Date().toISOString();
  setChatSeenAt(currentUser.id, latestChatCreatedAt(visibleMessages, currentUser.id));
  const muteText = currentUser.chat_muted ? "免打扰：开" : "免打扰：关";

  app.innerHTML = html`
    <section class="screen chat-screen">
      ${nav("马拉松群聊")}
      <div class="chat-tools">
        <button class="secondary mute-toggle" id="muteToggle">${muteText}</button>
        <span>@昵称、@账号、@所有人 会提醒</span>
      </div>
      <div class="chat-list" id="chatList">
        ${visibleMessages.length === 0 ? `
          <div class="empty-chat">还没有消息</div>
        ` : visibleMessages.map((message) => {
          const sender = profileMap.get(message.user_id) || (message.user_id === currentUser.id ? currentUser : null);
          const isMine = message.user_id === currentUser.id;
          return chatMessageHtml(message, sender, isMine);
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
  bindImageLoadButtons();
  bindChatImagePreview();
  scrollChatBottom();
  openChatRealtime();
  startChatPolling();
}

function chatMessageHtml(message, sender, isMine) {
  return `
    <div class="chat-message ${isMine ? "mine-message" : ""} ${message.pending ? "pending-message" : ""}" data-message-id="${escapeAttr(message.id)}">
      <div class="chat-meta">${escapeHtml(sender?.display_name || "未知成员")}${message.pending ? " · 发送中" : ""}</div>
      <div class="chat-bubble">
        ${message.type === "image" && message.image_data ? `
          <img class="chat-image" src="${escapeAttr(message.image_data || "")}" alt="${escapeAttr(message.image_name || "聊天图片")}" data-full-image="${escapeAttr(message.image_data || "")}">
          ${message.text ? `<span class="chat-caption">${escapeHtml(message.text)}</span>` : ""}
        ` : message.type === "image" ? `
          <button class="image-placeholder" type="button" data-image-id="${escapeAttr(message.id)}">查看图片</button>
          ${message.text ? `<span class="chat-caption">${escapeHtml(message.text)}</span>` : ""}
        ` : escapeHtml(message.text || "")}
      </div>
    </div>
  `;
}

function openChatRealtime() {
  closeChatRealtime();
  chatChannel = supabaseClient
    .channel("chat_messages_live")
    .on("postgres_changes", {
      event: "INSERT",
      schema: "public",
      table: "chat_messages"
    }, async (payload) => {
      if (currentView === "chat") {
        await appendLiveMessage(payload.new);
      }
      await notifyChatMessage(payload.new);
    })
    .subscribe();
}

function closeChatRealtime() {
  stopChatPolling();
  if (!chatChannel) return;
  supabaseClient.removeChannel(chatChannel);
  chatChannel = null;
}

async function appendLiveMessage(message) {
  if (document.querySelector(`[data-message-id="${CSS.escape(message.id)}"]`)) return;
  document.querySelector(".empty-chat")?.remove();
  let sender = profileCache.get(message.user_id) || (message.user_id === currentUser.id ? currentUser : null);
  if (!sender) {
    sender = await getProfile(message.user_id);
    if (sender) profileCache.set(sender.id, sender);
  }
  const list = document.querySelector("#chatList");
  if (!list) return;
  list.insertAdjacentHTML("beforeend", chatMessageHtml(message, sender, message.user_id === currentUser.id));
  if (!message.pending) {
    const cached = getCachedChatMessages().filter((item) => item.id !== message.id && !String(item.id).startsWith("local-"));
    cacheChatMessages([...cached, message]);
  }
  bindImageLoadButtons();
  bindChatImagePreview();
  if (!lastChatCreatedAt || message.created_at > lastChatCreatedAt) {
    lastChatCreatedAt = message.created_at;
  }
  if (currentView === "chat") {
    setChatSeenAt(currentUser.id, message.created_at);
  }
  scrollChatBottom();
}

function startChatPolling() {
  stopChatPolling();
  chatPollTimer = setInterval(fetchNewChatMessages, 4000);
}

function stopChatPolling() {
  if (!chatPollTimer) return;
  clearInterval(chatPollTimer);
  chatPollTimer = null;
}

async function fetchNewChatMessages() {
  if (currentView !== "chat" || !lastChatCreatedAt) return;
  const { data, error } = await supabaseClient
    .from("chat_messages")
    .select("id,user_id,type,text,image_name,created_at")
    .gt("created_at", lastChatCreatedAt)
    .order("created_at", { ascending: true })
    .limit(20);
  if (error) return;
  for (const message of data || []) {
    await appendLiveMessage(message);
  }
}

function bindImageLoadButtons() {
  document.querySelectorAll(".image-placeholder").forEach((button) => {
    if (button.dataset.bound === "1") return;
    button.dataset.bound = "1";
    button.addEventListener("click", () => loadChatImage(button));
  });
}

async function loadChatImage(button) {
  const messageId = button.dataset.imageId;
  if (!messageId) return;
  button.disabled = true;
  button.textContent = "加载中";
  const { data, error } = await supabaseClient
    .from("chat_messages")
    .select("image_data,image_name")
    .eq("id", messageId)
    .maybeSingle();
  if (error || !data?.image_data) {
    button.disabled = false;
    button.textContent = "加载失败";
    return;
  }
  const image = document.createElement("img");
  image.className = "chat-image";
  image.src = data.image_data;
  image.alt = data.image_name || "聊天图片";
  image.dataset.fullImage = data.image_data;
  button.replaceWith(image);
  bindChatImagePreview();
}

function bindChatImagePreview() {
  document.querySelectorAll(".chat-image").forEach((image) => {
    if (image.dataset.previewBound === "1") return;
    image.dataset.previewBound = "1";
    image.addEventListener("click", () => openImagePreview(image.dataset.fullImage || image.src, image.alt));
  });
}

function openImagePreview(src, alt = "聊天图片") {
  if (!src) return;
  document.querySelector(".image-preview")?.remove();
  const preview = document.createElement("div");
  preview.className = "image-preview";
  preview.innerHTML = `
    <button class="image-preview-close" type="button">关闭</button>
    <img src="${escapeAttr(src)}" alt="${escapeAttr(alt)}">
  `;
  document.body.appendChild(preview);
  preview.addEventListener("click", (event) => {
    if (event.target === preview || event.target.closest(".image-preview-close")) {
      preview.remove();
    }
  });
}

function scrollChatBottom() {
  const list = document.querySelector("#chatList");
  if (list) list.scrollTop = list.scrollHeight;
}

async function toggleChatMute() {
  const nextValue = !currentUser.chat_muted;
  const { error } = await supabaseClient
    .from("profiles")
    .update({ chat_muted: nextValue })
    .eq("id", currentUser.id);
  if (error) return toast(`设置失败：${error.message}`);
  currentUser.chat_muted = nextValue;
  toast(nextValue ? "群聊免打扰已开启，@你仍会提醒" : "群聊免打扰已关闭");
  await renderChat();
}

async function sendChatMessage(event) {
  event.preventDefault();
  const input = document.querySelector("#chatInput");
  const text = input.value.trim();
  if (!text) return toast("消息不能为空");
  input.value = "";
  const localId = `local-${Date.now()}`;
  const localMessage = {
    id: localId,
    type: "text",
    user_id: currentUser.id,
    text,
    created_at: new Date().toISOString(),
    pending: true
  };
  if (currentView === "chat") await appendLiveMessage(localMessage);
  const { data, error } = await supabaseClient
    .from("chat_messages")
    .insert({
      type: "text",
      user_id: currentUser.id,
      text
    })
    .select("id,user_id,type,text,image_name,created_at")
    .single();
  if (error) {
    const node = document.querySelector(`[data-message-id="${CSS.escape(localId)}"]`);
    node?.classList.add("failed-message");
    const meta = node?.querySelector(".chat-meta");
    if (meta) meta.textContent = `${currentUser.display_name || "我"} · 发送失败`;
    return toast(`发送失败：${error.message}`);
  }
  document.querySelector(`[data-message-id="${CSS.escape(localId)}"]`)?.remove();
  if (data && currentView === "chat") await appendLiveMessage(data);
  if (data?.id) sendChatPushNotification(data.id);
}

function sendImageMessage(event) {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;
  if (!file.type.startsWith("image/")) return toast("请选择图片文件");
  uploadChatImage(file);
}

async function uploadChatImage(file) {
  const imageButton = document.querySelector("#imageButton");
  const oldLabel = imageButton?.textContent || "图片";
  if (imageButton) {
    imageButton.disabled = true;
    imageButton.textContent = "上传中";
  }

  try {
    const caption = document.querySelector("#chatInput")?.value.trim() || "";
    const imageBlob = await compressImage(file);
    const filePath = `${currentUser.id}/${Date.now()}-${safeFileName(file.name)}.jpg`;
    const { error: uploadError } = await supabaseClient.storage
      .from(CHAT_IMAGE_BUCKET)
      .upload(filePath, imageBlob, {
        contentType: "image/jpeg",
        cacheControl: "31536000",
        upsert: false
      });

    if (uploadError) return toast(`图片上传失败：${uploadError.message}`);

    const { data: publicData } = supabaseClient.storage
      .from(CHAT_IMAGE_BUCKET)
      .getPublicUrl(filePath);
    const imageUrl = publicData?.publicUrl;
    if (!imageUrl) return toast("图片链接生成失败");

    const { data, error } = await supabaseClient
      .from("chat_messages")
      .insert({
        type: "image",
        user_id: currentUser.id,
        text: caption,
        image_data: imageUrl,
        image_name: file.name
      })
      .select("id,user_id,type,text,image_name,created_at")
      .single();

    if (error) return toast(`图片发送失败：${error.message}`);

    const input = document.querySelector("#chatInput");
    if (input) input.value = "";
    if (data) data.image_data = imageUrl;
    if (data && currentView === "chat") await appendLiveMessage(data);
    if (data?.id) sendChatPushNotification(data.id);
  } catch (error) {
    toast(`图片处理失败：${error.message || "请换一张图片试试"}`);
  } finally {
    if (imageButton) {
      imageButton.disabled = false;
      imageButton.textContent = oldLabel;
    }
  }
}

function safeFileName(name) {
  return String(name || "image")
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[^a-z0-9_-]+/gi, "-")
    .slice(0, 40) || "image";
}

function compressImage(file) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const maxSide = 1280;
      const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
      const width = Math.max(1, Math.round(image.width * scale));
      const height = Math.max(1, Math.round(image.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("无法处理图片"));
      ctx.drawImage(image, 0, 0, width, height);
      canvas.toBlob((blob) => {
        if (!blob) return reject(new Error("图片压缩失败"));
        resolve(blob);
      }, "image/jpeg", 0.78);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("图片读取失败"));
    };
    image.src = objectUrl;
  });
}

function renderMine(user) {
  currentView = "mine";
  closeChatRealtime();
  const notificationOn = notificationPermissionGranted();
  app.innerHTML = html`
    <section class="screen">
      ${nav("我的")}
      <div class="mine-stack">
        <span class="section-label">账号</span>
        <div class="value">${escapeHtml(user.account)}</div>

        <label class="field">
          <span>修改名称</span>
          <input id="name" value="${escapeAttr(user.display_name)}">
        </label>
        <button class="primary" id="saveName">保存名称</button>

        <button class="${notificationOn ? "primary" : "secondary"}" id="enableNotifications">${notificationOn ? "系统提醒已开启" : "开启系统提醒"}</button>
        <button class="secondary" id="enablePush">开启后台推送提醒</button>
        <button class="secondary" id="checkPushStatus">检查推送状态</button>
        <button class="secondary" id="testPush">发送测试推送</button>
        <button class="text-button" id="disablePush">关闭后台推送提醒</button>

        <button class="text-button danger" id="logout">退出登录</button>
      </div>
    </section>
  `;
  bindBack();
  document.querySelector("#saveName").addEventListener("click", saveName);
  document.querySelector("#enableNotifications").addEventListener("click", requestNotificationAccess);
  document.querySelector("#enablePush").addEventListener("click", requestPushNotifications);
  document.querySelector("#checkPushStatus").addEventListener("click", checkPushStatus);
  document.querySelector("#testPush").addEventListener("click", sendTestPushNotification);
  document.querySelector("#disablePush").addEventListener("click", disablePushNotifications);
  document.querySelector("#logout").addEventListener("click", logout);
}

async function saveName() {
  const name = cleanName(document.querySelector("#name").value, "");
  if (!name) return toast("名称不能为空");
  const { error } = await supabaseClient
    .from("profiles")
    .update({ display_name: name })
    .eq("id", currentUser.id);
  if (error) return toast(`保存失败：${error.message}`);
  currentUser.display_name = name;
  cacheProfile(currentUser);
  toast("名称已保存");
  renderMine(currentUser);
}

async function logout() {
  await supabaseClient.auth.signOut();
  currentSession = null;
  currentUser = null;
  clearAppCache();
  toast("已退出登录");
  renderAuth();
}

async function checkDailyReminder() {
  if (!currentUser) return;
  const clock = beijingClockParts();
  if (!isAfterReminderTime(clock)) return;
  if (await hasCheckedOnDate(currentUser.id, clock.date)) return;
  const key = userReminderKey(currentUser.id, clock.date);
  if (localStorage.getItem(key)) return;
  localStorage.setItem(key, "1");
  notifyUser("读经打卡提醒", "现在已经过了晚上 9:30，今天还没有打卡。");
}

function nav(title) {
  return `<header class="nav"><button class="back" id="back">&lt;</button><h1>${title}</h1><span></span></header>`;
}

function bindBack() {
  document.querySelector("#back").addEventListener("click", () => renderHome(currentUser));
}

function setBusy(selector, isBusy, label) {
  const button = document.querySelector(selector);
  if (!button) return;
  button.disabled = isBusy;
  button.textContent = label;
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

init();

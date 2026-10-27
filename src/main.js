import {
  state,
  ensureAutoProxyGroup,
  resolveProxyNameConflicts,
  getMatchPolicyTarget,
} from "./state.js";
import {
  t,
  applyTranslations,
  setupLanguageSelector,
  syncDynamicTexts,
  applyTwemoji,
} from "./i18n.js";
import { setStatus } from "./ui-core.js";
import { renderGroups } from "./groups.js";
import {
  renderRulesTargets,
  renderMatchSelect,
  initManualRules,
  renderManualRules,
  rebuildRuleOrderFromState,
  initRuleListsDelegation,
  renderRuleProviders,
  setRulesRebuildCallback,
} from "./rules.js";
import { renderSubs, setSubsRebuildCallback } from "./subs.js";
import { setupGeoListeners } from "./geo.js";
import {
  emitProxiesYaml,
  emitGroupsYaml,
  emitSubsYaml,
  emitRuleProvidersYaml,
  emitRulesYaml,
} from "./yaml-gen.js";
import {
  ACL4SSR_PRESETS,
  emitIniConfig,
  parseIniToState,
} from "./ini-gen.js";
import { parseConfigTextToState } from "./yaml-import.js";
import { debounce } from "./utils.js";
import { parseMany } from "./parser.js";

let currentOutputFormat = "ini"; // "ini" | "yaml"

const DEFAULT_STARTER_INI = `[custom]
;默认内置精简分流模板（支持在左侧自由增删改）
ruleset=全球直连,[]GEOIP,private,no-resolve
ruleset=广告拦截,https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/BanAD.list
ruleset=AI 专线,https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/Ruleset/OpenAi.list
ruleset=油管视频,https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/Ruleset/YouTube.list
ruleset=电报消息,https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/Telegram.list
ruleset=节点选择,https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/ProxyGFWlist.list
ruleset=全球直连,https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/ChinaDomain.list
ruleset=全球直连,https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/ChinaCompanyIp.list
ruleset=全球直连,[]GEOIP,CN,no-resolve
ruleset=漏网之鱼,[]FINAL

custom_proxy_group=节点选择\`select\`[]自动选择\`[]香港节点\`[]美国节点\`[]日本节点\`[]新加坡节点\`[]DIRECT\`.*
custom_proxy_group=自动选择\`url-test\`.*\`http://www.gstatic.com/generate_204\`300,,50
custom_proxy_group=AI 专线\`select\`[]美国节点\`[]日本节点\`[]新加坡节点\`[]节点选择
custom_proxy_group=油管视频\`select\`[]节点选择\`[]自动选择\`[]香港节点\`[]美国节点
custom_proxy_group=电报消息\`select\`[]节点选择\`[]新加坡节点\`[]香港节点\`[]美国节点
custom_proxy_group=香港节点\`url-test\`(香港|HK|Hong Kong|HongKong)\`http://www.gstatic.com/generate_204\`300,,50
custom_proxy_group=美国节点\`url-test\`(美国|US|United States|America)\`http://www.gstatic.com/generate_204\`300,,50
custom_proxy_group=日本节点\`url-test\`(日本|JP|Japan)\`http://www.gstatic.com/generate_204\`300,,50
custom_proxy_group=新加坡节点\`url-test\`(新加坡|SG|Singapore|狮城)\`http://www.gstatic.com/generate_204\`300,,50
custom_proxy_group=全球直连\`select\`[]DIRECT\`[]节点选择
custom_proxy_group=广告拦截\`select\`[]REJECT\`[]DIRECT
custom_proxy_group=漏网之鱼\`select\`[]节点选择\`[]全球直连\`[]自动选择
`;

function refreshAllViews() {
  renderGroups();
  renderRuleProviders();
  renderRulesTargets();
  renderMatchSelect();
  renderManualRules();
  rebuildRuleOrderFromState();
  buildConfig();
}

function rebuildInternalState() {
  const inputEl = document.getElementById("input");
  const { proxies } = parseMany(inputEl ? inputEl.value : "");
  state.proxies = proxies || [];

  ensureAutoProxyGroup();
  renderGroups();
  renderRulesTargets();
  buildConfig();
}

const rebuildInternalStateDebounced = debounce(rebuildInternalState, 300);
setSubsRebuildCallback(rebuildInternalStateDebounced);
setRulesRebuildCallback(rebuildInternalStateDebounced);

export function buildConfig() {
  const inputEl = document.getElementById("input");
  const { proxies = [], errors = [] } = parseMany(
    inputEl ? inputEl.value : "",
    { collectErrors: true }
  );
  resolveProxyNameConflicts(proxies, state.groups);
  state.proxies = proxies;

  ensureAutoProxyGroup();

  const outputEl = document.getElementById("output");
  if (!outputEl) return;

  if (currentOutputFormat === "ini") {
    const totalRules =
      state.ruleProviders.length +
      state.manualRules.length +
      state.rulesGeosite.size +
      state.rulesGeoip.size;

    if (!state.groups.length && !totalRules) {
      outputEl.textContent = t("outputPlaceholder");
      outputEl.dataset.placeholder = "true";
      setStatus(null, t("emptyStatus"));
      return;
    }

    const iniText = emitIniConfig();
    outputEl.textContent = iniText;
    delete outputEl.dataset.placeholder;
    outputEl.removeAttribute("data-placeholder");

    setStatus(
      "ok",
      `INI 实时就绪：分组 ${state.groups.length} 个 · 规则集 ${state.ruleProviders.length} 个 · 单条/GEO规则 ${
        state.manualRules.length + state.rulesGeosite.size + state.rulesGeoip.size
      } 条`
    );
    return;
  }

  let yaml = "";

  if (proxies.length) {
    yaml += emitProxiesYaml(proxies);
  }

  const groupsYaml = emitGroupsYaml();
  const subsYaml = emitSubsYaml();
  const ruleProvidersYaml = emitRuleProvidersYaml();
  const rulesYaml = emitRulesYaml();

  if (subsYaml) yaml += (yaml ? "\n" : "") + subsYaml.trim() + "\n";
  if (groupsYaml) yaml += (yaml ? "\n" : "") + groupsYaml.trim() + "\n";
  if (ruleProvidersYaml)
    yaml += (yaml ? "\n" : "") + ruleProvidersYaml.trim() + "\n";
  if (rulesYaml) yaml += (yaml ? "\n" : "") + rulesYaml.trim() + "\n";

  if (!yaml.trim()) {
    outputEl.textContent = t("outputPlaceholder");
    outputEl.dataset.placeholder = "true";

    if (errors.length) {
      setStatus("err", errors[0].err || t("emptyStatus"));
    } else {
      setStatus("err", t("emptyStatus"));
    }
    return;
  }

  outputEl.textContent = yaml;
  delete outputEl.dataset.placeholder;
  outputEl.removeAttribute("data-placeholder");

  if (errors.length) {
    setStatus(
      "err",
      t("errorSummary", { proxies: proxies.length, errors: errors.length })
    );
  } else {
    const parts = [
      proxies.length ? t("countProxies", { count: proxies.length }) : null,
      state.subs.length ? t("countSubs", { count: state.subs.length }) : null,
      state.groups.length
        ? t("countGroups", { count: state.groups.length })
        : null,
      state.rulesGeosite.size + state.rulesGeoip.size + state.manualRules.length
        ? t("countRules", {
            count:
              state.rulesGeosite.size +
              state.rulesGeoip.size +
              state.manualRules.length +
              state.ruleProviders.length,
          })
        : null,
    ]
      .filter(Boolean)
      .join(", ");
    setStatus("ok", t("buildSummary", { parts: parts || t("advancedOnly") }));
  }
}

function bindAdvanced(toggleId, areaId) {
  const tEl = document.getElementById(toggleId);
  const aEl = document.getElementById(areaId);
  if (!tEl || !aEl) return;
  const track = tEl.nextElementSibling;

  function sync() {
    const on = tEl.checked;
    aEl.style.display = on ? "block" : "none";
    if (track) {
      track.classList.toggle("is-on", on);
      track.offsetWidth;
    }
    buildConfig();
  }
  tEl.addEventListener("change", sync);
  sync();
}

async function fetchRemoteIniText(url) {
  try {
    const proxyRes = await fetch(`/api/fetch-ini?url=${encodeURIComponent(url)}`);
    if (proxyRes.ok) {
      const data = await proxyRes.json();
      if (data.ok && data.content) return data.content;
    }
  } catch {
    // Fallback to direct browser fetch if running without server.mjs
  }
  const directRes = await fetch(url);
  if (!directRes.ok) {
    throw new Error(`HTTP ${directRes.status}`);
  }
  return await directRes.text();
}

function initThemeControls() {
  const buttons = document.querySelectorAll(".theme-btn[data-theme-value]");
  const mediaQuery =
    typeof window !== "undefined" && window.matchMedia
      ? window.matchMedia("(prefers-color-scheme: dark)")
      : null;

  function applyTheme(mode) {
    const validMode = ["light", "dark", "system"].includes(mode)
      ? mode
      : "system";
    try {
      localStorage.setItem("theme", validMode);
    } catch {}
    const isDark =
      validMode === "dark" ||
      (validMode === "system" && mediaQuery && mediaQuery.matches);
    document.documentElement.setAttribute(
      "data-theme",
      isDark ? "dark" : "light"
    );
    document.documentElement.setAttribute("data-theme-mode", validMode);
    buttons.forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.themeValue === validMode);
    });
  }

  let initialMode = "system";
  try {
    initialMode = localStorage.getItem("theme") || "system";
  } catch {}
  applyTheme(initialMode);

  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      applyTheme(btn.dataset.themeValue);
    });
  });

  if (mediaQuery && typeof mediaQuery.addEventListener === "function") {
    mediaQuery.addEventListener("change", () => {
      const currentMode =
        document.documentElement.getAttribute("data-theme-mode") || "system";
      if (currentMode === "system") {
        applyTheme("system");
      }
    });
  }
}

function initIniControls() {
  const presetSel = document.getElementById("iniPresetSelect");
  const deleteProfileBtn = document.getElementById("deleteSavedProfileBtn");
  const profileNameInput = document.getElementById("profileNameInput");
  const remoteUrlEl = document.getElementById("remoteIniUrlText");
  const tabIni = document.getElementById("tabFormatIni");
  const tabYaml = document.getElementById("tabFormatYaml");
  const dlBtn = document.getElementById("downloadBtn");
  const publishBtn = document.getElementById("publishIniBtn");
  const bannerLabelEl = document.getElementById("remoteUrlBannerLabel");

  const LOCAL_PROFILES_KEY = "mc_saved_profiles_v1";
  let savedProfiles = [];
  let currentSelectedProfileName = "";

  function escapeHtmlAttr(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function readLocalProfiles() {
    try {
      const raw = localStorage.getItem(LOCAL_PROFILES_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function writeLocalProfiles(list) {
    try {
      localStorage.setItem(LOCAL_PROFILES_KEY, JSON.stringify(list));
    } catch {}
  }

  function buildFullYamlString() {
    const inputEl = document.getElementById("input");
    const { proxies = [] } = parseMany(inputEl ? inputEl.value : "");
    resolveProxyNameConflicts(proxies, state.groups);
    state.proxies = proxies;
    ensureAutoProxyGroup();

    let yaml = "";
    if (proxies.length) {
      yaml += emitProxiesYaml(proxies);
    }
    const groupsYaml = emitGroupsYaml();
    const subsYaml = emitSubsYaml();
    const ruleProvidersYaml = emitRuleProvidersYaml();
    const rulesYaml = emitRulesYaml();

    if (subsYaml) yaml += (yaml ? "\n" : "") + subsYaml.trim() + "\n";
    if (groupsYaml) yaml += (yaml ? "\n" : "") + groupsYaml.trim() + "\n";
    if (ruleProvidersYaml)
      yaml += (yaml ? "\n" : "") + ruleProvidersYaml.trim() + "\n";
    if (rulesYaml) yaml += (yaml ? "\n" : "") + rulesYaml.trim() + "\n";
    return yaml.trim();
  }

  function updateRemoteUrlBanner() {
    const isIni = currentOutputFormat === "ini";
    const ext = isIni ? "ini" : "yaml";
    if (remoteUrlEl) {
      if (currentSelectedProfileName) {
        remoteUrlEl.textContent = `${window.location.origin}/profiles/${encodeURIComponent(
          currentSelectedProfileName
        )}.${ext}`;
      } else {
        remoteUrlEl.textContent = `${window.location.origin}/${
          isIni ? "rules.ini" : "config.yaml"
        }`;
      }
    }
    if (bannerLabelEl) {
      if (currentSelectedProfileName) {
        bannerLabelEl.textContent = `当前配置「${currentSelectedProfileName}」远程 ${ext.toUpperCase()} 直链：`;
      } else {
        bannerLabelEl.textContent = isIni
          ? "远程 INI 规则直链（保存后永久有效，可填入订阅转换远程规则）："
          : "远程 YAML 配置直链（保存后永久有效，可作为客户端配置订阅）：";
      }
    }
  }

  function syncDeleteButtonVisibility() {
    if (!deleteProfileBtn) return;
    const isSavedSelected =
      presetSel &&
      typeof presetSel.value === "string" &&
      presetSel.value.startsWith("profile:");
    deleteProfileBtn.style.display = isSavedSelected ? "inline-flex" : "none";
  }

  function renderPresetOptions(selectedValue = "") {
    if (!presetSel) return;
    const savedGroupHtml = savedProfiles.length
      ? `<optgroup label="已保存的配置">${savedProfiles
          .map(
            (p) =>
              `<option value="profile:${escapeHtmlAttr(p.name)}">${escapeHtmlAttr(
                p.name
              )}</option>`
          )
          .join("")}</optgroup>`
      : "";

    const builtinGroupHtml = `<optgroup label="内置与开源预设模板">
      <option value="__starter__">内置推荐模板（AI + 油管 + 电报 + 地区自动测速）</option>
      ${ACL4SSR_PRESETS.map(
        (p) =>
          `<option value="${escapeHtmlAttr(p.url)}">${escapeHtmlAttr(
            p.name
          )}</option>`
      ).join("")}
    </optgroup>`;

    presetSel.innerHTML = [
      `<option value="" disabled hidden>选择已保存配置或预设模板</option>`,
      savedGroupHtml,
      builtinGroupHtml,
    ].join("");

    presetSel.value = selectedValue || "";
    syncDeleteButtonVisibility();
  }

  async function fetchSavedProfiles(selectedValue = "") {
    try {
      const res = await fetch("/api/profiles");
      if (res.ok) {
        const data = await res.json();
        if (data.ok && Array.isArray(data.profiles)) {
          savedProfiles = data.profiles;
          writeLocalProfiles(savedProfiles);
          renderPresetOptions(selectedValue);
          return;
        }
      }
    } catch {}
    savedProfiles = readLocalProfiles();
    renderPresetOptions(selectedValue);
  }

  renderPresetOptions();
  fetchSavedProfiles();
  updateRemoteUrlBanner();

  const fileInput = document.getElementById("localConfigFileInput");
  document.getElementById("uploadConfigFileBtn")?.addEventListener("click", () => {
    fileInput?.click();
  });

  fileInput?.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const summary = parseConfigTextToState(text);
      currentSelectedProfileName = "";
      if (presetSel) presetSel.value = "";
      if (profileNameInput) {
        profileNameInput.value = file.name.replace(/\.(ya?ml|ini|txt|conf)$/i, "");
      }
      syncDeleteButtonVisibility();
      updateRemoteUrlBanner();
      renderSubs();
      refreshAllViews();
      setStatus(
        "ok",
        `已成功导入本地文件「${file.name}」（识别为 ${summary.format.toUpperCase()}）：${summary.groups} 个策略组，${summary.ruleProviders} 个规则集，${summary.manualRules} 条单条规则`
      );
    } catch (err) {
      setStatus("err", `读取本地文件失败: ${err.message || err}`);
    } finally {
      fileInput.value = "";
    }
  });

  document.getElementById("resetAllConfigBtn")?.addEventListener("click", () => {
    state.groups = [];
    state.ruleProviders = [];
    state.manualRules = [];
    state.rulesGeosite.clear();
    state.rulesGeoip.clear();
    state.ruleOrder = [];
    state.subs = [];
    const inputEl = document.getElementById("input");
    if (inputEl) inputEl.value = "";
    const matchSel = document.getElementById("matchPolicy");
    if (matchSel) matchSel.value = "";
    currentSelectedProfileName = "";
    if (presetSel) presetSel.value = "";
    if (profileNameInput) profileNameInput.value = "";
    syncDeleteButtonVisibility();
    updateRemoteUrlBanner();
    renderSubs();
    refreshAllViews();
    setStatus("ok", "已清空所有已选模板、代理分组与分流规则");
  });

  document.getElementById("clearGroupsBtn")?.addEventListener("click", () => {
    state.groups = [];
    refreshAllViews();
    setStatus("ok", "已清空所有代理分组");
  });

  async function handlePresetChange(val) {
    syncDeleteButtonVisibility();
    if (!val) {
      currentSelectedProfileName = "";
      updateRemoteUrlBanner();
      return;
    }
    if (val.startsWith("profile:")) {
      const name = val.slice("profile:".length);
      const found = savedProfiles.find((p) => p && p.name === name);
      if (!found) {
        setStatus("err", `未找到已保存的配置「${name}」`);
        return;
      }
      currentSelectedProfileName = found.name;
      if (profileNameInput) profileNameInput.value = found.name;
      const rawText =
        (currentOutputFormat === "yaml"
          ? found.yamlContent || found.content
          : found.iniContent || found.content) || "";
      const summary = parseConfigTextToState(rawText);
      renderSubs();
      refreshAllViews();
      updateRemoteUrlBanner();
      setStatus(
        "ok",
        `已切换至配置「${found.name}」：${summary.groups} 个策略组，${summary.ruleProviders} 个规则集，${summary.manualRules} 条单条规则`
      );
      return;
    }

    currentSelectedProfileName = "";
    updateRemoteUrlBanner();

    if (val === "__starter__") {
      const summary = parseIniToState(DEFAULT_STARTER_INI);
      if (profileNameInput && !profileNameInput.value.trim()) {
        profileNameInput.value = "默认推荐分流";
      }
      refreshAllViews();
      setStatus(
        "ok",
        `已加载内置推荐模板：${summary.groups} 个策略组，${summary.ruleProviders} 个规则集`
      );
      return;
    }
    try {
      setStatus(null, "正在从远程拉取预设模板…");
      const text = await fetchRemoteIniText(val);
      const summary = parseConfigTextToState(text);
      refreshAllViews();
      setStatus(
        "ok",
        `成功导入模板：${summary.groups} 个策略组，${summary.ruleProviders} 个规则集，${summary.manualRules} 条单条规则`
      );
    } catch (err) {
      setStatus("err", `拉取模板失败: ${err.message || err}`);
    }
  }

  presetSel?.addEventListener("change", () => {
    handlePresetChange(presetSel.value);
  });

  deleteProfileBtn?.addEventListener("click", async () => {
    const val = presetSel?.value || "";
    if (!val.startsWith("profile:")) return;
    const name = val.slice("profile:".length);
    try {
      const res = await fetch(
        `/api/profiles?name=${encodeURIComponent(name)}`,
        { method: "DELETE" }
      );
      if (res.ok) {
        const data = await res.json();
        if (data.ok && Array.isArray(data.profiles)) {
          savedProfiles = data.profiles;
        }
      } else {
        savedProfiles = savedProfiles.filter((p) => p && p.name !== name);
      }
    } catch {
      savedProfiles = savedProfiles.filter((p) => p && p.name !== name);
    }
    writeLocalProfiles(savedProfiles);
    currentSelectedProfileName = "";
    if (profileNameInput && profileNameInput.value.trim() === name) {
      profileNameInput.value = "";
    }
    renderPresetOptions("");
    updateRemoteUrlBanner();
    setStatus("ok", `已删除保存的配置「${name}」`);
  });

  document.getElementById("parseIniTextBtn")?.addEventListener("click", async () => {
    const raw = document.getElementById("pasteIniText")?.value?.trim();
    if (!raw) {
      setStatus("err", "请先粘贴远程链接 (https://...) 或 .yaml / .ini 配置内容");
      return;
    }
    const isSingleUrl =
      /^https?:\/\/\S+$/i.test(raw) && !raw.includes("\n");
    if (isSingleUrl) {
      try {
        setStatus(null, "正在从远程链接拉取配置…");
        const text = await fetchRemoteIniText(raw);
        const summary = parseConfigTextToState(text);
        currentSelectedProfileName = "";
        if (presetSel) presetSel.value = "";
        syncDeleteButtonVisibility();
        updateRemoteUrlBanner();
        renderSubs();
        refreshAllViews();
        setStatus(
          "ok",
          `成功从链接导入 ${summary.format.toUpperCase()}：${summary.groups} 个策略组，${summary.ruleProviders} 个规则集，${summary.manualRules} 条单条规则`
        );
      } catch (err) {
        setStatus("err", `远程链接拉取失败: ${err.message || err}`);
      }
      return;
    }
    const summary = parseConfigTextToState(raw);
    currentSelectedProfileName = "";
    if (presetSel) presetSel.value = "";
    syncDeleteButtonVisibility();
    updateRemoteUrlBanner();
    renderSubs();
    refreshAllViews();
    setStatus(
      "ok",
      `成功导入粘贴的 ${summary.format.toUpperCase()} 配置：${summary.groups} 个策略组，${summary.ruleProviders} 个规则集，${summary.manualRules} 条单条规则`
    );
  });

  function setFormat(fmt) {
    currentOutputFormat = fmt;
    const isIni = fmt === "ini";
    tabIni?.classList.toggle("active", isIni);
    tabYaml?.classList.toggle("active", !isIni);
    if (dlBtn) {
      dlBtn.textContent = "下载文件";
    }
    if (publishBtn) {
      publishBtn.textContent = "保存配置";
    }
    updateRemoteUrlBanner();
    buildConfig();
  }

  tabIni?.addEventListener("click", () => setFormat("ini"));
  tabYaml?.addEventListener("click", () => setFormat("yaml"));

  document.getElementById("publishIniBtn")?.addEventListener("click", async () => {
    const isIni = currentOutputFormat === "ini";
    const iniContent = emitIniConfig();
    const yamlContent = buildFullYamlString();
    const content = isIni ? iniContent : yamlContent;

    const hasRulesOrGroups =
      state.groups.length > 0 ||
      state.ruleProviders.length > 0 ||
      state.manualRules.length > 0 ||
      state.rulesGeosite.size > 0 ||
      state.rulesGeoip.size > 0 ||
      state.proxies.length > 0 ||
      state.subs.length > 0;

    if (!content || !hasRulesOrGroups) {
      setStatus("err", "当前没有可保存的配置内容，请先加载预设或添加分组/规则");
      return;
    }

    const name =
      profileNameInput?.value?.trim() ||
      currentSelectedProfileName ||
      `配置方案_${savedProfiles.length + 1}`;
    if (profileNameInput) profileNameInput.value = name;

    try {
      let savedViaServer = false;
      try {
        const res = await fetch("/api/profiles", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name,
            format: currentOutputFormat,
            content,
            iniContent,
            yamlContent,
          }),
        });
        const data = await res.json();
        if (res.ok && data.ok && Array.isArray(data.profiles)) {
          savedProfiles = data.profiles;
          savedViaServer = true;
        }
      } catch {}

      if (!savedViaServer) {
        const record = {
          name,
          format: currentOutputFormat,
          content,
          iniContent,
          yamlContent,
          updatedAt: new Date().toISOString(),
        };
        const idx = savedProfiles.findIndex((p) => p && p.name === name);
        if (idx >= 0) savedProfiles[idx] = record;
        else savedProfiles.unshift(record);
      }

      writeLocalProfiles(savedProfiles);
      currentSelectedProfileName = name;
      renderPresetOptions(`profile:${name}`);
      updateRemoteUrlBanner();

      const fullUrl = remoteUrlEl?.textContent || `${window.location.origin}/rules.ini`;
      setStatus(
        "ok",
        `已保存配置「${name}」并同步加入左上角下拉栏，专属直链：${fullUrl}`
      );
    } catch (err) {
      setStatus("err", `保存失败: ${err.message || err}`);
    }
  });

  document.getElementById("copyRemoteUrlBtn")?.addEventListener("click", async () => {
    const urlText = remoteUrlEl?.textContent?.trim() || `${window.location.origin}/rules.ini`;
    try {
      await navigator.clipboard.writeText(urlText);
      setStatus("ok", `已复制远程规则地址: ${urlText}`);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = urlText;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setStatus("ok", `已复制远程规则地址: ${urlText}`);
    }
  });

  window.addEventListener("mc-state-changed", () => {
    buildConfig();
  });
}

function initEventListeners() {
  document.getElementById("convertBtn")?.addEventListener("click", buildConfig);

  document.getElementById("pasteDemoBtn")?.addEventListener("click", () => {
    document.getElementById("input").value = [
      "vless://11111111-2222-3333-4444-555555555555@host.example.com:443?type=ws&security=tls&path=%2Fwebsocket#VLESS_WS_TLS",
      "trojan://password@trojan.example.com:443?sni=example.com#TROJAN_TLS",
      "ss://YWVzLTI1Ni1nY206cGFzc3dvcmQ=@ss.example.com:8388#SHADOWSOCKS",
    ].join("\n");
    setStatus(null, t("demoStatus"));
    rebuildInternalStateDebounced();
  });

  document.getElementById("clearBtn").addEventListener("click", () => {
    document.getElementById("input").value = "";
    rebuildInternalStateDebounced();
  });

  document.getElementById("copyBtn").addEventListener("click", async () => {
    const text = document.getElementById("output").textContent.trim();
    if (!text) {
      setStatus("err", t("nothingToCopy"));
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      setStatus("ok", t("copied"));
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setStatus("ok", t("copiedFallback"));
    }
  });

  document.getElementById("downloadBtn").addEventListener("click", () => {
    const text = document.getElementById("output").textContent.trim();
    if (!text) {
      setStatus("err", t("nothingToDownload"));
      return;
    }
    const isIni = currentOutputFormat === "ini";
    const blob = new Blob([text], {
      type: isIni ? "text/plain;charset=utf-8" : "text/yaml;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = isIni ? "rules.ini" : "config.yaml";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setStatus("ok", t("downloaded"));
  });

  document.getElementById("input").addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") buildConfig();
  });
  document.getElementById("input").addEventListener("input", () => {
    rebuildInternalStateDebounced();
  });
  document.getElementById("addGroupBtn").addEventListener("click", () => {
    const BASE = "自定义分组_";
    let maxIndex = 0;
    for (const g of state.groups) {
      if (!g || typeof g.name !== "string") continue;
      const m = g.name.match(/^自定义分组_(\d+)$/);
      if (m) {
        const num = Number(m[1]);
        if (Number.isFinite(num) && num > maxIndex) maxIndex = num;
      }
    }
    const nextName = `${BASE}${maxIndex + 1}`;
    state.groups.unshift({
      name: nextName,
      type: "select",
      icon: "",
      proxies: [],
      manual: [],
      filter: ".*",
    });
    refreshAllViews();
  });
  document.getElementById("addSubBtn").addEventListener("click", () => {
    const urlInput = document.getElementById("subsUrl");
    const url = urlInput.value.trim();
    if (!url) return;

    const fetchMode =
      document.getElementById("subsFetchMode")?.value || "DIRECT";
    const skipCertVerify = !!document.getElementById("subsSkipCert")?.checked;
    const name = "sub-" + (state.subs.length + 1);

    state.subs.push({
      name,
      url,
      interval: 3600,
      fetchMode,
      fetchProxy: "GLOBAL",
      skipCertVerify,
    });

    urlInput.value = "";
    renderSubs();
    rebuildInternalStateDebounced();
  });
  document
    .getElementById("addRuleProviderBtn")
    .addEventListener("click", () => {
      const nameInput = document.getElementById("ruleProviderName");
      const urlInput = document.getElementById("ruleProviderUrl");
      const behaviorSel = document.getElementById("ruleProviderBehavior");
      const policySel = document.getElementById("ruleProviderPolicy");

      const name = nameInput.value.trim();
      const url = urlInput.value.trim();
      const rawBehavior = behaviorSel.value || "surge";
      const policy = policySel.value;

      if (!name || !url) {
        setStatus("err", t("ruleProvidersNameUrlRequired"));
        return;
      }
      if (!policy) {
        setStatus("err", t("selectProxyGroup"));
        return;
      }

      if (state.ruleProviders.some((rp) => rp.name === name)) {
        setStatus("err", t("ruleProvidersNameExists"));
        return;
      }

      const isSurgeList = rawBehavior === "surge";
      const behavior = isSurgeList ? "classical" : rawBehavior;

      state.ruleProviders.unshift({
        name,
        url,
        behavior,
        sourceType: isSurgeList ? "surge" : `clash-${behavior}`,
        policy,
        type: "http",
        format: url.endsWith(".yaml") || url.endsWith(".yml") ? "yaml" : "text",
        path: `./rules/${name}.${url.endsWith(".yaml") ? "yaml" : "list"}`,
        interval: 86400,
      });

      nameInput.value = "";
      urlInput.value = "";

      renderRuleProviders();
      rebuildRuleOrderFromState();
      buildConfig();
    });
  document.getElementById("autoRulesBtn")?.addEventListener("click", () => {
    parseIniToState(DEFAULT_STARTER_INI);
    refreshAllViews();
    setStatus("ok", "已重置为默认推荐分流规则与分组");
  });
}

async function initApp() {
  window.state = state;

  initThemeControls();
  setupLanguageSelector();
  applyTranslations();

  initIniControls();

  renderSubs();
  renderGroups();
  renderRulesTargets();

  syncDynamicTexts();
  applyTwemoji(document.body);

  initManualRules();
  rebuildRuleOrderFromState();
  initRuleListsDelegation();

  bindAdvanced("groupsAdvancedToggle", "groupsAdvancedText");
  bindAdvanced("rulesAdvancedToggle", "rulesAdvancedText");
  bindAdvanced("subsAdvancedToggle", "subsAdvancedText");

  initEventListeners();
  setupGeoListeners(() => {
    renderRulesTargets();
    buildConfig();
  });

  buildConfig();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initApp);
} else {
  initApp();
}

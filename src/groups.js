import { state } from "./state.js";
import { t } from "./i18n.js";
import { fillActionSelect } from "./ui-core.js";
import {
  renderMatchSelect,
  rebuildRuleOrderFromState,
  renderRuleProvidersPolicySelect,
  renderRulesTargets,
  renderManualRules,
} from "./rules.js";
import { renderSubs } from "./subs.js";
import { escapeHtml } from "./utils.js";

const groupsContainer = document.getElementById("groupsContainer");

const FILTER_PRESETS = [
  { label: "全部节点 (.*)", value: ".*" },
  { label: "香港节点", value: "(香港|HK|Hong Kong|HongKong)" },
  { label: "美国节点", value: "(美国|US|United States|America)" },
  { label: "日本节点", value: "(日本|JP|Japan)" },
  { label: "新加坡节点", value: "(新加坡|SG|Singapore|狮城)" },
  { label: "台湾节点", value: "(台湾|TW|Taiwan|新北|彰化)" },
];

function notifyStateChanged() {
  window.dispatchEvent(new CustomEvent("mc-state-changed"));
}

export function renderGroups() {
  if (!groupsContainer) return;
  groupsContainer.innerHTML = "";
  const proxyNames = state.proxies.map((p) => p.name);
  const allGroupNames = state.groups.map((g) => g.name).filter(Boolean);

  state.groups.forEach((g, idx) => {
    const card = document.createElement("div");
    card.className = "group-card";

    const refCandidates = [
      "DIRECT",
      "REJECT",
      ...allGroupNames.filter((n) => n !== g.name),
    ];

    const manualArr = Array.isArray(g.manual) ? g.manual : [];

    const GROUP_TYPES = [
      { value: "select", label: "手动选择 (select)" },
      { value: "url-test", label: "自动测速选最快 (url-test)" },
      { value: "fallback", label: "故障自动切换 (fallback)" },
      { value: "load-balance", label: "负载均衡 (load-balance)" },
    ];

    card.innerHTML = `
      <div class="row">
        <input type="text" data-role="group-name" placeholder="${t("groupNamePlaceholder")}" value="${escapeHtml(
      g.name || ""
    )}">
        <select data-role="group-type" style="max-width: 220px">
          ${GROUP_TYPES.map(
            (tp) =>
              `<option value="${tp.value}" ${
                g.type === tp.value ? "selected" : ""
              }>${tp.label}</option>`
          ).join("")}
        </select>
      </div>
      <div class="two-col">
        <div class="row">
          <label class="hint">节点正则筛选 (filter，按节点名称匹配)</label>
          <input type="text" data-role="group-filter" placeholder="例如: .* (全部节点) 或 (香港|HK)" value="${escapeHtml(
            g.filter || ""
          )}">
        </div>
        <div class="row">
          <label class="hint">引用子策略组 / 内置策略 (proxies，逗号分隔)</label>
          <input type="text" data-role="group-manual" placeholder='例如: DIRECT, ♻️ 自动选择' value="${escapeHtml(
            manualArr.join(", ")
          )}">
        </div>
      </div>
      <div class="row" style="gap: 6px; flex-wrap: wrap">
        <span class="hint" style="flex: 0 0 auto">常用正则预设:</span>
        ${FILTER_PRESETS.map(
          (fp) =>
            `<button type="button" class="ghost chip-btn ${
              g.filter === fp.value ? "is-selected" : ""
            }" data-filter-preset="${escapeHtml(fp.value)}">${fp.label}</button>`
        ).join("")}
        <button type="button" class="ghost chip-btn" data-filter-preset="">清空正则</button>
      </div>
      <div class="row" style="gap: 6px; flex-wrap: wrap">
        <span class="hint" style="flex: 0 0 auto">点选子策略组:</span>
        ${refCandidates
          .map((refName) => {
            const active = manualArr.includes(refName);
            return `<button type="button" class="ghost chip-btn ${
              active ? "is-selected" : ""
            }" data-toggle-ref="${escapeHtml(refName)}">${
              active ? "✓ " : "+ "
            }${escapeHtml(refName)}</button>`;
          })
          .join("")}
      </div>
      ${
        proxyNames.length
          ? `<div class="hint">${t("groupProxiesHint")}</div>
             <div class="listbox" style="max-height:140px">
               ${proxyNames
                 .map((n) => {
                   const checked = (g.proxies || []).includes(n) ? "checked" : "";
                   return `<div class="item"><label><input type="checkbox" data-proxy="${escapeHtml(
                     n
                   )}" ${checked}> <span>${escapeHtml(n)}</span></label></div>`;
                 })
                 .join("")}
             </div>`
          : ""
      }
      <div class="row" style="justify-content:space-between; margin-top: 4px">
        <div class="hint">类型: <b>${escapeHtml(g.type)}</b> · 正则: <code>${escapeHtml(
      g.filter || (manualArr.length ? "仅引用子策略" : ".* (默认全部节点)")
    )}</code></div>
        <button class="danger" type="button" data-del>${t(
          "deleteGroup"
        )}</button>
      </div>
    `;

    const nameInp = card.querySelector('[data-role="group-name"]');
    const typeSel = card.querySelector('[data-role="group-type"]');
    const filterInp = card.querySelector('[data-role="group-filter"]');
    const manualInp = card.querySelector('[data-role="group-manual"]');

    nameInp.addEventListener("change", (e) => {
      const oldName = g.name;
      const newName = e.target.value.trim() || "GROUP";
      g.name = newName;
      if (oldName && oldName !== newName) {
        state.groups.forEach((other) => {
          if (Array.isArray(other.manual)) {
            other.manual = other.manual.map((m) => (m === oldName ? newName : m));
          }
        });
        state.ruleProviders.forEach((rp) => {
          if (rp.policy === oldName) rp.policy = newName;
        });
        state.manualRules.forEach((mr) => {
          if (mr.target === oldName) mr.target = newName;
        });
      }
      renderGroups();
      renderMatchSelect();
      rebuildRuleOrderFromState();
      renderRuleProvidersPolicySelect();
      renderRulesTargets();
      renderManualRules();
      renderSubs();
      notifyStateChanged();
    });

    typeSel.addEventListener("change", (e) => {
      g.type = e.target.value;
      renderGroups();
      notifyStateChanged();
    });

    filterInp.addEventListener("input", (e) => {
      g.filter = e.target.value.trim();
      notifyStateChanged();
    });

    manualInp.addEventListener("input", (e) => {
      g.manual = e.target.value
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean);
      notifyStateChanged();
    });

    card.querySelectorAll("[data-filter-preset]").forEach((btn) => {
      btn.addEventListener("click", () => {
        g.filter = btn.dataset.filterPreset || "";
        renderGroups();
        notifyStateChanged();
      });
    });

    card.querySelectorAll("[data-toggle-ref]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const ref = btn.dataset.toggleRef;
        if (!Array.isArray(g.manual)) g.manual = [];
        if (g.manual.includes(ref)) {
          g.manual = g.manual.filter((x) => x !== ref);
        } else {
          g.manual.push(ref);
        }
        renderGroups();
        notifyStateChanged();
      });
    });

    card.querySelectorAll("input[type=checkbox]").forEach((cb) => {
      cb.addEventListener("change", () => {
        const n = cb.dataset.proxy;
        if (cb.checked && !g.proxies.includes(n)) g.proxies.push(n);
        if (!cb.checked) g.proxies = g.proxies.filter((x) => x !== n);
        notifyStateChanged();
      });
    });

    card.querySelector("[data-del]").addEventListener("click", () => {
      state.groups.splice(idx, 1);
      renderGroups();
      renderRulesTargets();
      renderMatchSelect();
      renderManualRules();
      notifyStateChanged();
    });

    groupsContainer.appendChild(card);
  });

  if (!state.groups.length) {
    const empty = document.createElement("div");
    empty.className = "hint";
    empty.textContent = t("emptyGroups");
    groupsContainer.appendChild(empty);
  }
  renderMatchSelect();
  const manualAction = document.getElementById("manualRuleAction");
  if (manualAction) fillActionSelect(manualAction);
}

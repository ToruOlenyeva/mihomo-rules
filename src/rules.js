import {
  state,
  getMatchPolicyTarget,
  normalizeMatchSelection,
} from "./state.js";
import { t, applyTwemoji } from "./i18n.js";
import { fillActionSelect, setStatus } from "./ui-core.js";
import { renderGeositeList, renderGeoipList } from "./geo.js";
import { escapeHtml, isoToFlag, highlightMatch } from "./utils.js";
import { normalizeManualRule } from "./validators.js";

const ruleOrderListEl = document.getElementById("rulesOrderList");
const matchSelectEl = document.getElementById("matchPolicy");
const ruleProvidersListEl = document.getElementById("ruleProvidersList");

let _rebuildCallback = () => {};
export function setRulesRebuildCallback(fn) {
  _rebuildCallback = fn;
}

function notifyStateChanged() {
  window.dispatchEvent(new CustomEvent("mc-state-changed"));
}

function buildPolicyOptionsHtml(selectedPolicy) {
  const groups = state.groups.map((g) => g.name).filter(Boolean);
  const allPolicies = ["DIRECT", "REJECT", ...groups];
  if (selectedPolicy && !allPolicies.includes(selectedPolicy)) {
    allPolicies.unshift(selectedPolicy);
  }
  return allPolicies
    .map(
      (p) =>
        `<option value="${escapeHtml(p)}" ${
          p === selectedPolicy ? "selected" : ""
        }>${escapeHtml(p)}</option>`
    )
    .join("");
}

export function renderRuleProviders() {
  if (!ruleProvidersListEl) return;

  ruleProvidersListEl.innerHTML = "";

  if (!state.ruleProviders.length) {
    const empty = document.createElement("div");
    empty.className = "hint";
    empty.textContent = t("noRuleProviders") || "目前还没有规则提供者";
    ruleProvidersListEl.appendChild(empty);
    return;
  }

  state.ruleProviders.forEach((rp, idx) => {
    const row = document.createElement("div");
    row.className = "item";

    row.innerHTML = `
      <div style="display:grid;gap:6px;width:100%;min-width:0">
        <div class="row between" style="gap:8px;align-items:center">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-width:0">
            <b>${escapeHtml(rp.name)}</b>
            <span class="pill" style="font-size:11px">${escapeHtml(
              rp.sourceType === "surge" ? "ruleset (.list)" : `clash-${rp.behavior || "classical"}`
            )}</span>
          </div>
          <div style="display:flex;align-items:center;gap:6px;flex:0 0 auto">
            <select data-rp-policy style="width:auto;min-width:140px;padding:5px 8px;font-size:12px">
              ${buildPolicyOptionsHtml(rp.policy || "DIRECT")}
            </select>
            <button class="danger" type="button" data-del style="padding:5px 10px;font-size:12px">${t(
              "delete"
            )}</button>
          </div>
        </div>
        <small style="color:var(--muted);word-break:break-all">${escapeHtml(rp.url)}</small>
      </div>
    `;

    const policySel = row.querySelector("[data-rp-policy]");
    policySel.addEventListener("change", (e) => {
      rp.policy = e.target.value;
      rebuildRuleOrderFromState();
      notifyStateChanged();
    });

    row.querySelector("[data-del]").addEventListener("click", () => {
      state.ruleProviders.splice(idx, 1);
      renderRuleProviders();
      _rebuildCallback();
      notifyStateChanged();
    });

    ruleProvidersListEl.appendChild(row);
  });
  rebuildRuleOrderFromState();
}

export function renderRuleProvidersPolicySelect() {
  const sel = document.getElementById("ruleProviderPolicy");
  if (!sel) return;

  const groups = state.groups.map((g) => g.name).filter(Boolean);

  const options = [
    `<option value="">${t("ruleActionPlaceholder")}</option>`,
    `<option value="DIRECT">DIRECT</option>`,
    `<option value="REJECT">REJECT</option>`,
    ...groups.map(
      (name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`
    ),
  ];

  sel.innerHTML = options.join("");
}

export function initManualRules() {
  const typeEl = document.getElementById("manualRuleType");
  const valueEl = document.getElementById("manualRuleValue");
  const actionEl = document.getElementById("manualRuleAction");
  const addBtn = document.getElementById("addManualRuleBtn");

  if (!typeEl || !valueEl || !actionEl || !addBtn) return;

  fillActionSelect(actionEl);

  addBtn.addEventListener("click", () => {
    const type = typeEl.value.trim();
    const rawValue = valueEl.value.trim();
    const actionValue = actionEl.value.trim();

    if (!type || !rawValue || !actionValue) {
      alert(t("manualRulesFillAll"));
      return;
    }

    const normalized = normalizeManualRule(type, rawValue);
    if (!normalized.ok) {
      alert(normalized.error);
      return;
    }

    let action = "";
    let target = "";

    if (actionValue === "DIRECT") {
      action = "DIRECT";
      target = "";
    } else if (actionValue === "REJECT") {
      action = "BLOCK";
      target = "REJECT";
    } else {
      action = "PROXY";
      target = actionValue;
    }

    state.manualRules.unshift({
      id: Date.now() + Math.random().toString(16).slice(2),
      type,
      value: normalized.value,
      action,
      target,
    });

    valueEl.value = "";

    renderManualRules();
    rebuildRuleOrderFromState();
    notifyStateChanged();
  });

  renderManualRules();
}

export function renderManualRules() {
  const listEl = document.getElementById("manualRulesList");
  if (!listEl) return;

  listEl.innerHTML = "";

  const rules = state.manualRules || [];

  if (!rules.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = t("manualRulesEmpty");
    listEl.appendChild(empty);
    return;
  }

  rules.forEach((rule) => {
    const item = document.createElement("div");
    item.className = "rule-item";

    let policy = "";
    if (rule.action === "DIRECT") policy = "DIRECT";
    else if (rule.action === "BLOCK" || rule.target === "REJECT")
      policy = "REJECT";
    else if (rule.action === "PROXY") policy = rule.target || "PROXY";

    item.innerHTML = `
      <div class="rule-main" style="min-width:0;flex:1 1 auto">
        <span class="pill rule-kind">${escapeHtml(rule.type)}</span>
        <span class="rule-name" style="font-family:monospace">${escapeHtml(rule.value)}</span>
      </div>
      <div class="rule-actions" style="display:flex;align-items:center;gap:6px;flex:0 0 auto">
        <select data-manual-policy style="width:auto;min-width:135px;padding:4px 8px;font-size:12px">
          ${buildPolicyOptionsHtml(policy)}
        </select>
        <button class="icon-btn" type="button" data-remove title="${escapeHtml(
          t("manualRulesDelete")
        )}">✕</button>
      </div>
    `;

    const policySel = item.querySelector("[data-manual-policy]");
    policySel.addEventListener("change", (e) => {
      const val = e.target.value;
      if (val === "DIRECT") {
        rule.action = "DIRECT";
        rule.target = "";
      } else if (val === "REJECT") {
        rule.action = "BLOCK";
        rule.target = "REJECT";
      } else {
        rule.action = "PROXY";
        rule.target = val;
      }
      rebuildRuleOrderFromState();
      notifyStateChanged();
    });

    item.querySelector("[data-remove]").addEventListener("click", () => {
      const idx = state.manualRules.findIndex((r) => r.id === rule.id);
      if (idx !== -1) {
        state.manualRules.splice(idx, 1);
        renderManualRules();
        rebuildRuleOrderFromState();
        notifyStateChanged();
      }
    });

    listEl.appendChild(item);
  });
}

export function buildRuleEntriesArray() {
  const entries = [];

  for (const [name, r] of state.rulesGeosite.entries()) {
    entries.push({
      id: `GEOSITE:${name}`,
      kind: "GEOSITE",
      key: name,
      policy: r.target,
    });
  }

  for (const [code, r] of state.rulesGeoip.entries()) {
    entries.push({
      id: `GEOIP:${code}`,
      kind: "GEOIP",
      key: code,
      policy: r.target,
    });
  }

  if (state.ruleProviders && state.ruleProviders.length) {
    state.ruleProviders.forEach((rp) => {
      if (!rp.policy) return;
      entries.push({
        id: `RULE-SET:${rp.name}`,
        kind: "RULE-SET",
        key: rp.name,
        policy: rp.policy,
      });
    });
  }

  (state.manualRules || []).forEach((r) => {
    let policy = "";
    if (r.action === "DIRECT") policy = "DIRECT";
    else if (r.action === "BLOCK" || r.target === "REJECT") policy = "REJECT";
    else if (r.action === "PROXY") policy = r.target || "PROXY";

    entries.push({
      id: `MANUAL:${r.id}`,
      kind: "MANUAL",
      key: `${r.type},${r.value}`,
      policy,
    });
  });

  entries.push({
    id: "MATCH:__default__",
    kind: "MATCH",
    key: "MATCH",
    policy: getMatchPolicyTarget(),
  });

  return entries;
}

export function rebuildRuleOrderFromState() {
  const raw = buildRuleEntriesArray();

  if (!raw.length) {
    state.ruleOrder = [];
    renderRuleOrder();
    return;
  }

  const matchEntry = raw.find((e) => e.kind === "MATCH") || null;
  const nonMatchRaw = raw.filter((e) => e.kind !== "MATCH");

  const byId = new Map(nonMatchRaw.map((e) => [e.id, e]));

  const prev = Array.isArray(state.ruleOrder) ? state.ruleOrder : [];
  const next = [];

  for (const old of prev) {
    if (old.kind === "MATCH") continue;
    const fresh = byId.get(old.id);
    if (fresh) {
      next.push(fresh);
      byId.delete(old.id);
    }
  }

  for (const e of byId.values()) {
    next.push(e);
  }

  if (matchEntry) {
    next.push(matchEntry);
  }

  state.ruleOrder = next;
  renderRuleOrder();
}

let _dragSourceIndex = null;
let _dragSourceBundlePolicy = null;
let _dragSourceBundleChild = null;
let _lastMovedRuleId = null;
let _ruleOrderGroupMode = true;
const _expandedPolicyBundles = new Set();

function clearDragIndicators() {
  if (!ruleOrderListEl) return;
  ruleOrderListEl
    .querySelectorAll(".drag-over-top, .drag-over-bottom, .is-dragging")
    .forEach((el) => {
      el.classList.remove("drag-over-top", "drag-over-bottom", "is-dragging");
    });
}

function buildPolicyBundles(items) {
  const bundles = [];
  const map = new Map();
  let matchEntry = null;

  for (const entry of items) {
    if (entry.kind === "MATCH") {
      matchEntry = entry;
      continue;
    }
    const policy = entry.policy || "DIRECT";
    let bundle = map.get(policy);
    if (!bundle) {
      bundle = { policy, entries: [] };
      map.set(policy, bundle);
      bundles.push(bundle);
    }
    bundle.entries.push(entry);
  }
  return { bundles, matchEntry };
}

function applyBundlesToRuleOrder(bundles, matchEntry) {
  const next = [];
  for (const b of bundles) {
    for (const e of b.entries) {
      next.push(e);
    }
  }
  if (matchEntry) {
    next.push(matchEntry);
  }
  state.ruleOrder = next;
}

function movePolicyBundleByDrop(fromPolicy, targetPolicy, insertAfter) {
  const items =
    Array.isArray(state.ruleOrder) && state.ruleOrder.length
      ? state.ruleOrder
      : (state.ruleOrder = buildRuleEntriesArray());

  const { bundles, matchEntry } = buildPolicyBundles(items);
  const fromIdx = bundles.findIndex((b) => b.policy === fromPolicy);
  const targetIdx = bundles.findIndex((b) => b.policy === targetPolicy);
  if (fromIdx === -1 || targetIdx === -1 || fromIdx === targetIdx) return;

  let dest = insertAfter ? targetIdx + 1 : targetIdx;
  if (fromIdx < dest) dest -= 1;
  dest = Math.max(0, Math.min(bundles.length - 1, dest));

  const [moved] = bundles.splice(fromIdx, 1);
  bundles.splice(dest, 0, moved);

  applyBundlesToRuleOrder(bundles, matchEntry);
  _lastMovedRuleId = `BUNDLE:${fromPolicy}`;
  renderRuleOrder();
  notifyStateChanged();
}

function movePolicyBundleToEdge(policy, direction) {
  const items =
    Array.isArray(state.ruleOrder) && state.ruleOrder.length
      ? state.ruleOrder
      : (state.ruleOrder = buildRuleEntriesArray());

  const { bundles, matchEntry } = buildPolicyBundles(items);
  const fromIdx = bundles.findIndex((b) => b.policy === policy);
  if (fromIdx === -1 || bundles.length <= 1) return;

  const target = direction === "top" ? 0 : bundles.length - 1;
  if (fromIdx === target) return;

  const [moved] = bundles.splice(fromIdx, 1);
  bundles.splice(target, 0, moved);

  applyBundlesToRuleOrder(bundles, matchEntry);
  _lastMovedRuleId = `BUNDLE:${policy}`;
  renderRuleOrder();
  notifyStateChanged();
}

function moveRuleInsidePolicyBundle(policy, childIdx, direction) {
  const items =
    Array.isArray(state.ruleOrder) && state.ruleOrder.length
      ? state.ruleOrder
      : (state.ruleOrder = buildRuleEntriesArray());

  const { bundles, matchEntry } = buildPolicyBundles(items);
  const bundle = bundles.find((b) => b.policy === policy);
  if (!bundle || bundle.entries.length <= 1) return;

  const target = direction === "top" ? 0 : bundle.entries.length - 1;
  if (childIdx === target || childIdx < 0 || childIdx >= bundle.entries.length) return;

  const [moved] = bundle.entries.splice(childIdx, 1);
  bundle.entries.splice(target, 0, moved);

  applyBundlesToRuleOrder(bundles, matchEntry);
  _lastMovedRuleId = moved.id;
  renderRuleOrder();
  notifyStateChanged();
}

function moveRuleInsidePolicyBundleByDrop(policy, fromIdx, targetIdx, insertAfter) {
  const items =
    Array.isArray(state.ruleOrder) && state.ruleOrder.length
      ? state.ruleOrder
      : (state.ruleOrder = buildRuleEntriesArray());

  const { bundles, matchEntry } = buildPolicyBundles(items);
  const bundle = bundles.find((b) => b.policy === policy);
  if (!bundle || bundle.entries.length <= 1) return;
  if (fromIdx < 0 || fromIdx >= bundle.entries.length) return;
  if (targetIdx < 0 || targetIdx >= bundle.entries.length) return;

  let dest = insertAfter ? targetIdx + 1 : targetIdx;
  if (fromIdx < dest) dest -= 1;
  dest = Math.max(0, Math.min(bundle.entries.length - 1, dest));
  if (dest === fromIdx) return;

  const [moved] = bundle.entries.splice(fromIdx, 1);
  bundle.entries.splice(dest, 0, moved);

  applyBundlesToRuleOrder(bundles, matchEntry);
  _lastMovedRuleId = moved.id;
  renderRuleOrder();
  notifyStateChanged();
}

function initRuleOrderExpandAndDrag() {
  const groupModeBtn = document.getElementById("toggleRuleOrderGroupModeBtn");
  if (groupModeBtn && !groupModeBtn.dataset.bound) {
    groupModeBtn.dataset.bound = "true";
    groupModeBtn.addEventListener("click", () => {
      _ruleOrderGroupMode = !_ruleOrderGroupMode;
      groupModeBtn.classList.toggle("is-selected", _ruleOrderGroupMode);
      groupModeBtn.textContent = _ruleOrderGroupMode ? "按策略合组" : "逐条排序";
      renderRuleOrder();
    });
  }

  const expandBtn = document.getElementById("toggleRuleOrderExpandBtn");
  if (expandBtn && ruleOrderListEl && !expandBtn.dataset.bound) {
    expandBtn.dataset.bound = "true";
    expandBtn.addEventListener("click", () => {
      const expanded = ruleOrderListEl.classList.toggle("is-expanded");
      expandBtn.textContent = expanded ? "收起列表" : "展开列表";
    });
  }

  if (ruleOrderListEl && !ruleOrderListEl.dataset.dragBound) {
    ruleOrderListEl.dataset.dragBound = "true";

    ruleOrderListEl.addEventListener("dragover", (e) => {
      if (
        _dragSourceIndex == null &&
        _dragSourceBundlePolicy == null &&
        _dragSourceBundleChild == null
      )
        return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";

      const listRect = ruleOrderListEl.getBoundingClientRect();
      const edgeThreshold = 46;
      const scrollParent = ruleOrderListEl.classList.contains("is-expanded")
        ? ruleOrderListEl.closest(".body") || ruleOrderListEl
        : ruleOrderListEl;
      if (e.clientY - listRect.top < edgeThreshold) {
        scrollParent.scrollTop -= 12;
      } else if (listRect.bottom - e.clientY < edgeThreshold) {
        scrollParent.scrollTop += 12;
      }

      const row = e.target.closest(".rule-order-item");
      ruleOrderListEl
        .querySelectorAll(".drag-over-top, .drag-over-bottom")
        .forEach((el) => el.classList.remove("drag-over-top", "drag-over-bottom"));

      if (!row) return;
      if (row.classList.contains("rule-order-match")) {
        row.classList.add("drag-over-top");
        return;
      }

      const rect = row.getBoundingClientRect();
      const isTopHalf = e.clientY < rect.top + rect.height / 2;
      row.classList.add(isTopHalf ? "drag-over-top" : "drag-over-bottom");
    });

    ruleOrderListEl.addEventListener("dragleave", (e) => {
      if (!ruleOrderListEl.contains(e.relatedTarget)) {
        ruleOrderListEl
          .querySelectorAll(".drag-over-top, .drag-over-bottom")
          .forEach((el) =>
            el.classList.remove("drag-over-top", "drag-over-bottom")
          );
      }
    });

    ruleOrderListEl.addEventListener("drop", (e) => {
      if (
        _dragSourceIndex == null &&
        _dragSourceBundlePolicy == null &&
        _dragSourceBundleChild == null
      )
        return;
      e.preventDefault();

      const row = e.target.closest(".rule-order-item");
      clearDragIndicators();

      if (_dragSourceBundleChild != null) {
        const { policy, childIdx } = _dragSourceBundleChild;
        _dragSourceBundleChild = null;
        if (!row || row.dataset.childPolicy !== policy) return;
        const targetChildIdx = Number(row.dataset.childIndex);
        if (!Number.isFinite(targetChildIdx)) return;
        const rect = row.getBoundingClientRect();
        const insertAfter = e.clientY >= rect.top + rect.height / 2;
        moveRuleInsidePolicyBundleByDrop(
          policy,
          childIdx,
          targetChildIdx,
          insertAfter
        );
        return;
      }

      if (_dragSourceBundlePolicy != null) {
        const fromPolicy = _dragSourceBundlePolicy;
        _dragSourceBundlePolicy = null;
        if (!row) return;
        if (row.classList.contains("rule-order-match")) {
          const items = Array.isArray(state.ruleOrder) ? state.ruleOrder : [];
          const { bundles } = buildPolicyBundles(items);
          if (bundles.length) {
            movePolicyBundleByDrop(
              fromPolicy,
              bundles[bundles.length - 1].policy,
              true
            );
          }
          return;
        }
        const targetPolicy = row.dataset.bundlePolicy || row.dataset.childPolicy;
        if (!targetPolicy) return;
        const rect = row.getBoundingClientRect();
        const insertAfter = e.clientY >= rect.top + rect.height / 2;
        movePolicyBundleByDrop(fromPolicy, targetPolicy, insertAfter);
        return;
      }

      const fromIndex = _dragSourceIndex;
      _dragSourceIndex = null;

      let insertAfter = false;
      let targetIndex = null;

      if (row) {
        const rawIdx = Number(row.dataset.index);
        if (Number.isFinite(rawIdx)) {
          if (row.classList.contains("rule-order-match")) {
            targetIndex = rawIdx;
            insertAfter = false;
          } else {
            const rect = row.getBoundingClientRect();
            insertAfter = e.clientY >= rect.top + rect.height / 2;
            targetIndex = rawIdx;
          }
        }
      }

      if (targetIndex == null) return;
      moveRuleOrderByDrop(fromIndex, targetIndex, insertAfter);
    });

    ruleOrderListEl.addEventListener("dragend", () => {
      _dragSourceIndex = null;
      _dragSourceBundlePolicy = null;
      _dragSourceBundleChild = null;
      clearDragIndicators();
    });
  }
}

function getRuleEntryKindLabel(kind) {
  switch (kind) {
    case "GEOSITE":
      return t("ruleOrderKindGeosite");
    case "GEOIP":
      return t("ruleOrderKindGeoip");
    case "RULE-SET":
      return t("ruleOrderKindRuleSet");
    case "MANUAL":
      return t("ruleOrderKindManual");
    case "MATCH":
      return t("ruleOrderKindMatch");
    default:
      return kind;
  }
}

function getRuleEntryDisplayLabel(entry) {
  if (entry.kind === "MATCH") return "";
  if (entry.kind === "GEOIP") {
    const code = String(entry.key ?? "");
    const flag = isoToFlag(code);
    return escapeHtml(flag ? `${flag}\u00A0${code}` : code);
  }
  return escapeHtml(String(entry.key ?? ""));
}

export function renderRuleOrder() {
  if (!ruleOrderListEl) return;
  initRuleOrderExpandAndDrag();

  const prevScrollTop = ruleOrderListEl.scrollTop;
  ruleOrderListEl.innerHTML = "";

  const items =
    Array.isArray(state.ruleOrder) && state.ruleOrder.length
      ? state.ruleOrder
      : buildRuleEntriesArray();

  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = t("ruleOrderEmpty");
    ruleOrderListEl.appendChild(empty);
    return;
  }

  if (_ruleOrderGroupMode) {
    const { bundles, matchEntry } = buildPolicyBundles(items);

    bundles.forEach((bundle, bIdx) => {
      const wrap = document.createElement("div");
      wrap.className = "rule-bundle-wrap";

      const row = document.createElement("div");
      row.className = "rule-order-item rule-bundle-header";
      row.dataset.bundlePolicy = bundle.policy;
      if (_lastMovedRuleId === `BUNDLE:${bundle.policy}`) {
        row.classList.add("is-just-moved");
      }

      row.draggable = true;
      row.addEventListener("dragstart", (e) => {
        if (e.target.closest("button")) {
          e.preventDefault();
          return;
        }
        _dragSourceBundlePolicy = bundle.policy;
        _dragSourceIndex = null;
        row.classList.add("is-dragging");
        if (e.dataTransfer) {
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", bundle.policy);
        }
      });

      const isExpanded = _expandedPolicyBundles.has(bundle.policy);
      const previewKeys = bundle.entries
        .slice(0, 3)
        .map((e) => e.key)
        .join("、");
      const moreSuffix = bundle.entries.length > 3 ? " 等" : "";

      row.innerHTML = `
        <div class="rule-order-main">
          <span class="drag-handle" title="按住整组拖动调整策略优先级">⋮⋮</span>
          <span class="rule-order-index">#${bIdx + 1}</span>
          <span class="pill" style="color:var(--text);font-weight:600">${escapeHtml(
            bundle.policy
          )}</span>
          <span class="rule-order-label" title="包含: ${escapeHtml(
            previewKeys + moreSuffix
          )}">共 <b>${bundle.entries.length}</b> 条规则 (${escapeHtml(
        previewKeys + moreSuffix
      )})</span>
        </div>
        <div class="rule-order-actions"></div>
      `;

      const actions = row.querySelector(".rule-order-actions");

      const detailBtn = document.createElement("button");
      detailBtn.type = "button";
      detailBtn.className = "edge-btn";
      detailBtn.textContent = isExpanded ? "收起明细" : "展开明细";
      detailBtn.addEventListener("click", () => {
        if (_expandedPolicyBundles.has(bundle.policy)) {
          _expandedPolicyBundles.delete(bundle.policy);
        } else {
          _expandedPolicyBundles.add(bundle.policy);
        }
        renderRuleOrder();
      });

      const topBtn = document.createElement("button");
      topBtn.type = "button";
      topBtn.className = "edge-btn move-top";
      topBtn.title = "将该策略组全部规则移至最顶部";
      topBtn.innerHTML = `⇡ <span>置顶</span>`;
      topBtn.addEventListener("click", () =>
        movePolicyBundleToEdge(bundle.policy, "top")
      );

      const bottomBtn = document.createElement("button");
      bottomBtn.type = "button";
      bottomBtn.className = "edge-btn move-bottom";
      bottomBtn.title = "将该策略组全部规则移至最底部";
      bottomBtn.innerHTML = `⇣ <span>置底</span>`;
      bottomBtn.addEventListener("click", () =>
        movePolicyBundleToEdge(bundle.policy, "bottom")
      );

      actions.appendChild(detailBtn);
      actions.appendChild(topBtn);
      actions.appendChild(bottomBtn);
      wrap.appendChild(row);

      if (isExpanded) {
        const childrenBox = document.createElement("div");
        childrenBox.className = "rule-bundle-children";
        bundle.entries.forEach((entry, cIdx) => {
          const childRow = document.createElement("div");
          childRow.className = "rule-order-item rule-bundle-child";
          childRow.dataset.childPolicy = bundle.policy;
          childRow.dataset.childIndex = String(cIdx);
          if (entry.id && entry.id === _lastMovedRuleId) {
            childRow.classList.add("is-just-moved");
          }
          childRow.draggable = bundle.entries.length > 1;
          if (bundle.entries.length > 1) {
            childRow.addEventListener("dragstart", (e) => {
              if (e.target.closest("button")) {
                e.preventDefault();
                return;
              }
              _dragSourceBundleChild = { policy: bundle.policy, childIdx: cIdx };
              _dragSourceBundlePolicy = null;
              _dragSourceIndex = null;
              childRow.classList.add("is-dragging");
              if (e.dataTransfer) {
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", `${bundle.policy}:${cIdx}`);
              }
            });
          }
          const kindLabel = getRuleEntryKindLabel(entry.kind);
          const label = getRuleEntryDisplayLabel(entry);
          childRow.innerHTML = `
            <div class="rule-order-main">
              <span class="drag-handle" title="按住可在组内上下拖动">⋮⋮</span>
              <span class="rule-order-index">${bIdx + 1}.${cIdx + 1}</span>
              <span class="pill">${kindLabel}</span>
              <span class="rule-order-label" title="${label}">${label}</span>
            </div>
            <div class="rule-order-actions"></div>
          `;
          const childActions = childRow.querySelector(".rule-order-actions");
          if (bundle.entries.length > 1) {
            const cTop = document.createElement("button");
            cTop.type = "button";
            cTop.className = "edge-btn move-top";
            cTop.innerHTML = `⇡ <span>组内置顶</span>`;
            cTop.addEventListener("click", () =>
              moveRuleInsidePolicyBundle(bundle.policy, cIdx, "top")
            );
            const cBottom = document.createElement("button");
            cBottom.type = "button";
            cBottom.className = "edge-btn move-bottom";
            cBottom.innerHTML = `⇣ <span>组内置底</span>`;
            cBottom.addEventListener("click", () =>
              moveRuleInsidePolicyBundle(bundle.policy, cIdx, "bottom")
            );
            childActions.appendChild(cTop);
            childActions.appendChild(cBottom);
          }
          childrenBox.appendChild(childRow);
        });
        wrap.appendChild(childrenBox);
      }

      ruleOrderListEl.appendChild(wrap);
    });

    if (matchEntry) {
      const matchRow = document.createElement("div");
      matchRow.className = "rule-order-item rule-order-match";
      const policyTag = matchEntry.policy
        ? ` → <b>${escapeHtml(matchEntry.policy)}</b>`
        : "";
      matchRow.innerHTML = `
        <div class="rule-order-main">
          <span class="rule-order-index" title="固定在最底部">末尾</span>
          <span class="pill">${getRuleEntryKindLabel("MATCH")}</span>
          <span class="rule-order-label">${policyTag}</span>
        </div>
        <div class="rule-order-actions"></div>
      `;
      ruleOrderListEl.appendChild(matchRow);
    }

    ruleOrderListEl.scrollTop = prevScrollTop;
    applyTwemoji(ruleOrderListEl);
    return;
  }

  const matchKind = "MATCH";

  items.forEach((entry, index) => {
    const row = document.createElement("div");
    row.className = "rule-order-item";
    row.dataset.index = String(index);
    if (entry.id && entry.id === _lastMovedRuleId) {
      row.classList.add("is-just-moved");
    }

    const isMatch = entry.kind === matchKind;
    if (isMatch) {
      row.classList.add("rule-order-match");
    } else {
      row.draggable = true;
      row.addEventListener("dragstart", (e) => {
        if (e.target.closest("button")) {
          e.preventDefault();
          return;
        }
        _dragSourceIndex = index;
        _dragSourceBundlePolicy = null;
        row.classList.add("is-dragging");
        if (e.dataTransfer) {
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", String(index));
        }
      });
    }

    const kindLabel = getRuleEntryKindLabel(entry.kind);
    const label = getRuleEntryDisplayLabel(entry);

    const policyTag = entry.policy ? ` → <b>${escapeHtml(entry.policy)}</b>` : "";
    const handleHtml = isMatch
      ? `<span class="rule-order-index" title="固定在最底部">末尾</span>`
      : `<span class="drag-handle" title="按住上下拖动调整优先级">⋮⋮</span><span class="rule-order-index">#${
          index + 1
        }</span>`;

    row.innerHTML = `
      <div class="rule-order-main">
        ${handleHtml}
        <span class="pill">${kindLabel}</span>
        ${
          label
            ? `<span class="rule-order-label" title="${label} → ${escapeHtml(
                entry.policy || ""
              )}">${label}${policyTag}</span>`
            : `<span class="rule-order-label">${policyTag}</span>`
        }
      </div>
      <div class="rule-order-actions"></div>
    `;

    const actions = row.querySelector(".rule-order-actions");

    if (!isMatch) {
      const topBtn = document.createElement("button");
      topBtn.type = "button";
      topBtn.className = "edge-btn move-top";
      topBtn.title = t("ruleOrderMoveTop") || "移至顶部（最高优先级）";
      topBtn.innerHTML = `⇡ <span>置顶</span>`;
      topBtn.addEventListener("click", () => moveRuleOrderToEdge(index, "top"));

      const bottomBtn = document.createElement("button");
      bottomBtn.type = "button";
      bottomBtn.className = "edge-btn move-bottom";
      bottomBtn.title = t("ruleOrderMoveBottom") || "移至尾部（仅高于兜底规则）";
      bottomBtn.innerHTML = `⇣ <span>置底</span>`;
      bottomBtn.addEventListener("click", () =>
        moveRuleOrderToEdge(index, "bottom")
      );

      actions.appendChild(topBtn);
      actions.appendChild(bottomBtn);
    }

    ruleOrderListEl.appendChild(row);
  });

  ruleOrderListEl.scrollTop = prevScrollTop;
  applyTwemoji(ruleOrderListEl);
}

function moveRuleOrderByDrop(fromIndex, targetIndex, insertAfter) {
  const items =
    Array.isArray(state.ruleOrder) && state.ruleOrder.length
      ? state.ruleOrder
      : (state.ruleOrder = buildRuleEntriesArray());

  const item = items[fromIndex];
  if (!item || item.kind === "MATCH") return;

  const movableCount = items.filter((e) => e.kind !== "MATCH").length;
  if (!movableCount) return;

  let dest = insertAfter ? targetIndex + 1 : targetIndex;
  if (fromIndex < dest) {
    dest -= 1;
  }
  dest = Math.max(0, Math.min(movableCount - 1, dest));
  if (dest === fromIndex) return;

  items.splice(fromIndex, 1);
  items.splice(dest, 0, item);

  _lastMovedRuleId = item.id;
  renderRuleOrder();
  notifyStateChanged();
}

function moveRuleOrderToEdge(index, direction) {
  const items =
    Array.isArray(state.ruleOrder) && state.ruleOrder.length
      ? state.ruleOrder
      : (state.ruleOrder = buildRuleEntriesArray());

  const item = items[index];
  if (!item) return;

  if (item.kind === "MATCH") return;

  const movable = items.filter((e) => e.kind !== "MATCH");
  const movableCount = movable.length;
  if (!movableCount) return;

  const target = direction === "top" ? 0 : movableCount - 1;
  if (index === target) return;

  items.splice(index, 1);
  items.splice(target, 0, item);

  _lastMovedRuleId = item.id;
  renderRuleOrder();
  if (ruleOrderListEl) {
    ruleOrderListEl.scrollTop =
      direction === "top" ? 0 : ruleOrderListEl.scrollHeight;
  }
  notifyStateChanged();
}

export function renderRulesTargets() {
  renderGeositeList(document.getElementById("geositeSearch").value);
  renderGeoipList(document.getElementById("geoipSearch").value);
  renderRuleProvidersPolicySelect();
  renderRuleProviders();
  rebuildRuleOrderFromState();
}

export function renderMatchSelect() {
  if (!matchSelectEl) return;
  normalizeMatchSelection();

  fillActionSelect(matchSelectEl);

  let current = "";
  if (state.match.mode === "builtin") {
    current = state.match.value || "";
  } else if (state.match.mode === "group") {
    current = state.match.value || "";
  }

  if (current && [...matchSelectEl.options].some((o) => o.value === current)) {
    matchSelectEl.value = current;
  } else {
    matchSelectEl.value = "";
  }
}

if (matchSelectEl) {
  matchSelectEl.addEventListener("change", () => {
    const v = matchSelectEl.value;
    if (!v) {
      state.match = { mode: "auto", value: "" };
    } else if (v === "DIRECT" || v === "REJECT") {
      state.match = { mode: "builtin", value: v };
    } else {
      state.match = { mode: "group", value: v };
    }
    rebuildRuleOrderFromState();
    notifyStateChanged();
  });
}

export function makeRuleRow(kind, name, pretty, query = "") {
  const map = kind === "geosite" ? state.rulesGeosite : state.rulesGeoip;
  const current = map.get(name);
  const displayName = highlightMatch(pretty, query);

  const row = document.createElement("div");
  row.className = "item rule-item";
  if (current) row.classList.add("is-active");

  row.dataset.kind = kind;
  row.dataset.name = name;

  row.innerHTML = `
    <div class="rule-main">
      <span class="pill rule-kind">${kind.toUpperCase()}</span>
      <span class="rule-name"
            title="${escapeHtml(pretty)}"
            data-full="${escapeHtml(pretty)}">${displayName}</span>
    </div>
    <div class="rule-actions">
      <select data-role="rule-action"></select>
    </div>
  `;

  const actionSel = row.querySelector('[data-role="rule-action"]');
  fillActionSelect(actionSel);

  if (current) {
    let val = "";
    if (current.action === "PROXY") val = current.target || "";
    else if (current.action === "DIRECT") val = "DIRECT";
    else if (current.action === "BLOCK" || current.target === "REJECT")
      val = "REJECT";
    actionSel.value = val;
  }

  return row;
}

function applyRuleSelection(kind, name, value, row) {
  const map = kind === "geosite" ? state.rulesGeosite : state.rulesGeoip;

  if (!value) {
    map.delete(name);
    row.classList.remove("is-active");
    return;
  }

  if (value === "DIRECT") {
    map.set(name, { action: "DIRECT", target: "DIRECT" });
  } else if (value === "REJECT") {
    map.set(name, { action: "BLOCK", target: "REJECT" });
  } else {
    map.set(name, { action: "PROXY", target: value });
  }

  row.classList.add("is-active");
}

function handleRuleListChange(e) {
  const sel = e.target.closest('select[data-role="rule-action"]');
  if (!sel) return;

  const row = sel.closest(".rule-item");
  if (!row) return;

  const kind = row.dataset.kind;
  const name = row.dataset.name;
  const value = sel.value;

  applyRuleSelection(kind, name, value, row);
  rebuildRuleOrderFromState();
  notifyStateChanged();
}

function handleRuleListClick(e) {
  const clearBtn = e.target.closest('[data-role="rule-clear"]');
  if (clearBtn) {
    const row = clearBtn.closest(".rule-item");
    if (!row) return;
    const kind = row.dataset.kind;
    const name = row.dataset.name;
    const map = kind === "geosite" ? state.rulesGeosite : state.rulesGeoip;
    map.delete(name);
    row.classList.remove("is-active");
    rebuildRuleOrderFromState();
    notifyStateChanged();
    return;
  }

  const row = e.target.closest(".rule-item");
  if (!row || e.target.closest("select")) return;

  const kind = row.dataset.kind;
  const name = row.dataset.name;
  const map = kind === "geosite" ? state.rulesGeosite : state.rulesGeoip;
  const sel = row.querySelector('select[data-role="rule-action"]');
  if (!sel) return;

  if (map.has(name)) {
    map.delete(name);
    row.classList.remove("is-active");
  } else {
    const value = sel.value;
    if (!value) {
      setStatus("err", t("selectRuleAction"));
      return;
    }
    applyRuleSelection(kind, name, value, row);
  }

  rebuildRuleOrderFromState();
  notifyStateChanged();
}

export function initRuleListsDelegation() {
  const geositeListEl = document.getElementById("geositeList");
  const geoipListEl = document.getElementById("geoipList");
  [geositeListEl, geoipListEl].forEach((list) => {
    if (!list) return;
    list.addEventListener("change", handleRuleListChange);
    list.addEventListener("click", handleRuleListClick);
  });
}

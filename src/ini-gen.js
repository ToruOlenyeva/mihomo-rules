import { state, getMatchPolicyTarget } from "./state.js";
import { buildRuleEntriesArray } from "./rules.js";
import { uniq } from "./utils.js";

export const ACL4SSR_PRESETS = [
  {
    name: "ACL4SSR 在线精简版 (无国家分组)",
    url: "https://raw.githubusercontent.com/ZeroDeng01/ACL4SSR/master/Clash/config/ACL4SSR_Online_Full_NoCountry.ini",
  },
  {
    name: "ACL4SSR 在线全分组 (标准全功能)",
    url: "https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/config/ACL4SSR_Online_Full.ini",
  },
  {
    name: "ACL4SSR 在线精简版 (含 AI 分流)",
    url: "https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/config/ACL4SSR_Online_Mini_Ai.ini",
  },
  {
    name: "ACL4SSR 在线精简版 (多国家)",
    url: "https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/config/ACL4SSR_Online_Mini_MultiCountry.ini",
  },
  {
    name: "ACL4SSR 在线标准版 (典型分组)",
    url: "https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/config/ACL4SSR_Online.ini",
  },
  {
    name: "ACL4SSR 在线去广告加强版",
    url: "https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/config/ACL4SSR_Online_AdblockPlus.ini",
  },
];

function normalizeRegexFilter(rawFilter) {
  const f = String(rawFilter || "").trim();
  if (!f) return "";
  if (f === ".*" || f === "(.*)") return ".*";
  // Standard INI rule converters require regex filters to start with "(", end with ")", and contain "|"
  if (f.startsWith("(") && f.endsWith(")")) {
    if (f.includes("|")) return f;
    const inner = f.slice(1, -1).trim();
    return inner ? `(${inner}|${inner})` : "";
  }
  if (f.includes("|")) {
    return `(${f})`;
  }
  return `(${f}|${f})`;
}

export function emitGroupsIni() {
  if (!state.groups || !state.groups.length) return "";
  const lines = [
    ";设置分组标志位",
    ";格式: custom_proxy_group=组名`类型`[]引用分组或节点`正则过滤`测速地址`间隔,,容差",
  ];

  state.groups.forEach((g) => {
    const name = (g.name || "GROUP").trim();
    const type = (g.type || "select").trim();
    const parts = [name, type];

    const refs = uniq([...(g.manual || []), ...(g.proxies || [])]);
    let hasWildcard = false;
    const regexList = [];

    refs.forEach((item) => {
      const trimmed = String(item || "").trim();
      if (!trimmed) return;
      if (trimmed === ".*" || trimmed === "(.*)") {
        hasWildcard = true;
        return;
      }
      if (
        (trimmed.startsWith("(") && trimmed.endsWith(")")) ||
        trimmed.includes("|")
      ) {
        regexList.push(normalizeRegexFilter(trimmed));
        return;
      }
      if (trimmed.startsWith("[]")) {
        parts.push(trimmed);
      } else {
        parts.push(`[]${trimmed}`);
      }
    });

    if (g.filter && String(g.filter).trim()) {
      const nf = normalizeRegexFilter(g.filter);
      if (nf === ".*") {
        hasWildcard = true;
      } else if (nf) {
        regexList.push(nf);
      }
    }

    uniq(regexList).forEach((rx) => parts.push(rx));

    // If user explicitly enabled wildcard or group has no refs/regex at all, include .* so converter populates nodes
    if (hasWildcard || (refs.length === 0 && regexList.length === 0)) {
      parts.push(".*");
    }

    if (type === "url-test" || type === "fallback" || type === "load-balance") {
      const testUrl = (g.url || "http://www.gstatic.com/generate_204").trim();
      const interval = Number(g.interval) > 0 ? Number(g.interval) : 300;
      const tolerance = Number(g.tolerance) > 0 ? Number(g.tolerance) : 150;
      parts.push(testUrl);
      if (type === "url-test" || type === "fallback") {
        parts.push(`${interval},,${tolerance}`);
      } else {
        parts.push(`${interval}`);
      }
    }

    lines.push(`custom_proxy_group=${parts.join("`")}`);
  });

  return lines.join("\n");
}

export function emitRulesIni() {
  const lines = [
    ";设置规则标志位",
    ";支持内联规则 ([]DOMAIN-SUFFIX / []IP-CIDR / []GEOSITE / []GEOIP / []FINAL) 与远程规则集 URL",
  ];

  const entries =
    Array.isArray(state.ruleOrder) && state.ruleOrder.length
      ? state.ruleOrder
      : buildRuleEntriesArray();

  const rpMap = new Map(
    (state.ruleProviders || []).map((rp) => [rp.name, rp])
  );

  entries.forEach((e) => {
    const policy = e.policy || getMatchPolicyTarget() || "DIRECT";
    switch (e.kind) {
      case "MANUAL": {
        const keyStr = String(e.key || "").trim();
        if (!keyStr) break;
        const ruleType = keyStr.split(",")[0]?.toUpperCase() || "";
        const needsNoResolve =
          (ruleType === "IP-CIDR" ||
            ruleType === "IP-CIDR6" ||
            ruleType === "IP-ASN") &&
          !keyStr.endsWith(",no-resolve");
        lines.push(
          `ruleset=${policy},[]${keyStr}${needsNoResolve ? ",no-resolve" : ""}`
        );
        break;
      }
      case "GEOSITE": {
        lines.push(`ruleset=${policy},[]GEOSITE,${e.key}`);
        break;
      }
      case "GEOIP": {
        const code = String(e.key || "").trim();
        if (!code) break;
        const suffix = code.endsWith(",no-resolve") ? "" : ",no-resolve";
        lines.push(`ruleset=${policy},[]GEOIP,${code}${suffix}`);
        break;
      }
      case "RULE-SET": {
        const rp = rpMap.get(e.key);
        if (!rp || !rp.url) break;
        const targetGroup = rp.policy || policy;
        const rawUrl = rp.url.trim();
        const interval = Number(rp.interval) || 86400;

        if (rp.sourceType === "surge" || rp.sourceType === "list") {
          const intervalSuffix = interval !== 86400 ? `,${interval}` : "";
          lines.push(`ruleset=${targetGroup},${rawUrl}${intervalSuffix}`);
        } else {
          let prefix = "clash-classic:";
          if (rp.behavior === "domain") prefix = "clash-domain:";
          else if (rp.behavior === "ipcidr") prefix = "clash-ipcidr:";
          else if (rp.behavior === "classical") prefix = "clash-classic:";
          lines.push(`ruleset=${targetGroup},${prefix}${rawUrl},${interval}`);
        }
        break;
      }
      case "MATCH": {
        const matchTarget = getMatchPolicyTarget() || policy || "DIRECT";
        lines.push(`ruleset=${matchTarget},[]FINAL`);
        break;
      }
    }
  });

  return lines.join("\n");
}

export function emitIniConfig() {
  const header = [
    "[custom]",
    ";Generated by Mihomo Constructor",
    ";通用远程分流规则配置 (ACL4SSR / INI 兼容格式)",
    "",
  ].join("\n");

  const rulesBlock = emitRulesIni();
  const groupsBlock = emitGroupsIni();

  return [header, rulesBlock, "", groupsBlock, ""].join("\n");
}

function providerNameFromUrl(rawUrl, usedNames) {
  let base = "ruleset";
  try {
    const u = new URL(rawUrl);
    const seg = u.pathname.split("/").filter(Boolean).pop() || "ruleset";
    base = seg.replace(/\.(list|yaml|yml|txt|ini)$/i, "") || "ruleset";
  } catch {
    const seg = String(rawUrl).split("/").filter(Boolean).pop() || "ruleset";
    base = seg.replace(/\.(list|yaml|yml|txt|ini)$/i, "") || "ruleset";
  }
  base = base.replace(/[^a-zA-Z0-9_\-\u4e00-\u9fa5]/g, "_");
  if (!usedNames.has(base)) {
    usedNames.add(base);
    return base;
  }
  let idx = 2;
  while (usedNames.has(`${base}_${idx}`)) idx++;
  const finalName = `${base}_${idx}`;
  usedNames.add(finalName);
  return finalName;
}

export function parseIniToState(iniContent) {
  const lines = String(iniContent || "").split(/\r?\n/);
  const newGroups = [];
  const newRuleProviders = [];
  const newManualRules = [];
  const newRulesGeosite = new Map();
  const newRulesGeoip = new Map();
  const newRuleOrder = [];
  const usedProviderNames = new Set();
  let matchTarget = "";

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith(";") || line.startsWith("#") || line.startsWith("[")) {
      continue;
    }

    if (line.startsWith("custom_proxy_group=")) {
      const body = line.slice("custom_proxy_group=".length).trim();
      const parts = body.split("`");
      if (parts.length < 2) continue;

      const name = parts[0].trim();
      const type = parts[1].trim() || "select";
      const manual = [];
      const regexFilters = [];
      let includeAll = false;
      let testUrl = "";
      let interval = 300;
      let tolerance = 150;

      for (let i = 2; i < parts.length; i++) {
        const p = parts[i].trim();
        if (!p) continue;
        if (p.startsWith("http://") || p.startsWith("https://")) {
          testUrl = p;
          continue;
        }
        if (/^\d+/.test(p)) {
          if (p.includes(",")) {
            const nums = p.split(",");
            if (nums[0]) interval = parseInt(nums[0], 10) || 300;
            const last = nums[nums.length - 1];
            if (last) tolerance = parseInt(last, 10) || 150;
          } else {
            interval = parseInt(p, 10) || 300;
          }
          continue;
        }
        const clean = p.startsWith("[]") ? p.slice(2).trim() : p;
        if (!clean) continue;
        if (clean === ".*" || clean === "(.*)") {
          includeAll = true;
          continue;
        }
        if (clean.startsWith("(") && clean.endsWith(")") && clean.includes("|")) {
          regexFilters.push(clean);
          continue;
        }
        manual.push(clean);
      }

      let filter = "";
      if (regexFilters.length === 1) {
        filter = regexFilters[0];
      } else if (regexFilters.length > 1) {
        const merged = regexFilters
          .map((f) => f.replace(/^\(|\)$/g, ""))
          .join("|");
        filter = `(${merged})`;
      } else if (includeAll) {
        filter = ".*";
      }

      newGroups.push({
        name,
        type,
        icon: "",
        proxies: [],
        manual,
        filter,
        url: testUrl,
        interval,
        tolerance,
      });
      continue;
    }

    if (line.startsWith("ruleset=")) {
      const body = line.slice("ruleset=".length).trim();
      const commaIdx = body.indexOf(",");
      if (commaIdx === -1) continue;
      const group = body.slice(0, commaIdx).trim();
      const ruleRaw = body.slice(commaIdx + 1).trim();
      if (!group || !ruleRaw) continue;

      if (ruleRaw.startsWith("[]")) {
        const inline = ruleRaw.slice(2).trim();
        const segs = inline.split(",");
        const rType = (segs[0] || "").trim().toUpperCase();
        const rVal = (segs[1] || "").trim();

        if (rType === "FINAL" || rType === "MATCH") {
          matchTarget = group;
          continue;
        }
        if (rType === "GEOSITE" && rVal) {
          newRulesGeosite.set(rVal, {
            action: group === "DIRECT" ? "DIRECT" : group === "REJECT" ? "BLOCK" : "PROXY",
            target: group,
          });
          newRuleOrder.push({
            id: `GEOSITE:${rVal}`,
            kind: "GEOSITE",
            key: rVal,
            policy: group,
          });
          continue;
        }
        if (rType === "GEOIP" && rVal) {
          newRulesGeoip.set(rVal, {
            action: group === "DIRECT" ? "DIRECT" : group === "REJECT" ? "BLOCK" : "PROXY",
            target: group,
          });
          newRuleOrder.push({
            id: `GEOIP:${rVal}`,
            kind: "GEOIP",
            key: rVal,
            policy: group,
          });
          continue;
        }
        if (rType && rVal) {
          const id = `${Date.now()}_${Math.random().toString(16).slice(2)}_${newManualRules.length}`;
          let action = "PROXY";
          let target = group;
          if (group === "DIRECT") {
            action = "DIRECT";
            target = "";
          } else if (group === "REJECT") {
            action = "BLOCK";
            target = "REJECT";
          }
          newManualRules.push({
            id,
            type: rType,
            value: rVal,
            action,
            target,
          });
          newRuleOrder.push({
            id: `MANUAL:${id}`,
            kind: "MANUAL",
            key: `${rType},${rVal}`,
            policy: group,
          });
        }
      } else {
        // Remote ruleset URL
        let sourcePart = ruleRaw;
        let interval = 86400;
        const lastComma = ruleRaw.lastIndexOf(",");
        if (lastComma > 0) {
          const maybeNum = ruleRaw.slice(lastComma + 1).trim();
          if (/^\d+$/.test(maybeNum)) {
            interval = parseInt(maybeNum, 10);
            sourcePart = ruleRaw.slice(0, lastComma).trim();
          }
        }

        let sourceType = "surge";
        let behavior = "classical";
        let url = sourcePart;
        const colonIdx = sourcePart.indexOf(":");
        if (colonIdx > 0) {
          const prefix = sourcePart.slice(0, colonIdx).trim().toLowerCase();
          if (
            [
              "surge",
              "quanx",
              "clash-domain",
              "clash-ipcidr",
              "clash-classic",
              "clash-classical",
            ].includes(prefix)
          ) {
            sourceType = prefix;
            url = sourcePart.slice(colonIdx + 1).trim();
            if (prefix === "clash-domain") behavior = "domain";
            else if (prefix === "clash-ipcidr") behavior = "ipcidr";
            else behavior = "classical";
          }
        }

        const name = providerNameFromUrl(url, usedProviderNames);
        const ext = url.toLowerCase().endsWith(".yaml") || url.toLowerCase().endsWith(".yml") ? "yaml" : "text";
        newRuleProviders.push({
          name,
          url,
          behavior,
          sourceType,
          policy: group,
          type: "http",
          format: ext,
          path: `./rules/${name}.${ext === "yaml" ? "yaml" : "list"}`,
          interval,
        });
        newRuleOrder.push({
          id: `RULE-SET:${name}`,
          kind: "RULE-SET",
          key: name,
          policy: group,
        });
      }
    }
  }

  state.groups = newGroups;
  state.ruleProviders = newRuleProviders;
  state.manualRules = newManualRules;
  state.rulesGeosite = newRulesGeosite;
  state.rulesGeoip = newRulesGeoip;

  if (matchTarget) {
    if (matchTarget === "DIRECT" || matchTarget === "REJECT") {
      state.match = { mode: "builtin", value: matchTarget };
    } else {
      state.match = { mode: "group", value: matchTarget };
    }
  } else if (newGroups.length) {
    state.match = { mode: "group", value: newGroups[0].name };
  } else {
    state.match = { mode: "auto", value: "" };
  }

  newRuleOrder.push({
    id: "MATCH:__default__",
    kind: "MATCH",
    key: "MATCH",
    policy: getMatchPolicyTarget(),
  });
  state.ruleOrder = newRuleOrder;

  return {
    groups: newGroups.length,
    ruleProviders: newRuleProviders.length,
    manualRules: newManualRules.length,
    geosite: newRulesGeosite.size,
    geoip: newRulesGeoip.size,
  };
}

import { state, getMatchPolicyTarget } from "./state.js";
import { parseIniToState } from "./ini-gen.js";
import { uniq } from "./utils.js";

function unquoteYaml(val) {
  const s = String(val ?? "").trim();
  if (!s) return "";
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    return s.slice(1, -1).trim();
  }
  return s;
}

function stripInlineComment(line) {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (ch === "#" && !inSingle && !inDouble) {
      if (i === 0 || /\s/.test(line[i - 1])) {
        return line.slice(0, i).trimEnd();
      }
    }
  }
  return line;
}

function parseFlowArray(raw) {
  const s = String(raw || "").trim();
  if (!s.startsWith("[") || !s.endsWith("]")) return [];
  const inner = s.slice(1, -1).trim();
  if (!inner) return [];
  const res = [];
  let cur = "";
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      cur += ch;
    } else if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      cur += ch;
    } else if (ch === "," && !inSingle && !inDouble) {
      const cleaned = unquoteYaml(cur);
      if (cleaned) res.push(cleaned);
      cur = "";
    } else {
      cur += ch;
    }
  }
  const last = unquoteYaml(cur);
  if (last) res.push(last);
  return res;
}

function parseFlowMap(raw) {
  const s = String(raw || "").trim();
  if (!s.startsWith("{") || !s.endsWith("}")) return {};
  const inner = s.slice(1, -1).trim();
  if (!inner) return {};
  const parts = [];
  let cur = "";
  let depthBracket = 0;
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (!inSingle && !inDouble) {
      if (ch === "[") depthBracket++;
      else if (ch === "]") depthBracket = Math.max(0, depthBracket - 1);
      else if (ch === "," && depthBracket === 0) {
        parts.push(cur.trim());
        cur = "";
        continue;
      }
    }
    cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());

  const obj = {};
  for (const part of parts) {
    const colonIdx = part.indexOf(":");
    if (colonIdx === -1) continue;
    const k = unquoteYaml(part.slice(0, colonIdx));
    const vRaw = part.slice(colonIdx + 1).trim();
    if (vRaw.startsWith("[") && vRaw.endsWith("]")) {
      obj[k] = parseFlowArray(vRaw);
    } else {
      obj[k] = unquoteYaml(vRaw);
    }
  }
  return obj;
}

function inferRegionRegexFromGroupName(name) {
  const n = String(name || "");
  if (/香港|HK|Hong\s*Kong/i.test(n)) return "(香港|HK|Hong Kong|HongKong)";
  if (/美国|US|America|United\s*States/i.test(n))
    return "(美国|US|United States|America)";
  if (/日本|JP|Japan/i.test(n)) return "(日本|JP|Japan)";
  if (/新加坡|狮城|SG|Singapore/i.test(n)) return "(新加坡|SG|Singapore|狮城)";
  if (/台湾|TW|Taiwan/i.test(n)) return "(台湾|TW|Taiwan|新北|彰化)";
  if (/韩国|KR|Korea/i.test(n)) return "(韩国|KR|Korea|首尔)";
  if (/英国|UK|Britain/i.test(n)) return "(英国|UK|United Kingdom|伦敦)";
  if (/德国|DE|Germany/i.test(n)) return "(德国|DE|Germany|法兰克福)";
  return ".*";
}

export function isIniFormatText(text) {
  const s = String(text || "").trim();
  if (!s) return false;
  return (
    /^\[custom\]/im.test(s) ||
    /^\s*ruleset\s*=/im.test(s) ||
    /^\s*custom_proxy_group\s*=/im.test(s)
  );
}

export function parseConfigTextToState(rawText) {
  if (isIniFormatText(rawText)) {
    return { format: "ini", ...parseIniToState(rawText) };
  }
  return { format: "yaml", ...parseYamlToState(rawText) };
}

export function parseYamlToState(yamlContent) {
  const rawLines = String(yamlContent || "").split(/\r?\n/);

  let currentSection = "";
  const rawProxies = [];
  const rawGroups = [];
  const rawRuleProviders = {};
  const rawProxyProviders = {};
  const rawRules = [];

  let currentObj = null;
  let currentSubKey = "";
  let currentMapKey = "";
  let currentMapIndent = -1;

  for (let i = 0; i < rawLines.length; i++) {
    const cleaned = stripInlineComment(rawLines[i]);
    if (!cleaned.trim()) continue;

    const indent = cleaned.match(/^\s*/)[0].length;
    const trimmed = cleaned.trim();

    // Top-level section header
    if (indent === 0 && /^[a-zA-Z0-9_-]+\s*:/.test(trimmed)) {
      const secName = trimmed.split(":")[0].trim();
      currentSection = secName;
      currentObj = null;
      currentSubKey = "";
      currentMapKey = "";
      currentMapIndent = -1;
      continue;
    }

    if (currentSection === "proxies") {
      if (trimmed.startsWith("- ")) {
        const rest = trimmed.slice(2).trim();
        if (rest.startsWith("{") && rest.endsWith("}")) {
          const parsed = parseFlowMap(rest);
          if (parsed.name) rawProxies.push(parsed);
          currentObj = null;
        } else {
          currentObj = {};
          rawProxies.push(currentObj);
          const kv = rest.match(/^([a-zA-Z0-9_-]+)\s*:\s*(.*)$/);
          if (kv) {
            currentObj[kv[1]] = unquoteYaml(kv[2]);
          }
        }
      } else if (currentObj && indent >= 2) {
        const kv = trimmed.match(/^([a-zA-Z0-9_-]+)\s*:\s*(.*)$/);
        if (kv && kv[2]) {
          currentObj[kv[1]] = unquoteYaml(kv[2]);
        }
      }
      continue;
    }

    if (currentSection === "proxy-groups") {
      if (trimmed.startsWith("- ")) {
        const rest = trimmed.slice(2).trim();
        currentSubKey = "";
        if (rest.startsWith("{") && rest.endsWith("}")) {
          const parsed = parseFlowMap(rest);
          rawGroups.push({
            name: parsed.name || "GROUP",
            type: parsed.type || "select",
            icon: parsed.icon || "",
            proxies: Array.isArray(parsed.proxies) ? parsed.proxies : [],
            use: Array.isArray(parsed.use) ? parsed.use : [],
            filter: parsed.filter || "",
            includeAll:
              parsed["include-all"] === "true" || parsed["include-all"] === true,
            url: parsed.url || "",
            interval: Number(parsed.interval) || 300,
            tolerance: Number(parsed.tolerance) || 150,
          });
          currentObj = null;
        } else {
          currentObj = {
            name: "",
            type: "select",
            icon: "",
            proxies: [],
            use: [],
            filter: "",
            includeAll: false,
            url: "",
            interval: 300,
            tolerance: 150,
          };
          rawGroups.push(currentObj);
          const kv = rest.match(/^([a-zA-Z0-9_-]+)\s*:\s*(.*)$/);
          if (kv) {
            const k = kv[1];
            const v = kv[2].trim();
            if (k === "name") currentObj.name = unquoteYaml(v);
            else if (k === "type") currentObj.type = unquoteYaml(v);
          }
        }
        continue;
      }

      if (currentObj) {
        if (trimmed.startsWith("- ") && (currentSubKey === "proxies" || currentSubKey === "use")) {
          const itemVal = unquoteYaml(trimmed.slice(2));
          if (itemVal) currentObj[currentSubKey].push(itemVal);
          continue;
        }
        const kv = trimmed.match(/^([a-zA-Z0-9_-]+)\s*:\s*(.*)$/);
        if (kv) {
          const k = kv[1];
          const v = kv[2].trim();
          if (k === "proxies" || k === "use") {
            if (v.startsWith("[") && v.endsWith("]")) {
              currentObj[k] = parseFlowArray(v);
              currentSubKey = "";
            } else {
              currentSubKey = k;
            }
          } else {
            currentSubKey = "";
            if (k === "name") currentObj.name = unquoteYaml(v);
            else if (k === "type") currentObj.type = unquoteYaml(v) || "select";
            else if (k === "icon") currentObj.icon = unquoteYaml(v);
            else if (k === "filter") currentObj.filter = unquoteYaml(v);
            else if (k === "include-all")
              currentObj.includeAll = v === "true" || v === "True";
            else if (k === "url") currentObj.url = unquoteYaml(v);
            else if (k === "interval")
              currentObj.interval = parseInt(v, 10) || 300;
            else if (k === "tolerance")
              currentObj.tolerance = parseInt(v, 10) || 150;
          }
        }
      }
      continue;
    }

    if (currentSection === "rule-providers" || currentSection === "proxy-providers") {
      const targetMap =
        currentSection === "rule-providers" ? rawRuleProviders : rawProxyProviders;

      if (
        (currentMapIndent === -1 || indent <= currentMapIndent) &&
        /^[^-\s][^:]*:\s*(.*)$/.test(trimmed)
      ) {
        const colonIdx = trimmed.indexOf(":");
        const keyName = unquoteYaml(trimmed.slice(0, colonIdx));
        const rest = trimmed.slice(colonIdx + 1).trim();
        currentMapIndent = indent;
        currentMapKey = keyName;
        if (rest.startsWith("{") && rest.endsWith("}")) {
          targetMap[keyName] = parseFlowMap(rest);
        } else {
          targetMap[keyName] = {};
        }
        continue;
      }

      if (currentMapKey && targetMap[currentMapKey] && indent > currentMapIndent) {
        const kv = trimmed.match(/^([a-zA-Z0-9_-]+)\s*:\s*(.*)$/);
        if (kv && kv[2]) {
          targetMap[currentMapKey][kv[1]] = unquoteYaml(kv[2]);
        }
      }
      continue;
    }

    if (currentSection === "rules") {
      if (trimmed.startsWith("- ")) {
        const ruleStr = unquoteYaml(trimmed.slice(2));
        if (ruleStr) rawRules.push(ruleStr);
      }
      continue;
    }
  }

  const groupNamesSet = new Set(
    rawGroups.map((g) => String(g.name || "").trim()).filter(Boolean)
  );
  const builtinPolicies = new Set(["DIRECT", "REJECT", "REJECT-DROP", "PASS"]);

  const newGroups = rawGroups
    .filter((g) => g.name)
    .map((g) => {
      const manual = [];
      let hadConcreteNodes = false;

      for (const item of g.proxies || []) {
        const clean = String(item || "").trim();
        if (!clean) continue;
        if (groupNamesSet.has(clean) || builtinPolicies.has(clean)) {
          manual.push(clean);
        } else {
          hadConcreteNodes = true;
        }
      }

      let filter = g.filter || "";
      if (
        !filter &&
        (g.includeAll ||
          hadConcreteNodes ||
          g.type === "url-test" ||
          g.type === "fallback" ||
          g.type === "load-balance" ||
          manual.length === 0)
      ) {
        filter = inferRegionRegexFromGroupName(g.name);
      }

      return {
        name: g.name,
        type: g.type || "select",
        icon: g.icon || "",
        proxies: [],
        manual: uniq(manual),
        useSubs: Array.isArray(g.use) ? uniq(g.use) : [],
        filter,
        url: g.url || "http://www.gstatic.com/generate_204",
        interval: g.interval || 300,
        tolerance: g.tolerance || 150,
      };
    });

  // Parse proxy-providers into state.subs
  const newSubs = [];
  for (const [subName, subObj] of Object.entries(rawProxyProviders)) {
    if (subObj && subObj.url) {
      newSubs.push({
        name: subName,
        url: subObj.url,
        interval: Number(subObj.interval) || 3600,
        fetchMode: subObj.proxy && subObj.proxy !== "DIRECT" ? "PROXY" : "DIRECT",
        fetchProxy: subObj.proxy || "GLOBAL",
        skipCertVerify: false,
      });
    }
  }

  // Prepare rule-providers map
  const rpObjectsMap = new Map();
  for (const [rpName, rpObj] of Object.entries(rawRuleProviders)) {
    if (!rpObj || !rpObj.url) continue;
    const behavior = rpObj.behavior || "classical";
    const format =
      rpObj.format ||
      (rpObj.url.endsWith(".yaml") || rpObj.url.endsWith(".yml") ? "yaml" : "text");
    const isList =
      format === "text" &&
      rpObj.url.toLowerCase().endsWith(".list") &&
      !rpObj.behavior;
    rpObjectsMap.set(rpName, {
      name: rpName,
      url: rpObj.url,
      behavior,
      sourceType: isList ? "surge" : `clash-${behavior}`,
      policy: "DIRECT",
      type: rpObj.type || "http",
      format,
      path: rpObj.path || `./rules/${rpName}.${format === "yaml" ? "yaml" : "list"}`,
      interval: Number(rpObj.interval) || 86400,
    });
  }

  const newManualRules = [];
  const newRulesGeosite = new Map();
  const newRulesGeoip = new Map();
  const newRuleOrder = [];
  const usedRpInRules = new Set();
  let matchTarget = "";

  for (const ruleLine of rawRules) {
    const parts = ruleLine.split(",").map((s) => s.trim());
    if (parts.length < 2) continue;
    const rType = parts[0].toUpperCase();

    if (rType === "MATCH" || rType === "FINAL") {
      matchTarget = parts[1];
      continue;
    }

    if (parts.length < 3) continue;
    const rVal = parts[1];
    const policy = parts[2];

    if (rType === "RULE-SET") {
      usedRpInRules.add(rVal);
      const rp = rpObjectsMap.get(rVal);
      if (rp) {
        rp.policy = policy;
      } else {
        rpObjectsMap.set(rVal, {
          name: rVal,
          url: `https://example.com/${rVal}.yaml`,
          behavior: "classical",
          sourceType: "clash-classical",
          policy,
          type: "http",
          format: "yaml",
          path: `./rules/${rVal}.yaml`,
          interval: 86400,
        });
      }
      newRuleOrder.push({
        id: `RULE-SET:${rVal}`,
        kind: "RULE-SET",
        key: rVal,
        policy,
      });
      continue;
    }

    if (rType === "GEOSITE") {
      newRulesGeosite.set(rVal, {
        action:
          policy === "DIRECT" ? "DIRECT" : policy === "REJECT" ? "BLOCK" : "PROXY",
        target: policy,
      });
      newRuleOrder.push({
        id: `GEOSITE:${rVal}`,
        kind: "GEOSITE",
        key: rVal,
        policy,
      });
      continue;
    }

    if (rType === "GEOIP") {
      newRulesGeoip.set(rVal, {
        action:
          policy === "DIRECT" ? "DIRECT" : policy === "REJECT" ? "BLOCK" : "PROXY",
        target: policy,
      });
      newRuleOrder.push({
        id: `GEOIP:${rVal}`,
        kind: "GEOIP",
        key: rVal,
        policy,
      });
      continue;
    }

    const id = `${Date.now()}_${Math.random().toString(16).slice(2)}_${newManualRules.length}`;
    let action = "PROXY";
    let target = policy;
    if (policy === "DIRECT") {
      action = "DIRECT";
      target = "";
    } else if (policy === "REJECT" || policy === "REJECT-DROP") {
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
      policy,
    });
  }

  // Ensure any rule-providers that weren't referenced in rules are also kept
  const newRuleProviders = Array.from(rpObjectsMap.values());
  for (const rp of newRuleProviders) {
    if (!usedRpInRules.has(rp.name)) {
      newRuleOrder.push({
        id: `RULE-SET:${rp.name}`,
        kind: "RULE-SET",
        key: rp.name,
        policy: rp.policy || (newGroups[0]?.name ?? "DIRECT"),
      });
    }
  }

  state.groups = newGroups;
  state.ruleProviders = newRuleProviders;
  state.manualRules = newManualRules;
  state.rulesGeosite = newRulesGeosite;
  state.rulesGeoip = newRulesGeoip;
  if (newSubs.length) {
    state.subs = newSubs;
  }

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

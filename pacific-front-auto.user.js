// ==UserScript==
// @name         Pacific Front 自动排阵与游玩 (相邻增益精算与动态确权版)
// @namespace    local.pacific-front
// @version      2.8.0
// @description  纯裸属性战力Cost；相邻增益协同匹配；满血维修包归入边际节省机制；战略资产确权解耦可勾选；Boss战全歼与代币优先。
// @match        https://pacificfront.worldofwarships.asia/*
// @match        https://pacificfront.worldofwarships.eu/*
// @match        https://pacificfront.worldofwarships.com/*
// @match        https://oceanfront.wowsgame.cn/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  /* ==========================================================================
     1. 全局配置与状态
     ========================================================================== */

  const SCRIPT_VERSION = '2.8.0';

  const ALLOWED_ORIGINS = Object.freeze([
    'https://pacificfront.worldofwarships.asia',
    'https://pacificfront.worldofwarships.eu',
    'https://pacificfront.worldofwarships.com',
    'https://oceanfront.wowsgame.cn'
  ]);

  const CONFIG = {
    minSelectionWinRate: 0.80,    // 选卡保留基准线[cite: 1]
    minWinRate: 0.90,             // 自动开战底线[cite: 1]
    targetWinRate: 1.0,           // 理想优化目标 (100%全歼)[cite: 1]
    maxBattles: 40,               // 单次运行最大战斗轮数[cite: 1]
    delayMs: 1000,                // 步骤延迟[cite: 1]
    searchRestarts: 6,            // 优化多起点次数[cite: 1]
    searchPasses: 3,              // 坐标下降搜索轮数[cite: 1]
    syncPage: true,               // 是否同步下发数据至前端棋盘[cite: 1]
    fillAllSlots: true,           // 是否优先填满 4 槽位[cite: 1]
    useModifiers: true,           // 是否使用增益品[cite: 1]
    preferNoModifiers: true,      // 常规战胜率达标时优先不消耗战斗Buff[cite: 1]
    maxModifiersPerBattle: Infinity,
    maxJointPredictions: 60000,
    maxSearchMs: 4000,
    fullClearMode: false,         // 全歼模式开关
    bossLootPriority: true,       // Boss 战 100% 全歼前提下优先挂载效率提升代币道具
    bossFillOnly: true,           // 全自动游玩时，遇 Boss 战仅自动选卡并暂停，由玩家手动出战
    conserveModifiers: true,      // 消耗品节省模式（边际效用递减均衡：满血不挂维修包）
    assetProtection: true         // 【新增】战略资产确权（煤炭/维修包启用 95% 特化防线，可动态关闭）
  };

  /* ==========================================================================
     2. 双语字典与名称格式化
     ========================================================================== */

  const BILINGUAL_SHIPS = {
    "地狱俯冲者": '“地狱俯冲者”俯冲轰炸机 埃塞克斯 / SB2C Helldiver',
    "helldiver": '“地狱俯冲者”俯冲轰炸机 埃塞克斯 / SB2C Helldiver',
    "f4u": 'F4U战斗机 埃塞克斯 / F4U Corsair',
    "corsair": 'F4U战斗机 埃塞克斯 / F4U Corsair',
    "密苏里": '密苏里 / Missouri',
    "missouri": '密苏里 / Missouri',
    "北卡罗来纳": '北卡罗来纳 / North Carolina',
    "north_carolina": '北卡罗来纳 / North Carolina',
    "阿拉斯加": '阿拉斯加 / Alaska',
    "alaska": '阿拉斯加 / Alaska',
    "巴尔的摩": '巴尔的摩 / Baltimore',
    "baltimore": '巴尔的摩 / Baltimore',
    "拉菲": '拉菲 / Laffey',
    "laffey": '拉菲 / Laffey',
    "约翰斯顿": '约翰斯顿 / Johnston',
    "johnston": '约翰斯顿 / Johnston',
    "复仇者": '“复仇者”鱼雷轰炸机 企业 / TBF Avenger',
    "avenger": '“复仇者”鱼雷轰炸机 企业 / TBF Avenger',
    "地狱猫": '“地狱猫”战斗机 企业 / F6F Hellcat',
    "hellcat": '“地狱猫”战斗机 企业 / F6F Hellcat',
    "英王乔治五世": '英王乔治五世 / King George V',
    "king_george": '英王乔治五世 / King George V',
    "科罗拉多": '科罗拉多 / Colorado',
    "colorado": '科罗拉多 / Colorado',
    "克利夫兰": '克利夫兰 / Cleveland',
    "cleveland": '克利夫兰 / Cleveland',
    "圣地亚哥": '圣地亚哥 / San Diego',
    "san_diego": '圣地亚哥 / San Diego',
    "新奥尔良": '新奥尔良 / New Orleans',
    "new_orleans": '新奥尔良 / New Orleans',
    "基德": '基德 / Kidd',
    "kidd": '基德 / Kidd',
    "本森": '本森 / Benson',
    "benson": '本森 / Benson',
    "凯旋": '凯旋 / Le Triomphant',
    "triomphant": '凯旋 / Le Triomphant',
    "反击": '反击 / Repulse',
    "repulse": '反击 / Repulse',
    "新墨西哥": '新墨西哥 / New Mexico',
    "new_mexico": '新墨西哥 / New Mexico',
    "无畏式": '“无畏式”俯冲轰炸机 萨拉托加 / SBD Dauntless',
    "dauntless": '“无畏式”俯冲轰炸机 萨拉托加 / SBD Dauntless',
    "休斯": '休斯 / Hughes',
    "hughes": '休斯 / Hughes',
    "野猫": '“野猫”战斗机 萨拉托加 / F4F Wildcat',
    "wildcat": '“野猫”战斗机 萨拉托加 / F4F Wildcat',
    "霍巴特": '霍巴特 / Hobart',
    "hobart": '霍巴特 / Hobart',
    "马布尔黑德": '马布尔黑德 / Marblehead',
    "marblehead": '马布尔黑德 / Marblehead',
    "德·鲁伊特": '德·鲁伊特 / De Ruyter',
    "de_ruyter": '德·鲁伊特 / De Ruyter',
    "法拉格特": '法拉格特 / Farragut',
    "farragut": '法拉格特 / Farragut',
    "箭": '箭 / Arrow',
    "arrow": '箭 / Arrow',
    "约翰·d·福特": '约翰·D·福特 / John D. Ford',
    "ford": '约翰·D·福特 / John D. Ford',
    "吸血鬼": '吸血鬼 / Vampire',
    "vampire": '吸血鬼 / Vampire'
  };

  const BILINGUAL_MODS = {
    gunnery: '炮术训练 / Gunnery Training',
    artillery: '炮术训练 / Gunnery Training',
    attack: '炮术训练 / Gunnery Training',
    damage_control: '损管训练 / Damage Control',
    defense: '损管训练 / Damage Control',
    helmsman: '舵手训练 / Helmsman Training',
    rudder: '舵手训练 / Helmsman Training',
    teamwork: '团队协作 / Teamwork',
    cooperation: '团队协作 / Teamwork',
    token: '效率 / Progress Booster',
    effectiveness: '效率 / Progress Booster',
    efficiency: '效率 / Progress Booster',
    morale: '士气打击 / Morale Impact',
    moral: '士气打击 / Morale Impact',
    focus: '专注 / Focus',
    specialization: '专精 / Specialization',
    old_salt: '老水手 / Old Salt',
    repair: '快速维修 / Quick Repair',
    unstoppable: '势不可挡 / Unstoppable'
  };

  function formatCardName(c) {
    if (!c) return '空位 / Empty';
    const realName = String(c.title || c.name || '').trim();
    const code = String(c.code || '').toLowerCase();
    const lowName = realName.toLowerCase();
    for (const [key, val] of Object.entries(BILINGUAL_SHIPS)) {
      if (code.includes(key) || lowName.includes(key) || realName.includes(key)) return val;
    }
    return realName ? `${realName} (${c.code})` : c.code;
  }

  function formatModifierName(id) {
    if (!id) return '';
    const low = String(id).toLowerCase();
    for (const [key, val] of Object.entries(BILINGUAL_MODS)) {
      if (low.includes(key)) return val;
    }
    return id;
  }

  /* ==========================================================================
     3. 战力、相邻增益、奖励与战略槽位指标精算
     ========================================================================== */

  function parseRouteInfo(pathname) {
    const regex = /^\/(?:([a-z]{2}(?:-[a-z0-9]{2,8})*)\/)?operations(?:\/([^/]+)(?:\/([^/]+))?)?\/?$/i;
    const match = pathname.match(regex);
    if (!match) return { prefix: '', operationId: null, keypointId: null };
    try {
      return {
        prefix: match[1] ? '/' + match[1] : '',
        operationId: match[2] ? decodeURIComponent(match[2]) : null,
        keypointId: match[3] ? decodeURIComponent(match[3]) : null
      };
    } catch (e) {
      return { prefix: '', operationId: null, keypointId: null };
    }
  }

  function buildOperationPath(pathname, operationId, keypointId) {
    const route = parseRouteInfo(pathname);
    let path = route.prefix + '/operations';
    if (operationId) path += '/' + encodeURIComponent(operationId);
    if (keypointId) path += '/' + encodeURIComponent(keypointId);
    return path;
  }

  function isKeypointFinished(kp) {
    if (!kp || !kp.status) return false;
    return kp.status === 'cleared' || kp.status === 'missed';
  }

  function getKeypointSlots(kp) {
    const result = [null, null, null, null];
    if (!kp || !kp.slots) return result;
    for (let i = 0; i < 4; i++) {
      const key = String(i);
      result[i] = Object.prototype.hasOwnProperty.call(kp.slots, key) ? kp.slots[key] : null;
    }
    return result;
  }

  // 纯裸卡基础三维属性求和（不含任何外部 Buff、词缀或道具）
  function calculateCardPower(card) {
    if (!card || !card.specs) return 0;
    let sum = 0;
    const values = Object.values(card.specs);
    for (let i = 0; i < values.length; i++) {
      sum += values[i];
    }
    return sum;
  }

  // 阵容纯裸卡基础战力 Cost
  function calculateTotalPower(cards) {
    let total = 0;
    for (let i = 0; i < cards.length; i++) {
      if (cards[i]) total += calculateCardPower(cards[i]);
    }
    return total;
  }

  function isBossEnemy(enemy) {
    if (!enemy) return false;
    if (enemy.isBoss === true) return true;
    if (Array.isArray(enemy.tags)) {
      for (let i = 0; i < enemy.tags.length; i++) {
        if (/common_boss|epic_boss|boss|flagship|leader/i.test(enemy.tags[i])) return true;
      }
    }
    return typeof enemy.code === 'string' && /_boss/i.test(enemy.code);
  }

  function isBossKeypoint(kp) {
    if (!kp) return false;
    if (kp.isBoss === true || kp.type === 'boss') return true;
    if (Array.isArray(kp.tags) && kp.tags.some(function (t) { return /boss/i.test(t); })) return true;
    if (typeof kp.name === 'string' && /boss|首领|旗舰|头目/i.test(kp.name)) return true;

    const rawSlots = getKeypointSlots(kp);
    for (let i = 0; i < 4; i++) {
      if (rawSlots[i] && isBossEnemy(rawSlots[i].enemy)) return true;
    }
    return false;
  }

  function parseSlotReward(slot) {
    if (!slot) return { type: 'unknown', amount: 0, label: '无目标', isRepairDrop: false, isTokenDrop: false };
    const rewardData = slot.reward || slot.rewards || slot.drop || slot.drops ||
      (() => { const c = Object.assign({}, slot); delete c.enemy; delete c.ally; return c; })();

    const jsonStr = JSON.stringify(rewardData).toLowerCase();
    const amtMatch = jsonStr.match(/(?:amount|count|value|total|quantity)["':\s]+(\d+)/);
    const amt = Number(amtMatch ? amtMatch[1] : 0);

    if (jsonStr.includes('repair') || jsonStr.includes('维修') || jsonStr.includes('wrench')) {
      return { type: 'repair', amount: amt || 2, label: '🔧快速维修包', isRepairDrop: true, isTokenDrop: false };
    }
    if (jsonStr.includes('coal') || jsonStr.includes('煤炭')) {
      return { type: 'coal', amount: amt, label: `💎${amt || ''}煤炭`, isRepairDrop: false, isTokenDrop: false };
    }
    if (jsonStr.includes('xp') || jsonStr.includes('exp') || jsonStr.includes('commander') || jsonStr.includes('crew') || jsonStr.includes('经验')) {
      return { type: 'exp', amount: amt, label: `⭐${amt || ''}经验`, isRepairDrop: false, isTokenDrop: false };
    }
    if (jsonStr.includes('credits') || jsonStr.includes('silver') || jsonStr.includes('银币')) {
      return { type: 'silver', amount: amt, label: `🪙${amt || ''}银币`, isRepairDrop: false, isTokenDrop: false };
    }
    if (amt >= 100 || jsonStr.includes('token') || jsonStr.includes('eventum_1') || jsonStr.includes('代币')) {
      return { type: 'token', amount: amt, label: `👑${amt || ''}进度代币`, isRepairDrop: false, isTokenDrop: true };
    }
    return { type: 'supply', amount: amt || 1, label: `⚓${amt || ''}补给`, isRepairDrop: false, isTokenDrop: false };
  }

  // 动态槽位胜率基准（支持战略资产确权解耦）[cite: 2]
  function getSlotTargetRate(slot, isAssetProtectEnabled) {
    const enemy = slot?.enemy;
    if (!enemy) return 0;
    const rewardInfo = parseSlotReward(slot);
    const p = calculateCardPower(enemy);

    if (rewardInfo.type === 'token') return 1.0;
    // 战略资产确权开启时，煤炭与修船包锁定 95% 绝不翻车；未开启时按常规怪处理[cite: 2]
    if (isAssetProtectEnabled && (rewardInfo.isRepairDrop || rewardInfo.type === 'coal')) {
      return 0.95;
    }
    if (isBossEnemy(enemy) || p >= 220) return 1.0;
    if (p >= 150) return 0.90;
    return 0.85;
  }

  // 检测槽位是否接入相邻卡牌的指向增益[cite: 2]
  function slotReceivesIncomingBuff(cards, slotIdx) {
    if (slotIdx > 0 && cards[slotIdx - 1]) {
      const left = cards[slotIdx - 1];
      const hasRightBuff = (left.buffs || []).some(b => {
        const d = String(b.direction).toLowerCase();
        return d === 'right' || d === '1' || d === 'east' || d === 'r';
      });
      if (hasRightBuff) return true;
    }
    if (slotIdx < 3 && cards[slotIdx + 1]) {
      const right = cards[slotIdx + 1];
      const hasLeftBuff = (right.buffs || []).some(b => {
        const d = String(b.direction).toLowerCase();
        return d === 'left' || d === '3' || d === 'west' || d === 'l';
      });
      if (hasLeftBuff) return true;
    }
    return false;
  }

  // 统计整套阵容成功激活的“相邻指向增益（Buff Synergies）”数量
  function calculateBuffSynergies(cards) {
    let count = 0;
    for (let i = 0; i < 4; i++) {
      const card = cards[i];
      if (!card || !Array.isArray(card.buffs)) continue;

      for (let b = 0; b < card.buffs.length; b++) {
        const buff = card.buffs[b];
        const d = String(buff.direction).toLowerCase();

        // 向右指向增益命中右侧友方[cite: 2]
        if ((d === 'right' || d === '1' || d === 'east' || d === 'r') && i < 3 && cards[i + 1]) {
          count++;
        }
        // 向左指向增益命中左侧友方[cite: 2]
        if ((d === 'left' || d === '3' || d === 'west' || d === 'l') && i > 0 && cards[i - 1]) {
          count++;
        }
      }
    }
    return count;
  }

  function getModInfo(mId, collectionModifiers) {
    const mod = (collectionModifiers || []).find(m => m.id === mId);
    const text = `${mod?.id || ''} ${mod?.name || ''} ${mod?.description || ''} ${(mod?.tags || []).join(' ')}`.toLowerCase();
    const isWhite = Boolean(mod?.price);

    const isToken = text.includes('token') || text.includes('progress') || text.includes('代币') ||
                    text.includes('进度') || text.includes('effectiveness') || text.includes('efficiency') || text.includes('效率');
    const isTeamwork = text.includes('teamwork') || text.includes('cooperation') || text.includes('团队协作');
    const isMorale = text.includes('moral') || text.includes('士气');
    const isRepair = text.includes('repair') || text.includes('维修') || text.includes('恢复') || text.includes('wrench');
    const isGreenSpecial = !isWhite && (isRepair || text.includes('unstoppable') || text.includes('focus') || text.includes('specializ') || text.includes('old_salt'));
    const isBaseWhiteCombat = isWhite && !isToken && !isMorale && !isRepair && !isTeamwork;

    return { mod, isWhite, isToken, isMorale, isTeamwork, isRepair, isGreenSpecial, isBaseWhiteCombat };
  }

  function calculateMarginalCost(planOrMetrics) {
    const p = planOrMetrics.totalPower || 0; // 纯裸卡属性 Cost
    const combatMods = (planOrMetrics.modifiers ? planOrMetrics.modifiers.flat().length : 0) - (planOrMetrics.lootBonusCount || 0);
    const m = Math.max(0, combatMods);
    const itemPenalty = 100 * m + 60 * m * m; // 递增边际成本
    return p + itemPenalty;
  }

  function isStageTargetMet(stage) {
    if (!stage) return false;
    if (stage.condition && stage.condition.type === 'defeat_vehicles') {
      return stage.condition.total >= stage.condition.target;
    }
    return stage.isFinished === true;
  }

  function hasRemainingKeypoints(stage) {
    if (!stage || !Array.isArray(stage.keypoints)) return false;
    for (let i = 0; i < stage.keypoints.length; i++) {
      if (!isKeypointFinished(stage.keypoints[i])) return true;
    }
    return false;
  }

  function findActiveStage(operation) {
    if (!operation || !Array.isArray(operation.stages) || operation.stages.length === 0) return null;
    for (let i = 0; i < operation.stages.length; i++) {
      if (operation.stages[i].isActive) return operation.stages[i];
    }
    return !operation.isStarted ? operation.stages[0] : null;
  }

  function collectUsedCardCodes(stage) {
    const used = new Set();
    if (!stage || !Array.isArray(stage.keypoints)) return used;
    for (let i = 0; i < stage.keypoints.length; i++) {
      const kp = stage.keypoints[i];
      if (kp.status === 'cleared') {
        const slotList = getKeypointSlots(kp);
        for (let j = 0; j < slotList.length; j++) {
          if (slotList[j]?.ally?.code) used.add(slotList[j].ally.code);
        }
      }
    }
    return used;
  }

  function extractModifierInventory(inventory) {
    const counts = new Map();
    if (!inventory || !Array.isArray(inventory.modifiers)) return counts;
    for (let i = 0; i < inventory.modifiers.length; i++) {
      const item = inventory.modifiers[i];
      counts.set(item.id, item.amount !== undefined ? item.amount : 0);
    }
    return counts;
  }

  function calculateWeaknessHits(kp, cards) {
    const rawSlots = getKeypointSlots(kp);
    let hits = 0;
    for (let i = 0; i < 4; i++) {
      const card = cards[i];
      if (!card || !Array.isArray(card.debuffs)) continue;

      for (let d = 0; d < card.debuffs.length; d++) {
        const debuff = card.debuffs[d];
        if (debuff.vuln === undefined || debuff.vuln === null) continue;
        const vulnStr = String(debuff.vuln);
        const targetIndices = (debuff.direction === 0)
          ? [i]
          : [i - 1, i, i + 1].filter(idx => idx >= 0 && idx < 4);

        for (let t = 0; t < targetIndices.length; t++) {
          const enemy = rawSlots[targetIndices[t]]?.enemy;
          if (enemy?.vulns && (Object.prototype.hasOwnProperty.call(enemy.vulns, vulnStr) || enemy.vulns[vulnStr] !== undefined)) {
            hits++;
          }
        }
      }
    }
    return hits;
  }

  function unwrapApiResponse(data, path) {
    const isObj = data !== null && typeof data === 'object' && !Array.isArray(data);
    if (!isObj || !Object.prototype.hasOwnProperty.call(data, 'result') || !data.result) {
      throw new Error(`接口格式异常 (${path})：缺少 result 字段。`);
    }
    if (typeof data.status === 'string' && data.status !== 'ok') {
      throw new Error(`业务未就绪 (${path})。`);
    }
    return data.result;
  }

  /* ==========================================================================
     4. 战局分析与候选卡池规则过滤
     ========================================================================== */

  function resolveKeypointEffects(op, kp, threshold) {
    const stages = op.stages || [];
    let currentStageIndex = -1;
    for (let i = 0; i < stages.length; i++) {
      if (Array.isArray(stages[i].keypoints)) {
        for (let j = 0; j < stages[i].keypoints.length; j++) {
          if (stages[i].keypoints[j].id === kp.id) { currentStageIndex = i; break; }
        }
      }
      if (currentStageIndex >= 0) break;
    }

    const effects = op.effects || [];
    const activePayloads = [];

    for (let i = 0; i < effects.length; i++) {
      const e = effects[i];
      if (!e.payload || e.payload.delta_disabled) continue;

      let sourceStageIndex = -1;
      if (e.source) {
        for (let s = 0; s < stages.length; s++) {
          if (Array.isArray(stages[s].keypoints)) {
            for (let k = 0; k < stages[s].keypoints.length; k++) {
              if (stages[s].keypoints[k].id === e.source) { sourceStageIndex = s; break; }
            }
          }
          if (sourceStageIndex >= 0) break;
        }
      }

      const isDirect = Array.isArray(e.applyTo) && e.applyTo.includes(kp.id);
      const isSubsequent = e.isSubsequent && e.source !== kp.id && sourceStageIndex >= 0 && sourceStageIndex < currentStageIndex;
      if (!isDirect && !isSubsequent) continue;

      const isMitigable = e.isMitigable && e.payload.type !== 5 && e.payload.type !== 6;
      if (!isMitigable && e.source) {
        let sourceKp = null;
        for (let s = 0; s < stages.length; s++) {
          if (Array.isArray(stages[s].keypoints)) {
            for (let k = 0; k < stages[s].keypoints.length; k++) {
              if (stages[s].keypoints[k].id === e.source) { sourceKp = stages[s].keypoints[k]; break; }
            }
          }
          if (sourceKp) break;
        }

        if (sourceKp && sourceKp.status === 'cleared') {
          const slotValues = Object.values(sourceKp.slots || {});
          let wins = 0;
          for (let w = 0; w < slotValues.length; w++) {
            if (slotValues[w].outcome === 'win') {
              const hasMoral = slotValues[w].ally?.modifiers?.includes('moral-impact');
              wins += hasMoral ? 2 : 1;
            }
          }
          if (slotValues.length > 0 && Math.min(wins / slotValues.length, 1.0) >= threshold) continue;
        }
      }
      activePayloads.push(e.payload);
    }
    return activePayloads;
  }

  function resolveAvailableCards(catalog, inventory, stage, effects) {
    if (!Array.isArray(inventory.cards)) throw new Error('库存卡牌数据异常。');
    const usedCardCodes = collectUsedCardCodes(stage);
    const restrictions = effects.filter(e => e.type === 6 && e.restrictions).map(e => e.restrictions);
    const catalogMap = new Map(catalog.map(c => [c.code, c]));

    const eligible = [];
    for (let i = 0; i < inventory.cards.length; i++) {
      const item = inventory.cards[i];
      if (item.health <= 0 || usedCardCodes.has(item.code)) continue;
      const baseCard = catalogMap.get(item.code);
      if (!baseCard) throw new Error('未知卡牌编码：' + item.code);

      const restricted = restrictions.some(re =>
        (Array.isArray(re.cards) && re.cards.includes(baseCard.code)) ||
        (Array.isArray(re.types) && re.types.includes(baseCard.type)) ||
        (Array.isArray(re.tier) && re.tier.includes(baseCard.tier))
      );

      if (!restricted) {
        eligible.push(Object.assign({}, baseCard, { health: item.health }));
      }
    }
    return eligible;
  }

  /* ==========================================================================
     5. 预测引擎适配与方案裁决器
     ========================================================================== */

  function buildEngineRestriction(engine, rule) {
    if (!rule) return engine.newEmptyRestriction();
    return engine.newRestriction(rule.cards || [], rule.types || [], rule.tier || [], rule.modifiers || [], false);
  }

  function transformEffectToEngine(engine, p) {
    const restriction = buildEngineRestriction(engine, p.apply_restrictions);
    switch (p.type) {
      case 1: return engine.newMultiplyPlayerSpecsEffect(p.specs || {}, p.delta_specs || {}, restriction);
      case 2: return engine.newMultiplyPlayerBuffsEffect(p.multiplier, p.delta_multiplier || 0, restriction);
      case 3: return engine.newMultiplyPlayerDebuffsEffect(p.multiplier, p.delta_multiplier || 0, restriction);
      case 4: return engine.newMultiplyEnemyPowerEffect(p.specs || {}, p.delta_specs || {}, restriction);
      case 5: return engine.newDisableAllModifiersEffect(false);
      case 6: return engine.newExtraRestrictionsEffect(buildEngineRestriction(engine, p.restrictions), false);
      default: throw new Error('未支持的效果类型：' + p.type);
    }
  }

  function makeBattlePredictor(engine, settings, kp, effects) {
    const rawSlots = getKeypointSlots(kp);
    const enemies = rawSlots.map(s => s?.enemy ? engine.newCard(s.enemy.code, s.enemy.type, s.enemy.tier, s.enemy.specs || {}, s.enemy.vulns || {}, [], engine.newFullHealth()) : null);
    const compiledEffects = effects.map(e => transformEffectToEngine(engine, e));
    const cardEngineCache = new WeakMap();

    return function (cards, modifiers) {
      const activeModifiers = modifiers || [[], [], [], []];
      const board = engine.newBoard(4);

      for (let i = 0; i < 4; i++) {
        if (enemies[i]) board.Enemy.Slots[i] = engine.newSlot(enemies[i]);
        const c = cards[i];
        if (c) {
          let preparedCard = cardEngineCache.get(c);
          if (!preparedCard) {
            const buffs = [];
            for (const b of c.buffs || []) {
              const effect = engine.newEffect(0, true);
              effect.Relative = { [b.spec]: b.value };
              buffs.push(engine.newBuff(b.direction, effect));
            }
            for (const d of c.debuffs || []) {
              const effect = engine.newEffect(d.vuln, false);
              effect.Relative = { 0: d.value };
              buffs.push(engine.newBuff(d.direction, effect));
            }
            preparedCard = engine.newCard(c.code, c.type, c.tier, c.specs || {}, {}, buffs, engine.newHealth(c.health, 3));
            cardEngineCache.set(c, preparedCard);
          }
          board.Player.Slots[i] = engine.newSlot(preparedCard, ...(activeModifiers[i] || []));
        }
      }

      if (compiledEffects.length > 0) board.Effects = compiledEffects;
      const [isOk, err, result] = engine.predict(board, settings);
      if (!isOk || err || !result) throw new Error('预测引擎内部错误：' + String(err ? err : '无结果'));

      return Array.from(result.Predictions).map(p => p / 100.0);
    };
  }

  function evaluatePlanMetrics(kp, cards, rates, config) {
    const rawSlots = getKeypointSlots(kp);
    let deficit = 0, covered = 0, totalEnemies = 0;

    for (let i = 0; i < 4; i++) {
      if (rawSlots[i]?.enemy) {
        totalEnemies++;
        // 动态读取战略确权开关[cite: 2]
        const targetRate = Math.max(config.minWinRate, getSlotTargetRate(rawSlots[i], config.assetProtection));
        const rate = cards[i] ? rates[i] : 0.0;
        if (rate >= targetRate - 1e-4) {
          covered++;
        } else {
          deficit += (targetRate - rate);
        }
      }
    }

    const weakest = Math.min(1.0, ...rawSlots.map((s, i) => s?.enemy ? (cards[i] ? rates[i] : 0.0) : 1.0));
    const safe = totalEnemies > 0 && deficit <= 1e-4;

    return {
      safe, selectionSafe: safe,
      battleCovered: covered,
      battleDeficit: deficit,
      targetDeficit: deficit,
      weakestRate: weakest
    };
  }

  function compareEvaluationPlans(a, b, config, isBoss) {
    const safeSelectionDiff = (b.selectionSafe ? 1 : 0) - (a.selectionSafe ? 1 : 0);
    if (safeSelectionDiff !== 0) return safeSelectionDiff;

    if (config.fillAllSlots) {
      const countDiff = b.cards.filter(Boolean).length - a.cards.filter(Boolean).length;
      if (countDiff !== 0) return countDiff;
    }

    const safeDiff = (b.safe ? 1 : 0) - (a.safe ? 1 : 0);
    if (safeDiff !== 0) return safeDiff;

    if (isBoss) {
      const targetDeficitDiff = (a.targetDeficit || 0) - (b.targetDeficit || 0);
      if (Math.abs(targetDeficitDiff) > 1e-6) return targetDeficitDiff > 0 ? 1 : -1;

      const weakestDiff = (b.weakestRate || 0) - (a.weakestRate || 0);
      if (Math.abs(weakestDiff) > 1e-4) return weakestDiff > 0 ? 1 : -1;

      // 满胜率下大卡面板压制
      const powerA = a.totalPower !== undefined ? a.totalPower : calculateTotalPower(a.cards);
      const powerB = b.totalPower !== undefined ? b.totalPower : calculateTotalPower(b.cards);
      const powerDiff = powerB - powerA;
      if (Math.abs(powerDiff) > 1e-3) return powerDiff > 0 ? 1 : -1;

      if (config.bossLootPriority) {
        const lootA = a.lootBonusCount || 0;
        const lootB = b.lootBonusCount || 0;
        if (lootB !== lootA) return lootB - lootA;
      }

      const combatModsA = (a.modifiers ? a.modifiers.flat().length : 0) - (a.lootBonusCount || 0);
      const combatModsB = (b.modifiers ? b.modifiers.flat().length : 0) - (b.lootBonusCount || 0);
      if (combatModsA !== combatModsB) return combatModsA - combatModsB;
    } else {
      if (a.safe && b.safe) {
        const weakestDiff = Math.abs((a.weakestRate || 0) - (b.weakestRate || 0));
        if ((a.targetDeficit === 0 && b.targetDeficit === 0) || weakestDiff < 0.05) {
          const lootA = a.lootBonusCount || 0;
          const lootB = b.lootBonusCount || 0;
          if (lootA !== lootB) return lootA - lootB;

          // 边际效用均衡：严格基于纯裸属性 Cost 与边际惩罚
          if (config.conserveModifiers) {
            const costDiff = calculateMarginalCost(a) - calculateMarginalCost(b);
            if (Math.abs(costDiff) > 1e-3) return costDiff > 0 ? 1 : -1;
          } else {
            const powerDiff = (a.totalPower || 0) - (b.totalPower || 0);
            if (Math.abs(powerDiff) > 1e-3) return powerDiff > 0 ? 1 : -1;
          }

          // 平局优选 1：弱点机制命中数越多越优
          const hitsDiff = (b.weaknessHits || 0) - (a.weaknessHits || 0);
          if (hitsDiff !== 0) return hitsDiff;

          // 平局优选 2：相邻指向增益协同数越多越优（充分发挥站位协同）
          const buffDiff = (b.buffSynergies || 0) - (a.buffSynergies || 0);
          if (buffDiff !== 0) return buffDiff;

          // 平局优选 3：道具总用量少优先
          if (config.preferNoModifiers) {
            const modsA = a.modifiers ? a.modifiers.flat().length : 0;
            const modsB = b.modifiers ? b.modifiers.flat().length : 0;
            if (modsA !== modsB) return modsA - modsB;
          }
        }
        const defDiff = (a.targetDeficit || 0) - (b.targetDeficit || 0);
        if (Math.abs(defDiff) > 1e-6) return defDiff > 0 ? 1 : -1;
      }
    }

    if (b.battleCovered !== a.battleCovered) return b.battleCovered - a.battleCovered;
    if (a.battleDeficit !== b.battleDeficit) return a.battleDeficit - b.battleDeficit;
    return b.score - a.score;
  }

  /* ==========================================================================
     6. 核心搜索与无损去冗装配
     ========================================================================== */

  function enforceFinalModCleanliness(kp, plan, engine, settings) {
    const rawSlots = getKeypointSlots(kp);
    const effects = resolveKeypointEffects(root.PacificFrontBot.currentOp, kp, 1.0);
    const core = { ...engine.newSettings(), ...settings.options.defaultCoreSettings };
    const predictor = makeBattlePredictor(engine, core, kp, effects);

    for (let i = 0; i < 4; i++) {
      if (!plan.cards[i]) continue;
      const slotObj = rawSlots[i];
      const reward = parseSlotReward(slotObj);
      let mods = plan.modifiers[i] || [];

      // 物理清洗非代币槽的效率书[cite: 2]
      if (reward.type !== 'token') {
        mods = mods.filter(mId => !getModInfo(mId, settings.collection.modifiers).isToken);
      }
      // 仅在勾选了“消耗品节省模式”时，对满血 3 HP 舰船清洗维修包（未勾选时允许作为免伤卡使用）[cite: 2]
      if (CONFIG.conserveModifiers && plan.cards[i].health >= 3) {
        mods = mods.filter(mId => !getModInfo(mId, settings.collection.modifiers).isRepair);
      }
      // 试探多余的绿色特殊道具，若不挂也能达标则无损去冗[cite: 2]
      const greenMod = mods.find(mId => getModInfo(mId, settings.collection.modifiers).isGreenSpecial);
      if (greenMod) {
        const testMods = plan.modifiers.map(m => m.slice());
        testMods[i] = mods.filter(mId => mId !== greenMod);
        try {
          const testRates = predictor(plan.cards, testMods);
          const targetRate = Math.max(CONFIG.minWinRate, getSlotTargetRate(slotObj, CONFIG.assetProtection));
          if (testRates[i] >= targetRate - 1e-4) {
            mods = testMods[i];
          }
        } catch (e) {}
      }
      plan.modifiers[i] = mods;
    }
  }

  async function executeJointOptimization(engine, settings, kp, candidates, effects, inventory, config, checkpoint, yieldUI, seedPlans, rateCache, stageContext) {
    const startTime = performance.now();
    const deadline = startTime + (config.maxSearchMs || 4000);
    checkpoint();

    const isBoss = isBossKeypoint(kp);
    const core = Object.assign({}, engine.newSettings(), settings.options.defaultCoreSettings);
    const modifierAttributes = engine.getModifiers ? engine.getModifiers() : {};
    const stock = extractModifierInventory(inventory);

    const modifiersDisabled = !config.useModifiers || effects.some(e => e.type === 5);
    const restrictedMods = new Set(effects.filter(e => e.type === 6 && e.restrictions).flatMap(e => e.restrictions.modifiers || []));

    const rawKpSlots = getKeypointSlots(kp);
    const activeEnemySlotCount = rawKpSlots.filter(s => s && s.enemy).length;
    let totalEffectivenessStock = 0;

    for (const [id, count] of stock.entries()) {
      if (count > 0 && getModInfo(id, settings.collection.modifiers).isToken) totalEffectivenessStock += count;
    }
    const maxPossibleLootItems = Math.min(totalEffectivenessStock, activeEnemySlotCount);

    function buildAllocationsForSlot(slotCards, slotIdx, groupType) {
      if (modifiersDisabled) return [null];
      const list = [null];
      const items = [];
      const receivesBuff = slotReceivesIncomingBuff(slotCards, slotIdx);

      for (const [id, count] of stock.entries()) {
        if (count <= 0 || restrictedMods.has(id)) continue;
        const attr = modifierAttributes[id];
        if (attr && attr.Type === groupType) {
          const info = getModInfo(id, settings.collection.modifiers);

          // 团队协作方向校验：未接入相邻增益时不加入候选[cite: 2]
          if (info.isTeamwork && !receivesBuff) continue;

          // 满血不挂维修包：仅在“消耗品节省模式”开启时限制，未开启时允许浅卡池作为免伤使用[cite: 2]
          if (config.conserveModifiers && info.isRepair && slotCards[slotIdx] && slotCards[slotIdx].health >= 3) {
            continue;
          }

          if (isBoss) {
            if (info.isMorale) continue;
          } else {
            if (info.isToken) continue;
            if (info.isMorale && (!stageContext || stageContext.conditionType !== 'defeat_vehicles' || stageContext.targetMet)) continue;
          }
          items.push(id);
        }
      }

      if (isBoss && config.bossLootPriority) {
        items.sort((a, b) => (getModInfo(b, settings.collection.modifiers).isToken ? 1 : 0) - (getModInfo(a, settings.collection.modifiers).isToken ? 1 : 0));
      }
      return list.concat(items);
    }

    const enemyVulnSet = new Set();
    for (let i = 0; i < 4; i++) {
      const enemy = rawKpSlots[i]?.enemy;
      if (enemy?.vulns) Object.keys(enemy.vulns).forEach(k => enemyVulnSet.add(k));
    }

    const pool = candidates.slice().sort((a, b) => {
      if (isBoss) {
        const powerDiff = calculateCardPower(b) - calculateCardPower(a);
        return powerDiff !== 0 ? powerDiff : a.code.localeCompare(b.code);
      }
      const aHits = a.debuffs?.some(d => enemyVulnSet.has(String(d.vuln))) ? 1 : 0;
      const bHits = b.debuffs?.some(d => enemyVulnSet.has(String(d.vuln))) ? 1 : 0;
      if (bHits !== aHits) return bHits - aHits;

      const powerDiff = calculateCardPower(a) - calculateCardPower(b);
      return powerDiff !== 0 ? powerDiff : a.code.localeCompare(b.code);
    });

    const candidateMap = new Map(pool.map(c => [c.code, c]));
    const stateCache = new Map();
    let bestPlan = null;
    let predictionCount = 0;
    let isSearchBudgetExhausted = false;

    const limit = config.maxJointPredictions || 60000;
    const predictor = makeBattlePredictor(engine, core, kp, effects);

    function evaluateCombination(cards, modifiers) {
      const activeCodes = cards.filter(Boolean).map(c => c.code);
      if (activeCodes.length === 0 || new Set(activeCodes).size !== activeCodes.length) return null;

      const normalizedModifiers = [[], [], [], []];
      let totalAssignedItems = 0;
      const consumedStock = new Map();
      let lootCount = 0;

      for (let i = 0; i < 4; i++) {
        if (cards[i] && modifiers[i]) {
          normalizedModifiers[i] = modifiers[i].slice().sort();
          totalAssignedItems += normalizedModifiers[i].length;
          const assignedTypes = new Set();

          for (const id of normalizedModifiers[i]) {
            const attr = modifierAttributes[id];
            if (!attr || ![1, 2].includes(attr.Type) || restrictedMods.has(id) || assignedTypes.has(attr.Type)) return null;
            assignedTypes.add(attr.Type);

            if (getModInfo(id, settings.collection.modifiers).isToken) lootCount++;
            const usage = (consumedStock.get(id) || 0) + 1;
            consumedStock.set(id, usage);
            if (usage > (stock.get(id) || 0)) return null;
          }
        }
      }

      const serializedKey = JSON.stringify([cards.map(c => c?.code || null), normalizedModifiers]);
      if (stateCache.has(serializedKey)) return stateCache.get(serializedKey);

      if (bestPlan && performance.now() >= deadline) { isSearchBudgetExhausted = true; return null; }
      if (predictionCount >= limit) { isSearchBudgetExhausted = true; return null; }

      predictionCount++;
      let rates = rateCache.get(serializedKey);
      if (!rates) {
        rates = predictor(cards, normalizedModifiers);
        if (rateCache.size >= 30000) rateCache.delete(rateCache.keys().next().value);
        rateCache.set(serializedKey, rates);
      }

      let expectedWins = 0;
      let bossWins = 0;
      let cardPowerSum = 0;
      let activeSlots = 0;

      for (let i = 0; i < 4; i++) {
        if (cards[i] && rawKpSlots[i]?.enemy) {
          expectedWins += rates[i];
          if (isBossEnemy(rawKpSlots[i].enemy)) bossWins += rates[i];
        }
        if (cards[i]) {
          activeSlots++;
          cardPowerSum += calculateCardPower(cards[i]);
        }
      }

      const score = (config.fillAllSlots ? activeSlots * 100000 : 0) + expectedWins * 1000 + bossWins * 3000 - activeSlots * 2 - cardPowerSum * 0.001;
      const totalPower = calculateTotalPower(cards); // 纯裸卡战力 Cost
      const weaknessHits = calculateWeaknessHits(kp, cards);
      const buffSynergies = calculateBuffSynergies(cards); // 统计相邻增益联动数
      const metrics = evaluatePlanMetrics(kp, cards, rates, config);

      const plan = Object.assign({
        cards: cards.slice(),
        modifiers: normalizedModifiers,
        rates, expected: expectedWins, score, totalPower, weaknessHits, buffSynergies,
        lootBonusCount: lootCount
      }, metrics);

      if (stateCache.size >= 30000) stateCache.delete(stateCache.keys().next().value);
      stateCache.set(serializedKey, plan);

      if (!bestPlan || compareEvaluationPlans(plan, bestPlan, config, isBoss) < 0) {
        bestPlan = plan;
      }
      return plan;
    }

    function isPerfectPlan(plan) {
      if (!plan) return false;
      const count = plan.cards.filter(Boolean).length;
      const perfectOccupied = count === Math.min(4, pool.length);
      const perfectSafe = plan.safe && plan.targetDeficit === 0;

      if (isBoss && config.bossLootPriority && maxPossibleLootItems > 0) {
        return perfectOccupied && perfectSafe && (plan.lootBonusCount >= maxPossibleLootItems);
      }
      return perfectOccupied && perfectSafe;
    }

    const seedLineups = seedPlans.map(p => ({
      cards: p.cards.map(c => c ? candidateMap.get(c.code) || null : null),
      modifiers: p.modifiers || [[], [], [], []]
    }));

    for (let r = 0; r < config.searchRestarts; r++) {
      const roundCards = Array.from({ length: 4 }, (_, i) => i < pool.length ? pool[(i + r * 3) % pool.length] : null);
      seedLineups.push({ cards: roundCards, modifiers: [[], [], [], []] });
    }

    for (const seed of seedLineups) {
      if (isPerfectPlan(bestPlan)) break;
      let current = evaluateCombination(seed.cards, seed.modifiers);
      if (!current) continue;

      for (let pass = 0; pass < config.searchPasses && !isSearchBudgetExhausted; pass++) {
        const passStart = current;
        for (let pos = 0; pos < 4 && !isSearchBudgetExhausted; pos++) {
          checkpoint();
          let nextBest = current;

          for (const card of pool) {
            if (current.cards.some((c, i) => i !== pos && c?.code === card.code)) continue;
            const trialCards = current.cards.slice();
            trialCards[pos] = card;

            const g1List = buildAllocationsForSlot(trialCards, pos, 1);
            const g2List = buildAllocationsForSlot(trialCards, pos, 2);

            for (const g1 of g1List) {
              for (const g2 of g2List) {
                const trialMods = current.modifiers.map(m => m.slice());
                trialMods[pos] = [g1, g2].filter(Boolean);

                const candidate = evaluateCombination(trialCards, trialMods);
                if (candidate && compareEvaluationPlans(candidate, nextBest, config, isBoss) < 0) {
                  nextBest = candidate;
                }
                if (isSearchBudgetExhausted || isPerfectPlan(bestPlan)) break;
              }
              if (isSearchBudgetExhausted || isPerfectPlan(bestPlan)) break;
            }
            if (isSearchBudgetExhausted || isPerfectPlan(bestPlan)) break;
          }

          current = nextBest;
          await yieldUI();
          checkpoint();
          if (isPerfectPlan(bestPlan)) break;
        }

        for (let a = 0; a < 4 && !isSearchBudgetExhausted; a++) {
          for (let b = a + 1; b < 4 && !isSearchBudgetExhausted; b++) {
            const swapped = current.cards.slice();
            [swapped[a], swapped[b]] = [swapped[b], swapped[a]];
            const candidate = evaluateCombination(swapped, current.modifiers);
            if (candidate && compareEvaluationPlans(candidate, current, config, isBoss) < 0) current = candidate;
          }
        }
        if (current === passStart) break;
      }
      if (isSearchBudgetExhausted) break;
    }

    // Boss 战代币强力装配管线
    if (isBoss && config.bossLootPriority && bestPlan?.safe && bestPlan.targetDeficit === 0 && totalEffectivenessStock > 0) {
      const effItemCandidates = [...stock.entries()]
        .filter(([id, count]) => count > 0 && getModInfo(id, settings.collection.modifiers).isToken && !restrictedMods.has(id))
        .map(([id, count]) => ({ id, count, type: modifierAttributes[id]?.Type || 1 }));

      if (effItemCandidates.length > 0) {
        const rankedTargetSlots = rankBossSlotsForEffectiveness(kp);
        const trialMods = bestPlan.modifiers.map(m => m.slice());

        for (const item of effItemCandidates) {
          let remainingStock = item.count;
          for (const targetSlot of rankedTargetSlots) {
            if (remainingStock <= 0) break;
            const slotIdx = targetSlot.index;
            if (!bestPlan.cards[slotIdx] || trialMods[slotIdx].includes(item.id)) continue;

            const modifiedSlot = trialMods[slotIdx].filter(m => modifierAttributes[m]?.Type !== item.type);
            modifiedSlot.push(item.id);
            modifiedSlot.sort();

            const backup = trialMods[slotIdx];
            trialMods[slotIdx] = modifiedSlot;

            try {
              const testRates = predictor(bestPlan.cards, trialMods);
              const testMetrics = evaluatePlanMetrics(kp, bestPlan.cards, testRates, config);
              if (testMetrics.safe && testMetrics.targetDeficit === 0) {
                remainingStock--;
              } else {
                trialMods[slotIdx] = backup;
              }
            } catch (err) {
              trialMods[slotIdx] = backup;
            }
          }
        }

        const finalRates = predictor(bestPlan.cards, trialMods);
        bestPlan.modifiers = trialMods;
        bestPlan.rates = finalRates;
        bestPlan.lootBonusCount = trialMods.flat().filter(id => getModInfo(id, settings.collection.modifiers).isToken).length;
        bestPlan.expected = finalRates.reduce((a, b) => a + b, 0);
        Object.assign(bestPlan, evaluatePlanMetrics(kp, bestPlan.cards, finalRates, config));
      }
    }

    return bestPlan;
  }

  /* ==========================================================================
     7. React Fiber 桥接与棋盘状态同步
     ========================================================================== */

  function resolvePageBridge(doc) {
    const appElem = doc.getElementById('app');
    if (!appElem) return {};
    const reactKey = Object.keys(appElem).find(k => k.startsWith('__reactContainer$') || k.startsWith('__reactFiber$'));
    if (!reactKey) return {};

    const rootSeed = appElem[reactKey];
    const queue = [rootSeed?.stateNode?.current || rootSeed?.current || rootSeed];
    const visited = new Set(), bridge = {};

    while (queue.length > 0 && visited.size < 20000) {
      const fiber = queue.pop();
      if (!fiber || visited.has(fiber)) continue;
      visited.add(fiber);

      const props = fiber.memoizedProps;
      if (props) {
        for (const s of [props.store, props.value?.store]) {
          if (typeof s?.dispatch === 'function' && typeof s?.getState === 'function') bridge.store = s;
        }
        if (typeof props.router?.navigate === 'function') bridge.router = props.router;
        if (typeof props.client?.invalidateQueries === 'function') bridge.queryClient = props.client;
      }
      if (bridge.store && bridge.router && bridge.queryClient) break;
      if (fiber.child) queue.push(fiber.child);
      if (fiber.sibling) queue.push(fiber.sibling);
    }
    return bridge;
  }

  function normalizeCardForPage(card) {
    if (!card) return null;
    const specs = [0, 1, 2].map(idx => card.specs?.[idx] || 0);
    const power = specs.reduce((a, b) => a + b, 0);
    return Object.assign({}, card, { power });
  }

  function dispatchCardsToBattleBoard(store, operationId, kp, cards, modifiers, attributes) {
    const state = store.getState();
    if (!state.battleBoard) throw new Error('页面棋盘未初始化。');
    const pageCards = cards.map(normalizeCardForPage);

    const dispatchAction = (name, payload) => store.dispatch({ type: 'battleBoard/' + name, payload });
    dispatchAction('initKeypoint', { operationId, keypointId: kp.id, keypoint: kp });
    dispatchAction('setBattleAnimationPhase', null);

    const usedEntities = new Set();
    const boardKeypoints = state.battleBoard.keypoints || {};
    for (const board of Object.values(boardKeypoints)) {
      if (board.modifiersEntityId) Object.values(board.modifiersEntityId).forEach(id => usedEntities.add(id));
      [].concat(board.modifiersGroupA || [], board.modifiersGroupB || []).forEach(m => m && usedEntities.add(m.entityId));
    }

    for (const type of ['inventory_card', 'inventory_modifier_group_a', 'inventory_modifier_group_b']) {
      const groupType = (type === 'inventory_modifier_group_a') ? 1 : 2;
      const placements = pageCards.map((c, idx) => {
        if (type === 'inventory_card') return c ? { card: c } : null;
        const assigned = modifiers[idx] || [];
        const matchedId = assigned.find(m => attributes[m]?.Type === groupType);
        if (!matchedId) return null;

        let seq = 0;
        while (usedEntities.has(`${kp.id}:${matchedId}:${seq}`)) seq++;
        const entityId = `${kp.id}:${matchedId}:${seq}`;
        usedEntities.add(entityId);
        return { modifier: { id: matchedId, entityId } };
      });

      dispatchAction('setPreviews', { type, slots: placements });
      dispatchAction('applyPreviews', { keypointId: kp.id, dropTargetId: null });
    }
  }

  /* ==========================================================================
     8. HTTP API 通信与调度环境
     ========================================================================== */

  let isExecutionRunning = false;
  let isExecutionStopped = false;
  let uiLogArea = null;

  function appendLog(message) {
    const timeStr = new Date().toLocaleTimeString();
    const formatted = `[${timeStr}] ${message}`;
    console.info('[PacificFrontBot]', message);
    if (uiLogArea) {
      uiLogArea.textContent += formatted + '\n';
      uiLogArea.scrollTop = uiLogArea.scrollHeight;
    }
  }

  function checkAbortSignal() {
    if (isExecutionStopped) throw new Error('用户已请求中止。');
  }

  async function delayExecution(ms) {
    const target = Date.now() + ms;
    while (Date.now() < target) {
      checkAbortSignal();
      await new Promise(r => setTimeout(r, Math.min(200, target - Date.now())));
    }
    checkAbortSignal();
  }

  async function requestApi(path, requestBody) {
    checkAbortSignal();
    const isPost = requestBody !== undefined;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 20000);

    try {
      const headers = { 'Accept': 'application/json' };
      if (isPost) {
        headers['Content-Type'] = 'application/json';
        const token = document.cookie.split(';').map(s => s.trim()).find(s => s.startsWith('csrftoken='));
        if (token) headers['X-CSRFToken'] = decodeURIComponent(token.substring(10));
      }
      const response = await fetch('/api/v2/' + path, {
        method: isPost ? 'POST' : 'GET',
        headers,
        credentials: 'same-origin',
        cache: 'no-store',
        signal: controller.signal,
        ...(isPost ? { body: JSON.stringify(requestBody) } : {})
      });
      if (!response.ok) throw new Error(`HTTP ${response.status} (${path})`);
      const payload = await response.json();
      return unwrapApiResponse(payload, path);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async function pollCondition(fetchFn, predicateFn, timeoutMsg) {
    for (let i = 0; i < 20; i++) {
      await delayExecution(CONFIG.delayMs);
      const val = await fetchFn();
      if (predicateFn(val)) return val;
    }
    throw new Error(timeoutMsg + ' 超时。');
  }

  async function fetchVerifiedInventory() {
    let status = await requestApi('inventory/status/');
    if (status.inPending) await pollCondition(() => requestApi('inventory/status/'), s => !s.inPending, '库存同步');
    const inventory = await requestApi('inventory/');
    if (inventory.unfinishedTransactions) throw new Error('库存有未结算事务，请稍候。');
    return inventory;
  }

  async function syncBoardDisplay(operationId, kp, plan) {
    if (!CONFIG.syncPage) return;
    try {
      let bridge = resolvePageBridge(document);
      const targetPath = buildOperationPath(location.pathname, operationId, kp.id);

      if (location.pathname.replace(/\/$/, '') !== targetPath) {
        if (!bridge.router) throw new Error('未获取到路由对象。');
        await bridge.router.navigate(targetPath);
      }

      for (let i = 0; i < 40; i++) {
        checkAbortSignal();
        bridge = resolvePageBridge(document);
        if (bridge.store?.getState().battleBoard?.activeKeypointId === kp.id) break;
        await delayExecution(200);
      }

      const activeBoard = bridge.store?.getState().battleBoard;
      if (!bridge.store || activeBoard?.activeKeypointId !== kp.id) throw new Error('战斗棋盘未能就绪。');

      const attributes = window.adeck?.getModifiers ? window.adeck.getModifiers() : {};
      dispatchCardsToBattleBoard(bridge.store, operationId, kp, plan.cards, plan.modifiers, attributes);
      await delayExecution(400);
    } catch (e) {
      appendLog('页面棋盘同步提示：' + e.message);
    }
  }

  function printDetailedPlan(kp, plan) {
    const rawSlots = getKeypointSlots(kp);
    appendLog(`📍 据点 [${kp.name || kp.id}] 推演排阵完成 (相邻增益联动: ${plan.buffSynergies || 0} 处)：`);
    plan.cards.forEach((c, i) => {
      if (!c) { appendLog(`  [${i + 1}号位] 空位 / Empty`); return; }
      const shipName = formatCardName(c);
      const mods = (plan.modifiers[i] || []).map(formatModifierName).join(' + ') || '无道具 (裸卡)';
      const slotObj = rawSlots[i];
      const rewardInfo = parseSlotReward(slotObj);
      const targetPct = (getSlotTargetRate(slotObj, CONFIG.assetProtection) * 100).toFixed(0);
      const ratePct = ((plan.rates[i] || 0) * 100).toFixed(1);
      appendLog(`  [${i + 1}号位] ${shipName} (HP:${c.health}) | 胜率: ${ratePct}% (底线:${targetPct}% ${rewardInfo.label}) | 装配: [${mods}]`);
    });
  }

  /* ==========================================================================
     9. 流程驱动器
     ========================================================================== */

  async function executeBotWorkflow(mode) {
    if (isExecutionRunning) { appendLog('已有任务在运行中。'); return; }
    isExecutionRunning = true;
    isExecutionStopped = false;

    try {
      const state = await requestApi('state/');
      if (state.status?.state === 'unauth') throw new Error('登录失效，请重新登录游戏。');

      const currentRoute = parseRouteInfo(location.pathname);
      const activeOpId = state.status?.operationId || currentRoute.operationId;
      if (!activeOpId) throw new Error('未检测到进行中的行动，请在页面中点选一个行动。');

      let opData = await requestApi(`operation/${encodeURIComponent(activeOpId)}/`);
      if (opData.isFinished) throw new Error('当前行动已全部结算完成。');

      if (!opData.isStarted) {
        appendLog('正在自动初始化并开启当前行动...');
        await requestApi('operation/start/', { operationId: activeOpId });
        opData = await pollCondition(() => requestApi(`operation/${encodeURIComponent(activeOpId)}/`), o => o.isStarted, '行动初始化');
        appendLog('行动初始化完成。');
      }

      root.PacificFrontBot.currentOp = opData;
      let battleCounter = 0;

      while (true) {
        checkAbortSignal();
        opData = await requestApi(`operation/${encodeURIComponent(activeOpId)}/`);
        root.PacificFrontBot.currentOp = opData;
        if (opData.isFinished) { appendLog('当前行动已完结。'); return; }

        const stage = findActiveStage(opData);
        if (!stage) throw new Error('无法解析当前活跃阶段。');

        const stageTargetMet = isStageTargetMet(stage);
        const stageHasRemaining = hasRemainingKeypoints(stage);
        const isFullClear = CONFIG.fullClearMode;
        const shouldAdvance = (!isFullClear && stageTargetMet) || (!stageHasRemaining);

        if (shouldAdvance) {
          if (mode === 'manual') {
            appendLog(!stageHasRemaining ? '本阶段全部据点已清空。' : '当前阶段通关目标已达成。如需继续给剩余节点选卡，请勾选“全歼模式”。');
            return;
          }

          const nextStage = opData.stages[opData.stages.indexOf(stage) + 1];
          if (nextStage) {
            appendLog(`阶段任务达成（${isFullClear ? '全歼清空' : '稳妥达标'}），正在进入下一阶段...`);
            await requestApi('operation/next-stage/', {});
            await pollCondition(() => requestApi(`operation/${encodeURIComponent(activeOpId)}/`), o => findActiveStage(o)?.id === nextStage.id, '阶段切换');
            await delayExecution(CONFIG.delayMs);
            continue;
          }

          const bosses = stage.keypoints.flatMap(k => getKeypointSlots(k)).filter(s => isBossEnemy(s?.enemy));
          if (bosses.some(s => s.outcome !== 'win')) throw new Error('最终阶段主目标敌舰尚未全部击败，已暂停。');

          const freshState = await requestApi('state/');
          if (!freshState.status?.isOperationReadyToComplete) throw new Error('服务器未允许完结行动，请手动核对战果。');

          appendLog('结束并结算当前行动...');
          await requestApi('operation/complete/', {});
          await pollCondition(() => requestApi('state/'), s => s.status?.operationId !== activeOpId, '行动结算');
          appendLog('行动已圆满完结。');
          return;
        }

        if (battleCounter >= CONFIG.maxBattles) { appendLog('已达到单次运行最大战斗轮数上限。'); return; }

        const inventory = await fetchVerifiedInventory();
        const settings = window.defaultState?.settings;
        if (!settings || !window.adeck) throw new Error('全局游戏数据未加载，请刷新页面。');

        const openedKeypointId = parseRouteInfo(location.pathname).keypointId;
        let candidateKeypoints = [];

        for (const kp of stage.keypoints) {
          if (!isKeypointFinished(kp)) {
            if (mode === 'manual' && openedKeypointId && kp.id === openedKeypointId) {
              candidateKeypoints = [kp];
              break;
            }
            candidateKeypoints.push(kp);
          }
        }
        if (candidateKeypoints.length === 0) { appendLog('当前阶段无可出战据点。'); return; }

        let bestChoice = null;
        const rateCache = new Map();
        const stageContext = { conditionType: stage.condition?.type, targetMet: stageTargetMet };

        for (const brief of candidateKeypoints) {
          checkAbortSignal();
          const kpDetail = await requestApi(`keypoint/${encodeURIComponent(brief.id)}/`);
          if (isKeypointFinished(kpDetail) || kpDetail.status === 'in_processing') continue;

          const isBoss = isBossKeypoint(kpDetail);
          const effects = resolveKeypointEffects(opData, kpDetail, settings.options.appliedEffectsCancelableClearThreshold || 1.0);
          const availableCards = resolveAvailableCards(settings.collection.cards, inventory, stage, effects);

          const plan = await executeJointOptimization(
            window.adeck, settings, kpDetail, availableCards, effects, inventory,
            CONFIG, checkAbortSignal, () => delayExecution(1),
            [], rateCache, stageContext
          );

          if (plan && (!bestChoice || compareEvaluationPlans(plan, bestChoice.plan, CONFIG, isBoss) < 0)) {
            bestChoice = { kp: kpDetail, plan, isBoss };
          }
        }

        if (!bestChoice) throw new Error('未检索到可用卡牌阵容。');

        // 执行战前无损去冗清洁锁[cite: 2]
        enforceFinalModCleanliness(bestChoice.kp, bestChoice.plan, window.adeck, settings);

        const p = bestChoice.plan;
        printDetailedPlan(bestChoice.kp, p);
        await syncBoardDisplay(activeOpId, bestChoice.kp, p);

        if (mode === 'manual') {
          appendLog('【手动模式就绪】已排好最优阵型并填入棋盘！未发起战斗提交，可手动微调或直接在网页点击开战。');
          return;
        }

        if (bestChoice.isBoss && CONFIG.bossFillOnly) {
          appendLog('====================================================');
          appendLog('【Boss 战拦截触发】已排好最优主力阵容并填入棋盘！');
          appendLog(`当前已装配 ${p.lootBonusCount || 0} 件效率提升代币道具。`);
          appendLog('因勾选了“Boss 战仅自动选卡”，脚本已主动暂停开战提交。');
          appendLog('请玩家在页面手动核对卡牌与消耗品槽位，点击游戏内“战斗”按钮开战！');
          appendLog('====================================================');
          return;
        }

        if (!p.safe) {
          appendLog('胜率低于设定的开战安全线，自动出战暂停，已保留填卡草稿。');
          return;
        }

        const battleSlots = p.cards.map((card, idx) => {
          if (!card) return null;
          const assignedMods = p.modifiers[idx] || [];
          return Object.assign({ cardCode: card.code }, assignedMods.length > 0 ? { modifiers: assignedMods } : {});
        });

        appendLog(`提交第 ${battleCounter + 1} 场出战请求...`);
        await requestApi('keypoint/start/', { keypointId: bestChoice.kp.id, battleSetup: { slots: battleSlots } });

        const battleResult = await pollCondition(() => requestApi(`keypoint/${encodeURIComponent(bestChoice.kp.id)}/`), isKeypointFinished, '战斗结算');
        const winCount = getKeypointSlots(battleResult).filter(s => s?.outcome === 'win').length;

        appendLog(`第 ${battleCounter + 1} 场结算完成：获胜槽位 ${winCount} / 4 个。`);
        battleCounter++;
        await delayExecution(CONFIG.delayMs);
      }
    } catch (e) {
      appendLog('运行终止：' + e.message);
    } finally {
      isExecutionRunning = false;
    }
  }

  /* ==========================================================================
     10. UI 面板装配 (支持自由拖拽与双模操作)
     ========================================================================== */

  if (!ALLOWED_ORIGINS.includes(location.origin)) return;

  const container = document.createElement('div');
  container.id = 'pacific-front-bot-panel';
  container.style.cssText = 'position:fixed;right:20px;top:80px;width:350px;z-index:2147483647;user-select:none;';
  const shadowRoot = container.attachShadow({ mode: 'open' });

  shadowRoot.innerHTML = `
    <style>
      :host { color: #f0f4f8; font: 13px/1.4 system-ui, -apple-system, sans-serif; }
      section {
        background: rgba(16, 33, 50, 0.88);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        border: 1px solid rgba(103, 132, 157, 0.65);
        border-radius: 12px;
        padding: 12px 14px;
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
      }
      .header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 8px;
        cursor: grab;
        padding-bottom: 4px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.15);
      }
      .header:active { cursor: grabbing; }
      h3 { margin: 0; font-size: 13px; font-weight: 600; color: #a4d2ff; pointer-events: none; }
      .setting-bar { background: rgba(23, 44, 66, 0.85); padding: 6px 10px; border-radius: 6px; margin-bottom: 6px; display: flex; flex-direction: column; gap: 5px; }
      .setting-bar label { font-size: 12px; color: #d0e1f0; cursor: pointer; display: flex; align-items: center; gap: 6px; }
      .btn-group { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 6px; }
      button {
        padding: 6px 10px; border: 0; border-radius: 4px; cursor: pointer;
        background: #2a4763; color: #eaf2f8; font-size: 12px; font-weight: 500; transition: background 0.15s;
      }
      button:hover { background: #3b638a; }
      button.primary { background: #2f80ed; color: #fff; }
      button.primary:hover { background: #1f6fd9; }
      button.danger { background: #b03a2e; color: #fff; }
      button.danger:hover { background: #922b21; }
      pre {
        font: 11px/1.45 SFMono-Regular, Consolas, Monaco, monospace;
        white-space: pre-wrap; max-height: 240px; overflow-y: auto; margin: 0; padding: 6px;
        background: rgba(0, 0, 0, 0.4); border-radius: 6px; border: 1px solid rgba(255, 255, 255, 0.08); color: #c9d8e5;
        user-select: text;
      }
      .note { color: #8faec5; font-size: 11px; margin-bottom: 6px; }
    </style>
    <section>
      <div class="header" title="按住可随意拖拽窗口位置">
        <h3>Pacific Front 控制台 v${SCRIPT_VERSION} ✛</h3>
        <button id="btn-toggle" style="padding:2px 6px;font-size:11px;">收起</button>
      </div>
      <div class="setting-bar">
        <label title="开启后即使击杀数达标也会打完本阶段全部剩余节点">
          <input type="checkbox" id="chk-full-clear"> 全歼模式 (清空阶段所有节点)
        </label>
        <label title="边际效用均衡：防止滥用消耗品，寻找低战力与少道具的最佳平衡点（开启时满血不挂维修包）">
          <input type="checkbox" id="chk-conserve-mods" checked> 消耗品节省模式 (边际效用均衡)
        </label>
        <label title="针对煤炭与快速维修包启用 95% 特化胜率保护，严防战略翻车；后期卡池充足可取消">
          <input type="checkbox" id="chk-asset-protect" checked> 战略资产确权 (煤炭/修船包95%防线)
        </label>
        <label title="Boss 战必须确保 100% 全歼率前提下，在槽位强力装配效率提升代币道具">
          <input type="checkbox" id="chk-boss-loot" checked> Boss 战 100% 全歼优先并装配代币加成
        </label>
        <label title="全自动游玩时，推演到 Boss 战后仅填卡上棋盘并暂停，交由玩家手动检查/调整后出战">
          <input type="checkbox" id="chk-boss-fill-only" checked> Boss 战仅自动选卡 (交由玩家手动开战)
        </label>
      </div>
      <div class="note">⭐ 相邻指向增益协同 · 纯裸卡战力Cost · 战前无损去冗</div>
      <div class="btn-group">
        <button id="btn-manual" class="primary">手动模式 (选卡)</button>
        <button id="btn-run">自动模式 (游玩)</button>
        <button id="btn-stop" class="danger">停止</button>
      </div>
      <pre></pre>
    </section>
  `;

  uiLogArea = shadowRoot.querySelector('pre');
  const fullClearCheckbox = shadowRoot.querySelector('#chk-full-clear');
  const conserveModsCheckbox = shadowRoot.querySelector('#chk-conserve-mods');
  const assetProtectCheckbox = shadowRoot.querySelector('#chk-asset-protect');
  const bossLootCheckbox = shadowRoot.querySelector('#chk-boss-loot');
  const bossFillOnlyCheckbox = shadowRoot.querySelector('#chk-boss-fill-only');

  fullClearCheckbox.onchange = e => {
    CONFIG.fullClearMode = Boolean(e.target.checked);
    appendLog(`策略变更：${CONFIG.fullClearMode ? '开启【全歼模式】' : '恢复【稳妥达标模式】'}`);
  };

  conserveModsCheckbox.onchange = e => {
    CONFIG.conserveModifiers = Boolean(e.target.checked);
    appendLog(`运筹偏好：${CONFIG.conserveModifiers ? '开启【消耗品节省模式】（满血禁用维修包以省资源）' : '切换为【最低战力优先模式】（允许浅卡池满血挂维修包攻坚）'}`);
  };

  assetProtectCheckbox.onchange = e => {
    CONFIG.assetProtection = Boolean(e.target.checked);
    appendLog(`确权防线：${CONFIG.assetProtection ? '开启【战略资产确权】（煤炭/维修包锁定95%防线）' : '关闭【战略资产确权】（统一采用常规胜率基准）'}`);
  };

  bossLootCheckbox.onchange = e => {
    CONFIG.bossLootPriority = Boolean(e.target.checked);
    appendLog(`Boss 策略变更：${CONFIG.bossLootPriority ? '开启【Boss战 100% 全歼并装配代币加成】' : '关闭【Boss战代币特化】'}`);
  };

  bossFillOnlyCheckbox.onchange = e => {
    CONFIG.bossFillOnly = Boolean(e.target.checked);
    appendLog(`Boss 出战策略：${CONFIG.bossFillOnly ? '开启【Boss 战仅自动选卡，暂停待手动开战】' : '关闭【Boss 战全自动出战】'}`);
  };

  shadowRoot.querySelector('#btn-manual').onclick = () => executeBotWorkflow('manual');
  shadowRoot.querySelector('#btn-run').onclick = () => executeBotWorkflow('auto');
  shadowRoot.querySelector('#btn-stop').onclick = () => {
    isExecutionStopped = true;
    appendLog('已收到停止指令。');
  };

  const toggleBtn = shadowRoot.querySelector('#btn-toggle');
  toggleBtn.onclick = () => {
    uiLogArea.hidden = !uiLogArea.hidden;
    toggleBtn.textContent = uiLogArea.hidden ? '展开' : '收起';
  };

  // 悬浮窗口拖拽支持[cite: 2]
  const headerElem = shadowRoot.querySelector('.header');
  let isDragging = false, startX, startY, origLeft, origTop;
  headerElem.addEventListener('mousedown', e => {
    if (e.target.tagName === 'BUTTON') return;
    isDragging = true;
    startX = e.clientX;
    startY = e.clientY;
    const rect = container.getBoundingClientRect();
    origLeft = rect.left;
    origTop = rect.top;
    container.style.right = 'auto';
    container.style.left = `${origLeft}px`;
    container.style.top = `${origTop}px`;
    e.preventDefault();
  });

  window.addEventListener('mousemove', e => {
    if (!isDragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    const maxLeft = window.innerWidth - container.offsetWidth - 5;
    const maxTop = window.innerHeight - container.offsetHeight - 5;
    container.style.left = `${Math.max(5, Math.min(maxLeft, origLeft + dx))}px`;
    container.style.top = `${Math.max(5, Math.min(maxTop, origTop + dy))}px`;
  });

  window.addEventListener('mouseup', () => { isDragging = false; });

  window.PacificFrontBot = {
    version: SCRIPT_VERSION,
    config: CONFIG,
    currentOp: null,
    manual: () => executeBotWorkflow('manual'),
    run: () => executeBotWorkflow('auto'),
    stop: () => { isExecutionStopped = true; }
  };

  document.documentElement.appendChild(container);
  appendLog(`控制台 v${SCRIPT_VERSION} 已就绪：裸战力Cost、相邻指向增益协同与动态确权已生效。`);
})();

// ==UserScript==
// @name         Pacific Front 自动排阵与游玩 (手动自动双模与边际均衡版)
// @namespace    local.pacific-front
// @version      2.6.0
// @description  合并手动/自动双操作流；新增消耗品边际效用均衡模式；Boss战以100%全歼与代币提升为基准，支持手动拦截；支持全歼与稳妥双模。
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

  const SCRIPT_VERSION = '2.6.0';

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
    delayMs: 1000,                // 步骤安全延迟[cite: 1]
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
    conserveModifiers: true       // 【新增】消耗品节省模式（边际效用均衡：兼顾低战力与少道具）
  };

  /* ==========================================================================
     2. 工具断言、弱点、战力与消耗品精确鉴别
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

  function calculateCardPower(card) {
    if (!card || !card.specs) return 0;
    let sum = 0;
    const values = Object.values(card.specs);
    for (let i = 0; i < values.length; i++) {
      sum += values[i];
    }
    return sum;
  }

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
        if (/common_boss|epic_boss|boss|flagship|leader/i.test(enemy.tags[i])) {
          return true;
        }
      }
    }
    if (typeof enemy.code === 'string' && /_boss/i.test(enemy.code)) {
      return true;
    }
    return false;
  }

  function isBossKeypoint(kp) {
    if (!kp) return false;
    if (kp.isBoss === true || kp.type === 'boss') return true;
    if (Array.isArray(kp.tags) && kp.tags.some(function (t) { return /boss/i.test(t); })) return true;
    if (typeof kp.name === 'string' && /boss|首领|旗舰|头目/i.test(kp.name)) return true;

    const rawSlots = getKeypointSlots(kp);
    for (let i = 0; i < 4; i++) {
      if (rawSlots[i] && isBossEnemy(rawSlots[i].enemy)) {
        return true;
      }
    }
    return false;
  }

  function getModifierMeta(id, settings) {
    if (!settings || !Array.isArray(settings.collection && settings.collection.modifiers)) {
      return { id: String(id), name: String(id), desc: '' };
    }
    const found = settings.collection.modifiers.find(function (m) { return m.id === id; });
    if (!found) return { id: String(id), name: String(id), desc: '' };
    const name = found.name || found.title || String(id);
    const desc = found.description || found.desc || found.tooltip || found.effect || '';
    return { id: String(id), name: name, desc: desc };
  }

  function isEffectivenessModifier(id, settings) {
    if (!id) return false;
    const idLower = String(id).toLowerCase();
    if (/moral/i.test(idLower)) return false;
    if (/effectiv|efficien|token|progress|bounty|spoils/i.test(idLower)) {
      return true;
    }
    const meta = getModifierMeta(id, settings);
    const text = (meta.name + ' ' + meta.desc).toLowerCase();
    if (text.includes('效率提升') || text.includes('效率') || text.includes('代币') || text.includes('进度') ||
        text.includes('effectiveness') || text.includes('efficiency') || text.includes('token')) {
      if (!text.includes('士气') && !text.includes('moral')) {
        return true;
      }
    }
    return false;
  }

  function isMoralImpactModifier(id, settings) {
    if (!id) return false;
    const idLower = String(id).toLowerCase();
    if (/moral/i.test(idLower)) return true;
    const meta = getModifierMeta(id, settings);
    const text = (meta.name + ' ' + meta.desc).toLowerCase();
    return text.includes('士气') || text.includes('moral');
  }

  function rankBossSlotsForEffectiveness(kp) {
    const rawSlots = getKeypointSlots(kp);
    const list = [];
    for (let i = 0; i < 4; i++) {
      const slot = rawSlots[i];
      if (!slot || !slot.enemy) continue;
      const enemy = slot.enemy;
      let score = 1;
      if (isBossEnemy(enemy)) {
        score = 100;
      } else if (enemy.tier && enemy.tier >= 9) {
        score = 10;
      }
      list.push({ index: i, score: score, enemy: enemy });
    }
    list.sort(function (a, b) { return b.score - a.score; });
    return list;
  }

  // 边际效用均衡：计算卡牌战力与道具边际消耗惩罚的综合加权成本
  function calculateMarginalCost(planOrMetrics) {
    const p = planOrMetrics.totalPower || 0;
    const combatMods = (planOrMetrics.modifiers ? planOrMetrics.modifiers.flat().length : 0) - (planOrMetrics.lootBonusCount || 0);
    const m = Math.max(0, combatMods);
    // 递增凸函数惩罚：m=0 -> 0; m=1 -> 160; m=2 -> 440 (边际+280); m=3 -> 840 (边际+400)
    const itemPenalty = 100 * m + 60 * m * m;
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
    if (!operation || !Array.isArray(operation.stages) || operation.stages.length === 0) {
      return null;
    }
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
          const slot = slotList[j];
          if (slot && slot.ally && slot.ally.code) {
            used.add(slot.ally.code);
          }
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
          : [i - 1, i, i + 1].filter(function (idx) { return idx >= 0 && idx < 4; });

        for (let t = 0; t < targetIndices.length; t++) {
          const enemy = rawSlots[targetIndices[t]] ? rawSlots[targetIndices[t]].enemy : null;
          if (enemy && enemy.vulns) {
            if (Object.prototype.hasOwnProperty.call(enemy.vulns, vulnStr) || enemy.vulns[vulnStr] !== undefined) {
              hits++;
            }
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
     3. 战局分析与候选卡池规则过滤
     ========================================================================== */

  function resolveKeypointEffects(op, kp, threshold) {
    const stages = op.stages || [];
    let currentStageIndex = -1;
    for (let i = 0; i < stages.length; i++) {
      if (Array.isArray(stages[i].keypoints)) {
        for (let j = 0; j < stages[i].keypoints.length; j++) {
          if (stages[i].keypoints[j].id === kp.id) {
            currentStageIndex = i;
            break;
          }
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
              if (stages[s].keypoints[k].id === e.source) {
                sourceStageIndex = s;
                break;
              }
            }
          }
          if (sourceStageIndex >= 0) break;
        }
      }

      const isDirect = Array.isArray(e.applyTo) && e.applyTo.includes(kp.id);
      const isSubsequent = e.isSubsequent && e.source !== kp.id &&
        sourceStageIndex >= 0 && sourceStageIndex < currentStageIndex;

      if (!isDirect && !isSubsequent) continue;

      const isMitigable = e.isMitigable && e.payload.type !== 5 && e.payload.type !== 6;
      if (!isMitigable && e.source) {
        let sourceKp = null;
        for (let s = 0; s < stages.length; s++) {
          if (Array.isArray(stages[s].keypoints)) {
            for (let k = 0; k < stages[s].keypoints.length; k++) {
              if (stages[s].keypoints[k].id === e.source) {
                sourceKp = stages[s].keypoints[k];
                break;
              }
            }
          }
          if (sourceKp) break;
        }

        if (sourceKp && sourceKp.status === 'cleared') {
          const slotMap = sourceKp.slots || {};
          const slotValues = Object.values(slotMap);
          let wins = 0;
          for (let w = 0; w < slotValues.length; w++) {
            const slot = slotValues[w];
            if (slot.outcome === 'win') {
              const hasMoral = slot.ally && Array.isArray(slot.ally.modifiers) &&
                slot.ally.modifiers.includes('moral-impact');
              wins += hasMoral ? 2 : 1;
            }
          }
          if (slotValues.length > 0) {
            const ratio = Math.min(wins / slotValues.length, 1.0);
            if (ratio >= threshold) continue;
          }
        }
      }

      activePayloads.push(e.payload);
    }
    return activePayloads;
  }

  function resolveAvailableCards(catalog, inventory, stage, effects) {
    if (!Array.isArray(inventory.cards)) {
      throw new Error('库存卡牌数据异常。');
    }

    const usedCardCodes = collectUsedCardCodes(stage);
    const restrictions = [];
    for (let i = 0; i < effects.length; i++) {
      if (effects[i].type === 6 && effects[i].restrictions) {
        restrictions.push(effects[i].restrictions);
      }
    }

    const catalogMap = new Map();
    for (let i = 0; i < catalog.length; i++) {
      catalogMap.set(catalog[i].code, catalog[i]);
    }

    const eligible = [];
    for (let i = 0; i < inventory.cards.length; i++) {
      const item = inventory.cards[i];
      if (item.health <= 0 || usedCardCodes.has(item.code)) continue;

      const baseCard = catalogMap.get(item.code);
      if (!baseCard) throw new Error('未知卡牌编码：' + item.code);

      let restricted = false;
      for (let r = 0; r < restrictions.length; r++) {
        const re = restrictions[r];
        if (
          (Array.isArray(re.cards) && re.cards.includes(baseCard.code)) ||
          (Array.isArray(re.types) && re.types.includes(baseCard.type)) ||
          (Array.isArray(re.tier) && re.tier.includes(baseCard.tier))
        ) {
          restricted = true;
          break;
        }
      }

      if (!restricted) {
        eligible.push(Object.assign({}, baseCard, { health: item.health }));
      }
    }
    return eligible;
  }

  /* ==========================================================================
     4. 预测引擎适配与方案裁决器 (边际均衡与Boss全歼双模)
     ========================================================================== */

  function buildEngineRestriction(engine, rule) {
    if (!rule) return engine.newEmptyRestriction();
    return engine.newRestriction(
      rule.cards || [],
      rule.types || [],
      rule.tier || [],
      rule.modifiers || [],
      false
    );
  }

  function transformEffectToEngine(engine, p) {
    const restriction = buildEngineRestriction(engine, p.apply_restrictions);
    switch (p.type) {
      case 1:
        return engine.newMultiplyPlayerSpecsEffect(p.specs || {}, p.delta_specs || {}, restriction);
      case 2:
        return engine.newMultiplyPlayerBuffsEffect(p.multiplier, p.delta_multiplier || 0, restriction);
      case 3:
        return engine.newMultiplyPlayerDebuffsEffect(p.multiplier, p.delta_multiplier || 0, restriction);
      case 4:
        return engine.newMultiplyEnemyPowerEffect(p.specs || {}, p.delta_specs || {}, restriction);
      case 5:
        return engine.newDisableAllModifiersEffect(false);
      case 6:
        return engine.newExtraRestrictionsEffect(buildEngineRestriction(engine, p.restrictions), false);
      default:
        throw new Error('未支持的效果类型：' + p.type);
    }
  }

  function makeBattlePredictor(engine, settings, kp, effects) {
    const rawSlots = getKeypointSlots(kp);
    const enemies = [null, null, null, null];
    for (let i = 0; i < 4; i++) {
      const slot = rawSlots[i];
      if (slot && slot.enemy) {
        enemies[i] = engine.newCard(
          slot.enemy.code,
          slot.enemy.type,
          slot.enemy.tier,
          slot.enemy.specs || {},
          slot.enemy.vulns || {},
          [],
          engine.newFullHealth()
        );
      }
    }

    const compiledEffects = effects.map(function (e) {
      return transformEffectToEngine(engine, e);
    });

    const cardEngineCache = new WeakMap();

    return function (cards, modifiers) {
      const activeModifiers = modifiers || [[], [], [], []];
      const board = engine.newBoard(4);

      for (let i = 0; i < 4; i++) {
        if (enemies[i]) {
          board.Enemy.Slots[i] = engine.newSlot(enemies[i]);
        }
        const c = cards[i];
        if (c) {
          let preparedCard = cardEngineCache.get(c);
          if (!preparedCard) {
            const buffs = [];
            const rawBuffs = c.buffs || [];
            for (let b = 0; b < rawBuffs.length; b++) {
              const effect = engine.newEffect(0, true);
              effect.Relative = {};
              effect.Relative[rawBuffs[b].spec] = rawBuffs[b].value;
              buffs.push(engine.newBuff(rawBuffs[b].direction, effect));
            }

            const rawDebuffs = c.debuffs || [];
            for (let d = 0; d < rawDebuffs.length; d++) {
              const effect = engine.newEffect(rawDebuffs[d].vuln, false);
              effect.Relative = { 0: rawDebuffs[d].value };
              buffs.push(engine.newBuff(rawDebuffs[d].direction, effect));
            }

            preparedCard = engine.newCard(
              c.code,
              c.type,
              c.tier,
              c.specs || {},
              {},
              buffs,
              engine.newHealth(c.health, 3)
            );
            cardEngineCache.set(c, preparedCard);
          }
          board.Player.Slots[i] = engine.newSlot(preparedCard, ...(activeModifiers[i] || []));
        }
      }

      if (compiledEffects.length > 0) {
        board.Effects = compiledEffects;
      }

      const [isOk, err, result] = engine.predict(board, settings);
      if (!isOk || err || !result) {
        throw new Error('预测引擎内部错误：' + String(err ? err : '无结果'));
      }

      const rates = Array.from(result.Predictions);
      const normalized = [0, 0, 0, 0];
      for (let i = 0; i < 4; i++) {
        const p = rates[i];
        if (!Number.isFinite(p) || p < 0 || p > 100) throw new Error('胜率返回异常。');
        normalized[i] = p / 100.0;
      }
      return normalized;
    };
  }

  function evaluateFloorQuality(kp, cards, rates, floorThreshold) {
    const rawSlots = getKeypointSlots(kp);
    let coveredCount = 0;
    let deficitSum = 0.0;

    for (let i = 0; i < 4; i++) {
      if (rawSlots[i] && rawSlots[i].enemy) {
        const rate = cards[i] ? rates[i] : 0.0;
        if (rate >= floorThreshold) coveredCount++;
        if (rate < floorThreshold) deficitSum += (floorThreshold - rate);
      }
    }
    return { covered: coveredCount, deficit: deficitSum };
  }

  function evaluatePlanMetrics(kp, cards, rates, config) {
    const selection = evaluateFloorQuality(kp, cards, rates, config.minSelectionWinRate || 0.80);
    const battle = evaluateFloorQuality(kp, cards, rates, config.minWinRate);
    const target = evaluateFloorQuality(kp, cards, rates, config.targetWinRate !== undefined ? config.targetWinRate : 1.0);

    const rawSlots = getKeypointSlots(kp);
    let hasEnemy = false;
    let weakest = 1.0;

    for (let i = 0; i < 4; i++) {
      if (rawSlots[i] && rawSlots[i].enemy) {
        hasEnemy = true;
        const rate = cards[i] ? rates[i] : 0.0;
        if (rate < weakest) weakest = rate;
      }
    }

    return {
      selectionSafe: hasEnemy && selection.deficit === 0,
      selectionCovered: selection.covered,
      selectionDeficit: selection.deficit,
      safe: hasEnemy && battle.deficit === 0,
      battleCovered: battle.covered,
      battleDeficit: battle.deficit,
      targetDeficit: target.deficit,
      weakestRate: weakest
    };
  }

  function compareEvaluationPlans(a, b, config, isBoss) {
    const safeSelectionDiff = (b.selectionSafe ? 1 : 0) - (a.selectionSafe ? 1 : 0);
    if (safeSelectionDiff !== 0) return safeSelectionDiff;

    if (config.fillAllSlots) {
      let countA = 0, countB = 0;
      for (let i = 0; i < 4; i++) {
        if (a.cards[i]) countA++;
        if (b.cards[i]) countB++;
      }
      if (countB !== countA) return countB - countA;
    }

    const safeDiff = (b.safe ? 1 : 0) - (a.safe ? 1 : 0);
    if (safeDiff !== 0) return safeDiff;

    // ==========================================
    // 分支一：Boss 战核心裁决 (100%全歼第一，战力最高第二，代币道具第三)
    // ==========================================
    if (isBoss) {
      const targetDeficitDiff = (a.targetDeficit || 0) - (b.targetDeficit || 0);
      if (Math.abs(targetDeficitDiff) > 1e-6) {
        return targetDeficitDiff > 0 ? 1 : -1;
      }

      const weakestDiff = (b.weakestRate || 0) - (a.weakestRate || 0);
      if (Math.abs(weakestDiff) > 1e-4) {
        return weakestDiff > 0 ? 1 : -1;
      }

      const expectedDiff = (b.expected || 0) - (a.expected || 0);
      if (Math.abs(expectedDiff) > 1e-4) {
        return expectedDiff > 0 ? 1 : -1;
      }

      // 100% 满胜率下大卡面板压制
      const powerA = a.totalPower !== undefined ? a.totalPower : calculateTotalPower(a.cards);
      const powerB = b.totalPower !== undefined ? b.totalPower : calculateTotalPower(b.cards);
      const powerDiff = powerB - powerA;
      if (Math.abs(powerDiff) > 1e-3) {
        return powerDiff > 0 ? 1 : -1;
      }

      if (config.bossLootPriority) {
        const lootA = a.lootBonusCount || 0;
        const lootB = b.lootBonusCount || 0;
        if (lootB !== lootA) {
          return lootB - lootA;
        }
      }

      const combatModsA = (a.modifiers ? a.modifiers.flat().length : 0) - (a.lootBonusCount || 0);
      const combatModsB = (b.modifiers ? b.modifiers.flat().length : 0) - (b.lootBonusCount || 0);
      if (combatModsA !== combatModsB) return combatModsA - combatModsB;
    }
    // ==========================================
    // 分支二：常规小怪战 (边际效用均衡 vs 纯战力最低)
    // ==========================================
    else {
      if (a.safe && b.safe) {
        const aAtTarget = (a.targetDeficit || 0) === 0;
        const bAtTarget = (b.targetDeficit || 0) === 0;
        const weakestDiff = Math.abs((a.weakestRate || 0) - (b.weakestRate || 0));

        if ((aAtTarget && bAtTarget) || weakestDiff < 0.05) {
          const lootA = a.lootBonusCount || 0;
          const lootB = b.lootBonusCount || 0;
          if (lootA !== lootB) return lootA - lootB;

          // 核心切换：若开启“消耗品节省模式”，运用边际效用加权成本，防止盲目堆道具
          if (config.conserveModifiers) {
            const costA = calculateMarginalCost(a);
            const costB = calculateMarginalCost(b);
            const costDiff = costA - costB;
            if (Math.abs(costDiff) > 1e-3) return costDiff > 0 ? 1 : -1;
          } else {
            // 原始极简模式：纯战力从低到高
            const powerA = a.totalPower !== undefined ? a.totalPower : calculateTotalPower(a.cards);
            const powerB = b.totalPower !== undefined ? b.totalPower : calculateTotalPower(b.cards);
            const powerDiff = powerA - powerB;
            if (Math.abs(powerDiff) > 1e-3) return powerDiff > 0 ? 1 : -1;
          }

          const hitsA = a.weaknessHits !== undefined ? a.weaknessHits : 0;
          const hitsB = b.weaknessHits !== undefined ? b.weaknessHits : 0;
          if (hitsB !== hitsA) return hitsB - hitsA;

          if (config.preferNoModifiers) {
            const modsA = a.modifiers ? a.modifiers.flat().length : 0;
            const modsB = b.modifiers ? b.modifiers.flat().length : 0;
            if (modsA !== modsB) return modsA - modsB;
          }
        }

        const targetDeficitDiff = (a.targetDeficit || 0) - (b.targetDeficit || 0);
        if (Math.abs(targetDeficitDiff) > 1e-6) return targetDeficitDiff > 0 ? 1 : -1;
      }
    }

    if (b.selectionCovered !== a.selectionCovered) return b.selectionCovered - a.selectionCovered;
    if (a.selectionDeficit !== b.selectionDeficit) return a.selectionDeficit - b.selectionDeficit;
    if (b.battleCovered !== a.battleCovered) return b.battleCovered - a.battleCovered;
    if (a.battleDeficit !== b.battleDeficit) return a.battleDeficit - b.battleDeficit;

    const weakestDiff = (b.weakestRate || 0) - (a.weakestRate || 0);
    if (Math.abs(weakestDiff) > 1e-6) return weakestDiff > 0 ? 1 : -1;

    return b.score - a.score;
  }

  /* ==========================================================================
     5. 搜索推演核心 (包含后处理代币加成强力装配管线)
     ========================================================================== */

  async function executeJointOptimization(engine, settings, kp, candidates, effects, inventory, config, checkpoint, yieldUI, seedPlans, rateCache, stageContext) {
    const startTime = performance.now();
    const deadline = startTime + (config.maxSearchMs || 4000);
    checkpoint();

    const isBoss = isBossKeypoint(kp);
    const core = Object.assign({}, engine.newSettings(), settings.options.defaultCoreSettings);
    const modifierAttributes = engine.getModifiers ? engine.getModifiers() : {};
    const stock = extractModifierInventory(inventory);

    let modifiersDisabled = !config.useModifiers;
    for (let i = 0; i < effects.length; i++) {
      if (effects[i].type === 5) {
        modifiersDisabled = true;
        break;
      }
    }

    const restrictedMods = new Set();
    for (let i = 0; i < effects.length; i++) {
      if (effects[i].type === 6 && effects[i].restrictions && Array.isArray(effects[i].restrictions.modifiers)) {
        for (let j = 0; j < effects[i].restrictions.modifiers.length; j++) {
          restrictedMods.add(effects[i].restrictions.modifiers[j]);
        }
      }
    }

    const effectivenessItemSet = new Set();
    const moralImpactItemSet = new Set();
    let totalEffectivenessStock = 0;

    for (const [id, count] of stock.entries()) {
      if (count > 0) {
        if (isEffectivenessModifier(id, settings)) {
          effectivenessItemSet.add(id);
          totalEffectivenessStock += count;
        }
        if (isMoralImpactModifier(id, settings)) {
          moralImpactItemSet.add(id);
        }
      }
    }

    const rawKpSlots = getKeypointSlots(kp);
    const activeEnemySlotCount = rawKpSlots.filter(function (s) { return s && s.enemy; }).length;
    const maxPossibleLootItems = Math.min(totalEffectivenessStock, activeEnemySlotCount);

    const allowMoralImpact = !config.fullClearMode && !isBoss && stageContext &&
      stageContext.conditionType === 'defeat_vehicles' && !stageContext.targetMet;

    function buildAllocationsForSlot(slotIdx, groupType) {
      const list = [null];
      const items = [];

      for (const [id, count] of stock.entries()) {
        if (!modifiersDisabled && count > 0 && !restrictedMods.has(id)) {
          const attr = modifierAttributes[id];
          if (attr && attr.Type === groupType) {
            const isEff = effectivenessItemSet.has(id);
            const isMoral = moralImpactItemSet.has(id);

            if (isBoss) {
              if (isMoral) continue;
            } else {
              if (isEff) continue;
              if (isMoral && !allowMoralImpact) continue;
            }
            items.push(id);
          }
        }
      }

      if (isBoss && config.bossLootPriority) {
        items.sort(function (a, b) {
          const aEff = effectivenessItemSet.has(a) ? 1 : 0;
          const bEff = effectivenessItemSet.has(b) ? 1 : 0;
          return bEff - aEff;
        });
      }
      return list.concat(items);
    }

    const slotAllocations = [[], [], [], []];
    for (let i = 0; i < 4; i++) {
      const g1 = buildAllocationsForSlot(i, 1);
      const g2 = buildAllocationsForSlot(i, 2);
      for (let x = 0; x < g1.length; x++) {
        for (let y = 0; y < g2.length; y++) {
          const pair = [];
          if (g1[x]) pair.push(g1[x]);
          if (g2[y]) pair.push(g2[y]);
          slotAllocations[i].push(pair);
        }
      }
    }

    const enemyVulnSet = new Set();
    for (let i = 0; i < 4; i++) {
      const enemy = rawKpSlots[i] ? rawKpSlots[i].enemy : null;
      if (enemy && enemy.vulns) {
        const keys = Object.keys(enemy.vulns);
        for (let k = 0; k < keys.length; k++) enemyVulnSet.add(keys[k]);
      }
    }

    const pool = candidates.slice().sort(function (a, b) {
      if (isBoss) {
        const powerDiff = calculateCardPower(b) - calculateCardPower(a);
        return powerDiff !== 0 ? powerDiff : a.code.localeCompare(b.code);
      }

      let aHits = 0;
      if (Array.isArray(a.debuffs)) {
        for (let i = 0; i < a.debuffs.length; i++) {
          if (enemyVulnSet.has(String(a.debuffs[i].vuln))) { aHits = 1; break; }
        }
      }
      let bHits = 0;
      if (Array.isArray(b.debuffs)) {
        for (let i = 0; i < b.debuffs.length; i++) {
          if (enemyVulnSet.has(String(b.debuffs[i].vuln))) { bHits = 1; break; }
        }
      }
      if (bHits !== aHits) return bHits - aHits;

      const powerDiff = calculateCardPower(a) - calculateCardPower(b);
      return powerDiff !== 0 ? powerDiff : a.code.localeCompare(b.code);
    });

    const candidateMap = new Map();
    for (let i = 0; i < pool.length; i++) candidateMap.set(pool[i].code, pool[i]);

    const stateCache = new Map();
    let bestPlan = null;
    let predictionCount = 0;
    let isSearchBudgetExhausted = false;

    const limit = config.maxJointPredictions || 60000;
    const predictor = makeBattlePredictor(engine, core, kp, effects);
    const maxItemLimit = modifiersDisabled ? 0 : (config.maxModifiersPerBattle !== undefined ? config.maxModifiersPerBattle : Infinity);

    function evaluateCombination(cards, modifiers) {
      const activeCodes = [];
      for (let i = 0; i < 4; i++) {
        if (cards[i]) activeCodes.push(cards[i].code);
      }
      if (activeCodes.length === 0) return null;
      if (new Set(activeCodes).size !== activeCodes.length) return null;

      const normalizedModifiers = [[], [], [], []];
      let totalAssignedItems = 0;
      const consumedStock = new Map();
      let lootCount = 0;

      for (let i = 0; i < 4; i++) {
        if (cards[i] && modifiers[i]) {
          normalizedModifiers[i] = modifiers[i].slice().sort();
          totalAssignedItems += normalizedModifiers[i].length;
          const assignedTypes = new Set();

          for (let m = 0; m < normalizedModifiers[i].length; m++) {
            const id = normalizedModifiers[i][m];
            const attr = modifierAttributes[id];
            if (!attr || (attr.Type !== 1 && attr.Type !== 2)) return null;
            if (restrictedMods.has(id) || assignedTypes.has(attr.Type)) return null;
            assignedTypes.add(attr.Type);

            if (effectivenessItemSet.has(id)) {
              lootCount++;
            }

            const usage = (consumedStock.get(id) || 0) + 1;
            consumedStock.set(id, usage);
            if (usage > (stock.get(id) || 0)) return null;
          }
        }
      }

      if (totalAssignedItems > maxItemLimit) return null;

      const serializedKey = JSON.stringify([
        cards.map(function (c) { return c ? c.code : null; }),
        normalizedModifiers
      ]);

      if (stateCache.has(serializedKey)) return stateCache.get(serializedKey);

      if (bestPlan && performance.now() >= deadline) {
        isSearchBudgetExhausted = true;
        return null;
      }
      if (predictionCount >= limit) {
        isSearchBudgetExhausted = true;
        return null;
      }

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
        if (cards[i] && rawKpSlots[i] && rawKpSlots[i].enemy) {
          expectedWins += rates[i];
          if (isBossEnemy(rawKpSlots[i].enemy)) bossWins += rates[i];
        }
        if (cards[i]) {
          activeSlots++;
          cardPowerSum += calculateCardPower(cards[i]);
        }
      }

      const score = (config.fillAllSlots ? activeSlots * 100000 : 0) +
        expectedWins * 1000 +
        bossWins * 3000 -
        activeSlots * 2 -
        cardPowerSum * 0.001;

      const totalPower = calculateTotalPower(cards);
      const weaknessHits = calculateWeaknessHits(kp, cards);
      const metrics = evaluatePlanMetrics(kp, cards, rates, config);

      const plan = Object.assign({
        cards: cards.slice(),
        modifiers: normalizedModifiers,
        rates: rates,
        expected: expectedWins,
        score: score,
        totalPower: totalPower,
        weaknessHits: weaknessHits,
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
      let count = 0;
      for (let i = 0; i < 4; i++) {
        if (plan.cards[i]) count++;
      }
      const perfectOccupied = count === Math.min(4, pool.length);
      const perfectSafe = plan.safe && plan.targetDeficit === 0;

      if (isBoss) {
        if (!config.bossLootPriority || maxPossibleLootItems <= 0) {
          return perfectOccupied && perfectSafe;
        }
        return perfectOccupied && perfectSafe && (plan.lootBonusCount >= maxPossibleLootItems);
      }
      return perfectOccupied && perfectSafe;
    }

    const seedLineups = [];
    for (let i = 0; i < seedPlans.length; i++) {
      const p = seedPlans[i];
      seedLineups.push({
        cards: p.cards.map(function (c) { return c ? candidateMap.get(c.code) || null : null; }),
        modifiers: p.modifiers || [[], [], [], []]
      });
    }

    for (let r = 0; r < config.searchRestarts; r++) {
      const roundCards = [null, null, null, null];
      for (let i = 0; i < 4; i++) {
        if (i < pool.length) roundCards[i] = pool[(i + r * 3) % pool.length];
      }
      seedLineups.push({ cards: roundCards, modifiers: [[], [], [], []] });
    }

    for (let s = 0; s < seedLineups.length; s++) {
      if (isPerfectPlan(bestPlan)) break;
      let current = evaluateCombination(seedLineups[s].cards, seedLineups[s].modifiers);
      if (!current) continue;

      for (let pass = 0; pass < config.searchPasses && !isSearchBudgetExhausted; pass++) {
        const passStart = current;
        for (let pos = 0; pos < 4 && !isSearchBudgetExhausted; pos++) {
          checkpoint();
          let nextBest = current;
          const allocationsForPos = slotAllocations[pos];

          for (let pIdx = 0; pIdx < pool.length; pIdx++) {
            const card = pool[pIdx];
            let already = false;
            for (let i = 0; i < 4; i++) {
              if (i !== pos && current.cards[i] && current.cards[i].code === card.code) {
                already = true;
                break;
              }
            }
            if (already) continue;

            for (let aIdx = 0; aIdx < allocationsForPos.length; aIdx++) {
              const trialCards = current.cards.slice();
              const trialModifiers = current.modifiers.map(function (m) { return m.slice(); });
              trialCards[pos] = card;
              trialModifiers[pos] = allocationsForPos[aIdx];

              const candidate = evaluateCombination(trialCards, trialModifiers);
              if (candidate && compareEvaluationPlans(candidate, nextBest, config, isBoss) < 0) {
                nextBest = candidate;
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
            const swappedCards = current.cards.slice();
            const temp = swappedCards[a];
            swappedCards[a] = swappedCards[b];
            swappedCards[b] = temp;

            const candidate = evaluateCombination(swappedCards, current.modifiers);
            if (candidate && compareEvaluationPlans(candidate, current, config, isBoss) < 0) {
              current = candidate;
            }
          }
        }

        if (current === passStart) break;
      }
      if (isSearchBudgetExhausted) break;
    }

    // 后处理代币加成强力装配管线
    if (isBoss && config.bossLootPriority && bestPlan && bestPlan.safe && bestPlan.targetDeficit === 0 && totalEffectivenessStock > 0) {
      const effItemCandidates = [];
      for (const [id, count] of stock.entries()) {
        if (count > 0 && isEffectivenessModifier(id, settings) && !restrictedMods.has(id)) {
          effItemCandidates.push({ id: id, count: count, type: modifierAttributes[id] ? modifierAttributes[id].Type : 1 });
        }
      }

      if (effItemCandidates.length > 0) {
        const rankedTargetSlots = rankBossSlotsForEffectiveness(kp);
        const trialMods = bestPlan.modifiers.map(function (m) { return m.slice(); });

        for (let eIdx = 0; eIdx < effItemCandidates.length; eIdx++) {
          const item = effItemCandidates[eIdx];
          let remainingStock = item.count;

          for (let rIdx = 0; rIdx < rankedTargetSlots.length; rIdx++) {
            if (remainingStock <= 0) break;
            const slotIdx = rankedTargetSlots[rIdx].index;
            if (!bestPlan.cards[slotIdx]) continue;

            const currentSlotMods = trialMods[slotIdx];
            if (currentSlotMods.includes(item.id)) continue;

            const modifiedSlot = currentSlotMods.filter(function (m) {
              return modifierAttributes[m] && modifierAttributes[m].Type !== item.type;
            });
            modifiedSlot.push(item.id);
            modifiedSlot.sort();

            const backup = trialMods[slotIdx];
            trialMods[slotIdx] = modifiedSlot;

            try {
              const testRates = predictor(bestPlan.cards, trialMods);
              const testTargetDeficit = evaluateFloorQuality(kp, bestPlan.cards, testRates, config.targetWinRate || 1.0).deficit;
              const testSafe = evaluateFloorQuality(kp, bestPlan.cards, testRates, config.minWinRate).deficit === 0;

              if (testSafe && testTargetDeficit === 0) {
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
        let finalLootCount = 0;
        for (let i = 0; i < 4; i++) {
          for (let m = 0; m < trialMods[i].length; m++) {
            if (effectivenessItemSet.has(trialMods[i][m])) finalLootCount++;
          }
        }

        bestPlan.modifiers = trialMods;
        bestPlan.rates = finalRates;
        bestPlan.lootBonusCount = finalLootCount;
        bestPlan.expected = finalRates.reduce(function (a, b) { return a + b; }, 0);
        Object.assign(bestPlan, evaluatePlanMetrics(kp, bestPlan.cards, finalRates, config));
      }
    }

    return bestPlan;
  }

  /* ==========================================================================
     6. React Fiber 桥接与棋盘状态同步
     ========================================================================== */

  function resolvePageBridge(doc) {
    const appElem = doc.getElementById('app');
    if (!appElem) return {};

    const propKeys = Object.keys(appElem);
    let reactKey = null;
    for (let i = 0; i < propKeys.length; i++) {
      if (propKeys[i].startsWith('__reactContainer$') || propKeys[i].startsWith('__reactFiber$')) {
        reactKey = propKeys[i];
        break;
      }
    }
    if (!reactKey) return {};

    const rootSeed = appElem[reactKey];
    let initialFiber = null;
    if (rootSeed) {
      if (rootSeed.stateNode && rootSeed.stateNode.current) {
        initialFiber = rootSeed.stateNode.current;
      } else if (rootSeed.current) {
        initialFiber = rootSeed.current;
      } else {
        initialFiber = rootSeed;
      }
    }

    const queue = [initialFiber];
    const visited = new Set();
    const bridge = {};

    while (queue.length > 0 && visited.size < 20000) {
      const fiber = queue.pop();
      if (!fiber || visited.has(fiber)) continue;
      visited.add(fiber);

      const props = fiber.memoizedProps;
      if (props) {
        const potentialStores = [props.store, props.value ? props.value.store : null];
        for (let i = 0; i < potentialStores.length; i++) {
          const s = potentialStores[i];
          if (s && typeof s.dispatch === 'function' && typeof s.getState === 'function') {
            bridge.store = s;
          }
        }
        if (props.router && typeof props.router.navigate === 'function') {
          bridge.router = props.router;
        }
        if (props.client && typeof props.client.invalidateQueries === 'function') {
          bridge.queryClient = props.client;
        }
      }

      if (bridge.store && bridge.router && bridge.queryClient) break;
      if (fiber.child) queue.push(fiber.child);
      if (fiber.sibling) queue.push(fiber.sibling);
    }
    return bridge;
  }

  function normalizeCardForPage(card) {
    if (!card) return null;
    const specs = [0, 1, 2].map(function (idx) {
      return (card.specs && card.specs[idx] !== undefined) ? card.specs[idx] : 0;
    });
    let power = 0;
    for (let i = 0; i < specs.length; i++) power += specs[i];
    return Object.assign({}, card, { power: power });
  }

  function dispatchCardsToBattleBoard(store, operationId, kp, cards, modifiers, attributes) {
    const state = store.getState();
    if (!state.battleBoard) throw new Error('页面棋盘未初始化。');

    const pageCards = cards.map(normalizeCardForPage);
    function dispatchAction(name, payload) {
      store.dispatch({ type: 'battleBoard/' + name, payload: payload });
    }

    dispatchAction('initKeypoint', { operationId: operationId, keypointId: kp.id, keypoint: kp });
    dispatchAction('setBattleAnimationPhase', null);

    const usedEntities = new Set();
    const boardKeypoints = state.battleBoard.keypoints || {};
    for (const board of Object.values(boardKeypoints)) {
      if (board.modifiersEntityId) {
        for (const id of Object.values(board.modifiersEntityId)) usedEntities.add(id);
      }
      const combined = [].concat(board.modifiersGroupA || [], board.modifiersGroupB || []);
      for (let i = 0; i < combined.length; i++) {
        if (combined[i]) usedEntities.add(combined[i].entityId);
      }
    }

    const types = ['inventory_card', 'inventory_modifier_group_a', 'inventory_modifier_group_b'];
    for (let t = 0; t < types.length; t++) {
      const type = types[t];
      const groupType = (type === 'inventory_modifier_group_a') ? 1 : 2;

      const placements = pageCards.map(function (c, idx) {
        if (type === 'inventory_card') return c ? { card: c } : null;

        const assigned = modifiers && modifiers[idx] ? modifiers[idx] : [];
        let matchedId = null;
        for (let m = 0; m < assigned.length; m++) {
          const attr = attributes[assigned[m]];
          if (attr && attr.Type === groupType) {
            matchedId = assigned[m];
            break;
          }
        }
        if (!matchedId) return null;

        let seq = 0;
        while (usedEntities.has(`${kp.id}:${matchedId}:${seq}`)) seq++;
        const entityId = `${kp.id}:${matchedId}:${seq}`;
        usedEntities.add(entityId);
        return { modifier: { id: matchedId, entityId: entityId } };
      });

      dispatchAction('setPreviews', { type: type, slots: placements });
      dispatchAction('applyPreviews', { keypointId: kp.id, dropTargetId: null });
    }
  }

  /* ==========================================================================
     7. HTTP API 通信与调度环境
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
      await new Promise(function (resolve) {
        setTimeout(resolve, Math.min(200, target - Date.now()));
      });
    }
    checkAbortSignal();
  }

  async function requestApi(path, requestBody) {
    checkAbortSignal();
    const isPost = requestBody !== undefined;
    const method = isPost ? 'POST' : 'GET';
    const controller = new AbortController();
    const timeoutId = setTimeout(function () { controller.abort(); }, 20000);

    try {
      const headers = { 'Accept': 'application/json' };
      if (isPost) {
        headers['Content-Type'] = 'application/json';
        const cookieItems = document.cookie.split(';');
        for (let i = 0; i < cookieItems.length; i++) {
          const item = cookieItems[i].trim();
          if (item.startsWith('csrftoken=')) {
            headers['X-CSRFToken'] = decodeURIComponent(item.substring(10));
            break;
          }
        }
      }

      const options = {
        method: method,
        headers: headers,
        credentials: 'same-origin',
        cache: 'no-store',
        signal: controller.signal
      };
      if (isPost) options.body = JSON.stringify(requestBody);

      const response = await fetch('/api/v2/' + path, options);
      if (!response.ok) throw new Error(`HTTP ${response.status} (${path})`);

      let payload;
      try {
        payload = await response.json();
      } catch (e) {
        throw new Error(`解析响应 JSON 失败 (${path})`);
      }
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
    if (status.inPending) {
      await pollCondition(
        function () { return requestApi('inventory/status/'); },
        function (s) { return !s.inPending; },
        '库存同步'
      );
    }
    const inventory = await requestApi('inventory/');
    if (inventory.unfinishedTransactions) {
      throw new Error('库存有未结算事务，请稍候。');
    }
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
        const board = bridge.store ? bridge.store.getState().battleBoard : null;
        if (board && board.activeKeypointId === kp.id) break;
        await delayExecution(200);
      }

      const activeBoard = bridge.store ? bridge.store.getState().battleBoard : null;
      if (!bridge.store || !activeBoard || activeBoard.activeKeypointId !== kp.id) {
        throw new Error('当前节点的战斗棋盘未能就绪。');
      }

      const attributes = (window.adeck && typeof window.adeck.getModifiers === 'function')
        ? window.adeck.getModifiers()
        : {};

      dispatchCardsToBattleBoard(bridge.store, operationId, kp, plan.cards, plan.modifiers, attributes);
      appendLog('已将排阵阵容填入页面棋盘。');
      await delayExecution(800);
    } catch (e) {
      appendLog('页面棋盘填入提示：' + e.message);
    }
  }

  /* ==========================================================================
     8. 流程驱动器 (统一手动/自动双模)
     ========================================================================== */

  async function executeBotWorkflow(mode) {
    if (isExecutionRunning) {
      appendLog('已有任务在运行中。');
      return;
    }
    isExecutionRunning = true;
    isExecutionStopped = false;

    try {
      const state = await requestApi('state/');
      if (state.status && state.status.state === 'unauth') {
        throw new Error('登录失效，请重新登录游戏。');
      }

      const currentRoute = parseRouteInfo(location.pathname);
      const activeOpId = (state.status && state.status.operationId) ? state.status.operationId : currentRoute.operationId;
      if (!activeOpId) {
        throw new Error('未检测到进行中的行动，请在页面中点选一个行动。');
      }

      let opData = await requestApi(`operation/${encodeURIComponent(activeOpId)}/`);
      if (opData.isFinished) {
        throw new Error('当前行动已全部结算完成。');
      }

      if (!opData.isStarted) {
        appendLog('正在自动初始化并开启当前行动...');
        await requestApi('operation/start/', { operationId: activeOpId });
        opData = await pollCondition(
          function () { return requestApi(`operation/${encodeURIComponent(activeOpId)}/`); },
          function (o) { return o.isStarted; },
          '行动初始化'
        );
        appendLog('行动初始化完成。');
      }

      let battleCounter = 0;
      while (true) {
        checkAbortSignal();
        opData = await requestApi(`operation/${encodeURIComponent(activeOpId)}/`);
        if (opData.isFinished) {
          appendLog('当前行动已完结。');
          return;
        }

        const stage = findActiveStage(opData);
        if (!stage) throw new Error('无法解析当前活跃阶段。');

        const stageTargetMet = isStageTargetMet(stage);
        const stageHasRemaining = hasRemainingKeypoints(stage);
        const isFullClear = CONFIG.fullClearMode;
        const shouldAdvance = (!isFullClear && stageTargetMet) || (!stageHasRemaining);

        if (shouldAdvance) {
          if (mode === 'manual') {
            if (!stageHasRemaining) {
              appendLog('本阶段全部节点已清空。');
              return;
            }
            appendLog('当前阶段通关目标已达成。如需继续为剩余节点选卡，请勾选“全歼模式”。');
            return;
          }

          const nextStage = opData.stages[opData.stages.indexOf(stage) + 1];
          if (nextStage) {
            appendLog(`阶段任务达成（${isFullClear ? '全歼清空' : '稳妥达标'}），正在进入下一阶段...`);
            await requestApi('operation/next-stage/', {});
            await pollCondition(
              function () { return requestApi(`operation/${encodeURIComponent(activeOpId)}/`); },
              function (o) { const s = findActiveStage(o); return s && s.id === nextStage.id; },
              '阶段切换'
            );
            await delayExecution(CONFIG.delayMs);
            continue;
          }

          const bosses = stage.keypoints.flatMap(function (k) { return getKeypointSlots(k); })
            .filter(function (s) { return isBossEnemy(s && s.enemy ? s.enemy : null); });
          if (bosses.some(function (s) { return s.outcome !== 'win'; })) {
            throw new Error('最终阶段主目标敌舰尚未全部击败，已暂停。');
          }

          const freshState = await requestApi('state/');
          if (!freshState.status || !freshState.status.isOperationReadyToComplete) {
            throw new Error('服务器未允许完结行动，请手动核对战果。');
          }

          appendLog('结束并结算当前行动...');
          await requestApi('operation/complete/', {});
          await pollCondition(
            function () { return requestApi('state/'); },
            function (s) { return s.status && s.status.operationId !== activeOpId; },
            '行动结算'
          );
          appendLog('行动已圆满完结。');
          return;
        }

        if (battleCounter >= CONFIG.maxBattles) {
          appendLog('已达到单次运行最大战斗轮数上限。');
          return;
        }

        const inventory = await fetchVerifiedInventory();
        const settings = window.defaultState ? window.defaultState.settings : null;
        if (!settings || !window.adeck) throw new Error('全局游戏数据未加载，请刷新页面。');

        const openedKeypointId = parseRouteInfo(location.pathname).keypointId;
        let candidateKeypoints = [];

        for (let i = 0; i < stage.keypoints.length; i++) {
          const kp = stage.keypoints[i];
          if (!isKeypointFinished(kp)) {
            // 手动模式下若点开了特定节点，优先针对该节点
            if (mode === 'manual' && openedKeypointId && kp.id === openedKeypointId) {
              candidateKeypoints = [kp];
              break;
            }
            candidateKeypoints.push(kp);
          }
        }

        if (candidateKeypoints.length === 0) {
          appendLog('当前阶段无可出战节点。');
          return;
        }

        let bestChoice = null;
        const rateCache = new Map();

        const stageContext = {
          conditionType: stage.condition ? stage.condition.type : null,
          targetMet: stageTargetMet
        };

        for (let i = 0; i < candidateKeypoints.length; i++) {
          checkAbortSignal();
          const kpDetail = await requestApi(`keypoint/${encodeURIComponent(candidateKeypoints[i].id)}/`);
          if (isKeypointFinished(kpDetail) || kpDetail.status === 'in_processing') continue;

          const isBoss = isBossKeypoint(kpDetail);
          if (isBoss) {
            appendLog(`【Boss战推演】节点 ${kpDetail.name || kpDetail.id}：首要确保 100% 全歼率！主力尽出，挂载效率提升代币道具！`);
          } else {
            const conserveDesc = CONFIG.conserveModifiers ? '边际效用均衡模式' : '纯战力最低模式';
            appendLog(`【常规战推演】节点 ${kpDetail.name || kpDetail.id}：[${conserveDesc}] 保护代币道具...`);
          }

          const effects = resolveKeypointEffects(opData, kpDetail, settings.options.appliedEffectsCancelableClearThreshold || 1.0);
          const availableCards = resolveAvailableCards(settings.collection.cards, inventory, stage, effects);

          const plan = await executeJointOptimization(
            window.adeck, settings, kpDetail, availableCards, effects, inventory,
            CONFIG, checkAbortSignal, function () { return delayExecution(1); },
            [], rateCache, stageContext
          );

          if (plan) {
            if (!bestChoice || compareEvaluationPlans(plan, bestChoice.plan, CONFIG, isBoss) < 0) {
              bestChoice = { kp: kpDetail, plan: plan, isBoss: isBoss };
            }
          }
        }

        if (!bestChoice) throw new Error('未检索到可用卡牌阵容。');

        const p = bestChoice.plan;
        const activeCardsCount = p.cards.filter(Boolean).length;
        const avgRate = activeCardsCount > 0
          ? (p.rates.slice(0, activeCardsCount).reduce(function (a, b) { return a + b; }, 0) / activeCardsCount * 100).toFixed(1)
          : '0.0';

        appendLog(`锁定出战：${bestChoice.kp.name || bestChoice.kp.id} | 全歼胜率: ${avgRate}% | 效率提升装配: ${p.lootBonusCount || 0} 件 | 消耗总战力: ${p.totalPower}`);
        await syncBoardDisplay(activeOpId, bestChoice.kp, p);

        // ==========================================
        // 【手动模式拦截】直接结束推演，保留棋盘阵容供玩家检查
        // ==========================================
        if (mode === 'manual') {
          appendLog('【手动模式就绪】已完成排阵并填入游戏棋盘！未发起战斗提交，可手动调整或直接在网页点击战斗。');
          return;
        }

        // ==========================================
        // 【自动模式下的 Boss 拦截】
        // ==========================================
        if (bestChoice.isBoss && CONFIG.bossFillOnly) {
          appendLog('====================================================');
          appendLog('【Boss 战拦截触发】已排好最优大卡阵容并填入页面棋盘！');
          appendLog(`当前全歼胜率: ${avgRate}%，已装配 ${p.lootBonusCount || 0} 件效率提升。`);
          appendLog('因勾选了“Boss 战仅自动选卡”，脚本已主动暂停开战提交。');
          appendLog('请玩家在页面手动核对卡牌与消耗品槽位，点击游戏内“战斗”按钮开战！');
          appendLog('====================================================');
          return;
        }

        if (!p.safe) {
          appendLog('胜率低于设定的开战安全线，自动出战暂停，已保留填卡草稿。');
          return;
        }

        const battleSlots = p.cards.map(function (card, idx) {
          if (!card) return null;
          const assignedMods = p.modifiers[idx] || [];
          const payload = { cardCode: card.code };
          if (assignedMods.length > 0) payload.modifiers = assignedMods;
          return payload;
        });

        appendLog(`提交第 ${battleCounter + 1} 场出战请求...`);
        await requestApi('keypoint/start/', {
          keypointId: bestChoice.kp.id,
          battleSetup: { slots: battleSlots }
        });

        const battleResult = await pollCondition(
          function () { return requestApi(`keypoint/${encodeURIComponent(bestChoice.kp.id)}/`); },
          isKeypointFinished,
          '战斗结算'
        );

        let winCount = 0;
        const resultSlots = getKeypointSlots(battleResult);
        for (let i = 0; i < resultSlots.length; i++) {
          if (resultSlots[i] && resultSlots[i].outcome === 'win') winCount++;
        }

        appendLog(`第 ${battleCounter + 1} 场结算完成：获胜槽位 ${winCount} 个。`);
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
     9. UI 面板装配 (简化操作入口)
     ========================================================================== */

  if (!ALLOWED_ORIGINS.includes(location.origin)) return;

  const container = document.createElement('div');
  container.style.cssText = 'position:fixed;right:16px;top:80px;width:350px;z-index:2147483647';
  const shadowRoot = container.attachShadow({ mode: 'open' });

  shadowRoot.innerHTML = `
    <style>
      :host { color: #e8eff5; font: 13px/1.5 system-ui; }
      section { background: #102132; border: 1px solid #67849d; border-radius: 10px; padding: 14px; box-shadow: 0 8px 35px #0008; }
      h3 { margin: 0 0 6px; font-size: 14px; }
      .setting-bar { background: #172c42; padding: 6px 10px; border-radius: 6px; margin-bottom: 6px; display: flex; flex-direction: column; gap: 5px; }
      .setting-bar label { font-size: 12px; color: #d0e1f0; cursor: pointer; display: flex; align-items: center; gap: 6px; }
      button { padding: 7px 10px; margin: 3px; border: 0; border-radius: 5px; cursor: pointer; background: #dce7ed; color: #102132; font-weight: 500; }
      button:hover { background: #ffffff; }
      button.primary { background: #52a5f5; color: #ffffff; }
      button.primary:hover { background: #68b4fc; }
      pre { font: 12px/1.5 system-ui; white-space: pre-wrap; max-height: 280px; overflow: auto; margin-bottom: 0; background: #08131d; padding: 8px; border-radius: 6px; }
      .note { color: #b4c6d6; font-size: 12px; margin-bottom: 6px; }
    </style>
    <section>
      <h3>Pacific Front 控制台 v${SCRIPT_VERSION}</h3>
      <div class="setting-bar">
        <label title="开启后即使击杀数达标也会打完本阶段全部剩余节点">
          <input type="checkbox" id="chk-full-clear"> 全歼模式 (清空阶段所有节点)
        </label>
        <label title="边际效用均衡：防止为了省微薄战力而滥用消耗品，寻找低战力与少道具的最佳平衡点">
          <input type="checkbox" id="chk-conserve-mods" checked> 消耗品节省模式 (边际效用递减均衡)
        </label>
        <label title="Boss 战必须确保 100% 全歼率前提下，在槽位强力装配效率提升代币道具">
          <input type="checkbox" id="chk-boss-loot" checked> Boss 战 100% 全歼优先并装配代币加成
        </label>
        <label title="全自动游玩时，推演到 Boss 战后仅填卡上棋盘并暂停，交由玩家手动检查/调整后出战">
          <input type="checkbox" id="chk-boss-fill-only" checked> Boss 战仅自动选卡 (交由玩家手动开战)
        </label>
      </div>
      <div class="note">手动模式填槽不战 · 自动模式连续通关 · 边际均衡护航</div>
      <button id="btn-manual" class="primary">手动模式 (选卡)</button>
      <button id="btn-run">自动模式 (游玩)</button>
      <button id="btn-stop">停止</button>
      <button id="btn-toggle">收起</button>
      <pre></pre>
    </section>
  `;

  uiLogArea = shadowRoot.querySelector('pre');
  const fullClearCheckbox = shadowRoot.querySelector('#chk-full-clear');
  const conserveModsCheckbox = shadowRoot.querySelector('#chk-conserve-mods');
  const bossLootCheckbox = shadowRoot.querySelector('#chk-boss-loot');
  const bossFillOnlyCheckbox = shadowRoot.querySelector('#chk-boss-fill-only');

  fullClearCheckbox.onchange = function (e) {
    CONFIG.fullClearMode = Boolean(e.target.checked);
    appendLog(`策略变更：${CONFIG.fullClearMode ? '开启【全歼模式】' : '恢复【稳妥达标模式】'}`);
  };

  conserveModsCheckbox.onchange = function (e) {
    CONFIG.conserveModifiers = Boolean(e.target.checked);
    appendLog(`运筹偏好：${CONFIG.conserveModifiers ? '开启【消耗品节省模式】（边际效用均衡）' : '切换为【最低战力优先模式】（无条件压低卡牌战力）'}`);
  };

  bossLootCheckbox.onchange = function (e) {
    CONFIG.bossLootPriority = Boolean(e.target.checked);
    appendLog(`Boss 策略变更：${CONFIG.bossLootPriority ? '开启【Boss战 100% 全歼并装配代币加成】' : '关闭【Boss战代币特化】'}`);
  };

  bossFillOnlyCheckbox.onchange = function (e) {
    CONFIG.bossFillOnly = Boolean(e.target.checked);
    appendLog(`Boss 出战策略：${CONFIG.bossFillOnly ? '开启【Boss 战仅自动选卡，暂停待手动开战】' : '关闭【Boss 战全自动提交出战】'}`);
  };

  shadowRoot.querySelector('#btn-manual').onclick = function () {
    executeBotWorkflow('manual');
  };
  shadowRoot.querySelector('#btn-run').onclick = function () {
    executeBotWorkflow('auto');
  };
  shadowRoot.querySelector('#btn-stop').onclick = function () {
    isExecutionStopped = true;
    appendLog('已收到停止指令。');
  };
  shadowRoot.querySelector('#btn-toggle').onclick = function (e) {
    uiLogArea.hidden = !uiLogArea.hidden;
    e.target.textContent = uiLogArea.hidden ? '展开' : '收起';
  };

  document.documentElement.appendChild(container);
  appendLog(`控制台 v${SCRIPT_VERSION} 已就绪。`);
})();

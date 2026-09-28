/**
 * cost-calculator.js
 * -------------------
 * Motor de cálculo do custo real de produção de itens impressos em 3D.
 *
 * Modelo adotado (prática de quem vende impressão 3D no Brasil):
 *
 *   Custo/hora da máquina = energia + depreciação + manutenção
 *     energia      = kWh/h impressora × tarifa (R$/kWh)
 *     depreciação  = (investimento da impressora) ÷ (vida útil em horas)
 *     manutenção  = custo de bico/PEI/rolamentos por hora de impressão
 *
 *   Custo unitário do produto
 *     material    = (gramas × preço/grama) × (1 + desperdício%)
 *     máquina     = horas de impressão × custo/hora da máquina
 *     embalagem   = custo fixo de embalagem
 *     extras      = outros custos fixos
 *     mão de obra = horas de acabamento × valor da hora  (opcional)
 *
 *   Custo real (com falha)
 *     failures    = 1 ÷ (1 − taxaDeFalha%)
 *     total       = subtotal × failures
 *
 *   Preço sugerido para a margem desejada
 *     preço       = total ÷ (1 − margem%)
 *
 * Todas as funções são puras e tolerantes a valores vazios/null.
 */

const { prepare } = require('./database');

/** Defaults do perfil Bambu Lab A1 (usados se o banco ainda não tiver as chaves) */
const DEFAULT_COST_SETTINGS = {
  energy_rate: 1.13,        // R$/kWh  — tarifa informada pelo usuário
  printer_power: 0.10,      // kWh/h   — consumo médio da A1 (~100 W)
  printer_price: 5500.00,   // R$      — investimento (com AMS)
  printer_life_hours: 15000,// horas   — vida útil estimada
  maintenance_hourly: 0.05, // R$/h    — bico/PEI/rolamentos
  packaging_cost: 3.00,     // R$
  other_costs: 0.00,        // R$
  filament_price: 0.10,     // R$/g
  failure_rate: 10,         // %
  labor_rate: 0.00          // R$/h
};

/** Lê todos os cost_settings, mesclando com os defaults. */
async function getCostSettings() {
  const merged = { ...DEFAULT_COST_SETTINGS };
  try {
    const rows = await prepare('SELECT key, value FROM cost_settings').all();
    for (const r of rows) {
      if (r && r.key in merged) merged[r.key] = parseFloat(r.value) || 0;
    }
  } catch (e) {
    console.error('cost-calculator: falha ao ler cost_settings:', e.message);
  }
  return merged;
}

/** Converte "1.234,56" ou "1234.56" para número. */
function toNum(v) {
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  if (v === null || v === undefined) return 0;
  let s = String(v).trim().replace(/[R$\s%]/g, '');
  if (!s) return 0;
  // Se tem vírgula E ponto, assume formato pt-BR (1.234,56)
  if (s.indexOf(',') !== -1 && s.indexOf('.') !== -1) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (s.indexOf(',') !== -1) {
    // Só vírgula: decimal
    s = s.replace(',', '.');
  }
  const n = parseFloat(s);
  return isFinite(n) ? n : 0;
}

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

/**
 * Calcula o custo/hora da impressora.
 * @param {object} s cost settings
 * @returns {{hourly:number, energy:number, depreciation:number, maintenance:number, kwhPerHour:number, wattage:number, lifeHours:number}}
 */
function machineHourlyCost(s) {
  const kwhPerHour = toNum(s.printer_power);
  const energyRate = toNum(s.energy_rate);
  const printerPrice = toNum(s.printer_price);
  const lifeHours = toNum(s.printer_life_hours) || 1;
  const maintenance = toNum(s.maintenance_hourly);

  const energy = kwhPerHour * energyRate;
  const depreciation = printerPrice / lifeHours;
  const hourly = energy + depreciation + maintenance;

  return {
    hourly,
    energy,
    depreciation,
    maintenance,
    kwhPerHour,
    wattage: Math.round(kwhPerHour * 1000),
    lifeHours
  };
}

/**
 * Calcula o custo completo de um produto.
 *
 * @param {object} input
 *   filament_grams    – peso do filamento (g)
 *   print_hours       – tempo de impressão (h)
 *   filament_price    – R$/g (usa o global se não informado)
 *   material_waste_pct – desperdício/suporte (%)
 *   labor_hours       – horas de acabamento
 *   labor_rate        – R$/h (usa o global se não informado)
 *   packaging_cost    – R$ (usa o global se use_custom_packaging = 0)
 *   additional_cost   – R$ extras
 *   use_custom_packaging – 1 se packaging_cost vem do próprio produto
 *   failure_rate      – % (usa o global se não informado)
 * @param {object} s    cost settings
 */
function calculateProductCost(input, s) {
  const m = machineHourlyCost(s);

  const grams = Math.max(0, toNum(input.filament_grams));
  const hours = Math.max(0, toNum(input.print_hours));
  const filamentPrice = toNum(input.filament_price) || toNum(s.filament_price);
  const wastePct = Math.max(0, toNum(input.material_waste_pct));
  const useCustomPackaging = toNum(input.use_custom_packaging) === 1;

  const packaging = useCustomPackaging
    ? Math.max(0, toNum(input.packaging_cost))
    : toNum(s.packaging_cost);
  const additional = Math.max(0, toNum(input.additional_cost)) || toNum(s.other_costs);

  const laborHours = Math.max(0, toNum(input.labor_hours));
  const laborRate = toNum(input.labor_rate) || toNum(s.labor_rate);

  // --- Componentes ---
  const materialBase = grams * filamentPrice;
  const material = materialBase * (1 + wastePct / 100);
  const machine = hours * m.hourly;
  const labor = laborHours * laborRate;

  const subtotal = material + machine + labor + packaging + additional;

  // --- Taxa de falha (reimpressão) ---
  let failureRate = toNum(input.failure_rate);
  if (!failureRate && input.failure_rate !== 0 && input.failure_rate !== '0') {
    failureRate = toNum(s.failure_rate);
  }
  failureRate = Math.min(Math.max(failureRate, 0), 95) / 100;
  const failureMultiplier = 1 / (1 - failureRate);

  const total = subtotal * failureMultiplier;

  return {
    // insumos
    filament_grams: round2(grams),
    print_hours: round2(hours),
    filament_price: round2(filamentPrice),
    material_waste_pct: round2(wastePct),
    labor_hours: round2(laborHours),
    labor_rate: round2(laborRate),
    packaging_cost: round2(packaging),
    additional_cost: round2(additional),
    use_custom_packaging: useCustomPackaging ? 1 : 0,
    failure_rate: round2(failureRate * 100),

    // máquina
    machine_hourly_cost: round2(m.hourly),
    maintenance_cost: round2(m.maintenance),

    // componentes do custo
    material_cost: round2(material),
    energy_cost: round2(hours * m.energy),
    machine_cost: round2(machine),
    labor_cost: round2(labor),
    subtotal: round2(subtotal),
    failure_multiplier: round2(failureMultiplier),
    total_cost: round2(total),

    // diagnóstico
    breakdown: {
      materialBase: round2(materialBase),
      material: round2(material),
      energy: round2(hours * m.energy),
      depreciation: round2(hours * m.depreciation),
      maintenance: round2(hours * m.maintenance),
      machine: round2(machine),
      labor: round2(labor),
      packaging: round2(packaging),
      additional: round2(additional),
      subtotal: round2(subtotal),
      failureWaste: round2(total - subtotal),
      total: round2(total)
    }
  };
}

/** Preço de venda necessário para atingir a margem desejada (%). */
function suggestPrice(totalCost, marginPct) {
  const m = Math.min(Math.max(toNum(marginPct), 0), 95) / 100;
  return round2(toNum(totalCost) / (1 - m));
}

/** Margem bruta atual (%) para um preço informado. */
function currentMargin(totalCost, salePrice) {
  const c = toNum(totalCost);
  const p = toNum(salePrice);
  if (p <= 0) return 0;
  return round2(((p - c) / p) * 100);
}

module.exports = {
  DEFAULT_COST_SETTINGS,
  getCostSettings,
  machineHourlyCost,
  calculateProductCost,
  suggestPrice,
  currentMargin,
  toNum,
  round2
};

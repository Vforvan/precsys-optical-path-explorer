/**
 * 五轴联合控制的等效逆映射（两条技术路线共用）。
 *
 * 计划书 §10.5 要求：
 *   - 明确命名为 educationalInverseModel()，禁止暗示这是厂家控制器算法；
 *   - 需要演示"关掉补偿：焦点/入射角漂移；打开补偿：回到目标值；五个执行轴同时变化"。
 *
 * 本文件提供两种求解方式，差别正好是本节要讲的东西：
 *
 *   1) naiveInverse —— "一轴对应一个坐标"的教科书版本。
 *      只标定每个执行轴对"自己那个工程量"的灵敏度（对角项），完全忽略耦合。
 *   2) educationalInverseModel —— 联合求解。
 *      用有限差分在真实追迹模型上求出 5×5 耦合矩阵，再做牛顿迭代把
 *      (X, Y, Z, α, β) 同时解到位。它就是"工厂标定矩阵"在教学模型里的等价物，
 *      不是实机标定数据。
 *
 * 【两条路线为什么能共用】求解器通过 InverseTrainAdapter 访问"追迹一次、取结果、
 * 裁剪行程"这三件事，完全不知道内部是四次反射的反射式移束模块，还是两块透射平板。
 * 于是 SCANLAB 与 Novanta 的**耦合矩阵可以不一样**（因为耦合本来就不一样），
 * 而求解代码只有一份。
 */

import type { ConditioningState, OpticalTrain, OutcomeVector } from './optical-train';
import {
  DEFAULT_CONDITIONING,
  actuatorArray,
  actuatorFromArray,
  clampActuators,
  outcomeArray,
  traceTrain,
} from './optical-train';
import type { NovantaActuatorState, NovantaOpticalTrain } from './novanta-optical-train';
import {
  NOVANTA_DEFAULT_CONDITIONING,
  clampNovantaActuators,
  novantaActuatorArray,
  novantaActuatorFromArray,
  novantaOutcomeArray,
  traceNovantaTrain,
} from './novanta-optical-train';

/** 用户设定的五个工程量（工件坐标）。 */
export interface EngineeringCommand {
  xMm: number;
  yMm: number;
  zMm: number;
  alphaDeg: number;
  betaDeg: number;
}

export const ZERO_COMMAND: EngineeringCommand = {
  xMm: 0,
  yMm: 0,
  zMm: 0,
  alphaDeg: 0,
  betaDeg: 0,
};

export type AnyActuatorState = ReturnType<typeof actuatorFromArray> | NovantaActuatorState;

export interface InverseResult<A = AnyActuatorState> {
  /** 五个执行轴（两条路线的字段名不同，但都能读 xRad/yRad/zTravelMm/alphaRad/betaRad 之外，
   *  Novanta 用 plateARad/plateBRad/telescopeTravelMm；页面按路线取用）。 */
  actuators: A;
  /** 实际达到的工程量。 */
  achieved: OutcomeVector;
  /** 残差 = 实际 − 设定。 */
  residual: OutcomeVector;
  /** 牛顿迭代次数（naive 为 0）。 */
  iterations: number;
  /** 是否有执行轴被行程限制。 */
  saturated: boolean;
  /** 是否使用了联合补偿。 */
  compensated: boolean;
  /** 归一化耦合矩阵（对角线为 1），供页面展示"为什么必须联合标定"。 */
  coupling: number[][];
  /** 联合求解过程中追迹是否曾经失败（失败时残差不可信，页面必须告警）。 */
  traceFailed: boolean;
}

/**
 * 两条技术路线共用的适配器。
 * 求解器只认识这三件事，因此各自的**光路拓扑仍完全独立**。
 */
export interface InverseTrainAdapter {
  trace(values: number[]): { outcome: number[]; ok: boolean };
  clamp(values: number[]): { values: number[]; saturated: boolean };
  actuatorsOf(values: number[]): AnyActuatorState;
  /** 初始猜测（教科书解用零点雅可比；这里给个统一入口便于替换）。 */
  zeroValues(): number[];
}

/** SCANLAB 路线适配器。 */
export function scanlabAdapter(
  train: OpticalTrain,
  conditioning: ConditioningState = DEFAULT_CONDITIONING,
): InverseTrainAdapter {
  return {
    trace(values) {
      const trace = traceTrain(train, actuatorFromArray(values), conditioning);
      return { outcome: outcomeArray(trace), ok: trace.ok };
    },
    clamp(values) {
      const clamped = clampActuators(actuatorFromArray(values));
      const back = actuatorArray(clamped);
      return { values: back, saturated: back.some((v, i) => Math.abs(v - values[i]) > 1e-9) };
    },
    actuatorsOf: (values) => actuatorFromArray(values),
    zeroValues: () => [0, 0, 0, 0, 0],
  };
}

/** Novanta / ARGES 路线适配器。 */
export function novantaAdapter(
  train: NovantaOpticalTrain,
  conditioning = NOVANTA_DEFAULT_CONDITIONING,
): InverseTrainAdapter {
  return {
    trace(values) {
      const trace = traceNovantaTrain(train, novantaActuatorFromArray(values), conditioning);
      return { outcome: novantaOutcomeArray(trace), ok: trace.ok };
    },
    clamp(values) {
      const clamped = clampNovantaActuators(novantaActuatorFromArray(values));
      const back = novantaActuatorArray(clamped);
      return { values: back, saturated: back.some((v, i) => Math.abs(v - values[i]) > 1e-9) };
    },
    actuatorsOf: (values) => novantaActuatorFromArray(values),
    zeroValues: () => [0, 0, 0, 0, 0],
  };
}

/** 由雅可比矩阵得到归一化耦合矩阵（对角线为 1）。 */
export function normalizedFromJacobian(jacobian: number[][]): number[][] {
  const diag = [0, 1, 2, 3, 4].map((i) => jacobian[i][i]);
  return jacobian.map((row, i) =>
    row.map((value, k) => {
      const denom = diag[i];
      if (Math.abs(denom) < 1e-12) return 0;
      return k === i ? 1 : value / denom;
    }),
  );
}

/** 有限差分求耦合矩阵：第 i 个执行轴（度）对第 j 个工程量的影响。 */
export function buildJacobianWith(
  adapter: InverseTrainAdapter,
  at: number[],
  stepDeg = 0.05,
): number[][] {
  const base = adapter.trace(at).outcome;
  const jacobian: number[][] = [];
  for (let i = 0; i < 5; i += 1) {
    const probe = at.slice();
    probe[i] += stepDeg;
    const out = adapter.trace(probe).outcome;
    jacobian.push(out.map((value, j) => (value - base[j]) / stepDeg));
  }
  // jacobian[i][j] = d(outcome_j) / d(actuator_i)
  return jacobian;
}

/** 解 5×5 线性方程组 A·x = b（高斯消元 + 部分选主元）。 */
export function solveLinearSystem(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const m = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < n; row += 1) {
      if (Math.abs(m[row][col]) > Math.abs(m[pivot][col])) pivot = row;
    }
    if (Math.abs(m[pivot][col]) < 1e-12) return null;
    if (pivot !== col) {
      const tmp = m[pivot];
      m[pivot] = m[col];
      m[col] = tmp;
    }
    const diag = m[col][col];
    for (let row = col + 1; row < n; row += 1) {
      const factor = m[row][col] / diag;
      if (factor === 0) continue;
      for (let k = col; k <= n; k += 1) {
        m[row][k] -= factor * m[col][k];
      }
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let row = n - 1; row >= 0; row -= 1) {
    let sum = m[row][n];
    for (let k = row + 1; k < n; k += 1) sum -= m[row][k] * x[k];
    x[row] = sum / m[row][row];
  }
  return x;
}

function commandArray(cmd: EngineeringCommand): number[] {
  return [cmd.xMm, cmd.yMm, cmd.zMm, cmd.alphaDeg, cmd.betaDeg];
}

function toOutcome(values: number[]): OutcomeVector {
  return {
    xMm: values[0],
    yMm: values[1],
    zMm: values[2],
    alphaDeg: values[3],
    betaDeg: values[4],
  };
}

function residualOf(achieved: number[], target: number[]): OutcomeVector {
  return toOutcome(achieved.map((v, i) => v - target[i]));
}

/**
 * 教科书式逆映射：只按每个轴自己的灵敏度换算，忽略所有耦合。
 * 这就是"一轴对应一个坐标"的做法 —— 补偿关闭时用它。
 */
export function naiveInverseWith(
  adapter: InverseTrainAdapter,
  cmd: EngineeringCommand,
): InverseResult {
  const target = commandArray(cmd);
  const jacobian = buildJacobianWith(adapter, adapter.zeroValues());
  const guess = target.map((value, i) => {
    const sensitivity = jacobian[i][i];
    if (Math.abs(sensitivity) < 1e-12) return 0;
    return value / sensitivity;
  });
  const { values, saturated } = adapter.clamp(guess);
  const traced = adapter.trace(values);
  return {
    actuators: adapter.actuatorsOf(values),
    achieved: toOutcome(traced.outcome),
    residual: residualOf(traced.outcome, target),
    iterations: 0,
    saturated,
    compensated: false,
    coupling: normalizedFromJacobian(jacobian),
    traceFailed: !traced.ok,
  };
}

/**
 * 联合补偿求解：用真实耦合矩阵做牛顿迭代，把五个工程量同时解到位。
 * 3～4 次迭代即可收敛到远小于公开分辨率的残差。
 *
 * warmStart：上一帧的执行轴（动画播放时传入）。给了它就从上一帧继续迭代，
 * 省掉一次"教科书解 + 求雅可比"的开销 —— 这正是实机用查找表/上一周期状态
 * 做增量修正的思路，只是这里是教学等效实现。
 */
export function educationalInverseModelWith(
  adapter: InverseTrainAdapter,
  cmd: EngineeringCommand,
  maxIterations = 4,
  warmStart?: number[],
): InverseResult {
  const target = commandArray(cmd);
  let values: number[];
  let saturated: boolean;
  let traceFailed = false;
  if (warmStart) {
    values = warmStart.slice();
    saturated = false;
  } else {
    // 起点用教科书解，随后用真实耦合矩阵修正
    const initial = naiveInverseWith(adapter, cmd);
    values = adapterValues(initial.actuators);
    saturated = initial.saturated;
    traceFailed = initial.traceFailed;
  }
  let iterations = 0;
  let jacobian = buildJacobianWith(adapter, values);

  for (let iter = 0; iter < maxIterations; iter += 1) {
    const traced = adapter.trace(values);
    if (!traced.ok) {
      traceFailed = true;
      break;
    }
    const error = traced.outcome.map((v, i) => target[i] - v);
    if (error.every((e) => Math.abs(e) < 1e-9)) break;
    // 预热时雅可比变化很小：隔次重算即可，省一半开销
    if (!warmStart || iter % 2 === 0) {
      jacobian = buildJacobianWith(adapter, values);
    }
    // jacobian[i][j] = d(outcome_j)/d(actuator_i) → 转置成 J[j][i] 后解 J·Δ = error
    const J: number[][] = [];
    for (let j = 0; j < 5; j += 1) {
      J.push([0, 1, 2, 3, 4].map((i) => jacobian[i][j]));
    }
    const delta = solveLinearSystem(J, error);
    if (!delta) break;
    const next = adapter.clamp(values.map((v, i) => v + delta[i]));
    values = next.values;
    saturated = saturated || next.saturated;
    iterations = iter + 1;
  }

  const finalTrace = adapter.trace(values);
  if (!finalTrace.ok) traceFailed = true;
  return {
    actuators: adapter.actuatorsOf(values),
    achieved: toOutcome(finalTrace.outcome),
    residual: residualOf(finalTrace.outcome, target),
    iterations,
    saturated,
    compensated: true,
    coupling: normalizedFromJacobian(jacobian),
    traceFailed,
  };
}

/** 把任意路线的执行器对象转回量纲统一的 5 元数组。 */
function adapterValues(actuators: AnyActuatorState): number[] {
  const a = actuators as unknown as Record<string, number>;
  if ('plateARad' in a) {
    return [
      (a.xGalvoRad * 180) / Math.PI,
      (a.yGalvoRad * 180) / Math.PI,
      a.telescopeTravelMm,
      (a.plateARad * 180) / Math.PI,
      (a.plateBRad * 180) / Math.PI,
    ];
  }
  return [
    (a.xRad * 180) / Math.PI,
    (a.yRad * 180) / Math.PI,
    a.zTravelMm,
    (a.alphaRad * 180) / Math.PI,
    (a.betaRad * 180) / Math.PI,
  ];
}

/* ------------------------------------------------------------------ *
 * SCANLAB 路线的向后兼容包装（既有调用点与测试完全不用改）
 * ------------------------------------------------------------------ */

/** 有限差分求耦合矩阵（SCANLAB 路线）。 */
export function buildJacobian(
  train: OpticalTrain,
  at: number[],
  conditioning: ConditioningState = DEFAULT_CONDITIONING,
  stepDeg = 0.05,
): number[][] {
  return buildJacobianWith(scanlabAdapter(train, conditioning), at, stepDeg);
}

export function naiveInverse(
  train: OpticalTrain,
  cmd: EngineeringCommand,
  conditioning: ConditioningState = DEFAULT_CONDITIONING,
): InverseResult<ReturnType<typeof actuatorFromArray>> {
  return naiveInverseWith(scanlabAdapter(train, conditioning), cmd) as InverseResult<
    ReturnType<typeof actuatorFromArray>
  >;
}

export function educationalInverseModel(
  train: OpticalTrain,
  cmd: EngineeringCommand,
  conditioning: ConditioningState = DEFAULT_CONDITIONING,
  maxIterations = 4,
  warmStart?: ReturnType<typeof actuatorFromArray>,
): InverseResult<ReturnType<typeof actuatorFromArray>> {
  return educationalInverseModelWith(
    scanlabAdapter(train, conditioning),
    cmd,
    maxIterations,
    warmStart ? actuatorArray(warmStart) : undefined,
  ) as InverseResult<ReturnType<typeof actuatorFromArray>>;
}

/** 归一化耦合矩阵（对角线为 1），用于页面展示"为什么必须联合标定"。 */
export function normalizedCouplingMatrix(
  train: OpticalTrain,
  conditioning: ConditioningState = DEFAULT_CONDITIONING,
): number[][] {
  const j = buildJacobian(train, [0, 0, 0, 0, 0], conditioning);
  const diag = [0, 1, 2, 3, 4].map((i) => j[i][i]);
  return j.map((row, i) =>
    row.map((value, k) => {
      const denom = diag[i];
      if (Math.abs(denom) < 1e-12) return 0;
      return k === i ? 1 : value / denom;
    }),
  );
}

/* ------------------------------------------------------------------ *
 * Novanta 路线的对外入口
 * ------------------------------------------------------------------ */

export function naiveInverseNovanta(
  train: NovantaOpticalTrain,
  cmd: EngineeringCommand,
  conditioning = NOVANTA_DEFAULT_CONDITIONING,
): InverseResult<NovantaActuatorState> {
  return naiveInverseWith(novantaAdapter(train, conditioning), cmd) as InverseResult<
    NovantaActuatorState
  >;
}

export function educationalInverseModelNovanta(
  train: NovantaOpticalTrain,
  cmd: EngineeringCommand,
  conditioning = NOVANTA_DEFAULT_CONDITIONING,
  maxIterations = 4,
  warmStart?: NovantaActuatorState,
): InverseResult<NovantaActuatorState> {
  return educationalInverseModelWith(
    novantaAdapter(train, conditioning),
    cmd,
    maxIterations,
    warmStart ? novantaActuatorArray(warmStart) : undefined,
  ) as InverseResult<NovantaActuatorState>;
}

export function novantaCouplingMatrix(
  train: NovantaOpticalTrain,
  conditioning = NOVANTA_DEFAULT_CONDITIONING,
): number[][] {
  const j = buildJacobianWith(novantaAdapter(train, conditioning), [0, 0, 0, 0, 0]);
  const diag = [0, 1, 2, 3, 4].map((i) => j[i][i]);
  return j.map((row, i) =>
    row.map((value, k) => {
      const denom = diag[i];
      if (Math.abs(denom) < 1e-12) return 0;
      return k === i ? 1 : value / denom;
    }),
  );
}

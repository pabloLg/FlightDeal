export type AlertDecision =
  | { shouldFire: false; reason: "no_threshold" | "no_options" | "price_above_threshold" | "cooldown_active" }
  | {
      shouldFire: true;
      reason: "price_at_or_below_threshold";
      priceEur: number;
      optionId: string;
    };

export interface EvaluateAlertInput {
  thresholdEur: number | null;
  bestOption: { id: string; priceEur: number } | null;
  lastFiredAt: string | null;
  cooldownHours: number;
  now: string;
}

export function evaluateAlert(input: EvaluateAlertInput): AlertDecision {
  if (input.thresholdEur === null) {
    return { shouldFire: false, reason: "no_threshold" };
  }
  if (!input.bestOption) {
    return { shouldFire: false, reason: "no_options" };
  }

  const { bestOption, thresholdEur } = input;
  if (bestOption.priceEur > thresholdEur) {
    return { shouldFire: false, reason: "price_above_threshold" };
  }

  if (input.lastFiredAt) {
    const lastFired = new Date(input.lastFiredAt).getTime();
    const elapsedHours = (new Date(input.now).getTime() - lastFired) / 3_600_000;
    if (elapsedHours < input.cooldownHours) {
      return { shouldFire: false, reason: "cooldown_active" };
    }
  }

  return {
    shouldFire: true,
    reason: "price_at_or_below_threshold",
    priceEur: bestOption.priceEur,
    optionId: bestOption.id,
  };
}
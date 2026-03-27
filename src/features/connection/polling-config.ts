export const POLLING_INTERVALS: Record<string, number> = {
  // Combat — fast updates during play
  monster: 500,
  elite: 500,
  boss: 500,
  hand_select: 500,

  // Decision screens — moderate
  combat_rewards: 2000,
  card_reward: 2000,
  shop: 2000,
  event: 2000,
  card_select: 2000,
  relic_select: 2000,

  // Slower screens
  map: 3000,
  rest_site: 3000,
  treasure: 3000,

  // Idle
  menu: 5000,
  overlay: 2000,
};

export const ERROR_INTERVAL = 3000;
export const OFFLINE_INTERVAL = 5000;
export const DEFAULT_INTERVAL = 2000;

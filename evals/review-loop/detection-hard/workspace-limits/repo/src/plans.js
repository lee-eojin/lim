const PLANS = {
  free: { name: 'Free', limits: { seats: 3, projects: 5 }, features: ['boards'] },
  team: { name: 'Team', limits: { seats: 50, projects: 100 }, features: ['boards', 'timeline'] },
  business: { name: 'Business', limits: { seats: 500, projects: 1000 }, features: ['boards', 'timeline', 'reports'] },
};

export function planDefaults(planId) {
  const plan = PLANS[planId];
  if (!plan) throw new Error(`unknown plan: ${planId}`);
  return { ...plan, limits: { ...plan.limits }, features: [...plan.features] };
}

const FREE_FEATURES = ['notes', 'search'];
const TEAM_FEATURES = [...FREE_FEATURES, 'shared-folders', 'admin-console'];

export function featuresFor(plan) {
  switch (plan) {
    case 'free':
      return [...FREE_FEATURES];
    case 'team':
      return [...TEAM_FEATURES];
    default:
      throw new Error(`unknown plan: ${plan}`);
  }
}

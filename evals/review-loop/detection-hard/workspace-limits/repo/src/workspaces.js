import { planDefaults } from './plans.js';

export function effectiveSettings(workspace) {
  return planDefaults(workspace.plan);
}

export function canAddMember(workspace, memberCount) {
  return memberCount < effectiveSettings(workspace).limits.seats;
}

const workspaces = new Map([
  ['ws_1', { id: 'ws_1', plan: 'team', createdAt: '2024-02-01' }],
  ['ws_2', { id: 'ws_2', plan: 'team', createdAt: '2026-09-14', extraSeats: 20 }],
  ['ws_3', { id: 'ws_3', plan: 'free', createdAt: '2026-10-02', betaFeatures: ['automations'] }],
]);

export const findWorkspace = (id) => workspaces.get(id);

import { findWorkspace } from './workspaces-store.js';
import { effectiveSettings } from './workspaces.js';

export function registerRoutes(app) {
  app.get('/workspaces/:id/settings', (request) => {
    const workspace = findWorkspace(request.params.id);
    if (!workspace) return { status: 404 };
    return { status: 200, body: effectiveSettings(workspace) };
  });
}

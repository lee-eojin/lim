import { flushAudit, recordAudit } from './audit.js';

export function registerRoutes(app, { projects }) {
  app.post('/projects/:id/archive', async (request) => {
    const project = await projects.archive(request.params.id);
    recordAudit(request.user.id, 'project.archive', project.id);
    return { status: 200, body: project };
  });

  app.delete('/projects/:id', async (request) => {
    await projects.remove(request.params.id);
    recordAudit(request.user.id, 'project.delete', request.params.id);
    return { status: 204 };
  });

  app.onClose(() => flushAudit());
}

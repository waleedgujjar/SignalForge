import type { FastifyPluginAsync } from 'fastify';
import { requireWorkspaceGuard } from '../plugins/auth.js';
import { signUploadToken } from '../upload-token.js';

export const uploadRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireWorkspaceGuard().preHandler);

  // Issued over the session cookie (small request, safe through the web proxy);
  // the token then authorizes large uploads sent directly to the API origin.
  app.post('/token', async (request) => {
    const user = request.user!;
    return signUploadToken({
      userId: user.userId,
      workspaceId: user.workspaceId!,
      role: user.role!,
    });
  });
};

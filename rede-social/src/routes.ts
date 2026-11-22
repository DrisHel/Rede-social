import { Router } from 'express';
import type { UserController } from './users/UserController.js';
import type { PostController } from './posts/PostController.js';
import { asyncHandler } from './shared/http.js';
import { requireAuth } from './auth/middleware.js';
import { ValidationError } from './shared/errors.js';

// API JSON só de LEITURA. Escritas (criar usuário, seguir, criar post)
// migraram para src/webRoutes.ts, porque agora dependem de quem está
// logado (sessão) — ver Aula05/aula05.md.
export function createRoutes(userController: UserController, postController: PostController): Router {
  const router = Router();

  router.get(
    '/feed',
    requireAuth,
    asyncHandler(async (req, res) => {
      const cursorValue = req.query.cursor;
      const limitValue = req.query.limit ?? '10';
      const cursor = cursorValue === undefined ? undefined : Number(cursorValue);
      const limit = Number(limitValue);
      if ((cursor !== undefined && (!Number.isInteger(cursor) || cursor < 1)) || !Number.isInteger(limit) || limit < 1 || limit > 50) {
        throw new ValidationError('cursor ou limit inválido');
      }
      res.json(await userController.feedPage(req.session.userId!, cursor, limit));
    }),
  );

  router.get(
    '/users/:id',
    asyncHandler(async (req, res) => {
      const user = await userController.get(Number(req.params.id));
      res.json(user);
    }),
  );

  router.get(
    '/users/:id/feed',
    asyncHandler(async (req, res) => {
      const feed = await userController.feed(Number(req.params.id));
      res.json(feed);
    }),
  );

  router.get(
    '/posts/:id',
    asyncHandler(async (req, res) => {
      const post = await postController.get(Number(req.params.id));
      res.json(post);
    }),
  );

  router.get(
    '/tags/:name/posts',
    asyncHandler(async (req, res) => {
      const posts = await postController.listByTag(req.params.name);
      res.json(posts);
    }),
  );

  return router;
}

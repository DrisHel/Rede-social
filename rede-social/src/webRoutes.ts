import { Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import { AuthController } from './auth/AuthController.js';
import { UserController } from './users/UserController.js';
import { PostController } from './posts/PostController.js';
import { CommentController } from './comments/CommentController.js';
import { LikeController } from './likes/LikeController.js';
import { requireAuth, requireOwnComment, requireOwnPost } from './auth/middleware.js';
import { upload } from './uploads/upload.js';
import type { ImageStorage } from './uploads/storage.js';
import { asyncHandler } from './shared/http.js';
import { DuplicateEmailError, InvalidCredentialsError, ValidationError } from './shared/errors.js';

// Rotas que servem HTML (EJS) e dependem de sessão — diferente de
// routes.ts, que é só a API JSON de leitura. `requireAuth` (autenticação)
// e `requireOwnPost` (autorização) ficam em src/auth/middleware.ts.
export function createWebRoutes(prisma: PrismaClient, imageStorage: ImageStorage): Router {
  const router = Router();
  const authController = new AuthController(prisma);
  const userController = new UserController(prisma);
  const postController = new PostController(prisma);
  const commentController = new CommentController(prisma);
  const likeController = new LikeController(prisma);

  router.get('/register', (req, res) => {
    res.render('register', { error: null });
  });

  router.post(
    '/register',
    upload.single('avatar'),
    asyncHandler(async (req, res) => {
      try {
        let avatarUrl: string | undefined;
        if (req.file) {
          avatarUrl = await imageStorage.upload(req.file);
        }
        const user = await authController.register(req.body, avatarUrl);
        req.session.userId = user.id;
        res.redirect('/');
      } catch (err) {
        if (err instanceof ValidationError) {
          res.status(400).render('register', { error: err.message });
          return;
        }
        if (err instanceof DuplicateEmailError) {
          res.status(409).render('register', { error: err.message });
          return;
        }
        throw err;
      }
    }),
  );

  router.get('/login', (req, res) => {
    res.render('login', { error: null });
  });

  router.post(
    '/login',
    asyncHandler(async (req, res) => {
      try {
        const user = await authController.login(req.body);
        // É isso que "loga" o usuário: guardar o id na sessão. A partir
        // daqui, toda requisição desse navegador vai carregar
        // `req.session.userId` (via cookie) até o logout ou o cookie expirar.
        req.session.userId = user.id; 
        // req.session.user = user; // Ensure the `user` type matches the extended session type
        res.redirect('/');
      } catch (err) {
        if (err instanceof InvalidCredentialsError) {
          res.status(401).render('login', { error: err.message });
          return;
        }
        throw err;
      }
    }),
  );

  router.post('/logout', (req, res) => {
    req.session.destroy(() => {
      res.redirect('/login');
    });
  });

  router.get(
    '/',
    requireAuth,
    asyncHandler(async (req, res) => {
      const currentUserId = req.session.userId!;
      const checkedAt = new Date();
      const since = req.session.lastNotificationCheckAt
        ? new Date(req.session.lastNotificationCheckAt)
        : checkedAt;
      const [currentUser, feedPage, others, newLikes, newComments, newCommentLikes] = await Promise.all([
        userController.get(currentUserId),
        userController.feedPage(currentUserId, undefined, 10),
        userController.listOthers(currentUserId),
        prisma.like.count({ where: { post: { authorId: currentUserId }, userId: { not: currentUserId }, createdAt: { gt: since } } }),
        prisma.comment.count({ where: { post: { authorId: currentUserId }, authorId: { not: currentUserId }, createdAt: { gt: since } } }),
        prisma.commentLike.count({ where: { comment: { authorId: currentUserId }, userId: { not: currentUserId }, createdAt: { gt: since } } }),
      ]);
      req.session.lastNotificationCheckAt = checkedAt.toISOString();
      res.render('feed', {
        currentUser,
        feed: feedPage.posts,
        nextCursor: feedPage.nextCursor,
        others,
        notificationCount: newLikes + newComments + newCommentLikes,
      });
    }),
  );

  router.get('/posts/new', requireAuth, (req, res) => {
    res.render('newPost', { error: null });
  });

  router.get(
    '/posts/:id',
    requireAuth,
    asyncHandler(async (req, res) => {
      const post = await postController.get(Number(req.params.id), req.session.userId);
      const comments = await commentController.list(post.id, req.session.userId!);
      res.render('post', { currentUser: await userController.get(req.session.userId!), post, comments });
    }),
  );

  router.post(
    '/posts',
    requireAuth, // middlware
    upload.array('images', 10),
    asyncHandler(async (req, res) => {
      try {
        const files = (req.files ?? []) as Express.Multer.File[];
        const imageUrls = await Promise.all(files.map((file) => imageStorage.upload(file)));
        const tags = typeof req.body.tags === 'string'
          ? req.body.tags.split(',').map((t: string) => t.trim()).filter(Boolean)
          : undefined;

        await postController.create(req.session.userId!, { content: req.body.content, tags }, imageUrls);
        res.redirect('/');
      } catch (err) {
        if (err instanceof ValidationError) {
          res.status(400).render('newPost', { error: err.message });
          return;
        }
        throw err;
      }
    }),
  );

  router.post(
    '/posts/:id/like',
    requireAuth,
    asyncHandler(async (req, res) => {
      res.json(await likeController.setPostLike(req.session.userId!, Number(req.params.id), true));
    }),
  );

  router.delete(
    '/posts/:id/like',
    requireAuth,
    asyncHandler(async (req, res) => {
      res.json(await likeController.setPostLike(req.session.userId!, Number(req.params.id), false));
    }),
  );

  router.get(
    '/posts/:id/comments',
    requireAuth,
    asyncHandler(async (req, res) => {
      res.json(await commentController.list(Number(req.params.id), req.session.userId!));
    }),
  );

  router.post(
    '/posts/:id/comments',
    requireAuth,
    asyncHandler(async (req, res) => {
      res.status(201).json(await commentController.create(req.session.userId!, Number(req.params.id), req.body));
    }),
  );

  router.patch(
    '/posts/:id/comments/:commentId',
    requireAuth,
    requireOwnComment(prisma),
    asyncHandler(async (req, res) => {
      res.json(await commentController.update(Number(req.params.commentId), req.body));
    }),
  );

  router.delete(
    '/posts/:id/comments/:commentId',
    requireAuth,
    requireOwnComment(prisma),
    asyncHandler(async (req, res) => {
      await commentController.remove(Number(req.params.commentId));
      res.status(204).end();
    }),
  );

  router.post(
    '/comments/:commentId/like',
    requireAuth,
    asyncHandler(async (req, res) => {
      res.json(await likeController.setCommentLike(req.session.userId!, Number(req.params.commentId), true));
    }),
  );

  router.delete(
    '/comments/:commentId/like',
    requireAuth,
    asyncHandler(async (req, res) => {
      res.json(await likeController.setCommentLike(req.session.userId!, Number(req.params.commentId), false));
    }),
  );

  router.post(
    '/posts/:id/delete',
    requireAuth,
    requireOwnPost(prisma),
    asyncHandler(async (req, res) => {
      await postController.remove(Number(req.params.id));
      res.redirect('/');
    }),
  );

  router.post(
    '/follow',
    requireAuth,
    asyncHandler(async (req, res) => {
      await userController.follow(req.session.userId!, { targetId: Number(req.body.targetId) });
      res.redirect('/');
    }),
  );

  return router;
}

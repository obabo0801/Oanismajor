import { Router } from "express";

import editor from "#router/profile/editor";
import image from "#router/profile/image";
import view from "#router/profile/view";
import manage from "#router/profile/manage";
import history from "#router/profile/history";

const router = Router();

router.use(editor);
router.use(image);
router.use(history);
router.use(view);
router.use(manage);

export default router;

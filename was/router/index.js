import { Router } from "express";

import * as route from "#shared/route";

import { guard } from "#block";

import admin from "#router/admin";
import chatting from "#router/chatting";
import emoji from "#router/emoji";
import events from "#router/events";
import fcm from "#router/fcm";
import i18n from "#router/i18n";
import profile from "#router/profile";
import report from "#router/report";
import push from "#router/push";
import stt from "#router/stt";
import tts from "#router/tts";
import user from "#router/user";

const router = Router();

router.use(route.i18n, i18n);
router.use(route.user, user);

router.use(guard);

router.use(route.admin, admin);
router.use(route.chatting, chatting);
router.use(route.emoji, emoji);
router.use(route.events, events);
router.use(route.fcm, fcm);
router.use(route.profile, profile);
router.use(route.report, report);
router.use(route.push, push);
router.use(route.stt, stt);
router.use(route.tts, tts);

export default router;

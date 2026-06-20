import { Router, type IRouter } from "express";
import healthRouter from "./health";
import configRouter from "./config";
import songRouter from "./generate/song";
import videoRouter from "./generate/video";
import songVideoRouter from "./generate/song-video";
import promoRouter from "./generate/promo";
import thumbnailRouter from "./generate/thumbnail";

const router: IRouter = Router();

router.use(healthRouter);
router.use(configRouter);
router.use(songRouter);
router.use(videoRouter);
router.use(songVideoRouter);
router.use(promoRouter);
router.use(thumbnailRouter);

export default router;

import { Router, type IRouter } from "express";
import healthRouter from "./health";
import configRouter from "./config";
import songRouter from "./generate/song";
import videoRouter from "./generate/video";
import songVideoRouter from "./generate/song-video";
import promoRouter from "./generate/promo";
import thumbnailRouter from "./generate/thumbnail";
import projectsRouter from "./projects";
import artistVaultsRouter from "./artist-vaults";
import waitlistRouter from "./waitlist";
import transcribeRouter from "./transcribe";
import analyzeSectionsRouter from "./analyze-sections";
import demoClipRouter from "./generate/demo-clip";
import devRouter from "./dev";

const router: IRouter = Router();

router.use(healthRouter);
router.use(configRouter);
router.use(songRouter);
router.use(videoRouter);
router.use(songVideoRouter);
router.use(promoRouter);
router.use(thumbnailRouter);
router.use(projectsRouter);
router.use(artistVaultsRouter);
router.use(waitlistRouter);
router.use(transcribeRouter);
router.use(analyzeSectionsRouter);
router.use(demoClipRouter);
router.use(devRouter);

export default router;

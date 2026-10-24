/**
 * courses.ts — Creator Courses, the service layer.
 *
 * A course is a store_products row (kind='course') sold on the EXISTING
 * storefront rail: the creator sets the price, checkout/verify/claim and
 * the flat 5% platform fee are routes/storefront.ts, untouched. This lib
 * owns only what a course adds on top of that rail:
 *
 *   - CURRICULUM: ordered sections of ordered lessons (video lessons
 *     point at the creator's existing profile_videos hosting; text
 *     lessons carry a body; either may carry one attachment).
 *   - ENTITLEMENT (the Paid Series pattern): a completed store_orders
 *     row for the product IS the unlock — exactly as a completed
 *     digital_sales row unlocks a series. Refunded orders do not unlock.
 *     The course's owner always has access.
 *   - DRIP: a lesson with drip_day_offset N unlocks N days after the
 *     buyer's (earliest completed) order. Preview lessons are the free
 *     sample — open to everyone, like a series' preview episode.
 *   - PROGRESS: per-lesson, server-derived, with a resume point — the
 *     tutorial_progress shape and rules, so course lessons play
 *     through the Academy tutorial player pattern.
 *
 * PENDING MIGRATION: the course tables + the 'course' kind CHECK live
 * in the held migration (lane MIGRATION-NEEDED.md; number assigned at
 * join). Until it lands the DB refuses course rows and these tables do
 * not exist; routes/courses.ts maps that failure to 503
 * COURSES_NOT_LIVE (fail closed — see isCourseNotLiveError).
 */
import { and, asc, eq, inArray } from "drizzle-orm";
import {
  db,
  storeProductsTable,
  storeOrdersTable,
  courseSectionsTable,
  courseLessonsTable,
  courseLessonProgressTable,
  creatorProfilesTable,
  profileVideosTable,
  type StoreProduct,
} from "@workspace/db";

/* ─── errors ─────────────────────────────────────────────────────────── */

export class CourseError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** True when a DB failure means the held courses migration has not
    landed yet (missing course tables, or the store_products kind CHECK
    still refusing 'course'). Routes answer 503 COURSES_NOT_LIVE. */
export function isCourseNotLiveError(err: unknown): boolean {
  let cur: unknown = err;
  for (let depth = 0; depth < 4 && cur; depth++) {
    const e = cur as { code?: string; message?: string; cause?: unknown };
    if (e.code === "42P01" || e.code === "23514") return true;
    const msg = e.message ?? "";
    if (/course_sections|course_lessons|course_lesson_progress|store_products_kind_check/.test(msg)) return true;
    if (/relation .* does not exist/i.test(msg)) return true;
    cur = e.cause;
  }
  return false;
}

/* ─── pure helpers (unit-tested; the frontend mirrors these) ────────── */

export const DAY_MS = 86_400_000;

export function dripUnlockAt(purchasedAt: Date | string, dripDayOffset: number): Date {
  const base = purchasedAt instanceof Date ? purchasedAt.getTime() : new Date(purchasedAt).getTime();
  return new Date(base + Math.max(0, dripDayOffset) * DAY_MS);
}

export type CourseAccess = "owner" | "purchased" | "locked";
export type LessonLockReason = "purchase" | "drip" | null;

export function lessonLock(args: {
  access: CourseAccess;
  isPreview: boolean;
  dripDayOffset: number;
  /** Earliest completed-order time; required when access='purchased'. */
  purchasedAt: Date | string | null;
  now: Date;
}): { locked: boolean; reason: LessonLockReason; unlockAt: string | null } {
  if (args.isPreview) return { locked: false, reason: null, unlockAt: null };
  if (args.access === "owner") return { locked: false, reason: null, unlockAt: null };
  if (args.access !== "purchased" || !args.purchasedAt) {
    return { locked: true, reason: "purchase", unlockAt: null };
  }
  if (args.dripDayOffset <= 0) return { locked: false, reason: null, unlockAt: null };
  const unlock = dripUnlockAt(args.purchasedAt, args.dripDayOffset);
  if (args.now.getTime() >= unlock.getTime()) return { locked: false, reason: null, unlockAt: null };
  return { locked: true, reason: "drip", unlockAt: unlock.toISOString() };
}

export function courseProgressPct(totalLessons: number, completedLessons: number): number {
  if (totalLessons <= 0) return 0;
  return Math.round((Math.min(completedLessons, totalLessons) / totalLessons) * 100);
}

/* ─── DTOs ───────────────────────────────────────────────────────────── */

export interface CourseProductDto {
  id: string;
  title: string;
  description: string;
  priceCents: number;
  free: boolean;
  isActive: boolean;
  profileId: string;
  creatorSlug: string | null;
  creatorName: string | null;
  productUrl: string;
  buyUrl: string;
}

export interface CourseLessonOutlineDto {
  id: string;
  title: string;
  position: number;
  kind: "video" | "text";
  dripDayOffset: number;
  isPreview: boolean;
  hasVideo: boolean;
  durationSec: number | null;
}

export interface CourseSectionDto<L = CourseLessonOutlineDto> {
  id: string;
  title: string;
  position: number;
  lessons: L[];
}

export interface CourseOutlineDto {
  product: CourseProductDto;
  access: CourseAccess;
  purchasedAt: string | null;
  lessonCount: number;
  sections: CourseSectionDto[];
}

export interface CourseLessonLearnDto extends CourseLessonOutlineDto {
  locked: boolean;
  lockReason: LessonLockReason;
  unlockAt: string | null;
  /** Content fields — null whenever the lesson is locked. */
  body: string | null;
  video: { id: string; url: string; thumbnailUrl: string | null; durationSec: number } | null;
  attachment: { title: string; url: string } | null;
  progress: { status: string; lastPositionSec: number; completedAt: string | null } | null;
}

export interface CourseLearnDto extends Omit<CourseOutlineDto, "sections"> {
  sections: CourseSectionDto<CourseLessonLearnDto>[];
  completedLessons: number;
  progressPct: number;
}

export interface MyCourseDto {
  product: CourseProductDto;
  access: CourseAccess;
  lessonCount: number;
  completedLessons: number;
  progressPct: number;
  purchasedAt: string | null;
}

/* ─── internals ──────────────────────────────────────────────────────── */

function isoOf(v: Date | string | null): string | null {
  if (!v) return null;
  return v instanceof Date ? v.toISOString() : new Date(v).toISOString();
}

async function loadCourseProduct(productId: string): Promise<StoreProduct> {
  const [row] = await db
    .select()
    .from(storeProductsTable)
    .where(eq(storeProductsTable.id, productId))
    .limit(1);
  if (!row || row.kind !== "course") {
    throw new CourseError(404, "COURSE_NOT_FOUND", "That course doesn't exist.");
  }
  return row;
}

async function ownerUserIdForProfile(profileId: string): Promise<string | null> {
  const [p] = await db
    .select({ userId: creatorProfilesTable.userId, slug: creatorProfilesTable.slug, displayName: creatorProfilesTable.displayName })
    .from(creatorProfilesTable)
    .where(eq(creatorProfilesTable.id, profileId))
    .limit(1);
  return p?.userId ?? null;
}

async function productDto(product: StoreProduct): Promise<CourseProductDto> {
  const [p] = await db
    .select({ slug: creatorProfilesTable.slug, displayName: creatorProfilesTable.displayName })
    .from(creatorProfilesTable)
    .where(eq(creatorProfilesTable.id, product.profileId))
    .limit(1);
  return {
    id: product.id,
    title: product.title,
    description: product.description,
    priceCents: product.priceCents,
    free: product.priceCents === 0,
    isActive: product.isActive,
    profileId: product.profileId,
    creatorSlug: p?.slug ?? null,
    creatorName: p?.displayName ?? null,
    productUrl: `/storefront/product/${product.id}`,
    buyUrl: `/storefront/product/${product.id}`,
  };
}

/** The entitlement read (Paid Series pattern): the earliest COMPLETED
    store order for this product by this viewer. Any other status —
    refunded included — is not an unlock. */
async function earliestCompletedOrderAt(userId: string, productId: string): Promise<Date | string | null> {
  const rows = await db
    .select({ createdAt: storeOrdersTable.createdAt })
    .from(storeOrdersTable)
    .where(
      and(
        eq(storeOrdersTable.buyerUserId, userId),
        eq(storeOrdersTable.productId, productId),
        eq(storeOrdersTable.status, "completed"),
      ),
    )
    .orderBy(asc(storeOrdersTable.createdAt))
    .limit(1);
  return rows[0]?.createdAt ?? null;
}

export async function accessFor(
  product: StoreProduct,
  userId: string | null,
): Promise<{ access: CourseAccess; purchasedAt: Date | string | null }> {
  if (!userId) return { access: "locked", purchasedAt: null };
  const ownerUserId = await ownerUserIdForProfile(product.profileId);
  if (ownerUserId && ownerUserId === userId) return { access: "owner", purchasedAt: null };
  const purchasedAt = await earliestCompletedOrderAt(userId, product.id);
  if (purchasedAt) return { access: "purchased", purchasedAt };
  return { access: "locked", purchasedAt: null };
}

interface CurriculumRows {
  sections: Array<typeof courseSectionsTable.$inferSelect>;
  lessonsBySection: Map<string, Array<typeof courseLessonsTable.$inferSelect>>;
  durationByVideo: Map<string, number>;
}

async function loadCurriculum(productId: string): Promise<CurriculumRows> {
  const sections = await db
    .select()
    .from(courseSectionsTable)
    .where(eq(courseSectionsTable.productId, productId))
    .orderBy(asc(courseSectionsTable.position));
  const lessonsBySection = new Map<string, Array<typeof courseLessonsTable.$inferSelect>>();
  if (sections.length > 0) {
    const lessons = await db
      .select()
      .from(courseLessonsTable)
      .where(inArray(courseLessonsTable.sectionId, sections.map((s) => s.id)))
      .orderBy(asc(courseLessonsTable.position));
    for (const l of lessons) {
      const list = lessonsBySection.get(l.sectionId) ?? [];
      list.push(l);
      lessonsBySection.set(l.sectionId, list);
    }
  }
  const videoIds = [...lessonsBySection.values()].flat().map((l) => l.videoId).filter((v): v is string => !!v);
  const videos = videoIds.length
    ? await db
        .select({ id: profileVideosTable.id, durationSec: profileVideosTable.durationSec })
        .from(profileVideosTable)
        .where(inArray(profileVideosTable.id, videoIds))
    : [];
  return { sections, lessonsBySection, durationByVideo: new Map(videos.map((v) => [v.id, v.durationSec])) };
}

function outlineLesson(
  l: typeof courseLessonsTable.$inferSelect,
  durationByVideo: Map<string, number>,
): CourseLessonOutlineDto {
  return {
    id: l.id,
    title: l.title,
    position: l.position,
    kind: l.kind,
    dripDayOffset: l.dripDayOffset,
    isPreview: l.isPreview,
    hasVideo: !!l.videoId,
    durationSec: l.videoId ? durationByVideo.get(l.videoId) ?? null : null,
  };
}

/* ─── public outline (sales page) ────────────────────────────────────── */

/**
 * The sales-page read: the curriculum OUTLINE only. Lesson bodies,
 * video URLs, and attachment URLs are never selected into this DTO —
 * except preview lessons, whose content the learn endpoint serves.
 * Unpublished courses are visible only to their owner.
 */
export async function getCourseOutline(
  productId: string,
  userId: string | null,
): Promise<CourseOutlineDto> {
  const product = await loadCourseProduct(productId);
  const { access, purchasedAt } = await accessFor(product, userId);
  if (!product.isActive && access !== "owner") {
    throw new CourseError(404, "COURSE_NOT_FOUND", "That course doesn't exist.");
  }
  const { sections, lessonsBySection, durationByVideo } = await loadCurriculum(productId);
  let lessonCount = 0;
  const sectionDtos = sections.map((s) => {
    const lessons = (lessonsBySection.get(s.id) ?? []).map((l) => outlineLesson(l, durationByVideo));
    lessonCount += lessons.length;
    return { id: s.id, title: s.title, position: s.position, lessons };
  });
  return {
    product: await productDto(product),
    access,
    purchasedAt: isoOf(purchasedAt),
    lessonCount,
    sections: sectionDtos,
  };
}

/* ─── learn view (buyer playback) ────────────────────────────────────── */

/**
 * The playback read. Content is attached per lesson ONLY when that
 * lesson is open for this viewer (owner / purchased + drip elapsed /
 * preview). Locked lessons carry null content fields — enforcement is
 * here, server-side, never in the client.
 */
export async function getCourseLearn(
  productId: string,
  userId: string,
  now: Date = new Date(),
): Promise<CourseLearnDto> {
  const product = await loadCourseProduct(productId);
  const { access, purchasedAt } = await accessFor(product, userId);
  if (!product.isActive && access !== "owner") {
    throw new CourseError(404, "COURSE_NOT_FOUND", "That course doesn't exist.");
  }
  const { sections, lessonsBySection, durationByVideo } = await loadCurriculum(productId);

  const allLessons = [...lessonsBySection.values()].flat();
  const progressRows = allLessons.length
    ? await db
        .select()
        .from(courseLessonProgressTable)
        .where(
          and(
            eq(courseLessonProgressTable.userId, userId),
            inArray(courseLessonProgressTable.lessonId, allLessons.map((l) => l.id)),
          ),
        )
    : [];
  const progressByLesson = new Map(progressRows.map((p) => [p.lessonId, p]));

  const videoIds = allLessons.map((l) => l.videoId).filter((v): v is string => !!v);
  const videos = videoIds.length
    ? await db.select().from(profileVideosTable).where(inArray(profileVideosTable.id, videoIds))
    : [];
  const videoById = new Map(videos.map((v) => [v.id, v]));

  let lessonCount = 0;
  let completedLessons = 0;
  const sectionDtos: CourseSectionDto<CourseLessonLearnDto>[] = sections.map((s) => {
    const lessons = (lessonsBySection.get(s.id) ?? []).map((l): CourseLessonLearnDto => {
      lessonCount += 1;
      const prog = progressByLesson.get(l.id);
      if (prog?.status === "completed") completedLessons += 1;
      const lock = lessonLock({ access, isPreview: l.isPreview, dripDayOffset: l.dripDayOffset, purchasedAt, now });
      const video = !lock.locked && l.videoId ? videoById.get(l.videoId) : undefined;
      return {
        ...outlineLesson(l, durationByVideo),
        locked: lock.locked,
        lockReason: lock.reason,
        unlockAt: lock.unlockAt,
        body: lock.locked ? null : l.body,
        video: video
          ? { id: video.id, url: video.videoUrl, thumbnailUrl: video.thumbnailUrl, durationSec: video.durationSec }
          : null,
        attachment:
          !lock.locked && l.attachmentUrl
            ? { title: l.attachmentTitle ?? "Attachment", url: l.attachmentUrl }
            : null,
        progress: prog
          ? { status: prog.status, lastPositionSec: prog.lastPositionSec, completedAt: isoOf(prog.completedAt) }
          : null,
      };
    });
    return { id: s.id, title: s.title, position: s.position, lessons };
  });

  return {
    product: await productDto(product),
    access,
    purchasedAt: isoOf(purchasedAt),
    lessonCount,
    sections: sectionDtos,
    completedLessons,
    progressPct: courseProgressPct(lessonCount, completedLessons),
  };
}

/* ─── My Courses shelf ───────────────────────────────────────────────── */

/** Every course the caller owns (as creator) or has a completed order
    for, with progress — the Academy "My Courses" shelf read. */
export async function listMyCourses(userId: string): Promise<MyCourseDto[]> {
  const orders = await db
    .select({ productId: storeOrdersTable.productId, createdAt: storeOrdersTable.createdAt })
    .from(storeOrdersTable)
    .where(and(eq(storeOrdersTable.buyerUserId, userId), eq(storeOrdersTable.status, "completed")))
    .orderBy(asc(storeOrdersTable.createdAt));
  const purchasedAtByProduct = new Map<string, Date | string>();
  for (const o of orders) {
    if (o.productId && !purchasedAtByProduct.has(o.productId)) {
      purchasedAtByProduct.set(o.productId, o.createdAt);
    }
  }
  const [profile] = await db
    .select({ id: creatorProfilesTable.id })
    .from(creatorProfilesTable)
    .where(eq(creatorProfilesTable.userId, userId))
    .limit(1);

  const productIds = new Set<string>(purchasedAtByProduct.keys());
  let ownedProducts: StoreProduct[] = [];
  if (profile) {
    ownedProducts = await db
      .select()
      .from(storeProductsTable)
      .where(and(eq(storeProductsTable.profileId, profile.id), eq(storeProductsTable.kind, "course")));
    for (const p of ownedProducts) productIds.add(p.id);
  }
  if (productIds.size === 0) return [];

  const products = await db
    .select()
    .from(storeProductsTable)
    .where(
      and(
        inArray(storeProductsTable.id, [...productIds]),
        eq(storeProductsTable.kind, "course"),
      ),
    );
  const ownedIds = new Set(ownedProducts.map((p) => p.id));

  const out: MyCourseDto[] = [];
  for (const product of products) {
    const { lessonsBySection } = await loadCurriculum(product.id);
    const total = [...lessonsBySection.values()].flat().length;
    const progress = total
      ? await db
          .select()
          .from(courseLessonProgressTable)
          .where(
            and(
              eq(courseLessonProgressTable.userId, userId),
              eq(courseLessonProgressTable.productId, product.id),
            ),
          )
      : [];
    const completed = progress.filter((p) => p.status === "completed").length;
    out.push({
      product: await productDto(product),
      access: ownedIds.has(product.id) ? "owner" : "purchased",
      lessonCount: total,
      completedLessons: completed,
      progressPct: courseProgressPct(total, completed),
      purchasedAt: isoOf(purchasedAtByProduct.get(product.id) ?? null),
    });
  }
  return out.sort((a, b) => a.product.title.localeCompare(b.product.title));
}

/* ─── creator side ───────────────────────────────────────────────────── */

export interface CourseActor {
  userId: string;
  email?: string | null;
}

async function callerProfile(userId: string): Promise<{ id: string; slug: string } | null> {
  const [p] = await db
    .select({ id: creatorProfilesTable.id, slug: creatorProfilesTable.slug })
    .from(creatorProfilesTable)
    .where(eq(creatorProfilesTable.userId, userId))
    .limit(1);
  return p ?? null;
}

async function loadOwnedCourse(actor: CourseActor, productId: string): Promise<StoreProduct> {
  const product = await loadCourseProduct(productId);
  const ownerUserId = await ownerUserIdForProfile(product.profileId);
  if (ownerUserId !== actor.userId) {
    throw new CourseError(403, "NOT_OWNER", "That course isn't yours to edit.");
  }
  return product;
}

/** The creator-set price rule: whole cents, $0 allowed (a free course is
    claimed on the $0 rail), never negative, same ceiling as the store
    rail's product schema. No default is ever supplied here — the price
    in the row is exactly the price the creator typed. */
export function validateCoursePriceCents(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 0 || raw > 10_000_00 * 100) {
    throw new CourseError(400, "BAD_PRICE", "Set the course price in whole cents, $0 or more.");
  }
  return raw;
}

export async function createCourse(
  actor: CourseActor,
  input: { title: string; description?: string; priceCents: number },
): Promise<CourseProductDto> {
  const profile = await callerProfile(actor.userId);
  if (!profile) {
    throw new CourseError(404, "NO_PROFILE", "You need a creator profile before you can sell a course.");
  }
  const title = input.title.trim();
  if (!title) throw new CourseError(400, "BAD_TITLE", "A course needs a title.");
  const priceCents = validateCoursePriceCents(input.priceCents);
  const [row] = await db
    .insert(storeProductsTable)
    .values({
      profileId: profile.id,
      kind: "course",
      title,
      description: input.description ?? "",
      priceCents,
      inventory: -1,
      mediaUrls: [],
      relatedLinks: [],
      /* A new course starts as a draft: the creator publishes it from
         the builder once the curriculum is in. */
      isActive: false,
    })
    .returning();
  return productDto(row);
}

export async function updateCourse(
  actor: CourseActor,
  productId: string,
  patch: { title?: string; description?: string; priceCents?: number; isActive?: boolean },
): Promise<CourseProductDto> {
  const product = await loadOwnedCourse(actor, productId);
  const set: Partial<StoreProduct> = { updatedAt: new Date() };
  if (patch.title !== undefined) {
    const title = patch.title.trim();
    if (!title) throw new CourseError(400, "BAD_TITLE", "A course needs a title.");
    set.title = title;
  }
  if (patch.description !== undefined) set.description = patch.description;
  if (patch.priceCents !== undefined) set.priceCents = validateCoursePriceCents(patch.priceCents);
  if (patch.isActive !== undefined) set.isActive = patch.isActive;
  const [row] = await db
    .update(storeProductsTable)
    .set(set)
    .where(eq(storeProductsTable.id, product.id))
    .returning();
  return productDto(row);
}

/** The creator's own courses (product DTOs; the builder reads each
    course's curriculum separately via getCreatedCurriculum). */
export async function listMyCreatedProducts(actor: CourseActor): Promise<CourseProductDto[]> {
  const profile = await callerProfile(actor.userId);
  if (!profile) return [];
  const rows = await db
    .select()
    .from(storeProductsTable)
    .where(and(eq(storeProductsTable.profileId, profile.id), eq(storeProductsTable.kind, "course")));
  const dtos = await Promise.all(rows.map((r) => productDto(r)));
  return dtos.sort((a, b) => a.title.localeCompare(b.title));
}

export interface CurriculumLessonInput {
  title: string;
  kind?: "video" | "text";
  videoId?: string | null;
  body?: string;
  attachmentTitle?: string | null;
  attachmentUrl?: string | null;
  dripDayOffset?: number;
  isPreview?: boolean;
}
export interface CurriculumSectionInput {
  title: string;
  lessons: CurriculumLessonInput[];
}

export interface CreatedCurriculumDto {
  sections: Array<{
    id: string;
    title: string;
    position: number;
    lessons: Array<{
      id: string; title: string; position: number; kind: "video" | "text";
      videoId: string | null; body: string;
      attachmentTitle: string | null; attachmentUrl: string | null;
      dripDayOffset: number; isPreview: boolean;
    }>;
  }>;
}

/** The creator's full curriculum (all fields — this is the builder's
    own view of their own course, never a buyer's). */
export async function getCreatedCurriculum(
  actor: CourseActor,
  productId: string,
): Promise<CreatedCurriculumDto> {
  await loadOwnedCourse(actor, productId);
  const { sections, lessonsBySection } = await loadCurriculum(productId);
  return {
    sections: sections.map((s) => ({
      id: s.id,
      title: s.title,
      position: s.position,
      lessons: (lessonsBySection.get(s.id) ?? []).map((l) => ({
        id: l.id,
        title: l.title,
        position: l.position,
        kind: l.kind,
        videoId: l.videoId,
        body: l.body,
        attachmentTitle: l.attachmentTitle,
        attachmentUrl: l.attachmentUrl,
        dripDayOffset: l.dripDayOffset,
        isPreview: l.isPreview,
      })),
    })),
  };
}

/**
 * Replace the whole curriculum — array order IS the order (positions
 * are assigned here, never trusted from the client; the chapters rule
 * from Tutorials). Video lessons must point at the creator's OWN
 * published profile videos (the designate rule). Replacing the
 * curriculum deletes the old lessons, and progress rows for deleted
 * lessons go with them (FK cascade) — the same trade tutorials make
 * when chapters are replaced.
 */
export async function replaceCurriculum(
  actor: CourseActor,
  productId: string,
  sections: CurriculumSectionInput[],
): Promise<CreatedCurriculumDto> {
  const product = await loadOwnedCourse(actor, productId);
  if (sections.length > 30) {
    throw new CourseError(400, "TOO_MANY_SECTIONS", "A course can hold at most 30 sections.");
  }
  let totalLessons = 0;
  for (const s of sections) {
    if (!s.title.trim()) throw new CourseError(400, "BAD_SECTION", "Every section needs a title.");
    if (s.lessons.length > 60) {
      throw new CourseError(400, "TOO_MANY_LESSONS", "A section can hold at most 60 lessons.");
    }
    totalLessons += s.lessons.length;
    for (const l of s.lessons) {
      if (!l.title.trim()) throw new CourseError(400, "BAD_LESSON", "Every lesson needs a title.");
      const kind = l.kind ?? "video";
      if (kind === "text" && !(l.body ?? "").trim()) {
        throw new CourseError(400, "BAD_LESSON", "A text lesson needs its lesson text.");
      }
      if (l.dripDayOffset !== undefined && (!Number.isInteger(l.dripDayOffset) || l.dripDayOffset < 0 || l.dripDayOffset > 3650)) {
        throw new CourseError(400, "BAD_DRIP", "Drip offset must be a whole number of days, 0 or more.");
      }
      if (l.attachmentUrl && !l.attachmentTitle) {
        throw new CourseError(400, "BAD_ATTACHMENT", "An attachment needs a title.");
      }
      if (l.videoId) {
        const [video] = await db
          .select()
          .from(profileVideosTable)
          .where(eq(profileVideosTable.id, l.videoId))
          .limit(1);
        if (!video) throw new CourseError(404, "VIDEO_NOT_FOUND", "That lesson video doesn't exist.");
        if (!video.isPublished) {
          throw new CourseError(400, "VIDEO_NOT_PUBLISHED", "Only a published video can be a course lesson.");
        }
        if (video.profileId !== product.profileId) {
          throw new CourseError(403, "NOT_OWNER", "Lesson videos must be your own videos.");
        }
      }
    }
  }
  if (totalLessons > 300) {
    throw new CourseError(400, "TOO_MANY_LESSONS", "A course can hold at most 300 lessons.");
  }

  await db.delete(courseSectionsTable).where(eq(courseSectionsTable.productId, productId));
  for (const [si, s] of sections.entries()) {
    const [section] = await db
      .insert(courseSectionsTable)
      .values({ productId, title: s.title.trim(), position: si + 1 })
      .returning();
    if (s.lessons.length > 0) {
      await db.insert(courseLessonsTable).values(
        s.lessons.map((l, li) => ({
          sectionId: section.id,
          title: l.title.trim(),
          position: li + 1,
          kind: l.kind ?? "video",
          videoId: l.videoId ?? null,
          body: l.body ?? "",
          attachmentTitle: l.attachmentUrl ? (l.attachmentTitle ?? null) : null,
          attachmentUrl: l.attachmentUrl ?? null,
          dripDayOffset: l.dripDayOffset ?? 0,
          isPreview: !!l.isPreview,
        })),
      );
    }
  }
  return getCreatedCurriculum(actor, productId);
}

/* ─── progress ───────────────────────────────────────────────────────── */

export interface LessonProgressDto {
  lessonId: string;
  status: "started" | "in_progress" | "completed";
  lastPositionSec: number;
  completedAt: string | null;
}

export interface LessonProgressInput {
  positionSec?: number;
  complete?: boolean;
  uncomplete?: boolean;
  markCompleted?: boolean;
}

/**
 * Record one lesson progress beat. Same gates as the learn read
 * (entitlement + drip, preview open) and the same derivation as
 * tutorial progress: completed is sticky, un-completing honestly
 * reopens, and the resume position only ever moves forward.
 */
export async function recordLessonProgress(
  userId: string,
  productId: string,
  lessonId: string,
  input: LessonProgressInput,
  now: Date = new Date(),
): Promise<LessonProgressDto> {
  const product = await loadCourseProduct(productId);
  const { sections, lessonsBySection } = await loadCurriculum(productId);
  void sections;
  const lesson = [...lessonsBySection.values()].flat().find((l) => l.id === lessonId);
  if (!lesson) throw new CourseError(404, "LESSON_NOT_FOUND", "That lesson isn't part of this course.");
  const { access, purchasedAt } = await accessFor(product, userId);
  const lock = lessonLock({ access, isPreview: lesson.isPreview, dripDayOffset: lesson.dripDayOffset, purchasedAt, now });
  if (lock.locked) {
    throw new CourseError(
      403,
      lock.reason === "drip" ? "LESSON_DRIPPED" : "COURSE_LOCKED",
      lock.reason === "drip"
        ? "This lesson hasn't unlocked yet."
        : "Buy the course to track progress in it.",
    );
  }

  const [existing] = await db
    .select()
    .from(courseLessonProgressTable)
    .where(
      and(
        eq(courseLessonProgressTable.userId, userId),
        eq(courseLessonProgressTable.lessonId, lessonId),
      ),
    )
    .limit(1);

  const lastPositionSec = Math.max(
    existing?.lastPositionSec ?? 0,
    Math.max(0, Math.floor(input.positionSec ?? 0)),
  );
  const wantsComplete = !!input.complete || !!input.markCompleted;
  const isCompleted = input.uncomplete
    ? false
    : existing?.status === "completed" || wantsComplete;
  const status: LessonProgressDto["status"] = isCompleted
    ? "completed"
    : lastPositionSec > 0
      ? "in_progress"
      : existing && !input.uncomplete && existing.status === "in_progress"
        ? "in_progress"
        : "started";
  const completedAt = isCompleted ? (existing?.completedAt ?? now) : null;

  if (existing) {
    const [row] = await db
      .update(courseLessonProgressTable)
      .set({ status, lastPositionSec, completedAt, updatedAt: now })
      .where(eq(courseLessonProgressTable.id, existing.id))
      .returning();
    return { lessonId: row.lessonId, status: row.status, lastPositionSec: row.lastPositionSec, completedAt: isoOf(row.completedAt) };
  }
  const [row] = await db
    .insert(courseLessonProgressTable)
    .values({ userId, lessonId, productId, status, lastPositionSec, completedAt })
    .returning();
  return { lessonId: row.lessonId, status: row.status, lastPositionSec: row.lastPositionSec, completedAt: isoOf(row.completedAt) };
}

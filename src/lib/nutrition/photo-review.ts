export type PhotoReview = {
  basis: 'estimated' | 'label' | 'usda';
  notes: string[];
  referenceId: string | null;
  referenceDescription: string | null;
};

export function parsePhotoReview(value: unknown): PhotoReview | undefined {
  if (value == null) return undefined; // Cached/older deployments have no review metadata.
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid photo review');
  const review = value as Record<string, unknown>;
  if (!['estimated', 'label', 'usda'].includes(String(review.basis))
    || !Array.isArray(review.notes) || review.notes.length > 4
    || !review.notes.every((note) => typeof note === 'string' && note.length <= 240)
    || !(review.referenceId === null || (typeof review.referenceId === 'string' && /^\d{1,20}$/.test(review.referenceId)))
    || !(review.referenceDescription === null || (typeof review.referenceDescription === 'string' && review.referenceDescription.length <= 200))
    || (review.basis === 'usda' && (!review.referenceId || !review.referenceDescription))
    || (review.basis !== 'usda' && (review.referenceId !== null || review.referenceDescription !== null))) {
    throw new Error('Invalid photo review');
  }
  return { basis: review.basis as PhotoReview['basis'], notes: [...review.notes] as string[],
    referenceId: review.referenceId as string | null, referenceDescription: review.referenceDescription as string | null };
}

export function photoReviewLabel(review?: PhotoReview): string {
  if (review?.basis === 'usda') return 'Photo estimate · USDA nutrition';
  if (review?.basis === 'label') return 'AI-read nutrition label · check serving';
  return 'Photo estimate · check portion and ingredients';
}
